/**
 * Chan canh bao "Changes you made may not be saved" cua trinh duyet.
 *
 * Hop thoai do la giao dien NATIVE cua Chrome, nam ngoai DOM — khong script
 * nao bam duoc vao no. O soan thao con chu thi trang co the dang ky
 * beforeunload, va luc bot chuyen sang trang soan bai (intent/post) se bi
 * hop thoai do chan lai cho nguoi bam tay.
 *
 * Phai chay trong MAIN world (xem manifest.json): content.js nam o the gioi
 * cach ly, EventTarget.prototype o do khong phai cai trang dang dung.
 *
 * Doi lai: ban nhap that trong tab nay se khong con duoc hoi truoc khi mat.
 * Tab nay la tab cua bot nen danh chiu.
 */
(function blockUnloadPrompt() {
  'use strict';
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === 'beforeunload') return undefined;
    return add.call(this, type, ...rest);
  };
  try {
    Object.defineProperty(window, 'onbeforeunload', {
      configurable: true, get: () => null, set: () => {},
    });
  } catch { /* trinh duyet khong cho ghi de thi thoi */ }
})();
