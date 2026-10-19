// The owner's final rule (2026-10-19): the admin panel NEVER runs on the public site.
// 1. Every admin endpoint answers 404 on a Production deployment, whatever the env vars say.
// 2. «نشر» copies ONLY the content and brand files from site/preview onto main — never the panel's code — and refuses
//    while main is not yet built from content/site.json. «تراجع» likewise touches only those files.
// Against the in-memory fake of GitHub (test/helpers/fake-github.mjs): it proves our logic, not GitHub's behaviour.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeGitHub, fakeReq, fakeRes } from './helpers/fake-github.mjs';
import { hashPassword } from '../api/_lib/password.js';
import { base32Encode, hotp, stepAt } from '../api/_lib/totp.js';
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
const code = () => hotp(KEY, stepAt(Date.now()));

before(async () => {
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.GITHUB_REPO = 'owner/site';
  process.env.ADMIN_PASSWORD_HASH = await hashPassword(PASSWORD, { iterations: 210000 });
  process.env.ADMIN_TOTP_SECRET = base32Encode(KEY);
  process.env.ADMIN_SESSION_SECRET = 'x'.repeat(48);
  globalThis.fetch = fake.fetch;
  // main as it is today: hand-written pages, no build pipeline, no content file.
  fake.seed('main', { 'index.html': '<!doctype html>live', 'admin.html': 'old panel' });
});
after(() => { delete process.env.VERCEL_ENV; });

test('production: every admin endpoint answers 404 and touches nothing, even with every env var set', async () => {
  process.env.VERCEL_ENV = 'production';
  const callsBefore = fake.calls.length;
  for (const [fn, method, body] of [[login, 'POST', { password: PASSWORD, totp: code() }], [logout, 'POST', {}], [session, 'GET'],
    [contentEp, 'GET'], [logEp, 'GET'], [save, 'POST', { content: {} }], [publish, 'POST', {}], [rollback, 'POST', {}],
    [uploadLogo, 'POST', {}]]) {
    const r = await call(fn, { method, body });
    assert.equal(r.statusCode, 404, fn.name);
    assert.equal(r.headers['set-cookie'], undefined);
  }
  assert.equal(fake.calls.length, callsBefore, 'not one GitHub call — the lockout counter is never read or moved');
  delete process.env.VERCEL_ENV;
});

test('preview: the same login works (the guard is Production only)', async () => {
  process.env.VERCEL_ENV = 'preview';
  const r = await call(login, { method: 'POST', body: { password: PASSWORD, totp: code() } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  cookie = r.headers['set-cookie'].split(';')[0];
});

test('publish: refused while main is not built from content/site.json — nothing on main moves', async () => {
  fake.seed('site/preview', { 'content/site.json': CONTENT_TEXT, 'site-build/build.mjs': 'build', 'api/login.js': 'panel' }, 'main');
  const mainBefore = fake.refs.get('main');
  const r = await call(publish, { method: 'POST', body: {}, cookie });
  assert.equal(r.statusCode, 409);
  assert.match(r.json.error, /لا يُبنى من ملف المحتوى/);
  assert.equal(fake.refs.get('main'), mainBefore);
});

test('publish: only content/site.json and brand/* reach main, in one plain commit; the panel code never does', async () => {
  // main gains the build pipeline (what the owner merges from site/public); the old panel is gone from it.
  const m = fake.commits.get(fake.refs.get('main')).tree;
  m.delete('admin.html');
  for (const [p, v] of Object.entries({ 'content/site.json': CONTENT_TEXT, 'site-build/build.mjs': 'build', 'brand/attarix-mark-h108.png': 'old-mark' })) m.set(p, fake.blob(Buffer.from(v)));
  fake.refs.set('main', fake.commit(m, [fake.refs.get('main')], 'site/public merged'));
  const c = JSON.parse(CONTENT_TEXT);
  c.plans.items[0].monthly = 777;
  assert.equal((await call(save, { method: 'POST', body: { content: c }, cookie })).statusCode, 200);
  fake.seed('site/preview', { 'brand/attarix-mark-h108.png': 'new-mark', 'admin/index.html': 'panel', 'index.html': 'preview page' }, 'site/preview');

  const mainBefore = fake.refs.get('main');
  const r = await call(publish, { method: 'POST', body: {}, cookie });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  const tip = fake.commits.get(fake.refs.get('main'));
  assert.deepEqual(tip.parents, [mainBefore], 'one commit on top of main — not a merge of site/preview');
  const files = fake.filesAt('main');
  assert.equal(JSON.parse(files['content/site.json'].toString()).plans.items[0].monthly, 777);
  assert.equal(files['brand/attarix-mark-h108.png'].toString(), 'new-mark');
  assert.equal(files['index.html'].toString(), '<!doctype html>live', "main's own pages are not taken from the preview");
  for (const p of Object.keys(files)) assert.ok(!/^(api|admin)\//.test(p) && p !== 'admin.html', `no panel file on main: ${p}`);
  assert.equal((await call(publish, { method: 'POST', body: {}, cookie })).statusCode, 409, 'nothing new to publish');
});

test('rollback: restores only content and brand files on main; everything else on main is left as it is', async () => {
  const m = fake.commits.get(fake.refs.get('main')).tree;
  m.set('index.html', fake.blob(Buffer.from('a page changed on main by a release')));
  fake.refs.set('main', fake.commit(m, [fake.refs.get('main')], 'a release'));
  const r = await call(rollback, { method: 'POST', body: {}, cookie });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  const files = fake.filesAt('main');
  assert.equal(files['content/site.json'].toString(), CONTENT_TEXT);
  assert.equal(files['brand/attarix-mark-h108.png'].toString(), 'old-mark');
  assert.equal(files['index.html'].toString(), 'a page changed on main by a release');
  for (const p of Object.keys(files)) assert.ok(!/^(api|admin)\//.test(p), `no panel file on main: ${p}`);
  assert.ok(fake.calls.filter((x) => x.method === 'PATCH').every((x) => x.body.force === false), 'no ref was ever force-moved');
});
