// Pure rules for Phase 2 (no database, no Express) — unit-tested in tests/unit/phase2.test.js.
import { bedDays } from './logic.js';
import { paise } from '../invoices/invoice.logic.js';
import { fromMinor } from '../../utils/pricing.js';

// ---------- Vitals ----------
/**
 * Adult reference ranges used only to HIGHLIGHT readings for the nurse/doctor — never to diagnose.
 * [low, high, criticalLow, criticalHigh]
 */
export const VITAL_RANGES = {
  temperatureC: [36.1, 37.5, 35, 39.5],
  pulseBpm: [60, 100, 40, 130],
  bpSystolic: [90, 140, 80, 180],
  bpDiastolic: [60, 90, 50, 110],
  respiratoryRate: [12, 20, 8, 30],
  spo2: [95, 100, 90, 101],
  bloodSugarMgdl: [70, 180, 54, 300],
  painScore: [0, 3, -1, 7],
};

/** { pulseBpm: 132, spo2: 93 } → { pulseBpm: 'critical_high', spo2: 'low' } (normal values are left out). */
export function vitalFlags(v) {
  const out = {};
  for (const [k, [lo, hi, cLo, cHi]] of Object.entries(VITAL_RANGES)) {
    const raw = v?.[k];
    if (raw === null || raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    if (n <= cLo) out[k] = 'critical_low';
    else if (n >= cHi) out[k] = 'critical_high';
    else if (n < lo) out[k] = 'low';
    else if (n > hi) out[k] = 'high';
  }
  return out;
}

export const hasAnyVital = (v) => ['temperatureC', 'pulseBpm', 'bpSystolic', 'bpDiastolic', 'respiratoryRate', 'spo2', 'bloodSugarMgdl', 'painScore', 'weightKg']
  .some((k) => v?.[k] !== null && v?.[k] !== undefined && v?.[k] !== '');

// ---------- Bed charges ----------
const localDate = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

/**
 * The calendar days to charge for an admission, in the hospital's time zone: one per started 24 hours
 * (same count as the discharge rule `bedDays`), starting on the admission date. Admitted 30 Oct 22:00, now 31 Oct 23:00
 * → ['2026-10-30', '2026-10-31'].
 */
export function bedChargeDates(admittedAt, until, tz = 'Asia/Kolkata') {
  const n = bedDays(admittedAt, until);
  const first = localDate(admittedAt, tz);
  const [y, m, d] = first.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}

// ---------- Deposits ----------
/** Balance from ledger rows [{ Kind, Amount }]: deposits − applied − refunds (2-dp string). */
export function depositBalance(rows) {
  const p = (rows || []).reduce((s, r) => s + (r.Kind === 'deposit' ? 1 : -1) * paise(r.Amount), 0);
  return fromMinor(p);
}

// ---------- Cash closing ----------
export const METHODS = ['cash', 'card', 'upi', 'bank', 'other', 'deposit'];

/**
 * Money a user handled in a period. rows: [{ source: 'bill'|'deposit', kind: 'payment'|'refund'|'deposit'|'applied', method, amount }]
 * • Bill payments by "deposit" just move money already counted when the deposit was taken — they are shown but not in cash.
 * • Expected cash in the drawer = opening float + cash in − cash out.
 */
export function cashSummary(rows, openingFloat = 0) {
  const by = Object.fromEntries(METHODS.map((m) => [m, { in: 0, out: 0 }]));
  let count = 0;
  for (const r of rows || []) {
    if (r.kind === 'applied') continue; // internal transfer deposit → bill
    const m = METHODS.includes(r.method) ? r.method : 'other';
    const a = paise(r.amount);
    if (r.kind === 'refund') by[m].out += a; else by[m].in += a;
    count += 1;
  }
  const totals = Object.fromEntries(Object.entries(by).map(([m, v]) => [m, { in: fromMinor(v.in), out: fromMinor(v.out), net: fromMinor(v.in - v.out) }]));
  const expectedCash = paise(openingFloat) + by.cash.in - by.cash.out;
  return { totals, transactions: count, expectedCash: fromMinor(expectedCash) };
}

/** Indian notes & coins: { '500': 4, '10': 3 } → '2030.00'. Unknown denominations are refused. */
export const DENOMINATIONS = ['2000', '500', '200', '100', '50', '20', '10', '5', '2', '1'];
export function denominationTotal(d) {
  let p = 0;
  for (const [k, v] of Object.entries(d || {})) {
    if (!DENOMINATIONS.includes(k)) throw new Error(`Unknown denomination ${k}`);
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error(`Invalid count for ₹${k}`);
    p += Number(k) * 100 * n;
  }
  return fromMinor(p);
}

// ---------- UPI payment links ----------
export const UPI_ID_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

/** upi://pay link understood by every Indian UPI app (amount fixed, note = bill number). */
export function upiUri({ upiId, payeeName, amount, note }) {
  if (!UPI_ID_RE.test(String(upiId || ''))) throw new Error('Invalid UPI ID');
  const q = new URLSearchParams({ pa: upiId, pn: String(payeeName || '').slice(0, 50), am: Number(amount).toFixed(2), cu: 'INR', tn: String(note || '').slice(0, 50) });
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

// ---------- Follow-ups ----------
/** 'overdue' | 'today' | 'upcoming' for a follow-up date (YYYY-MM-DD) against today's local date. */
export function followUpBucket(date, today) {
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  return 'upcoming';
}
