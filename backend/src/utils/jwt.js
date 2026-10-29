// Minimal HS256 JWT implementation using node:crypto (no third-party dependency).
// Access tokens are short-lived; refresh is handled by server-side sessions (see auth service).
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signJwt(payload, secret, ttlSec, now = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error('JWT secret missing');
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/** Returns the payload, or null when the token is malformed, tampered with or expired. */
export function verifyJwt(token, secret, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (header?.alg !== 'HS256') return null; // reject alg=none and algorithm confusion
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  let given;
  try { given = Buffer.from(s, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  return payload;
}
