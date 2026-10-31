import { randomUUID, randomInt } from 'node:crypto';
import { config } from '../../config/env.js';
import { db, withTransaction } from '../../db/pool.js';
import { signJwt } from '../../utils/jwt.js';
import { randomToken, sha256Hex, safeEqual } from '../../utils/crypto.js';
import { verifyPassword, hashPassword, passwordProblem } from '../../utils/password.js';
import { badRequest, unauthorized, HttpError } from '../../utils/errors.js';
import { audit } from '../../utils/audit.js';
import { COOKIES } from '../../middleware/auth.js';
import { deliver, templates } from '../../notify/index.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_TTL_MIN = 30;
const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
/** Roles that must use 2-step sign-in when the hospital turns it on in Settings. */
const MFA_ROLES = ['owner', 'hospital_admin'];

// ───────── 2-step sign-in (e-mail one-time code) ─────────
const otpHash = (challengeId, code) => sha256Hex(`${challengeId}:${code}`);

/** Creates a challenge, e-mails the code, returns what the browser needs (never the code). */
async function startChallenge({ subjectType, subjectId, tenantId = null, email, name, ip }) {
  const challengeId = randomUUID();
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  await db.exec(`INSERT INTO hms.LoginChallenges (ChallengeId, SubjectType, SubjectId, TenantId, CodeHash, ExpiresAt, IpAddress)
                 VALUES (@cid, @type, @sid, @tid, @hash, DATEADD(MINUTE, ${OTP_TTL_MIN}, SYSUTCDATETIME()), @ip)`,
  { cid: challengeId, type: subjectType, sid: subjectId, tid: tenantId, hash: otpHash(challengeId, code), ip: ip ?? null });
  const sent = await deliver({ channel: 'email', to: email, template: 'login_otp', tenantId,
    content: templates.email.loginOtp({ name, code, minutes: OTP_TTL_MIN }), related: { type: subjectType === 'tenant' ? 'user' : 'platform_user', id: subjectId } });
  if (sent.status === 'failed' || sent.status === 'skipped') {
    throw new HttpError(503, 'OTP_NOT_SENT', 'We could not send your sign-in code. Try again in a minute or contact your administrator.');
  }
  return { mfaRequired: true, challengeId, sentTo: sent.masked, expiresInMinutes: OTP_TTL_MIN };
}

/** Checks a code; returns { subjectId, tenantId } once, or throws. Wrong codes count towards a limit. */
async function consumeChallenge({ subjectType, challengeId, code }) {
  return withTransaction(async (tx) => {
    const c = await tx.one(`/* tenant-safe: looked up by secret challenge id */ SELECT * FROM hms.LoginChallenges WITH (UPDLOCK, ROWLOCK) WHERE ChallengeId = @cid AND SubjectType = @type`,
      { cid: challengeId, type: subjectType });
    const invalid = () => unauthorized('This code is wrong or has expired. Sign in again to get a new code.');
    if (!c || c.ConsumedAt || new Date(c.ExpiresAt) < new Date() || c.Attempts >= OTP_MAX_ATTEMPTS) throw invalid();
    if (!safeEqual(c.CodeHash, otpHash(challengeId, String(code).trim()))) {
      await tx.exec('UPDATE hms.LoginChallenges SET Attempts = Attempts + 1 WHERE ChallengeId = @cid', { cid: challengeId });
      return null;
    }
    await tx.exec('UPDATE hms.LoginChallenges SET ConsumedAt = SYSUTCDATETIME() WHERE ChallengeId = @cid', { cid: challengeId });
    return { subjectId: c.SubjectId, tenantId: c.TenantId };
  }).then((r) => { if (!r) throw unauthorized('Incorrect code. Please check the e-mail and try again.'); return r; });
}

async function tenantNeedsMfa(tenantId, userId) {
  const r = await db.one(`SELECT
      (SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = @tid AND SettingKey = 'security.mfa_admins') AS setting,
      (SELECT COUNT(*) FROM hms.UserRoles ur JOIN hms.Roles r ON r.TenantId = ur.TenantId AND r.RoleId = ur.RoleId
        WHERE ur.TenantId = @tid AND ur.UserId = @uid AND r.Code IN ('${MFA_ROLES.join("','")}')) AS adminRoles`, { tid: tenantId, uid: userId });
  return r?.setting === 'on' && r.adminRoles > 0;
}

const kindCookies = (kind) => (kind === 'platform'
  ? { access: COOKIES.adminAccess, refresh: COOKIES.adminRefresh }
  : { access: COOKIES.tenantAccess, refresh: COOKIES.tenantRefresh });

function cookieBase() {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', domain: config.cookieDomain };
}

