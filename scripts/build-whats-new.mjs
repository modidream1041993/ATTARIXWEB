// Builds whats-new.html («ما الجديد») from the desktop app's merchant-facing release notes.
//
//     node scripts/build-whats-new.mjs ../accounting-app/docs/release-notes.md 2.6.1 2.6.5
//
// The notes are the owner-approved formal text (accounting-app docs/release-notes.md, newest
// first) and are copied as they are — this only turns their Markdown (## headings, **bold**,
// "- " bullets, paragraphs) into the site's HTML. The generated page is committed; Vercel
// serves it as a plain static file (this folder is in .vercelignore). Re-run it after each
// release, with the new upper version.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [notesPath, from, to] = process.argv.slice(2);
if (!notesPath || !from || !to) {
  console.error('usage: node scripts/build-whats-new.mjs <release-notes.md> <from version> <to version>');
  process.exit(1);
}

const cmp = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

// Sections are "## الإصدار X.Y.Z" … up to the next "## ". Anything else in the file (its title,
// its note about where the technical side lives, a version still being prepared) is not shown.
const md = readFileSync(notesPath, 'utf8').replace(/\r\n/g, '\n');
const sections = [];
let current = null;
for (const line of md.split('\n')) {
  const h = line.match(/^## الإصدار (\d+\.\d+\.\d+)\s*$/);
  if (h) {
    current = { version: h[1], lines: [] };
    sections.push(current);
    continue;
  }
  if (line.startsWith('## ')) {
    current = null; // a heading with anything after the version (e.g. «قيد الإصدار») is not shipped
    continue;
  }
  if (current) current.lines.push(line);
}
const chosen = sections
  .filter((s) => cmp(s.version, from) >= 0 && cmp(s.version, to) <= 0)
  .sort((a, b) => cmp(b.version, a.version));
if (chosen.length === 0) throw new Error(`no released version between ${from} and ${to} in ${notesPath}`);

const body = (lines) => {
  const out = [];
  let list = null;
  const flush = () => {
    if (list) out.push(`<ul>\n${list.map((li) => `  <li>${inline(li)}</li>`).join('\n')}\n</ul>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === '---' || line === '') {
      flush();
      continue;
    }
    const li = line.match(/^- (.*)$/);
    if (li) {
      (list ??= []).push(li[1]);
      continue;
    }
    flush();
    out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('\n');
};

const articles = chosen
  .map((s) => `<article class="wn-ver rv" id="v${s.version}">\n<h2>الإصدار ${s.version}</h2>\n${body(s.lines)}\n</article>`)
  .join('\n\n');

const NAV = [
  ['index.html', 'الرئيسية'],
  ['download.html', 'تحميل البرنامج'],
  ['whats-new.html', 'ما الجديد'],
  ['products.html', 'المنتجات'],
  ['about.html', 'عنّنا'],
];
const nav = NAV.map(([href, label]) => `      <a href="${href}"${href === 'whats-new.html' ? ' class="active"' : ''}>${label}</a>`).join('\n');
const foot = NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join(' · ');

const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ما الجديد في ATTARIX</title>
<meta name="description" content="كل نسخة جديدة من ATTARIX وأهم اللي اتغيّر فيها، الأحدث الأول." />
<meta property="og:type" content="website" />
<meta property="og:title" content="ما الجديد في ATTARIX" />
<meta property="og:locale" content="ar_EG" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231d4ed8'/%3E%3Ctext x='32' y='44' font-size='36' font-weight='bold' text-anchor='middle' fill='white' font-family='Arial'%3EA%3C/text%3E%3C/svg%3E" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="site.css">
<script defer src="https://cdn.vercel-insights.com/v1/script.js"></script>
<style>
  /* خاص بصفحة «ما الجديد» فقط — الباقي كله من site.css */
  .wn-wrap{max-width:760px;margin:0 auto;padding:0 20px}
  .wn-hero{text-align:center;padding:46px 0 18px}
  .wn-hero h1{font-size:clamp(28px,6vw,44px);line-height:1.3;font-weight:900;margin-bottom:12px}
  .wn-hero p{color:var(--muted);font-size:clamp(15px,3.4vw,18px)}
  .wn-ver{background:var(--glass);border:1px solid var(--line);border-radius:20px;padding:22px 24px;margin:18px 0}
  .wn-ver h2{font-size:clamp(20px,4.6vw,26px);font-weight:900;margin-bottom:10px;color:var(--gold2)}
  .wn-ver p{line-height:2;margin:10px 0}
  .wn-ver ul{padding-inline-start:22px;margin:6px 0 10px}
  .wn-ver li{line-height:2;margin:4px 0;color:var(--ink)}
  .wn-ver b{font-weight:800}
  @media(max-width:520px){.wn-ver{padding:18px 16px}}
</style>
<!-- Meta Pixel -->
<script src="pixel.js"></script>
</head>
<body>
<noscript><img height="1" width="1" style="display:none" alt=""
 src="https://www.facebook.com/tr?id=1393800312080250&amp;ev=PageView&amp;noscript=1" /></noscript>

<div class="orb orb-a"></div><div class="orb orb-b"></div><div class="orb orb-c"></div>

<header>
  <div class="wrap nav">
    <a class="logo" href="index.html"><span class="mark">A</span> ATTARIX</a>
    <nav class="nav-links">
${nav}
      <a href="ATTARIX-GUIDE.html" target="_blank" rel="noopener">📖 دليل الاستخدام</a>
    </nav>
    <a class="btn btn-gold" id="navCta">💬 تواصل واتساب</a>
    <button class="menu-btn" id="menuBtn" aria-label="القائمة" aria-expanded="false">☰</button>
  </div>
</header>

<main>
  <div class="wn-wrap">
    <section class="wn-hero rv in">
      <h1>ما الجديد</h1>
      <p>كل نسخة جديدة وأهم اللي اتغيّر فيها، الأحدث الأول.</p>
    </section>

${articles}

  </div>
</main>

<footer>
  <div class="wrap">
    <div class="logo" style="justify-content:center;margin-bottom:10px"><span class="mark">A</span> ATTARIX</div>
    <p>${foot} · <a href="ATTARIX-GUIDE.html" target="_blank" rel="noopener">دليل الاستخدام</a></p>
    <p style="margin-top:6px">م. محمود العطار — <a data-tel href="tel:+201090246299">01090246299</a> · © 2026 ATTARIX</p>
  </div>
</footer>

<!-- The same scripts as every other page (contact links, menu, language). -->
<script src="products-data.js"></script>
<script src="site.js"></script>
<script src="/translate.js" defer></script>
</body>
</html>
`;
writeFileSync(join(ROOT, 'whats-new.html'), html);
console.log(`whats-new.html: ${chosen.map((s) => s.version).join(', ')}`);
