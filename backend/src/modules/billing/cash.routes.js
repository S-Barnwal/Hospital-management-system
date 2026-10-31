// Patient advance deposits, UPI payment links for bills, and cash closing (end of shift / day).
// Money rules: every movement is a new row (never edited); balances are computed from rows under row locks.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { ensureTenant, requirePermission, requireAnyPermission, requireFeature } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound, HttpError } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { auditTenant } from '../../utils/audit.js';
import { config } from '../../config/env.js';
import { randomToken, sha256Hex } from '../../utils/crypto.js';
import { deliver, templates } from '../../notify/index.js';
import { localDayRangeUtc, localDateString } from '../../utils/time.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';
import { recordBillPayment, lockBill } from './billing.service.js';
import { depositBalance, cashSummary, denominationTotal, UPI_ID_RE } from '../clinical/phase2.logic.js';
import { balanceDue } from '../clinical/logic.js';

const router = Router();
router.use(ensureTenant, requireFeature('billing'));

const money = z.coerce.number().positive('Amount must be more than zero.').max(1e9).transform((v) => Number(v.toFixed(2)));
const METHOD = z.enum(['cash', 'card', 'upi', 'bank', 'other']);

// ---------- Deposits ----------
async function lockedBalance(tx, tenantId, patientId) {
  const rows = await tx.query('SELECT Kind, Amount FROM hms.PatientDeposits WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid AND PatientId = @pid', { tid: tenantId, pid: patientId });
  return Number(depositBalance(rows));
}

router.get('/deposits', requirePermission('billing.read'), asyncHandler(async (req, res) => {
  const patientId = req.query.patientId ? idParam(req.query.patientId, 'patientId') : null;
  if (patientId) {
    const rows = await db.query(`
      SELECT d.DepositId AS id, d.Kind AS kind, d.Amount AS amount, d.Method AS method, d.Reference AS reference, d.ReceiptNumber AS receiptNumber,
             d.BillId AS billId, b.BillNumber AS billNumber, d.AdmissionId AS admissionId, d.Reason AS reason, d.CreatedAt AS createdAt, u.FullName AS createdBy
      FROM hms.PatientDeposits d
      LEFT JOIN hms.Bills b ON b.TenantId = d.TenantId AND b.BillId = d.BillId
      LEFT JOIN hms.Users u ON u.TenantId = d.TenantId AND u.UserId = d.CreatedByUserId
      WHERE d.TenantId = @tid AND d.PatientId = @pid ORDER BY d.CreatedAt DESC`, { tid: req.ctx.tenantId, pid: patientId });
    return res.json({ data: rows, meta: { balance: depositBalance(rows.map((r) => ({ Kind: r.kind, Amount: r.amount }))) } });
  }
  // Without a patient: everyone holding money on account.
  const rows = await db.query(`
    SELECT TOP 200 p.PatientId AS patientId, p.PatientNumber AS patientNumber, p.FirstName AS patientFirstName, p.LastName AS patientLastName,
           SUM(CASE WHEN d.Kind = 'deposit' THEN d.Amount ELSE -d.Amount END) AS balance, MAX(d.CreatedAt) AS lastActivity
    FROM hms.PatientDeposits d JOIN hms.Patients p ON p.TenantId = d.TenantId AND p.PatientId = d.PatientId
    WHERE d.TenantId = @tid GROUP BY p.PatientId, p.PatientNumber, p.FirstName, p.LastName
    HAVING SUM(CASE WHEN d.Kind = 'deposit' THEN d.Amount ELSE -d.Amount END) > 0 ORDER BY lastActivity DESC`, { tid: req.ctx.tenantId });
  return res.json({ data: rows, meta: { total: rows.reduce((s, r) => s + Number(r.balance), 0).toFixed(2) } });
}));

