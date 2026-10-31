// Coupons for plan sign-ups and renewals. The discount is taken off the pre-tax subtotal; GST is charged on the rest.
// A coupon is checked when the order is created and counted (redeemed) only when the payment is verified.
import { badRequest } from '../../utils/errors.js';
import { quote } from '../../utils/pricing.js';
import { couponProblem, couponDiscountMinor, normaliseCouponCode, COUPON_CODE_RE } from '../clinical/phase4.logic.js';

/**
 * Returns { coupon, quote } for a plan purchase; coupon is null when no code was given.
 * Throws 400 with a clear message when the code can't be used. `tenantId` (renewals) enforces once-per-hospital.
 */
export async function priceWithCoupon(runner, { plan, interval, code, kind, tenantId = null }) {
  const clean = normaliseCouponCode(code);
  if (!clean) return { coupon: null, quote: quote(plan, interval) };
  if (!COUPON_CODE_RE.test(clean)) throw badRequest('This coupon code is not valid.');
  const coupon = await runner.one('/* tenant-safe: platform coupon catalogue */ SELECT * FROM hms.Coupons WHERE Code = @code', { code: clean });
  const problem = couponProblem(coupon, { planCode: plan.Code, interval, kind });
  if (problem) throw badRequest(problem, [{ path: 'couponCode', message: problem }]);
  if (tenantId && coupon.OncePerHospital) {
    const used = await runner.one('SELECT TOP 1 1 AS x FROM hms.CouponRedemptions WHERE CouponId = @c AND TenantId = @tid', { c: coupon.CouponId, tid: tenantId });
    if (used) throw badRequest('Your hospital has already used this coupon.', [{ path: 'couponCode', message: 'Already used by your hospital.' }]);
  }
  return { coupon, quote: quote(plan, interval, (subtotalMinor) => couponDiscountMinor(coupon, subtotalMinor)) };
}

/** Called inside the payment-verification transaction: counts the redemption exactly once per payment. */
export async function redeemCoupon(tx, { couponId, tenantId, paymentId, discount }) {
  if (!couponId) return;
  const done = await tx.one('/* tenant-safe: platform coupon ledger, by payment */ SELECT 1 AS x FROM hms.CouponRedemptions WHERE PaymentId = @p', { p: paymentId });
  if (done) return;
  await tx.exec('/* tenant-safe: platform coupon ledger */ INSERT INTO hms.CouponRedemptions (CouponId, TenantId, PaymentId, Discount) VALUES (@c, @tid, @p, @d)',
    { c: couponId, tid: tenantId ?? null, p: paymentId, d: discount });
  await tx.exec('UPDATE hms.Coupons SET Redeemed = Redeemed + 1, UpdatedAt = SYSUTCDATETIME() WHERE CouponId = @c', { c: couponId });
}
