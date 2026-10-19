// The ONE schema of content/site.json — used by the build (a bad file fails the build) and by /api/save (a bad
// edit is refused before anything is committed). Strict: unknown keys are refused, every required field must be
// there, text is plain text only (no < or >, no control characters), numbers are whole, phone numbers are digits.

// Icons the home page defines once as <symbol>s (index.html). A card may only name one of these.
export const ICONS = [
  'i-wa', 'i-down', 'i-check', 'i-drawer', 'i-box', 'i-chart', 'i-people', 'i-wifi-off', 'i-basket', 'i-shirt',
  'i-phone', 'i-leaf', 'i-gear', 'i-cup', 'i-lock', 'i-pc', 'i-chat', 'i-ar', 'i-cal', 'i-refresh', 'i-shield',
  'i-usb', 'i-spark', 'i-id', 'i-scan', 'i-receipt', 'i-photo', 'i-bell', 'i-key', 'i-doc',
];
// The hero card colour classes: c1/c2 blue, c3/c4 orange (index.html CSS).
export const CARD_STYLES = ['c1', 'c2', 'c3', 'c4'];
export const PLAN_ACTIONS = ['download', 'whatsapp'];

// The brand files the pages use and the logo upload regenerates. Fixed names: an upload replaces the files in place.
export const BRAND_FILES = {
  markH108: 'brand/attarix-mark-h108.png',
  mark440Png: 'brand/attarix-mark-440.png',
  mark880Png: 'brand/attarix-mark-880.png',
  mark975Png: 'brand/attarix-mark-975.png',
  mark440Webp: 'brand/attarix-mark-440.webp',
  mark880Webp: 'brand/attarix-mark-880.webp',
  mark975Webp: 'brand/attarix-mark-975.webp',
  square32: 'brand/attarix-mark-square-32.png',
  square64: 'brand/attarix-mark-square-64.png',
  wordmarkBlue: 'brand/attarix-wordmark-blue-h51.png',
  wordmarkLight: 'brand/attarix-wordmark-light-h51.png',
};

// ---- schema builders ----
const str = (max, opt = {}) => ({ t: 'str', max, min: opt.min ?? 1, optional: !!opt.optional, re: opt.re, reMsg: opt.reMsg });
const optStr = (max) => str(max, { min: 0, optional: false }); // present, may be empty ""
const int = (opt = {}) => ({ t: 'int', min: opt.min ?? 0, max: opt.max ?? 10_000_000, nullable: !!opt.nullable });
const bool = () => ({ t: 'bool' });
const oneOf = (values) => ({ t: 'enum', values });
const list = (item, min, max) => ({ t: 'list', item, min, max });
const obj = (fields) => ({ t: 'obj', fields });

const section = (withSub = true) => obj({ title: str(160), sub: withSub ? optStr(400) : optStr(400) });

const plan = obj({
  name: str(40),
  for: str(160),
  tag: optStr(40),
  highlight: bool(),
  bullets: list(str(160), 1, 15),
  monthly: int({ nullable: true }),
  monthlyWas: int({ nullable: true }),
  yearly: int({ nullable: true }),
  yearlyWas: int({ nullable: true }),
  yearlyNote: optStr(80),
  priceText: optStr(60),
  button: obj({ text: str(60), action: oneOf(PLAN_ACTIONS) }),
});

export const SCHEMA = obj({
  version: { t: 'const', value: 1 },
  contact: obj({
    whatsapp: str(15, { min: 8, re: /^\d{8,15}$/, reMsg: 'أرقام فقط (8 إلى 15 رقمًا، بالكود الدولي من غير +)' }),
    phoneDisplay: str(15, { min: 6, re: /^\d{6,15}$/, reMsg: 'أرقام فقط' }),
    phoneTel: str(16, { min: 7, re: /^\+\d{6,15}$/, reMsg: 'علامة + ثم أرقام فقط' }),
    ownerName: str(60),
    waMessage: str(300),
  }),
  buttons: obj({ headerDownload: str(40), mainDownload: str(60), whatsapp: str(40) }),
  hero: obj({
    titleBefore: optStr(120),
    titleHighlight: str(80),
    titleAfter: optStr(120),
    sub: str(400),
    cards: list(obj({ title: str(60), small: str(80), icon: oneOf(ICONS), style: oneOf(CARD_STYLES) }), 0, 6),
    trust: list(str(60), 0, 6),
  }),
  sections: obj({
    pains: section(), ai: obj({ kicker: optStr(80), title: str(160), sub: optStr(400) }), biz: section(),
    screen: section(), why: section(), plans: section(), inside: section(), faq: section(), start: section(),
  }),
  plans: obj({
    offer: optStr(200),
    note: optStr(300),
    items: list(plan, 1, 4),
    hrAddon: obj({
      name: str(60),
      text: str(300),
      monthly: int({ nullable: true }),
      monthlyWas: int({ nullable: true }),
      yearly: int({ nullable: true }),
      yearlyWas: int({ nullable: true }),
      note: optStr(80),
    }),
  }),
  faq: list(obj({ q: str(200), a: str(1200) }), 1, 30),
  footer: obj({ copyright: str(80), aboutByline: str(60) }),
  brand: obj(Object.fromEntries(Object.keys(BRAND_FILES).map((k) => [k, str(80, { re: /^brand\/[a-z0-9][a-z0-9-]*\.(?:png|webp)$/, reMsg: 'مسار ملف داخل brand/ فقط' })]))),
});

