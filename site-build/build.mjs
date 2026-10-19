// The site build (Vercel runs it: vercel.json "buildCommand"). No dependencies.
//
//     node site-build/build.mjs            # → dist/
//
// 1. Reads content/site.json and validates it against site-build/lib/schema.mjs — a bad or incomplete file FAILS
//    the build (non-zero exit, every problem named); nothing half-filled is ever deployed.
// 2. Copies the site into dist/ byte for byte (latest-update.json is SIGNED and must stay exactly as it is), leaving
//    out what is not the site: content/, site-build/, api/, docs/, test/, scripts/, node_modules/, dist/, git files,
//    the package files, vercel.json, .vercelignore, MARKETING_PLAN.md.
// 3. Renders the TEMPLATES below (the site's own pages, carrying {{placeholders}}) with the content, every value
//    HTML-escaped (site-build/lib/template.mjs), and refuses a page that would still hold a placeholder.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './lib/template.mjs';
import { assertValidContent } from './lib/schema.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Files rendered from content. Everything else is copied unchanged.
export const TEMPLATES = [
  'index.html', 'download.html', 'about.html', 'products.html', 'product.html', 'whats-new.html',
  'ATTARIX-GUIDE.html', 'site.js',
];

// Top-level names that are not part of the public site.
const EXCLUDE_TOP = new Set([
  'content', 'site-build', 'api', 'docs', 'test', 'scripts', 'node_modules', 'dist', 'test-results',
  'package.json', 'package-lock.json', 'vercel.json', '.vercelignore', 'MARKETING_PLAN.md', '.vercel',
]);
const excluded = (top) => EXCLUDE_TOP.has(top) || top.startsWith('.git');

const groupThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const price = (n) => (n === null ? '' : groupThousands(n));

// The content as the templates read it: prices formatted, the hero cards split around the mark, plan buttons resolved.
export function buildView(content) {
  const cards = content.hero.cards;
  const half = Math.ceil(cards.length / 2);
  let waIdUsed = false;
  const items = content.plans.items.map((p) => {
    const wa = p.button.action === 'whatsapp';
    const id = wa && !waIdUsed ? 'bizWa' : '';
    if (wa) waIdUsed = true;
    return {
      ...p,
      monthly: price(p.monthly), monthlyWas: price(p.monthlyWas), yearly: price(p.yearly), yearlyWas: price(p.yearlyWas),
      btnWhatsapp: wa,
      btnId: id,
      btnClass: `btn ${p.highlight ? 'btn-cta' : 'btn-ghost'}${wa ? ' btn-wa' : ''}`,
    };
  });
  const h = content.plans.hrAddon;
  return {
    ...content,
    hero: { ...content.hero, cardsBefore: cards.slice(0, half), cardsAfter: cards.slice(half) },
    plans: {
      ...content.plans,
      items,
      hrAddon: { ...h, monthly: price(h.monthly), monthlyWas: price(h.monthlyWas), yearly: price(h.yearly), yearlyWas: price(h.yearlyWas) },
    },
  };
}

export function renderPage(templateText, content, file, { validate = true } = {}) {
  if (validate) assertValidContent(content);
  const out = render(templateText, buildView(content), file);
  if (/\{\{/.test(out)) throw new Error(`${file}: a placeholder survived the build`);
  return out;
}

function walk(dir, base, out) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(base, abs).split(sep).join('/');
    if (dir === base && excluded(name)) continue;
    if (statSync(abs).isDirectory()) walk(abs, base, out);
    else out.push(rel);
  }
  return out;
}

export function build({ root = ROOT, outDir = join(root, 'dist'), content } = {}) {
  const c = content ?? JSON.parse(readFileSync(join(root, 'content', 'site.json'), 'utf8'));
  assertValidContent(c);
  const files = walk(root, root, []);
  for (const t of TEMPLATES) if (!files.includes(t)) throw new Error(`template missing: ${t}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const rel of files) {
    const dest = join(outDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (TEMPLATES.includes(rel)) writeFileSync(dest, renderPage(readFileSync(join(root, rel), 'utf8'), c, rel, { validate: false }));
    else copyFileSync(join(root, rel), dest);
  }
  return { outDir, files };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { outDir, files } = build();
    console.log(`site build: ${files.length} files → ${relative(ROOT, outDir)}/ (${TEMPLATES.length} rendered from content/site.json)`);
    if (!existsSync(join(outDir, 'index.html'))) throw new Error('no index.html in the output');
  } catch (e) {
    console.error(`site build FAILED:\n${e.message}`);
    process.exit(1);
  }
}
