import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { db } from '../../db/pool.js';
import { asyncHandler } from '../../utils/errors.js';
import { requireTenant, requirePlatformAdmin } from '../../middleware/auth.js';
import {
  tenantLogin, platformLogin, setAuthCookies, clearAuthCookies, readRefreshCookie,
  refreshSession, revokeByRefreshToken, requestPasswordReset, resetPassword,
} from './auth.service.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } },
});

const email = z.string().trim().toLowerCase().email().max(254);
const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  workspace: z.string().trim().toLowerCase().max(63).optional().or(z.literal('').transform(() => undefined)),
}).strict();

const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent'), hostSlug: req.hostSlug });

// ---- Hospital users ----
router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const result = await tenantLogin(req.body, meta(req));
  setAuthCookies(res, 'tenant', result);
  res.json({ data: { tenant: result.tenant } });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  try {
    const result = await refreshSession('tenant', readRefreshCookie(req, 'tenant'), meta(req));
    setAuthCookies(res, 'tenant', result);
    res.json({ data: { ok: true } });
  } catch (err) {
    clearAuthCookies(res, 'tenant');
    throw err;
  }
}));

router.post('/logout', asyncHandler(async (req, res) => {
  await revokeByRefreshToken(readRefreshCookie(req, 'tenant'));
  clearAuthCookies(res, 'tenant');
  res.json({ data: { ok: true } });
}));

router.post('/logout-all', requireTenant, asyncHandler(async (req, res) => {
  await db.exec(`UPDATE dbo.UserSessions SET RevokedAt = SYSUTCDATETIME()
                 WHERE SubjectType = 'tenant' AND SubjectId = @uid AND TenantId = @tid AND RevokedAt IS NULL`,
  { uid: req.ctx.userId, tid: req.ctx.tenantId });
  clearAuthCookies(res, 'tenant');
  res.json({ data: { ok: true } });
}));

router.post('/forgot-password', loginLimiter,
  validate(z.object({ email, workspace: z.string().trim().toLowerCase().max(63).optional() }).strict()),
  asyncHandler(async (req, res) => {
    await requestPasswordReset(req.body, meta(req));
    res.json({ data: { message: 'If an account exists for that e-mail, a reset link has been sent.' } });
  }));

router.post('/reset-password', loginLimiter,
  validate(z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(128) }).strict()),
  asyncHandler(async (req, res) => {
    await resetPassword(req.body, meta(req));
    res.json({ data: { message: 'Password updated. Please sign in.' } });
  }));

// ---- Platform Super Admin (separate cookies & token type) ----
router.post('/admin/login', loginLimiter, validate(loginSchema.omit({ workspace: true })), asyncHandler(async (req, res) => {
  const result = await platformLogin(req.body, meta(req));
  setAuthCookies(res, 'platform', result);
  res.json({ data: { ok: true } });
}));

router.post('/admin/refresh', asyncHandler(async (req, res) => {
  try {
    const result = await refreshSession('platform', readRefreshCookie(req, 'platform'), meta(req));
    setAuthCookies(res, 'platform', result);
    res.json({ data: { ok: true } });
  } catch (err) {
    clearAuthCookies(res, 'platform');
    throw err;
  }
}));

router.post('/admin/logout', asyncHandler(async (req, res) => {
  await revokeByRefreshToken(readRefreshCookie(req, 'platform'));
  clearAuthCookies(res, 'platform');
  res.json({ data: { ok: true } });
}));

router.get('/admin/me', requirePlatformAdmin, (req, res) => res.json({ data: req.admin }));

export default router;
