// Pure business rules for OPD, IPD, billing, lab and pharmacy (unit-tested, no database).
import { toMinor, fromMinor } from '../../utils/pricing.js';

const minor = (v) => toMinor(Number(v).toFixed(2));

/** One bill line: quantity × unit price, tax on the line subtotal. Integer paise throughout. */
export function computeLine({ quantity, unitPrice, taxRatePercent = 0 }) {
  const q = Number(quantity);
  if (!(q > 0)) throw new Error('Quantity must be greater than zero.');
  const sub = Math.round(minor(unitPrice) * q);
  const tax = Math.round((sub * Math.round(Number(taxRatePercent) * 100)) / 10000);
  return { subMinor: sub, taxMinor: tax, lineSubtotal: fromMinor(sub), lineTax: fromMinor(tax) };
}

/**
 * Bill totals. A bill-level discount reduces the taxable value proportionally
 * (GST is charged on the discounted amount).
 */
export function computeBill(lines, discountAmount = 0) {
  const sub = lines.reduce((a, l) => a + minor(l.lineSubtotal ?? l.LineSubtotal), 0);
  const taxBefore = lines.reduce((a, l) => a + minor(l.lineTax ?? l.LineTax), 0);
  const disc = minor(discountAmount || 0);
  if (disc > sub) throw new Error('Discount cannot exceed the subtotal.');
  const tax = sub === 0 ? 0 : Math.round((taxBefore * (sub - disc)) / sub);
  const total = sub - disc + tax;
  return { subtotal: fromMinor(sub), discount: fromMinor(disc), tax: fromMinor(tax), total: fromMinor(total), totalMinor: total };
}

/** Balance due on a bill; payments/refunds are validated against it. */
export function balanceDue(total, paid) {
  return fromMinor(minor(total) - minor(paid));
}

/** Flags a numeric lab result against its reference range. */
export function labFlag(value, low, high) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (low !== null && low !== undefined && n < Number(low)) return 'low';
  if (high !== null && high !== undefined && n > Number(high)) return 'high';
  if ((low === null || low === undefined) && (high === null || high === undefined)) return null;
  return 'normal';
}

const LAB_FLOW = {
  ordered: ['sample_collected', 'cancelled'],
  sample_collected: ['completed', 'cancelled'],
  completed: ['verified', 'sample_collected'],
  verified: [],
  cancelled: [],
};
export const canMoveLab = (from, to) => (LAB_FLOW[from] || []).includes(to);

/**
 * First-expiry-first-out allocation across batches. Expired batches are skipped.
 * `batches` = [{ BatchId, ExpiryDate, QuantityOnHand, SalePrice }]. Returns [{ batchId, quantity, unitPrice }].
 */
export function allocateFefo(batches, quantity, today) {
  let need = Number(quantity);
  if (!Number.isInteger(need) || need <= 0) throw new Error('Quantity must be a positive whole number.');
  const usable = batches
    .filter((b) => String(b.ExpiryDate).slice(0, 10) >= today && b.QuantityOnHand > 0)
    .sort((a, b) => String(a.ExpiryDate).localeCompare(String(b.ExpiryDate)));
  const available = usable.reduce((a, b) => a + b.QuantityOnHand, 0);
  if (available < need) {
    const err = new Error(`Only ${available} unit(s) in non-expired stock.`);
    err.code = 'INSUFFICIENT_STOCK';
    throw err;
  }
  const out = [];
  for (const b of usable) {
    if (need === 0) break;
    const take = Math.min(need, b.QuantityOnHand);
    out.push({ batchId: b.BatchId, quantity: take, unitPrice: Number(b.SalePrice) });
    need -= take;
  }
  return out;
}

/** Number of chargeable bed-days: any started day counts, minimum one. */
export function bedDays(admittedAt, dischargedAt) {
  const ms = new Date(dischargedAt).getTime() - new Date(admittedAt).getTime();
  return Math.max(1, Math.ceil(ms / 86400000));
}

/** Escapes values for CSV export (also neutralises spreadsheet formula injection). */
export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return [head, ...body].join('\r\n');
}

/**
 * Splits a package price (in paise) across its tests in proportion to their list prices,
 * so the order items always add up exactly to the package price. Equal split if all list prices are 0.
 * @param {number} packageMinor package price in paise
 * @param {number[]} listMinor individual test prices in paise
 * @returns {number[]} allocated paise per test
 */
export function allocatePackagePrice(packageMinor, listMinor) {
  const n = listMinor.length;
  if (!n) return [];
  const sum = listMinor.reduce((a, b) => a + b, 0);
  const out = listMinor.map((p) => (sum > 0 ? Math.floor((packageMinor * p) / sum) : Math.floor(packageMinor / n)));
  out[n - 1] += packageMinor - out.reduce((a, b) => a + b, 0);
  return out;
}

/** Payment status of a lab order from its linked bill. */
export function labPaymentStatus(bill) {
  if (!bill || bill.billId == null) return 'unbilled';
  if (bill.status === 'cancelled') return 'cancelled';
  if (bill.status === 'draft') return 'on_bill';
  const total = Number(bill.total); const paid = Number(bill.paid);
  if (paid >= total) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
}

/** Sample workflow: allowed transitions. */
const SAMPLE_FLOW = { pending: ['collected'], collected: ['received', 'rejected'], received: ['rejected'], rejected: ['collected'] };
export const canMoveSample = (from, to) => (SAMPLE_FLOW[from] || []).includes(to);
