// The developer credit (owner, 2026-10-21): every page's footer links «Mad Genius» to /developer — the app (2.9.3) opens
// https://attarixx.vercel.app/developer too. Since 2026-10-24 /developer is the developer's portfolio PAGE
// (developer.html, served at /developer by cleanUrls), no longer a redirect: English, no tracking, no form backend,
// kept apart from the shop-owner pages (not in the main nav — only the footer credit links to it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const PAGES = ['index.html', 'about.html', 'download.html', 'product.html', 'products.html', 'whats-new.html', 'ATTARIX-GUIDE.html', 'scripts/build-whats-new.mjs'];

test('/developer is a page now, not a redirect', () => {
  const conf = JSON.parse(read('vercel.json'));
  assert.equal(conf.redirects.filter((x) => x.source === '/developer').length, 0);
  assert.equal(conf.cleanUrls, true);
  assert.ok(existsSync(new URL('../developer.html', import.meta.url)));
});

test('every page credits the developer and links to /developer, never to madgenius1.com', () => {
  for (const f of PAGES) {
    const s = read(f);
    assert.match(s, /تطوير <a href="\/developer" dir="ltr">Mad Genius<\/a>/, f);
    assert.doesNotMatch(s, /madgenius1/, f);
  }
});

test('the shop pages link to /developer from the footer credit only — never from the main nav', () => {
  for (const f of PAGES.filter((p) => p.endsWith('.html'))) {
    const s = read(f);
    assert.equal((s.match(/href="\/developer"/g) ?? []).length, 1, f);
    const nav = s.match(/<nav[\s\S]*?<\/nav>/g) ?? [];
    for (const n of nav) assert.doesNotMatch(n, /developer/, `${f}: nav`);
  }
});

test('the portfolio: English, no tracking, no form backend, nothing loaded from elsewhere', () => {
  const s = read('developer.html');
  assert.match(s, /<html lang="en"/);
  assert.doesNotMatch(s, /pixel\.js|fbq\(|vercel-insights|googletagmanager|google-analytics|gtag\(/);
  assert.doesNotMatch(s, /<script[^>]+src=/, 'no external script');
  assert.doesNotMatch(s, /<form/, 'no form backend');
  assert.doesNotMatch(s, /<link[^>]+href="https?:/, 'no external stylesheet or font');
  assert.match(s, /MahmoudAhmedDev1@gmail\.com/);
  assert.match(s, /data-copy="MahmoudAhmedDev1@gmail\.com"/);
  assert.match(s, /prefers-color-scheme: dark/);
  assert.match(s, /name="viewport"/);
});

test('the case study keeps the security limits: no key locations, licence format, ports, secrets or internal URLs', () => {
  const s = read('developer.html');
  for (const bad of [/ATTARIX-SECRETS/i, /license\.dat/i, /AI_KEY|AI_COMPAT/, /\b(?:9222|5175|5432)\b/, /RELEASE_KEYS|EXPIRY_FLOOR/,
    /ATRX-[0-9A-Z]{4}/, /latest-update\.json/, /releases\/download/, /HKLM|HKCU|Policies\\/, /\.key\b/, /admin123/]) {
    assert.doesNotMatch(s, bad, String(bad));
  }
});

test('the nine diagrams are drawn into the page, and every number matches the case study', () => {
  const s = read('developer.html');
  assert.equal((s.match(/<figure class="diagram">/g) ?? []).length, 9);
  for (const n of ['64,300', '18,300', '3,702', '364', '921', '596']) assert.ok(s.includes(n), n);
});

test('a CV link, when present, points at a file that is in the site', () => {
  const s = read('developer.html');
  for (const [, href] of s.matchAll(/href="(\/developer\/[^"]+\.pdf)"/g)) {
    assert.ok(existsSync(new URL(`..${href}`, import.meta.url)), href);
  }
});
