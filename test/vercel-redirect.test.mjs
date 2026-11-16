// attarixx.vercel.app is redirect-only since 2026-11-16: the site lives on Cloudflare at https://attarix.net.
// ONE exception, and it must never go: installed apps (v3.1.3 and older) read https://attarixx.vercel.app/latest-update.json
// with fetch(..., { redirect: 'error' }) — a 301 there would silently end their update checks. So Vercel still builds
// the site and serves that one signed file directly (200, same bytes as main). Keep this Vercel project; deleting it
// would also free the name attarixx.vercel.app for anyone to claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const conf = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('vercel.json sends every path to attarix.net with a 301, except latest-update.json', () => {
  assert.equal(conf.redirects.length, 1);
  const [r] = conf.redirects;
  assert.equal(r.destination, 'https://attarix.net/$1');
  assert.equal(r.statusCode, 301);
  const re = new RegExp(`^${r.source}$`);
  for (const p of ['/', '/download', '/download.html', '/developer', '/ATTARIX-Setup.exe', '/videos/6-hr.mp4', '/latest-update.json.bak', '/x/latest-update.json']) {
    assert.ok(re.test(p), `${p} redirects`);
  }
  assert.equal(re.test('/latest-update.json'), false, 'the update file is served by Vercel itself');
});

test('Vercel still builds the site, so latest-update.json exists to serve', () => {
  assert.equal(conf.buildCommand, 'node site-build/build.mjs');
  assert.equal(conf.outputDirectory, 'dist');
  assert.equal(conf.git.deploymentEnabled['admin-state'], false);
  assert.equal(conf.rewrites, undefined, 'no rewrite may run before the redirect');
});