// Control characters (C0, DEL, C1), line/paragraph separators, and the bidi OVERRIDE/ISOLATE controls (which can
// visually reorder text). LRM/RLM (U+200E/U+200F) stay allowed — Arabic text legitimately uses them.
const BAD_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

function check(schema, v, path, errors) {
  const at = path || '(الملف)';
  const err = (msg) => errors.push({ path: at, message: msg });
  switch (schema.t) {
    case 'const':
      if (v !== schema.value) err(`لازم تكون ${schema.value}`);
      return;
    case 'str': {
      if (typeof v !== 'string') return err('لازم يكون نص');
      if (v.length < schema.min) return err(schema.min === 1 ? 'مطلوب — لا يُترك فارغًا' : `أقل طول ${schema.min}`);
      if (v.length > schema.max) return err(`أطول من المسموح (${schema.max} حرف)`);
      if (/[<>]/.test(v)) return err('غير مسموح بعلامتي < و >');
      if (BAD_CHARS.test(v)) return err('فيه رموز تحكّم غير مسموحة (مثل سطر جديد)');
      if (v !== v.trim() && v.trim() === '') return err('مطلوب — لا يُترك فارغًا');
      if (schema.re && !schema.re.test(v)) err(schema.reMsg || 'صيغة غير صحيحة');
      return;
    }
    case 'int':
      if (v === null && schema.nullable) return;
      if (typeof v !== 'number' || !Number.isInteger(v)) return err('لازم يكون رقم صحيح');
      if (v < schema.min || v > schema.max) err(`لازم يكون بين ${schema.min} و ${schema.max}`);
      return;
    case 'bool':
      if (typeof v !== 'boolean') err('لازم تكون نعم/لا');
      return;
    case 'enum':
      if (!schema.values.includes(v)) err(`قيمة غير مسموحة`);
      return;
    case 'list':
      if (!Array.isArray(v)) return err('لازم تكون قائمة');
      if (v.length < schema.min) return err(`أقل عدد ${schema.min}`);
      if (v.length > schema.max) return err(`أكثر عدد ${schema.max}`);
      v.forEach((item, i) => check(schema.item, item, `${path}[${i}]`, errors));
      return;
    case 'obj': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return err('لازم يكون كائن');
      for (const k of Object.keys(v)) if (!Object.prototype.hasOwnProperty.call(schema.fields, k)) errors.push({ path: path ? `${path}.${k}` : k, message: 'حقل غير معروف' });
      for (const [k, s] of Object.entries(schema.fields)) {
        const p = path ? `${path}.${k}` : k;
        if (!Object.prototype.hasOwnProperty.call(v, k)) { errors.push({ path: p, message: 'حقل مطلوب ناقص' }); continue; }
        check(s, v[k], p, errors);
      }
      return;
    }
    default:
      throw new Error(`schema: unknown type ${schema.t}`);
  }
}

// Rules that span fields (a plan with no price text must have a monthly price; a "was" price needs its price).
function crossChecks(c, errors) {
  if (!c || !c.plans || !Array.isArray(c.plans.items)) return;
  const pricePairs = (p, base) => {
    if (p.monthlyWas !== null && p.monthly === null) errors.push({ path: `${base}.monthlyWas`, message: 'السعر قبل الخصم يحتاج سعرًا شهريًا' });
    if (p.yearlyWas !== null && p.yearly === null) errors.push({ path: `${base}.yearlyWas`, message: 'السعر السنوي قبل الخصم يحتاج سعرًا سنويًا' });
  };
  c.plans.items.forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const base = `plans.items[${i}]`;
    if (p.priceText === '' && p.monthly === null) errors.push({ path: `${base}.monthly`, message: 'اكتب السعر الشهري، أو نص بدل السعر (مثل «قريبًا»)' });
    pricePairs(p, base);
  });
  const h = c.plans.hrAddon;
  if (h && typeof h === 'object') {
    if (h.monthly === null) errors.push({ path: 'plans.hrAddon.monthly', message: 'السعر الشهري مطلوب' });
    pricePairs(h, 'plans.hrAddon');
  }
}

export function validateContent(c) {
  const errors = [];
  check(SCHEMA, c, '', errors);
  if (errors.length === 0) crossChecks(c, errors);
  return errors;
}

export function assertValidContent(c, where = 'content/site.json') {
  const errors = validateContent(c);
  if (errors.length) {
    const lines = errors.slice(0, 30).map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`${where} is invalid (${errors.length} problem${errors.length > 1 ? 's' : ''}):\n${lines}`);
  }
}

// Leaf paths that differ between two content objects — for the change log ("what changed"), capped.
export function changedPaths(a, b, path = '', out = []) {
  if (out.length >= 60) return out;
  const isObj = (x) => x !== null && typeof x === 'object';
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${path} (${a.length}→${b.length})`); return out; }
    a.forEach((x, i) => changedPaths(x, b[i], `${path}[${i}]`, out));
    return out;
  }
  if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) changedPaths(a[k], b[k], path ? `${path}.${k}` : k, out);
    return out;
  }
  if (a !== b) out.push(path || '(الملف)');
  return out;
}
