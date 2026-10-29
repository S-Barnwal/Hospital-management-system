import { badRequest } from './errors.js';

/** Parses a positive integer route parameter (e.g. :id) or throws 400. */
export function idParam(value, name = 'id') {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw badRequest(`Invalid ${name}.`);
  return n;
}

/** Parses an optional ISO date/datetime query parameter or throws 400. */
export function dateParam(value, name = 'date') {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid ${name}.`);
  return d;
}
