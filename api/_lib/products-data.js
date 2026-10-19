// products-data.js — the products page and the «عنّا» page. The OLD token panel (admin.html on the live site) writes
// this file, and the pages read it as plain <script> (window.SITE_CONTACT / SECTIONS / PRODUCTS / ABOUT). The new panel
// edits the SAME file in the SAME format, so the two never disagree on where the data lives:
//   - it is READ as JSON, block by block — never evaluated; a file that is not in the generated format is refused;
//   - it is WRITTEN exactly as the old panel's serialize() writes it (byte for byte: the round trip is tested);
//   - every edit is validated here before anything is committed.
// The pages render every value with esc() (site.js); the social links are set as an href, so they must be https://.

export const PRODUCTS_PATH = 'products-data.js';

// Images either panel uploads: images/<id>-<13-digit time>.<ext> (products) and images/team-<id>-<time>.<ext> (team).
// These — and only these — are files «نشر» / «تراجع» carry with the data; the site's own images are never touched.
export const UPLOADED_IMAGE_RE = /^images\/[A-Za-z0-9_-]+-\d{13}\.(?:png|jpe?g|webp|gif)$/;

const HEADER = '/* ملف بيانات المنتجات — بيتولّد تلقائيًا من لوحة التحكم (admin.html)\n'
  + '   عدّل من اللوحة، أو يدوي من هنا لو حابب. */\n\n';
const BLOCKS = ['SITE_CONTACT', 'SECTIONS', 'PRODUCTS', 'ABOUT'];

export class ProductsDataFormatError extends Error {}

