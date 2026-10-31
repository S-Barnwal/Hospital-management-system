// Pure rules for Phase 3 (no I/O) — unit-tested in tests/unit/phase3.test.js.

// ---------- Lab ----------
/** Overall flag of a panel from its parameter flags: any low/high/abnormal → 'abnormal', all normal → 'normal'. */
export function panelFlag(flags) {
  const f = flags.filter(Boolean);
  if (!f.length) return null;
  return f.some((x) => x !== 'normal') ? 'abnormal' : 'normal';
}

/**
 * Patient trend series from result rows [{ key, name, unit, refLow, refHigh, at, value(numeric), flag }]:
 * one series per test/parameter with ≥ 1 numeric value, points oldest → newest.
 */
export function buildTrends(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.value === null || r.value === undefined || Number.isNaN(Number(r.value))) continue;
    if (!map.has(r.key)) map.set(r.key, { key: r.key, name: r.name, unit: r.unit ?? null, refLow: r.refLow ?? null, refHigh: r.refHigh ?? null, points: [] });
    map.get(r.key).points.push({ at: r.at, value: Number(r.value), flag: r.flag ?? null, orderNumber: r.orderNumber ?? null });
  }
  return [...map.values()]
    .map((s) => ({ ...s, points: s.points.sort((a, b) => new Date(a.at) - new Date(b.at)) }))
    .sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name));
}

export const HOME_STATUS_FLOW = {
  scheduled: ['assigned', 'cancelled'],
  assigned: ['on_the_way', 'collected', 'scheduled', 'cancelled'],
  on_the_way: ['collected', 'assigned', 'cancelled'],
  collected: [],
  cancelled: [],
};
export const canMoveHome = (from, to) => (HOME_STATUS_FLOW[from] || []).includes(to);

// ---------- Pharmacy ----------
/** Purchase-order status from its lines. */
export function poStatusFromLines(lines, current) {
  if (current === 'cancelled' || current === 'draft') return current;
  const received = lines.reduce((a, l) => a + Number(l.receivedQuantity || 0), 0);
  if (received === 0) return 'ordered';
  return lines.every((l) => Number(l.receivedQuantity) >= Number(l.quantity)) ? 'received' : 'partially_received';
}

/** EAN-8/EAN-13/UPC-A check digit is valid (other formats — Code128, QR text — are accepted as typed). */
export function isValidEan(code) {
  const s = String(code || '');
  if (!/^\d{8}$|^\d{12,13}$/.test(s)) return false;
  const digits = [...s].map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
export const BARCODE_RE = /^[A-Za-z0-9\-_.]{4,64}$/;

// ---------- Dates ----------
const ymdToDate = (s) => new Date(`${s}T00:00:00Z`);
const dateToYmd = (d) => d.toISOString().slice(0, 10);

/** Next due date for a recurring expense; month-based steps keep the day, clamped to the month end (31 Jan → 28/29 Feb). */
export function addFrequency(ymd, frequency, anchorDay = null) {
  const d = ymdToDate(ymd);
  if (frequency === 'weekly') { d.setUTCDate(d.getUTCDate() + 7); return dateToYmd(d); }
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[frequency];
  if (!months) throw new Error('Unknown frequency');
  const day = anchorDay ?? d.getUTCDate();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return dateToYmd(new Date(Date.UTC(y, m, Math.min(day, last))));
}

/** All due dates from nextDue up to today (inclusive), at most `cap`, stopping after endDate. */
export function dueDatesUpTo(nextDue, today, frequency, endDate = null, cap = 24) {
  const out = [];
  const anchor = ymdToDate(nextDue).getUTCDate();
  let d = nextDue;
  while (d <= today && (!endDate || d <= endDate) && out.length < cap) {
    out.push(d);
    d = addFrequency(d, frequency, anchor);
  }
  return { due: out, next: d };
}

/** Days between two dates inclusive (leave length). */
export const inclusiveDays = (from, to) => Math.round((ymdToDate(to) - ymdToDate(from)) / 86400000) + 1;
export const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

// ---------- Payroll ----------
/**
 * Pay for a month. Every day counts as paid except: absent (0), half day (0.5) and approved UNPAID leave (0).
 * Unmarked days count as paid (most small hospitals mark only exceptions). Money in paise.
 */
export function computePayroll({ monthlySalary, month, attendance = {}, unpaidLeaveDays = 0, allowances = 0, deductions = 0 }) {
  const total = daysInMonth(month);
  const absent = Number(attendance.absent || 0);
  const half = Number(attendance.half_day || 0);
  const paidDays = Math.max(0, Math.round((total - absent - half * 0.5 - Number(unpaidLeaveDays || 0)) * 10) / 10);
  const salaryMinor = Math.round(Number(monthlySalary) * 100);
  const grossMinor = Math.round((salaryMinor * paidDays) / total);
  const netMinor = Math.max(0, grossMinor + Math.round(Number(allowances) * 100) - Math.round(Number(deductions) * 100));
  return { daysInMonth: total, paidDays, gross: (grossMinor / 100).toFixed(2), net: (netMinor / 100).toFixed(2) };
}

// ---------- Files ----------
/** File type from its first bytes (never trust the browser's name or Content-Type). */
export function sniffFileType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Safe file name for Content-Disposition (letters, digits, dot, dash, underscore, space). */
export const safeFileName = (name, fallback = 'file') => (String(name || '').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || fallback);
