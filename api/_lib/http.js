// Request/response helpers shared by every endpoint. Generic error messages only — never a stack trace, a token,
// or a GitHub error body in a response.

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

// A state-changing request must be same-origin JSON: the session cookie is SameSite=Strict, and on top of that a
// cross-site form cannot send application/json without a CORS preflight we never answer.
export function assertSameOriginJson(req) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'طلب غير صالح');
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') throw new HttpError(403, 'طلب غير مسموح');
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    let o;
    try { o = new URL(origin); } catch { throw new HttpError(403, 'طلب غير مسموح'); }
    if (!host || o.host !== host) throw new HttpError(403, 'طلب غير مسموح');
  }
}

export function assertMethod(req, method) {
  if (req.method !== method) throw new HttpError(405, 'طريقة غير مسموحة', { allow: method });
}

// Reads a JSON body of at most maxBytes. On Vercel the runtime may already have parsed it (req.body); the size is
// judged from Content-Length either way, and a body with no declared length is refused.
export async function readJson(req, maxBytes) {
  const len = Number(req.headers['content-length']);
  if (!Number.isFinite(len) || len <= 0) throw new HttpError(411, 'طلب غير صالح');
  if (len > maxBytes) throw new HttpError(413, 'الطلب أكبر من المسموح');
  let body;
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    body = req.body;
  } else {
    let text;
    if (typeof req.body === 'string') text = req.body;
    else if (Buffer.isBuffer(req.body)) text = req.body.toString('utf8');
    else {
      const chunks = [];
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > maxBytes) throw new HttpError(413, 'الطلب أكبر من المسموح');
        chunks.push(chunk);
      }
      text = Buffer.concat(chunks).toString('utf8');
    }
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new HttpError(413, 'الطلب أكبر من المسموح');
    try { body = JSON.parse(text); } catch { throw new HttpError(400, 'طلب غير صالح'); }
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'طلب غير صالح');
  return body;
}

// Wraps a handler: HttpError → its status and message; anything else → 500 with a generic message. The server log
// gets a short code and the error's name only (never its message: a GitHub error could echo a request).
//
// The owner's rule (2026-10-19): the panel NEVER runs on the public site. On a Production deployment every endpoint
// answers 404 before it reads a header, a body, an env var or GitHub — so admin code that reached main by mistake,
// even with every secret set, logs nobody in and never reads or moves the lockout counter.
export const isProduction = (env = process.env) => env.VERCEL_ENV === 'production';

export function handler(fn) {
  return async (req, res) => {
    if (isProduction()) return send(res, 404, { ok: false, error: 'غير موجود' });
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) {
        const headers = e.status === 405 && e.extra?.allow ? { Allow: e.extra.allow } : {};
        if (e.status >= 500 && e.code) console.error(`admin-api: ${e.code}`);
        const body = { ok: false, error: e.message };
        if (e.extra && e.extra.public) Object.assign(body, e.extra.public);
        return send(res, e.status, body, headers);
      }
      console.error(`admin-api: unexpected ${e && e.name ? e.name : 'error'}${e && e.code ? ` (${e.code})` : ''}`);
      return send(res, 500, { ok: false, error: 'حدث خطأ. حاول مرة أخرى.' });
    }
  };
}
