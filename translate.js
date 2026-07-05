/* ATTARIX — ترجمة تلقائية حسب لغة المتصفح (Google Translate Widget) */
(function () {
  'use strict';

  var STORAGE_KEY = 'attarix_lang';
  var PAGE_LANG = 'ar';
  var RTL_LANGS = ['ar', 'iw', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'ckb', 'dv'];

  /* يحوّل لغة المتصفح إلى كود تفهمه ترجمة جوجل */
  function normalizeLang(raw) {
    if (!raw) return PAGE_LANG;
    raw = String(raw).toLowerCase();
    if (raw.indexOf('zh') === 0) {
      return /tw|hk|mo|hant/.test(raw) ? 'zh-TW' : 'zh-CN';
    }
    var base = raw.split('-')[0];
    if (base === 'he') base = 'iw';
    if (base === 'jv') base = 'jw';
    if (base === 'nb' || base === 'nn') base = 'no';
    return base;
  }

  function getSavedLang() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function saveLang(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  }

  function setCookie(target) {
    var value = '/' + PAGE_LANG + '/' + target;
    document.cookie = 'googtrans=' + value + ';path=/';
    if (location.hostname && location.hostname.indexOf('.') > -1) {
      document.cookie = 'googtrans=' + value + ';path=/;domain=.' + location.hostname;
    }
  }

  function clearCookie() {
    var past = ';expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    document.cookie = 'googtrans=' + past;
    if (location.hostname) {
      document.cookie = 'googtrans=' + past + ';domain=' + location.hostname;
      document.cookie = 'googtrans=' + past + ';domain=.' + location.hostname;
    }
  }

  var browserLang = normalizeLang(
    navigator.language || (navigator.languages && navigator.languages[0])
  );
  var savedLang = getSavedLang();
  var targetLang = savedLang || browserLang;
  var shouldTranslate = !!targetLang && targetLang !== PAGE_LANG;

  if (shouldTranslate) {
    setCookie(targetLang);
  } else {
    clearCookie();
  }

  function injectCss() {
    var css = [
      /* إخفاء شريط جوجل العلوي (الأصناف القديمة والجديدة) وأي عناصر عائمة */
      '.goog-te-banner-frame, iframe.skiptranslate { display: none !important; visibility: hidden !important; }',
      '.VIpgJd-ZVi9od-ORHb-OEVmcd { display: none !important; }',
      'body { top: 0 !important; position: static !important; }',
      '#goog-gt-tt, .goog-te-balloon-frame, .VIpgJd-yAWNEb-L7lbkb { display: none !important; }',
      '.goog-text-highlight, .VIpgJd-yAWNEb-VIpgJd-fmcmS-sn54Q { background: none !important; box-shadow: none !important; }',
      '.goog-te-spinner-pos { display: none !important; }',
      '#google_translate_element { display: none !important; }',
      /* الزر العائم للتبديل بين العربية والترجمة */
      '#attarix-lang-btn {' +
        'position: fixed; bottom: 16px; inset-inline-end: 16px; z-index: 99999;' +
        'display: inline-flex; align-items: center; gap: 6px;' +
        'padding: 10px 16px; border: 1px solid rgba(255,255,255,.25); border-radius: 999px;' +
        'background: rgba(15, 20, 30, .85); color: #fff; cursor: pointer;' +
        'font: 700 14px/1 Cairo, Tahoma, sans-serif;' +
        'box-shadow: 0 4px 16px rgba(0,0,0,.35); backdrop-filter: blur(6px);' +
      '}',
      '#attarix-lang-btn:hover { background: rgba(30, 40, 60, .95); }'
    ].join('\n');
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function applyDirection() {
    var base = targetLang.split('-')[0];
    if (RTL_LANGS.indexOf(base) === -1) {
      document.documentElement.setAttribute('dir', 'ltr');
      document.documentElement.setAttribute('lang', targetLang);
    }
  }

  function loadWidget() {
    window.googleTranslateElementInit = function () {
      new window.google.translate.TranslateElement({
        pageLanguage: PAGE_LANG,
        autoDisplay: false
      }, 'google_translate_element');
    };
    var s = document.createElement('script');
    s.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    document.head.appendChild(s);
  }

  function buildButton() {
    var btn = document.createElement('button');
    btn.id = 'attarix-lang-btn';
    btn.type = 'button';
    btn.className = 'notranslate';
    btn.setAttribute('translate', 'no');
    if (shouldTranslate) {
      btn.textContent = 'العربية';
      btn.setAttribute('aria-label', 'عرض الموقع بالعربية');
      btn.onclick = function () {
        saveLang(PAGE_LANG);
        clearCookie();
        location.reload();
      };
    } else {
      btn.textContent = '🌐 Translate';
      btn.setAttribute('aria-label', 'Translate this page');
      btn.onclick = function () {
        saveLang(browserLang);
        setCookie(browserLang);
        location.reload();
      };
    }
    document.body.appendChild(btn);
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  onReady(function () {
    if (!document.getElementById('google_translate_element')) {
      var holder = document.createElement('div');
      holder.id = 'google_translate_element';
      document.body.appendChild(holder);
    }
    injectCss();
    if (shouldTranslate) {
      applyDirection();
      loadWidget();
    }
    /* الزر يظهر فقط لمن لغة متصفحه غير العربية */
    if (browserLang !== PAGE_LANG) buildButton();
  });
})();
