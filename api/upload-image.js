// POST /api/upload-image {owner: 'product'|'team', id, filename, dataBase64} → a product image or a team photo, committed
// to site/preview as images/<id>-<time>.<ext> (products) or images/team-<id>-<time>.<ext> (team) — the names the old
// panel used. JPEG / PNG / WebP / GIF by their bytes, at most 3 MB (the old panel's limit). Re-encoded with sharp: turned
// upright, at most 1600 px wide, every metadata block (EXIF, GPS, camera) dropped. A GIF becomes a PNG (first frame).
// The data file is not touched: the editor puts the returned path on the product / member, and «حفظ في المعاينة» saves it.
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { adminContext } from './_lib/context.js';
import { ensurePreview, PREVIEW } from './_lib/site-repo.js';
import { UPLOADED_IMAGE_RE } from './_lib/products-data.js';

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_WIDTH = 1600;

export function detectPhoto(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'gif';
  return null;
}

export default handler(async (req, res) => {
  const { gh, store } = adminContext(req, 'POST');
  const body = await readJson(req, Math.ceil(MAX_IMAGE_BYTES * 1.4) + 4096);
  const { owner, id, filename, dataBase64 } = body;
  if (owner !== 'product' && owner !== 'team') throw new HttpError(400, 'نوع الصورة غير معروف');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(id)) throw new HttpError(400, 'معرّف غير صالح');
  if (typeof filename !== 'string' || filename.length < 1 || filename.length > 120) throw new HttpError(400, 'اسم الملف غير صالح');
  if (typeof dataBase64 !== 'string' || !dataBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) throw new HttpError(400, 'الملف غير صالح');
  const buf = Buffer.from(dataBase64, 'base64');
  if (!buf.length) throw new HttpError(400, 'الملف فارغ');
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'الصورة أكبر من 3 ميجابايت — صغّرها الأول');
  const type = detectPhoto(buf);
  if (!type) throw new HttpError(400, 'الملف ليس صورة JPEG ولا PNG ولا WebP ولا GIF');

  const sharp = (await import('sharp')).default;
  const ext = type === 'gif' ? 'png' : type;
  let out;
  try {
    let img = sharp(buf, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true });
    img = ext === 'jpg' ? img.jpeg({ quality: 85, mozjpeg: true }) : ext === 'png' ? img.png({ compressionLevel: 9 }) : img.webp({ quality: 85 });
    out = await img.toBuffer({ resolveWithObject: true });
  } catch { throw new HttpError(400, 'تعذّر قراءة الصورة'); }

  const path = `images/${owner === 'team' ? 'team-' : ''}${id}-${Date.now()}.${ext}`;
  if (!UPLOADED_IMAGE_RE.test(path)) throw new HttpError(400, 'معرّف غير صالح');
  await ensurePreview(gh);
  await gh.commitOnBranch({ branch: PREVIEW, entries: [{ path, base64: out.data.toString('base64') }], message: `صورة: ${path}` });
  await store.appendLog({ action: 'upload-image', summary: `رفع صورة ${owner === 'team' ? 'لفرد من الفريق' : 'لمنتج'}: ${path} (${out.info.width}×${out.info.height})` });
  send(res, 200, { ok: true, path, width: out.info.width, height: out.info.height });
});
