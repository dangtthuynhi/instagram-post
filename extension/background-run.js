/**
 * Cho giao dien Instagram chay tiep khi tab bi an, trong luc bot dang lam.
 *
 * Tab an thi Chrome ngung goi requestAnimationFrame: phan giao dien nao cua
 * Instagram doi khung hinh moi chay tiep (hieu ung chuyen buoc, ...) se dung im.
 * Luc tab an VA bot dang lam (content.js dat <html data-iap-active="1">), thay
 * requestAnimationFrame bang hen gio 16 ms. Tab hien, hoac bot khong lam gi: giu
 * nguyen nhu cu, khong dung toi trang.
 *
 * Phai chay trong MAIN world (xem manifest.json): content.js nam o the gioi
 * cach ly, window.requestAnimationFrame o do khong phai cai trang dang dung.
 */
(function keepFramesWhenHidden() {
  'use strict';
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  const pending = new Map();
  let seq = 0;
  const active = () => document.hidden && document.documentElement?.dataset.iapActive === '1';

  window.requestAnimationFrame = function (cb) {
    if (!active()) return raf(cb);
    const id = 2e9 + (++seq);              // so lon, khong trung so cua requestAnimationFrame that
    pending.set(id, setTimeout(() => {
      pending.delete(id);
      cb(performance.now());
    }, 16));
    return id;
  };

  window.cancelAnimationFrame = function (id) {
    if (pending.has(id)) {
      clearTimeout(pending.get(id));
      pending.delete(id);
      return;
    }
    caf(id);
  };
})();
