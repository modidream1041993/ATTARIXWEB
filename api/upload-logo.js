// POST /api/upload-logo {kind, filename, dataBase64} → keeps the original under brand/original/ and regenerates the
// sizes the pages use; all of it in ONE commit on site/preview. PNG / WebP / SVG by magic bytes, at most 2 MB; an
// SVG with anything active in it is refused. The brand file names stay the same, so content/site.json's brand paths
// do not change.
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { adminContext } from './_lib/context.js';
import { ensurePreview, PREVIEW } from './_lib/site-repo.js';
import { KINDS, MAX_UPLOAD_BYTES, detectType, svgProblem, generate } from './_lib/images.js';

export function checkUpload({ kind, filename, dataBase64 }) {
  if (!KINDS.includes(kind)) throw new HttpError(400, 'نوع الشعار غير معروف');
  if (typeof filename !== 'string' || filename.length < 1 || filename.length > 120) throw new HttpError(400, 'اسم الملف غير صالح');
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) throw new HttpError(400, 'الملف غير صالح');
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length === 0) throw new HttpError(400, 'الملف فارغ');
  if (buf.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'الملف أكبر من 2 ميجابايت');
  const type = detectType(buf);
  if (!type) throw new HttpError(400, 'الملف ليس PNG ولا WebP ولا SVG');
  const ext = ((/\.([a-z0-9]+)$/i.exec(filename) || [])[1] || '').toLowerCase();
  if (ext !== type) throw new HttpError(400, `امتداد الملف لا يطابق محتواه (المحتوى ${type.toUpperCase()})`);
  if (type === 'svg') {
    const problem = svgProblem(buf.toString('utf8'));
    if (problem) throw new HttpError(400, `ملف SVG مرفوض: ${problem}`);
  }
  return { buf, type };
}

export default handler(async (req, res) => {
  const { gh, store } = adminContext(req, 'POST');
  const body = await readJson(req, Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 4096);
  const { buf, type } = checkUpload(body);
  const kind = body.kind;
  let out;
  try { out = await generate(kind, buf, type); } catch { throw new HttpError(400, 'تعذّر قراءة الصورة'); }

  const tip = await ensurePreview(gh);
  const { map } = await gh.treeMap(tip);
  const originalPath = `brand/original/${kind}.${type}`;
  const entries = [{ path: originalPath, base64: buf.toString('base64') }];
  for (const other of ['png', 'webp', 'svg']) {
    const p = `brand/original/${kind}.${other}`;
    if (other !== type && map.has(p)) entries.push({ path: p, remove: true });
  }
  for (const f of out.files) entries.push({ path: f.path, base64: f.data.toString('base64') });
  await gh.commitOnBranch({ branch: PREVIEW, entries, message: `الشعار: ${kind} (${type}, ${out.original.width}×${out.original.height})` });
  const sizes = out.files.map((f) => ({ path: f.path, width: f.width, height: f.height }));
  await store.appendLog({ action: 'upload-logo', summary: `رفع شعار ${kind}: ${type.toUpperCase()} ${out.original.width}×${out.original.height} — ${sizes.length} مقاس` });
  send(res, 200, { ok: true, original: { path: originalPath, ...out.original }, sizes });
});