router.post('/deposits', requirePermission('billing.write'),
  validate(z.object({ patientId: z.coerce.number().int().positive(), admissionId: z.coerce.number().int().positive().optional(), amount: money, method: METHOD,
    reference: z.string().trim().max(100).optional() }).strict()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const out = await withTransaction(async (tx) => {
      const p = await tx.one('SELECT PatientId FROM hms.Patients WHERE TenantId = @tid AND PatientId = @id AND IsArchived = 0', { tid: req.ctx.tenantId, id: b.patientId });
      if (!p) throw badRequest('Patient not found.');
      if (b.admissionId) {
        const a = await tx.one('SELECT AdmissionId FROM hms.Admissions WHERE TenantId = @tid AND AdmissionId = @id AND PatientId = @pid', { tid: req.ctx.tenantId, id: b.admissionId, pid: b.patientId });
        if (!a) throw badRequest('Admission does not belong to this patient.');
      }
      const receipt = formatNumber('ADV', await nextSequence(tx, req.ctx.tenantId, 'deposit'));
      await tx.exec(`INSERT INTO hms.PatientDeposits (TenantId, PatientId, AdmissionId, Kind, Amount, Method, Reference, ReceiptNumber, CreatedByUserId)
                     VALUES (@tid, @pid, @aid, 'deposit', @amt, @m, @ref, @rc, @uid)`,
      { tid: req.ctx.tenantId, pid: b.patientId, aid: b.admissionId ?? null, amt: t.money(b.amount.toFixed(2)), m: b.method, ref: b.reference ?? null, rc: receipt, uid: req.ctx.userId });
      const balance = await lockedBalance(tx, req.ctx.tenantId, b.patientId);
      await auditTenant(req, 'deposit.received', 'patient', b.patientId, { receipt, amount: b.amount, method: b.method }, tx);
      return { receipt, balance };
    });
    res.status(201).json({ data: { receiptNumber: out.receipt, balance: out.balance.toFixed(2) } });
  }));

/** Uses the patient's deposit to pay a finalised bill (up to the smaller of balance due and deposit balance). */
router.post('/deposits/apply', requirePermission('billing.write'),
  validate(z.object({ billId: z.coerce.number().int().positive(), amount: money.optional() }).strict()),
  asyncHandler(async (req, res) => {
    const out = await withTransaction(async (tx) => {
      const bill = await lockBill(tx, req.ctx.tenantId, req.body.billId);
      if (bill.Status !== 'finalized') throw conflict('Finalise the bill before using the deposit.', 'BILL_STATE');
      const due = Number(balanceDue(Number(bill.Total), Number(bill.PaidAmount)));
      const available = await lockedBalance(tx, req.ctx.tenantId, bill.PatientId);
      if (due <= 0) throw badRequest('Nothing is due on this bill.');
      if (available <= 0) throw badRequest('This patient has no deposit balance.');
      const amount = Number(Math.min(due, available, req.body.amount ?? Infinity).toFixed(2));
      if (req.body.amount && req.body.amount > Math.min(due, available)) throw badRequest(`At most ₹${Math.min(due, available).toFixed(2)} can be used.`);
      const { receipt } = await recordBillPayment(tx, req.ctx, bill.BillId, 'payment', { amount, method: 'deposit', reference: 'From deposit' });
      await tx.exec(`INSERT INTO hms.PatientDeposits (TenantId, PatientId, AdmissionId, Kind, Amount, ReceiptNumber, BillId, CreatedByUserId)
                     VALUES (@tid, @pid, @aid, 'applied', @amt, @rc, @bid, @uid)`,
      { tid: req.ctx.tenantId, pid: bill.PatientId, aid: bill.AdmissionId ?? null, amt: t.money(amount.toFixed(2)), rc: receipt, bid: bill.BillId, uid: req.ctx.userId });
      await auditTenant(req, 'deposit.applied', 'bill', bill.BillId, { receipt, amount }, tx);
      return { receipt, amount, balance: (available - amount).toFixed(2) };
    });
    res.status(201).json({ data: { receiptNumber: out.receipt, amount: out.amount.toFixed(2), balance: out.balance } });
  }));

