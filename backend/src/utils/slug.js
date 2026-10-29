// Hospital workspace slugs become subdomains: <slug>.app.example.com
export const RESERVED_SLUGS = new Set([
  'www', 'app', 'admin', 'api', 'mail', 'smtp', 'static', 'assets', 'cdn', 'status', 'help', 'support',
  'docs', 'blog', 'login', 'register', 'billing', 'dashboard', 'staging', 'dev', 'test', 'demo', 'root', 'system',
]);

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

export function normaliseSlug(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 63);
}

export function validateSlug(slug) {
  if (!SLUG_RE.test(slug)) return 'Use 3–63 lowercase letters, numbers or hyphens (not starting or ending with a hyphen).';
  if (RESERVED_SLUGS.has(slug)) return 'This workspace name is reserved. Please choose another.';
  return null;
}

/**
 * Extracts a tenant slug from a request hostname, given the platform base domain.
 * Base "app.example.com": "green-valley.app.example.com" → "green-valley"; "app.example.com" → null.
 * Base "localhost":       "green-valley.localhost"       → "green-valley" (works in Chrome/Firefox).
 */
export function slugFromHost(hostname, baseDomain) {
  if (!hostname || !baseDomain) return null;
  const host = hostname.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const base = baseDomain.toLowerCase();
  if (host === base || !host.endsWith(`.${base}`)) return null;
  const sub = host.slice(0, -(base.length + 1));
  if (!sub || sub.includes('.')) return null; // only one label deep
  if (RESERVED_SLUGS.has(sub)) return null;
  return SLUG_RE.test(sub) ? sub : null;
}
