/* ============================================================
   ATTARIX — السكريبت المشترك للصفحات الجديدة
   (مش محتاج تعدّل هنا حاجة — التعديل كله في products-data.js)
   ============================================================ */
(function () {
  'use strict';

  var C = window.SITE_CONTACT || { whatsapp: "201090246299", phone: "+201090246299", owner: "م. محمود العطار" };
  var WA_BASE = "https://wa.me/" + C.whatsapp + "?text=";

  function waUrl(msg) { return WA_BASE + encodeURIComponent(msg); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- سلوك مشترك: واتساب + قائمة الموبايل + الظهور عند التمرير ---------- */
  function initCommon() {
    var defaultMsg = "السلام عليكم " + C.owner + "، جاي من الموقع وعايز أستفسر 👋";
    ['navCta', 'floatWa'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.href = waUrl(defaultMsg); el.target = "_blank"; el.rel = "noopener"; }
    });

    var menuBtn = document.getElementById('menuBtn');
    var navLinks = document.querySelector('.nav-links');
    if (menuBtn && navLinks) {
      menuBtn.addEventListener('click', function () {
        var open = navLinks.classList.toggle('open');
        menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        menuBtn.textContent = open ? '✕' : '☰';
      });
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { threshold: .12 });
      document.querySelectorAll('.rv').forEach(function (el) { io.observe(el); });
    } else {
      document.querySelectorAll('.rv').forEach(function (el) { el.classList.add('in'); });
    }
  }

  /* ---------- كارت منتج ---------- */
  function productCard(p) {
    var href = p.page ? p.page : ('product.html?id=' + encodeURIComponent(p.id));
    var media = p.image
      ? '<img class="thumb" src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy">'
      : '<div class="ic">' + esc(p.icon || '📦') + '</div>';
    var orderMsg = "السلام عليكم " + C.owner + " 👋\nعايز أستفسر عن: «" + p.name + "»";
    return '<div class="card rv">'
      + (p.isNew ? '<span class="new">جديد</span>' : '')
      + media
      + '<h3>' + esc(p.name) + '</h3>'
      + '<p class="d">' + esc(p.short || '') + '</p>'
      + (p.price ? '<div class="price-tag">' + esc(p.price) + '</div>' : '')
      + '<div class="card-actions">'
      + '<a class="btn btn-blue btn-sm" href="' + esc(href) + '">التفاصيل ←</a>'
      + '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + waUrl(orderMsg) + '">💬 اطلب واتساب</a>'
      + '</div></div>';
  }

  /* ---------- صفحة المنتجات (products.html) ---------- */
  function renderProductsPage(root) {
    var sections = window.SECTIONS || [];
    var products = window.PRODUCTS || [];
    var html = '';
    sections.forEach(function (s) {
      var items = products.filter(function (p) { return p.section === s.id; });
      if (!items.length) return;
      html += '<div class="sec-block" id="' + esc(s.id) + '">'
        + '<div class="sec-title rv">'
        + '<span class="ic-big">' + esc(s.icon || '📦') + '</span>'
        + '<h2>' + esc(s.title) + '</h2>'
        + (s.note ? '<span class="note">' + esc(s.note) + '</span>' : '')
        + '</div>'
        + '<div class="grid">' + items.map(productCard).join('') + '</div>'
        + '</div>';
    });
    root.innerHTML = html || '<p style="text-align:center;color:var(--muted)">لسه مفيش منتجات — ضيفها من ملف products-data.js</p>';
  }

  /* ---------- صفحة تفاصيل المنتج (product.html?id=...) ---------- */
  function renderProductPage(root) {
    var id = new URLSearchParams(location.search).get('id');
    var p = (window.PRODUCTS || []).find(function (x) { return x.id === id; });

    if (!p) { location.replace('products.html'); return; }
    if (p.page) { location.replace(p.page); return; }

    document.title = p.name + ' — ATTARIX';
    var section = (window.SECTIONS || []).find(function (s) { return s.id === p.section; });
    var orderMsg = "السلام عليكم " + C.owner + " 👋\nعايز أطلب / أستفسر عن: «" + p.name + "»"
      + (p.price ? "\nالسعر المكتوب: " + p.price : "");

    var media = p.image
      ? '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '">'
      : '<span class="big-ic">' + esc(p.icon || '📦') + '</span>';

    root.innerHTML =
      '<div class="wrap">'
      + '<p class="crumbs rv in"><a href="products.html">المنتجات</a>'
      + (section ? ' › <a href="products.html#' + esc(section.id) + '">' + esc(section.title) + '</a>' : '')
      + ' › ' + esc(p.name) + '</p>'
      + '<div class="detail-grid">'
      +   '<div class="detail-body rv in">'
      +     '<h1>' + esc(p.name) + '</h1>'
      +     '<p class="d">' + esc(p.description || p.short || '') + '</p>'
      +     (p.features && p.features.length
              ? '<ul>' + p.features.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>'
              : '')
      +     (p.price ? '<div class="price">' + esc(p.price) + '</div>' : '')
      +     '<div class="card-actions">'
      +       '<a class="btn btn-gold" target="_blank" rel="noopener" href="' + waUrl(orderMsg) + '">💬 اطلب دلوقتي واتساب</a>'
      +       '<a class="btn btn-ghost" href="products.html">← كل المنتجات</a>'
      +     '</div>'
      +   '</div>'
      +   '<div class="detail-media rv in">' + media + '</div>'
      + '</div></div>';
  }

  /* ---------- صفحة عنّي: تعبئة البيانات من window.ABOUT (لو موجودة) ---------- */
  function renderAbout() {
    var A = window.ABOUT || {};
    function setText(id, v) {
      if (!v) return;
      var el = document.getElementById(id);
      if (el) el.textContent = v;
    }
    function setList(id, arr) {
      if (!arr || !arr.length) return;
      var el = document.getElementById(id);
      if (el) el.innerHTML = arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    }
    var av = document.getElementById('aboutAvatar');
    if (av && A.photo) av.innerHTML = '<img src="' + esc(A.photo) + '" alt="صورة شخصية">';
    setText('aboutName', A.name);
    setText('aboutRole', A.role);
    setText('aboutTagline', A.tagline);
    setText('aboutWhoami', A.whoami);
    setText('aboutStory', A.story);
    setList('aboutMilestones', A.milestones);
    setList('aboutDoing', A.doing);

    var socials = A.socials || {};
    [['socFacebook', socials.facebook], ['socLinkedin', socials.linkedin]].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el) return;
      if (pair[1]) { el.href = pair[1]; el.target = '_blank'; el.rel = 'noopener'; }
      else if (el.getAttribute('href') === '#') { el.style.display = 'none'; }
    });
    var em = document.getElementById('socEmail');
    if (em && socials.email) em.href = 'mailto:' + socials.email;
  }

  /* ---------- تشغيل ---------- */
  function boot() {
    /* الرسم الأول عشان مراقب الظهور يشوف الكروت الجديدة */
    var productsRoot = document.getElementById('productsRoot');
    var productRoot = document.getElementById('productRoot');
    if (productsRoot) renderProductsPage(productsRoot);
    if (productRoot) renderProductPage(productRoot);
    if (document.getElementById('aboutAvatar')) renderAbout();
    initCommon();
    /* أزرار الواتساب اللي عليها data-wa-msg (زي صفحة عنّي) */
    document.querySelectorAll('[data-wa-msg]').forEach(function (el) {
      el.href = waUrl(el.getAttribute('data-wa-msg'));
      el.target = "_blank"; el.rel = "noopener";
    });
    document.querySelectorAll('[data-tel]').forEach(function (el) { el.href = "tel:" + C.phone; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
