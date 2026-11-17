// The developer's page (owner, 2026-11-17): Mahmoud Ahmed / Mad Genius, served at https://attarix.net/mad-genius from
// mad-genius.html. It is the owner's own file, shipped exactly as he gave it — self-contained (the logo images are data
// URIs) — with only two lines added to <head>: the canonical URL and og:url. Nothing else may change it: no restyle,
// no rewrite, and the build copies it byte for byte (it is not one of the content TEMPLATES).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, TEMPLATES } from '../site-build/build.mjs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url));
const ADDED = '<link rel="canonical" href="https://attarix.net/mad-genius">\n<meta property="og:url" content="https://attarix.net/mad-genius">\n';
// sha256 of the file as the owner gave it (2026-11-17).
const ORIGINAL_SHA256 = 'e455bc0c6ebec725a2583c9b6911d053dbfd76d6d340cdde98358987c5f5ab16';

test('mad-genius.html is the owner\'s file plus the canonical URL and og:url, nothing else', () => {
  const page = read('mad-genius.html').toString('utf8');
  assert.equal(page.split(ADDED).length, 2, 'the two lines are there, once');
  const original = page.replace(ADDED, '');
  assert.equal(createHash('sha256').update(original, 'utf8').digest('hex'), ORIGINAL_SHA256);
  assert.match(page, /<meta property="og:type" content="profile">\n<link rel="canonical" href="https:\/\/attarix\.net\/mad-genius">/);
});

test('its header is the CSS logo, not an image', () => {
  const header = /<header>[\s\S]*?<\/header>/.exec(read('mad-genius.html').toString('utf8'))[0];
  assert.match(header, /class="mg-logo"><span class="mg-mad">MAD<\/span><span class="mg-gen">GENIUS<\/span>/);
  assert.doesNotMatch(header, /<img[^>]*alt="Mad Genius"/);
});

test('/mad-genius/ goes to /mad-genius (301), and the page is in the sitemap', () => {
  assert.match(read('_redirects').toString('utf8'), /^\/mad-genius\/\s+\/mad-genius\s+301$/m);
  assert.match(read('sitemap.xml').toString('utf8'), /<loc>https:\/\/attarix\.net\/mad-genius<\/loc>\s*<lastmod>2026-11-17T00:00:00\+00:00<\/lastmod>/);
});

test('the build ships it byte for byte, and leaves latest-update.json alone', () => {
  assert.ok(!TEMPLATES.includes('mad-genius.html'), 'never rendered from content');
  const out = mkdtempSync(join(tmpdir(), 'mg-'));
  try {
    build({ outDir: out, env: {} });
    assert.ok(read('mad-genius.html').equals(readFileSync(join(out, 'mad-genius.html'))));
    assert.ok(read('latest-update.json').equals(readFileSync(join(out, 'latest-update.json'))));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
