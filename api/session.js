// GET /api/session → 200 {ok, previewUrl} with a valid session, else 401. previewUrl = env PREVIEW_URL (https only).
import { handler, send, assertMethod, HttpError } from './_lib/http.js';
import { requireSession } from './_lib/session.js';

export function previewUrlFrom(raw) {
  const v = String(raw || '').trim();
  if (!/^https:\/\/[^\s<>"']+$/.test(v)) return '';
  try { return new URL(v).protocol === 'https:' ? v : ''; } catch { return ''; }
}

export default handler(async (req, res) => {
  assertMethod(req, 'GET');
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new HttpError(500, 'الخادم غير مُعدّ');
  requireSession(req, secret);
  send(res, 200, { ok: true, previewUrl: previewUrlFrom(process.env.PREVIEW_URL) });
});
