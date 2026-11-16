// The developer credit (owner, 2026-10-21): every page's footer links «Mad Genius» to /developer, and /developer is a
// TEMPORARY redirect (307) to the home page — the app (2.9.3) opens the old vercel.app /developer, which now forwards
// (301) to attarix.net/developer, so the owner can point it at the developer's own site later without a new app release.
// Nothing links to madgenius1.com yet. The site is served by Cloudflare since 2026-11-16: the rule lives in _redirects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const PAGES = ['index.html', 'about.html', 'download.html', 'product.html', 'products.html', 'whats-new.html', 'ATTARIX-GUIDE.html', 'scripts/build-whats-new.mjs'];

test('/developer is a temporary redirect to the home page', () => {
  const rules = read('_redirects').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/));
  const r = rules.filter((x) => x[0] === '/developer');
  assert.equal(r.length, 1);
  assert.equal(r[0][1], '/');
  // 307, never 301/308 — browsers would cache a permanent one, and it could never move again.
  assert.equal(r[0][2], '307');
});

test('the installer links and /guide survive the move to Cloudflare', () => {
  const s = read('_redirects');
  assert.match(s, /^\/guide\s+\/ATTARIX-GUIDE\s+200$/m);
  assert.match(s, /^\/ATTARIX-Setup\.exe\s+https:\/\/github\.com\/modidream1041993\/ATTARIXWEB\/releases\/download\/\S+\s+302$/m);
  assert.match(s, /^\/Attarix_2\.3\.0_x64-setup\.exe\s+https:\/\/github\.com\/modidream1041993\/ATTARIXWEB\/releases\/download\/\S+\s+302$/m);
});

test('every page credits the developer and links to /developer, never to madgenius1.com', () => {
  for (const f of PAGES) {
    const s = read(f);
    assert.match(s, /تطوير <a href="\/developer" dir="ltr">Mad Genius<\/a>/, f);
    assert.doesNotMatch(s, /madgenius1/, f);
  }
});
