import { createHash, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256Hex = (value) => createHash('sha256').update(String(value)).digest('hex');
export const hmacHex = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');

/** Constant-time comparison of two hex/utf8 strings. */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
