// attarix.net — the only code that runs on Cloudflare, and it runs ONLY for /videos/* (wrangler.jsonc "run_worker_first").
// Every other request is served by static assets directly, without this script.
//
// Why it exists (2026-11-16): Cloudflare static assets answer a Range request with the whole file and 200. Safari on
// iPhone/iPad will not play an <video> unless the server answers its first probe (Range: bytes=0-1) with 206 Partial
// Content, so the home page's demo videos would stay black there. Vercel answered 206; this restores that behaviour.
// The videos are small (< 1 MB each), so slicing the asset in memory is cheap.

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/** Parse one "bytes=a-b" range against a size. null = serve the whole file (absent, multi-range or unparsable — allowed
 *  by RFC 9110), 'unsatisfiable' = 416. */
export function parseRange(header, size) {
  if (!header) return null;
  const m = SINGLE_RANGE.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    // suffix range: the last N bytes
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size || start > end) return 'unsatisfiable';
  }
  return { start, end };
}

export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    // Only a full, successful GET/HEAD of a file is ours to slice; redirects, 304s, 404s and a 206 (should Cloudflare
    // start honouring Range itself) pass through untouched.
    if (res.status !== 200 || (request.method !== 'GET' && request.method !== 'HEAD')) return res;

    const headers = new Headers(res.headers);
    headers.set('Accept-Ranges', 'bytes');
    const range = request.headers.get('Range');
    if (!range) return new Response(res.body, { status: 200, headers });

    const body = await res.arrayBuffer();
    const size = body.byteLength;
    const r = parseRange(range, size);
    if (r === null) return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
    if (r === 'unsatisfiable') {
      headers.set('Content-Range', `bytes */${size}`);
      headers.delete('Content-Length');
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Range', `bytes ${r.start}-${r.end}/${size}`);
    headers.set('Content-Length', String(r.end - r.start + 1));
    return new Response(request.method === 'HEAD' ? null : body.slice(r.start, r.end + 1), { status: 206, headers });
  },
};
