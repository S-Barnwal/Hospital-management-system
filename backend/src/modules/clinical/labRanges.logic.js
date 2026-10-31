// Pure rules for lab reference ranges by age & gender and critical values (lab upgrade, chunk 3) — unit-tested in
// tests/unit/labRanges.test.js. No clinical numbers live here: every range is entered by the hospital's own lab.

export const AGE_UNITS = ['d', 'm', 'y'];
export const RANGE_GENDERS = ['any', 'male', 'female'];
export const MAX_RANGES_PER_TEST = 200;
const UNIT_DAYS = { d: 1, m: 30.4375, y: 365.25 };
const UNIT_LABEL = { d: 'd', m: 'mo', y: 'y' };

/**
 * Completed age of a patient on a date, in days, months and years (calendar based, like a birthday).
 * dob / on: 'YYYY-MM-DD' strings or Date. Returns null when the date of birth is unknown or in the future.
 */
export function ageOn(dob, on = new Date()) {
  if (!dob) return null;
  const b = new Date(typeof dob === 'string' ? `${dob.slice(0, 10)}T00:00:00Z` : dob);
  const d = new Date(typeof on === 'string' ? `${on.slice(0, 10)}T00:00:00Z` : on);
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime())) return null;
  const by = b.getUTCFullYear(); const bm = b.getUTCMonth(); const bd = b.getUTCDate();
  const dy = d.getUTCFullYear(); const dm = d.getUTCMonth(); const dd = d.getUTCDate();
  const days = Math.floor((Date.UTC(dy, dm, dd) - Date.UTC(by, bm, bd)) / 86400000);
  if (days < 0) return null;
  let months = (dy - by) * 12 + (dm - bm);
  if (dd < bd) months -= 1;
  return { d: days, m: Math.max(0, months), y: Math.max(0, Math.floor(months / 12)) };
}

/** Does a patient of this age fall inside the range's age band [from, to)? Unknown age matches only an "all ages" band. */
export function ageMatches(range, age) {
  const fromAll = !range.ageFrom;
  const toAll = range.ageTo == null;
  if (!age) return fromAll && toAll;
  if (!fromAll && age[range.ageFromUnit || 'y'] < range.ageFrom) return false;
  if (!toAll && age[range.ageToUnit || 'y'] >= range.ageTo) return false;
  return true;
}

const approxDays = (v, unit) => (v == null ? Infinity : v * UNIT_DAYS[unit || 'y']);
const spanDays = (r) => approxDays(r.ageTo, r.ageToUnit) - approxDays(r.ageFrom || 0, r.ageFromUnit);

/**
 * Chooses the range for one test or parameter. Patient gender 'male' / 'female' prefers a range for that gender over
 * 'any'; then the narrowest age band wins; then sortOrder. Returns null when nothing matches (the caller then keeps the
 * test's default range).
 */
