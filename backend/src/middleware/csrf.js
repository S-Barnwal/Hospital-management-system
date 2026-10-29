import { forbidden } from '../utils/errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated APIs:
 *  1. Cookies are SameSite=Lax + HttpOnly.
 *  2. State-changing requests must carry the custom header `X-Requested-With`, which browsers
 *     cannot send cross-site without a CORS preflight (and CORS only allows our own origins).
 *  3. If an Origin header is present it must be on the allowlist.
 * Provider webhooks are excluded (they authenticate with an HMAC signature instead).
 */
export function csrfGuard({ allowedOrigins, isAllowedOrigin, exemptPaths = [] }) {
  return (req, _res, next) => {
    if (SAFE.has(req.method)) return next();
    if (exemptPaths.some((p) => req.path.startsWith(p))) return next();
    if (!req.get('x-requested-with')) return next(forbidden('Missing anti-CSRF header.', 'CSRF'));
    const origin = req.get('origin');
    if (origin && !(allowedOrigins.includes(origin) || isAllowedOrigin?.(origin))) {
      return next(forbidden('Origin not allowed.', 'CSRF'));
    }
    return next();
  };
}
