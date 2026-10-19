// TOTP (RFC 6238 vectors), the password hash, and the session token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotp, verifyTotp, base32Encode, base32Decode, stepAt, otpauthUri } from '../api/_lib/totp.js';
import { hashPassword, verifyPassword, parseHash, MIN_ITERATIONS } from '../api/_lib/password.js';
import { createToken, verifyToken, sessionCookie, clearedCookie, readCookie, requireSession, COOKIE, SESSION_MS } from '../api/_lib/session.js';

// RFC 6238 Appendix B: T0 = 0, X = 30, 8 digits. Seeds are the ASCII strings below.
const SEEDS = {
  sha1: Buffer.from('12345678901234567890'),
  sha256: Buffer.from('12345678901234567890123456789012'),
  sha512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
};
const VECTORS = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

test('TOTP: every RFC 6238 Appendix B vector (SHA1, SHA256, SHA512)', () => {
  for (const [t, s1, s256, s512] of VECTORS) {
    const counter = Math.floor(t / 30);
    assert.equal(hotp(SEEDS.sha1, counter, { digits: 8 }), s1, `sha1 T=${t}`);
    assert.equal(hotp(SEEDS.sha256, counter, { digits: 8, algorithm: 'sha256' }), s256, `sha256 T=${t}`);
    assert.equal(hotp(SEEDS.sha512, counter, { digits: 8, algorithm: 'sha512' }), s512, `sha512 T=${t}`);
  }
});

test('base32: RFC 4648 vectors and a round trip', () => {
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.equal(base32Encode(Buffer.from('f')), 'MY');
  assert.equal(base32Decode('MZXW6YTBOI').toString(), 'foobar');
  assert.equal(base32Decode('mzxw 6ytb oi==').toString(), 'foobar');
  const b = Buffer.from([0, 1, 2, 250, 255, 7, 99, 128, 3, 9]);
  assert.deepEqual(base32Decode(base32Encode(b)), b);
  assert.throws(() => base32Decode('MZ1!'));
});

test('TOTP verify: 6 digits, ±1 step of drift, nothing further, malformed codes refused', () => {
  const secret = base32Encode(SEEDS.sha1);
  const now = 1111111111 * 1000;
  const step = stepAt(now);
  const code = (s) => hotp(SEEDS.sha1, s);
  assert.equal(verifyTotp(secret, code(step), now), step);
  assert.equal(verifyTotp(secret, code(step - 1), now), step - 1);
  assert.equal(verifyTotp(secret, code(step + 1), now), step + 1);
  assert.equal(verifyTotp(secret, code(step - 2), now), -1);
  assert.equal(verifyTotp(secret, code(step + 2), now), -1);
  assert.equal(verifyTotp(secret, '12345', now), -1);
  assert.equal(verifyTotp(secret, '1234567', now), -1);
  assert.equal(verifyTotp(secret, '12345a', now), -1);
  assert.equal(verifyTotp(secret, 123456, now), -1);
  assert.equal(verifyTotp('not base32 !', code(step), now), -1);
  assert.equal(verifyTotp('MZXW6', code(step), now), -1, 'a secret shorter than 80 bits is refused');
});

test('otpauth URI names the issuer and the parameters Google Authenticator reads', () => {
  const u = otpauthUri({ secret: 'ABC', account: 'owner', issuer: 'ATTARIX Admin' });
  assert.equal(u, 'otpauth://totp/ATTARIX%20Admin%3Aowner?secret=ABC&issuer=ATTARIX%20Admin&algorithm=SHA1&digits=6&period=30');
});

test('password hash: PBKDF2-SHA256, right password only, documented format', async () => {
  const stored = await hashPassword('correct horse battery', { iterations: MIN_ITERATIONS });
  assert.match(stored, /^pbkdf2-sha256\$210000\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(await verifyPassword('correct horse battery', stored), true);
  assert.equal(await verifyPassword('correct horse batterY', stored), false);
  assert.equal(await verifyPassword('', stored), false);
  // Same password, new salt → a different hash.
  assert.notEqual(await hashPassword('correct horse battery', { iterations: MIN_ITERATIONS }), stored);
});

test('password hash: a tampered, weak or malformed hash never verifies', async () => {
  const stored = await hashPassword('pw-1234567890', { iterations: MIN_ITERATIONS });
  const [alg, it, salt, key] = stored.split('$');
  const flipped = Buffer.from(key, 'base64'); flipped[0] ^= 1;
  assert.equal(await verifyPassword('pw-1234567890', [alg, it, salt, flipped.toString('base64')].join('$')), false);
  assert.equal(parseHash([alg, '209999', salt, key].join('$')), null, 'fewer than 210000 iterations is refused');
  assert.equal(await verifyPassword('pw-1234567890', [alg, '209999', salt, key].join('$')), false);
  assert.equal(await verifyPassword('pw-1234567890', ['pbkdf2-sha1', it, salt, key].join('$')), false);
  assert.equal(await verifyPassword('pw-1234567890', ''), false);
  assert.equal(await verifyPassword('pw-1234567890', undefined), false);
  await assert.rejects(() => hashPassword('x', { iterations: 1000 }));
});

const SECRET = 's'.repeat(40);

test('session token: valid for 8 hours, then refused', () => {
  const t0 = 1_800_000_000_000;
  const tok = createToken(SECRET, t0);
  assert.equal(verifyToken(SECRET, tok, t0), true);
  assert.equal(verifyToken(SECRET, tok, t0 + SESSION_MS - 1), true);
  assert.equal(verifyToken(SECRET, tok, t0 + SESSION_MS), false);
  assert.equal(SESSION_MS, 8 * 60 * 60 * 1000);
});

test('session token: a changed signature, expiry, nonce or secret is refused', () => {
  const t0 = 1_800_000_000_000;
  const tok = createToken(SECRET, t0);
  const [v, exp, nonce, sig] = tok.split('.');
  const flip = (s) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
  assert.equal(verifyToken(SECRET, [v, exp, nonce, flip(sig)].join('.'), t0), false);
  assert.equal(verifyToken(SECRET, [v, String(Number(exp) + 1000), nonce, sig].join('.'), t0), false, 'a longer expiry breaks the signature');
  assert.equal(verifyToken(SECRET, [v, exp, flip(nonce), sig].join('.'), t0), false);
  assert.equal(verifyToken(`${SECRET}x`, tok, t0), false);
  assert.equal(verifyToken(SECRET, 'v1.garbage', t0), false);
  assert.equal(verifyToken(SECRET, null, t0), false);
  assert.equal(verifyToken('short', tok, t0), false, 'a short secret never verifies');
  assert.throws(() => createToken('short', t0));
});

test('session cookie: HttpOnly, Secure, SameSite=Strict, Path=/, 8 h; cleared on logout', () => {
  const c = sessionCookie('abc');
  for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) assert.ok(c.includes(part), part);
  assert.ok(c.startsWith(`${COOKIE}=abc;`));
  assert.ok(clearedCookie().includes('Max-Age=0'));
  assert.equal(readCookie({ headers: { cookie: `a=1; ${COOKIE}=tok; b=2` } }), 'tok');
  assert.equal(readCookie({ headers: {} }), null);
  const tok = createToken(SECRET);
  assert.doesNotThrow(() => requireSession({ headers: { cookie: `${COOKIE}=${tok}` } }, SECRET));
  assert.throws(() => requireSession({ headers: {} }, SECRET), (e) => e.status === 401);
});
