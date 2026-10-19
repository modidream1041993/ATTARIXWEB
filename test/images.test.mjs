// Logo uploads: type by magic bytes, the SVG gate, and the sizes generated with sharp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { detectType, svgProblem, generate, outputsFor } from '../api/_lib/images.js';
import { checkUpload } from '../api/upload-logo.js';

const CLEAN = '<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 80" width="100" height="80"><defs><linearGradient id="g"><stop offset="0" stop-color="#0B5590"/></linearGradient></defs><circle cx="50" cy="40" r="30" fill="url(#g)"/><use href="#g"/><use xlink:href="#g"/></svg>';

test('a clean SVG passes', () => {
  assert.equal(svgProblem(CLEAN), null);
  assert.equal(detectType(Buffer.from(CLEAN)), 'svg');
  assert.equal(detectType(Buffer.from(`\uFEFF  ${CLEAN}`)), 'svg');
});

test('an SVG with anything active or external is refused', () => {
  const bad = [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT>alert(1)</SCRIPT></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect ONCLICK = "x"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="https://evil.example"><rect/></a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href=//evil.example/x.png /></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><use href="other.svg#a"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/a.css);</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.example/#a)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><iframe src="#"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" to="javascript:alert(1)"/></svg>',
  ];
  for (const s of bad) assert.notEqual(svgProblem(s), null, s);
});

test('the type comes from the bytes, and the extension must agree', async () => {
  const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#0B5590' } }).png().toBuffer();
  const webp = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#0B5590' } }).webp().toBuffer();
  assert.equal(detectType(png), 'png');
  assert.equal(detectType(webp), 'webp');
  assert.equal(detectType(Buffer.from('GIF89a....')), null);
  assert.equal(detectType(Buffer.from('<html><svg></svg></html>')), null);
  const b64 = (b) => b.toString('base64');
  assert.equal(checkUpload({ kind: 'mark', filename: 'logo.png', dataBase64: b64(png) }).type, 'png');
  assert.throws(() => checkUpload({ kind: 'mark', filename: 'logo.webp', dataBase64: b64(png) }), /لا يطابق/);
  assert.throws(() => checkUpload({ kind: 'mark', filename: 'logo.png', dataBase64: b64(Buffer.from('GIF89a')) }), /ليس PNG/);
  assert.throws(() => checkUpload({ kind: 'mark', filename: 'evil.svg', dataBase64: b64(Buffer.from('<svg onload="x"></svg>')) }), /SVG مرفوض/);
  assert.throws(() => checkUpload({ kind: 'favicon', filename: 'a.png', dataBase64: b64(png) }), /نوع الشعار/);
  assert.throws(() => checkUpload({ kind: 'mark', filename: 'a.png', dataBase64: 'not base64!' }), /غير صالح/);
  const big = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]);
  assert.throws(() => checkUpload({ kind: 'mark', filename: 'a.png', dataBase64: b64(big) }), (e) => e.status === 413);
});

test('a mark generates every size the pages use, never enlarging a raster', async () => {
  const src = await sharp({ create: { width: 1200, height: 1024, channels: 4, background: '#1E96CA' } }).png().toBuffer();
  const { files } = await generate('mark', src, 'png');
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  assert.deepEqual(Object.keys(by).sort(), outputsFor('mark').map((o) => o.path).sort());
  assert.equal(by['brand/attarix-mark-440.png'].width, 440);
  assert.equal(by['brand/attarix-mark-975.webp'].width, 975);
  assert.equal(by['brand/attarix-mark-h108.png'].height, 108);
  assert.equal(by['brand/attarix-mark-square-32.png'].width, 32);
  assert.equal(by['brand/attarix-mark-square-64.png'].height, 64);
  assert.equal(detectType(by['brand/attarix-mark-880.webp'].data), 'webp');

  const small = await sharp({ create: { width: 500, height: 400, channels: 4, background: '#1E96CA' } }).png().toBuffer();
  const s = Object.fromEntries((await generate('mark', small, 'png')).files.map((f) => [f.path, f]));
  assert.equal(s['brand/attarix-mark-880.png'].width, 500, 'not enlarged past the original');
  assert.equal(s['brand/attarix-mark-440.png'].width, 440);
});

test('an SVG wordmark is rasterised sharp at the target height', async () => {
  const { files } = await generate('wordmark-blue', Buffer.from(CLEAN), 'svg');
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'brand/attarix-wordmark-blue-h51.png');
  assert.equal(files[0].height, 51);
});
