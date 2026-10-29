import { randomUUID } from 'node:crypto';
import { config } from '../../config/env.js';
import { db, withTransaction } from '../../db/pool.js';
import { signJwt } from '../../utils/jwt.js';
import { randomToken, sha256Hex } from '../../utils/crypto.js';
import { verifyPassword, hashPassword, passwordProblem } from '../../utils/password.js';
import { badRequest, unauthorized, HttpError } from '../../utils/errors.js';
import { audit } from '../../utils/audit.js';
import { COOKIES } from '../../middleware/auth.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_TTL_MIN = 30;

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
      await tx.exec(`UPDATE hms.UserSessions SET RevokedAt = SYSUTCDATETIME()
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
    `SELECT u.UserId, u.TenantId, u.PasswordHash, u.Status, u.LockedUntil, t.Slug, t.Name AS TenantName, t.Status AS TenantStatus
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

  await db.exec('UPDATE hms.Users SET FailedLoginCount = 0, LockedUntil = NULL, LastLoginAt = SYSUTCDATETIME() WHERE UserId = @id AND TenantId = @tid',
    { id: user.UserId, tid: user.TenantId });
  const session = await createSession({ subjectType: 'tenant', subjectId: user.UserId, tenantId: user.TenantId, userAgent, ip });
  await audit({ tenantId: user.TenantId, actorType: 'tenant', actorId: user.UserId, action: 'auth.login', ip });
  return { ...session, tenant: { slug: user.Slug, name: user.TenantName } };
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
  await db.exec('UPDATE hms.PlatformUsers SET FailedLoginCount = 0, LockedUntil = NULL, LastLoginAt = SYSUTCDATETIME() WHERE PlatformUserId = @id',
    { id: user.PlatformUserId });
  const session = await createSession({ subjectType: 'platform', subjectId: user.PlatformUserId, userAgent, ip });
  await audit({ actorType: 'platform', actorId: user.PlatformUserId, action: 'admin.login', ip });
  return session;
}

/**
 * Creates a single-use reset token. Always returns silently (no account enumeration).
 * E-mail delivery is a pending integration: in development the link is printed to the server log.
 */
export async function requestPasswordReset({ email, workspace }, { ip }) {
  const user = await db.one(
    `SELECT TOP 1 u.UserId, u.TenantId FROM hms.Users u JOIN hms.Tenants t ON t.TenantId = u.TenantId
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
  if (!config.isProd) console.log(`[dev] Password reset link (e-mail integration pending): ${link}`);
  // TODO(integration): send `link` via the configured e-mail provider.
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
    await tx.exec(`UPDATE hms.UserSessions SET RevokedAt = SYSUTCDATETIME()
                   WHERE SubjectType = 'tenant' AND SubjectId = @id AND RevokedAt IS NULL`, { id: row.SubjectId });
    await audit({ tenantId: u?.TenantId, actorType: 'tenant', actorId: row.SubjectId, action: 'auth.password_reset', ip }, tx);
  });
}
