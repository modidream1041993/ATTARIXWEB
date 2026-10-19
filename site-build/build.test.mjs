// The site build: the templating changed no page, values are escaped, a bad content file fails the build loudly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { build, renderPage, productionProblems, TEMPLATES, ROOT } from './build.mjs';
import { render, escapeHtml } from './lib/template.mjs';

// THE MIGRATION PROOF. BASE_REF = the last commit whose pages were hand-written HTML (site/2.9.2, 2026-10-18).
// TEMPLATE_REF = the commit that turned those pages into templates + content/site.json. Both are pinned, so this
// keeps proving the same thing after the content is edited or the pages change: rendering THOSE templates with
// THAT content gives back, character for character (line endings aside), the pages as they were.
const BASE_REF = '2a4ed9a';
const TEMPLATE_REF = '535308e16915'; // the commit that introduced the templates (site/admin)

const lf = (s) => s.replace(/\r\n/g, '\n');
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}
function gitAvailable(ref) {
  try { git(['cat-file', '-e', `${ref}^{commit}`]); return true; } catch { return false; }
}
const atTemplateRef = (path) => (TEMPLATE_REF === 'WORKTREE' ? readFileSync(join(ROOT, path), 'utf8') : git(['show', `${TEMPLATE_REF}:${path}`]));

test('migration: every templated page renders to exactly the page it replaced', { skip: !gitAvailable(BASE_REF) && 'git history not available' }, () => {
  const content = JSON.parse(atTemplateRef('content/site.json'));
  for (const t of TEMPLATES) {
    const expected = lf(git(['show', `${BASE_REF}:${t}`]));
    const got = lf(renderPage(atTemplateRef(t), content, t));
    assert.equal(got, expected, `${t} differs from ${BASE_REF}`);
  }
});

function filesUnder(dir) {
  const out = [];
  (function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p).split(sep).join('/')); } })(dir);
  return out.sort();
}

