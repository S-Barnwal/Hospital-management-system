import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission, requireFeature } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound, forbidden } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { balanceDue } from '../clinical/logic.js';
import { lockBill, addBillItem, recalcBill, finalizeBill, getOrCreateDraftBill, recordBillPayment } from './billing.service.js';
import { localDayRangeUtc } from '../../utils/time.js';

const router = Router();
router.use(requireTenant, requireFeature('billing'));

const money = z.coerce.number().min(0).max(1e9);
const ITEM_TYPES = ['consultation', 'lab', 'pharmacy', 'bed', 'procedure', 'other'];

router.get('/bills', requirePermission('billing.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { created: 'b.CreatedAt', total: 'b.Total' }, 'created');
  const q = req.query.q ? `%${String(req.query.q).trim().slice(0, 100).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null;
  const params = {
    tid: req.ctx.tenantId, offset: lq.offset, size: lq.pageSize, q,
    status: ['draft', 'finalized', 'cancelled'].includes(req.query.status) ? req.query.status : null,
    unpaid: req.query.unpaid === 'true',
    patientId: req.query.patientId ? idParam(req.query.patientId, 'patientId') : null,
  };
  const where = `WHERE b.TenantId = @tid AND (@status IS NULL OR b.Status = @status) AND (@patientId IS NULL OR b.PatientId = @patientId)
    AND (@unpaid = 0 OR (b.Status = 'finalized' AND b.PaidAmount < b.Total))
    AND (@q IS NULL OR b.BillNumber LIKE @q OR p.PatientNumber LIKE @q OR p.FirstName LIKE @q OR p.LastName LIKE @q OR p.Phone LIKE @q)`;
  const [rows, total] = await db.many(`
    SELECT b.BillId AS id, b.BillNumber AS billNumber, b.Status AS status, b.Subtotal AS subtotal, b.DiscountAmount AS discount, b.TaxAmount AS tax,
           b.Total AS total, b.PaidAmount AS paid, b.CreatedAt AS createdAt, b.FinalizedAt AS finalizedAt, b.AdmissionId AS admissionId,
           p.PatientId AS patientId, p.PatientNumber AS patientNumber, p.FirstName AS patientFirstName, p.LastName AS patientLastName
    FROM hms.Bills b JOIN hms.Patients p ON p.TenantId = b.TenantId AND p.PatientId = b.PatientId
    ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.Bills b JOIN hms.Patients p ON p.TenantId = b.TenantId AND p.PatientId = b.PatientId ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

router.post('/bills', requirePermission('billing.write'),
  validate(z.object({ patientId: z.number().int().positive(), admissionId: z.number().int().positive().nullable().optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = await withTransaction(async (tx) => {
      const p = await tx.one('SELECT PatientId FROM hms.Patients WHERE TenantId = @tid AND PatientId = @pid', { tid: req.ctx.tenantId, pid: req.body.patientId });
      if (!p) throw badRequest('Patient not found.');
      const billId = await getOrCreateDraftBill(tx, req.ctx, req.body.patientId, req.body.admissionId ?? null);
      await auditTenant(req, 'bill.draft_opened', 'bill', billId, null, tx);
      return billId;
    });
    res.status(201).json({ data: { id } });
  }));

router.get('/bills/:id', requirePermission('billing.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const [bills, items, payments] = await db.many(`
    SELECT b.*, p.PatientNumber, p.FirstName, p.LastName, p.Phone, p.AddressLine, p.City, t.Name AS HospitalName, t.Phone AS HospitalPhone,
           (SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = b.TenantId AND SettingKey = 'hospital.address') AS HospitalAddress
    FROM hms.Bills b JOIN hms.Patients p ON p.TenantId = b.TenantId AND p.PatientId = b.PatientId JOIN hms.Tenants t ON t.TenantId = b.TenantId
    WHERE b.TenantId = @tid AND b.BillId = @id;
    SELECT BillItemId AS id, ItemType AS itemType, Description AS description, Quantity AS quantity, UnitPrice AS unitPrice,
           TaxRatePercent AS taxRatePercent, LineSubtotal AS lineSubtotal, LineTax AS lineTax
    FROM hms.BillItems WHERE TenantId = @tid AND BillId = @id ORDER BY BillItemId;
    SELECT bp.BillPaymentId AS id, bp.ReceiptNumber AS receiptNumber, bp.Kind AS kind, bp.Amount AS amount, bp.Method AS method, bp.Reference AS reference,
           bp.Reason AS reason, bp.ReceivedAt AS receivedAt, u.FullName AS receivedBy
    FROM hms.BillPayments bp LEFT JOIN hms.Users u ON u.TenantId = bp.TenantId AND u.UserId = bp.ReceivedByUserId
    WHERE bp.TenantId = @tid AND bp.BillId = @id ORDER BY bp.ReceivedAt;`, { tid: req.ctx.tenantId, id });
  const b = bills[0];
  if (!b) throw notFound('Bill not found.');
  res.json({
    data: {
      id: b.BillId, billNumber: b.BillNumber, status: b.Status, subtotal: b.Subtotal, discount: b.DiscountAmount, tax: b.TaxAmount, total: b.Total,
      paid: b.PaidAmount, balance: balanceDue(b.Total, b.PaidAmount), notes: b.Notes, cancelReason: b.CancelReason, createdAt: b.CreatedAt,
      finalizedAt: b.FinalizedAt, cancelledAt: b.CancelledAt, admissionId: b.AdmissionId,
      patient: { id: b.PatientId, patientNumber: b.PatientNumber, firstName: b.FirstName, lastName: b.LastName, phone: b.Phone, address: [b.AddressLine, b.City].filter(Boolean).join(', ') },
      hospital: { name: b.HospitalName, phone: b.HospitalPhone, address: b.HospitalAddress },
      items, payments,
    },
  });
}));

router.post('/bills/:id/items', requirePermission('billing.write'),
  validate(z.object({
    itemType: z.enum(ITEM_TYPES), description: z.string().trim().min(2).max(200),
    quantity: z.coerce.number().positive().max(100000), unitPrice: money, taxRatePercent: z.coerce.number().min(0).max(100).default(0),
  }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      await addBillItem(tx, req.ctx.tenantId, id, req.body);
      await auditTenant(req, 'bill.item_added', 'bill', id, { itemType: req.body.itemType }, tx);
    });
    res.status(201).json({ data: { ok: true } });
  }));

router.delete('/bills/:id/items/:itemId', requirePermission('billing.write'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const itemId = idParam(req.params.itemId, 'itemId');
  await withTransaction(async (tx) => {
    const bill = await lockBill(tx, req.ctx.tenantId, id);
    if (bill.Status !== 'draft') throw conflict('Finalised bills are locked.', 'BILL_LOCKED');
    const n = await tx.exec('DELETE FROM hms.BillItems WHERE TenantId = @tid AND BillId = @id AND BillItemId = @item', { tid: req.ctx.tenantId, id, item: itemId });
    if (!n) throw notFound('Item not found.');
    await recalcBill(tx, req.ctx.tenantId, id);
    await auditTenant(req, 'bill.item_removed', 'bill', id, null, tx);
  });
  res.json({ data: { ok: true } });
}));

router.patch('/bills/:id', requirePermission('billing.write'),
  validate(z.object({ discountAmount: money.optional(), notes: z.string().trim().max(500).nullable().optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const bill = await lockBill(tx, req.ctx.tenantId, id);
      if (bill.Status !== 'draft') throw conflict('Finalised bills are locked.', 'BILL_LOCKED');
      if ('notes' in req.body) await tx.exec('UPDATE hms.Bills SET Notes = @n WHERE TenantId = @tid AND BillId = @id', { tid: req.ctx.tenantId, id, n: req.body.notes });
      if (req.body.discountAmount !== undefined) {
        try { await recalcBill(tx, req.ctx.tenantId, id, req.body.discountAmount.toFixed(2)); } catch (e) { throw badRequest(e.message); }
      }
      await auditTenant(req, 'bill.updated', 'bill', id, { discount: req.body.discountAmount }, tx);
    });
    res.json({ data: { ok: true } });
  }));

router.post('/bills/:id/finalize', requirePermission('billing.write'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const number = await withTransaction(async (tx) => {
    const num = await finalizeBill(tx, req.ctx.tenantId, id);
    await auditTenant(req, 'bill.finalized', 'bill', id, { billNumber: num }, tx);
    return num;
  });
  res.json({ data: { billNumber: number } });
}));

const payBody = z.object({
  amount: z.coerce.number().positive().max(1e9), method: z.enum(['cash', 'card', 'upi', 'bank', 'other']),
  reference: z.string().trim().max(100).optional(), reason: z.string().trim().max(300).optional(),
}).strict();

async function postPayment(req, kind) {
  const id = idParam(req.params.id);
  return withTransaction(async (tx) => {
    const { receipt, amount } = await recordBillPayment(tx, req.ctx, id, kind, req.body);
    await auditTenant(req, `bill.${kind}`, 'bill', id, { receipt, amount, method: req.body.method }, tx);
    return receipt;
  });
}

router.post('/bills/:id/payments', requirePermission('billing.write'), validate(payBody), asyncHandler(async (req, res) => {
  res.status(201).json({ data: { receiptNumber: await postPayment(req, 'payment') } });
}));

router.post('/bills/:id/refunds', requirePermission('billing.refund'), validate(payBody), asyncHandler(async (req, res) => {
  res.status(201).json({ data: { receiptNumber: await postPayment(req, 'refund') } });
}));

router.post('/bills/:id/cancel', requirePermission('billing.write'),
  validate(z.object({ reason: z.string().trim().min(3).max(300) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const bill = await lockBill(tx, req.ctx.tenantId, id);
      if (bill.Status === 'cancelled') throw conflict('Bill is already cancelled.');
      if (bill.Status === 'finalized' && !req.ctx.permissions.has('billing.refund')) throw forbidden('Cancelling a finalised bill requires the refund permission.');
      if (Number(bill.PaidAmount) > 0) throw conflict('Refund all payments before cancelling this bill.', 'BILL_HAS_PAYMENTS');
      await tx.exec(`UPDATE hms.Bills SET Status = 'cancelled', CancelReason = @r, CancelledAt = SYSUTCDATETIME() WHERE TenantId = @tid AND BillId = @id`,
        { tid: req.ctx.tenantId, id, r: req.body.reason });
      await auditTenant(req, 'bill.cancelled', 'bill', id, null, tx);
    });
    res.json({ data: { ok: true } });
  }));

// ---------- Payments register (all receipts and refunds of this hospital) ----------
router.get('/payments', requirePermission('billing.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { received: 'bp.ReceivedAt', amount: 'bp.Amount' }, 'received');
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const start = isDate(req.query.from) ? localDayRangeUtc(req.ctx.timezone, req.query.from).start : null;
  const end = isDate(req.query.to) ? localDayRangeUtc(req.ctx.timezone, req.query.to).end : null;
  const q = req.query.q ? `%${String(req.query.q).trim().slice(0, 100).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null;
  const params = {
    tid: req.ctx.tenantId, offset: lq.offset, size: lq.pageSize, start, end, q,
    method: ['cash', 'card', 'upi', 'bank', 'other'].includes(req.query.method) ? req.query.method : null,
    kind: ['payment', 'refund'].includes(req.query.kind) ? req.query.kind : null,
  };
  const from = `FROM hms.BillPayments bp
    JOIN hms.Bills b ON b.TenantId = bp.TenantId AND b.BillId = bp.BillId
    JOIN hms.Patients p ON p.TenantId = b.TenantId AND p.PatientId = b.PatientId
    LEFT JOIN hms.Users u ON u.TenantId = bp.TenantId AND u.UserId = bp.ReceivedByUserId`;
  const where = `WHERE bp.TenantId = @tid AND (@start IS NULL OR bp.ReceivedAt >= @start) AND (@end IS NULL OR bp.ReceivedAt < @end)
    AND (@method IS NULL OR bp.Method = @method) AND (@kind IS NULL OR bp.Kind = @kind)
    AND (@q IS NULL OR bp.ReceiptNumber LIKE @q OR b.BillNumber LIKE @q OR p.PatientNumber LIKE @q OR p.FirstName LIKE @q OR p.LastName LIKE @q OR p.Phone LIKE @q)`;
  const [rows, totals] = await db.many(`
    SELECT bp.BillPaymentId AS id, bp.ReceiptNumber AS receiptNumber, bp.Kind AS kind, bp.Amount AS amount, bp.Method AS method, bp.Reference AS reference,
           bp.Reason AS reason, bp.ReceivedAt AS receivedAt, b.BillId AS billId, b.BillNumber AS billNumber,
           p.PatientId AS patientId, p.PatientNumber AS patientNumber, p.FirstName AS patientFirstName, p.LastName AS patientLastName, u.FullName AS receivedBy
    ${from} ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total,
           ISNULL(SUM(CASE WHEN bp.Kind = 'payment' THEN bp.Amount ELSE 0 END), 0) AS payments,
           ISNULL(SUM(CASE WHEN bp.Kind = 'refund' THEN bp.Amount ELSE 0 END), 0) AS refunds
    ${from} ${where};`, params);
  const t0 = totals[0];
  res.json({ data: rows, meta: { ...pageMeta(lq, t0.total), payments: t0.payments, refunds: t0.refunds, net: (Number(t0.payments) - Number(t0.refunds)).toFixed(2) } });
}));

export default router;
