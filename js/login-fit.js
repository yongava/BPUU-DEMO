/*
 * login-fit.js — ย่อขนาดตัวอักษรบนปุ่ม login ให้ข้อความอยู่ "2 บรรทัดเสมอ"
 *
 * ปัญหา: ปุ่มมีข้อความ 2 บรรทัด (ชื่อวิธี login / วงเล็บอธิบาย) พอจอแคบลง
 * บรรทัดแรกที่ยาวกว่าจะถูกตัดคำเป็น 2 บรรทัด ปุ่มเลยกลายเป็น 3 บรรทัดและ
 * โลโก้ดูไม่สมดุล
 *
 * วิธีแก้: ล็อกแต่ละบรรทัดเป็น nowrap (ดู .login-provider-text > span ใน
 * styles.css) แล้วค่อย ๆ ลด font-size ของกล่องข้อความจนกว่าทุกบรรทัดจะไม่ล้น
 * ตั้งขนาดที่ "กล่อง" ไม่ใช่ทีละบรรทัด เพื่อให้สองบรรทัดมีขนาดเท่ากันเสมอ
 * (ถ้าย่อแยกกัน บรรทัดสั้นจะใหญ่กว่าบรรทัดยาว ดูแปลก)
 */
(function () {
  'use strict';

  var MIN_PX = 11; // ต่ำกว่านี้เริ่มอ่านยาก ยอมให้ตัดคำดีกว่าย่อจนเล็กเกิน
  var STEP = 0.5;

  function overflows(lines) {
    for (var i = 0; i < lines.length; i++) {
      // nowrap + display:block => กล่องกว้างเท่า parent, เนื้อหาที่ยาวเกินจะล้น
      if (lines[i].scrollWidth > lines[i].clientWidth) return true;
    }
    return false;
  }

  function fit(container) {
    var lines = container.querySelectorAll('span');
    if (!lines.length) return;

    container.style.fontSize = ''; // รีเซ็ตกลับไปค่าจาก CSS ก่อนวัดใหม่ทุกครั้ง
    if (!container.clientWidth) return; // ยังไม่ได้ layout (ซ่อนอยู่) — ข้ามไปก่อน

    var size = parseFloat(window.getComputedStyle(container).fontSize);
    if (!size) return;

    var guard = 0;
    while (size > MIN_PX && overflows(lines) && guard++ < 200) {
      size -= STEP;
      container.style.fontSize = size + 'px';
    }
  }

  var fitting = false; // กัน ResizeObserver วนซ้ำจากการที่เราเปลี่ยน font เอง

  function fitAll() {
    if (fitting) return;
    fitting = true;
    try {
      var boxes = document.querySelectorAll('.login-provider-text');
      for (var i = 0; i < boxes.length; i++) fit(boxes[i]);
    } finally {
      // ต้องอยู่ใน finally — ถ้า fit() พังกลางทางแล้วธงค้างเป็น true
      // การ fit ครั้งต่อ ๆ ไปจะถูกข้ามทั้งหมดอย่างเงียบ ๆ
      fitting = false;
    }
  }

  function init() {
    var boxes = document.querySelectorAll('.login-provider-text');
    if (!boxes.length) return;
    fitAll();

    // ฟอนต์ไทยโหลดทีหลัง (Sarabun ผ่าน CSS) ความกว้างจะเปลี่ยนหลังโหลดเสร็จ
    // จึงต้องวัดซ้ำ ไม่งั้นจะย่อจากความกว้างของ fallback font ซึ่งไม่ตรงจริง
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(fitAll).catch(function () {});
    }

    // ResizeObserver เฝ้า "ความกว้างของกล่องข้อความ" โดยตรง ครอบคลุมกรณีที่
    // กล่องเปลี่ยนขนาดโดยหน้าต่างไม่เปลี่ยน (zoom, media query สลับ, layout
    // ข้างเคียงขยับ) ปลอดภัยจากลูป เพราะกล่องเป็น flex:1 1 0 ความกว้างจึงไม่
    // ขึ้นกับ font-size ที่เราแก้
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        fitAll();
      });
      for (var j = 0; j < boxes.length; j++) ro.observe(boxes[j]);
      window.__loginFitObserver = ro; // กัน GC เก็บ observer ที่ไม่มีใครอ้างถึง
    }

    // ...แต่ ResizeObserver กับ requestAnimationFrame ผูกกับรอบการ render
    // ถ้าหน้าไม่ได้ถูก paint (แท็บพื้นหลัง, บาง headless browser) callback จะ
    // ไม่ถูกเรียกเลย จึงต้องมี window resize + setTimeout ล้วน ๆ เป็นตาข่ายรอง
    // และ fit ซ้ำตอนหน้ากลับมามองเห็น เพื่อแก้ layout ที่ค้างจากตอนอยู่เบื้องหลัง
    var t;
    function debounced() {
      clearTimeout(t);
      t = setTimeout(fitAll, 120);
    }
    window.addEventListener('resize', debounced);
    window.addEventListener('orientationchange', debounced);
    window.addEventListener('pageshow', debounced);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) debounced();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
