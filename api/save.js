// POST /api/save {content} → validates against the schema and commits content/site.json to site/preview.
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { adminContext } from './_lib/context.js';
import { ensurePreview, PREVIEW, CONTENT_PATH } from './_lib/site-repo.js';
import { validateContent, changedPaths } from '../site-build/lib/schema.mjs';

export default handler(async (req, res) => {
  const { gh, store } = adminContext(req, 'POST');
  const body = await readJson(req, 200 * 1024);
  const content = body.content;
  const errors = validateContent(content);
  if (errors.length) throw new HttpError(400, 'في حقول محتاجة تصحيح', { public: { errors: errors.slice(0, 50) } });
  await ensurePreview(gh);
  const text = `${JSON.stringify(content, null, 2)}\n`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await gh.getText(CONTENT_PATH, PREVIEW);
    let before = null;
    if (current) { try { before = JSON.parse(current.text); } catch { before = null; } }
    if (current && current.text === text) return send(res, 200, { ok: true, unchanged: true });
    const changed = before ? changedPaths(before, content) : ['(ملف جديد)'];
    const message = `المحتوى: ${changed.slice(0, 5).join('، ')}`.slice(0, 200);
    if (await gh.putText({ branch: PREVIEW, path: CONTENT_PATH, text, message, sha: current ? current.sha : null })) {
      await store.appendLog({ action: 'save', summary: `حفظ في المعاينة: ${changed.slice(0, 20).join('، ')}${changed.length > 20 ? ' …' : ''}` });
      return send(res, 200, { ok: true, changed });
    }
  }
  throw new HttpError(409, 'تغيّر الملف أثناء الحفظ. حاول مرة أخرى.');
});
