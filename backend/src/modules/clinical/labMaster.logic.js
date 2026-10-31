// Pure rules for the lab master data (departments, input types, dropdown options, decimals) — unit-tested in
// tests/unit/labMaster.test.js. No clinical values live here: tests, ranges and options are configured per hospital.

export const INPUT_TYPES = ['numeric', 'text', 'option'];
export const OPTION_SEPARATOR = '|';
export const MAX_OPTIONS = 30;

/** ['Positive', 'Negative'] → 'Positive|Negative'. Throws with a clear message on bad input. */
export function packOptions(list) {
  if (list == null) return null;
  const clean = [];
  for (const raw of list) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    if (v.includes(OPTION_SEPARATOR)) throw new Error(`An option cannot contain "${OPTION_SEPARATOR}".`);
    if (v.length > 60) throw new Error('Each option can be at most 60 characters.');
    if (clean.some((c) => c.toLowerCase() === v.toLowerCase())) throw new Error(`"${v}" is listed twice.`);
    clean.push(v);
  }
  if (clean.length > MAX_OPTIONS) throw new Error(`At most ${MAX_OPTIONS} options.`);
  return clean.length ? clean.join(OPTION_SEPARATOR) : null;
}

export const unpackOptions = (s) => (s ? String(s).split(OPTION_SEPARATOR).map((x) => x.trim()).filter(Boolean) : []);

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/**
 * Checks one entered result against its configuration. Returns { value, numeric, error }.
 * - option: must be one of the configured choices (case-insensitive; stored with the configured spelling)
 * - numeric: any text is accepted (labs write "<0.5", ">1000", "Hemolysed"), but only plain numbers get a numeric value
 * - text: free text
 * - heading rows never take a value
 */
export function checkResult({ inputType, options, isHeading }, raw) {
  const value = raw == null ? null : String(raw).trim() || null;
  if (isHeading) return value === null ? { value: null, numeric: null } : { error: 'Heading rows do not take a result.' };
  if (value === null) return { value: null, numeric: null };
  const type = INPUT_TYPES.includes(inputType) ? inputType : 'numeric';
  if (type === 'option') {
    const match = unpackOptions(options).find((o) => o.toLowerCase() === value.toLowerCase());
    if (!match) return { error: `Choose one of: ${unpackOptions(options).join(', ')}.` };
    return { value: match, numeric: null };
  }
  if (type === 'text') return { value, numeric: null };
  return { value, numeric: NUMERIC_RE.test(value) ? Number(value) : null };
}

/** Shows a numeric result with the configured decimals ("12.5" with 2 → "12.50"); anything else unchanged. */
export function formatResult(value, decimals) {
  if (value == null || decimals == null || !NUMERIC_RE.test(String(value).trim())) return value;
  return Number(value).toFixed(Number(decimals));
}

/** A panel is complete when every parameter that takes a value (not headings) has one. */
export const panelComplete = (rows) => rows.filter((r) => !r.isHeading).every((r) => r.value != null && r.value !== '');

/** Order of tests on a report: department order, then department name, then package, then entry order. */
export function reportOrder(a, b) {
  const sa = a.departmentSort ?? 9999; const sb = b.departmentSort ?? 9999;
  if (sa !== sb) return sa - sb;
  const da = a.department || '~'; const dbn = b.department || '~';
  if (da !== dbn) return da.localeCompare(dbn);
  const pa = a.packageName || ''; const pb = b.packageName || '';
  if (pa !== pb) return pa.localeCompare(pb);
  return Number(a.id) - Number(b.id);
}

/**
 * Validates CSV import rows (already parsed into objects with lower-case keys). Returns { rows, errors } where every
 * error names the line number. Duplicate codes inside the file are refused; codes already in the catalogue are
 * reported by the caller (update vs skip is the user's choice).
 */
export function checkImportRows(input) {
  const rows = []; const errors = [];
  const codes = new Set();
  input.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const code = String(r.code ?? '').trim().toUpperCase();
    const name = String(r.name ?? '').trim();
    const problems = [];
    if (!/^[A-Z0-9_-]{1,20}$/.test(code)) problems.push('code must be 1–20 letters, numbers, - or _');
    if (name.length < 2 || name.length > 150) problems.push('name must be 2–150 characters');
    if (codes.has(code)) problems.push(`code ${code} appears twice in the file`);
    const num = (k) => {
      const v = String(r[k] ?? '').trim();
      if (v === '') return null;
      if (!NUMERIC_RE.test(v)) { problems.push(`${k} must be a number`); return null; }
      return Number(v);
    };
    const refLow = num('reflow'); const refHigh = num('refhigh'); const criticalLow = num('criticallow'); const criticalHigh = num('criticalhigh');
    if (criticalLow != null && criticalHigh != null && criticalHigh <= criticalLow) problems.push('criticalHigh must be above criticalLow'); const price = num('price'); const tatHours = num('tathours'); const decimals = num('decimals');
    if (refLow != null && refHigh != null && refHigh < refLow) problems.push('refHigh must be ≥ refLow');
    if (price != null && (price < 0 || price > 1e7)) problems.push('price must be 0–10,000,000');
    if (decimals != null && (decimals < 0 || decimals > 6 || !Number.isInteger(decimals))) problems.push('decimals must be 0–6');
    if (tatHours != null && (tatHours <= 0 || tatHours > 2160 || !Number.isInteger(tatHours))) problems.push('tatHours must be 1–2160');
    const inputType = String(r.inputtype ?? '').trim().toLowerCase() || 'numeric';
    if (!INPUT_TYPES.includes(inputType)) problems.push('inputType must be numeric, text or option');
    let options = null;
    try { options = packOptions(String(r.options ?? '').split(/[|;]/)); } catch (e) { problems.push(e.message); }
    if (inputType === 'option' && !options) problems.push('option tests need options (separate with |)');
    const text = (k, max) => { const v = String(r[k] ?? '').trim(); if (v.length > max) problems.push(`${k} is longer than ${max}`); return v || null; };
    const row = {
      code, name, department: text('department', 60), sampleType: text('sampletype', 40), unit: text('unit', 30), refLow, refHigh,
      refText: text('reftext', 100), price: price ?? 0, method: text('method', 150), instrument: text('instrument', 150),
      interpretation: text('interpretation', 2000), inputType, options, decimals, tatHours, criticalLow, criticalHigh,
    };
    codes.add(code);
    if (problems.length) errors.push({ line, code: code || null, message: problems.join('; ') });
    else rows.push(row);
  });
  return { rows, errors };
}
