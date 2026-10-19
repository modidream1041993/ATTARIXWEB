// Logo uploads: the file type is judged by its BYTES (magic numbers), never by its name; SVG is accepted only when
// it carries nothing active. Accepted files are kept as uploaded (brand/original/<kind>.<ext>) and the sizes the
// pages use are generated from them with sharp.
import { BRAND_FILES } from '../../site-build/lib/schema.mjs';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const KINDS = ['mark', 'wordmark-blue', 'wordmark-light'];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  // SVG: text that (after an optional BOM, whitespace, an XML declaration and comments) opens with <svg.
  const head = buf.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '');
  const stripped = head.replace(/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*/, '');
  if (/^<svg[\s>]/i.test(stripped)) return 'svg';
  return null;
}

// Refuses (returns a reason) rather than "cleans": anything that can run, load, or reach outside the file.
export function svgProblem(text) {
  if (typeof text !== 'string') return 'ليس نصًا';
  if (Buffer.byteLength(text, 'utf8') > MAX_UPLOAD_BYTES) return 'الملف أكبر من 2 ميجابايت';
  if (text.includes('\u0000')) return 'الملف فيه بايتات غير نصية';
  const t = text;
  if (/<!DOCTYPE|<!ENTITY/i.test(t)) return 'غير مسموح بـ DOCTYPE أو ENTITY';
  if (/<\s*[\w-]*:?script\b/i.test(t)) return 'غير مسموح بـ <script>';
  if (/<\s*[\w-]*:?foreignObject\b/i.test(t)) return 'غير مسموح بـ <foreignObject>';
  if (/<\s*[\w-]*:?(?:iframe|embed|object|audio|video|animate|set|handler|listener)\b/i.test(t)) return 'عنصر غير مسموح';
  if (/[\s"'/;]on[a-z]+\s*=/i.test(t)) return 'غير مسموح بخصائص الأحداث (on…=)';
  if (/javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i.test(t)) return 'غير مسموح بروابط javascript:';
  if (/@import/i.test(t)) return 'غير مسموح بـ @import';
  // Every href / xlink:href / src must point inside the file (#id).
  const refs = t.matchAll(/(?:^|[\s"'])(?:[\w-]+:)?(?:href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi);
  for (const m of refs) {
    const v = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (!v.startsWith('#')) return 'كل الروابط داخل الملف لازم تبدأ بـ # (لا روابط خارجية)';
  }
  // CSS url(...) must also stay inside the file.
  for (const m of t.matchAll(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    if (!m[2].trim().startsWith('#')) return 'كل url(...) لازم تبدأ بـ #';
  }
  if (!/<svg[\s>]/i.test(t)) return 'ليس ملف SVG';
  return null;
}

// What each kind regenerates: [{path, format, width?, height?, square?}]
export function outputsFor(kind) {
  if (kind === 'mark') {
    return [
      { path: BRAND_FILES.mark440Png, format: 'png', width: 440 },
      { path: BRAND_FILES.mark880Png, format: 'png', width: 880 },
      { path: BRAND_FILES.mark975Png, format: 'png', width: 975 },
      { path: BRAND_FILES.mark440Webp, format: 'webp', width: 440 },
      { path: BRAND_FILES.mark880Webp, format: 'webp', width: 880 },
      { path: BRAND_FILES.mark975Webp, format: 'webp', width: 975 },
      { path: BRAND_FILES.markH108, format: 'png', height: 108 },
      { path: BRAND_FILES.square32, format: 'png', square: 32 },
      { path: BRAND_FILES.square64, format: 'png', square: 64 },
    ];
  }
  if (kind === 'wordmark-blue') return [{ path: BRAND_FILES.wordmarkBlue, format: 'png', height: 51 }];
  if (kind === 'wordmark-light') return [{ path: BRAND_FILES.wordmarkLight, format: 'png', height: 51 }];
  throw new Error('unknown kind');
}

// Renders every output. A raster original is never enlarged (a size wider than the original comes out at the
// original's size); an SVG is vector and is rasterised at a density high enough for the biggest output.
export async function generate(kind, buf, type, sharpImpl) {
  const sharp = sharpImpl || (await import('sharp')).default;
  const opts = { limitInputPixels: 40_000_000, failOn: 'error' };
  const meta = await sharp(buf, opts).metadata();
  if (!meta.width || !meta.height) throw new Error('no size');
  const outs = outputsFor(kind);
  const files = [];
  for (const o of outs) {
    let input = buf;
    let density;
    if (type === 'svg') {
      const scale = o.square ? o.square / Math.min(meta.width, meta.height)
        : o.width ? o.width / meta.width : o.height / meta.height;
      density = Math.min(2400, Math.max(72, Math.ceil(72 * scale * 1.05)));
    }
    let img = sharp(input, { ...opts, ...(density ? { density } : {}) });
    if (o.square) img = img.resize(o.square, o.square, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: type !== 'svg' });
    else if (o.width) img = img.resize({ width: o.width, withoutEnlargement: type !== 'svg' });
    else img = img.resize({ height: o.height, withoutEnlargement: type !== 'svg' });
    img = o.format === 'png' ? img.png({ compressionLevel: 9 }) : img.webp({ quality: 90 });
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    files.push({ path: o.path, data, width: info.width, height: info.height });
  }
  return { files, original: { width: meta.width, height: meta.height } };
}
