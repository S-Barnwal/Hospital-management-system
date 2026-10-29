const SENSITIVE_KEYS = /pass(word)?|token|secret|signature|otp|card|cvv|diagnos|symptom|prescription|note/i;

/** Removes sensitive keys and truncates so audit metadata never carries secrets or clinical details. */
export function sanitiseMetadata(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const clean = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.test(k)) continue;
    if (v === undefined) continue;
    clean[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v;
  }
  const json = JSON.stringify(clean);
  return json.length > 2000 ? json.slice(0, 2000) : json;
}
