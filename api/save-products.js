// POST /api/save-products {productsData: {sections, products, about}} → validates and commits products-data.js to
// site/preview, in the old panel's exact format. The file's contact block is kept as it is (it follows content/site.json
// through /api/save). An image a product or a team member names must exist on site/preview.
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { adminContext } from './_lib/context.js';
import { ensurePreview, readProductsData, PREVIEW } from './_lib/site-repo.js';
import { PRODUCTS_PATH, serializeProductsData, validateProductsData } from './_lib/products-data.js';
import { changedPaths } from '../site-build/lib/schema.mjs';

export default handler(async (req, res) => {
  const { gh, store } = adminContext(req, 'POST');
  const body = await readJson(req, 400 * 1024);
  const d = body.productsData;
  const shape = validateProductsData(d, () => true);
  if (shape.length) throw new HttpError(400, 'في حقول محتاجة تصحيح', { public: { errors: shape.slice(0, 50) } });
  const tip = await ensurePreview(gh);
  const { map } = await gh.treeMap(tip);
  const errors = validateProductsData(d, (p) => map.has(p));
  if (errors.length) throw new HttpError(400, 'في حقول محتاجة تصحيح', { public: { errors: errors.slice(0, 50) } });
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readProductsData(gh, PREVIEW);
    if (!current) throw new HttpError(409, 'ملف المنتجات غير موجود في المعاينة');
    const data = { sections: d.sections, products: d.products, about: d.about };
    const text = serializeProductsData({ contact: current.contact, ...data });
    if (current.text.replace(/\r\n/g, '\n') === text) return send(res, 200, { ok: true, unchanged: true });
    const changed = changedPaths(current.data, data);
    const message = `المنتجات/عنّا: ${changed.slice(0, 5).join('، ')}`.slice(0, 200);
    if (await gh.putText({ branch: PREVIEW, path: PRODUCTS_PATH, text, message, sha: current.sha })) {
      await store.appendLog({ action: 'save-products', summary: `حفظ المنتجات/عنّا في المعاينة: ${changed.slice(0, 20).join('، ')}${changed.length > 20 ? ' …' : ''}` });
      return send(res, 200, { ok: true, changed });
    }
  }
  throw new HttpError(409, 'تغيّر الملف أثناء الحفظ. حاول مرة أخرى.');
});
