export const BRAND = import.meta.env?.VITE_BRAND_NAME || 'MediCore HMS';

export function money(value, currency = 'INR') {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  const digits = Number.isInteger(n) ? 0 : 2; // ₹2,999 but ₹5,398.20
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function dateTime(value, timeZone) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
}

export function date(value, timeZone) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone }).format(new Date(value));
}

export function time(value, timeZone) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone }).format(new Date(value));
}

/** YYYY-MM-DD for "today" in a timezone. */
export const todayIn = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function age(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a -= 1;
  return a;
}

export const fullName = (first, last) => [first, last].filter(Boolean).join(' ');
export const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function relative(value) {
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(diff) < 60) return 'just now';
  if (Math.abs(diff) < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (Math.abs(diff) < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  return rtf.format(-Math.round(diff / 86400), 'day');
}