export function setAuthCookies(res, kind, { accessToken, refreshToken }) {
  const names = kindCookies(kind);
  res.cookie(names.access, accessToken, { ...cookieBase(), path: '/api', maxAge: config.accessTokenTtlSec * 1000 });
  res.cookie(names.refresh, refreshToken, { ...cookieBase(), path: '/api/v1/auth', maxAge: config.refreshTokenTtlDays * 86400000 });
}

export function clearAuthCookies(res, kind) {
  const names = kindCookies(kind);
  res.clearCookie(names.access, { ...cookieBase(), path: '/api' });
  res.clearCookie(names.refresh, { ...cookieBase(), path: '/api/v1/auth' });
}

export const readRefreshCookie = (req, kind) => req.cookies?.[kindCookies(kind).refresh];

/** Creates a server-side session and returns access + refresh tokens. */
export async function createSession({ subjectType, subjectId, tenantId = null, userAgent, ip }, runner = db) {
  const sessionId = randomUUID();
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86400000);
  await runner.exec(
    `INSERT INTO hms.UserSessions (SessionId, SubjectType, SubjectId, TenantId, RefreshTokenHash, ExpiresAt, UserAgent, IpAddress)
     VALUES (@sid, @type, @subject, @tid, @hash, @exp, @ua, @ip)`,
    { sid: sessionId, type: subjectType, subject: subjectId, tid: tenantId, hash: sha256Hex(refreshToken), exp: expiresAt, ua: userAgent?.slice(0, 300) ?? null, ip },
  );
  const accessToken = signJwt(
    { sub: String(subjectId), typ: subjectType, sid: sessionId, ...(tenantId ? { tid: tenantId } : {}) },
    config.jwtSecret, config.accessTokenTtlSec,
  );
  return { sessionId, accessToken, refreshToken };
}

/** Rotates a refresh token: the old one is revoked, a new pair is issued. Reuse of a revoked token revokes all sessions. */
export async function refreshSession(kind, refreshToken, meta) {
  if (!refreshToken) throw unauthorized();
  const hash = sha256Hex(refreshToken);
  return withTransaction(async (tx) => {
    const s = await tx.one(
      `SELECT SessionId, SubjectType, SubjectId, TenantId, ExpiresAt, RevokedAt
       FROM hms.UserSessions WITH (UPDLOCK, ROWLOCK) WHERE RefreshTokenHash = @hash`, { hash });
    if (!s || s.SubjectType !== kind) throw unauthorized();
    if (s.RevokedAt) {
      // Token reuse → likely theft. Revoke every session of this subject.
      await tx.exec(`/* tenant-safe: user ids are globally unique */ UPDATE hms.UserSessions SET RevokedAt = SYSUTCDATETIME()
                     WHERE SubjectType = @type AND SubjectId = @id AND RevokedAt IS NULL`, { type: s.SubjectType, id: s.SubjectId });
      await audit({ tenantId: s.TenantId, actorType: kind, actorId: s.SubjectId, action: 'auth.refresh_reuse_detected', ip: meta.ip }, tx);
      throw unauthorized('Session expired. Please sign in again.');
    }
    if (new Date(s.ExpiresAt) <= new Date()) throw unauthorized('Session expired. Please sign in again.');

    // Re-check that the subject is still allowed to have a session.
    if (kind === 'tenant') {
      const ok = await tx.one(`SELECT 1 AS ok FROM hms.Users u JOIN hms.Tenants t ON t.TenantId = u.TenantId
                               WHERE u.UserId = @id AND u.TenantId = @tid AND u.Status = 'active'
                                 AND t.Status IN ('active','suspended')`, { id: s.SubjectId, tid: s.TenantId });
      if (!ok) throw unauthorized();
    } else {
      const ok = await tx.one(`SELECT 1 AS ok FROM hms.PlatformUsers WHERE PlatformUserId = @id AND Status = 'active'`, { id: s.SubjectId });
      if (!ok) throw unauthorized();
    }

    await tx.exec('UPDATE hms.UserSessions SET RevokedAt = SYSUTCDATETIME(), LastUsedAt = SYSUTCDATETIME() WHERE SessionId = @sid', { sid: s.SessionId });
    return createSession({ subjectType: kind, subjectId: s.SubjectId, tenantId: s.TenantId, userAgent: meta.userAgent, ip: meta.ip }, tx);
  });
}

export async function revokeByRefreshToken(refreshToken) {
  if (!refreshToken) return;
  await db.exec('UPDATE hms.UserSessions SET RevokedAt = SYSUTCDATETIME() WHERE RefreshTokenHash = @hash AND RevokedAt IS NULL',
    { hash: sha256Hex(refreshToken) });
}

export async function revokeSession(sessionId) {
  await db.exec('UPDATE hms.UserSessions SET RevokedAt = SYSUTCDATETIME() WHERE SessionId = @sid AND RevokedAt IS NULL', { sid: sessionId });
}

