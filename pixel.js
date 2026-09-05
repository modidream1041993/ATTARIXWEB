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

  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');

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
