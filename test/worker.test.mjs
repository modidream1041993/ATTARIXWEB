// worker/index.js answers Range requests for /videos/* with 206 (Safari on iPhone/iPad needs it to play <video>).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { parseRange } from '../worker/index.js';

const BYTES = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 256));
const env = (status = 200) => ({ ASSETS: { fetch: async () => new Response(status === 200 ? BYTES : null, { status, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '1000', ETag: '"x"' } }) } });
const get = (range, method = 'GET') => new Request('https://attarix.net/videos/6-hr.mp4', { method, headers: range ? { Range: range } : {} });

test('parseRange: open, closed, suffix, clamped, invalid, multi', () => {
  assert.deepEqual(parseRange('bytes=0-1', 1000), { start: 0, end: 1 });
  assert.deepEqual(parseRange('bytes=100-', 1000), { start: 100, end: 999 });
  assert.deepEqual(parseRange('bytes=-10', 1000), { start: 990, end: 999 });
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=5-2', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-1,5-6', 1000), null);
  assert.equal(parseRange('items=0-1', 1000), null);
  assert.equal(parseRange(null, 1000), null);
});

test("Safari's first probe (bytes=0-1) gets 206 with exactly two bytes", async () => {
  const res = await worker.fetch(get('bytes=0-1'), env());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Range'), 'bytes 0-1/1000');
  assert.equal(res.headers.get('Content-Length'), '2');
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(res.headers.get('Content-Type'), 'video/mp4');
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0, 1]);
});

test('a middle range returns the right slice; out of range is 416', async () => {
  const res = await worker.fetch(get('bytes=500-509'), env());
  assert.equal(res.status, 206);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...BYTES.slice(500, 510)]);
  const bad = await worker.fetch(get('bytes=2000-'), env());
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get('Content-Range'), 'bytes */1000');
});

test('no Range: the whole file, 200, advertising Accept-Ranges', async () => {
  const res = await worker.fetch(get(null), env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal((await res.arrayBuffer()).byteLength, 1000);
});

test('404s, redirects and non-GET pass through untouched', async () => {
  assert.equal((await worker.fetch(get('bytes=0-1'), env(404))).status, 404);
  assert.equal((await worker.fetch(get('bytes=0-1'), env(304))).status, 304);
  const post = await worker.fetch(new Request('https://attarix.net/videos/x.mp4', { method: 'POST', headers: { Range: 'bytes=0-1' } }), env());
  assert.equal(post.status, 200);
  assert.equal(post.headers.get('Content-Range'), null);
});
