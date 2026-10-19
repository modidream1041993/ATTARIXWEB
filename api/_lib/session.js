// The admin session: a stateless token in an HttpOnly cookie, signed with HMAC-SHA256 (env ADMIN_SESSION_SECRET).
//
//     v1.<expiry, ms since epoch>.<16 random bytes, base64url>.<HMAC-SHA256 of "v1.<expiry>.<nonce>", base64url>
//
// Valid for 8 hours. Logout clears the cookie on this browser; a token copied off a device stays valid until its
// expiry (there is no server-side session list) — rotate ADMIN_SESSION_SECRET to end every session at once.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';

export const COOKIE = '__Host-attarix_admin';
export const SESSION_MS = 8 * 60 * 60 * 1000;

const sign = (secret, payload) => createHmac('sha256', secret).update(payload).digest('base64url');

export function assertSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('session secret too short');
}

export function createToken(secret, nowMs = Date.now()) {
  assertSecret(secret);
  const payload = `v1.${nowMs + SESSION_MS}.${randomBytes(16).toString('base64url')}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyToken(secret, token, nowMs = Date.now()) {
  try { assertSecret(secret); } catch { return false; }
  if (typeof token !== 'string' || token.length > 200) return false;
  const m = /^(v1\.(\d{13})\.([A-Za-z0-9_-]{22}))\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const expected = Buffer.from(sign(secret, m[1]));
  const given = Buffer.from(m[4]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  const exp = Number(m[2]);
  return exp > nowMs && exp <= nowMs + SESSION_MS + 60_000;
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Max-Age=${SESSION_MS / 1000}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
export function clearedCookie() {
  return `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function readCookie(req, name = COOKIE) {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function requireSession(req, secret = process.env.ADMIN_SESSION_SECRET, nowMs = Date.now()) {
  if (!verifyToken(secret, readCookie(req), nowMs)) throw new HttpError(401, 'سجّل الدخول من جديد');
}
