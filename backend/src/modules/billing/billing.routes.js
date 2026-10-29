import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission, requireFeature } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound, forbidden } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';
import { balanceDue } from '../clinical/logic.js';
import { lockBill, addBillItem, recalcBill, finalizeBill, getOrCreateDraftBill } from './billing.service.js';

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
    const bill = await lockBill(tx, req.ctx.tenantId, id);
    if (bill.Status !== 'finalized') throw conflict('Payments can only be recorded against a finalised bill.', 'BILL_STATE');
    const amount = Number(req.body.amount.toFixed(2));
    const paid = Number(bill.PaidAmount);
    const total = Number(bill.Total);
    if (kind === 'payment' && amount > Number(balanceDue(total, paid))) throw badRequest(`Amount exceeds the balance due (${balanceDue(total, paid)}).`);
    if (kind === 'refund') {
      if (!req.body.reason) throw badRequest('A refund reason is required.');
      if (amount > paid) throw badRequest(`Refund cannot exceed the amount paid (${paid.toFixed(2)}).`);
    }
    const n = await nextSequence(tx, req.ctx.tenantId, 'receipt');
    const receipt = formatNumber(kind === 'refund' ? 'RFD' : 'RCT', n);
    await tx.exec(
      `INSERT INTO hms.BillPayments (TenantId, BillId, ReceiptNumber, Kind, Amount, Method, Reference, Reason, ReceivedByUserId)
       VALUES (@tid, @id, @rc, @kind, @amt, @method, @ref, @reason, @uid)`,
      { tid: req.ctx.tenantId, id, rc: receipt, kind, amt: t.money(amount.toFixed(2)), method: req.body.method, ref: req.body.reference ?? null, reason: req.body.reason ?? null, uid: req.ctx.userId });
    await tx.exec(`UPDATE hms.Bills SET PaidAmount = PaidAmount ${kind === 'refund' ? '-' : '+'} @amt WHERE TenantId = @tid AND BillId = @id`,
      { tid: req.ctx.tenantId, id, amt: t.money(amount.toFixed(2)) });
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

export default router;