export function parseProductsData(text) {
  const t = String(text).replace(/\r\n/g, '\n');
  const out = {};
  const re = /^window\.([A-Z_]+) = /gm;
  const marks = [];
  let m;
  while ((m = re.exec(t))) marks.push({ name: m[1], start: m.index, body: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : t.length;
    const raw = t.slice(marks[i].body, end).trim().replace(/;$/, '');
    if (!BLOCKS.includes(marks[i].name)) throw new ProductsDataFormatError(`كتلة غير معروفة: window.${marks[i].name}`);
    try { out[marks[i].name] = JSON.parse(raw); } catch { throw new ProductsDataFormatError(`window.${marks[i].name} ليست بصيغة JSON`); }
  }
  for (const b of BLOCKS) if (!(b in out)) throw new ProductsDataFormatError(`window.${b} ناقصة`);
  return { contact: out.SITE_CONTACT, sections: out.SECTIONS, products: out.PRODUCTS, about: out.ABOUT };
}

export function serializeProductsData({ contact, sections, products, about }) {
  return HEADER
    + 'window.SITE_CONTACT = ' + JSON.stringify(contact, null, 2) + ';\n\n'
    + 'window.SECTIONS = ' + JSON.stringify(sections, null, 2) + ';\n\n'
    + 'window.PRODUCTS = ' + JSON.stringify(products, null, 2) + ';\n\n'
    + 'window.ABOUT = ' + JSON.stringify(about, null, 2) + ';\n';
}

// The contact the old panel keeps in the file, from content/site.json's contact (the new panel's one source).
export const siteContactFrom = (c) => ({ whatsapp: c.whatsapp, phone: c.phoneTel, owner: c.ownerName });

// ---- validation: {sections, products, about} → [{path, message}] (paths start with "pd." to match the editor) ----
// eslint-disable-next-line no-control-regex
const CTRL_ONE_LINE = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const CTRL_MULTI = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const ID_RE = /^[A-Za-z0-9_-]{1,60}$/;
const IMAGE_PATH_RE = /^images\/(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]{0,150}\.(?:png|jpe?g|webp|gif)$/i;

const S = (max, o = {}) => ({ t: 'str', max, min: o.min ?? 0, multi: !!o.multi, re: o.re, reMsg: o.reMsg, optional: !!o.optional });
const L = (item, max, o = {}) => ({ t: 'list', item, max, optional: !!o.optional });
const O = (fields) => ({ t: 'obj', fields });
const B = (o = {}) => ({ t: 'bool', optional: !!o.optional });

const imageField = (o = {}) => S(160, { ...o, re: /^$|^images\//, reMsg: 'مسار صورة داخل images/ فقط' });
const SECTION = O({ id: S(60, { min: 1, re: ID_RE, reMsg: 'معرّف غير صالح' }), icon: S(16), title: S(120, { min: 1 }), note: S(300) });
const PRODUCT = O({
  id: S(60, { min: 1, re: ID_RE, reMsg: 'معرّف غير صالح' }),
  section: S(60, { min: 1, re: ID_RE, reMsg: 'معرّف قسم غير صالح' }),
  icon: S(16, { optional: true }),
  isNew: B({ optional: true }),
  name: S(300, { min: 1 }),
  short: S(4000, { multi: true }),
  description: S(10000, { multi: true, optional: true }),
  features: L(S(500), 60, { optional: true }),
  price: S(120, { optional: true }),
  image: imageField({ optional: true }),
  page: S(60, { optional: true, re: /^[a-z0-9-]+\.html$/, reMsg: 'اسم صفحة غير صالح' }),
});
const MEMBER = O({
  id: S(60, { min: 1, re: ID_RE, reMsg: 'معرّف غير صالح' }),
  name: S(120, { min: 1 }),
  role: S(200),
  phone: S(20, { re: /^[0-9+ ]*$/, reMsg: 'أرقام فقط (ومسموح + ومسافة)' }),
  photo: imageField(),
  bio: S(600, { multi: true, optional: true }),
});
const httpsOrEmpty = S(300, { re: /^$|^https:\/\/[^\s"'<>]+$/, reMsg: 'رابط يبدأ بـ https:// أو فاضي' });
const ABOUT = O({
  team: L(MEMBER, 40),
  whoami: S(4000, { multi: true }),
  story: S(6000, { multi: true }),
  milestones: L(S(300), 40),
  doing: L(S(300), 40),
  riddle: O({ q: S(300), a: S(300) }),
  socials: O({ facebook: httpsOrEmpty, linkedin: httpsOrEmpty, email: S(120, { re: /^$|^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/, reMsg: 'إيميل غير صالح' }) }),
});
const DATA = O({ sections: L(SECTION, 30), products: L(PRODUCT, 300), about: ABOUT });

function check(s, v, path, errors) {
  const err = (message) => errors.push({ path, message });
  if (s.t === 'str') {
    if (typeof v !== 'string') return err('لازم يكون نص');
    if (v.trim().length < s.min) return err('مطلوب — لا يُترك فارغًا');
    if (v.length > s.max) return err(`أطول من المسموح (${s.max} حرف)`);
    if ((s.multi ? CTRL_MULTI : CTRL_ONE_LINE).test(v)) return err('فيه رموز تحكّم غير مسموحة');
    if (s.re && !s.re.test(v)) err(s.reMsg || 'صيغة غير صحيحة');
    return;
  }
  if (s.t === 'bool') { if (typeof v !== 'boolean') err('لازم تكون نعم/لا'); return; }
  if (s.t === 'list') {
    if (!Array.isArray(v)) return err('لازم تكون قائمة');
    if (v.length > s.max) return err(`أكثر عدد ${s.max}`);
    v.forEach((x, i) => check(s.item, x, `${path}[${i}]`, errors));
    return;
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return err('لازم يكون كائن');
  for (const k of Object.keys(v)) if (!Object.prototype.hasOwnProperty.call(s.fields, k)) errors.push({ path: `${path}.${k}`, message: 'حقل غير معروف' });
  for (const [k, f] of Object.entries(s.fields)) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) { if (!f.optional) errors.push({ path: `${path}.${k}`, message: 'حقل مطلوب ناقص' }); continue; }
    check(f, v[k], `${path}.${k}`, errors);
  }
}

// existingPath(p) → whether that file exists on the branch being saved to (an image must exist to be referenced).
export function validateProductsData(d, existingPath = () => true) {
  const errors = [];
  check(DATA, d, 'pd', errors);
  if (errors.length) return errors;
  const dup = (arr, base) => {
    const seen = new Set();
    arr.forEach((x, i) => { if (seen.has(x.id)) errors.push({ path: `${base}[${i}].id`, message: 'معرّف مكرر' }); seen.add(x.id); });
  };
  dup(d.sections, 'pd.sections');
  dup(d.products, 'pd.products');
  dup(d.about.team, 'pd.about.team');
  const img = (p, path) => {
    if (!p) return;
    if (!IMAGE_PATH_RE.test(p)) errors.push({ path, message: 'مسار صورة غير صالح' });
    else if (!existingPath(p)) errors.push({ path, message: 'الصورة غير موجودة في المعاينة — ارفعها من جديد أو صحّح المسار' });
  };
  d.products.forEach((p, i) => img(p.image, `pd.products[${i}].image`));
  d.about.team.forEach((m, i) => img(m.photo, `pd.about.team[${i}].photo`));
  return errors;
}
