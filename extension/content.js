/*
 * Instagram Auto Poster — tu dong dang ANH lay ngau nhien tu mot thu muc len
 * Instagram theo lich, kem caption va tag nguoi tren anh. Chay ngay trong tab
 * instagram.com da dang nhap, khong goi API nao.
 *
 * Anh: nguoi dung bam "Chon thu muc" mot lan (Chrome khong cho extension tu
 * doc o dia). Anh duoc chep vao IndexedDB cua trang, nen tai lai trang hay tat
 * Chrome van con. Them anh vao thu muc thi bam "Chon thu muc" lai.
 *
 * Moi bai: boc ngau nhien 1..N anh (uu tien anh chua dang; dung het thi dang
 * lai anh cu), boc ngau nhien mot cau khen chua dung (kho co san cua bot X,
 * hoac cau cua minh), tag cac ten trong list len anh dau tien, roi bam Chia
 * se — dung cac buoc nguoi dung bam tren instagram.com:
 *   Tao -> Bai viet -> dua anh vao o chon file -> Tiep -> Tiep
 *   -> go caption, bam vao anh de tag -> Chia se.
 *
 * Comment khen: dan list link bai, moi bai comment N lan, moi lan mot cau khen
 * ngau nhien chua dung. Bot mo trang bai (trang nap lai, nen ghi cmtPending
 * truoc khi chuyen va lam not sau khi nap xong), go vao o binh luan, bam Dang.
 * Comment va bai anh co nhip, gioi han ngay rieng; den gio cung luc thi comment truoc.
 *
 * Instagram khong co data-testid on dinh: nut nhan theo aria-label cua icon va
 * chu tren nut, ca tieng Anh / Viet / Thai (xem RE). Instagram doi giao dien thi
 * bam "Kiem tra trang" tren bang dieu khien de xem bot con thay nut nao.
 */

