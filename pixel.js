/* Meta Pixel — ATTARIX
 *
 * الـ Pixel ID مكتوب هنا مرة واحدة بس، والصفحات كلها بتقرا منه.
 * الموقع ده HTML ساكن من غير build step، فمفيش متغيّر بيئة (NEXT_PUBLIC_… أو غيره)
 * ينفع يتحقن وقت البناء — الملف ده هو "المكان الواحد" للرقم. أي تغيير يتعمل هنا وبس.
 */
(function () {
  var PIXEL_ID = '1393800312080250';

  /* الكود الرسمي من ميتا — زي ما هو، من غير أي تعديل */
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');

  /* الموافقة على ملفات تعريف الارتباط (مسودة 2026-10-14 — بانتظار المالك والمحامي).
   * لا يُرسل البكسل شيئًا قبل الموافقة: يُبدأ بـ consent revoke، ويُمنح فقط بعد «موافق».
   * الاختيار يُحفظ في المتصفح نفسه (localStorage)؛ إن تعذّر الحفظ يُسأل الزائر في كل صفحة. */
  var KEY = 'attarix-cookie-consent';
  function readChoice() { try { return window.localStorage.getItem(KEY); } catch (e) { return null; } }
  function saveChoice(v) { try { window.localStorage.setItem(KEY, v); } catch (e) { /* private window: asked again next page */ } }

  var choice = readChoice();
  if (choice !== 'granted') fbq('consent', 'revoke');
  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');

  function banner() {
    if (readChoice() !== null) return;
    var box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'ملفات تعريف الارتباط');
    box.dir = 'rtl';
    box.style.cssText = 'position:fixed;inset-inline:12px;bottom:12px;z-index:9999;background:#111827;color:#fff;padding:14px 16px;border-radius:12px;font:14px/1.7 Cairo,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:720px;margin-inline:auto';
    box.innerHTML = '<p style="margin:0 0 10px">يستخدم الموقع أداة القياس من Meta (فيسبوك) لمعرفة عدد الزيارات وأثر الإعلانات. لا تُستخدم إلا بموافقتك. <a href="privacy.html" style="color:#93c5fd">سياسة الخصوصية</a></p>';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    function btn(label, value, primary) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'min-height:40px;padding:6px 16px;border-radius:8px;border:0;cursor:pointer;font:inherit;' + (primary ? 'background:#f59e0b;color:#111827;font-weight:700' : 'background:#374151;color:#fff');
      b.addEventListener('click', function () {
        saveChoice(value);
        if (value === 'granted') fbq('consent', 'grant');
        box.remove();
      });
      return b;
    }
    row.appendChild(btn('موافق', 'granted', true));
    row.appendChild(btn('رفض', 'denied', false));
    box.appendChild(row);
    document.body.appendChild(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner);
  else banner();

  /* helper للأحداث المخصّصة: trackEvent('Lead')
   *
   * الحارس مش رفاهية: لو AdBlock منع fbevents.js، الـ shim اللي فوق بيكون لسه
   * عامل window.fbq وبيبلع النداء في الـ queue — فالصفحة ما بتقعش. لكن لو المتصفح
   * منع السكربت ده نفسه، fbq مش هيبقى موجود أصلاً، والحارس هو اللي بيمنع
   * إن زرار التحميل يرمي استثناء ويوقف التحميل. الإعلان ما يعطّلش البيع.
   */
  function trackEvent(name, params) {
    if (typeof window.fbq !== 'function') return;
    window.fbq('track', name, params || {});
  }
  window.trackEvent = trackEvent;

  /* ربط تصريحي، على نفس نمط data-wa-msg في site.js:
   *   <a data-fb-event="Lead" …>
   * كده اسم الحدث بيقعد جنب الزرار في الـ HTML، من غير onclick جوّه الصفحة. */
  function wire() {
    var els = document.querySelectorAll('[data-fb-event]');
    Array.prototype.forEach.call(els, function (el) {
      el.addEventListener('click', function () {
        trackEvent(el.getAttribute('data-fb-event'));
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