router.post('/deposits/refund', requirePermission('billing.refund'),
  validate(z.object({ patientId: z.coerce.number().int().positive(), amount: money, method: METHOD, reference: z.string().trim().max(100).optional(),
    reason: z.string().trim().min(3, 'Give a reason for the refund.').max(300) }).strict()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const out = await withTransaction(async (tx) => {
      const available = await lockedBalance(tx, req.ctx.tenantId, b.patientId);
      if (b.amount > available) throw badRequest(`Refund cannot be more than the deposit balance (₹${available.toFixed(2)}).`);
      const receipt = formatNumber('ADR', await nextSequence(tx, req.ctx.tenantId, 'deposit_refund'));
      await tx.exec(`INSERT INTO hms.PatientDeposits (TenantId, PatientId, Kind, Amount, Method, Reference, ReceiptNumber, Reason, CreatedByUserId)
                     VALUES (@tid, @pid, 'refund', @amt, @m, @ref, @rc, @reason, @uid)`,
      { tid: req.ctx.tenantId, pid: b.patientId, amt: t.money(b.amount.toFixed(2)), m: b.method, ref: b.reference ?? null, rc: receipt, reason: b.reason, uid: req.ctx.userId });
      await auditTenant(req, 'deposit.refunded', 'patient', b.patientId, { receipt, amount: b.amount, reason: b.reason }, tx);
      return { receipt, balance: (available - b.amount).toFixed(2) };
    });
    res.status(201).json({ data: { receiptNumber: out.receipt, balance: out.balance } });
  }));

// ---------- Payment links (UPI) ----------
const LINK_DAYS = 7;
async function upiSettings(runner, tenantId) {
  const rows = await runner.query(`SELECT SettingKey, SettingValue FROM hms.TenantSettings WHERE TenantId = @tid AND SettingKey IN ('payment.upi_id', 'payment.upi_name')`, { tid: tenantId });
  const s = Object.fromEntries(rows.map((r) => [r.SettingKey, r.SettingValue]));
  return { upiId: s['payment.upi_id'] || null, upiName: s['payment.upi_name'] || null };
}

router.post('/bills/:id/payment-link', requirePermission('billing.write'),
  validate(z.object({ channel: z.enum(['whatsapp', 'email', 'none']).default('none') }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const { upiId } = await upiSettings(db, req.ctx.tenantId);
    if (!upiId || !UPI_ID_RE.test(upiId)) throw badRequest('Add your hospital’s UPI ID in Settings → Payments first.', [{ path: 'upi', message: 'UPI ID missing' }]);
    const b = await db.one(`SELECT b.BillNumber, b.Status, b.Total, b.PaidAmount, p.FirstName, p.Phone, p.Email, t.Name AS HospitalName
                            FROM hms.Bills b JOIN hms.Patients p ON p.TenantId = b.TenantId AND p.PatientId = b.PatientId
                            JOIN hms.Tenants t ON t.TenantId = b.TenantId WHERE b.TenantId = @tid AND b.BillId = @id`, { tid: req.ctx.tenantId, id });
    if (!b) throw notFound('Bill not found.');
    if (b.Status !== 'finalized') throw conflict('Finalise the bill before sending a payment link.', 'BILL_STATE');
    const due = balanceDue(Number(b.Total), Number(b.PaidAmount));
    if (Number(due) <= 0) throw conflict('Nothing is due on this bill.', 'NOTHING_DUE');
    const { channel } = req.body;
    if (channel === 'whatsapp' && !b.Phone) throw badRequest('This patient has no mobile number.');
    if (channel === 'email' && !b.Email) throw badRequest('This patient has no e-mail address.');
    const token = randomToken(32);
    const link = await db.one(`INSERT INTO hms.BillPaymentLinks (TenantId, BillId, TokenHash, Channel, ExpiresAt, CreatedByUserId)
                               OUTPUT INSERTED.LinkId, INSERTED.ExpiresAt VALUES (@tid, @id, @h, @ch, DATEADD(DAY, ${LINK_DAYS}, SYSUTCDATETIME()), @uid)`,
    { tid: req.ctx.tenantId, id, h: sha256Hex(token), ch: channel === 'none' ? null : channel, uid: req.ctx.userId });
    const url = `${config.publicAppUrl}/pay/${token}`;
    let sent = null;
    if (channel !== 'none') {
      const args = { hospital: b.HospitalName, patientFirst: b.FirstName, billNumber: b.BillNumber, amount: due, link: url, days: LINK_DAYS };
      sent = await deliver({ channel, to: channel === 'email' ? b.Email : b.Phone, template: 'payment_link', tenantId: req.ctx.tenantId, related: { type: 'bill', id },
        content: channel === 'email' ? templates.email.paymentLink(args) : templates.whatsapp.paymentLink(args) });
      if (sent.status === 'failed' || sent.status === 'skipped') {
        await db.exec('UPDATE hms.BillPaymentLinks SET RevokedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND LinkId = @lid', { tid: req.ctx.tenantId, lid: link.LinkId });
        throw new HttpError(502, 'NOT_SENT', `The payment link could not be sent: ${sent.error || 'unknown error'}`);
      }
    }
    await auditTenant(req, 'bill.payment_link_created', 'bill', id, { channel, to: sent?.masked ?? null });
    res.status(201).json({ data: { url, expiresAt: link.ExpiresAt, sentTo: sent?.masked ?? null, status: sent?.status ?? 'created' } });
  }));

