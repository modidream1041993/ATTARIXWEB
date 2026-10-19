// POST /api/save {content} → validates against the schema and commits content/site.json to site/preview. When the
// contact (WhatsApp number, phone, name) changed, products-data.js's contact block is rewritten to match, so the
// products, «عنّا», download and «ما الجديد» pages (which read that file) follow the same number.
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { adminContext } from './_lib/context.js';
import { ensurePreview, readProductsData, PREVIEW, CONTENT_PATH } from './_lib/site-repo.js';
import { PRODUCTS_PATH, serializeProductsData, siteContactFrom } from './_lib/products-data.js';
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
    if (current && current.text === text) {
      await syncContact(gh, content);
      return send(res, 200, { ok: true, unchanged: true });
    }
    const changed = before ? changedPaths(before, content) : ['(ملف جديد)'];
    const message = `المحتوى: ${changed.slice(0, 5).join('، ')}`.slice(0, 200);
    if (await gh.putText({ branch: PREVIEW, path: CONTENT_PATH, text, message, sha: current ? current.sha : null })) {
      await syncContact(gh, content);
      await store.appendLog({ action: 'save', summary: `حفظ في المعاينة: ${changed.slice(0, 20).join('، ')}${changed.length > 20 ? ' …' : ''}` });
      return send(res, 200, { ok: true, changed });
    }
  }
  throw new HttpError(409, 'تغيّر الملف أثناء الحفظ. حاول مرة أخرى.');
});

// Rewrites products-data.js's contact block on site/preview when it differs from the content's contact. A missing file
// is left alone; a file in an unexpected format is reported (readProductsData), never rewritten.
async function syncContact(gh, content) {
  const want = siteContactFrom(content.contact);
  for (let attempt = 0; attempt < 3; attempt++) {
    const pd = await readProductsData(gh, PREVIEW);
    if (!pd) return;
    if (JSON.stringify(pd.contact) === JSON.stringify(want)) return;
    const text = serializeProductsData({ contact: want, ...pd.data });
    if (await gh.putText({ branch: PREVIEW, path: PRODUCTS_PATH, text, message: 'التواصل: products-data.js يتبع المحتوى', sha: pd.sha })) return;
  }
  throw new HttpError(409, 'تغيّر ملف المنتجات أثناء الحفظ. حاول مرة أخرى.');
}
