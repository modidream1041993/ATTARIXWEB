// The admin password hash. Format (one line, env ADMIN_PASSWORD_HASH):
//
//     pbkdf2-sha256$<iterations>$<salt, base64>$<derived key, base64>
//
// PBKDF2-HMAC-SHA256, a 16-byte random salt, a 32-byte key. Made by site-build/admin-setup.mjs with 600000
// iterations; a hash with fewer than 210000 iterations is REFUSED (never "accepted but weak").
import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);
export const MIN_ITERATIONS = 210000;
export const DEFAULT_ITERATIONS = 600000;
const KEY_LEN = 32;

export async function hashPassword(password, { iterations = DEFAULT_ITERATIONS, salt = randomBytes(16) } = {}) {
  if (typeof password !== 'string' || password.length === 0) throw new Error('empty password');
  if (iterations < MIN_ITERATIONS) throw new Error('too few iterations');
  const key = await pbkdf2Async(password, salt, iterations, KEY_LEN, 'sha256');
  return `pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function parseHash(stored) {
  const m = /^pbkdf2-sha256\$(\d{6,8})\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/.exec(String(stored || '').trim());
  if (!m) return null;
  const iterations = Number(m[1]);
  const salt = Buffer.from(m[2], 'base64');
  const key = Buffer.from(m[3], 'base64');
  if (iterations < MIN_ITERATIONS || iterations > 10_000_000 || salt.length < 16 || key.length !== KEY_LEN) return null;
  return { iterations, salt, key };
}

// Constant-time comparison of the derived keys. An unparsable stored hash never matches (and is reported apart by
// the caller as a configuration error, not as a wrong password).
export async function verifyPassword(password, stored) {
  const h = parseHash(stored);
  if (!h || typeof password !== 'string') return false;
  const key = await pbkdf2Async(password, h.salt, h.iterations, KEY_LEN, 'sha256');
  return timingSafeEqual(key, h.key);
}
