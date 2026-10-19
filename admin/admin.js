/* ATTARIX — لوحة تحكم الموقع (/admin).
   Every piece of data is put on the page with textContent / value only — never innerHTML. No secret lives here:
   the session is an HttpOnly cookie the page cannot read, and every check is made again by the server (api/). */
(function () {
  'use strict';

  var ICONS = ['i-drawer', 'i-scan', 'i-chart', 'i-box', 'i-people', 'i-wifi-off', 'i-basket', 'i-shirt', 'i-phone',
    'i-leaf', 'i-gear', 'i-cup', 'i-lock', 'i-pc', 'i-chat', 'i-ar', 'i-cal', 'i-refresh', 'i-shield', 'i-usb',
    'i-spark', 'i-id', 'i-receipt', 'i-photo', 'i-bell', 'i-key', 'i-doc', 'i-check', 'i-down', 'i-wa'];
  var ICON_NAMES = { 'i-drawer': 'درج', 'i-scan': 'مسح/فاتورة', 'i-chart': 'رسم بياني', 'i-box': 'صندوق', 'i-people': 'ناس',
    'i-wifi-off': 'بدون نت', 'i-basket': 'سلة', 'i-shirt': 'قميص', 'i-phone': 'موبايل', 'i-leaf': 'ورقة شجر', 'i-gear': 'ترس',
    'i-cup': 'كوب', 'i-lock': 'قفل', 'i-pc': 'كمبيوتر', 'i-chat': 'محادثة', 'i-ar': 'سطور', 'i-cal': 'تقويم',
    'i-refresh': 'تحديث', 'i-shield': 'درع', 'i-usb': 'فلاشة', 'i-spark': 'نجمة', 'i-id': 'بطاقة', 'i-receipt': 'إيصال',
    'i-photo': 'كاميرا', 'i-bell': 'جرس', 'i-key': 'مفتاح', 'i-doc': 'ملف', 'i-check': 'علامة صح', 'i-down': 'تحميل', 'i-wa': 'واتساب' };
  var STYLES = [['c1', 'أزرق (١)'], ['c2', 'أزرق (٢)'], ['c3', 'برتقالي (١)'], ['c4', 'برتقالي (٢)']];
  var SECTION_NAMES = { pains: 'المشاكل والحل', ai: 'الذكاء الاصطناعي', biz: 'لنشاطك', screen: 'لقطة الشاشة', why: 'ليه ATTARIX',
    plans: 'الأسعار', inside: 'جوّه البرنامج', faq: 'الأسئلة', start: 'الدعوة الأخيرة' };
  var ACTION_NAMES = { login: 'دخول', 'login-locked': 'قفل الدخول', save: 'حفظ في المعاينة', 'upload-logo': 'رفع شعار',
    publish: 'نشر', rollback: 'تراجع' };
  var MAX_LOGO = 2 * 1024 * 1024;

  var draft = null;       // the content being edited
  var savedJson = '';     // the content as last loaded/saved
  var previewUrl = '';

  // ---------- small DOM helpers (text only) ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, props) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k === 'onclick') n.addEventListener('click', v);
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }
  function setStatus(text, kind) { var s = $('status'); s.textContent = text || ''; s.className = 'status' + (kind ? ' ' + kind : ''); }
  function toLatinDigits(s) {
    return String(s).replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
  }
  function oneLine(s) { return String(s).replace(/[\r\n\t]+/g, ' '); }

  // ---------- theme ----------
  function applyTheme(t) { if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  try { applyTheme(localStorage.getItem('attarix_admin_theme')); } catch (e) { /* storage unavailable: follow the system */ }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var dark = cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next = dark ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('attarix_admin_theme', next); } catch (e) { /* not remembered: fine */ }
  }

  // ---------- API ----------
  function api(path, method, body) {
    var opts = { method: method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method && method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'رد غير متوقع من الخادم' }; }).then(function (j) {
        if (r.status === 401 && path !== '/api/login') { showLogin('انتهت الجلسة — سجّل الدخول من جديد.'); }
        if (!r.ok || !j.ok) { var e = new Error(j.error || 'حدث خطأ'); e.data = j; e.status = r.status; throw e; }
        return j;
      });
    }, function () { throw new Error('تعذّر الاتصال بالإنترنت أو بالخادم'); });
  }

  // ---------- confirm dialog ----------
  function confirmBox(title, text, yesLabel) {
    var d = $('confirmDialog');
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmYes').textContent = yesLabel;
    if (typeof d.showModal !== 'function') return Promise.resolve(window.confirm(title + '\n\n' + text));
    return new Promise(function (resolve) {
      d.addEventListener('close', function onClose() { d.removeEventListener('close', onClose); resolve(d.returnValue === 'yes'); });
      d.returnValue = '';
      d.showModal();
    });
  }

  // ---------- views ----------
  function show(view) {
    ['loginView', 'loadingView', 'editorView'].forEach(function (v) { $(v).hidden = v !== view; });
    $('actionBar').hidden = view !== 'editorView';
    $('logoutBtn').hidden = view !== 'editorView';
  }
  function showLogin(msg) {
    show('loginView');
    var m = $('loginMsg');
    m.hidden = !msg; m.textContent = msg || '';
    $('password').focus();
  }

  // ---------- fields bound to the draft ----------
  function markDirty() {
    var dirty = JSON.stringify(draft) !== savedJson;
    var b = $('saveBtn');
    b.textContent = 'حفظ في المعاينة';
    if (dirty) b.appendChild(el('span', { class: 'dirty-dot', 'aria-label': 'تعديلات غير محفوظة' }));
  }
  function textField(label, obj, key, path, o) {
    o = o || {};
    var input = o.multiline ? el('textarea', { rows: 3 }) : el('input', { type: 'text' });
    input.value = obj[key];
    input.dataset.path = path;
    if (o.max) input.setAttribute('maxlength', o.max);
    if (o.ltr) input.classList.add('ltr');
    if (o.inputmode) input.setAttribute('inputmode', o.inputmode);
    input.addEventListener('input', function () {
      var v = oneLine(input.value);
      if (o.digits) v = toLatinDigits(v);
      obj[key] = v;
      input.classList.remove('invalid');
      markDirty();
    });
    return el('label', { class: 'f' }, el('span', { text: label }), o.hint ? el('small', { text: o.hint }) : null, input);
  }
  function numberField(label, obj, key, path, hint) {
    var input = el('input', { type: 'text', inputmode: 'numeric', class: 'ltr' });
    input.value = obj[key] === null ? '' : String(obj[key]);
    input.dataset.path = path;
    input.addEventListener('input', function () {
      var raw = toLatinDigits(input.value).replace(/[,\s٬]/g, '');
      if (raw === '') { obj[key] = null; input.classList.remove('invalid'); }
      else if (/^\d{1,8}$/.test(raw)) { obj[key] = Number(raw); input.classList.remove('invalid'); }
      else { obj[key] = raw; input.classList.add('invalid'); }
      markDirty();
    });
    return el('label', { class: 'f' }, el('span', { text: label }), hint ? el('small', { text: hint }) : null, input);
  }
  function checkField(label, obj, key, path) {
    var input = el('input', { type: 'checkbox' });
    input.checked = !!obj[key];
    input.dataset.path = path;
    input.addEventListener('change', function () { obj[key] = input.checked; markDirty(); });
    return el('label', { class: 'check' }, input, el('span', { text: label }));
  }
  function selectField(label, obj, key, path, options) {
    var s = el('select');
    s.dataset.path = path;
    options.forEach(function (o) { var opt = el('option', { value: o[0], text: o[1] }); if (o[0] === obj[key]) opt.selected = true; s.appendChild(opt); });
    s.addEventListener('change', function () { obj[key] = s.value; markDirty(); });
    return el('label', { class: 'f' }, el('span', { text: label }), s);
  }

  // A list of items with add / remove / move up / move down. renderItem(item, index, path) → element.
  function listEditor(arr, path, o) {
    var box = el('div');
    function redraw() {
      box.textContent = '';
      arr.forEach(function (item, i) {
        var p = path + '[' + i + ']';
        var head = el('div', { class: 'item-head' }, el('b', { text: o.title(item, i) }),
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'لفوق', onclick: function () { move(i, -1); }, disabled: i === 0 }, '▲'),
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'لتحت', onclick: function () { move(i, 1); }, disabled: i === arr.length - 1 }, '▼'),
          el('button', { type: 'button', class: 'icon-btn del', 'aria-label': 'حذف', onclick: function () { remove(i); }, disabled: arr.length <= (o.min || 0) }, '✕'));
        box.appendChild(el('div', { class: 'item', 'data-path': p }, head, o.render(item, i, p)));
      });
      if (arr.length < o.max) box.appendChild(el('button', { type: 'button', class: 'btn btn-sm add', onclick: function () { arr.push(o.make()); redraw(); markDirty(); } }, '+ ' + o.addLabel));
    }
    function move(i, d) { var j = i + d; if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; redraw(); markDirty(); }
    function remove(i) { if (arr.length <= (o.min || 0)) return; arr.splice(i, 1); redraw(); markDirty(); }
    redraw();
    return box;
  }
  // A list of short strings (bullets, trust items).
  function stringList(arr, path, o) {
    var box = el('div');
    function redraw() {
      box.textContent = '';
      arr.forEach(function (v, i) {
        var input = el('input', { type: 'text', maxlength: o.maxLen || 160 });
        input.value = v;
        input.dataset.path = path + '[' + i + ']';
        input.addEventListener('input', function () { arr[i] = oneLine(input.value); input.classList.remove('invalid'); markDirty(); });
        box.appendChild(el('div', { class: 'mini' }, input,
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'لفوق', disabled: i === 0, onclick: function () { var t = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = t; redraw(); markDirty(); } }, '▲'),
          el('button', { type: 'button', class: 'icon-btn del', 'aria-label': 'حذف', disabled: arr.length <= (o.min || 0), onclick: function () { arr.splice(i, 1); redraw(); markDirty(); } }, '✕')));
      });
      if (arr.length < o.max) box.appendChild(el('button', { type: 'button', class: 'btn btn-sm add', onclick: function () { arr.push(''); redraw(); markDirty(); } }, '+ ' + o.addLabel));
    }
    redraw();
    return box;
  }
  function panel(title, body, open) {
    var d = el('details', { class: 'panel' }, el('summary', { text: title }), el('div', { class: 'body' }, body));
    if (open) d.open = true;
    return d;
  }
  function frag() { var f = document.createDocumentFragment(); for (var i = 0; i < arguments.length; i++) if (arguments[i]) f.appendChild(arguments[i]); return f; }

  // ---------- the editor ----------
  function priceFields(p, path, withNote, noteKey, noteLabel) {
    return frag(
      el('div', { class: 'row2' },
        numberField('السعر الشهري (جنيه)', p, 'monthly', path + '.monthly'),
        numberField('الشهري قبل الخصم (يتشطب)', p, 'monthlyWas', path + '.monthlyWas', 'سيبه فاضي لو مفيش')),
      el('div', { class: 'row2' },
        numberField('السعر السنوي (جنيه)', p, 'yearly', path + '.yearly', 'سيبه فاضي لو مفيش سنوي'),
        numberField('السنوي قبل الخصم (يتشطب)', p, 'yearlyWas', path + '.yearlyWas')),
      withNote ? textField(noteLabel, p, noteKey, path + '.' + noteKey, { max: 80 }) : null);
  }

  function buildEditor() {
    var c = draft;
    var root = $('panels');
    root.textContent = '';

    // Plans
    root.appendChild(panel('الباقات والأسعار', frag(
      textField('سطر عرض الإطلاق', c.plans, 'offer', 'plans.offer', { max: 200, hint: 'سيبه فاضي لإخفائه' }),
      listEditor(c.plans.items, 'plans.items', {
        min: 1, max: 4, addLabel: 'باقة',
        title: function (p, i) { return 'باقة ' + (i + 1) + (p.name ? ' — ' + p.name : ''); },
        make: function () { return { name: '', for: '', tag: '', highlight: false, bullets: [''], monthly: null, monthlyWas: null, yearly: null, yearlyWas: null, yearlyNote: '', priceText: '', button: { text: 'حمّل وجرّب 30 يوم', action: 'download' } }; },
        render: function (p, i, path) {
          return frag(
            textField('اسم الباقة', p, 'name', path + '.name', { max: 40 }),
            textField('لمين (السطر تحت الاسم)', p, 'for', path + '.for', { max: 160 }),
            textField('شارة فوق الكارت', p, 'tag', path + '.tag', { max: 40, hint: 'مثل «الأكثر طلبًا» — سيبه فاضي لو مفيش' }),
            checkField('باقة مميّزة (إطار برتقالي وزر برتقالي)', p, 'highlight', path + '.highlight'),
            el('p', { class: 'hint', text: 'المزايا:' }),
            stringList(p.bullets, path + '.bullets', { min: 1, max: 15, addLabel: 'ميزة' }),
            textField('نص بدل السعر', p, 'priceText', path + '.priceText', { max: 60, hint: 'مثل «قريبًا» — لو اتكتب، الأسعار ما تظهرش' }),
            priceFields(p, path, true, 'yearlyNote', 'ملاحظة بعد السعر السنوي (مثل «(شهرين ببلاش)»)'),
            textField('نص الزرار', p.button, 'text', path + '.button.text', { max: 60 }),
            selectField('الزرار بيعمل إيه', p.button, 'action', path + '.button.action', [['download', 'يفتح صفحة التحميل'], ['whatsapp', 'يفتح واتساب']]));
        },
      }),
      textField('سطر الملاحظة تحت الباقات', c.plans, 'note', 'plans.note', { max: 300, multiline: true, hint: 'سيبه فاضي لإخفائه' })), true));

    // HR add-on
    var h = c.plans.hrAddon;
    root.appendChild(panel('إضافة الموارد البشرية', frag(
      textField('الاسم', h, 'name', 'plans.hrAddon.name', { max: 60 }),
      textField('الوصف', h, 'text', 'plans.hrAddon.text', { max: 300, multiline: true }),
      priceFields(h, 'plans.hrAddon', true, 'note', 'ملاحظة بعد السعر (مثل «— فوق سعر باقة تاجر»)'))));

    // Hero
    root.appendChild(panel('الواجهة (أول الصفحة)', frag(
      textField('العنوان — الجزء الأول', c.hero, 'titleBefore', 'hero.titleBefore', { max: 120, hint: 'لاحظ المسافة في الآخر' }),
      textField('العنوان — الجزء الملوّن', c.hero, 'titleHighlight', 'hero.titleHighlight', { max: 80 }),
      textField('العنوان — الجزء الأخير', c.hero, 'titleAfter', 'hero.titleAfter', { max: 120, hint: 'لاحظ المسافة في الأول' }),
      textField('السطر تحت العنوان', c.hero, 'sub', 'hero.sub', { max: 400, multiline: true }),
      el('p', { class: 'hint', text: 'الكروت حوالين الشعار (أول نصهم فوق الشعار، والباقي تحته):' }),
      listEditor(c.hero.cards, 'hero.cards', {
        min: 0, max: 6, addLabel: 'كارت',
        title: function (k, i) { return 'كارت ' + (i + 1) + (k.title ? ' — ' + k.title : ''); },
        make: function () { return { title: '', small: '', icon: 'i-check', style: 'c1' }; },
        render: function (k, i, path) {
          return frag(
            textField('العنوان', k, 'title', path + '.title', { max: 60 }),
            textField('السطر الصغير', k, 'small', path + '.small', { max: 80 }),
            el('div', { class: 'row2' },
              selectField('الأيقونة', k, 'icon', path + '.icon', ICONS.map(function (x) { return [x, ICON_NAMES[x] || x]; })),
              selectField('اللون', k, 'style', path + '.style', STYLES)));
        },
      }),
      el('p', { class: 'hint', text: 'سطور الثقة تحت الأزرار:' }),
      stringList(c.hero.trust, 'hero.trust', { min: 0, max: 6, maxLen: 60, addLabel: 'سطر' }))));

    // Buttons
    root.appendChild(panel('نصوص الأزرار', frag(
      textField('زرار التحميل في أعلى الصفحات', c.buttons, 'headerDownload', 'buttons.headerDownload', { max: 40 }),
      textField('زرار التحميل الكبير', c.buttons, 'mainDownload', 'buttons.mainDownload', { max: 60 }),
      textField('زرار واتساب', c.buttons, 'whatsapp', 'buttons.whatsapp', { max: 40 }))));

    // Section titles
    var secs = frag();
    Object.keys(SECTION_NAMES).forEach(function (k) {
      var s = c.sections[k];
      secs.appendChild(el('div', { class: 'item' }, el('b', { text: SECTION_NAMES[k] }),
        k === 'ai' ? textField('الشارة فوق العنوان', s, 'kicker', 'sections.ai.kicker', { max: 80 }) : null,
        textField('العنوان', s, 'title', 'sections.' + k + '.title', { max: 160 }),
        textField('السطر تحت العنوان', s, 'sub', 'sections.' + k + '.sub', { max: 400, multiline: true, hint: 'سيبه فاضي لإخفائه' })));
    });
    root.appendChild(panel('عناوين أقسام الصفحة الرئيسية', secs));

    // FAQ
    root.appendChild(panel('الأسئلة الشائعة', listEditor(c.faq, 'faq', {
      min: 1, max: 30, addLabel: 'سؤال',
      title: function (f, i) { return 'سؤال ' + (i + 1); },
      make: function () { return { q: '', a: '' }; },
      render: function (f, i, path) {
        return frag(textField('السؤال', f, 'q', path + '.q', { max: 200 }), textField('الإجابة', f, 'a', path + '.a', { max: 1200, multiline: true }));
      },
    })));

    // Contact
    root.appendChild(panel('التواصل', frag(
      textField('رقم الواتساب (بالكود الدولي، أرقام بس)', c.contact, 'whatsapp', 'contact.whatsapp', { max: 15, ltr: true, digits: true, inputmode: 'numeric', hint: 'مثال: 201090246299' }),
      textField('رقم التليفون كما يظهر', c.contact, 'phoneDisplay', 'contact.phoneDisplay', { max: 15, ltr: true, digits: true, inputmode: 'numeric', hint: 'مثال: 01090246299' }),
      textField('رقم الاتصال (يبدأ بـ +)', c.contact, 'phoneTel', 'contact.phoneTel', { max: 16, ltr: true, digits: true, inputmode: 'tel', hint: 'مثال: +201090246299' }),
      textField('الاسم في التذييل والرسائل', c.contact, 'ownerName', 'contact.ownerName', { max: 60 }),
      textField('رسالة الواتساب الجاهزة (زرار آخر الصفحة)', c.contact, 'waMessage', 'contact.waMessage', { max: 300, multiline: true }))));

    // Footer
    root.appendChild(panel('التذييل', frag(
      textField('سطر الحقوق', c.footer, 'copyright', 'footer.copyright', { max: 80 }),
      textField('الاسم في تذييل صفحة «عنّا»', c.footer, 'aboutByline', 'footer.aboutByline', { max: 60 }))));

    // Logo
    root.appendChild(panel('الشعار', logoEditor()));

    // Log
    var logBox = el('div', {}, el('p', { class: 'hint', text: 'افتح القسم ده عشان يتحمّل السجل.' }));
    var logPanel = panel('سجل التغييرات', logBox);
    logPanel.addEventListener('toggle', function () { if (logPanel.open) loadLog(logBox); });
    root.appendChild(logPanel);
  }

  function logoEditor() {
    var b = draft.brand;
    var slots = [
      { kind: 'mark', title: 'العلامة (الدائرة)', imgs: [[b.mark440Png, 'الكبيرة'], [b.markH108, 'الصغيرة'], [b.square64, 'أيقونة المتصفح']], dark: false },
      { kind: 'wordmark-blue', title: 'كلمة ATTARIX — الزرقاء (للخلفية الفاتحة)', imgs: [[b.wordmarkBlue, 'الحالية']], dark: false },
      { kind: 'wordmark-light', title: 'كلمة ATTARIX — الفاتحة (للخلفية الداكنة)', imgs: [[b.wordmarkLight, 'الحالية']], dark: true },
    ];
    var f = frag(el('p', { class: 'hint', text: 'PNG أو WebP أو SVG، حتى 2 ميجابايت. الأصل بيتحفظ كما هو، والمقاسات اللي الصفحات محتاجاها بتتعمل منه تلقائيًا (من غير تكبير لصورة أصغر من المقاس). الرفع بيروح للمعاينة؛ «نشر» هو اللي يطلّعه على الموقع.' }));
    slots.forEach(function (s) {
      var imgs = el('div', { class: 'imgs' });
      s.imgs.forEach(function (x) { imgs.appendChild(el('figure', {}, el('img', { src: '/' + x[0], alt: '' }), el('figcaption', { text: x[1] }))); });
      var pick = el('input', { type: 'file', accept: '.png,.webp,.svg,image/png,image/webp,image/svg+xml' });
      var preview = el('div', { class: 'imgs' });
      var info = el('p', { class: 'hint' });
      var up = el('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: true }, 'رفع للمعاينة');
      var file = null;
      pick.addEventListener('change', function () {
        file = pick.files && pick.files[0] ? pick.files[0] : null;
        preview.textContent = ''; info.textContent = ''; up.disabled = true;
        if (!file) return;
        var ext = (/\.([a-z0-9]+)$/i.exec(file.name) || [])[1];
        ext = ext ? ext.toLowerCase() : '';
        if (['png', 'webp', 'svg'].indexOf(ext) < 0) { info.textContent = 'النوع لازم يكون PNG أو WebP أو SVG.'; file = null; return; }
        if (file.size > MAX_LOGO) { info.textContent = 'الملف أكبر من 2 ميجابايت (' + (file.size / 1048576).toFixed(2) + ' م.ب).'; file = null; return; }
        var url = URL.createObjectURL(file);
        var img = el('img', { src: url, alt: '' });
        img.addEventListener('load', function () { info.textContent = 'المقاس: ' + img.naturalWidth + '×' + img.naturalHeight + ' بكسل · ' + Math.round(file.size / 1024) + ' ك.ب'; });
        img.addEventListener('error', function () { info.textContent = 'المتصفح مقدرش يعرض الملف ده.'; });
        preview.appendChild(el('figure', {}, img, el('figcaption', { text: 'الجديد' })));
        up.disabled = false;
      });
      up.addEventListener('click', function () {
        if (!file) return;
        up.disabled = true;
        setStatus('جاري رفع الشعار…', 'busy');
        var reader = new FileReader();
        reader.onload = function () {
          var data = String(reader.result || '');
          var comma = data.indexOf(',');
          api('/api/upload-logo', 'POST', { kind: s.kind, filename: file.name, dataBase64: data.slice(comma + 1) }).then(function (r) {
            setStatus('اترفع للمعاينة: ' + r.sizes.length + ' مقاس من أصل ' + r.original.width + '×' + r.original.height + '. اضغط «نشر» لما المعاينة تعجبك.', 'ok');
          }).catch(function (e) { setStatus(e.message, 'err'); up.disabled = false; });
        };
        reader.onerror = function () { setStatus('تعذّر قراءة الملف', 'err'); up.disabled = false; };
        reader.readAsDataURL(file);
      });
      f.appendChild(el('div', { class: 'logo-slot' + (s.dark ? ' dark-bg' : '') }, el('b', { text: s.title }), imgs,
        el('label', { class: 'f' }, el('span', { text: 'ملف جديد' }), pick), preview, info, up));
    });
    return f;
  }

  function loadLog(box) {
    box.textContent = '';
    box.appendChild(el('p', { class: 'hint', text: 'جاري التحميل…' }));
    api('/api/log').then(function (r) {
      box.textContent = '';
      if (!r.entries.length) { box.appendChild(el('p', { class: 'hint', text: 'لسه مفيش تغييرات مسجّلة.' })); return; }
      var ul = el('ul', { class: 'log' });
      r.entries.forEach(function (e) {
        var when = '';
        try { when = new Date(e.at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); } catch (x) { when = String(e.at); }
        ul.appendChild(el('li', {}, el('time', { text: when }), el('b', { text: ACTION_NAMES[e.action] || String(e.action) }), el('span', { text: String(e.summary || '') })));
      });
      box.appendChild(ul);
    }).catch(function (e) { box.textContent = ''; box.appendChild(el('p', { class: 'msg err', text: e.message })); });
  }

  // ---------- errors from the server ----------
  function showErrors(list) {
    var box = $('errors');
    box.textContent = '';
    document.querySelectorAll('.invalid').forEach(function (n) { n.classList.remove('invalid'); });
    if (!list || !list.length) { box.hidden = true; return; }
    box.appendChild(el('b', { text: 'صحّح الحقول دي قبل الحفظ:' }));
    var ul = el('ul');
    var first = null;
    list.forEach(function (e) {
      ul.appendChild(el('li', { text: e.path + ': ' + e.message }));
      var n = document.querySelector('[data-path="' + String(e.path).replace(/["\\]/g, '') + '"]');
      if (n) {
        n.classList.add('invalid');
        var d = n.closest('details'); if (d) d.open = true;
        if (!first) first = n;
      }
    });
    box.appendChild(ul);
    box.hidden = false;
    (first || box).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- actions ----------
  function loadContent() {
    show('loadingView');
    return api('/api/content').then(function (r) {
      draft = r.content;
      savedJson = JSON.stringify(draft);
      $('sourceNote').textContent = r.source === 'site/preview'
        ? 'بتعدّل نسخة المعاينة (فيها تعديلات لسه ما اتنشرتش أو اتنشرت).'
        : 'بتعدّل نسخة الموقع المنشور (مفيش معاينة لسه).';
      buildEditor();
      markDirty();
      showErrors(null);
      show('editorView');
    });
  }

  function save() {
    setStatus('جاري الحفظ…', 'busy');
    $('saveBtn').disabled = true;
    return api('/api/save', 'POST', { content: draft }).then(function (r) {
      savedJson = JSON.stringify(draft);
      markDirty();
      showErrors(null);
      setStatus(r.unchanged ? 'مفيش تغيير عن آخر حفظ.' : 'اتحفظ في المعاينة. المعاينة بتتبني خلال دقيقة أو اتنين — بعدها افتحها.', 'ok');
      return true;
    }).catch(function (e) {
      if (e.data && e.data.errors) showErrors(e.data.errors);
      setStatus(e.message, 'err');
      return false;
    }).then(function (ok) { $('saveBtn').disabled = false; return ok; });
  }

  function publish() {
    var dirty = JSON.stringify(draft) !== savedJson;
    var text = dirty
      ? 'فيه تعديلات لسه ما اتحفظتش في المعاينة — دي مش هتتنشر. اللي هيتنشر هو آخر حاجة اتحفظت في المعاينة. تكمّل؟'
      : 'اللي في المعاينة هيطلع على الموقع الحقيقي للزباين خلال دقيقة أو اتنين. تكمّل؟';
    confirmBox('نشر على الموقع', text, 'نعم، انشر').then(function (yes) {
      if (!yes) return;
      setStatus('جاري النشر…', 'busy');
      api('/api/publish', 'POST', {}).then(function () {
        setStatus('اتنشر. الموقع بيتحدّث خلال دقيقة أو اتنين.', 'ok');
      }).catch(function (e) { setStatus(e.message, 'err'); });
    });
  }

  function rollback() {
    confirmBox('تراجع عن آخر نشر', 'المحتوى والشعار على الموقع هيرجعوا زي ما كانوا قبل آخر نشر، والمعاينة كمان. أي تعديل محفوظ في المعاينة ولسه ما اتنشرش هيضيع. تكمّل؟', 'نعم، تراجع').then(function (yes) {
      if (!yes) return;
      setStatus('جاري التراجع…', 'busy');
      api('/api/rollback', 'POST', {}).then(function (r) {
        return loadContent().then(function () {
          setStatus(r.restored.length ? 'تم التراجع (' + r.restored.length + ' ملف). الموقع بيتحدّث خلال دقيقة أو اتنين.' : 'تم — الملفات كانت أصلًا زي النسخة السابقة.', 'ok');
        });
      }).catch(function (e) { setStatus(e.message, 'err'); });
    });
  }

  function openPreview() {
    if (!previewUrl) { setStatus('رابط المعاينة مش متضبط. ضيف PREVIEW_URL في إعدادات Vercel (شوف دليل الإعداد).', 'err'); return; }
    window.open(previewUrl, '_blank', 'noopener');
  }

  function start() {
    $('themeBtn').addEventListener('click', toggleTheme);
    $('saveBtn').addEventListener('click', save);
    $('publishBtn').addEventListener('click', publish);
    $('rollbackBtn').addEventListener('click', rollback);
    $('previewBtn').addEventListener('click', openPreview);
    $('logoutBtn').addEventListener('click', function () {
      api('/api/logout', 'POST', {}).then(function () { showLogin('خرجت من اللوحة.'); }, function () { showLogin(''); });
    });
    $('totp').addEventListener('input', function () { var t = $('totp'); t.value = toLatinDigits(t.value).replace(/\D/g, '').slice(0, 6); });
    $('loginForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = $('loginBtn');
      btn.disabled = true;
      $('loginMsg').hidden = true;
      api('/api/login', 'POST', { password: $('password').value, totp: toLatinDigits($('totp').value) }).then(function () {
        $('password').value = ''; $('totp').value = '';
        return api('/api/session').then(function (s) { previewUrl = s.previewUrl || ''; return loadContent(); });
      }).catch(function (e) {
        show('loginView');
        var m = $('loginMsg'); m.textContent = e.message; m.hidden = false;
        $('totp').value = '';
      }).then(function () { btn.disabled = false; });
    });
    window.addEventListener('beforeunload', function (e) {
      if (draft && JSON.stringify(draft) !== savedJson) { e.preventDefault(); e.returnValue = ''; }
    });
    api('/api/session').then(function (s) { previewUrl = s.previewUrl || ''; return loadContent(); })
      .catch(function (e) { if (e.status === 401) showLogin(''); else showLogin(e.message); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