router.get('/bills/:id/payment-links', requirePermission('billing.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`SELECT l.LinkId AS id, l.Channel AS channel, l.CreatedAt AS createdAt, l.ExpiresAt AS expiresAt, l.RevokedAt AS revokedAt,
                                      l.ViewCount AS viewCount, l.LastViewedAt AS lastViewedAt, u.FullName AS createdBy
                               FROM hms.BillPaymentLinks l LEFT JOIN hms.Users u ON u.TenantId = l.TenantId AND u.UserId = l.CreatedByUserId
                               WHERE l.TenantId = @tid AND l.BillId = @id ORDER BY l.CreatedAt DESC`, { tid: req.ctx.tenantId, id: idParam(req.params.id) });
  res.json({ data: rows });
}));

router.post('/bills/:id/payment-links/:linkId/revoke', requirePermission('billing.write'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.exec('UPDATE hms.BillPaymentLinks SET RevokedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND BillId = @id AND LinkId = @lid AND RevokedAt IS NULL',
    { tid: req.ctx.tenantId, id, lid: idParam(req.params.linkId, 'linkId') });
  if (!n) throw notFound('Link not found or already revoked.');
  await auditTenant(req, 'bill.payment_link_revoked', 'bill', id);
  res.json({ data: { ok: true } });
}));

// ---------- Cash closing ----------
/** Everything a user received or paid out since their last closing (or the start of today). */
async function shiftActivity(runner, ctx, userId, until = new Date()) {
  const last = await runner.one('SELECT TOP 1 PeriodEnd FROM hms.CashClosings WHERE TenantId = @tid AND UserId = @uid ORDER BY PeriodEnd DESC', { tid: ctx.tenantId, uid: userId });
  const start = last ? new Date(last.PeriodEnd) : localDayRangeUtc(ctx.timezone, localDateString(ctx.timezone)).start;
  const rows = await runner.query(`
    SELECT 'bill' AS source, bp.Kind AS kind, bp.Method AS method, bp.Amount AS amount, bp.ReceiptNumber AS receipt, bp.ReceivedAt AS at, b.BillNumber AS ref
    FROM hms.BillPayments bp JOIN hms.Bills b ON b.TenantId = bp.TenantId AND b.BillId = bp.BillId
    WHERE bp.TenantId = @tid AND bp.ReceivedByUserId = @uid AND bp.ReceivedAt > @start AND bp.ReceivedAt <= @end
    UNION ALL
    SELECT 'deposit', d.Kind, d.Method, d.Amount, d.ReceiptNumber, d.CreatedAt, p.PatientNumber
    FROM hms.PatientDeposits d JOIN hms.Patients p ON p.TenantId = d.TenantId AND p.PatientId = d.PatientId
    WHERE d.TenantId = @tid AND d.CreatedByUserId = @uid AND d.Kind IN ('deposit', 'refund') AND d.CreatedAt > @start AND d.CreatedAt <= @end
    ORDER BY at`, { tid: ctx.tenantId, uid: userId, start, end: until });
  return { start, end: until, rows: rows.map((r) => ({ ...r, kind: r.kind === 'deposit' ? 'deposit' : r.kind })) };
}

router.get('/cash/current', requirePermission('cash.close'), asyncHandler(async (req, res) => {
  const a = await shiftActivity(db, req.ctx, req.ctx.userId);
  const s = cashSummary(a.rows, 0);
  res.json({ data: { periodStart: a.start, periodEnd: a.end, ...s, rows: a.rows } });
}));

router.post('/cash/close', requirePermission('cash.close'),
  validate(z.object({
    openingFloat: z.coerce.number().min(0).max(1e7).default(0),
    countedCash: z.coerce.number().min(0).max(1e9).optional(),
    denominations: z.record(z.string(), z.coerce.number().int().min(0).max(100000)).optional(),
    notes: z.string().trim().max(500).optional(),
  }).strict().refine((v) => v.countedCash !== undefined || v.denominations, 'Enter the cash counted (total or notes and coins).')),
  asyncHandler(async (req, res) => {
    const b = req.body;
    let counted;
    try { counted = b.denominations ? Number(denominationTotal(b.denominations)) : Number(b.countedCash.toFixed(2)); } catch (e) { throw badRequest(e.message); }
    const out = await withTransaction(async (tx) => {
      // Serialise closings of the same user (two tabs clicking "Close" at once).
      await tx.one('SELECT TOP 1 ClosingId FROM hms.CashClosings WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid AND UserId = @uid ORDER BY PeriodEnd DESC',
        { tid: req.ctx.tenantId, uid: req.ctx.userId });
      const a = await shiftActivity(tx, req.ctx, req.ctx.userId);
      const s = cashSummary(a.rows, b.openingFloat);
      const diff = Number((counted - Number(s.expectedCash)).toFixed(2));
      if (diff !== 0 && !b.notes) throw badRequest(`The counted cash is ₹${Math.abs(diff).toFixed(2)} ${diff > 0 ? 'more' : 'less'} than expected. Add a note explaining the difference.`);
      const number = formatNumber('CC', await nextSequence(tx, req.ctx.tenantId, 'cash_closing'));
      const r = await tx.one(`INSERT INTO hms.CashClosings (TenantId, ClosingNumber, UserId, PeriodStart, PeriodEnd, OpeningFloat, ExpectedCash, CountedCash, Difference,
                                Denominations, TotalsJson, Notes)
                              OUTPUT INSERTED.ClosingId VALUES (@tid, @num, @uid, @start, @end, @float, @exp, @cnt, @diff, @den, @tot, @notes)`,
      { tid: req.ctx.tenantId, num: number, uid: req.ctx.userId, start: a.start, end: a.end, float: t.money(b.openingFloat.toFixed(2)), exp: t.money(s.expectedCash),
        cnt: t.money(counted.toFixed(2)), diff: t.dec(diff, 12, 2), den: b.denominations ? JSON.stringify(b.denominations) : null,
        tot: JSON.stringify({ totals: s.totals, transactions: s.transactions }), notes: b.notes ?? null });
      await auditTenant(req, 'cash.closed', 'cash_closing', r.ClosingId, { number, expected: s.expectedCash, counted, difference: diff }, tx);
      return { id: r.ClosingId, number, expected: s.expectedCash, counted: counted.toFixed(2), difference: diff.toFixed(2) };
    });
    res.status(201).json({ data: out });
  }));

router.get('/cash/closings', requireAnyPermission('cash.close', 'cash.read'), asyncHandler(async (req, res) => {
  const all = req.ctx.permissions.has('cash.read');
  const lq = parseListQuery(req.query, { closed: 'c.ClosedAt' }, 'closed');
  const params = { tid: req.ctx.tenantId, uid: all ? (req.query.userId ? idParam(req.query.userId, 'userId') : null) : req.ctx.userId, offset: lq.offset, size: lq.pageSize };
  const where = 'WHERE c.TenantId = @tid AND (@uid IS NULL OR c.UserId = @uid)';
  const [rows, total] = await db.many(`
    SELECT c.ClosingId AS id, c.ClosingNumber AS number, c.PeriodStart AS periodStart, c.PeriodEnd AS periodEnd, c.OpeningFloat AS openingFloat,
           c.ExpectedCash AS expectedCash, c.CountedCash AS countedCash, c.Difference AS difference, c.Notes AS notes, c.ClosedAt AS closedAt, u.FullName AS userName
    FROM hms.CashClosings c JOIN hms.Users u ON u.TenantId = c.TenantId AND u.UserId = c.UserId
    ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.CashClosings c ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

router.get('/cash/closings/:id', requireAnyPermission('cash.close', 'cash.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const c = await db.one(`SELECT c.*, u.FullName AS UserName FROM hms.CashClosings c JOIN hms.Users u ON u.TenantId = c.TenantId AND u.UserId = c.UserId
                          WHERE c.TenantId = @tid AND c.ClosingId = @id`, { tid: req.ctx.tenantId, id });
  if (!c) throw notFound('Closing not found.');
  if (!req.ctx.permissions.has('cash.read') && Number(c.UserId) !== Number(req.ctx.userId)) throw notFound('Closing not found.');
  // The exact period of this closing (for the printed slip).
  const rows = (await db.query(`
    SELECT 'bill' AS source, bp.Kind AS kind, bp.Method AS method, bp.Amount AS amount, bp.ReceiptNumber AS receipt, bp.ReceivedAt AS at, b.BillNumber AS ref
    FROM hms.BillPayments bp JOIN hms.Bills b ON b.TenantId = bp.TenantId AND b.BillId = bp.BillId
    WHERE bp.TenantId = @tid AND bp.ReceivedByUserId = @uid AND bp.ReceivedAt > @start AND bp.ReceivedAt <= @end
    UNION ALL
    SELECT 'deposit', d.Kind, d.Method, d.Amount, d.ReceiptNumber, d.CreatedAt, p.PatientNumber
    FROM hms.PatientDeposits d JOIN hms.Patients p ON p.TenantId = d.TenantId AND p.PatientId = d.PatientId
    WHERE d.TenantId = @tid AND d.CreatedByUserId = @uid AND d.Kind IN ('deposit', 'refund') AND d.CreatedAt > @start AND d.CreatedAt <= @end
    ORDER BY at`, { tid: req.ctx.tenantId, uid: c.UserId, start: c.PeriodStart, end: c.PeriodEnd }));
  let totals = {};
  try { totals = JSON.parse(c.TotalsJson); } catch { totals = {}; }
  let den = null;
  try { den = c.Denominations ? JSON.parse(c.Denominations) : null; } catch { den = null; }
  res.json({ data: {
    id: c.ClosingId, number: c.ClosingNumber, userName: c.UserName, periodStart: c.PeriodStart, periodEnd: c.PeriodEnd, openingFloat: c.OpeningFloat,
    expectedCash: c.ExpectedCash, countedCash: c.CountedCash, difference: c.Difference, notes: c.Notes, closedAt: c.ClosedAt, denominations: den, ...totals, rows,
  } });
}));

export default router;
export { upiSettings };
