// Money is handled in integer paise to avoid floating-point errors, and returned as 2-dp strings.

export function toMinor(amount) {
  const s = String(amount);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid amount: ${amount}`);
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export const fromMinor = (minor) => `${Math.trunc(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, '0')}`;

/**
 * Computes the payable amount for a plan + interval. Tax is GST-exclusive pricing:
 * tax = round((subtotal − discount) × rate / 100) to the nearest paisa. `discountFor(subtotalMinor)` (optional) returns
 * a coupon discount in paise.
 */
export function quote(plan, interval, discountFor = null) {
  if (plan.IsContactSales) throw new Error('Plan requires contact with sales.');
  const price = interval === 'annual' ? plan.AnnualPrice : plan.MonthlyPrice;
  if (price === null || price === undefined) throw new Error('Plan price not configured.');
  const subtotal = toMinor(Number(price).toFixed(2));
  const discount = discountFor ? Math.max(0, Math.min(subtotal, discountFor(subtotal))) : 0;
  const ratePct = Number(plan.TaxRatePercent ?? 0);
  // rate stored with 2 decimals → work in basis points (1% = 100 bp) to stay in integers
  const rateBp = Math.round(ratePct * 100);
  const tax = Math.round(((subtotal - discount) * rateBp) / 10000);
  return {
    currency: plan.Currency || 'INR',
    subtotal: fromMinor(subtotal),
    discount: fromMinor(discount),
    tax: fromMinor(tax),
    total: fromMinor(subtotal - discount + tax),
    totalMinor: subtotal - discount + tax,
    taxRatePercent: ratePct,
  };
}

/** Adds one billing period to a date (UTC). Month-end dates clamp (Jan 31 + 1 month = Feb 28/29). */
export function addInterval(date, interval) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (interval === 'annual' ? 12 : 1));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