(function () {
  'use strict';

  const KEY = 'ig_auto_poster_state';
  const VERSION = '1.1.0';
  const AUTHOR = 'dangtthuynhi';
  const REPO = 'https://github.com/dangtthuynhi/instagram-post';
  const MAX_CAPTION = 2200;   // Instagram: toi da 2.200 ky tu moi caption
  const MAX_HASHTAGS = 30;    // ... va 30 hashtag
  const MAX_TAGS = 20;        // ... va 20 nguoi duoc tag tren mot anh
  const MAX_IMAGES = 20;      // ... va 20 anh moi bai (bai nhieu anh)

  // ---------------------------------------------------------------- trang thai

  const DEFAULTS = {
    running: false,
    used: {},           // { khoa anh: thoi diem dang } — xem imageKey
    usedCaptions: {},   // { khoa cau khen: thoi diem dang } — xem captionPool
    perDay: {},         // { '2026-11-14': 3 }
    folder: null,       // { name, keys: [khoa anh], at } — anh nam trong IndexedDB
    lastCaption: '',    // khoa cau khen vua dang
    inflight: null,     // bai vua bam Chia se, chua biet ket qua: { keys, cap, at }
    nextAt: 0,
    commented: {},      // { ma bai: so comment da dang } — xem parsePostLinks
    cmtSkip: {},        // { ma bai: ly do } — bai tat binh luan / khong con: bo qua
    cmtPerDay: {},      // { '2026-11-14': 7 }
    cmtNextAt: 0,
    cmtFails: 0,        // comment hong lien tiep; luu lai vi moi lan sang bai la trang nap lai
    cmtPending: null,   // dang chuyen sang trang bai de comment: { code, at }
    cmtInflight: null,  // comment vua bam Dang, chua biet ket qua: { code, cap, at }
    log: [],
    settings: {
      postEnabled: true,  // dang bai anh moi (tat: chi comment)
      imgMin: 1,        // moi bai boc ngau nhien tu imgMin den imgMax anh
      imgMax: 1,
      keepRatio: true,  // chon ti le "Goc" o buoc cat anh, khong cat vuong
      recycle: true,    // dung het anh thi dang lai anh cu (tat: het anh thi dung)
      captionSource: 'builtin',   // 'builtin' kho cau khen co san | 'own' cau cua minh | 'both'
      captions: '',     // cau cua minh, cach nhau bang dong trong (hoac '---')
      suffix: '',       // them vao cuoi moi caption
      tags: '',         // ten tai khoan can tag, cach nhau bang dau cach / xuong dong
      cmtList: '',      // link bai can comment, moi dong mot link
      cmtTimes: 1,      // moi bai comment bao nhieu lan
      cmtSuffix: '',    // them vao cuoi moi comment
      cmtGapMin: 5,
      cmtGapMax: 15,
      cmtMaxPerDay: 20,
      gapMin: 60,
      gapMax: 180,
      maxPerDay: 5,
      hourFrom: 8,
      hourTo: 23,
      naturalPace: true,
      slowMode: false,
    },
  };

  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      return { ...structuredClone(DEFAULTS), ...s, settings: { ...DEFAULTS.settings, ...(s?.settings || {}) } };
    } catch {
      return structuredClone(DEFAULTS);
    }
  };
  const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));

  let state = load();

  // Kho cau khen dong goi kem extension (cung kho voi bot X): { contents: [cau, ...] }
  const BANK = 'content-lenamiu.json';
  let contentData = [];

  // Khoa trong bo nho: runTick chay moi giay, mot lan dang mat vai chuc giay
  let busy = false;
  let importing = false;
  let consecutiveFails = 0;
  let hiddenNoted = false;
  let outsideNoted = false;

  const today = () => new Date().toLocaleDateString('sv');
  const countToday = () => state.perDay[today()] || 0;
  const cmtToday = () => state.cmtPerDay[today()] || 0;

  /**
   * Tach list caption thanh tung cai. Bo cai trung.
   *
   * Co mot dong '---' nao thi CHI tach theo '---': dong trong o giua la mot
   * phan cua caption. Khong co '---' thi cac caption cach nhau bang dong trong.
   */
  function parsePosts(raw) {
    const lines = String(raw || '').replace(/\r/g, '').split('\n');
    const DASH = /^\s*---\s*$/;
    const byDash = lines.some((l) => DASH.test(l));
    const posts = [];
    let cur = [];
    const flush = () => { if (cur.length) posts.push(cur.join('\n')); cur = []; };
    for (const line of lines) {
      if (byDash ? DASH.test(line) : !line.trim()) flush();
      else cur.push(line.trimEnd());
    }
    flush();
    return [...new Set(posts.map((p) => p.trim()).filter(Boolean))];
  }

  /** Ten can tag: bo '@', chu thuong, bo trung. Ten sai dinh dang Instagram thi tra ve rieng. */
  function parseTags(raw) {
    const users = [];
    const bad = [];
    for (const tok of String(raw || '').split(/[\s,;]+/)) {
      const u = tok.replace(/^@+/, '').toLowerCase();
      if (!u) continue;
      if (!/^[a-z0-9._]{1,30}$/.test(u)) bad.push(tok);
      else if (!users.includes(u)) users.push(u);
    }
    return { users, bad };
  }

  /** Caption + phan them vao cuoi, cach nhau mot dong trong. */
  function buildCaption(caption, suffix) {
    return [caption, suffix].map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
  }

  /** Ly do Instagram se khong cho dang caption nay; mang rong la on. */
  function captionProblems(text) {
    const out = [];
    const len = [...String(text).normalize('NFC')].length;
    if (len > MAX_CAPTION) out.push(`dai ${len}/${MAX_CAPTION} ky tu`);
    const tags = (String(text).match(/#[^\s#]+/g) || []).length;
    if (tags > MAX_HASHTAGS) out.push(`${tags}/${MAX_HASHTAGS} hashtag`);
    return out;
  }

  /**
   * Khoa cua mot cau cua minh: bam theo CHU chu khong theo vi tri. Theo vi tri
   * thi them hay xoa mot cau la ca list truot di, cau da dung lai thanh "chua dung".
   */
  function postKey(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return `${h.toString(36)}:${text.length}`;
  }

  /**
   * Cac cau khen co the boc, theo nguon da chon: [{ key, text }]. Cau trong kho
   * khoa theo vi tri ('b:12'), cau cua minh khoa theo chu ('o:...').
   */
  function captionPool() {
    const src = state.settings.captionSource;
    const pool = [];
    if (src !== 'own') contentData.forEach((text, i) => pool.push({ key: `b:${i}`, text }));
    if (src !== 'builtin') {
      for (const text of parsePosts(state.settings.captions)) pool.push({ key: `o:${postKey(text)}`, text });
    }
    return pool;
  }

  /**
   * Boc ngau nhien mot cau CHUA DUNG trong `pool`. Dung het thi quay vong
   * (recycled = true, nguoi goi xoa lich su cau), tranh cau vua dang (`last`).
   * Pool rong -> null.
   */
  function pickCaption(pool, used, last, rand = Math.random) {
    if (!pool.length) return null;
    let free = pool.filter((c) => !used[c.key]);
    let recycled = false;
    if (!free.length) {
      recycled = true;
      free = pool.length > 1 ? pool.filter((c) => c.key !== last) : pool;
    }
    return { ...free[Math.floor(rand() * free.length)], recycled };
  }

  /**
   * Boc ngau nhien tu `min` den `max` anh, uu tien anh CHUA DANG trong `keys`.
   *  - `recycle` (cho dang lai anh cu): het anh chua dang thi boc tu ca thu muc
   *    (recycled = true, nguoi goi xoa lich su anh); con it hon so can thi lay
   *    them anh cu cho du.
   *  - khong `recycle`: het anh thi tra null; con it hon so can thi lay het phan con.
   */
  function pickImages(keys, used, min, max, recycle, rand = Math.random) {
    let lo = Math.min(MAX_IMAGES, Math.max(1, Math.floor(min) || 1));
    let hi = Math.min(MAX_IMAGES, Math.max(1, Math.floor(max) || 1));
    if (hi < lo) [lo, hi] = [hi, lo];
    const want = lo + Math.floor(rand() * (hi - lo + 1));
    const some = (list, n) => {                 // n phan tu ngau nhien, khong lap
      const a = [...list];
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(rand() * (a.length - i));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a.slice(0, n);
    };

    let fresh = keys.filter((k) => !used[k]);
    let recycled = false;
    if (!fresh.length) {
      if (!recycle || !keys.length) return null;
      fresh = [...keys];
      recycled = true;
    }
    const out = some(fresh, Math.min(want, fresh.length));
    if (recycle && out.length < want) {
      const old = keys.filter((k) => !out.includes(k));
      out.push(...some(old, Math.min(want - out.length, old.length)));
    }
    return { keys: out, recycled };
  }

  /**
   * Doc list link bai can comment: { codes: [ma bai], bad: [chu khong phai link bai] }.
   * Nhan /p/MA/, /reel/MA/, /tv/MA/ va /ten/p/MA/; bo duoi ?igsh=... ; bo trung.
   */
  function parsePostLinks(raw) {
    const codes = [];
    const bad = [];
    for (const tok of String(raw || '').split(/\s+/)) {
      if (!tok) continue;
      const m = tok.match(/instagram\.com\/(?:[^/?#\s]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/i);
      if (!m) bad.push(tok);
      else if (!codes.includes(m[1])) codes.push(m[1]);
    }
    return { codes, bad };
  }

  /** Bai ke tiep can comment (tu tren xuong, moi bai du cmtTimes lan): { code, done, times, index, total } hoac null. */
  function nextComment() {
    const { codes } = parsePostLinks(state.settings.cmtList);
    const times = Math.max(1, Math.floor(state.settings.cmtTimes) || 1);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (state.cmtSkip[code]) continue;
      const done = state.commented[code] || 0;
      if (done < times) return { code, done, times, index: i, total: codes.length };
    }
    return null;
  }

  /**
   * Cho bam NGAU NHIEN tren anh (ti le 0..1) de tag mot nguoi. Tranh mep anh (nut
   * chuyen anh, dong chu "Bam vao anh de gan the") va khong de len cho da tag
   * (`used`): nhan ten rong hon cao, nen hai cho khong de nhau khi cach nhau du
   * theo chieu ngang (gx) HOAC theo chieu doc (gy). Boc ngau nhien khong ra thi
   * quet luoi (thu tu ngau nhien) tim cho con trong; het cho moi noi long dan.
   * `box` = vung duoc bam [x0, x1, y0, y1] (mac dinh: vung an toan cua anh).
   */
  function randomSpot(used, rand = Math.random, box = [0.15, 0.85, 0.15, 0.77]) {
    const [x0, x1, y0, y1] = box;
    const roll = () => [x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0)];
    for (let scale = 1; scale > 0.15; scale -= 0.2) {
      const gx = 0.32 * scale, gy = 0.14 * scale;
      const free = (p) => used.every(([x, y]) => Math.abs(x - p[0]) >= gx || Math.abs(y - p[1]) >= gy);
      for (let k = 0; k < 150; k++) {
        const p = roll();
        if (free(p)) return p;
      }
      const grid = [];
      for (let i = 0; i <= 14; i++) {
        for (let j = 0; j <= 15; j++) grid.push([x0 + ((x1 - x0) * i) / 14, y0 + ((y1 - y0) * j) / 15]);
      }
      for (let i = grid.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [grid[i], grid[j]] = [grid[j], grid[i]];
      }
      const g = grid.find(free);
      if (g) return g;
    }
    return roll();
  }

  /** 'keep': Instagram nhan thang · 'convert': doi sang JPEG truoc · null: khong phai anh. */
  function imageKind(name) {
    const ext = (String(name).match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
    if (/^(jpe?g|png|heic|heif)$/.test(ext)) return 'keep';
    if (/^(webp|avif|gif|bmp)$/.test(ext)) return 'convert';
    return null;
  }

  /** Khoa cua mot anh: ten + kich thuoc. Chon lai thu muc van nhan ra anh da dang. */
  const imageKey = (f) => `${f.name}|${f.size}`;
  const keyName = (k) => k.slice(0, k.lastIndexOf('|'));

  function markUsed(keys) {
    for (const k of keys) state.used[k] = Date.now();
  }

  /** Bai da bam Chia se ma khong ro ket qua: coi nhu da dang, de khong dang trung anh / cau khen. */
  function settleInflight() {
    const f = state.inflight;
    if (!f) return;
    markUsed(f.keys || []);
    if (f.cap) state.usedCaptions[f.cap] = Date.now();
    state.inflight = null;
  }

  /** Nap kho cau khen dong goi kem extension (khai bao o web_accessible_resources). */
  let bankLongest = '';
  async function loadBank() {
    try {
      // Bam Reload extension ma chua F5 tab: ban cu con chay nhung mat ket noi voi extension
      if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
        throw new Error('extension vua duoc cap nhat — nhan F5 tab Instagram nay');
      }
      const res = await fetch(chrome.runtime.getURL(BANK));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      contentData = (Array.isArray(data.contents) ? data.contents : []).filter((t) => typeof t === 'string' && t.trim());
      bankLongest = contentData.reduce((m, t) => (t.length > m.length ? t : m), '');
    } catch (e) {
      addLog(`Khong nap duoc kho cau khen (${BANK}): ${e.message}`, 'err');
    }
  }

  function addLog(msg, kind = 'info') {
    state.log = [...state.log.slice(-80), { at: Date.now(), msg, kind }];
    save(state);
    renderLog();
    console.log(`[ig-poster] ${msg}`);
  }

  /** Loi khong nen thu lai (thieu anh, caption sai...): dung han. */
  function fatal(msg) {
    const e = new Error(msg);
    e.fatal = true;
    return e;
  }

  // ---------------------------------------------------------------- kho anh (IndexedDB)

  const DB_NAME = 'ig_auto_poster';
  const STORE = 'images';
  let dbPromise = null;

  function openDb() {
    dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  /** Chay mot lenh tren kho anh, tra ve ket qua khi giao dich xong. */
  async function idb(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }

  /** Doi anh webp/avif/gif/bmp sang JPEG (Instagram khong nhan), nen o canh dai 2160px. */
  async function toJpeg(file) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2160 / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  }

  /**
   * Chep anh trong thu muc nguoi dung vua chon vao kho. Thu muc la nguon that:
   * anh khong con trong thu muc thi xoa khoi kho. Lich su anh da dang giu nguyen.
   */
  async function importFolder(list) {
    const files = [...list].filter((f) => imageKind(f.name));
    const skipped = list.length - files.length;
    if (!files.length) return addLog('Thu muc khong co anh nao (nhan jpg, png, webp, heic...).', 'warn');

    importing = true;
    const folder = (files[0].webkitRelativePath || '').split('/')[0] || 'thu muc';
    addLog(`Dang nap ${files.length} anh tu "${folder}"...`);
    const keys = new Set();
    let failed = 0;
    try {
      for (const f of files) {
        const key = imageKey(f);
        if (keys.has(key)) continue;
        try {
          const convert = imageKind(f.name) === 'convert';
          const blob = convert ? await toJpeg(f) : f;
          const name = convert ? `${f.name.replace(/\.[^.]+$/, '')}.jpg` : f.name;
          await idb('readwrite', (st) => st.put({ name, type: blob.type || 'image/jpeg', blob }, key));
          keys.add(key);
        } catch (e) {
          failed++;
          console.warn('[ig-poster] khong nap duoc anh', f.name, e);
        }
        setText('iap-folder-info', `Dang nap ${keys.size + failed}/${files.length} anh...`);
      }
      const stale = (await idb('readonly', (st) => st.getAllKeys())).filter((k) => !keys.has(k));
      for (const k of stale) await idb('readwrite', (st) => st.delete(k));
    } finally {
      importing = false;
    }

    state.folder = { name: folder, keys: [...keys], at: Date.now() };
    save(state);
    addLog(`Da nap ${keys.size} anh tu "${folder}"` +
      (failed ? `, ${failed} anh loi` : '') + (skipped ? `, bo qua ${skipped} file khong phai anh` : '') + '.', 'ok');
    render();
  }

  /** Doc anh tu kho thanh File de dua vao o chon file cua Instagram. */
  async function loadFiles(keys) {
    const files = [];
    for (const k of keys) {
      const rec = await idb('readonly', (st) => st.get(k));
      if (!rec?.blob) throw fatal(`Khong con anh "${keyName(k)}" trong bo nho extension. Bam "Chon thu muc anh" lai.`);
      files.push(new File([rec.blob], rec.name, { type: rec.type || 'image/jpeg' }));
    }
    return files;
  }

  // ---------------------------------------------------------------- tien ich DOM

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Doi den khi dieu kien dung, kiem lai moi `step` ms. Khong nem loi. */
  async function until(fn, timeout = 4000, step = 120) {
    const deadline = Date.now() + timeout * paceFactor();
    for (;;) {
      try { if (fn()) return true; } catch { /* DOM dang thay, thu lai */ }
      if (Date.now() >= deadline) return false;
      await sleep(step);
    }
  }

  const paceFactor = () => (state?.settings?.slowMode ? 3 : 1);
  const pause = (ms) => sleep(Math.round(ms * paceFactor()));

  // Chu tren nut / nhan icon cua Instagram, cac ngon ngu hay dung. Khop NGUYEN
  // chu de khong bam nham.
  const RE = {
    create: /^(new post|create|bài viết mới|tạo|สร้าง|โพสต์ใหม่)$/i,
    createText: /^(create|tạo|สร้าง)$/i,
    search: /^(search|tìm kiếm|ค้นหา)/i,
    postItem: /^(post|bài viết|โพสต์)$/i,
    next: /^(next|tiếp|tiếp theo|ถัดไป)$/i,
    share: /^(share|chia sẻ|แชร์)$/i,
    crop: /crop|cắt|ครอบตัด/i,     // nhan icon chon ti le: "Select crop", "Chon ... cat"...
    original: /^(original|gốc|ảnh gốc|bản gốc|ต้นฉบับ)$/i,
    close: /^(close|đóng|ปิด)$/i,
    discard: /^(discard|bỏ|hủy bỏ|huỷ bỏ|ทิ้ง)$/i,
    cancel: /^(cancel|hủy|huỷ|ยกเลิก)$/i,
    notNow: /^(not now|lúc khác|để sau|ไม่ใช่ตอนนี้)$/i,
    // Comment
    addComment: /^(add a comment|thêm bình luận|viết bình luận|bình luận|แสดงความคิดเห็น|เพิ่มความคิดเห็น)/i,
    commentIcon: /^(comment|bình luận|แสดงความคิดเห็น|ความคิดเห็น)$/i,
    postComment: /^(post|đăng|โพสต์)$/i,
    cmtFailed: /could ?n['’]?t post (your )?comment|could not post (your )?comment|không thể đăng bình luận|không đăng được bình luận|ไม่สามารถโพสต์ความคิดเห็น/i,
    cmtOff: /comments on this post (have been|are) (limited|turned off)|commenting (has been|is) (turned off|limited)|đã tắt (tính năng )?bình luận|bình luận .*(đã bị tắt|bị giới hạn)|ปิดการแสดงความคิดเห็น/i,
    notFound: /sorry, this page isn['’]?t available|trang này hiện không khả dụng|rất tiếc, trang này|ขออภัย หน้านี้ไม่พร้อมใช้งาน/i,
    blocked: /we restrict certain activity|action blocked|chúng tôi hạn chế một số hoạt động|bị chặn hành động|เราจำกัดกิจกรรมบางอย่าง/i,
    shared: /post shared|has been shared|đã chia sẻ|đã được chia sẻ|แชร์โพสต์แล้ว|แชร์แล้ว/i,
    failed: /could ?n['’]?t be shared|could ?n['’]?t (share|upload)|could not (share|upload)|something went wrong|không thể chia sẻ|không chia sẻ được|đã xảy ra lỗi|ไม่สามารถแชร์/i,
  };

  const CLICKABLE = '[role="button"], button, a, [role="menuitem"], [role="link"]';
  const shown = (el) => !!el && el.isConnected && el.getClientRects().length > 0;
  const textOf = (el) => (el?.innerText || '').trim().replace(/\s+/g, ' ');
  const inEditor = (el) => !!el.closest('[contenteditable="true"]');

  /** Nut co aria-label (cua chinh no hoac cua icon svg ben trong) khop `re`. */
  function buttonsByLabel(root, re) {
    if (!root) return [];
    const out = new Set();
    for (const el of root.querySelectorAll('[aria-label]')) {
      if (!re.test((el.getAttribute('aria-label') || '').trim())) continue;
      const btn = el.closest(CLICKABLE) || el;
      if (shown(btn) && !btn.closest('#iap-panel')) out.add(btn);
    }
    return [...out];
  }

  /**
   * Thu bam duoc co CHU khop `re`. Mot so nut cua Instagram la div tran khong
   * role, nen tim ca o chu la (khong con phan tu con) roi lay nut bao no.
   * Bo qua chu nam trong o caption va trong bang dieu khien cua bot.
   */
  function findByText(root, re) {
    if (!root) return [];
    const out = new Set();
    for (const b of root.querySelectorAll(CLICKABLE)) {
      if (shown(b) && re.test(textOf(b)) && !inEditor(b) && !b.closest('#iap-panel')) out.add(b);
    }
    for (const leaf of root.querySelectorAll('span, div')) {
      if (leaf.children.length || !re.test(textOf(leaf)) || inEditor(leaf) || leaf.closest('#iap-panel')) continue;
      const btn = leaf.closest(CLICKABLE) || leaf;
      if (shown(btn)) out.add(btn);
    }
    return [...out];
  }

  function pressEscape() {
    for (const t of ['keydown', 'keyup']) {
      (document.activeElement || document.body).dispatchEvent(
        new KeyboardEvent(t, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
  }

  /**
   * Bam chuot that vao `el` tai toa do (x, y): du chuoi pointer/mouse, vi co
   * cho Instagram nghe mousedown (danh sach goi y) chu khong nghe click, va
   * cho doc vi tri bam (dat the tag len anh).
   */
  function pressAt(el, x, y) {
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
    const ptr = { ...base, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
    el.dispatchEvent(new PointerEvent('pointerover', ptr));
    el.dispatchEvent(new MouseEvent('mouseover', base));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...ptr, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', ptr));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }

  /**
   * Bam vao giua mot dong ket qua. Dong ket qua co the la link toi trang ca nhan:
   * chan trinh duyet chuyen trang, de Instagram chi gan the.
   */
  function pressRow(row) {
    const r = row.getBoundingClientRect();
    const isLink = !!row.closest('a[href]');
    const block = (e) => e.preventDefault();
    if (isLink) window.addEventListener('click', block, { capture: true });
    try {
      pressAt(row, r.left + r.width / 2, r.top + r.height / 2);
    } finally {
      if (isLink) setTimeout(() => window.removeEventListener('click', block, { capture: true }), 0);
    }
  }

  /**
   * Boi den toan bo noi dung cua DUNG o soan thao nay. execCommand / paste
   * tac dong len vung chon cua document, khong len element — caret roi ra
   * ngoai o thi moi lenh sau deu vo ich.
   */
  function selectAllIn(el) {
    if (!el || !el.isConnected || el.ownerDocument !== document) return false;
    try {
      el.focus();
      const sel = window.getSelection();
      if (!sel) return false;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      return el.contains(sel.anchorNode) || sel.anchorNode === el;
    } catch {
      return false;
    }
  }

  /**
   * Gia lap DAN vao o caption. O caption cua Instagram (Lexical) tu nhan su
   * kien paste va tu cap nhat trang thai cua no — goi preventDefault, nen
   * dispatchEvent tra false. Hieu san ky tu xuong dong.
   */
  function pasteInto(el, text) {
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      return !el.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt, bubbles: true, cancelable: true,
      }));
    } catch {
      return false;
    }
  }

  /**
   * Go chu vao o input thuong (o tim nguoi de tag). execCommand cho su kien
   * giong ban phim; khong duoc thi gan thang gia tri — content script o the
   * gioi cach ly nen React van thay gia tri doi va goi onChange.
   */
  function typeInput(input, text) {
    input.focus();
    input.select?.();
    let ok = false;
    try { ok = document.execCommand('insertText', false, text) && input.value === text; } catch { /* bo qua */ }
    if (!ok) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * Go caption vao o soan thao, de len moi thu dang co: boi den roi dan, mot
   * thao tac. Khong ai nhan paste thi go nhu ban phim (Lexical nhan beforeinput).
   *
   * Instagram co the doi "#tag" / "@ten" thanh link, chu hien ra lech vai ky tu
   * so voi chu go vao — nen bo '#'/'@' khi so.
   */
  async function typeInto(el, text) {
    if (el.tagName === 'TEXTAREA') {
      typeInput(el, text);
      if (!el.value.trim()) throw new Error('Go caption that bai');
      return;
    }
    const norm = (s) => s.replace(/[#@]/g, '').replace(/\s+/g, ' ').trim();
    const want = norm(text);
    const seen = () => norm(el.innerText || '');

    let done = false;
    for (let i = 0; i < 3 && !done; i++) {
      if (!el.isConnected) throw new Error('O caption bien mat khi dang go');
      if (!selectAllIn(el)) { await pause(400); continue; }
      await pause(250);              // cho Lexical kip nhan vung boi den moi
      if (!pasteInto(el, text)) {
        try { document.execCommand('insertText', false, text); } catch { /* bo qua */ }
      }
      done = await until(() => seen() === want, 6000);
    }

    if (!el.isConnected) throw new Error('O caption bien mat khi dang go');
    const typed = seen();
    if (!typed) throw new Error('Go caption vao o soan thao that bai');
    if (!typed.startsWith(want.slice(0, 20))) throw new Error('O caption con chu cu, chua dang bai nay');
    if (typed.length > want.length + 40) throw new Error('O caption con chu thua, chua dang bai nay');
  }

  /** Bam mot nut, doi no het disabled truoc. Kiem truoc, het han moi thoi. */
  async function clickWhenEnabled(el, timeout = 12000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (el && el.isConnected && el.getAttribute('aria-disabled') !== 'true' && !el.disabled) {
        el.click();
        return true;
      }
      if (Date.now() >= deadline) break;
      await sleep(300);
    }
    throw new Error(`Nut khong bam duoc (van bi tat): "${textOf(el) || el?.getAttribute?.('aria-label') || '?'}"`);
  }

  const visibleDialogs = () => [...document.querySelectorAll('[role="dialog"]')].filter(shown);

  /** Mo ta ngan man hinh luc loi, de con lan ra khi Instagram ve khac di. */
  function describeScreen() {
    const boxes = visibleDialogs();
    const labels = boxes
      .flatMap((b) => [...b.querySelectorAll(CLICKABLE)])
      .map((b) => textOf(b) || b.getAttribute('aria-label') || '')
      .filter(Boolean).slice(0, 10);
    return `dang o ${location.pathname}, ${boxes.length} hop thoai, nut: ${labels.join(' | ') || '(khong co)'}`;
  }

  /** Mo ta ngan mot phan tu (loai the, role, nhan, chu) de ghi nhat ky. */
  function describeEl(el) {
    if (!el) return '(khong co gi)';
    const role = el.getAttribute('role');
    const label = el.getAttribute('aria-label') || el.getAttribute('alt') || '';
    const text = linesOf(el).join(' / ').slice(0, 40);
    return `<${el.tagName.toLowerCase()}${role ? ` role=${role}` : ''}>` + (label ? ` "${label.slice(0, 40)}"` : '') + (text ? ` chu "${text}"` : '');
  }

  /** Chu trong hop thoai, tru phan caption (caption co the chua chu "da chia se"). */
  function textOutsideEditor(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll('[contenteditable]').forEach((n) => n.remove());
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Don hop thoai con mo. Dong hop tao bai giua chung thi Instagram hoi "Bo bai
   * viet?" — bam Bo (Discard), khong bam Huy o buoc do, khong thi anh cu nam lai.
   */
  async function dismissOverlays() {
    for (let i = 0; i < 5; i++) {
      const open = visibleDialogs();
      if (!open.length) return;
      const top = open[open.length - 1];
      const btn = findByText(top, RE.discard)[0] || findByText(top, RE.notNow)[0] ||
        buttonsByLabel(document, RE.close)[0] || findByText(top, RE.cancel)[0];
      if (btn) btn.click(); else pressEscape();
      await sleep(700);
    }
  }

  // ---------------------------------------------------------------- hop tao bai

  /** Hop tao bai dang mo: hop thoai co o chon anh, nut Tiep, o caption hoac nut Chia se. */
  function createScope() {
    return visibleDialogs().reverse().find((d) =>
      d.querySelector('input[type="file"], [contenteditable="true"]') ||
      findByText(d, RE.next).length || findByText(d, RE.share).length) || null;
  }

  /** Nut "Tao" (icon "Bai viet moi") o thanh ben; khong co nhan icon thi tim theo chu. */
  const createButton = () => buttonsByLabel(document, RE.create)[0] ||
    findByText(document, RE.createText).find((el) => !el.closest('article, main, [role="dialog"]')) || null;

  /** Muc "Bai viet" trong menu hien ra sau khi bam Tao (tai khoan nao co menu nay). */
  function postMenuItem(exclude) {
    return [...buttonsByLabel(document, RE.postItem), ...findByText(document, RE.postItem)]
      .find((el) => el !== exclude && !el.contains(exclude) && !el.closest('article, main')) || null;
  }

  /** O chon anh cua hop tao bai: nam trong hop thoai, hoac moi xuat hien sau khi bam Tao. */
  function fileInput(before) {
    const all = [...document.querySelectorAll('input[type="file"]')].filter((i) => /image/i.test(i.accept || ''));
    return all.find((i) => shown(i.closest('[role="dialog"]'))) ||
      (before && all.find((i) => !before.has(i))) || null;
  }

  function nextButton() {
    const b = findByText(createScope(), RE.next);
    return b[b.length - 1] || null;
  }

  const shareButton = () => findByText(createScope(), RE.share)[0] || null;

  function captionBox() {
    const d = createScope();
    return (d && (d.querySelector('[contenteditable="true"][role="textbox"]') ||
      d.querySelector('[contenteditable="true"]') || d.querySelector('textarea'))) || null;
  }

  /**
   * Phan ANH THAT trong khung: anh ngang/doc hien "vua khung" (object-fit: contain)
   * thi tren-duoi hoac hai ben la dai trong — bam vao do Instagram khong mo o tag.
   */
  function photoRect(el, r) {
    const nw = el.naturalWidth || el.videoWidth, nh = el.naturalHeight || el.videoHeight;
    if (!nw || !nh) return r;
    const fit = getComputedStyle(el).objectFit;
    if (fit !== 'contain' && fit !== 'scale-down') return r;
    const s = Math.min(r.width / nw, r.height / nh, fit === 'scale-down' ? 1 : Infinity);
    const w = nw * s, h = nh * s;
    return new DOMRect(r.left + (r.width - w) / 2, r.top + (r.height - h) / 2, w, h);
  }

  /** Khung anh lon nhat trong hop (de bam tag nguoi), chi phan anh that, khong tinh phan caption. */
  function previewRect(d) {
    if (!d) return null;
    const box = captionBox();
    let best = null, bestEl = null;
    for (const el of d.querySelectorAll('img, video, canvas, div[style*="background-image"]')) {
      if (box && el.contains(box)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 150) continue;
      if (!best || r.width * r.height > best.width * best.height) { best = r; bestEl = el; }
    }
    return best && photoRect(bestEl, best);
  }

  /** Mo hop tao bai bang dung nut nguoi dung bam. Tra ve o chon anh. */
  async function openCreate() {
    const open = fileInput();
    if (open) return open;
    await dismissOverlays();
    for (let i = 0; i < 2; i++) {
      const btn = createButton();
      if (!btn) throw new Error(`Khong thay nut Tao (Bai viet moi). Da dang nhap chua? Cua so co qua hep khong? — ${describeScreen()}`);
      const before = new Set(document.querySelectorAll('input[type="file"]'));
      btn.click();
      await until(() => fileInput(before) || postMenuItem(btn), 6000);
      if (!fileInput(before)) postMenuItem(btn)?.click();
      if (await until(() => fileInput(before), 8000)) return fileInput(before);
      await dismissOverlays();
    }
    throw new Error(`Bam Tao nhung khong mo duoc hop tao bai — ${describeScreen()}`);
  }

  /** Dua anh vao o chon file nhu nguoi dung vua chon xong trong hop thoai cua Windows. */
  function setFiles(input, files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Cach du phong: keo-tha anh vao giua hop tao bai. */
  function dropFiles(d, files) {
    const r = d.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const target = document.elementFromPoint(x, y) || d;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    for (const t of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    }
  }

  /** Buoc cat anh: chon ti le "Goc" thay vi cat vuong. Khong duoc thi thoi. */
  async function chooseOriginalCrop() {
    const btn = buttonsByLabel(createScope(), RE.crop)[0];
    if (!btn) return false;
    btn.click();
    let opt = null;
    await until(() => (opt = findByText(createScope() || document, RE.original)[0] || null), 3000);
    if (!opt) { btn.click(); return false; }
    opt.click();
    await pause(600);
    if (shown(opt)) btn.click();     // dong menu ti le
    return true;
  }

  /** Bam Tiep qua buoc cat anh va buoc bo loc, toi buoc viet caption. */
  async function goToCaptionStep() {
    for (let i = 0; i < 4 && !captionBox(); i++) {
      const next = nextButton();
      if (next) await clickWhenEnabled(next, 8000);
      await until(() => captionBox(), 4000);
    }
    const box = captionBox();
    if (!box) throw new Error(`Bam Tiep nhung khong toi buoc viet caption — ${describeScreen()}`);
    await pause(800);
    return box;
  }

  const textInputs = () => [...document.querySelectorAll('input:not([type]), input[type="text"], input[type="search"]')]
    .filter((i) => shown(i) && !i.closest('#iap-panel'));

  const ROWS = '[role="button"], button, a[href], [role="link"], [role="option"], li';

  /**
   * Cac dong chu DANG HIEN cua mot phan tu, chu thuong. Dung innerText chu khong
   * dung textContent: tick xanh la svg co <title>Verified</title>, textContent se
   * dinh chu "Verified" vao sau ten (ten "abc" thanh "abcVerified").
   */
  const linesOf = (el) => (el.innerText || '').split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean);

  /** Mot dong ket qua (it chu, khong phai ca danh sach) co mot dong dung bang ten `user`. */
  const isUserRow = (el, user) => {
    const lines = linesOf(el);
    return lines.length > 0 && lines.length <= 4 && lines.includes(user);
  };

  /**
   * Cac dong ket qua cua o tim nguoi de tag, theo thu tu tren xuong. Khung ket qua
   * cua Instagram co the nam NGOAI hop tao bai (gan thang vao body) va sau 5-6 tang:
   * di len tu o tim, lay tang gan nhat co dong chu. O tim nam trong hop thi khong
   * lan ra ngoai hop (trang phia sau, vd trang ca nhan cua chinh nguoi do, cung co ten nay).
   */
  function tagResults(input, dialog) {
    const inDialog = dialog.contains(input);
    for (let box = input.parentElement, i = 0; box && box !== document.body && i < 12; box = box.parentElement, i++) {
      if (inDialog && !dialog.contains(box)) break;
      const rows = [...box.querySelectorAll(ROWS)].filter((r) => {
        if (r.contains(input) || !shown(r) || inEditor(r) || r.closest('#iap-panel')) return false;
        const lines = linesOf(r);
        return lines.length > 0 && lines.length <= 4 && !RE.cancel.test(lines[0]) && !RE.close.test(lines[0]);
      });
      // Dong long nhau (div bam duoc chua link) thi giu dong ngoai cung
      const outer = rows.filter((r) => !rows.some((o) => o !== r && o.contains(r)));
      if (outer.length) return outer;
    }
    return [];
  }

  /** "Chu ky" cua danh sach ket qua, de biet danh sach da doi theo chu vua go chua. */
  const sigOf = (rows) => rows.map((r) => linesOf(r).join('/')).join('|');

  /** Chu cac dong ket qua dang hien (de ghi nhat ky). */
  const textsNear = (input, dialog) => tagResults(input, dialog).map((r) => linesOf(r).join(' / ')).slice(0, 6);

  /** Go tung ky tu nhu nguoi go: o tim cua Instagram co the chi tim khi thay phim go. */
  async function typeSlow(input, text, gap = 60) {
    input.focus();
    input.select?.();
    try { document.execCommand('delete'); } catch { /* bo qua */ }
    if (input.value) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    for (const ch of text) {
      const k = { key: ch, bubbles: true, cancelable: true };
      input.dispatchEvent(new KeyboardEvent('keydown', k));
      const before = input.value;
      try { document.execCommand('insertText', false, ch); } catch { /* bo qua */ }
      if (input.value === before) {
        input.value = before + ch;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.dispatchEvent(new KeyboardEvent('keyup', k));
      await sleep(gap + Math.random() * gap * 1.5);
    }
  }

  /** O tim nguoi dang mo: o moi hien ra sau khi bam anh, hoac o tim Instagram dung lai va dat con tro vao. */
  const focusedSearch = () => {
    const a = document.activeElement;
    return a?.tagName === 'INPUT' && RE.search.test(a.placeholder || a.getAttribute('aria-label') || '') && shown(a) ? a : null;
  };
  const openSearch = () => textInputs().find((el) => RE.search.test(el.placeholder || el.getAttribute('aria-label') || '')) || null;

  /**
   * Doi ket qua tim nguoi. Uu tien dong dung ten. Khong co (ten tick xanh, chu dac
   * biet...) thi lay KET QUA DAU TIEN — nhung chi khi danh sach da doi theo chu vua
   * go va dung yen (khong lay nham goi y co san). 6 giay chua co ket qua moi thi go
   * lai ten cham hon: lan tim lien tiep thu hai Instagram hay khong tra ket qua.
   */
  async function waitTagResult(input, d, u, sigBefore, timeout) {
    const t0 = Date.now();
    let lastSig = null, stableAt = Date.now(), retyped = false;
    while (Date.now() - t0 < timeout * paceFactor()) {
      const rows = tagResults(input, d);
      const exact = rows.find((row) => isUserRow(row, u));
      if (exact) return { hit: exact, first: false };
      const sig = sigOf(rows);
      if (sig !== lastSig) { lastSig = sig; stableAt = Date.now(); }
      if (rows.length && sig !== sigBefore && Date.now() - t0 > 2500 && Date.now() - stableAt > 1200) {
        return { hit: rows.find((row) => (linesOf(row)[0] || '').includes(u)) || rows[0], first: true };
      }
      if (!retyped && Date.now() - t0 > 6000 && (!rows.length || sig === sigBefore)) {
        retyped = true;
        await typeSlow(input, u, 150);
      }
      await sleep(300);
    }
    return { hit: null, first: false };
  }

  /** Khung cac nhan tag dang hien tren anh (ten nguoi da tag), do that tren man hinh. */
  function tagLabelRects(d, tagged) {
    if (!tagged.size) return [];
    const out = [];
    for (const s of d.querySelectorAll('span')) {
      const t = (s.textContent || '').trim().toLowerCase();
      if (![...tagged].some((u) => t.startsWith(u)) || inEditor(s) || !linesOf(s).some((l) => tagged.has(l))) continue;
      const b = s.getBoundingClientRect();
      if (b.width && b.width < 400 && b.height < 120) out.push(b);
    }
    return out;
  }

  /**
   * Chon cho bam ngau nhien tren anh: xa cac cho da tag trong bai nay (`spots`), va
   * nhan ten se hien ra (uoc chung 150 x 55 px quanh cho bam) khong de len nhan
   * tag nao dang hien. Tra ve { p: [fx, fy], x, y, target }.
   */
  function pickTagPoint(d, r, spots, tagged, box) {
    const labels = tagLabelRects(d, tagged);
    // Khung tim nguoi cua nguoi truoc con mo (may nao chon xong khong tu dong) thi che
    // mot phan anh: bam trung no thi tuong "ngoai hop", hoac bam nham dong ket qua
    const pop = searchPopover(d);
    const popAt = pop?.getBoundingClientRect();
    let best = null;
    for (let k = 0; k < 60; k++) {
      const p = randomSpot(spots, Math.random, box);
      const x = r.left + r.width * p[0], y = r.top + r.height * p[1];
      const target = document.elementFromPoint(x, y);
      const ok = target && d.contains(target) && !(pop && pop.contains(target));
      if (ok && !best) best = { p, x, y, target };
      const onPop = popAt && x >= popAt.left && x <= popAt.right && y >= popAt.top && y <= popAt.bottom;
      const bubble = { left: x - 75, right: x + 75, top: y - 12, bottom: y + 43 };
      const overlaps = labels.some((b) => b.left < bubble.right && b.right > bubble.left && b.top < bubble.bottom && b.bottom > bubble.top);
      if (ok && !onPop && !overlaps && !linesOf(target).some((l) => tagged.has(l))) return { p, x, y, target };
    }
    if (best) return best;
    const p = randomSpot(spots, Math.random, box);
    const x = r.left + r.width * p[0], y = r.top + r.height * p[1];
    return { p, x, y, target: document.elementFromPoint(x, y) };
  }

  /**
   * Khung tim nguoi dang mo (o tim + danh sach ket qua): di len tu o tim toi tang
   * ngay duoi khoi chua anh (khung nam trong hop), hoac toi sat body (khung gan
   * thang vao body, ngoai hop). Khong co o tim nao mo: null.
   */
  function searchPopover(d) {
    const input = openSearch();
    if (!input) return null;
    const media = d.querySelector('img, video, canvas') || d;
    let el = input;
    while (el.parentElement && el.parentElement !== document.body && !el.parentElement.contains(media)) el = el.parentElement;
    return el;
  }

  /**
   * Tag mot nguoi, mot lan thu: bam vao mot cho ngau nhien tren anh -> o tim mo
   * -> go ten -> bam ket qua. Lan thu 2 bam cho khac va go cham hon.
   * Tra ve cho da bam ([fx, fy]) khi da tag, null khi khong.
   */
  async function tagOne(u, attempt, tagged, spots) {
    const d = createScope();
    if (!d) throw new Error('Hop tao bai bi dong giua luc tag nguoi (co ai bam ra ngoai hop, hoac bam Esc?)');
    const r = previewRect(d);
    if (!r) { addLog(`Tag @${u}: khong thay anh de bam — ${describeScreen()}`, 'warn'); return null; }
    addLog(`Dang tag @${u}${attempt > 1 ? ` (lan ${attempt})` : ''}...`);

    // Bam toi da 3 cho, moi lan gan tam anh hon: cho ngau nhien co the roi vao cho
    // Instagram khong nhan (vien anh, nut tren anh). O tim cua nguoi truoc con mo
    // thi chi nhan khi no da doi cho / doi chu (Instagram dua no toi cho vua bam).
    const BOXES = [[0.15, 0.85, 0.15, 0.77], [0.3, 0.7, 0.35, 0.65], [0.44, 0.56, 0.44, 0.56]];
    let input = null, p = null;
    for (let c = 0; c < BOXES.length && !input; c++) {
      const pt = pickTagPoint(d, r, spots, tagged, BOXES[c]);
      if (!pt?.target || !d.contains(pt.target)) {
        addLog(`Tag @${u}: cho bam (${pt?.p.map((v) => v.toFixed(2)).join(', ')}) nam ngoai hop tao bai — ${describeScreen()}`, 'warn');
        continue;
      }
      const before = new Set(textInputs());
      const old = openSearch() || focusedSearch();
      const oldAt = old?.getBoundingClientRect();
      const oldVal = old?.value;
      const fresh = (o) => !!o && (o !== old || o.value !== oldVal ||
        Math.abs(o.getBoundingClientRect().left - oldAt.left) > 4 || Math.abs(o.getBoundingClientRect().top - oldAt.top) > 4);
      const last = c === BOXES.length - 1;                  // lan cuoi: co o tim nao dang mo cung dung
      pressAt(pt.target, pt.x, pt.y);
      await until(() => (input = textInputs().find((el) => !before.has(el)) ||
        [focusedSearch(), openSearch()].find((o) => fresh(o) || (last && o)) || null), 3500);
      if (input) { p = pt.p; break; }
      addLog(`Tag @${u}: bam vao anh o (${pt.p.map((v) => v.toFixed(2)).join(', ')}) nhung o tim khong mo — ` +
        `trung ${describeEl(pt.target)}${c < BOXES.length - 1 ? ', thu bam gan giua anh hon' : ''}.`, 'warn');
      await pause(800);
    }
    if (!input) {
      addLog(`Tag @${u} (lan ${attempt}): bam 3 cho tren anh nhung o tim nguoi khong mo.`, 'warn');
      return null;
    }

    await pause(300 + (attempt - 1) * 700);
    const sigBefore = sigOf(tagResults(input, d));        // goi y co san truoc khi go: khong duoc lay nham
    await typeSlow(input, u, attempt > 1 ? 130 : 60);
    const { hit, first } = await waitTagResult(input, d, u, sigBefore, 15000);
    if (!hit) {
      addLog(`Tag @${u} (lan ${attempt}): khong tim thay. O tim dang co "${input.value}" ` +
        `(${input.getAttribute('placeholder') || input.getAttribute('aria-label') || 'khong nhan'}); ` +
        `ket qua dang hien: ${textsNear(input, d).join(' | ') || '(khong co gi)'}`, 'warn');
      await typeSlow(input, '');
      return null;
    }
    if (first) addLog(`Khong thay dong dung ten @${u}, lay ket qua dau tien: "${linesOf(hit).join(' / ')}"`, 'warn');

    // Da tag xong khi: o tim dong lai, HOAC o tim bi xoa trang, HOAC nhan ten moi hien tren anh.
    // (May nao chon xong ma o tim van hien chu: truoc day bot tuong chua tag, tim lai nguoi cu.)
    let pop = input.parentElement;                           // khung tim nguoi: phan bo chung cua o tim va dong ket qua
    while (pop && pop !== document.body && !pop.contains(hit)) pop = pop.parentElement;
    const labels = () => [...(createScope() || d).querySelectorAll('span')].filter((s) =>
      (s.textContent || '').trim().toLowerCase().startsWith(u) && !(pop && pop.contains(s)) && !inEditor(s) &&
      shown(s) && linesOf(s).includes(u)).length;
    const labelsBefore = labels();
    pressRow(hit);
    if (await until(() => !shown(input) || !input.value.trim() || labels() > labelsBefore, 4000)) return p;
    addLog(`Tag @${u} (lan ${attempt}): da bam vao ket qua nhung chua thay nhan ten tren anh, o tim van con "${input.value}"`, 'warn');
    return null;
  }

  /**
   * Tag tung nguoi len anh dau tien, moi nguoi thu toi da 2 lan. Giua hai nguoi:
   * doi o tim cua nguoi truoc dong han va nghi mot chut — bam qua som sau khi vua
   * gan the, Instagram bo qua cu bam (may cham hay gap). Tra ve so nguoi da tag.
   */
  async function tagPeople(users) {
    const panel = $('iap-panel');
    panel?.classList.add('iap-ghosted');      // de bang dieu khien khong che anh khi bam theo toa do
    const tagged = new Set();
    const spots = [];                          // cho da tag trong bai nay: nguoi sau khong de len
    try {
      for (let i = 0; i < users.length; i++) {
        const u = users[i];
        if (i > 0) {
          await until(() => !openSearch(), 3000);
          await pause(1200 + Math.random() * 800);
        }
        let spot = null;
        for (let attempt = 1; attempt <= 2 && !spot; attempt++) {
          if (attempt > 1) await pause(1500);
          spot = await tagOne(u, attempt, tagged, spots);
        }
        if (spot) {
          spots.push(spot);
          tagged.add(u);
          addLog(`Da tag @${u}.`);
        } else addLog(`Bo qua @${u}: thu 2 lan khong tag duoc.`, 'warn');
      }
    } finally {
      panel?.classList.remove('iap-ghosted');
    }
    return tagged.size;
  }

  /** Doi Instagram bao da chia se. Bao loi ro rang thi danh dau "chua dang" de anh duoc dung lai. */
  async function waitShared() {
    const deadline = Date.now() + 120000 * paceFactor();
    for (;;) {
      await sleep(700);
      const d = createScope() || visibleDialogs().pop();
      if (!d) return;                                       // hop tu dong lai sau khi dang
      const t = textOutsideEditor(d);
      if (RE.blocked.test(t)) {
        const e = fatal(`Instagram dang chan bot hoat dong: "${t.slice(0, 120)}". Dung han; de vai gio roi chay lai voi nhip cham hon.`);
        e.notPosted = true;
        throw e;
      }
      if (RE.failed.test(t)) {
        const e = new Error(`Instagram bao loi: "${t.slice(0, 120)}"`);
        e.notPosted = true;
        throw e;
      }
      if (RE.shared.test(t) || d.querySelector('img[alt*="checkmark" i]')) return;
      if (Date.now() > deadline) throw new Error('Da bam Chia se nhung doi 2 phut chua thay bao da dang');
    }
  }

  /** Toan bo mot lan dang: mo hop, dua anh, qua cac buoc, caption, tag, Chia se. */
  async function postToInstagram(files, caption, users, beforeShare) {
    if (createScope() || visibleDialogs().length) await dismissOverlays();
    const input = await openCreate();
    setFiles(input, files);
    if (!(await until(() => nextButton() || captionBox(), 20000, 300))) {
      const d = createScope();
      if (d) {
        addLog('Dua anh qua o chon file khong an, thu keo-tha vao hop.', 'warn');
        dropFiles(d, files);
      }
      if (!(await until(() => nextButton(), 20000, 300))) {
        throw new Error(`Da dua anh vao nhung Instagram khong nhan — ${describeScreen()}`);
      }
    }
    await pause(1000);
    if (state.settings.keepRatio && !(await chooseOriginalCrop())) {
      addLog('Khong chon duoc ti le "Goc", dang theo ti le mac dinh cua Instagram.', 'warn');
    }

    const box = await goToCaptionStep();
    if (caption) await typeInto(box, caption);
    if (users.length) {
      await pause(600);
      const n = await tagPeople(users);
      addLog(`Da tag ${n}/${users.length} nguoi.`, n === users.length ? 'info' : 'warn');
    }

    if (!createScope()) throw new Error('Hop tao bai da bi dong truoc khi bam Chia se (co ai bam ra ngoai hop, hoac bam Esc?)');
    const share = shareButton();
    if (!share) throw new Error(`Khong thay nut Chia se — ${describeScreen()}`);
    await pause(800);
    beforeShare();
    await clickWhenEnabled(share, 10000);
    await waitShared();
  }

  // ---------------------------------------------------------------- may trang thai

  function stopRun(msg, kind = 'err') {
    state.running = false;
    addLog(msg, kind);
    save(state);
    render();
  }

  /** Mot bai: boc anh + caption, dang, ghi lai. Dung cho ca lich chay lan nut "Dang thu 1 bai". */
  async function doJob() {
    busy = true;
    render();
    let pick = null;
    try {
      const s = state.settings;
      const keys = state.folder?.keys || [];
      if (!keys.length) return stopRun('Chua chon thu muc anh. Bam "Chon thu muc anh" truoc.', 'warn');
      pick = pickImages(keys, state.used, s.imgMin, s.imgMax, s.recycle);
      if (!pick) return outOfImages();
      if (pick.recycled) {
        for (const k of keys) delete state.used[k];
        addLog('Da dang het anh, quay vong lai tu dau.', 'warn');
      }

      const files = await loadFiles(pick.keys);
      const pool = captionPool();
      const cap = pickCaption(pool, state.usedCaptions, state.lastCaption);
      if (!cap) {
        throw fatal(s.captionSource === 'own'
          ? 'O "Cau cua minh" dang trong. Go cau khen vao, hoac chon nguon "Kho co san".'
          : `Chua nap duoc kho cau khen (${BANK}). Nhan F5 tab Instagram nay; van loi thi bam Reload extension o chrome://extensions roi F5.`);
      }
      const caption = buildCaption(cap.text, s.suffix);
      const bad = captionProblems(caption);
      if (bad.length) throw fatal(`Caption ${bad.join(', ')} — Instagram khong cho dang. Sua lai roi bam Bat dau.`);
      const users = parseTags(s.tags).users.slice(0, MAX_TAGS);

      addLog(`Dang bai ${files.length} anh${users.length ? `, tag ${users.length} nguoi` : ''}: ${files.map((f) => f.name).join(', ').slice(0, 60)}` +
        ` · cau: "${cap.text.slice(0, 40)}..."`);
      await postToInstagram(files, caption, users, () => {
        state.inflight = { keys: pick.keys, cap: cap.key, at: Date.now() };
        save(state);
      });
      finishPost(pick, cap, pool);
      await sleep(1500);
      await dismissOverlays();
    } catch (e) {
      await failPost(e);
    } finally {
      busy = false;
      render();
    }
  }

  /** Ghi cau khen vua dung; boc vong moi thi xoa lich su cau cua nguon do truoc. */
  function useCaption(cap, pool) {
    if (cap.recycled) {
      for (const c of pool) delete state.usedCaptions[c.key];
      addLog('Da dung het cau khen, quay vong lai tu dau.', 'warn');
    }
    state.usedCaptions[cap.key] = Date.now();
    state.lastCaption = cap.key;
  }

  /** Het anh (khong cho dang lai anh cu): con comment thi chi tat dang anh, khong thi dung han. */
  function outOfImages() {
    if (state.running && nextComment()) {
      state.settings.postEnabled = false;
      addLog('Da dang het anh trong thu muc: tat "Dang bai anh moi", van comment tiep theo list.', 'warn');
      save(state);
      render();
      return;
    }
    stopRun('Da dang het anh trong thu muc. Them anh roi bam "Chon thu muc anh" lai, hoac tick "dang lai anh cu".', 'ok');
  }

  function finishPost(pick, cap, pool) {
    consecutiveFails = 0;
    markUsed(pick.keys);
    useCaption(cap, pool);
    state.inflight = null;
    state.perDay[today()] = countToday() + 1;
    addLog(`Da dang bai ${pick.keys.length} anh.`, 'ok');
    if (!state.running) { save(state); render(); return; }
    if (!state.settings.recycle && !pickImages(state.folder?.keys || [], state.used, 1, 1, false)) return outOfImages();
    scheduleNext();
  }

  /**
   * Dang hong. Anh da bam Chia se ma khong ro ket qua thi coi nhu da dung (tranh
   * dang trung); Instagram bao loi ro rang thi anh duoc dung lai. Thu lai sau
   * vai phut; hong 3 lan lien tiep, hoac loi khong nen thu lai, thi dung han.
   */
  async function failPost(e) {
    if (state.inflight) {
      if (e.notPosted) state.inflight = null;
      else {
        settleInflight();
        addLog('Khong chac bai vua roi da len chua: coi anh va cau khen do la da dung de khong dang trung. Xem trang ca nhan de kiem.', 'warn');
      }
    }
    addLog(`Loi: ${e.message}`, 'err');
    await dismissOverlays();
    if (e.fatal) {
      state.running = false;
    } else if (++consecutiveFails >= 3) {
      state.running = false;
      addLog('Hong 3 lan lien tiep, da dung. Bam "Kiem tra trang" xem bot con thay nut nao.', 'err');
    } else if (state.running) {
      const wait = 5 * consecutiveFails;
      state.nextAt = Date.now() + wait * 60000;
      addLog(`Se thu lai sau ${wait} phut.`, 'warn');
    }
    save(state);
    render();
  }

  /** Bien ngau nhien chuan (Box-Muller), de sinh gian cach hinh chuong. */
  function gaussian() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const inHours = (d) => {
    const { hourFrom, hourTo } = state.settings;
    if (hourFrom === hourTo) return true;
    const h = d.getHours();
    return hourFrom <= hourTo ? h >= hourFrom && h < hourTo : h >= hourFrom || h < hourTo;
  };

  /** Day thoi diem toi lan mo khung gio gan nhat. */
  function alignToHours(t) {
    const d = new Date(t);
    for (let i = 0; i < 48 && !inHours(d); i++) {
      d.setHours(d.getHours() + 1, Math.floor(Math.random() * 60), 0, 0);
    }
    return d.getTime();
  }

  /**
   * Khoang cho (ms) ngau nhien trong [gapMin, gapMax] phut. Nhip tu nhien: hinh
   * chuong quanh giua khoang, lay mau lai neu roi ra ngoai (kep ve bien se
   * don cum o hai dau, nhin may moc hon). It nhat 1 phut.
   */
  function nextDelay(gapMin, gapMax, naturalPace) {
    if (gapMax < gapMin) [gapMin, gapMax] = [gapMax, gapMin];
    const lo = gapMin * 60000, hi = gapMax * 60000;
    let delay;
    if (lo === hi) {
      delay = lo;
    } else if (naturalPace) {
      const mid = (lo + hi) / 2;
      const sigma = (hi - lo) / 5;
      do { delay = mid + gaussian() * sigma; } while (delay < lo || delay > hi);
    } else {
      delay = lo + Math.random() * (hi - lo);
    }
    return Math.max(60000, delay);
  }

  /** Hen bai anh ke tiep. */
  function scheduleNext() {
    const { gapMin, gapMax, naturalPace } = state.settings;
    state.nextAt = alignToHours(Date.now() + nextDelay(gapMin, gapMax, naturalPace));
    save(state);
    render();
  }

  /** Hen comment ke tiep. */
  function scheduleNextComment() {
    const { cmtGapMin, cmtGapMax, naturalPace } = state.settings;
    state.cmtNextAt = alignToHours(Date.now() + nextDelay(cmtGapMin, cmtGapMax, naturalPace));
    save(state);
    render();
  }

  /** Dau ngay mai (vai phut dau, ngau nhien), day vao khung gio. */
  function tomorrow() {
    const d = new Date();
    d.setHours(24, Math.floor(Math.random() * 30), 0, 0);
    return alignToHours(d.getTime());
  }

  // ---------------------------------------------------------------- comment khen

  /** Ma bai dang mo (dia chi /p/MA/, /reel/MA/, /ten/p/MA/), hoac null. */
  const currentCode = () => location.pathname.match(/^\/(?:[^/]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/)?.[1] || null;

  // ---------------------------------------------------------------- chay khi tab an

  /*
   * Chrome lam cham tab an: hen gio toi da 1 lan/giay, an lau (> 5 phut) chi con
   * 1 lan/phut, va co the "dong bang" ca tab. Tab DANG PHAT TIENG thi khong bi vay.
   * Nen luc bot chay, phat mot am cuc nho (30 Hz, -60 dB: loa may tinh khong phat
   * ra duoc, tai khong nghe) de Chrome coi tab la dang phat tieng — tab hien icon loa.
   * Phan giao dien (khung hinh) do background-run.js lo, dua vao co data-iap-active.
   *
   * Trinh duyet chi cho bat am thanh sau mot lan bam tren trang. Tao AudioContext
   * truoc do thi Chrome in canh bao "The AudioContext was not allowed to start" ra
   * Console, nen CHI tao khi trang da tung duoc bam (navigator.userActivation), hoac
   * ngay trong luc bam nut cua bang dieu khien. Trang nap lai (sang bai de comment)
   * thi doi lan bam chuot / phim ke tiep tren trang.
   */
  let audio = null;
  let audioTriedAt = 0;
  const pageActivated = () => !!navigator.userActivation?.hasBeenActive;
  /** `force`: dang trong luc nguoi dung bam (trinh duyet cho bat am). Khong thi 10 giay moi thu lai mot lan. */
  function keepAlive(on, force = false) {
    try {
      if (!on) {
        if (audio) { audio.close().catch(() => {}); audio = null; }
        return;
      }
      if (!force && !pageActivated()) return;      // chua ai bam tren trang nay: dung tao, khoi bi canh bao
      if (!force && audio?.state === 'suspended' && Date.now() - audioTriedAt < 10000) return;
      audioTriedAt = Date.now();
      if (!audio) {
        audio = new AudioContext();
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = 30;
        gain.gain.value = 0.001;
        osc.connect(gain).connect(audio.destination);
        osc.start();
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch { /* trinh duyet khong cho thi thoi: van chay, chi cham hon khi tab an */ }
  }
  const keepingAlive = () => audio?.state === 'running';

  /** Bot dang chay / dang lam: bat che do chay nen, bao cho background-run.js. Goi moi giay. */
  function syncBackgroundMode() {
    const active = !!state.running || busy;
    keepAlive(active);
    document.documentElement.dataset.iapActive = active ? '1' : '';
  }

  /** O binh luan cua bai dang mo: theo nhan "Them binh luan...", khong thi textarea trong form cua bai. */
  function commentBox() {
    const all = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
      .filter((el) => shown(el) && !el.closest('#iap-panel'));
    return all.find((el) => RE.addComment.test((el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim())) ||
      all.find((el) => el.tagName === 'TEXTAREA' && el.closest('article form, main form')) || null;
  }

  /** Chu (o phan tu la) dang hien tren trang khop `re`; bo qua bang dieu khien va o soan thao. */
  function pageSays(re) {
    for (const el of document.querySelectorAll('span, div, p, h1, h2, h3')) {
      if (el.children.length || el.closest('#iap-panel') || inEditor(el)) continue;
      const t = textOf(el);
      if (t && re.test(t) && shown(el)) return t.slice(0, 140);
    }
    return '';
  }

  /** Chu trong hop thoai dang mo khop `re` (vd hop "Thu lai sau" khi Instagram chan bot). */
  const dialogSays = (re) => visibleDialogs().map(textOutsideEditor).find((t) => re.test(t))?.slice(0, 140) || '';

  /** Dong hop hoi kieu "Bat thong bao?" (bam "Luc khac"); khong dong gi khac. */
  async function dismissPrompts() {
    for (let i = 0; i < 3; i++) {
      const btn = visibleDialogs().map((d) => findByText(d, RE.notNow)[0]).find(Boolean);
      if (!btn) return;
      btn.click();
      await sleep(600);
    }
  }

  function pressEnter(el) {
    for (const t of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
  }

  /** Bai khong comment duoc (tat binh luan, bai khong con): bo qua bai do, khong tinh la hong. */
  function skipPost(msg) {
    const e = new Error(msg);
    e.skip = true;
    e.notPosted = true;
    return e;
  }

  /** Comment vua bam Dang ma khong ro ket qua: coi nhu da comment, de khong comment trung. */
  function settleCmtInflight() {
    const f = state.cmtInflight;
    if (!f) return;
    state.commented[f.code] = (state.commented[f.code] || 0) + 1;
    if (f.cap) state.usedCaptions[f.cap] = Date.now();
    state.cmtInflight = null;
  }

  /**
   * Comment mot lan vao bai dang mo: go cau khen, bam Dang, doi o binh luan
   * trong lai (Instagram xoa o khi dang xong; loi thi giu chu va bao loi).
   */
  async function commentHere(job) {
    await dismissPrompts();
    await pause(2000 + Math.random() * 4000);           // nhu nguoi xem bai mot chut roi moi comment
    let box = null;
    const stop = () => (box = commentBox()) || pageSays(RE.cmtOff) || pageSays(RE.notFound);
    if (!(await until(stop, 12000, 300))) {
      buttonsByLabel(document.querySelector('main') || document, RE.commentIcon)[0]?.click();
      await until(stop, 5000, 300);
    }
    if (!box) {
      const off = pageSays(RE.cmtOff);
      if (off) throw skipPost(`Bai ${job.code} da tat binh luan ("${off}")`);
      const gone = pageSays(RE.notFound);
      if (gone) throw skipPost(`Bai ${job.code} khong con hoac khong xem duoc ("${gone}")`);
      throw new Error(`Khong thay o binh luan cua bai ${job.code} — ${describeScreen()}`);
    }

    const pool = captionPool();
    const cap = pickCaption(pool, state.usedCaptions, state.lastCaption);
    if (!cap) {
      throw fatal(state.settings.captionSource === 'own'
        ? 'O "Cau cua minh" dang trong. Go cau khen vao, hoac chon nguon "Kho co san".'
        : `Chua nap duoc kho cau khen (${BANK}). Nhan F5 tab Instagram nay; van loi thi bam Reload extension o chrome://extensions roi F5.`);
    }
    const text = buildCaption(cap.text, state.settings.cmtSuffix);
    const bad = captionProblems(text);
    if (bad.length) throw fatal(`Comment ${bad.join(', ')} — Instagram khong cho dang. Sua phan them vao cuoi comment.`);

    box.scrollIntoView({ block: 'center' });
    await pause(400);
    await typeInto(box, text);
    await pause(500 + Math.random() * 800);

    const form = box.closest('form');
    const btn = form ? findByText(form, RE.postComment)[0] : null;
    state.cmtInflight = { code: job.code, cap: cap.key, at: Date.now() };
    save(state);
    if (btn) await clickWhenEnabled(btn, 8000);
    else pressEnter(box);

    const deadline = Date.now() + 25000 * paceFactor();
    for (;;) {
      await sleep(500);
      const blocked = dialogSays(RE.blocked) || pageSays(RE.blocked);
      if (blocked) {
        const e = fatal(`Instagram dang chan bot hoat dong: "${blocked}". Dung han; de vai gio roi chay lai voi nhip cham hon.`);
        e.notPosted = true;
        throw e;
      }
      const err = pageSays(RE.cmtFailed);
      if (err) {
        const e = new Error(`Instagram bao loi: "${err}"`);
        e.notPosted = true;
        throw e;
      }
      const left = box.isConnected ? (box.value ?? box.innerText ?? '') : '';
      if (!left.trim()) return { cap, pool };
      if (Date.now() > deadline) throw new Error('Da bam Dang nhung o binh luan van con chu sau 25 giay');
    }
  }

  /**
   * Mot comment. Chua o trang bai thi ghi cmtPending roi chuyen trang: trang nap
   * lai, boot() goi resumeComment() lam not. Da o dung trang thi comment luon.
   */
  async function doComment(job) {
    busy = true;
    render();
    try {
      if (currentCode() !== job.code) {
        state.cmtPending = { code: job.code, at: Date.now() };
        save(state);
        addLog(`Mo bai ${job.index + 1}/${job.total} (${job.code}) de comment...`);
        setTimeout(() => {                         // khong chuyen trang duoc thi thoi, lan sau thu lai
          if (state.cmtPending?.code !== job.code) return;
          state.cmtPending = null;
          busy = false;
          save(state);
          addLog('Khong mo duoc trang bai de comment, se thu lai sau.', 'warn');
        }, 30000);
        location.href = `${location.origin}/p/${job.code}/`;   // origin = https://www.instagram.com
        return;
      }
      addLog(`Comment bai ${job.index + 1}/${job.total} (${job.code}), lan ${job.done + 1}/${job.times}...`);
      finishComment(job, await commentHere(job));
    } catch (e) {
      await failComment(job, e);
    } finally {
      if (!state.cmtPending) busy = false;
      render();
    }
  }

  /** Trang bai vua nap lai sau khi bot chuyen sang de comment: lam not. */
  async function resumeComment() {
    const p = state.cmtPending;
    if (!p) return;
    busy = true;                                   // khoa ngay: runTick khong duoc chen vao comment trung
    state.cmtPending = null;                       // xoa truoc: loi gi cung khong lap vo han
    save(state);
    try {
      const job = nextComment();
      if (!job || job.code !== p.code) return;
      if (currentCode() !== p.code) {
        await failComment(job, new Error(`Mo bai ${p.code} nhung trang lai o ${location.pathname} (chua dang nhap?)`));
        return;
      }
      await doComment(job);
    } finally {
      if (!state.cmtPending) busy = false;
      render();
    }
  }

  function finishComment(job, { cap, pool }) {
    state.cmtFails = 0;
    state.cmtInflight = null;
    state.commented[job.code] = (state.commented[job.code] || 0) + 1;
    useCaption(cap, pool);
    state.cmtPerDay[today()] = cmtToday() + 1;
    addLog(`Da comment bai ${job.index + 1}/${job.total} (${job.code}), lan ${job.done + 1}/${job.times}.`, 'ok');
    if (!nextComment()) addLog('Da comment xong list.', 'ok');
    if (state.running) scheduleNextComment();
    else { save(state); render(); }
  }

  /**
   * Comment hong. Bai tat binh luan / khong con: bo qua bai do. Bi chan: dung
   * han. Con lai thu lai sau 5 roi 10 phut; hong 3 lan lien tiep thi dung.
   * Dem lan hong luu trong state vi moi lan sang bai la trang nap lai.
   */
  async function failComment(job, e) {
    if (state.cmtInflight) {
      if (e.notPosted) state.cmtInflight = null;
      else {
        settleCmtInflight();
        addLog('Khong chac comment vua roi da len chua: tinh la da comment de khong comment trung.', 'warn');
      }
    }
    if (e.skip) {
      state.cmtSkip[job.code] = e.message.slice(0, 120);
      addLog(`${e.message}. Bo qua bai nay.`, 'warn');
      state.cmtNextAt = Date.now() + 60000;
      save(state);
      render();
      return;
    }
    addLog(`Loi comment: ${e.message}`, 'err');
    if (e.fatal) {
      state.running = false;
    } else if ((state.cmtFails = (state.cmtFails || 0) + 1) >= 3) {
      state.running = false;
      state.cmtFails = 0;
      addLog('Comment hong 3 lan lien tiep, da dung. Mo mot bai roi bam "Kiem tra trang" xem bot con thay o binh luan khong.', 'err');
    } else {
      const wait = 5 * state.cmtFails;
      state.cmtNextAt = Date.now() + wait * 60000;
      addLog(`Se thu comment lai sau ${wait} phut.`, 'warn');
    }
    save(state);
    render();
  }

  /** Den gio -> lam mot viec: comment truoc (neu den gio), roi toi bai anh. */
  function runTick() {
    if (busy || importing || !state.running || state.cmtPending) return;
    const s = state.settings;
    const now = Date.now();
    const cmt = nextComment();
    if (!cmt && !s.postEnabled) return stopRun('Da comment xong list, va khong bat "Dang bai anh moi": dung.', 'ok');
    const cmtDue = !!cmt && now >= state.cmtNextAt;
    const postDue = s.postEnabled && now >= state.nextAt;
    if (!cmtDue && !postDue) return;

    // Tab an van chay tiep (xem "chay khi tab an"); chi bao mot lan moi lan an
    if (document.hidden && !hiddenNoted) {
      addLog(keepingAlive()
        ? 'Tab Instagram dang an: van chay tiep (che do chay nen dang bat).'
        : 'Tab Instagram dang an: van chay tiep nhung co the cham. Bam vao trang Instagram mot lan de bat che do chay nen.', 'warn');
    }
    hiddenNoted = document.hidden;

    if (!inHours(new Date())) {
      const at = alignToHours(now);
      if (cmtDue) state.cmtNextAt = at;
      if (postDue) state.nextAt = at;
      if (!outsideNoted) addLog(`Ngoai khung gio chay, viec ke tiep luc ${new Date(at).toLocaleTimeString('vi-VN')}.`);
      outsideNoted = true;
      save(state);
      return;
    }
    outsideNoted = false;

    if (cmtDue) {
      if (s.cmtMaxPerDay > 0 && cmtToday() >= s.cmtMaxPerDay) {
        state.cmtNextAt = tomorrow();
        addLog(`Da du ${s.cmtMaxPerDay} comment hom nay, nghi comment den mai.`, 'warn');
        save(state);
      } else {
        doComment(cmt);
        return;
      }
    }
    if (postDue) {
      if (s.maxPerDay > 0 && countToday() >= s.maxPerDay) {
        state.nextAt = tomorrow();
        addLog(`Da du ${s.maxPerDay} bai anh hom nay, nghi dang anh den mai.`, 'warn');
        save(state);
        return;
      }
      doJob();
    }
  }

  // ---------------------------------------------------------------- kiem tra trang

  /**
   * Ghi ra nhat ky bot nhin thay gi tren trang dang mo. Instagram doi giao dien
   * thi bam nut nay o tung buoc tao bai — dong "Nut trong hop" va "Icon tren
   * trang" la ten that cua cac nut.
   */
  function diagnose() {
    const yes = (v) => (v ? 'co' : 'KHONG');
    addLog(`Kiem tra: dang o ${location.pathname} · tab ${document.hidden ? 'AN' : 'hien'} · cua so rong ${innerWidth}px` +
      ` · che do chay nen: ${keepingAlive() ? 'bat' : 'chua bat'}`);
    addLog(`Nut Tao: ${yes(createButton())} · thu muc anh: ${state.folder?.keys?.length ? `${state.folder.keys.length} anh` : 'CHUA CHON'}` +
      ` · kho cau khen: ${contentData.length} cau`,
      createButton() ? 'ok' : 'warn');
    const d = createScope();
    if (d) {
      const r = previewRect(d);
      addLog(`Hop tao bai dang mo · o chon anh: ${yes(fileInput())} · nut chon ti le: ${yes(buttonsByLabel(d, RE.crop)[0])} · ` +
        `nut Tiep: ${yes(nextButton())} · o caption: ${yes(captionBox())} · nut Chia se: ${yes(shareButton())} · ` +
        `anh de tag: ${r ? `${Math.round(r.width)}x${Math.round(r.height)}` : 'KHONG'}`, 'ok');
      const btns = [...new Set([...d.querySelectorAll(CLICKABLE)]
        .map((b) => textOf(b) || b.getAttribute('aria-label') || '').filter(Boolean))].slice(0, 20);
      addLog(`Nut trong hop: ${btns.join(' | ') || '(khong co)'}`);
    } else if (currentCode()) {
      const box = commentBox();
      const btn = box?.closest('form') ? findByText(box.closest('form'), RE.postComment)[0] : null;
      addLog(`Trang bai ${currentCode()} · o binh luan: ${box ? `co (${box.tagName.toLowerCase()}, "${box.getAttribute('aria-label') || box.getAttribute('placeholder') || ''}")` : 'KHONG'}` +
        ` · nut Dang comment: ${yes(btn)}`, box ? 'ok' : 'warn');
    } else {
      addLog('Chua mo hop tao bai. Tu bam Tao -> Bai viet, chon mot anh roi bam "Kiem tra trang" o tung buoc (cat anh, bo loc, caption). Kiem phan comment: mo mot bai roi bam lai.');
    }
    const icons = [...new Set([...document.querySelectorAll('svg[aria-label]')]
      .map((s) => s.getAttribute('aria-label').trim()).filter(Boolean))].slice(0, 30);
    addLog(`Icon tren trang: ${icons.join(' | ') || '(khong co)'}`);
  }

  // ---------------------------------------------------------------- giao dien

  // Nen sang, chu dam. Mau chu dat ro cho TUNG loai phan tu (va !important) de
  // CSS cua Instagram (nhat la che do toi) khong de len lam chu chim vao nen.
  const PANEL_CSS = `
        #iap-panel{position:fixed;right:16px;bottom:16px;width:360px;z-index:2147483647;
          background:#ffffff!important;color:#111111!important;border:1px solid #c8c8c8;border-radius:14px;
          font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
          box-shadow:0 8px 28px rgba(0,0,0,.25);color-scheme:light}
        #iap-panel *{box-sizing:border-box;color:#111111!important;opacity:1}
        #iap-panel.iap-ghosted{pointer-events:none;opacity:.3}
        #iap-panel header{display:flex;align-items:center;justify-content:space-between;
          padding:12px 14px;border-bottom:1px solid #e0e0e0;cursor:pointer;background:#fafafa;border-radius:14px 14px 0 0}
        #iap-panel h3{margin:0;font-size:15px;font-weight:700}
        #iap-body{padding:14px;display:block;max-height:calc(100vh - 90px);overflow:auto;background:#ffffff}
        #iap-panel.collapsed #iap-body{display:none}
        #iap-panel textarea{width:100%;height:110px;background:#ffffff!important;
          border:1px solid #b0b0b0;border-radius:8px;padding:10px;
          font:13px/1.5 'Consolas','Menlo','Courier New',monospace;resize:vertical}
        #iap-panel textarea.iap-small{height:52px}
        #iap-panel textarea::placeholder{color:#8a8a8a!important}
        #iap-panel .iap-hint,#iap-panel .iap-hint *{font-size:12px;margin-top:6px;color:#444444!important}
        #iap-panel input[type=number],#iap-panel select{width:56px;background:#ffffff!important;border:1px solid #b0b0b0;
          border-radius:6px;padding:6px 8px;font-size:13px;font-family:inherit}
        #iap-panel select{width:auto}
        #iap-panel input[type=checkbox]{accent-color:#0095f6;width:16px;height:16px;vertical-align:middle;margin:0 4px 0 0}
        #iap-panel button{border:0;border-radius:999px;padding:8px 14px;font-weight:700;
          cursor:pointer;font-size:13px;font-family:inherit}
        #iap-panel .iap-go{background:linear-gradient(45deg,#f9a825,#e1306c,#833ab4);color:#ffffff!important}
        #iap-panel .iap-stop{background:#ed4956;color:#ffffff!important}
        #iap-panel .iap-ghost{background:#efefef;border:1px solid #d0d0d0}
        #iap-panel .iap-ghost:hover{background:#e2e2e2}
        #iap-status{padding:10px;background:#f2f4f7;border:1px solid #e0e0e0;border-radius:8px;margin:10px 0;font-size:13px;line-height:1.6}
        #iap-log{max-height:160px;overflow:auto;font:12px/1.6 'Consolas','Menlo','Courier New',monospace;
          background:#f7f7f7;border:1px solid #e0e0e0;border-radius:8px;padding:10px;margin-top:8px}
        #iap-credit{margin-top:12px;padding-top:10px;border-top:1px solid #e0e0e0;font-size:12px;text-align:center}
        #iap-panel #iap-credit,#iap-panel #iap-credit a{color:#666666!important;text-decoration:none}
        #iap-panel .iap-ok,#iap-panel .iap-on{color:#0a7d33!important}
        #iap-panel .iap-err{color:#c62828!important}
        #iap-panel .iap-warn{color:#9a5b00!important}
        #iap-panel .iap-dim,#iap-panel .iap-dim2{color:#666666!important;font-weight:400}
        .iap-row{display:flex;gap:8px;align-items:center;margin:10px 0;flex-wrap:wrap}
        .iap-row label{font-size:13px}
        .iap-sec{font-weight:700;margin-top:16px;padding-top:10px;border-top:1px solid #eeeeee;font-size:14px}
        .iap-sec:first-child{margin-top:0;padding-top:0;border-top:0}
        #iap-panel details>summary{cursor:pointer;font-weight:700;margin-top:16px;padding-top:10px;border-top:1px solid #eeeeee}
`;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function injectStyles() {
    if ($('iap-style')) return;
    const el = document.createElement('style');
    el.id = 'iap-style';
    el.textContent = PANEL_CSS;
    document.head.appendChild(el);
  }

  function buildPanel() {
    if ($('iap-panel')) return;
    injectStyles();
    const panel = document.createElement('div');
    panel.id = 'iap-panel';
    panel.innerHTML = `
      <header id="iap-head"><h3>Instagram Auto Poster <span class="iap-dim">v${VERSION}</span></h3>
        <span id="iap-toggle" class="iap-dim2">▾</span></header>
      <div id="iap-body">
        <div class="iap-sec">Anh</div>
        <div class="iap-row"><label><input id="iap-post-on" type="checkbox"> <b>Dang bai anh moi</b> (bo chon neu chi muon comment)</label></div>
        <div class="iap-row">
          <button id="iap-pick" class="iap-ghost">Chon thu muc anh</button>
          <input id="iap-dir" type="file" webkitdirectory multiple hidden>
        </div>
        <div id="iap-folder-info" class="iap-hint"></div>
        <div class="iap-row">
          <label>Moi bai</label><input id="iap-imgmin" type="number" min="1" max="20" value="1">
          <label>den</label><input id="iap-imgmax" type="number" min="1" max="20" value="1">
          <label>anh, boc ngau nhien</label>
        </div>
        <div class="iap-row"><label><input id="iap-ratio" type="checkbox"> giu ti le anh goc (khong cat vuong)</label></div>
        <div class="iap-row"><label><input id="iap-recycle" type="checkbox"> dung het anh thi dang lai anh cu (bo chon: het anh thi dung)</label></div>

        <div class="iap-sec">Cau khen (caption)</div>
        <div class="iap-row">
          <label>Nguon</label>
          <select id="iap-src">
            <option value="builtin">Kho co san (cau khen LenaMiu)</option>
            <option value="own">Cau cua minh</option>
            <option value="both">Ca hai</option>
          </select>
        </div>
        <div id="iap-own-box">
          <div class="iap-hint">Cau cua minh — cach nhau bang mot dong trong; cau co dong trong ben trong thi tach bang dong --- .</div>
          <textarea id="iap-captions" placeholder="Cau khen thu nhat 💗

Cau khen thu hai"></textarea>
        </div>
        <div class="iap-hint">Moi bai boc ngau nhien 1 cau chua dung, dung het moi quay vong. Them vao cuoi moi caption (hashtag, @ten...):</div>
        <textarea id="iap-suffix" class="iap-small" placeholder="#LenaMiu #ลีน่าหมิว"></textarea>
        <div id="iap-caption-info" class="iap-hint"></div>

        <div class="iap-sec">Tag nguoi tren anh</div>
        <div class="iap-hint">Ten tai khoan, cach nhau bang dau cach hoac xuong dong. Tag len anh dau tien, toi da ${MAX_TAGS} nguoi.</div>
        <textarea id="iap-tags" class="iap-small" placeholder="ten_tai_khoan_1 ten_tai_khoan_2"></textarea>
        <div id="iap-tags-info" class="iap-hint"></div>

        <div class="iap-sec">Nhip dang bai anh</div>
        <div class="iap-row">
          <label>Cach nhau</label><input id="iap-gapmin" type="number" min="1" value="60">
          <label>den</label><input id="iap-gapmax" type="number" min="1" value="180"> <label>phut</label>
        </div>
        <div class="iap-row">
          <label>Toi da</label><input id="iap-max" type="number" min="0" value="5"> <label>bai/ngay</label>
        </div>

        <div class="iap-sec">Comment khen vao bai khac</div>
        <div class="iap-hint">Moi dong mot link bai Instagram. Cong cu vao tung bai (tu tren xuong), comment 1 cau khen ngau nhien chua dung (cung nguon voi caption). Bai da comment du so lan thi khong lam lai.</div>
        <textarea id="iap-cmt-list" placeholder="https://www.instagram.com/p/ABC123xyz/
https://www.instagram.com/reel/DEF456uvw/"></textarea>
        <div id="iap-cmt-info" class="iap-hint"></div>
        <div class="iap-row">
          <label>Moi bai comment</label><input id="iap-cmt-times" type="number" min="1" max="10" value="1"> <label>lan</label>
        </div>
        <div class="iap-hint">Them vao cuoi moi comment (hashtag, @ten...):</div>
        <textarea id="iap-cmt-suffix" class="iap-small" placeholder="#LenaMiu #ลีน่าหมิว"></textarea>
        <div class="iap-row">
          <label>Comment cach nhau</label><input id="iap-cmt-gapmin" type="number" min="1" value="5">
          <label>den</label><input id="iap-cmt-gapmax" type="number" min="1" value="15"> <label>phut</label>
        </div>
        <div class="iap-row">
          <label>Toi da</label><input id="iap-cmt-max" type="number" min="0" value="20"> <label>comment/ngay</label>
        </div>

        <div class="iap-sec">Chung</div>
        <div class="iap-row">
          <label>Chi chay tu</label><input id="iap-hfrom" type="number" min="0" max="23" value="8">
          <label>den</label><input id="iap-hto" type="number" min="0" max="24" value="23"> <label>gio</label>
        </div>
        <div class="iap-row"><label><input id="iap-natural" type="checkbox"> nhip tu nhien (tap trung quanh giua khoang)</label></div>
        <div class="iap-row"><label><input id="iap-slow" type="checkbox"> may cham (gian moi nhip cho ra gap 3)</label></div>

        <div id="iap-status">—</div>
        <div class="iap-row">
          <button id="iap-start" class="iap-go">Bat dau</button>
          <button id="iap-stop" class="iap-stop">Dung</button>
        </div>
        <div class="iap-row">
          <button id="iap-now" class="iap-ghost">Dang thu 1 bai</button>
          <button id="iap-cmt-now" class="iap-ghost">Comment thu 1 lan</button>
        </div>
        <div class="iap-row">
          <button id="iap-check" class="iap-ghost">Kiem tra trang</button>
          <button id="iap-reset" class="iap-ghost">Xoa lich su</button>
        </div>
        <div id="iap-log"></div>
        <div id="iap-credit">Lam boi <a href="${REPO}" target="_blank" rel="noopener">${AUTHOR}</a></div>
      </div>`;
    document.body.appendChild(panel);

    $('iap-head').onclick = () => {
      panel.classList.toggle('collapsed');
      $('iap-toggle').textContent = panel.classList.contains('collapsed') ? '▸' : '▾';
    };

    $('iap-pick').onclick = () => {
      if (busy || importing) return addLog('Dang ban, doi chut roi chon thu muc.', 'warn');
      $('iap-dir').click();
    };
    $('iap-dir').addEventListener('change', () => {
      const list = [...$('iap-dir').files];
      $('iap-dir').value = '';
      if (!list.length) return;
      importFolder(list).catch((e) => { importing = false; addLog(`Loi khi nap anh: ${e.message}`, 'err'); render(); });
    });

    $('iap-start').onclick = () => {
      keepAlive(true, true);                       // bat am trong luc bam (trinh duyet chi cho luc nay)
      syncFromUI();
      const s = state.settings;
      const cmt = nextComment();
      if (s.postEnabled && !state.folder?.keys?.length) {
        return addLog('Chua chon thu muc anh. Bam "Chon thu muc anh", hoac bo chon "Dang bai anh moi" neu chi muon comment.', 'warn');
      }
      if (!s.postEnabled && !cmt) return addLog('Khong co viec gi: khong dang bai anh, va list comment trong hoac da xong.', 'warn');
      state.running = true;
      state.nextAt = Date.now() + 3000;
      state.cmtNextAt = Date.now() + 3000;
      state.cmtFails = 0;
      consecutiveFails = 0;
      save(state);
      addLog(`Bat dau: ${[s.postEnabled && 'dang bai anh', cmt && 'comment theo list'].filter(Boolean).join(' + ')}.`, 'ok');
      render();
    };

    $('iap-stop').onclick = () => {
      state.running = false;
      state.cmtPending = null;
      save(state);
      addLog(busy ? 'Da dung. Viec dang lam do van chay not cho xong.' : 'Da dung.', 'warn');
      render();
    };

    $('iap-now').onclick = () => {
      if (busy || importing) return addLog('Dang ban, doi chut roi bam lai.', 'warn');
      keepAlive(true, true);
      syncFromUI();
      addLog('Dang thu 1 bai ngay (khong tinh lich).');
      doJob();
    };

    $('iap-cmt-now').onclick = () => {
      if (busy || importing) return addLog('Dang ban, doi chut roi bam lai.', 'warn');
      syncFromUI();
      const job = nextComment();
      if (!job) return addLog('Khong con bai nao can comment trong list.', 'warn');
      keepAlive(true, true);
      addLog('Comment thu 1 lan ngay (khong tinh lich).');
      doComment(job);
    };

    $('iap-check').onclick = () => diagnose();

    $('iap-reset').onclick = () => {
      if (!confirm('Xoa lich su? Anh, cau khen va bai da comment se duoc coi la chua lam.')) return;
      state.used = {};
      state.usedCaptions = {};
      state.perDay = {};
      state.commented = {};
      state.cmtSkip = {};
      state.cmtPerDay = {};
      save(state);
      addLog('Da xoa lich su.', 'warn');
      render();
    };

    for (const id of ['iap-post-on', 'iap-imgmin', 'iap-imgmax', 'iap-ratio', 'iap-recycle', 'iap-src', 'iap-captions', 'iap-suffix', 'iap-tags',
                      'iap-cmt-list', 'iap-cmt-times', 'iap-cmt-suffix', 'iap-cmt-gapmin', 'iap-cmt-gapmax', 'iap-cmt-max',
                      'iap-gapmin', 'iap-gapmax', 'iap-max', 'iap-hfrom', 'iap-hto', 'iap-natural', 'iap-slow']) {
      $(id).addEventListener('change', syncFromUI);
      $(id).addEventListener('input', syncFromUI);
    }
  }

  function syncFromUI() {
    const s = state.settings;
    // Chi doc, khong ep so luc dang go: o dang "" ma bi ep ve mac dinh se nhay so
    const num = (id, def) => {
      const raw = $(id).value.trim();
      return raw === '' ? def : Math.max(0, +raw || def);
    };
    s.postEnabled = $('iap-post-on').checked;
    s.cmtList = $('iap-cmt-list').value;
    s.cmtTimes = Math.min(10, Math.max(1, num('iap-cmt-times', 1)));
    s.cmtSuffix = $('iap-cmt-suffix').value;
    s.cmtGapMin = num('iap-cmt-gapmin', 5);
    s.cmtGapMax = num('iap-cmt-gapmax', 15);
    s.cmtMaxPerDay = num('iap-cmt-max', 20);
    s.imgMin = Math.min(MAX_IMAGES, Math.max(1, num('iap-imgmin', 1)));
    s.imgMax = Math.min(MAX_IMAGES, Math.max(1, num('iap-imgmax', 1)));
    s.keepRatio = $('iap-ratio').checked;
    s.recycle = $('iap-recycle').checked;
    s.captionSource = $('iap-src').value;
    s.captions = $('iap-captions').value;
    s.suffix = $('iap-suffix').value;
    s.tags = $('iap-tags').value;
    s.gapMin = num('iap-gapmin', 60);
    s.gapMax = num('iap-gapmax', 180);
    s.maxPerDay = num('iap-max', 5);
    s.hourFrom = Math.min(23, num('iap-hfrom', 0));
    s.hourTo = Math.min(24, num('iap-hto', 24));
    s.naturalPace = $('iap-natural').checked;
    s.slowMode = $('iap-slow').checked;
    save(state);
    render();
  }

  function renderFolderInfo() {
    const el = $('iap-folder-info');
    if (!el || importing) return;
    const keys = state.folder?.keys || [];
    if (!keys.length) { el.innerHTML = '<span class="iap-warn">chua chon thu muc anh</span>'; return; }
    const used = keys.filter((k) => state.used[k]).length;
    el.innerHTML = `Thu muc <b>${esc(state.folder.name)}</b>: ${keys.length} anh · da dang ${used} · con ${keys.length - used}` +
      (used < keys.length ? '' : state.settings.recycle
        ? ' · <span class="iap-warn">het, se quay vong</span>' : ' · <span class="iap-err">het anh</span>');
  }

  /** Dem cau khen theo nguon: co bao nhieu, da dung bao nhieu, cau nao qua dai. Khong dung captionPool cho nhe (kho 20.000 cau, ve moi giay). */
  function renderCaptionInfo() {
    const el = $('iap-caption-info');
    if (!el) return;
    const s = state.settings;
    const parts = [];
    const bad = [];
    if (s.captionSource !== 'own') {
      const used = Object.keys(state.usedCaptions).filter((k) => k.startsWith('b:')).length;
      parts.push(contentData.length ? `Kho ${contentData.length} cau, da dung ${used}`
        : '<span class="iap-err">chua nap duoc kho cau khen</span>');
      if (bankLongest) bad.push(...captionProblems(buildCaption(bankLongest, s.suffix)).map((p) => `cau dai nhat trong kho + phan cuoi: ${p}`));
    }
    if (s.captionSource !== 'builtin') {
      const list = parsePosts(s.captions);
      const used = list.filter((t) => state.usedCaptions[`o:${postKey(t)}`]).length;
      parts.push(list.length ? `${list.length} cau cua minh, da dung ${used}` : '<span class="iap-warn">chua co cau cua minh</span>');
      list.forEach((t, i) => {
        const p = captionProblems(buildCaption(t, s.suffix));
        if (p.length) bad.push(`cau ${i + 1}: ${p.join(', ')}`);
      });
    }
    el.innerHTML = parts.join(' · ') + (bad.length ? ` · <span class="iap-err">${esc(bad.join('; '))}</span>` : '');
  }

  function renderTagsInfo() {
    const el = $('iap-tags-info');
    if (!el) return;
    const { users, bad } = parseTags(state.settings.tags);
    el.innerHTML = (users.length
      ? `Tag ${Math.min(users.length, MAX_TAGS)} nguoi: ${users.slice(0, MAX_TAGS).map((u) => `@${u}`).join(' ')}`
      : '<span class="iap-dim2">khong tag ai</span>') +
      (users.length > MAX_TAGS ? ` · <span class="iap-warn">qua ${MAX_TAGS} nguoi, bo ${users.length - MAX_TAGS} ten cuoi</span>` : '') +
      (bad.length ? ` · <span class="iap-err">ten sai: ${esc(bad.join(' '))}</span>` : '');
  }

  function renderLog() {
    const box = $('iap-log');
    if (!box) return;
    box.innerHTML = state.log
      .slice(-30)
      .reverse()
      .map((l) => {
        const t = new Date(l.at).toLocaleTimeString('vi-VN', { hour12: false });
        const cls = l.kind === 'ok' ? 'iap-ok' : l.kind === 'err' ? 'iap-err' : l.kind === 'warn' ? 'iap-warn' : '';
        return `<div class="${cls}">${t} ${esc(l.msg)}</div>`;
      })
      .join('');
  }

  /** Dat gia tri cho o nhap, TRU KHI nguoi dung dang go vao no. */
  function setVal(id, value) {
    const el = $(id);
    if (!el || document.activeElement === el) return;
    if (el.type === 'checkbox') el.checked = value;
    else if (el.value !== String(value)) el.value = value;
  }

  /** "2:18" khi con duoi mot gio, gio dong ho ("14:05") khi con lau hon. */
  function whenText(at) {
    const left = Math.max(0, at - Date.now());
    if (left >= 3600000) return `luc ${new Date(at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    return `sau ${mm}:${String(ss).padStart(2, '0')}`;
  }

  function render() {
    if (!$('iap-status')) return;
    const keys = state.folder?.keys || [];
    const used = keys.filter((k) => state.used[k]).length;
    const s = state.settings;
    const counts = `anh da dang <b>${used}/${keys.length}</b> · hom nay <b>${countToday()}</b> bai anh, <b>${cmtToday()}</b> comment`;
    const next = [s.postEnabled && `bai anh <b>${whenText(state.nextAt)}</b>`,
      nextComment() && `comment <b>${whenText(state.cmtNextAt)}</b>`].filter(Boolean).join(' · ');
    $('iap-status').innerHTML = busy ? `<b class="iap-on">● Dang lam...</b> dung dung chuot vao tab nay<br>${counts}`
      : importing ? `<b class="iap-warn">Dang nap anh...</b><br>${counts}`
      : state.running
        ? `<b class="iap-on">● Dang chay</b> — ke tiep: ${next || '-'}<br>${counts}` +
          (keepingAlive() ? '<br><span class="iap-dim2">🔈 che do chay nen dang bat: an tab van chay</span>'
            : '<br><span class="iap-warn">Che do chay nen chua bat: bam vao trang Instagram mot lan (an tab se chay cham)</span>')
        : `<b class="iap-dim2">○ Dang dung</b> — ${counts}`;

    setVal('iap-post-on', s.postEnabled);
    setVal('iap-cmt-list', s.cmtList);
    setVal('iap-cmt-times', s.cmtTimes);
    setVal('iap-cmt-suffix', s.cmtSuffix);
    setVal('iap-cmt-gapmin', s.cmtGapMin);
    setVal('iap-cmt-gapmax', s.cmtGapMax);
    setVal('iap-cmt-max', s.cmtMaxPerDay);
    setVal('iap-imgmin', s.imgMin);
    setVal('iap-imgmax', s.imgMax);
    setVal('iap-ratio', s.keepRatio);
    setVal('iap-recycle', s.recycle);
    setVal('iap-src', s.captionSource);
    $('iap-own-box').style.display = s.captionSource === 'builtin' ? 'none' : '';
    setVal('iap-captions', s.captions);
    setVal('iap-suffix', s.suffix);
    setVal('iap-tags', s.tags);
    setVal('iap-gapmin', s.gapMin);
    setVal('iap-gapmax', s.gapMax);
    setVal('iap-max', s.maxPerDay);
    setVal('iap-hfrom', s.hourFrom);
    setVal('iap-hto', s.hourTo);
    setVal('iap-natural', s.naturalPace);
    setVal('iap-slow', s.slowMode);
    renderFolderInfo();
    renderCaptionInfo();
    renderTagsInfo();
    renderCmtInfo();
    renderLog();
  }

  /** Dem list comment: bao nhieu bai, xong bao nhieu, bai bo qua, dong khong phai link. */
  function renderCmtInfo() {
    const el = $('iap-cmt-info');
    if (!el) return;
    const s = state.settings;
    const { codes, bad } = parsePostLinks(s.cmtList);
    const badHtml = bad.length ? ` · <span class="iap-err">khong phai link bai: ${esc(bad.slice(0, 3).join(' '))}${bad.length > 3 ? '...' : ''}</span>` : '';
    if (!codes.length) { el.innerHTML = `<span class="iap-dim2">chua co bai nao</span>${badHtml}`; return; }
    const times = Math.max(1, Math.floor(s.cmtTimes) || 1);
    const live = codes.filter((c) => !state.cmtSkip[c]);
    const done = live.reduce((n, c) => n + Math.min(times, state.commented[c] || 0), 0);
    const next = nextComment();
    el.innerHTML = `${codes.length} bai × ${times} lan · xong ${done}/${live.length * times}` +
      (next ? ` · ke tiep: bai ${next.index + 1}` : ' · <span class="iap-ok">da xong list</span>') +
      (live.length < codes.length ? ` · <span class="iap-warn">bo qua ${codes.length - live.length} bai (tat binh luan / khong con)</span>` : '') +
      badHtml;
  }

  // ---------------------------------------------------------------- khoi dong

  async function boot() {
    // Cho Instagram dung xong khung trang
    await until(() => document.body && document.querySelector('main, [role="main"], nav'), 15000, 300);
    await sleep(800);
    buildPanel();
    render();

    if (state.inflight) {
      settleInflight();
      save(state);
      addLog('Trang nap lai ngay luc dang chia se: coi anh va cau khen bai do la da dung de khong dang trung. Xem trang ca nhan de chac bai da len.', 'warn');
    }
    if (state.cmtInflight) {
      settleCmtInflight();
      save(state);
      addLog('Trang nap lai ngay luc dang comment: tinh la da comment bai do de khong comment trung.', 'warn');
    }
    await loadBank();
    render();

    // Trang moi nap (vd bot sang bai de comment) chua duoc bat am: bat o lan bam chuot ke tiep
    const wake = () => { if (state.running || busy) keepAlive(true, true); };
    for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, wake, true);

    setInterval(() => {
      if (!busy && !importing) state = load();     // dang lam viec thi giu state trong bo nho
      if (!$('iap-panel')) buildPanel();
      syncBackgroundMode();
      runTick();
      render();
    }, 1000);

    await resumeComment();                          // trang nay do bot mo ra de comment thi lam not
  }

  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();
