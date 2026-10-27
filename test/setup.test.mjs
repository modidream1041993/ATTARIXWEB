// The owner's setup script: the secrets it makes, and the offline QR page (the CLI's prompts and writes are not run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSecrets, makePasswordReset, resetFileName, MIN_PASSWORD } from '../site-build/admin-setup.mjs';
import { verifyPassword, parseHash } from '../api/_lib/password.js';
import { base32Decode, verifyTotp, hotp, stepAt } from '../api/_lib/totp.js';
import { createToken, verifyToken } from '../api/_lib/session.js';

test('makeSecrets: a verifying hash, a 160-bit TOTP secret, a 256-bit session secret, three env lines', async () => {
  const s = await makeSecrets('a long enough password');
  const h = parseHash(s.passwordHash);
  assert.ok(h && h.iterations >= 600000);
  assert.equal(await verifyPassword('a long enough password', s.passwordHash), true);
  assert.equal(base32Decode(s.totpSecret).length, 20);
  const now = Date.now();
  assert.equal(verifyTotp(s.totpSecret, hotp(base32Decode(s.totpSecret), stepAt(now)), now), stepAt(now));
  assert.equal(Buffer.from(s.sessionSecret, 'base64url').length, 32);
  assert.equal(verifyToken(s.sessionSecret, createToken(s.sessionSecret)), true);
  const lines = s.envText.split('\n').filter((l) => /^[A-Z_]+=/.test(l));
  assert.deepEqual(lines.map((l) => l.split('=')[0]), ['ADMIN_PASSWORD_HASH', 'ADMIN_TOTP_SECRET', 'ADMIN_SESSION_SECRET']);
  assert.ok(!s.envText.includes('a long enough password'), 'the password itself is never written');
});

test('makeSecrets: two runs never share a secret; a short password is refused', async () => {
  const a = await makeSecrets('another long password');
  const b = await makeSecrets('another long password');
  assert.notEqual(a.totpSecret, b.totpSecret);
  assert.notEqual(a.sessionSecret, b.sessionSecret);
  assert.notEqual(a.passwordHash, b.passwordHash);
  await assert.rejects(() => makeSecrets('x'.repeat(MIN_PASSWORD - 1)));
});

test('the QR page is made offline: an inline SVG, no script, no network, the secret not in plain text', async () => {
  const s = await makeSecrets('a long enough password');
  assert.match(s.uri, /^otpauth:\/\/totp\/ATTARIX%20Admin%3Aowner\?secret=[A-Z2-7]+&issuer=ATTARIX%20Admin&/);
  assert.ok(s.qrHtml.includes('<svg'));
  assert.ok(!/<script/i.test(s.qrHtml));
  assert.ok(!/https?:\/\//.test(s.qrHtml.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')), 'nothing is loaded from the network');
  assert.ok(!s.qrHtml.includes(s.totpSecret), 'the secret is only inside the QR drawing');
});

test('a forgotten password: a new hash and a new session secret, the TOTP secret NOT touched', async () => {
  const r = await makePasswordReset('the new long password');
  assert.equal(await verifyPassword('the new long password', r.passwordHash), true);
  assert.equal(await verifyPassword('the old long password', r.passwordHash), false);
  assert.equal(Buffer.from(r.sessionSecret, 'base64url').length, 32);
  const lines = r.envText.split('\n').filter((l) => /^[A-Z_]+=/.test(l));
  assert.deepEqual(lines.map((l) => l.split('=')[0]), ['ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET']);
  assert.ok(!/^ADMIN_TOTP_SECRET=/m.test(r.envText), 'the phone code stays as it is');
  assert.ok(!r.envText.includes('the new long password'), 'the password itself is never written');
  await assert.rejects(() => makePasswordReset('x'.repeat(MIN_PASSWORD - 1)));
  const again = await makePasswordReset('the new long password');
  assert.notEqual(again.sessionSecret, r.sessionSecret);
});

test('each reset writes its own file, named by the local time', () => {
  assert.equal(resetFileName(new Date(2026, 9, 27, 9, 5, 3)), 'password-reset-2026-10-27-090503.txt');
});