async function registerFailure(table, idCol, id) {
  await db.exec(
    `UPDATE hms.${table}
     SET FailedLoginCount = FailedLoginCount + 1,
         LockedUntil = CASE WHEN FailedLoginCount + 1 >= ${MAX_FAILED} THEN DATEADD(MINUTE, ${LOCK_MINUTES}, SYSUTCDATETIME()) ELSE LockedUntil END
     WHERE ${idCol} = @id`, { id });
}

/**
 * Hospital user login. Tenant comes from (in order): subdomain, explicit workspace slug,
 * or — when the e-mail exists in exactly one hospital — that hospital.
 */
export async function tenantLogin({ email, password, workspace }, { hostSlug, ip, userAgent }) {
  const slug = hostSlug || workspace || null;
  const candidates = await db.query(
    `SELECT u.UserId, u.TenantId, u.Email, u.FullName, u.PasswordHash, u.Status, u.LockedUntil, t.Slug, t.Name AS TenantName, t.Status AS TenantStatus
     FROM hms.Users u JOIN hms.Tenants t ON t.TenantId = u.TenantId
     WHERE u.Email = @email AND (@slug IS NULL OR t.Slug = @slug)`,
    { email: email.toLowerCase(), slug },
  );
  if (candidates.length > 1) {
    throw new HttpError(409, 'WORKSPACE_REQUIRED', 'This e-mail is registered with more than one hospital. Enter your hospital workspace name.');
  }
  const user = candidates[0];
  const valid = await verifyPassword(password, user?.PasswordHash);
  if (user?.LockedUntil && new Date(user.LockedUntil) > new Date()) {
    throw new HttpError(429, 'LOCKED', 'Too many failed attempts. Try again in a few minutes.');
  }
  if (!user || !valid) {
    if (user) {
      await registerFailure('Users', 'UserId', user.UserId);
      await audit({ tenantId: user.TenantId, actorType: 'tenant', actorId: user.UserId, action: 'auth.login_failed', ip });
    }
    throw unauthorized('Incorrect e-mail, password or workspace.');
  }
  if (user.Status !== 'active') throw unauthorized('This account is disabled. Contact your hospital administrator.');
  if (user.TenantStatus === 'pending' || user.TenantStatus === 'deactivated') {
    throw new HttpError(403, 'TENANT_INACTIVE', 'This hospital workspace is not active.');
  }

  if (await tenantNeedsMfa(user.TenantId, user.UserId)) {
    await audit({ tenantId: user.TenantId, actorType: 'tenant', actorId: user.UserId, action: 'auth.otp_sent', ip });
    return startChallenge({ subjectType: 'tenant', subjectId: user.UserId, tenantId: user.TenantId, email: user.Email, name: user.FullName, ip });
  }
  return completeTenantLogin(user.UserId, user.TenantId, { ip, userAgent });
}

async function completeTenantLogin(userId, tenantId, { ip, userAgent }) {
  const u = await db.one(`SELECT u.Status, t.Slug, t.Name AS TenantName FROM hms.Users u JOIN hms.Tenants t ON t.TenantId = u.TenantId
                          WHERE u.UserId = @id AND u.TenantId = @tid`, { id: userId, tid: tenantId });
  if (!u || u.Status !== 'active') throw unauthorized('This account is disabled. Contact your hospital administrator.');
  await db.exec('UPDATE hms.Users SET FailedLoginCount = 0, LockedUntil = NULL, LastLoginAt = SYSUTCDATETIME() WHERE UserId = @id AND TenantId = @tid',
    { id: userId, tid: tenantId });
  const session = await createSession({ subjectType: 'tenant', subjectId: userId, tenantId, userAgent, ip });
  await audit({ tenantId, actorType: 'tenant', actorId: userId, action: 'auth.login', ip });
  return { ...session, tenant: { slug: u.Slug, name: u.TenantName } };
}

/** Second step of hospital sign-in. */
export async function verifyTenantLogin({ challengeId, code }, { ip, userAgent }) {
  const { subjectId, tenantId } = await consumeChallenge({ subjectType: 'tenant', challengeId, code });
  return completeTenantLogin(subjectId, tenantId, { ip, userAgent });
}

export async function platformLogin({ email, password }, { ip, userAgent }) {
  const user = await db.one('SELECT PlatformUserId, PasswordHash, Status, LockedUntil FROM hms.PlatformUsers WHERE Email = @email',
    { email: email.toLowerCase() });
  const valid = await verifyPassword(password, user?.PasswordHash);
  if (user?.LockedUntil && new Date(user.LockedUntil) > new Date()) {
    throw new HttpError(429, 'LOCKED', 'Too many failed attempts. Try again in a few minutes.');
  }
  if (!user || !valid || user.Status !== 'active') {
    if (user) await registerFailure('PlatformUsers', 'PlatformUserId', user.PlatformUserId);
    await audit({ actorType: 'public', action: 'admin.login_failed', metadata: { email: email.toLowerCase() }, ip });
    throw unauthorized('Incorrect e-mail or password.');
  }
  if (config.superAdminMfa) {
    const pu = await db.one('SELECT Email, FullName FROM hms.PlatformUsers WHERE PlatformUserId = @id', { id: user.PlatformUserId });
    return startChallenge({ subjectType: 'platform', subjectId: user.PlatformUserId, email: pu.Email, name: pu.FullName, ip });
  }
  return completePlatformLogin(user.PlatformUserId, { ip, userAgent });
}

