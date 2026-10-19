// TOTP, RFC 6238 (HMAC-SHA1, 6 digits, 30-second steps), for the second login factor (Google Authenticator).
// The secret is base32 (RFC 4648, no padding needed), env ADMIN_TOTP_SECRET.
import { createHmac, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  if (!/^[A-Z2-7]+$/.test(clean)) throw new Error('bad base32');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// HOTP (RFC 4226) for one counter; digits default 6. `algorithm` is sha1 for Google Authenticator; sha256/sha512
// exist only so the RFC 6238 test vectors can be checked.
export function hotp(key, counter, { digits = 6, algorithm = 'sha1' } = {}) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const STEP_SECONDS = 30;
export const stepAt = (nowMs) => Math.floor(nowMs / 1000 / STEP_SECONDS);

// Checks a 6-digit code against the steps now-1, now, now+1 (±30 s of clock drift). Returns the matching step
// number (so the caller can refuse its reuse), or -1. Every candidate is compared, in constant time.
export function verifyTotp(secretBase32, code, nowMs = Date.now(), window = 1) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return -1;
  let key;
  try { key = base32Decode(secretBase32); } catch { return -1; }
  if (key.length < 10) return -1;
  const now = stepAt(nowMs);
  let found = -1;
  const given = Buffer.from(code);
  for (let s = now - window; s <= now + window; s++) {
    if (s < 0) continue;
    const expected = Buffer.from(hotp(key, s));
    if (timingSafeEqual(expected, given) && found === -1) found = s;
  }
  return found;
}

export function otpauthUri({ secret, account = 'owner', issuer = 'ATTARIX Admin' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