export function pickRange(ranges, { gender, age }) {
  const g = gender === 'male' || gender === 'female' ? gender : null;
  const fits = ranges.filter((r) => (r.gender === 'any' || (g && r.gender === g)) && ageMatches(r, age));
  if (!fits.length) return null;
  return [...fits].sort((a, b) => (a.gender === 'any') - (b.gender === 'any') || spanDays(a) - spanDays(b) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
}

/** Short label printed with the range, e.g. "Female · 12 y – 50 y", "All · up to 30 d". */
export function rangeLabel(r) {
  const who = r.gender === 'male' ? 'Male' : r.gender === 'female' ? 'Female' : 'All';
  const from = r.ageFrom ? `${r.ageFrom} ${UNIT_LABEL[r.ageFromUnit || 'y']}` : null;
  const to = r.ageTo != null ? `${r.ageTo} ${UNIT_LABEL[r.ageToUnit || 'y']}` : null;
  const ages = from && to ? `${from} – ${to}` : from ? `${from} +` : to ? `up to ${to}` : null;
  return ages ? `${who} · ${ages}` : who;
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Flag of a numeric result: crit_low / crit_high (beyond the critical limits), low / high (outside the normal range),
 * normal, or null when no limits are set / the value is not a plain number.
 */
export function flagFor(value, { refLow, refHigh, criticalLow, criticalHigh }) {
  const n = num(value);
  if (n === null || !Number.isFinite(n)) return null;
  const cl = num(criticalLow); const ch = num(criticalHigh); const lo = num(refLow); const hi = num(refHigh);
  if (cl !== null && n < cl) return 'crit_low';
  if (ch !== null && n > ch) return 'crit_high';
  if (lo !== null && n < lo) return 'low';
  if (hi !== null && n > hi) return 'high';
  if (lo === null && hi === null) return null;
  return 'normal';
}

export const isCritical = (flag) => flag === 'crit_low' || flag === 'crit_high';

/** Summary flag of a panel: critical beats abnormal beats normal. */
export function panelFlagWithCritical(flags) {
  const f = flags.filter(Boolean);
  if (!f.length) return null;
  if (f.some(isCritical)) return f.includes('crit_low') && !f.includes('crit_high') ? 'crit_low' : 'crit_high';
  return f.some((x) => x !== 'normal') ? 'abnormal' : 'normal';
}

/**
 * Validates and normalises the ranges of one test (input from the API or a CSV). Returns { ranges, errors } where
 * errors are [{ index, message }]. Overlapping age bands for the same parameter and the same gender are refused.
 */
export function checkRanges(input, { parameterIds = [] } = {}) {
  const errors = []; const ranges = [];
  const allowed = new Set(parameterIds.map(Number));
  if (input.length > MAX_RANGES_PER_TEST) return { ranges: [], errors: [{ index: -1, message: `At most ${MAX_RANGES_PER_TEST} ranges per test.` }] };
  input.forEach((r, index) => {
    const p = [];
    const parameterId = r.parameterId == null || r.parameterId === '' ? null : Number(r.parameterId);
    if (parameterId !== null && !allowed.has(parameterId)) p.push('parameter does not belong to this test');
    const gender = String(r.gender || 'any').toLowerCase();
    if (!RANGE_GENDERS.includes(gender)) p.push('gender must be any, male or female');
    const int = (v, name, max) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > max) { p.push(`${name} must be a whole number 0–${max}`); return null; }
      return n;
    };
    const ageFrom = int(r.ageFrom, 'age from', 1200) ?? 0;
    const ageTo = int(r.ageTo, 'age to', 1200);
    const ageFromUnit = String(r.ageFromUnit || 'y').toLowerCase(); const ageToUnit = String(r.ageToUnit || 'y').toLowerCase();
    if (!AGE_UNITS.includes(ageFromUnit) || !AGE_UNITS.includes(ageToUnit)) p.push('age unit must be d, m or y');
    if (ageTo !== null && approxDays(ageTo, ageToUnit) <= approxDays(ageFrom, ageFromUnit)) p.push('age to must be after age from');
    const dec = (v, name) => {
      const n = num(v);
      if (n !== null && (!Number.isFinite(n) || Math.abs(n) > 1e6)) { p.push(`${name} must be a number`); return null; }
      return n;
    };
    const refLow = dec(r.refLow, 'low'); const refHigh = dec(r.refHigh, 'high');
    const criticalLow = dec(r.criticalLow, 'critical low'); const criticalHigh = dec(r.criticalHigh, 'critical high');
    const refText = r.refText == null ? null : String(r.refText).trim().slice(0, 101) || null;
    if (refText && refText.length > 100) p.push('reference text is longer than 100');
    if (refLow !== null && refHigh !== null && refHigh < refLow) p.push('high must be ≥ low');
    if (criticalLow !== null && criticalHigh !== null && criticalHigh <= criticalLow) p.push('critical high must be above critical low');
    if (criticalLow !== null && refLow !== null && criticalLow > refLow) p.push('critical low must be at or below the normal low');
    if (criticalHigh !== null && refHigh !== null && criticalHigh < refHigh) p.push('critical high must be at or above the normal high');
    if (refLow === null && refHigh === null && !refText && criticalLow === null && criticalHigh === null) p.push('enter a range, a reference text or critical limits');
    if (p.length) { errors.push({ index, message: p.join('; ') }); return; }
    ranges.push({ parameterId, gender, ageFrom, ageFromUnit, ageTo, ageToUnit, refLow, refHigh, refText, criticalLow, criticalHigh, sortOrder: index });
  });
  // Overlap: same parameter + same gender, age bands intersecting.
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      const a = ranges[i]; const b = ranges[j];
      if (a.parameterId !== b.parameterId || a.gender !== b.gender) continue;
      const a0 = approxDays(a.ageFrom, a.ageFromUnit); const a1 = approxDays(a.ageTo, a.ageToUnit);
      const b0 = approxDays(b.ageFrom, b.ageFromUnit); const b1 = approxDays(b.ageTo, b.ageToUnit);
      if (a0 < b1 && b0 < a1) errors.push({ index: j, message: `overlaps another ${a.gender === 'any' ? 'all-gender' : a.gender} range (${rangeLabel(a)})` });
    }
  }
  return { ranges, errors };
}
