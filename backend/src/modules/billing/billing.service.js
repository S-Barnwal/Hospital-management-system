// Shared billing operations. Every function takes a transaction runner and the tenantId from req.ctx.
import { t } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { computeLine, computeBill, balanceDue } from '../clinical/logic.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';

/** SAC 9993 = human health services (GST). Hospitals can change the default in Settings. */
export const DEFAULT_HEALTHCARE_SAC = '9993';

/** Locks and returns a bill row of this tenant, or throws 404. */
export async function lockBill(tx, tenantId, billId) {
  const bill = await tx.one('SELECT * FROM hms.Bills WITH (UPDLOCK, ROWLOCK) WHERE TenantId = @tid AND BillId = @id', { tid: tenantId, id: billId });
  if (!bill) throw notFound('Bill not found.');
  return bill;
}

/** Returns the patient's open draft bill (optionally for an admission), creating one if needed. */
export async function getOrCreateDraftBill(tx, ctx, patientId, admissionId = null) {
  const existing = await tx.one(
    `SELECT TOP 1 BillId FROM hms.Bills WITH (UPDLOCK, HOLDLOCK)
     WHERE TenantId = @tid AND PatientId = @pid AND Status = 'draft'
       AND ((@aid IS NULL AND AdmissionId IS NULL) OR AdmissionId = @aid)
     ORDER BY CreatedAt DESC`, { tid: ctx.tenantId, pid: patientId, aid: admissionId });
  if (existing) return existing.BillId;
  const row = await tx.one(
    `INSERT INTO hms.Bills (TenantId, PatientId, AdmissionId, CreatedByUserId) OUTPUT INSERTED.BillId VALUES (@tid, @pid, @aid, @uid)`,
    { tid: ctx.tenantId, pid: patientId, aid: admissionId, uid: ctx.userId });
  return row.BillId;
}

/** Recomputes subtotal/tax/total from items. Only valid while the bill is a draft. */
export async function recalcBill(tx, tenantId, billId, discountAmount = undefined) {
  const bill = await lockBill(tx, tenantId, billId);
  const items = await tx.query('SELECT LineSubtotal, LineTax FROM hms.BillItems WHERE TenantId = @tid AND BillId = @id', { tid: tenantId, id: billId });
  const totals = computeBill(items, discountAmount ?? bill.DiscountAmount);
  await tx.exec(
    `UPDATE hms.Bills SET Subtotal = @sub, DiscountAmount = @disc, TaxAmount = @tax, Total = @total WHERE TenantId = @tid AND BillId = @id`,
    { tid: tenantId, id: billId, sub: t.money(totals.subtotal), disc: t.money(totals.discount), tax: t.money(totals.tax), total: t.money(totals.total) });
  return totals;
}

/** Adds a line to a draft bill (finalised bills are immutable). */
export async function addBillItem(tx, tenantId, billId, item) {
  const bill = await lockBill(tx, tenantId, billId);
  if (bill.Status !== 'draft') throw conflict('Only draft bills can be changed. Finalised bills are locked.', 'BILL_LOCKED');
  const line = computeLine(item);
  // HSN (goods) / SAC (services) code for the GST invoice: given by the caller, else the hospital's default service SAC.
  let hsnSac = item.hsnSac || null;
  if (!hsnSac && item.itemType !== 'pharmacy') {
    const st = await tx.one(`SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = @tid AND SettingKey = 'gst.sac_default'`, { tid: tenantId });
    hsnSac = st?.SettingValue || DEFAULT_HEALTHCARE_SAC;
  }
  await tx.exec(
    `INSERT INTO hms.BillItems (TenantId, BillId, ItemType, Description, Quantity, UnitPrice, TaxRatePercent, LineSubtotal, LineTax, ReferenceType, ReferenceId, HsnSac, ChargeDate)
     VALUES (@tid, @bid, @type, @desc, @qty, @price, @tax, @sub, @ltax, @rtype, @rid, @hsn, @cdate)`,
    { tid: tenantId, bid: billId, type: item.itemType, desc: item.description.slice(0, 200), qty: t.dec(Number(item.quantity), 10, 2),
      price: t.money(item.unitPrice), tax: t.dec(Number(item.taxRatePercent || 0), 5, 2),
      sub: t.money(line.lineSubtotal), ltax: t.money(line.lineTax), rtype: item.referenceType ?? null, rid: item.referenceId ?? null, hsn: hsnSac,
      cdate: item.chargeDate ? t.date(new Date(`${item.chargeDate}T00:00:00Z`)) : null });
  return recalcBill(tx, tenantId, billId);
}

