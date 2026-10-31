// One place for every phone number, e-mail address and address (country / state / city) rule in the API.
// All routes build their zod schemas from these helpers, so the rules are identical everywhere.
//
//  • Phone numbers are checked against the real numbering plan of the chosen country (libphonenumber-js)
//    and stored in international E.164 form: +919876543210. Numbers typed without "+" are read as
//    DEFAULT_PHONE_COUNTRY (India) numbers, so old data and quick typing still work.
//  • E-mail addresses are trimmed, lower-cased and checked more strictly than zod's default.
//  • Country is an ISO-3166 code (IN, US…). State must be one of that country's states (canonical name stored).
//    City is checked for length only — small towns and villages are not all in the city list, and the
//    screen lets the user type one that isn't listed.
import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { geoData } from './geo.js';

export const DEFAULT_PHONE_COUNTRY = 'IN';

/** "98765 43210" / "+91 98765-43210" → { e164: '+919876543210', country: 'IN' } or null if not a real number. */
export function parsePhone(raw, defaultCountry = DEFAULT_PHONE_COUNTRY) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 30) return null;
  if (/[a-z]/i.test(text.replace(/\s*(ext\.?|x)\s*\d+$/i, ''))) return null; // letters are never part of a number
  const p = parsePhoneNumberFromString(text, defaultCountry);
  if (!p || !p.isValid()) return null;
  return { e164: p.number, country: p.country ?? null, type: p.getType() ?? null };
}

/** '' or spaces → null (clear the field); a missing field stays undefined so a PATCH leaves it unchanged. */
function blankToNull(v) { return typeof v === 'string' && v.trim() === '' ? null : v; }

const PHONE_MSG = 'Enter a valid phone number for the selected country (with the right number of digits).';

/** Required phone number → E.164 string. */
export const phoneSchema = z.string({ required_error: 'Phone number is required.' }).trim().min(1, 'Phone number is required.')
  .transform((v, ctx) => {
    const p = parsePhone(v);
    if (!p) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_MSG }); return z.NEVER; }
    return p.e164;
  });

/** Optional phone: '' / null / missing → null, otherwise must be valid. */
export const optionalPhone = z.preprocess(blankToNull, phoneSchema.nullable().optional());

const EMAIL_MSG = 'Enter a valid e-mail address, e.g. name@hospital.com.';
/** Stricter than zod's email(): no spaces, one @, sensible local part, domain with a real-looking TLD. */
export function isValidEmail(v) {
  const s = String(v ?? '');
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

export const emailSchema = z.string({ required_error: 'E-mail is required.' }).trim().toLowerCase().min(1, 'E-mail is required.')
  .refine(isValidEmail, EMAIL_MSG);
export const optionalEmail = z.preprocess(blankToNull, emailSchema.nullable().optional());

// ---------- Country / state / city ----------

export const countrySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Choose a country from the list.')
  .refine((c) => { const g = geoData(); return !g || Boolean(g.Country.getCountryByCode(c)); }, 'Choose a country from the list.');

/**
 * Adds country/state/city to a zod object. The state is checked against the country's list and replaced by its
 * canonical spelling ("maharashtra" → "Maharashtra"). Without a country, the state cannot be checked, so it is
 * only length-limited (keeps old screens and API clients working).
 */
export function withLocation(schema, { required = false } = {}) {
  const str = z.string().trim().max(100);
  const opt = (s) => z.preprocess(blankToNull, s.nullable().optional());
  return schema.extend({
    country: required ? countrySchema : opt(countrySchema),
    state: opt(str), // required only when the country has states — checked below
    city: required ? str.min(1, 'Choose or type a city.') : opt(str),
  }).transform((v, ctx) => {
    const g = geoData();
    if (!g || !v.country) return v;
    const states = g.State.getStatesOfCountry(v.country);
    if (!states.length) return v; // country without a state list: accept as typed
    if (!v.state) {
      if (required) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['state'], message: 'Choose a state.' }); return z.NEVER; }
      return v;
    }
    const match = states.find((s) => s.name.toLowerCase() === v.state.toLowerCase() || s.isoCode.toLowerCase() === v.state.toLowerCase());
    if (!match) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['state'], message: 'Choose a state from the list for the selected country.' }); return z.NEVER; }
    return { ...v, state: match.name };
  });
}
