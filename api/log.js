// GET /api/log → the change log (newest first, last 200 entries) from the admin-state branch.
import { handler, send } from './_lib/http.js';
import { adminContext } from './_lib/context.js';

export default handler(async (req, res) => {
  const { store } = adminContext(req, 'GET');
  send(res, 200, { ok: true, entries: await store.readLog(200) });
});