/** Finalises a bill: assigns the next sequential bill number for this hospital and locks it. */
export async function finalizeBill(tx, tenantId, billId) {
  const bill = await lockBill(tx, tenantId, billId);
  if (bill.Status !== 'draft') throw conflict('Bill is already finalised or cancelled.', 'BILL_LOCKED');
  const count = await tx.one('SELECT COUNT(*) AS n FROM hms.BillItems WHERE TenantId = @tid AND BillId = @id', { tid: tenantId, id: billId });
  if (!count.n) throw badRequest('Add at least one item before finalising.');
  const n = await nextSequence(tx, tenantId, 'bill');
  const year = new Date().getUTCFullYear();
  const number = formatNumber(`INV${year}`, n);
  await tx.exec(`UPDATE hms.Bills SET Status = 'finalized', BillNumber = @num, FinalizedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND BillId = @id`,
    { tid: tenantId, id: billId, num: number });
  return number;
}

/** Creates a new, empty draft bill (used when an order should have its own invoice). */
export async function createDraftBill(tx, ctx, patientId, notes = null) {
  const row = await tx.one(
    `INSERT INTO hms.Bills (TenantId, PatientId, Notes, CreatedByUserId) OUTPUT INSERTED.BillId VALUES (@tid, @pid, @notes, @uid)`,
    { tid: ctx.tenantId, pid: patientId, notes, uid: ctx.userId });
  return row.BillId;
}

/**
 * Records a payment or refund against a finalised bill and returns the receipt number.
 * body = { amount, method, reference?, reason? }
 */
export async function recordBillPayment(tx, ctx, billId, kind, body) {
  const bill = await lockBill(tx, ctx.tenantId, billId);
  if (bill.Status !== 'finalized') throw conflict('Payments can only be recorded against a finalised bill.', 'BILL_STATE');
  const amount = Number(Number(body.amount).toFixed(2));
  if (!(amount > 0)) throw badRequest('Amount must be greater than zero.');
  const paid = Number(bill.PaidAmount);
  const total = Number(bill.Total);
  if (kind === 'payment' && amount > Number(balanceDue(total, paid))) throw badRequest(`Amount exceeds the balance due (${balanceDue(total, paid)}).`);
  if (kind === 'refund') {
    if (!body.reason) throw badRequest('A refund reason is required.');
    if (amount > paid) throw badRequest(`Refund cannot exceed the amount paid (${paid.toFixed(2)}).`);
  }
  const n = await nextSequence(tx, ctx.tenantId, 'receipt');
  const receipt = formatNumber(kind === 'refund' ? 'RFD' : 'RCT', n);
  await tx.exec(
    `INSERT INTO hms.BillPayments (TenantId, BillId, ReceiptNumber, Kind, Amount, Method, Reference, Reason, ReceivedByUserId)
     VALUES (@tid, @id, @rc, @kind, @amt, @method, @ref, @reason, @uid)`,
    { tid: ctx.tenantId, id: billId, rc: receipt, kind, amt: t.money(amount.toFixed(2)), method: body.method, ref: body.reference ?? null, reason: body.reason ?? null, uid: ctx.userId });
  await tx.exec(`UPDATE hms.Bills SET PaidAmount = PaidAmount ${kind === 'refund' ? '-' : '+'} @amt WHERE TenantId = @tid AND BillId = @id`,
    { tid: ctx.tenantId, id: billId, amt: t.money(amount.toFixed(2)) });
  return { receipt, amount };
}
