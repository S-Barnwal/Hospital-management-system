// Phone & e-mail helpers for the screens. The same rules are enforced again on the server (backend/src/utils/contact.js).
import { createElement } from 'react';
import { parsePhoneNumberFromString, getCountries, getCountryCallingCode } from 'libphonenumber-js/max';

export const DEFAULT_COUNTRY = 'IN';

const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
export const countryName = (iso2) => regionNames?.of(iso2) ?? iso2;
export const flagOf = (iso2) => String(iso2 || '').toUpperCase().replace(/[A-Z]/g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

/** Windows has no flag emoji (it shows the letters "IN"), so there we show a neat country-code badge instead. */
export const FLAG_EMOJI = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return false;
    c.font = '32px sans-serif';
    // A real flag is one wide glyph; without support the two regional letters are drawn side by side (much wider).
    return c.measureText('🇮🇳').width < c.measureText('NN').width * 1.6 && !/Windows/i.test(navigator.userAgent);
  } catch { return false; }
})();

/** Flag emoji where supported, otherwise a small "IN" badge. */
export const flagNode = (iso2) => (FLAG_EMOJI ? flagOf(iso2)
  : createElement('span', { className: 'inline-block w-6 rounded bg-forest-50 text-center font-mono text-[10px] font-bold leading-5 text-forest-800' }, String(iso2 || '').toUpperCase()));

/** Every country that has a phone numbering plan: [{ value: 'IN', label: 'India', prefix: '🇮🇳', hint: '+91' }] sorted by name. */
export const PHONE_COUNTRIES = getCountries()
  .map((c) => ({ value: c, label: countryName(c), prefix: flagNode(c), hint: `+${getCountryCallingCode(c)}`, keywords: `${c} +${getCountryCallingCode(c)} ${getCountryCallingCode(c)}` }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** '+919876543210' → { country: 'IN', national: '98765 43210', e164, valid } (works for old unformatted values too). */
export function splitPhone(value, fallbackCountry = DEFAULT_COUNTRY) {
  const raw = String(value ?? '').trim();
  if (!raw) return { country: fallbackCountry, national: '', e164: '', valid: false };
  const p = parsePhoneNumberFromString(raw, fallbackCountry);
  if (!p) return { country: fallbackCountry, national: raw.replace(/^\+\d{1,3}\s*/, ''), e164: '', valid: false };
  // Show the number as written inside the country, without the trunk 0 ("98765 43210", not "098765 43210").
  return { country: p.country ?? fallbackCountry, national: p.formatInternational().replace(/^\+\d+\s*/, ''), e164: p.number, valid: p.isValid() };
}

/** Country + typed digits → value to send ('+91…'); '' when nothing typed. */
export function joinPhone(country, national) {
  const digits = String(national ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  const p = parsePhoneNumberFromString(digits, country);
  return p ? p.number : `+${getCountryCallingCode(country)}${digits}`;
}

export const isValidPhone = (value, country = DEFAULT_COUNTRY) => Boolean(value && parsePhoneNumberFromString(String(value), country)?.isValid());

/** Shows a stored number nicely: +919876543210 → +91 98765 43210. Unknown formats are shown as stored. */
export function formatPhone(value) {
  if (!value) return '';
  const p = parsePhoneNumberFromString(String(value), DEFAULT_COUNTRY);
  return p?.isValid() ? p.formatInternational() : String(value);
}

/** Same rule as the server: one @, sensible name part, real-looking domain and extension. */
export function isValidEmail(v) {
  const s = String(v ?? '').trim();
  if (s.length > 254 || /\s/.test(s)) return false;
  const at = s.lastIndexOf('@');
  if (at < 1 || s.indexOf('@') !== at) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i.test(local)) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(l))) return false;
  return /^[a-z]{2,24}$/i.test(labels[labels.length - 1]);
}
