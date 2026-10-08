// Fills the home page's «الجديد في نسخة X.Y.Z» section from scripts/latest-update.json.
//
//     node scripts/build-latest.mjs
//
// The highlights are written in the site's everyday Arabic from that version's release notes,
// strictly that version only, and approved by the owner before they go into the JSON. This
// only rewrites what lies between the LATEST markers in index.html; the buttons and the line
// for existing customers are fixed owner-approved text.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(ROOT, 'scripts', 'latest-update.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(data.version)) throw new Error(`bad version: ${data.version}`);
if (!Array.isArray(data.highlights) || data.highlights.length < 1) throw new Error('no highlights');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const items = data.highlights
  .map(([h, d]) => `        <li><b>${esc(h)}:</b> ${esc(d)}</li>`)
  .join('\n');

const START = '<!-- LATEST:START -->';
const END = '<!-- LATEST:END -->';
const section = `${START}
<section id="latest" class="latest">
  <div class="wrap">
    <div class="latest-box rv">
      <h2>الجديد في نسخة ${esc(data.version)}</h2>
      <p class="latest-date">${esc(data.date)}</p>
      <ul class="latest-list">
${items}
      </ul>
      <div class="latest-cta">
        <a class="btn btn-gold" href="download.html">نزّل النسخة الجديدة</a>
        <a class="btn btn-ghost" href="whats-new.html">كل التحديثات</a>
      </div>
      <p class="latest-note">عندك نسخة قديمة؟ نزّل الجديدة وسطّبها فوقها، بياناتك بتفضل زي ما هي.</p>
    </div>
  </div>
</section>
${END}`;

const path = join(ROOT, 'index.html');
const s = readFileSync(path, 'utf8');
const a = s.indexOf(START);
const b = s.indexOf(END);
if (a < 0 || b < a) throw new Error('LATEST markers not found in index.html');
writeFileSync(path, s.slice(0, a) + section + s.slice(b + END.length));
console.log(`index.html: latest section at ${data.version} (${data.highlights.length} highlights)`);
