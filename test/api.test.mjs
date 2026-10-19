// The endpoints end to end, against an in-memory fake of the GitHub API (test/helpers/fake-github.mjs). This proves
// our request handling, validation and branch logic; it does NOT prove GitHub's or Vercel's own behaviour.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { FakeGitHub, fakeReq, fakeRes } from './helpers/fake-github.mjs';
import { hashPassword } from '../api/_lib/password.js';
import { base32Encode, hotp, stepAt } from '../api/_lib/totp.js';
import { COOKIE } from '../api/_lib/session.js';
import { STATE_BRANCH } from '../api/_lib/state.js';
import login from '../api/login.js';
import logout from '../api/logout.js';
import session from '../api/session.js';
import contentEp from '../api/content.js';
import save from '../api/save.js';
import uploadLogo from '../api/upload-logo.js';
import publish from '../api/publish.js';
import rollback from '../api/rollback.js';
import logEp from '../api/log.js';

const CONTENT_TEXT = readFileSync(new URL('../content/site.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const KEY = Buffer.from('0123456789abcdefghij');
const PASSWORD = 'a long test password';
const fake = new FakeGitHub();
let cookie = '';

const call = async (fn, opts) => { const res = fakeRes(); await fn(fakeReq(opts), res); return res; };
const code = (offsetSteps = 0) => hotp(KEY, stepAt(Date.now()) + offsetSteps);

before(async () => {
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.GITHUB_REPO = 'owner/site';
  process.env.ADMIN_PASSWORD_HASH = await hashPassword(PASSWORD, { iterations: 210000 });
  process.env.ADMIN_TOTP_SECRET = base32Encode(KEY);
  process.env.ADMIN_SESSION_SECRET = 'x'.repeat(48);
  process.env.PREVIEW_URL = 'https://attarixx-git-site-preview-example.vercel.app';
  globalThis.fetch = fake.fetch;
  fake.seed('main', {
    'content/site.json': CONTENT_TEXT,
    'index.html': '<!doctype html>{{hero.sub}}',
    'brand/attarix-mark-h108.png': Buffer.from('old-mark'),
    'brand/attarix-wordmark-blue-h51.png': Buffer.from('old-word'),
  });
});

test('without a session every admin endpoint answers 401', async () => {
  for (const [fn, method, body] of [[contentEp, 'GET'], [logEp, 'GET'], [session, 'GET'],
    [save, 'POST', { content: {} }], [publish, 'POST', {}], [rollback, 'POST', {}], [uploadLogo, 'POST', {}]]) {
    const r = await call(fn, { method, body, cookie: `${COOKIE}=v1.9999999999999.AAAAAAAAAAAAAAAAAAAAAA.${'A'.repeat(43)}` });
    assert.equal(r.statusCode, 401, fn.name);
    assert.equal(r.json.ok, false);
  }
});

test('login: wrong password or wrong code → 401 with one generic message; bad shape → 400', async () => {
  const a = await call(login, { method: 'POST', body: { password: 'nope', totp: code() } });
  const b = await call(login, { method: 'POST', body: { password: PASSWORD, totp: code(5) } });
  assert.equal(a.statusCode, 401);
  assert.equal(b.statusCode, 401);
  assert.equal(a.json.error, b.json.error, 'the message does not say which one was wrong');
  assert.equal(a.headers['set-cookie'], undefined);
  assert.equal((await call(login, { method: 'POST', body: { password: PASSWORD } })).statusCode, 400);
  assert.equal((await call(login, { method: 'GET' })).statusCode, 405);
});

test('login: cross-site, non-JSON and oversized requests are refused before anything is checked', async () => {
  const body = { password: PASSWORD, totp: code() };
  assert.equal((await call(login, { method: 'POST', body, headers: { origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await call(login, { method: 'POST', body, headers: { 'sec-fetch-site': 'cross-site' } })).statusCode, 403);
  assert.equal((await call(login, { method: 'POST', body, headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  assert.equal((await call(login, { method: 'POST', body, headers: { 'content-length': '999999' } })).statusCode, 413);
});

test('login: the right password + code sets a hardened session cookie', async () => {
  const r = await call(login, { method: 'POST', body: { password: PASSWORD, totp: code() }, headers: { origin: 'https://admin.test' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  const c = r.headers['set-cookie'];
  for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(c.includes(part), part);
  cookie = c.split(';')[0];
  assert.ok(!JSON.stringify(r.json).includes(process.env.ADMIN_SESSION_SECRET));
  const s = await call(session, { method: 'GET', cookie });
  assert.equal(s.statusCode, 200);
  assert.equal(s.json.previewUrl, process.env.PREVIEW_URL);
});

test('content: read from main while there is no preview branch', async () => {
  const r = await call(contentEp, { method: 'GET', cookie });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json.source, 'main');
  assert.equal(r.json.content.contact.whatsapp, '201090246299');
});

test('save: an invalid or injected edit is refused with field paths, and nothing is committed', async () => {
  const c = JSON.parse(CONTENT_TEXT);
  c.hero.titleHighlight = '<script>alert(1)</script>';
  c.contact.whatsapp = '+20 109';
  const r = await call(save, { method: 'POST', body: { content: c }, cookie });
  assert.equal(r.statusCode, 400);
  const paths = r.json.errors.map((e) => e.path);
  assert.ok(paths.includes('hero.titleHighlight') && paths.includes('contact.whatsapp'));
  assert.equal(fake.refs.has('site/preview'), false);
});

test('save: a valid edit lands on site/preview only; main is untouched', async () => {
  const mainBefore = fake.refs.get('main');
  const c = JSON.parse(CONTENT_TEXT);
  c.plans.items[0].monthly = 599;
  const r = await call(save, { method: 'POST', body: { content: c }, cookie });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.changed, ['plans.items[0].monthly']);
  assert.equal(fake.refs.get('main'), mainBefore);
  assert.equal(JSON.parse(fake.textAt('site/preview', 'content/site.json')).plans.items[0].monthly, 599);
  const again = await call(save, { method: 'POST', body: { content: c }, cookie });
  assert.equal(again.json.unchanged, true);
  assert.equal((await call(contentEp, { method: 'GET', cookie })).json.source, 'site/preview');
});

test('publish: records main, then merges site/preview into main with a merge commit', async () => {
  const mainBefore = fake.refs.get('main');
  const r = await call(publish, { method: 'POST', body: {}, cookie });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  const merged = fake.commits.get(fake.refs.get('main'));
  assert.equal(merged.parents.length, 2, 'a normal merge commit');
  assert.equal(merged.parents[0], mainBefore);
  assert.equal(JSON.parse(fake.textAt('main', 'content/site.json')).plans.items[0].monthly, 599);
  const history = JSON.parse(fake.textAt(STATE_BRANCH, 'publish-history.json'));
  assert.equal(history.at(-1).mainBefore, mainBefore);
  assert.equal(history.at(-1).status, 'done');
  const again = await call(publish, { method: 'POST', body: {}, cookie });
  assert.equal(again.statusCode, 409, 'nothing new to publish');
});

test('upload-logo: the original and every generated size go to site/preview in one commit', async () => {
  const png = await sharp({ create: { width: 1000, height: 850, channels: 4, background: '#0B5590' } }).png().toBuffer();
  const tipBefore = fake.refs.get('site/preview');
  const r = await call(uploadLogo, { method: 'POST', body: { kind: 'mark', filename: 'new-mark.PNG', dataBase64: png.toString('base64') }, cookie });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  assert.equal(r.json.sizes.length, 9);
  const files = fake.filesAt('site/preview');
  assert.ok(files['brand/original/mark.png'].equals(png), 'the original is kept byte for byte');
  assert.equal((await sharp(files['brand/attarix-mark-h108.png']).metadata()).height, 108);
  const tipAfter = fake.refs.get('site/preview');
  assert.equal(fake.commits.get(tipAfter).parents[0], tipBefore, 'one commit on top of the preview');
  assert.equal(fake.textAt('main', 'brand/attarix-mark-h108.png'), 'old-mark', 'main is untouched until publish');
  const evil = await call(uploadLogo, { method: 'POST', body: { kind: 'mark', filename: 'x.svg', dataBase64: Buffer.from('<svg onload="alert(1)"/>').toString('base64') }, cookie });
  assert.equal(evil.statusCode, 400);
  assert.equal((await call(publish, { method: 'POST', body: {}, cookie })).statusCode, 200);
  assert.notEqual(fake.textAt('main', 'brand/attarix-mark-h108.png'), 'old-mark');
});

test('rollback: a new commit on main restores the previous publish, then the one before; preview follows', async () => {
  const tip = fake.refs.get('main');
  const r1 = await call(rollback, { method: 'POST', body: {}, cookie });
  assert.equal(r1.statusCode, 200, JSON.stringify(r1.json));
  assert.equal(fake.commits.get(fake.refs.get('main')).parents[0], tip, 'a new commit on top — history is kept');
  assert.equal(fake.textAt('main', 'brand/attarix-mark-h108.png'), 'old-mark', 'the logo publish is undone');
  assert.equal(fake.filesAt('main')['brand/original/mark.png'], undefined, 'the uploaded original is removed again');
  assert.equal(JSON.parse(fake.textAt('main', 'content/site.json')).plans.items[0].monthly, 599, 'the earlier publish stays');
  assert.equal(fake.textAt('site/preview', 'content/site.json'), fake.textAt('main', 'content/site.json'));

  const r2 = await call(rollback, { method: 'POST', body: {}, cookie });
  assert.equal(r2.statusCode, 200);
  assert.equal(fake.textAt('main', 'content/site.json'), CONTENT_TEXT, 'back to the content before the first publish');
  assert.equal(fake.textAt('site/preview', 'content/site.json'), CONTENT_TEXT);
  assert.equal((await call(rollback, { method: 'POST', body: {}, cookie })).statusCode, 409, 'nothing left to undo');
  assert.ok(fake.calls.filter((c) => c.method === 'PATCH').every((c) => c.body.force === false), 'no ref was ever force-moved');
});

test('log: every change is recorded, newest first; logout clears the cookie', async () => {
  const r = await call(logEp, { method: 'GET', cookie });
  assert.equal(r.statusCode, 200);
  const actions = r.json.entries.map((e) => e.action);
  for (const a of ['login', 'save', 'publish', 'upload-logo', 'rollback']) assert.ok(actions.includes(a), a);
  assert.equal(actions[0], 'rollback');
  const out = await call(logout, { method: 'POST', body: {} });
  assert.ok(out.headers['set-cookie'].includes('Max-Age=0'));
  const all = JSON.stringify([...fake.blobs.values()].map((b) => b.toString('latin1')));
  for (const secret of [process.env.ADMIN_SESSION_SECRET, process.env.ADMIN_TOTP_SECRET, PASSWORD, 'test-token']) {
    assert.ok(!all.includes(secret), 'no secret is ever written to the repository');
  }
});
