// The content validator: today's content passes; wrong types, missing fields and injection attempts are refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateContent, changedPaths } from '../site-build/lib/schema.mjs';

const good = () => JSON.parse(readFileSync(new URL('../content/site.json', import.meta.url), 'utf8'));
const errorsOf = (mutate) => { const c = good(); mutate(c); return validateContent(c); };
const refused = (mutate, path) => {
  const errs = errorsOf(mutate);
  assert.ok(errs.length > 0, `expected a refusal at ${path}`);
  if (path) assert.ok(errs.some((e) => e.path === path), `expected ${path}, got ${JSON.stringify(errs)}`);
};

test('the committed content file is valid', () => {
  assert.deepEqual(validateContent(good()), []);
});

test('HTML and script injection in any text field is refused', () => {
  refused((c) => { c.hero.titleHighlight = '<script>alert(1)</script>'; }, 'hero.titleHighlight');
  refused((c) => { c.faq[0].a = 'x <img src=x onerror=alert(1)>'; }, 'faq[0].a');
  refused((c) => { c.plans.items[1].bullets[0] = '</li><li>'; }, 'plans.items[1].bullets[0]');
  refused((c) => { c.contact.waMessage = 'hi"><svg/onload=alert(1)>'; }, 'contact.waMessage');
  refused((c) => { c.footer.copyright = '>'; }, 'footer.copyright');
});

test('control characters, line breaks and bidi overrides are refused; plain Arabic and emoji pass', () => {
  const ctl = (n) => String.fromCharCode(n);
  refused((c) => { c.hero.sub = `a${ctl(10)}b`; }, 'hero.sub');
  refused((c) => { c.hero.sub = `a${ctl(0)}b`; }, 'hero.sub');
  refused((c) => { c.hero.sub = `a${ctl(0x7f)}b`; }, 'hero.sub');
  refused((c) => { c.hero.sub = `a${ctl(0x202e)}b`; }, 'hero.sub');
  refused((c) => { c.hero.sub = `a${ctl(0x2028)}b`; }, 'hero.sub');
  assert.deepEqual(errorsOf((c) => { c.hero.sub = 'نص عربي 👋 & "اقتباس" — ١٢٣'; }), []);
});

test('phone and WhatsApp numbers are digits only', () => {
  refused((c) => { c.contact.whatsapp = '+201090246299'; }, 'contact.whatsapp');
  refused((c) => { c.contact.whatsapp = '20109 0246299'; }, 'contact.whatsapp');
  refused((c) => { c.contact.whatsapp = '2010902462999999'; }, 'contact.whatsapp');
  refused((c) => { c.contact.phoneDisplay = '010-9024'; }, 'contact.phoneDisplay');
  refused((c) => { c.contact.phoneTel = '201090246299'; }, 'contact.phoneTel');
  refused((c) => { c.contact.phoneTel = '+2010javascript:'; }, 'contact.phoneTel');
});

test('prices are whole non-negative numbers (or empty where optional)', () => {
  refused((c) => { c.plans.items[0].monthly = '499'; }, 'plans.items[0].monthly');
  refused((c) => { c.plans.items[0].monthly = 499.5; }, 'plans.items[0].monthly');
  refused((c) => { c.plans.items[0].monthly = -1; }, 'plans.items[0].monthly');
  refused((c) => { c.plans.items[0].monthly = Infinity; }, 'plans.items[0].monthly');
  refused((c) => { c.plans.items[0].monthly = null; }, 'plans.items[0].monthly'); // no price text either
  refused((c) => { c.plans.items[0].yearly = null; }, 'plans.items[0].yearlyWas'); // a "was" with nothing to strike
  refused((c) => { c.plans.hrAddon.monthly = null; }, 'plans.hrAddon.monthly');
  assert.deepEqual(errorsOf((c) => { c.plans.items[0].yearly = null; c.plans.items[0].yearlyWas = null; }), []);
});

test('missing fields, unknown fields and wrong types are refused', () => {
  refused((c) => { delete c.hero.sub; }, 'hero.sub');
  refused((c) => { delete c.faq; }, 'faq');
  refused((c) => { c.hero.extra = 'x'; }, 'hero.extra');
  refused((c) => { c.__proto__polluted = 1; }, '__proto__polluted');
  refused((c) => { c.plans.items[0].highlight = 'yes'; }, 'plans.items[0].highlight');
  refused((c) => { c.faq = {}; }, 'faq');
  refused((c) => { c.version = 2; }, 'version');
  assert.ok(validateContent(null).length > 0);
  assert.ok(validateContent([]).length > 0);
  assert.ok(validateContent('x').length > 0);
});

test('list sizes, lengths, icons, styles and actions are bounded', () => {
  refused((c) => { c.faq = []; }, 'faq');
  refused((c) => { c.plans.items = []; }, 'plans.items');
  refused((c) => { c.plans.items.push(...c.plans.items, ...c.plans.items); }, 'plans.items');
  refused((c) => { c.hero.cards = Array(7).fill(c.hero.cards[0]); }, 'hero.cards');
  refused((c) => { c.hero.titleHighlight = 'x'.repeat(81); }, 'hero.titleHighlight');
  refused((c) => { c.hero.titleHighlight = ''; }, 'hero.titleHighlight');
  refused((c) => { c.hero.titleHighlight = '   '; }, 'hero.titleHighlight');
  refused((c) => { c.hero.cards[0].icon = 'i-wa" onmouseover="x'; }, 'hero.cards[0].icon');
  refused((c) => { c.hero.cards[0].style = 'c9'; }, 'hero.cards[0].style');
  refused((c) => { c.plans.items[0].button.action = 'javascript'; }, 'plans.items[0].button.action');
});

test('brand paths stay inside brand/ and name an image', () => {
  refused((c) => { c.brand.markH108 = 'brand/../vercel.json'; }, 'brand.markH108');
  refused((c) => { c.brand.markH108 = 'https://evil.example/x.png'; }, 'brand.markH108');
  refused((c) => { c.brand.markH108 = 'brand/x.svg'; }, 'brand.markH108');
});

test('changedPaths names the leaves that differ', () => {
  const a = good();
  const b = good();
  b.plans.items[0].monthly = 599;
  b.faq.push({ q: 'س', a: 'ج' });
  assert.deepEqual(changedPaths(a, b), ['plans.items[0].monthly', 'faq (5→6)']);
  assert.deepEqual(changedPaths(a, good()), []);
});
