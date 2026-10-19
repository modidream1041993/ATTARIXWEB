// The site repository's two branches the panel works with:
//   main          production — Vercel deploys it to the live site
//   site/preview  where «حفظ في المعاينة» commits; Vercel builds a preview of it
// The panel only ever commits to site/preview, copies the content and brand files from site/preview onto main as one
// plain commit («نشر» — never a merge: site/preview may carry the panel's own code, which must never reach main), and
// adds a restoring commit of those same files on top of main («تراجع»). It never force-moves a branch.
import { HttpError } from './http.js';
import { BRAND_FILES } from '../../site-build/lib/schema.mjs';
import { PRODUCTS_PATH, UPLOADED_IMAGE_RE, parseProductsData, ProductsDataFormatError } from './products-data.js';

export const MAIN = 'main';
export const PREVIEW = 'site/preview';
export const CONTENT_PATH = 'content/site.json';
// main is built from the content file only once this file is on it (the owner merges site/public into main).
export const BUILD_PATH = 'site-build/build.mjs';

// Every file the panel manages — the ONLY files «نشر» and «تراجع» ever write on main: the content, the brand files
// (the generated sizes and the kept originals), the products / «عنّا» data file, and the images uploaded for it.
export const isManagedPath = (p) => p === CONTENT_PATH || p === PRODUCTS_PATH || UPLOADED_IMAGE_RE.test(p)
  || Object.values(BRAND_FILES).includes(p) || /^brand\/original\/[a-z-]+\.(?:png|webp|svg)$/.test(p);

// Makes sure site/preview exists and carries everything main has (so a preview shows the site as it is today plus
// the unpublished edits). Created from main when missing; main merged into it when it is behind.
export async function ensurePreview(gh) {
  const mainSha = await gh.getRef(MAIN);
  if (!mainSha) throw new HttpError(502, 'الفرع الرئيسي غير موجود');
  const tip = await gh.getRef(PREVIEW);
  if (!tip) {
    await gh.createRef(PREVIEW, mainSha);
    return gh.getRef(PREVIEW);
  }
  const { behind } = await gh.aheadBy(MAIN, PREVIEW);
  if (behind > 0) await gh.merge(PREVIEW, MAIN, 'المعاينة: تحديث من الموقع المنشور (main)');
  return gh.getRef(PREVIEW);
}

// The content the editor opens: site/preview's if that branch exists, else main's.
export async function readContent(gh) {
  let source = MAIN;
  let f = null;
  if (await gh.getRef(PREVIEW)) {
    f = await gh.getText(CONTENT_PATH, PREVIEW);
    if (f) source = PREVIEW;
  }
  if (!f) f = await gh.getText(CONTENT_PATH, MAIN);
  if (!f) throw new HttpError(404, "ملف المحتوى غير موجود");
  let content;
  try { content = JSON.parse(f.text); } catch { throw new HttpError(500, "ملف المحتوى تالف"); }
  return { content, source, sha: f.sha };
}

// The products / «عنّا» data on a branch: { data: {sections, products, about}, contact, sha, text } or null when the file
// is missing. A file not in the generated format is an error the owner sees (it is never evaluated).
export async function readProductsData(gh, ref) {
  const f = await gh.getText(PRODUCTS_PATH, ref);
  if (!f) return null;
  let d;
  try { d = parseProductsData(f.text); } catch (e) {
    if (e instanceof ProductsDataFormatError) throw new HttpError(409, `ملف المنتجات (products-data.js) بصيغة غير متوقعة: ${e.message}`);
    throw e;
  }
  return { data: { sections: d.sections, products: d.products, about: d.about }, contact: d.contact, sha: f.sha, text: f.text };
}

// The changes that make the managed files of currentMap equal those of desiredMap (path → blob sha): an entry
// pointing at the old blob for each changed or missing file, a removal for each managed file desiredMap lacks.
export function restoreEntries(desiredMap, currentMap) {
  const paths = new Set([...desiredMap.keys(), ...currentMap.keys()].filter(isManagedPath));
  const entries = [];
  for (const p of [...paths].sort()) {
    const want = desiredMap.get(p);
    const have = currentMap.get(p);
    if (want === have) continue;
    entries.push(want ? { path: p, blobSha: want } : { path: p, remove: true });
  }
  return entries;
}
