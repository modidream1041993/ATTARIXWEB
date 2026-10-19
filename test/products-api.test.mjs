// The products page and the «عنّا» page in the new panel, end to end against the in-memory fake of GitHub: read,
// «حفظ في المعاينة» (site/preview only), image upload, the contact kept in step, «نشر» (only the data file and the
// uploaded images reach main), «تراجع», and a refusal — never a silent overwrite — when the old token panel changed
// the same file on main meanwhile. It proves our logic against our model of GitHub, not GitHub itself.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { FakeGitHub, fakeReq, fakeRes } from './helpers/fake-github.mjs';
import { hashPassword } from '../api/_lib/password.js';
import { base32Encode, hotp, stepAt } from '../api/_lib/totp.js';
import { parseProductsData } from '../api/_lib/products-data.js';
import login from '../api/login.js';
import contentEp from '../api/content.js';
import save from '../api/save.js';
import saveProducts from '../api/save-products.js';
import uploadImage from '../api/upload-image.js';
import publish from '../api/publish.js';
import rollback from '../api/rollback.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTENT_TEXT = readFileSync(new URL('../content/site.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PD_TEXT = execFileSync('git', ['show', 'HEAD:products-data.js'], { cwd: ROOT, encoding: 'utf8' });
const KEY = Buffer.from('0123456789abcdefghij');
const PASSWORD = 'a long test password';
const fake = new FakeGitHub();
let cookie = '';
const call = async (fn, opts) => { const res = fakeRes(); await fn(fakeReq(opts), res); return res; };
const pdAt = (ref) => parseProductsData(fake.textAt(ref, 'products-data.js'));
const editable = (d) => ({ sections: d.sections, products: d.products, about: d.about });

before(async () => {
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.GITHUB_REPO = 'owner/site';
  process.env.ADMIN_PASSWORD_HASH = await hashPassword(PASSWORD, { iterations: 210000 });
  process.env.ADMIN_TOTP_SECRET = base32Encode(KEY);
  process.env.ADMIN_SESSION_SECRET = 'x'.repeat(48);
  delete process.env.VERCEL_ENV;
  globalThis.fetch = fake.fetch;
  fake.seed('main', {
    'content/site.json': CONTENT_TEXT,
    'site-build/build.mjs': 'build',
    'products-data.js': PD_TEXT,
    'admin.html': 'the old token panel',
    'images/sale-screen.jpg': Buffer.from('site image'),
    'images/shop-item-1-1783616457716.jpg': Buffer.from('product image'),
    'images/team-mahmoud-1783615711864.png': Buffer.from('team photo'),
  });
  const r = await call(login, { method: 'POST', body: { password: PASSWORD, totp: hotp(KEY, stepAt(Date.now())) } });
  cookie = r.headers['set-cookie'].split(';')[0];
});

test('content: the products page and «عنّا» come with the content, from the same branch', async () => {
  const r = await call(contentEp, { method: 'GET', cookie });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.productsData, editable(parseProductsData(PD_TEXT)));
});

test('save-products: a bad edit is refused with its field paths and nothing is committed', async () => {
  const d = editable(parseProductsData(PD_TEXT));
  d.products[0].name = '';
  d.about.socials.facebook = 'javascript:alert(1)';
  const r = await call(saveProducts, { method: 'POST', body: { productsData: d }, cookie });
  assert.equal(r.statusCode, 400);
  const paths = r.json.errors.map((e) => e.path);
  assert.ok(paths.includes('pd.products[0].name') && paths.includes('pd.about.socials.facebook'));
  assert.equal(fake.refs.has('site/preview'), false);
});

let uploaded = '';
let teamUploaded = '';
test('upload-image: re-encoded with no metadata, saved under images/ on site/preview only; anything else refused', async () => {
  const jpeg = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#0B5590' } })
    .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-here' } } }).jpeg().toBuffer();
  const mainBefore = fake.refs.get('main');
  const r = await call(uploadImage, { method: 'POST', body: { owner: 'product', id: 'p-1', filename: 'Photo.JPG', dataBase64: jpeg.toString('base64') }, cookie });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  uploaded = r.json.path;
  assert.match(uploaded, /^images\/p-1-\d{13}\.jpg$/);
  const stored = fake.filesAt('site/preview')[uploaded];
  const meta = await sharp(stored).metadata();
  assert.equal(meta.width, 1600, 'shrunk to at most 1600 px wide');
  assert.equal(meta.exif, undefined, 'metadata stripped');
  assert.equal(fake.refs.get('main'), mainBefore, 'main untouched');

  const team = await call(uploadImage, { method: 'POST', body: { owner: 'team', id: 'mahmoud', filename: 'a.png', dataBase64: (await sharp({ create: { width: 10, height: 10, channels: 4, background: '#fff' } }).png().toBuffer()).toString('base64') }, cookie });
  teamUploaded = team.json.path;
  assert.match(teamUploaded, /^images\/team-mahmoud-\d{13}\.png$/);

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  assert.equal((await call(uploadImage, { method: 'POST', body: { owner: 'product', id: 'p-1', filename: 'x.svg', dataBase64: svg }, cookie })).statusCode, 400);
  assert.equal((await call(uploadImage, { method: 'POST', body: { owner: 'product', id: '../x', filename: 'x.jpg', dataBase64: jpeg.toString('base64') }, cookie })).statusCode, 400);
  assert.equal((await call(uploadImage, { method: 'POST', body: { owner: 'nobody', id: 'p-1', filename: 'x.jpg', dataBase64: jpeg.toString('base64') }, cookie })).statusCode, 400);
});

