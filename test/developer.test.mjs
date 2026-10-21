// The developer credit (owner, 2026-10-21): every page's footer links «Mad Genius» to /developer, and /developer is a
// TEMPORARY redirect (307) to the home page — the app (2.9.3) opens https://attarixx.vercel.app/developer, so the owner
// can point it at the developer's own site later without a new app release. Nothing links to madgenius1.com yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const PAGES = ['index.html', 'about.html', 'download.html', 'product.html', 'products.html', 'whats-new.html', 'ATTARIX-GUIDE.html', 'scripts/build-whats-new.mjs'];

test('/developer is a temporary redirect to the home page', () => {
  const conf = JSON.parse(read('vercel.json'));
  const r = conf.redirects.filter((x) => x.source === '/developer');
  assert.equal(r.length, 1);
  assert.equal(r[0].destination, '/');
  // Vercel answers 307 for permanent: false (308 for true — browsers would cache that, and it could never move again).
  assert.equal(r[0].permanent, false);
  assert.equal(r[0].statusCode, undefined);
});

test('every page credits the developer and links to /developer, never to madgenius1.com', () => {
  for (const f of PAGES) {
    const s = read(f);
    assert.match(s, /تطوير <a href="\/developer" dir="ltr">Mad Genius<\/a>/, f);
    assert.doesNotMatch(s, /madgenius1/, f);
  }
});
