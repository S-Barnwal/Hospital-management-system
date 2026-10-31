// Pure helpers for outgoing messages: phone normalisation and masking (no I/O, unit-tested).

/** Digits-only E.164 without "+", adding the default country code to 10-digit Indian numbers. */
export function normalisePhone(raw, defaultCountryCode = '91') {
  const digits = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits.length === 10 ? `${defaultCountryCode}${digits}` : digits;
}

/** 919876543210 → 91******3210 ; keeps enough to recognise, not enough to misuse. */
export function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 6) return '******';
  return `${d.slice(0, 2)}${'*'.repeat(d.length - 6)}${d.slice(-4)}`;
}

/** priya.nair@gmail.com → p********@gmail.com */
export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!user || !domain) return '***';
  return `${user[0]}${'*'.repeat(Math.max(2, user.length - 1))}@${domain}`;
}

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ''));

/** Escapes text for safe insertion into HTML e-mails. */
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "MediCore HMS <no-reply@x.com>" → "no-reply@x.com" */
export function addressOf(from) {
  const m = /<([^>]+)>/.exec(String(from || ''));
  return (m ? m[1] : String(from || '')).trim();
}

/** Safe display name for an e-mail header (no quotes, angle brackets or line breaks). */
export function headerName(name) {
  return String(name || '').replace(/[\r\n"<>\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export const formatFrom = (name, address) => (name ? `"${headerName(name)}" <${address}>` : address);