async function completePlatformLogin(platformUserId, { ip, userAgent }) {
  await db.exec('UPDATE hms.PlatformUsers SET FailedLoginCount = 0, LockedUntil = NULL, LastLoginAt = SYSUTCDATETIME() WHERE PlatformUserId = @id',
    { id: platformUserId });
  const session = await createSession({ subjectType: 'platform', subjectId: platformUserId, userAgent, ip });
  await audit({ actorType: 'platform', actorId: platformUserId, action: 'admin.login', ip });
  return session;
}

export async function verifyPlatformLogin({ challengeId, code }, { ip, userAgent }) {
  const { subjectId } = await consumeChallenge({ subjectType: 'platform', challengeId, code });
  const ok = await db.one(`SELECT 1 AS ok FROM hms.PlatformUsers WHERE PlatformUserId = @id AND Status = 'active'`, { id: subjectId });
  if (!ok) throw unauthorized('This account is disabled.');
  return completePlatformLogin(subjectId, { ip, userAgent });
}

/**
 * Creates a single-use reset token. Always returns silently (no account enumeration).
 * The link is e-mailed (in EMAIL_PROVIDER=log mode it is printed to the server log in development).
 */
export async function requestPasswordReset({ email, workspace }, { ip }) {
  const user = await db.one(
    `SELECT TOP 1 u.UserId, u.TenantId, u.Email, u.FullName FROM hms.Users u JOIN hms.Tenants t ON t.TenantId = u.TenantId
     WHERE u.Email = @email AND u.Status = 'active' AND (@slug IS NULL OR t.Slug = @slug)`,
    { email: email.toLowerCase(), slug: workspace || null });
  if (!user) return;
  const token = randomToken(32);
  await db.exec(
    `INSERT INTO hms.PasswordResetTokens (SubjectType, SubjectId, TokenHash, ExpiresAt)
     VALUES ('tenant', @id, @hash, DATEADD(MINUTE, ${RESET_TTL_MIN}, SYSUTCDATETIME()))`,
    { id: user.UserId, hash: sha256Hex(token) });
  await audit({ tenantId: user.TenantId, actorType: 'tenant', actorId: user.UserId, action: 'auth.password_reset_requested', ip });
  const link = `${config.publicAppUrl}/reset-password?token=${token}`;
  // Sent in the background so response time does not reveal whether the account exists.
  deliver({ channel: 'email', to: user.Email, template: 'password_reset', tenantId: user.TenantId, related: { type: 'user', id: user.UserId },
    content: templates.email.passwordReset({ name: user.FullName, link, minutes: RESET_TTL_MIN }) })
    .catch((e) => console.error('[auth] reset e-mail failed:', e.message));
}

export async function resetPassword({ token, password }, { ip }) {
  const problem = passwordProblem(password);
  if (problem) throw badRequest(problem);
  const hash = await hashPassword(password);
  await withTransaction(async (tx) => {
    const row = await tx.one(
      `SELECT TokenId, SubjectId FROM hms.PasswordResetTokens WITH (UPDLOCK, ROWLOCK)
       WHERE TokenHash = @h AND SubjectType = 'tenant' AND UsedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()`,
      { h: sha256Hex(token) });
    if (!row) throw badRequest('This reset link is invalid or has expired.');
    await tx.exec('UPDATE hms.PasswordResetTokens SET UsedAt = SYSUTCDATETIME() WHERE TokenId = @id', { id: row.TokenId });
    const u = await tx.one('SELECT TenantId FROM hms.Users WHERE UserId = @id', { id: row.SubjectId });
    await tx.exec('UPDATE hms.Users SET PasswordHash = @hash, FailedLoginCount = 0, LockedUntil = NULL, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @id',
      { hash, id: row.SubjectId });
    // Sign out everywhere after a reset.
    await tx.exec(`/* tenant-safe: user ids are globally unique */ UPDATE hms.UserSessions SET RevokedAt = SYSUTCDATETIME()
                   WHERE SubjectType = 'tenant' AND SubjectId = @id AND RevokedAt IS NULL`, { id: row.SubjectId });
    await audit({ tenantId: u?.TenantId, actorType: 'tenant', actorId: row.SubjectId, action: 'auth.password_reset', ip }, tx);
  });
}
