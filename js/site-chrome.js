/*
 * site-chrome.js — footer ลิขสิทธิ์ + เลขเวอร์ชัน + กล่องยินยอมคุกกี้
 *
 * ใช้ร่วมกันสองหน้า: หน้า login (server-rendered ใน server.js) และ index.html
 * ทั้งคู่แค่ใส่ <script src="/js/site-chrome.js" defer></script> — markup ทั้งหมด
 * ถูกสร้างจากไฟล์นี้ จึงไม่ต้องแก้ HTML สองที่เวลาปรับข้อความ
 *
 * เขียนเป็น vanilla JS ล้วน ไม่พึ่ง Bootstrap JS เพราะหน้า login โหลดเฉพาะ
 * Bootstrap CSS (ไม่มี bundle.js) — ถ้าใช้ component modal ของ Bootstrap
 * กล่องคุกกี้จะเปิดไม่ได้บนหน้านั้น
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'bpuu.cookieConsent.v1';
  var COPYRIGHT =
    'Copyright © 2026 King Mongkut’s University of Technology Thonburi, All rights reserved.';

  // โลโก้ KMUTT ใช้ currentColor จึงเปลี่ยนสีตาม parent ได้ (ส้มบนการ์ดขาว,
  // ขาวบนปุ่มส้ม) — inline ไว้เลยเพื่อไม่ให้กล่องกระพริบรอโหลดไฟล์
  var KMUTT_MARK =
    '<svg viewBox="0 0 44 51" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="KMUTT">' +
    '<g fill="currentColor">' +
    '<polygon points="2.7,27.85 4.92,25.99 10.88,33.66 11.04,33.82 14.38,33.82 13.75,33.13 6.86,24.51 13.55,18.55 ' +
    '14.42,17.82 11.07,17.82 10.92,17.95 2.7,25.21 2.7,17.82 0,17.82 0,33.82 2.7,33.82 "/> <path ' +
    'd="M11.77,43.68c0,3.34-1.28,4.92-4.57,4.92c-3.29,0-4.57-1.58-4.57-4.92v-8.84H0v9.65C0,48.5,2.56,51,7.2,51 ' +
    'c4.64,0,7.2-2.5,7.2-6.52v-7.59h4.8V51h2.68V36.89h4.61V51h2.67V36.89h3.82v-2.06H11.77V43.68z"/> <polygon ' +
    'points="29.48,18.1 24.27,30.46 18.96,18.1 18.84,17.82 15.44,17.82 15.44,33.82 18.11,33.82 18.11,22.46 ' +
    '22.96,33.54 23.09,33.82 25.36,33.82 25.48,33.54 30.31,22.47 30.31,33.82 32.98,33.82 32.98,17.82 29.6,17.82 "/> ' +
    '<path d="M30.79,1.23c0,0.61-0.49,1.11-1.1,1.11c-0.61,0-1.1-0.49-1.1-1.11c0-0.61,0.5-1.1,1.1-1.1 ' +
    'C30.3,0.12,30.79,0.61,30.79,1.23"/> <path ' +
    'd="M30.79,4.54c0,0.61-0.49,1.11-1.1,1.11c-0.61,0-1.1-0.5-1.1-1.11c0-0.61,0.5-1.1,1.1-1.1 ' +
    'C30.3,3.44,30.79,3.94,30.79,4.54"/> <path ' +
    'd="M30.79,11.18c0,0.61-0.49,1.11-1.1,1.11c-0.61,0-1.1-0.5-1.1-1.11c0-0.62,0.5-1.11,1.1-1.11 ' +
    'C30.3,10.07,30.79,10.57,30.79,11.18"/> <path ' +
    'd="M30.79,14.5c0,0.61-0.49,1.11-1.1,1.11c-0.61,0-1.1-0.5-1.1-1.11c0-0.61,0.5-1.1,1.1-1.1 ' +
    'C30.3,13.39,30.79,13.89,30.79,14.5"/> <path ' +
    'd="M30.8,7.86c0,0.61-0.49,1.11-1.1,1.11c-0.61,0-1.11-0.5-1.11-1.11c0-0.61,0.5-1.11,1.11-1.11 ' +
    'C30.31,6.76,30.8,7.25,30.8,7.86"/> <path ' +
    'd="M27.5,7.86c0,0.61-0.5,1.11-1.1,1.11c-0.61,0-1.1-0.5-1.1-1.11c0-0.61,0.49-1.11,1.1-1.11 ' +
    'C27.01,6.76,27.5,7.25,27.5,7.86"/> <path ' +
    'd="M24.21,7.86c0,0.61-0.5,1.11-1.11,1.11c-0.61,0-1.11-0.5-1.11-1.11c0-0.61,0.5-1.11,1.11-1.11 ' +
    'C23.7,6.76,24.21,7.25,24.21,7.86"/> <path ' +
    'd="M37.4,7.86c0,0.61-0.5,1.11-1.11,1.11c-0.61,0-1.11-0.5-1.11-1.11c0-0.61,0.5-1.11,1.11-1.11 ' +
    'C36.91,6.76,37.4,7.25,37.4,7.86"/> <path ' +
    'd="M37.4,11.18c0,0.61-0.5,1.11-1.11,1.11c-0.61,0-1.11-0.5-1.11-1.11c0-0.62,0.5-1.11,1.11-1.11 ' +
    'C36.91,10.07,37.4,10.57,37.4,11.18"/> <path ' +
    'd="M34.1,7.86c0,0.61-0.5,1.11-1.11,1.11c-0.62,0-1.11-0.5-1.11-1.11c0-0.61,0.49-1.11,1.11-1.11 ' +
    'C33.61,6.76,34.1,7.25,34.1,7.86"/> <path ' +
    'd="M40.7,14.5c0,0.61-0.5,1.11-1.1,1.11c-0.61,0-1.11-0.5-1.11-1.11c0-0.61,0.5-1.1,1.11-1.1 ' +
    'C40.2,13.39,40.7,13.89,40.7,14.5"/> <path ' +
    'd="M37.4,14.5c0,0.61-0.5,1.11-1.11,1.11c-0.61,0-1.11-0.5-1.11-1.11c0-0.61,0.5-1.1,1.11-1.1 ' +
    'C36.91,13.39,37.4,13.89,37.4,14.5"/> <path ' +
    'd="M34.1,14.5c0,0.61-0.5,1.11-1.11,1.11c-0.62,0-1.11-0.5-1.11-1.11c0-0.61,0.49-1.1,1.11-1.1 ' +
    'C33.61,13.39,34.1,13.89,34.1,14.5"/> <path ' +
    'd="M44,14.5c0,0.61-0.5,1.11-1.1,1.11c-0.61,0-1.11-0.5-1.11-1.11c0-0.61,0.5-1.1,1.11-1.1 ' +
    'C43.5,13.39,44,13.89,44,14.5"/> <path ' +
    'd="M37.4,17.82c0,0.61-0.5,1.1-1.11,1.1c-0.61,0-1.11-0.49-1.11-1.1c0-0.61,0.5-1.1,1.11-1.1 ' +
    'C36.91,16.71,37.4,17.21,37.4,17.82"/> <path ' +
    'd="M37.4,21.14c0,0.61-0.5,1.1-1.11,1.1c-0.61,0-1.11-0.49-1.11-1.1c0-0.61,0.5-1.1,1.11-1.1 ' +
    'C36.91,20.03,37.4,20.52,37.4,21.14"/> ' +
    '</g></svg>';

  // ---------------------------------------------------------------------
  // consent state
  // ---------------------------------------------------------------------

  function readConsent() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      // โหมด private ของบางเบราว์เซอร์ห้ามอ่าน localStorage — ถือว่ายังไม่เคยเลือก
      return null;
    }
  }

  function writeConsent(prefs) {
    var payload = {
      necessary: true, // จำเป็นเสมอ (session ตอน login) — ปิดไม่ได้
      analytics: !!prefs.analytics,
      functional: !!prefs.functional,
      ts: new Date().toISOString()
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      /* เขียนไม่ได้ก็ไม่เป็นไร — จะถามใหม่รอบหน้า */
    }
    window.bpuuCookieConsent = payload;
    document.dispatchEvent(new CustomEvent('bpuu:cookie-consent', { detail: payload }));
    return payload;
  }

  // ---------------------------------------------------------------------
  // markup
  // ---------------------------------------------------------------------

  function buildFooter() {
    var footer = document.createElement('div');
    footer.className = 'site-footer';
    footer.innerHTML =
      '<button type="button" class="site-footer__cookie" id="siteCookieBtn">' +
      '<i class="bi bi-shield-check"></i>การตั้งค่าคุกกี้</button>' +
      '<div class="site-footer__copy">' +
      COPYRIGHT +
      ' <span class="site-footer__version" id="siteVersion"></span>' +
      '</div>';
    return footer;
  }

  // ลิงก์มาจาก /api/version (ค่าจาก env ฝั่ง server) จึงเติมทีหลังเมื่อ fetch เสร็จ
  // ปล่อยว่าง = ไม่แสดงลิงก์นั้น ดีกว่าโชว์ลิงก์ที่กดแล้วไม่ไปไหน
  function renderLinks(container, links) {
    var html = '';
    if (links.privacyUrl) {
      html +=
        '<a href="' + encodeURI(links.privacyUrl) + '" target="_blank" rel="noopener">Privacy Policy</a>';
    }
    if (links.termsUrl) {
      html +=
        '<a href="' + encodeURI(links.termsUrl) + '" target="_blank" rel="noopener">Terms and Conditions</a>';
    }
    container.innerHTML = html;
  }

  function buildConsent() {
    var box = document.createElement('div');
    box.className = 'cookie-consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-label', 'การตั้งค่าคุกกี้');
    box.hidden = true;

    box.innerHTML =
      '<div class="cookie-consent__head">' +
      KMUTT_MARK +
      '<span>Cookie Consent</span>' +
      '</div>' +
      '<div class="cookie-consent__body">' +
      '<div>เว็บไซต์นี้ใช้คุกกี้เพื่อให้ระบบทำงานได้อย่างถูกต้องและปรับปรุงประสบการณ์ใช้งาน ' +
      'การใช้งานเว็บไซต์นี้ถือว่าท่านยอมรับการใช้คุกกี้ตามนโยบายคุกกี้ของมหาวิทยาลัย</div>' +
      '<div class="cookie-consent__prefs" id="cookiePrefs" hidden>' +
      '<div class="cookie-consent__row">' +
      '<input type="checkbox" id="cookieNecessary" checked disabled>' +
      '<label for="cookieNecessary"><strong>คุกกี้ที่จำเป็น</strong> (ปิดไม่ได้)' +
      '<span class="text-muted">ใช้จดจำสถานะการเข้าสู่ระบบ หากปิดจะใช้งานระบบไม่ได้</span></label>' +
      '</div>' +
      '<div class="cookie-consent__row">' +
      '<input type="checkbox" id="cookieFunctional">' +
      '<label for="cookieFunctional"><strong>คุกกี้เพื่อการใช้งาน</strong>' +
      '<span class="text-muted">จดจำการตั้งค่าที่ท่านเลือกไว้ เช่น ตัวกรองรายการ</span></label>' +
      '</div>' +
      '<div class="cookie-consent__row">' +
      '<input type="checkbox" id="cookieAnalytics">' +
      '<label for="cookieAnalytics"><strong>คุกกี้เพื่อการวิเคราะห์</strong>' +
      '<span class="text-muted">สถิติการใช้งานแบบไม่ระบุตัวตน (ปัจจุบันระบบยังไม่ได้ใช้งานส่วนนี้)</span></label>' +
      '</div>' +
      '</div>' +
      '<div class="cookie-consent__actions">' +
      '<button type="button" class="btn btn-cookie-dark" id="cookieAcceptAll">Accept all</button>' +
      '<button type="button" class="btn btn-cookie-dark" id="cookieAcceptNecessary">Accept only necessary</button>' +
      '</div>' +
      '<button type="button" class="btn btn-cookie-light" id="cookieSave">Save settings</button>' +
      '</div>' +
      '<div class="cookie-consent__links" id="cookieLinks"></div>';
    return box;
  }

  // ---------------------------------------------------------------------
  // wiring
  // ---------------------------------------------------------------------

  function init() {
    document.body.classList.add('has-site-footer');
    var footer = buildFooter();
    var consent = buildConsent();
    document.body.appendChild(footer);
    document.body.appendChild(consent);

    var prefsPanel = consent.querySelector('#cookiePrefs');
    var cbFunctional = consent.querySelector('#cookieFunctional');
    var cbAnalytics = consent.querySelector('#cookieAnalytics');

    function show() {
      var stored = readConsent();
      if (stored) {
        cbFunctional.checked = !!stored.functional;
        cbAnalytics.checked = !!stored.analytics;
      }
      consent.hidden = false;
    }

    function hide() {
      consent.hidden = true;
      prefsPanel.hidden = true;
    }

    consent.querySelector('#cookieAcceptAll').addEventListener('click', function () {
      writeConsent({ analytics: true, functional: true });
      hide();
    });
    consent.querySelector('#cookieAcceptNecessary').addEventListener('click', function () {
      writeConsent({ analytics: false, functional: false });
      hide();
    });
    consent.querySelector('#cookieSave').addEventListener('click', function () {
      // คลิกแรก = กางตัวเลือก, คลิกถัดไป = บันทึกตามที่ติ๊กไว้
      if (prefsPanel.hidden) {
        prefsPanel.hidden = false;
        this.textContent = 'Save settings';
        return;
      }
      writeConsent({ analytics: cbAnalytics.checked, functional: cbFunctional.checked });
      hide();
    });
    footer.querySelector('#siteCookieBtn').addEventListener('click', show);

    window.openCookieConsent = show;
    window.bpuuCookieConsent = readConsent();

    // ค่าเริ่มต้น = ซ่อนไว้ ไม่เด้งเองตอนเข้าเว็บครั้งแรก (ตามที่ผู้ใช้กำหนด)
    // ผู้ใช้เปิดเองได้จากลิงก์ "การตั้งค่าคุกกี้" ที่ footer
    // หมายเหตุ: ทำแบบนี้ได้เพราะระบบใช้เฉพาะคุกกี้ที่จำเป็น (session ตอน login)
    // ถ้าวันหนึ่งเพิ่ม analytics/tracking จริง ต้องกลับมาเด้งถามก่อนตั้งคุกกี้พวกนั้น

    // เลขเวอร์ชัน + ลิงก์นโยบายมาจาก /api/version (public เหมือน /diagnostics)
    // เพื่อให้หน้า login และหน้าแอปแสดงค่าเดียวกันโดยไม่ต้อง hardcode ใน HTML
    fetch('/api/version', { credentials: 'same-origin' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!d) return;
        if (d.version) footer.querySelector('#siteVersion').textContent = d.version;
        renderLinks(consent.querySelector('#cookieLinks'), d);
      })
      .catch(function () {
        /* ไม่ขึ้นเวอร์ชัน/ลิงก์ ดีกว่าขึ้นค่าผิดหรือลิงก์ตาย */
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
