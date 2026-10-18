// Fills the home page's one-line «آخر نسخة» strip (inside the LATEST markers) from scripts/latest-update.json.
//
//     node scripts/build-latest.mjs
//
// The home page (redone 2026-10-18) sells outcomes; what each version adds lives on «ما الجديد». This only
// rewrites what lies between the LATEST markers in index.html: the version, its date and the link — no highlights.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(ROOT, 'scripts', 'latest-update.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(data.version)) throw new Error(`bad version: ${data.version}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(data.released ?? '')) throw new Error(`bad released date: ${data.released}`);
if (!data.date) throw new Error('no date line');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const START = '<!-- LATEST:START -->';
const END = '<!-- LATEST:END -->';
const section = `${START}
    <p class="latest-strip">آخر نسخة: <b>${esc(data.version)}</b> · ${esc(data.date)} · <a href="whats-new.html">شوف الجديد</a></p>
${END}`;

const path = join(ROOT, 'index.html');
const s = readFileSync(path, 'utf8');
const a = s.indexOf(START);
const b = s.indexOf(END);
if (a < 0 || b < a) throw new Error('LATEST markers not found in index.html');
writeFileSync(path, s.slice(0, a) + section + s.slice(b + END.length));
console.log(`index.html: latest strip at ${data.version}`);

// The app's new-version notice (ATTARIX 2.7.4) reads this public file: the version and its date ONLY — no link (the
// app opens its own fixed download page), nothing else. It must name the version the download page serves.
// From 2.9.1 the file may be SIGNED (`npm run update:sign` in the app's repo — «تنزيل وتثبيت»); a signed file for this
// same version is kept as it is, never replaced by the unsigned shape.
const updatePath = join(ROOT, 'latest-update.json');
let existing = null;
try { existing = JSON.parse(readFileSync(updatePath, 'utf8')); } catch { existing = null; }
if (existing && existing.version === data.version && existing.signature) {
  console.log(`latest-update.json: ${data.version} kept (signed)`);
} else {
  writeFileSync(updatePath, JSON.stringify({ version: data.version, released: data.released }, null, 2) + '\n');
  console.log(`latest-update.json: ${data.version} (${data.released})`);
}
