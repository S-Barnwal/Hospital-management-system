// Shared billing operations. Every function takes a transaction runner and the tenantId from req.ctx.
import { t } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { computeLine, computeBill } from '../clinical/logic.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';

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
  await tx.exec(
    `INSERT INTO hms.BillItems (TenantId, BillId, ItemType, Description, Quantity, UnitPrice, TaxRatePercent, LineSubtotal, LineTax, ReferenceType, ReferenceId)
     VALUES (@tid, @bid, @type, @desc, @qty, @price, @tax, @sub, @ltax, @rtype, @rid)`,
    { tid: tenantId, bid: billId, type: item.itemType, desc: item.description.slice(0, 200), qty: t.dec(Number(item.quantity), 10, 2),
      price: t.money(item.unitPrice), tax: t.dec(Number(item.taxRatePercent || 0), 5, 2),
      sub: t.money(line.lineSubtotal), ltax: t.money(line.lineTax), rtype: item.referenceType ?? null, rid: item.referenceId ?? null });
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
