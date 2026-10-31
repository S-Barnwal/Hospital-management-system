// Display rules for lab results shared by the lab order page and the patient report page.
// The server already sends lines in report order (department order → department → package → entry order).

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/** "12.5" with 2 decimals → "12.50"; anything that is not a plain number is shown as entered. */
export function formatResult(value, decimals) {
  if (value == null || value === '') return value;
  if (decimals == null || !NUMERIC_RE.test(String(value).trim())) return value;
  return Number(value).toFixed(Number(decimals));
}

/** Reference range text for a line or parameter. */
export const refRange = (r) => (r.refLow != null || r.refHigh != null ? `${r.refLow ?? ''} – ${r.refHigh ?? ''}` : r.refText ?? '—');

/** [[department, items], …] keeping server order. */
export function groupByDepartment(items) {
  const groups = [];
  for (const i of items) {
    const name = i.department || 'Other tests';
    const last = groups[groups.length - 1];
    if (last && last[0] === name) last[1].push(i); else groups.push([name, [i]]);
  }
  return groups;
}

/** Method / instrument line printed under a test name. */
export const methodLine = (i) => [i.method && `Method: ${i.method}`, i.instrument && `Instrument: ${i.instrument}`].filter(Boolean).join(' · ');
