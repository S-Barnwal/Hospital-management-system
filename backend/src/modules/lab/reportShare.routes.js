// Public, unauthenticated patient access to a VERIFIED lab report:
//   link (random 256-bit token, stored hashed, expires) + one-time code sent to the patient's phone/e-mail.
// Responses never reveal whether a token exists beyond "invalid or expired", and contain no contact details.
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { randomInt } from 'node:crypto';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, HttpError, notFound } from '../../utils/errors.js';
import { db, withTransaction } from '../../db/pool.js';
import { sha256Hex, safeEqual } from '../../utils/crypto.js';
import { audit } from '../../utils/audit.js';
import { deliver, templates } from '../../notify/index.js';
import { maskEmail, maskPhone } from '../../notify/format.js';
import { loadVerifiedReport } from './report.service.js';

const router = Router();
const OTP_TTL_MIN = 10;
const MAX_OTP_SENDS = 5;
const MAX_OTP_ATTEMPTS = 5;

router.use(rateLimit({
  windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes.' } },
}));

const tokenParam = z.string().regex(/^[A-Za-z0-9_-]{40,60}$/);
const gone = () => notFound('This link is invalid or has expired. Please ask the hospital to send it again.');

async function findShare(token, runner = db, lock = false) {
  if (!tokenParam.safeParse(token).success) throw gone();
  const s = await runner.one(`
    SELECT rs.*, p.Phone, p.Email, t.Name AS HospitalName, t.Status AS TenantStatus
    FROM hms.ReportShares rs ${lock ? 'WITH (UPDLOCK, ROWLOCK)' : ''}
    JOIN hms.LabOrders o ON o.TenantId = rs.TenantId AND o.LabOrderId = rs.LabOrderId
    JOIN hms.Patients p ON p.TenantId = o.TenantId AND p.PatientId = o.PatientId
    JOIN hms.Tenants t ON t.TenantId = rs.TenantId
    WHERE rs.TokenHash = @h`, { h: sha256Hex(token) });
  if (!s || s.RevokedAt || new Date(s.ExpiresAt) < new Date() || s.TenantStatus !== 'active') throw gone();
  return s;
}
const destination = (s) => (s.Channel === 'email' ? s.Email : s.Phone);
const masked = (s) => (s.Channel === 'email' ? maskEmail(s.Email) : maskPhone(s.Phone));
const otpHash = (shareId, code) => sha256Hex(`report:${shareId}:${code}`);

router.get('/:token', asyncHandler(async (req, res) => {
  const s = await findShare(req.params.token);
  res.json({ data: { hospital: s.HospitalName, channel: s.Channel, sentTo: masked(s), expiresAt: s.ExpiresAt } });
}));

router.post('/:token/otp', asyncHandler(async (req, res) => {
  const { share, code } = await withTransaction(async (tx) => {
    const s = await findShare(req.params.token, tx, true);
    if (s.OtpSends >= MAX_OTP_SENDS) throw new HttpError(429, 'TOO_MANY_CODES', 'Too many codes requested for this link. Please contact the hospital.');
    const c = String(randomInt(0, 1000000)).padStart(6, '0');
    await tx.exec(`/* tenant-safe: row was located by its secret token hash */ UPDATE hms.ReportShares SET OtpHash = @h, OtpExpiresAt = DATEADD(MINUTE, ${OTP_TTL_MIN}, SYSUTCDATETIME()), OtpAttempts = 0, OtpSends = OtpSends + 1
                   WHERE ShareId = @id`, { id: s.ShareId, h: otpHash(s.ShareId, c) });
    return { share: s, code: c };
  });
  const content = share.Channel === 'email'
    ? templates.email.reportOtp({ hospital: share.HospitalName, code, minutes: OTP_TTL_MIN })
    : templates.whatsapp.reportOtp({ hospital: share.HospitalName, code });
  const r = await deliver({ channel: share.Channel, to: destination(share), template: 'report_otp', content, tenantId: share.TenantId, related: { type: 'lab_order', id: share.LabOrderId } });
  if (r.status === 'failed' || r.status === 'skipped') throw new HttpError(503, 'OTP_NOT_SENT', 'We could not send the code right now. Please try again or contact the hospital.');
  res.json({ data: { sentTo: r.masked, expiresInMinutes: OTP_TTL_MIN } });
}));

router.post('/:token/view', validate(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') }).strict()),
  asyncHandler(async (req, res) => {
    const share = await withTransaction(async (tx) => {
      const s = await findShare(req.params.token, tx, true);
      const expired = !s.OtpHash || !s.OtpExpiresAt || new Date(s.OtpExpiresAt) < new Date() || s.OtpAttempts >= MAX_OTP_ATTEMPTS;
      if (expired) return { error: 'This code has expired. Request a new code.' };
      if (!safeEqual(s.OtpHash, otpHash(s.ShareId, req.body.code))) {
        await tx.exec('UPDATE hms.ReportShares SET OtpAttempts = OtpAttempts + 1 WHERE ShareId = @id', { id: s.ShareId });
        return { error: 'Incorrect code. Please check and try again.' };
      }
      // Codes are single-use.
      await tx.exec(`/* tenant-safe: row was located by its secret token hash */ UPDATE hms.ReportShares SET OtpHash = NULL, OtpExpiresAt = NULL, AccessCount = AccessCount + 1, LastAccessAt = SYSUTCDATETIME()
                     WHERE ShareId = @id`, { id: s.ShareId });
      return s;
    });
    if (share.error) throw new HttpError(401, 'INVALID_CODE', share.error);
    const report = await loadVerifiedReport(share.TenantId, share.LabOrderId);
    if (!report) throw gone();
    await audit({ tenantId: share.TenantId, actorType: 'public', action: 'lab_report.viewed_by_patient', entityType: 'lab_order', entityId: share.LabOrderId, ip: req.ip });
    res.set('Cache-Control', 'no-store');
    res.json({ data: report });
  }));

export default router;