test('the build of the current tree: every page rendered, the rest copied byte for byte, nothing private shipped', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'attarix-site-'));
  try {
    const { files } = build({ outDir });
    const out = filesUnder(outDir);
    assert.deepEqual(out, [...files].sort());
    for (const t of TEMPLATES) {
      const page = readFileSync(join(outDir, t), 'utf8');
      assert.ok(!page.includes('{{'), `${t}: placeholder left`);
    }
    for (const f of out.filter((x) => !TEMPLATES.includes(x))) {
      assert.ok(readFileSync(join(outDir, f)).equals(readFileSync(join(ROOT, f))), `${f} was not copied byte for byte`);
    }
    assert.ok(readFileSync(join(outDir, 'latest-update.json')).equals(readFileSync(join(ROOT, 'latest-update.json'))), 'the signed update file is byte-identical');
    for (const banned of ['content/', 'site-build/', 'api/', 'docs/', 'test/', 'scripts/', 'node_modules/', '.git', 'package.json', 'vercel.json', 'MARKETING_PLAN.md']) {
      assert.ok(!out.some((f) => f.startsWith(banned)), `${banned} must not be in the output`);
    }
    // site/admin carries the panel (shipped in its PREVIEW build only — a production build refuses it, below);
    // site/public, the branch main is built from, carries none of it.
    const hasPanel = existsSync(join(ROOT, 'admin'));
    assert.equal(out.includes('admin/index.html'), hasPanel);
    assert.equal(out.includes('admin-products.html'), hasPanel);
    assert.ok(out.includes('robots.txt'));
    const robots = readFileSync(join(outDir, 'robots.txt'), 'utf8');
    assert.match(robots, /^Disallow: \/admin$/m);
    assert.match(robots, /^Disallow: \/api\/$/m);
    if (hasPanel) assert.match(readFileSync(join(outDir, 'admin-products.html'), 'utf8'), /noindex, nofollow/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('every value is HTML-escaped; a value can never inject markup or script', () => {
  const content = JSON.parse(readFileSync(join(ROOT, 'content', 'site.json'), 'utf8'));
  content.hero.titleHighlight = '<script>alert(1)</script>';
  content.contact.waMessage = '"><img src=x onerror=alert(1)>';
  content.contact.ownerName = '</script><script>alert(2)</script>';
  const page = renderPage(readFileSync(join(ROOT, 'index.html'), 'utf8'), content, 'index.html', { validate: false });
  assert.ok(page.includes('<span class="hl">&lt;script&gt;alert(1)&lt;/script&gt;</span>'));
  assert.ok(page.includes('data-wa-msg="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'));
  assert.ok(!page.includes('<script>alert('));
  assert.ok(page.includes('owner: "\\u003c/script\\u003e\\u003cscript\\u003ealert(2)\\u003c/script\\u003e"'), 'JS strings are escaped too');
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('a missing or invalid field fails the build loudly, naming the field', () => {
  const content = JSON.parse(readFileSync(join(ROOT, 'content', 'site.json'), 'utf8'));
  delete content.hero.sub;
  assert.throws(() => build({ outDir: join(tmpdir(), 'never-written'), content }), /hero\.sub/);
  assert.equal(existsSync(join(tmpdir(), 'never-written')), false, 'nothing is written when the content is bad');
  const bad = JSON.parse(readFileSync(join(ROOT, 'content', 'site.json'), 'utf8'));
  bad.plans.items[0].monthly = 'free';
  assert.throws(() => build({ outDir: join(tmpdir(), 'never-written'), content: bad }), /plans\.items\[0\]\.monthly/);
  // And the engine itself refuses a template name with no value, rather than printing "".
  assert.throws(() => render('<p>{{missing.field}}</p>', {}), /missing\.field.*missing/);
  assert.throws(() => render('{{#each x}}', { x: [] }), /never closed/);
  assert.throws(() => render('{{<b>}}', {}), /unknown tag/);
});

test('the engine: lists, conditions, and standalone block lines that leave no trace', () => {
  const tpl = '<ul>\n{{#each items}}\n  <li>{{name}}{{#if tag}} [{{tag}}]{{/if}} {{price}}</li>\n{{/each}}\n</ul>\n{{#if none}}\nX\n{{else}}\nY\n{{/if}}\n';
  const out = render(tpl, { price: 'p', items: [{ name: 'a', tag: 't' }, { name: 'b', tag: '' }], none: [] });
  assert.equal(out, '<ul>\n  <li>a [t] p</li>\n  <li>b p</li>\n</ul>\nY\n');
  assert.equal(render('a\r\n{{#if x}}\r\nb\r\n{{/if}}\r\nc', { x: true }), 'a\r\nb\r\nc', 'CRLF templates work too');
});

// The owner's rule (2026-10-19): the admin panel never runs on the public site. A PRODUCTION build refuses while any
// admin code is in the tree (the new panel's admin/ and api/, the old token panel admin.html / admin-products.html); a
// preview build is unaffected. Whatever branch this runs on, the real tree either is refused or ships none of it.
test('production: the build refuses a tree that carries admin code, and names each piece', () => {
  const problems = productionProblems(['index.html', 'api', 'admin', 'admin-products.html', 'admin.html', 'site.css']);
  assert.deepEqual(problems, ['admin', 'admin-products.html', 'admin.html', 'api']);
  assert.deepEqual(productionProblems(['index.html', 'content', 'site-build']), []);
});

test('production: this branch is either refused or builds with no admin route; preview builds are unaffected', () => {
  const out = mkdtempSync(join(tmpdir(), 'site-prod-'));
  try {
    let refused = null;
    try { build({ outDir: out, env: { VERCEL_ENV: 'production' } }); } catch (e) { refused = e; }
    if (refused) {
      assert.match(refused.message, /admin code/);
      assert.equal(readdirSync(out).length, 0, 'nothing is written when the build is refused');
    } else {
      for (const p of ['admin', 'api', 'admin-products.html', 'admin.html']) assert.equal(existsSync(join(out, p)), false, p);
    }
    build({ outDir: out, env: { VERCEL_ENV: 'preview' } });
    assert.ok(existsSync(join(out, 'index.html')));
  } finally { rmSync(out, { recursive: true, force: true }); }
});