test('save-products: a valid edit (add, edit, reorder, delete, image) lands on site/preview only, same format', async () => {
  const d = editable(parseProductsData(PD_TEXT));
  d.products.push({ id: 'p-1', section: 'shop', icon: '📦', name: 'منتج جديد', short: 'سطر\nسطر', description: '', features: ['ميزة'], price: '150 ج.م', image: uploaded });
  d.products[1].price = '200 ج.م';
  [d.products[0], d.products[2]] = [d.products[2], d.products[0]];
  d.about.team.splice(5, 1);
  d.about.whoami = 'نص جديد';
  d.about.doing.push('بند جديد');
  const mainBefore = fake.refs.get('main');
  const r = await call(saveProducts, { method: 'POST', body: { productsData: d }, cookie });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  const onPreview = pdAt('site/preview');
  assert.deepEqual(editable(onPreview), d);
  assert.deepEqual(onPreview.contact, parseProductsData(PD_TEXT).contact, 'the contact block is kept as it is');
  assert.equal(fake.refs.get('main'), mainBefore);
  const again = await call(saveProducts, { method: 'POST', body: { productsData: d }, cookie });
  assert.equal(again.json.unchanged, true);
  const bad = structuredClone(d);
  bad.products[0].image = 'images/never-uploaded-1234567890123.jpg';
  assert.equal((await call(saveProducts, { method: 'POST', body: { productsData: bad }, cookie })).statusCode, 400, 'an image that is not there is refused');
});

test('save (content): a changed WhatsApp number / phone / name is carried into products-data.js too', async () => {
  const c = JSON.parse(CONTENT_TEXT);
  c.contact.whatsapp = '201000000001';
  c.contact.phoneTel = '+201000000001';
  const r = await call(save, { method: 'POST', body: { content: c }, cookie });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  assert.deepEqual(pdAt('site/preview').contact, { whatsapp: '201000000001', phone: '+201000000001', owner: c.contact.ownerName });
  assert.equal(pdAt('site/preview').products.at(-1).id, 'p-1', 'the products edit is kept');
});

test('publish: products-data.js and the uploaded images reach main — nothing else from the preview', async () => {
  const mainBefore = fake.refs.get('main');
  const r = await call(publish, { method: 'POST', body: {}, cookie });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  assert.deepEqual(fake.commits.get(fake.refs.get('main')).parents, [mainBefore]);
  const files = fake.filesAt('main');
  assert.equal(pdAt('main').products.at(-1).name, 'منتج جديد');
  assert.ok(files[uploaded], 'the uploaded image is published with the data that uses it');
  assert.equal(files['admin.html'].toString(), 'the old token panel', 'the old panel stays');
  assert.equal(files['images/sale-screen.jpg'].toString(), 'site image');
  assert.deepEqual(r.json.files.sort(), ['content/site.json', 'products-data.js', uploaded, teamUploaded].sort());
});

test('rollback: products-data.js and the uploaded images go back to before that publish', async () => {
  const r = await call(rollback, { method: 'POST', body: {}, cookie });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json));
  assert.equal(fake.textAt('main', 'products-data.js'), PD_TEXT);
  assert.equal(fake.filesAt('main')[uploaded], undefined);
  assert.equal(fake.textAt('main', 'images/shop-item-1-1783616457716.jpg'), 'product image', 'an image that was there before stays');
  assert.equal(fake.textAt('main', 'images/sale-screen.jpg'), 'site image');
});

test('the old panel changed products-data.js on main while the preview changed it too → publish refused, main untouched', async () => {
  const d = editable(pdAt('site/preview'));
  d.about.story = 'قصة من اللوحة الجديدة';
  assert.equal((await call(saveProducts, { method: 'POST', body: { productsData: d }, cookie })).statusCode, 200);
  const m = new Map(fake.commits.get(fake.refs.get('main')).tree);
  const old = parseProductsData(fake.textAt('main', 'products-data.js'));
  old.about.story = 'قصة من اللوحة القديمة';
  const { serializeProductsData } = await import('../api/_lib/products-data.js');
  m.set('products-data.js', fake.blob(Buffer.from(serializeProductsData(old))));
  fake.refs.set('main', fake.commit(m, [fake.refs.get('main')], 'old panel save'));
  const mainBefore = fake.refs.get('main');
  const r = await call(publish, { method: 'POST', body: {}, cookie });
  assert.equal(r.statusCode, 409);
  assert.equal(fake.refs.get('main'), mainBefore);
  assert.equal(pdAt('main').about.story, 'قصة من اللوحة القديمة', 'the old panel\'s edit is not overwritten');
});
