// GET /api/content → the content file from site/preview if that branch exists, else from main — with the products /
// «عنّا» data (products-data.js) from the same branch.
import { handler, send } from './_lib/http.js';
import { adminContext } from './_lib/context.js';
import { readContent, readProductsData } from './_lib/site-repo.js';

export default handler(async (req, res) => {
  const { gh } = adminContext(req, 'GET');
  const { content, source } = await readContent(gh);
  const pd = await readProductsData(gh, source);
  send(res, 200, { ok: true, content, source, productsData: pd ? pd.data : null });
});
