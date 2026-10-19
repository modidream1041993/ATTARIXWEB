// products-data.js: read as JSON (never evaluated), written back byte for byte as the old panel writes it, and every
// edit validated — so the new panel and the old token panel keep editing ONE file in ONE format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseProductsData, serializeProductsData, validateProductsData, siteContactFrom, UPLOADED_IMAGE_RE, ProductsDataFormatError } from '../api/_lib/products-data.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const live = execFileSync('git', ['show', 'HEAD:products-data.js'], { cwd: ROOT, encoding: 'utf8' });
const data = () => { const d = parseProductsData(live); return { sections: d.sections, products: d.products, about: d.about }; };

test('the live file round-trips byte for byte, and today\'s data is valid', () => {
  const d = parseProductsData(live);
  assert.equal(serializeProductsData(d), live);
  assert.ok(d.products.length >= 4 && d.about.team.length >= 5 && d.sections.length >= 3);
  assert.deepEqual(validateProductsData(data()), []);
});

test('a file not in the generated format is refused, never evaluated', () => {
  assert.throws(() => parseProductsData("window.SITE_CONTACT = {a:1};\nwindow.SECTIONS = [];\nwindow.PRODUCTS = [];\nwindow.ABOUT = {};\n"), ProductsDataFormatError);
  assert.throws(() => parseProductsData('window.SECTIONS = [];'), ProductsDataFormatError);
  assert.throws(() => parseProductsData(`${live}\nwindow.EVIL = 1;\n`), ProductsDataFormatError);
});

test('validation: names required, ids unique, links https only, image paths inside images/ and existing', () => {
  const d = data();
  d.products[0].name = ' ';
  d.products[1].id = d.products[2].id;
  d.about.socials.facebook = 'javascript:alert(1)';
  d.about.team[0].photo = '../secret.png';
  d.products[3].image = 'images/missing-1234567890123.jpg';
  d.products[2].bogus = 1;
  const paths = validateProductsData(d, (p) => p !== 'images/missing-1234567890123.jpg').map((e) => e.path);
  for (const p of ['pd.products[0].name', 'pd.products[2].bogus', 'pd.about.socials.facebook']) assert.ok(paths.includes(p), p);
  const d2 = data();
  d2.products[1].id = d2.products[2].id;
  d2.about.team[0].photo = 'images/../secret.png';
  d2.products[3].image = 'images/missing-1234567890123.jpg';
  const paths2 = validateProductsData(d2, (p) => p !== 'images/missing-1234567890123.jpg').map((e) => e.path);
  for (const p of ['pd.products[2].id', 'pd.about.team[0].photo', 'pd.products[3].image']) assert.ok(paths2.includes(p), p);
});

test('multi-line texts keep their lines; one-line fields refuse a line break', () => {
  const d = data();
  d.products[0].short = 'سطر\nسطر';
  assert.deepEqual(validateProductsData(d), []);
  d.products[0].name = 'اسم\nثاني';
  assert.deepEqual(validateProductsData(d).map((e) => e.path), ['pd.products[0].name']);
});

test('the uploaded-image pattern matches both panels\' uploads and nothing else', () => {
  assert.ok(UPLOADED_IMAGE_RE.test('images/shop-item-1-1783616457716.jpg'));
  assert.ok(UPLOADED_IMAGE_RE.test('images/team-mahmoud-1783615711864.png'));
  for (const p of ['images/sale-screen.jpg', 'images/ai/x-1783616457716.jpg', 'brand/x-1783616457716.png', 'images/a-123.jpg']) assert.ok(!UPLOADED_IMAGE_RE.test(p), p);
});

test('the file\'s contact follows content/site.json', () => {
  assert.deepEqual(siteContactFrom({ whatsapp: '201', phoneTel: '+201', ownerName: 'م' }), { whatsapp: '201', phone: '+201', owner: 'م' });
});
