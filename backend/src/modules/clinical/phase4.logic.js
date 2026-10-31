// Pure rules for Phase 4 (no database access) — unit-tested in tests/unit/phase4.test.js.
import { randomBytes } from 'node:crypto';

// ---------- Token queue ----------
export const FIXED_QUEUES = ['reception', 'lab', 'pharmacy', 'billing'];
export const QUEUE_LABELS = { reception: 'Reception', lab: 'Laboratory', pharmacy: 'Pharmacy', billing: 'Billing' };
const DOCTOR_QUEUE = /^doctor:(\d{1,18})$/;

/** 'doctor:12' → { kind: 'doctor', doctorId: 12 }; 'lab' → { kind: 'lab' }; anything else → null. */
export function parseQueueKey(key) {
  const s = String(key || '');
  if (FIXED_QUEUES.includes(s)) return { kind: s, doctorId: null };
  const m = DOCTOR_QUEUE.exec(s);
  return m ? { kind: 'doctor', doctorId: Number(m[1]) } : null;
}

/** Who is called next: priority tokens first (senior citizens, emergencies), then by number. */
export function pickNext(waiting) {
  return [...waiting].sort((a, b) => (Number(b.priority) - Number(a.priority)) || (a.tokenNumber - b.tokenNumber))[0] ?? null;
}

export const TOKEN_FLOW = {
  waiting: ['called', 'cancelled'],
  called: ['done', 'skipped', 'called', 'waiting'],   // 'called' again = recall (announce once more)
  skipped: ['waiting', 'called', 'cancelled'],
  done: [],
  cancelled: [],
};
export const canMoveToken = (from, to) => (TOKEN_FLOW[from] || []).includes(to);

/** Average minutes between consecutive calls today → rough waiting-time estimate for the next person. */
export function estimateWaitMinutes(calledTimes, ahead) {
  const ts = calledTimes.map((t) => new Date(t).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  if (ts.length < 2 || ahead <= 0) return null;
  const gaps = [];
  for (let i = 1; i < ts.length; i += 1) gaps.push((ts[i] - ts[i - 1]) / 60000);
  const recent = gaps.slice(-8).filter((g) => g > 0 && g < 120);
  if (!recent.length) return null;
  const avg = recent.reduce((s, g) => s + g, 0) / recent.length;
  return Math.max(1, Math.round(avg * ahead));
}

// ---------- ABHA (Ayushman Bharat Health Account) ----------
/** "91-1234-5678-9012" / "91 1234 5678 9012" / 14 digits → "91123456789012"; '' → null; anything else → throws. */
export function normaliseAbhaNumber(input) {
  if (input === null || input === undefined || String(input).trim() === '') return null;
  const digits = String(input).replace(/[\s-]/g, '');
  if (!/^\d{14}$/.test(digits)) throw new Error('ABHA number must have 14 digits (e.g. 91-1234-5678-9012).');
  return digits;
}
export const formatAbhaNumber = (d) => (d && /^\d{14}$/.test(d) ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}` : d ?? null);
export const ABHA_ADDRESS_RE = /^[a-z0-9][a-z0-9._]{2,49}@(abdm|sbx)$/;

// ---------- Coupons ----------
/** Why a coupon cannot be used (null = it can). `kind` is 'signup' | 'renewal'. */
export function couponProblem(c, { planCode, interval, kind, now = new Date() }) {
  if (!c || !c.IsActive) return 'This coupon code is not valid.';
  if (c.ValidFrom && new Date(c.ValidFrom) > now) return 'This coupon is not active yet.';
  if (c.ValidUntil && new Date(c.ValidUntil) < now) return 'This coupon has expired.';
  if (c.MaxRedemptions != null && c.Redeemed >= c.MaxRedemptions) return 'This coupon has been fully used.';
  if (c.AppliesTo !== 'both' && c.AppliesTo !== kind) return kind === 'signup' ? 'This coupon is only for renewals.' : 'This coupon is only for new sign-ups.';
  if (c.Intervals && c.Intervals !== interval) return `This coupon is only for ${c.Intervals} billing.`;
  if (c.PlanCodes) {
    const plans = c.PlanCodes.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (plans.length && !plans.includes(String(planCode).toLowerCase())) return 'This coupon does not apply to the selected plan.';
  }
  return null;
}

/** Discount in paise on the pre-tax subtotal. Never takes the payable amount below ₹1 (a gateway needs > 0). */
export function couponDiscountMinor(c, subtotalMinor) {
  if (!c || subtotalMinor <= 0) return 0;
  const raw = c.PercentOff != null ? Math.round((subtotalMinor * Math.round(Number(c.PercentOff) * 100)) / 10000) : Math.round(Number(c.AmountOff) * 100);
  return Math.max(0, Math.min(raw, subtotalMinor - 100));
}

export const normaliseCouponCode = (s) => String(s || '').trim().toUpperCase();
export const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

// ---------- Platform revenue ----------
/** Monthly recurring revenue of one subscription, in paise (annual plans spread over 12 months; free/trial count 0). */
export function monthlyValueMinor({ interval, monthlyPrice, annualPrice, isFree, isTrial }) {
  if (isFree || isTrial) return 0;
  const p = interval === 'annual' ? Number(annualPrice ?? 0) / 12 : Number(monthlyPrice ?? 0);
  return Math.round(p * 100);
}

// ---------- Support tickets ----------
export const TICKET_CATEGORIES = ['billing', 'technical', 'account', 'feature', 'other'];
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
/** Status after a reply: a hospital reply waits for support, a support reply waits for the hospital; replying re-opens. */
export const statusAfterReply = (by) => (by === 'support' ? 'awaiting_hospital' : 'awaiting_support');

// ---------- Booking ----------
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export function makeRefCode(len = 8) {
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}
/** Online booking window: from today up to `maxDays` ahead (local dates as YYYY-MM-DD strings). */
export function bookingDateAllowed(date, today, maxDays = 30) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) return false;
  const diff = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
  return diff <= maxDays;
}
