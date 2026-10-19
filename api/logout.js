// POST /api/logout → clears the session cookie on this browser.
import { handler, send, assertMethod, assertSameOriginJson } from './_lib/http.js';
import { clearedCookie } from './_lib/session.js';

export default handler(async (req, res) => {
  assertMethod(req, 'POST');
  assertSameOriginJson(req);
  send(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie() });
});
