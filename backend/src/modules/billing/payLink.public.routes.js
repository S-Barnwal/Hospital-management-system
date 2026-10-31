// Public bill payment page (no login): the patient opens the link and pays by UPI to the HOSPITAL's own UPI ID.
// The link is a random 256-bit token stored only as a hash; it expires, can be revoked and shows only what is needed
// to pay: hospital name, bill number, date and amount due — no diagnosis, items or contact details.
// Payment is confirmed by the hospital (UTR / UPI reference) when it records the receipt — MediCore never holds money.
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler, notFound } from '../../utils/errors.js';
import { db } from '../../db/pool.js';
import { sha256Hex } from '../../utils/crypto.js';
import { balanceDue } from '../clinical/logic.js';
import { upiUri, UPI_ID_RE } from '../clinical/phase2.logic.js';

const router = Router();
router.use(rateLimit({
  windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a few minutes.' } },
}));

const tokenParam = z.string().regex(/^[A-Za-z0-9_-]{40,60}$/);
const gone = () => notFound('This payment link is invalid or has expired. Please ask the hospital for a new one.');

router.get('/:token', asyncHandler(async (req, res) => {
  if (!tokenParam.safeParse(req.params.token).success) throw gone();
  const r = await db.one(`
    /* tenant-safe: found by secret token; TenantId is taken from the link row itself */
    SELECT l.LinkId, l.TenantId, l.ExpiresAt, l.RevokedAt, b.BillNumber, b.Status, b.Total, b.PaidAmount, b.FinalizedAt, p.FirstName,
           t.Name AS HospitalName, t.Status AS TenantStatus, t.City,
           (SELECT SettingValue FROM hms.TenantSettings s WHERE s.TenantId = l.TenantId AND s.SettingKey = 'payment.upi_id') AS UpiId,
           (SELECT SettingValue FROM hms.TenantSettings s WHERE s.TenantId = l.TenantId AND s.SettingKey = 'payment.upi_name') AS UpiName
    FROM hms.BillPaymentLinks l
    JOIN hms.Bills b ON b.TenantId = l.TenantId AND b.BillId = l.BillId
    JOIN hms.Patients p ON p.TenantId = b.TenantId AND p.PatientId = b.PatientId
    JOIN hms.Tenants t ON t.TenantId = l.TenantId
    WHERE l.TokenHash = @h`, { h: sha256Hex(req.params.token) });
  if (!r || r.RevokedAt || new Date(r.ExpiresAt) < new Date() || r.TenantStatus !== 'active' || r.Status === 'cancelled') throw gone();
  await db.exec('UPDATE hms.BillPaymentLinks SET ViewCount = ViewCount + 1, LastViewedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND LinkId = @id', { tid: r.TenantId, id: r.LinkId });
  const due = balanceDue(Number(r.Total), Number(r.PaidAmount));
  const payable = Number(due) > 0 && r.UpiId && UPI_ID_RE.test(r.UpiId);
  res.set('Cache-Control', 'no-store');
  res.json({ data: {
    hospital: r.HospitalName, city: r.City, billNumber: r.BillNumber, billDate: r.FinalizedAt, patientFirstName: r.FirstName,
    total: Number(r.Total).toFixed(2), paid: Number(r.PaidAmount).toFixed(2), due, status: Number(due) > 0 ? 'due' : 'paid',
    payee: payable ? { upiId: r.UpiId, name: r.UpiName || r.HospitalName } : null,
    upiUri: payable ? upiUri({ upiId: r.UpiId, payeeName: r.UpiName || r.HospitalName, amount: due, note: r.BillNumber }) : null,
    expiresAt: r.ExpiresAt,
  } });
}));

export default router;
