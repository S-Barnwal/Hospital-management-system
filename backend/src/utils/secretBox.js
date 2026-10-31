// AES-256-GCM encryption for secrets stored in the database (e.g. a hospital's SMTP password).
// Key: MESSAGING_ENCRYPTION_KEY = 32 random bytes, base64. Losing the key means re-entering the secrets.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export function parseKey(b64) {
  if (!b64) return null;
  const key = Buffer.from(String(b64), 'base64');
  return key.length === 32 ? key : null;
}

/** Returns "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function seal(plainText, key) {
  if (!key) throw new Error('Encryption key is not configured.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

/** Decrypts a value from seal(); throws if it was tampered with or the key is wrong. */
export function open(sealed, key) {
  if (!key) throw new Error('Encryption key is not configured.');
  const [v, iv, tag, data] = String(sealed).split('.');
  if (v !== VERSION || !iv || !tag || !data) throw new Error('Unrecognised secret format.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
