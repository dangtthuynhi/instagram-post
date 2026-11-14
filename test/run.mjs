// Kiem tra phan boc anh, caption, tag va hen gio cua extension Instagram, chay
// bang Node thuan (khong can trinh duyet). Ham lay nguyen van tu
// extension/content.js.
//
//   node test/run.mjs
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'extension', 'content.js');
const src = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

function grabFn(name) {
  const start = src.findIndex((l) => new RegExp(`^  (async )?function ${name}\\(`).test(l));
  if (start < 0) throw new Error(`khong thay function ${name}`);
  const end = src.findIndex((l, i) => i > start && l === '  }');
  return src.slice(start, end + 1).join('\n');
}

function grabConst(name) {
  const start = src.findIndex((l) => new RegExp(`^  const ${name} =( |$)`).test(l));
  if (start < 0) throw new Error(`khong thay const ${name}`);
  if (src[start].trimEnd().endsWith('{')) {
    const end = src.findIndex((l, i) => i > start && l === '  };');
    return src.slice(start, end + 1).join('\n');
  }
  let end = start;
  while (!src[end].replace(/\s+\/\/ .*$/, '').trimEnd().endsWith(';')) end++;
  return src.slice(start, end + 1).join('\n');
}

let pass = 0, fail = 0;
const check = (name, ok, got) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got: ${JSON.stringify(got)}`); }
};

function load(settings = {}, contentData = []) {
  const state = { used: {}, usedCaptions: {}, perDay: {}, nextAt: 0, commented: {}, cmtSkip: {}, settings: {
    gapMin: 60, gapMax: 180, maxPerDay: 5, hourFrom: 8, hourTo: 23, naturalPace: true,
    captionSource: 'builtin', captions: '', cmtList: '', cmtTimes: 1, ...settings } };
  const code = [
    grabConst('MAX_CAPTION'), grabConst('MAX_HASHTAGS'), grabConst('MAX_IMAGES'),
    grabFn('parsePosts'), grabFn('parseTags'), grabFn('buildCaption'), grabFn('captionProblems'),
    grabFn('postKey'), grabFn('captionPool'), grabFn('pickCaption'), grabFn('pickImages'),
    grabFn('parsePostLinks'), grabFn('nextComment'), grabFn('tagSpot'), grabFn('imageKind'),
    grabFn('gaussian'), grabConst('inHours'), grabFn('alignToHours'), grabFn('nextDelay'), grabFn('scheduleNext'),
    'return { parsePosts, parseTags, buildCaption, captionProblems, postKey, captionPool, pickCaption, pickImages, parsePostLinks, nextComment, tagSpot, imageKind, inHours, alignToHours, nextDelay, scheduleNext };',
  ].join('\n');
  const fns = new Function('state', 'contentData', 'save', 'render', code)(state, contentData, () => {}, () => {});
  return { state, ...fns };
}

const t = load();
const keys = (n) => Array.from({ length: n }, (_, i) => `anh${i + 1}.jpg|${1000 + i}`);

// --- 1. boc anh ngau nhien, khong lap lai --------------------------------------
console.log('\n1. Boc anh');
{
  const all = keys(10);
  const used = {};
  const seen = [];
  for (let p = t.pickImages(all, used, 1, 1, false); p; p = t.pickImages(all, used, 1, 1, false)) {
    seen.push(...p.keys);
    for (const k of p.keys) used[k] = 1;
  }
  check('moi bai 1 anh: dung du 10 anh, khong anh nao lap, het thi null',
    seen.length === 10 && new Set(seen).size === 10, seen);

  const used2 = Object.fromEntries(all.slice(0, 7).map((k) => [k, 1]));
  const p = t.pickImages(all, used2, 2, 2, false);
  check('chi boc anh chua dang', p.keys.length === 2 && p.keys.every((k) => !used2[k]) && new Set(p.keys).size === 2, p);
  const few = t.pickImages(all, { ...used2, [all[7]]: 1, [all[8]]: 1 }, 3, 3, false);
  check('con 1 anh ma can 3: lay 1 anh con lai', few.keys.length === 1 && few.keys[0] === all[9], few);
  const fill = t.pickImages(all, { ...used2, [all[7]]: 1, [all[8]]: 1 }, 3, 3, true);
  check('cho dang lai anh cu: con 1 anh ma can 3 -> lay anh do + 2 anh cu cho du',
    fill.keys.length === 3 && fill.keys.includes(all[9]) && new Set(fill.keys).size === 3 && !fill.recycled, fill);
  check('thu muc chi co 2 anh ma can 3 -> 2 anh, khong lap', t.pickImages(keys(2), {}, 3, 3, true).keys.length === 2, null);

  const allUsed = Object.fromEntries(all.map((k) => [k, 1]));
  check('het anh, khong quay vong -> null', t.pickImages(all, allUsed, 1, 1, false) === null, null);
  const again = t.pickImages(all, allUsed, 2, 2, true);
  check('het anh, quay vong -> boc lai, bao recycled', again.recycled === true && again.keys.length === 2, again);
  check('thu muc rong -> null ca khi quay vong', t.pickImages([], {}, 1, 1, true) === null, null);

  const sizes = new Set();
  for (let i = 0; i < 300; i++) sizes.add(t.pickImages(keys(30), {}, 1, 3, false).keys.length);
  check('1-3 anh/bai: ra du 1, 2, 3 va khong ngoai khoang', [...sizes].sort().join() === '1,2,3', [...sizes]);
  check('min > max thi doi cho', t.pickImages(keys(30), {}, 3, 1, false).keys.length <= 3, null);
  check('toi da 20 anh/bai', t.pickImages(keys(50), {}, 50, 50, false).keys.length === 20, null);
  check('so le / 0 -> 1 anh', t.pickImages(keys(5), {}, 0, 0.5, false).keys.length === 1, null);

  const first = {};
  for (let i = 0; i < 2000; i++) {
    const k = t.pickImages(keys(5), {}, 1, 1, false).keys[0];
    first[k] = (first[k] || 0) + 1;
  }
  check('ngau nhien deu: 5 anh, moi anh duoc boc 300-500/2000 lan',
    Object.values(first).length === 5 && Object.values(first).every((n) => n > 300 && n < 500), first);
}

// --- 2. caption --------------------------------------------------------------------
console.log('\n2. Caption');
{
  check('tach caption theo dong trong, bo trung',
    JSON.stringify(t.parsePosts('A 💗\ndong 2\n\nB\n\nA 💗\ndong 2')) === JSON.stringify(['A 💗\ndong 2', 'B']), null);
  check('them phan cuoi sau mot dong trong', t.buildCaption('Cap', '#a #b') === 'Cap\n\n#a #b', t.buildCaption('Cap', '#a #b'));
  check('khong caption: chi con phan cuoi', t.buildCaption('', ' #a ') === '#a', t.buildCaption('', ' #a '));
  check('khong phan cuoi: giu caption', t.buildCaption('Cap', '') === 'Cap', null);

  // Nguon cau khen
  const bank = ['khen 1', 'khen 2', 'khen 3'];
  const b = load({ captionSource: 'builtin', captions: 'cua minh A\n\ncua minh B' }, bank);
  check('nguon kho co san: chi lay cau trong kho, khoa b:<vi tri>',
    b.captionPool().map((c) => `${c.key}=${c.text}`).join('|') === 'b:0=khen 1|b:1=khen 2|b:2=khen 3', b.captionPool());
  const o = load({ captionSource: 'own', captions: 'cua minh A\n\ncua minh B' }, bank);
  check('nguon cau cua minh: chi lay cau cua minh, khoa theo chu',
    o.captionPool().map((c) => c.text).join('|') === 'cua minh A|cua minh B' && o.captionPool().every((c) => c.key.startsWith('o:')),
    o.captionPool());
  const both = load({ captionSource: 'both', captions: 'cua minh A' }, bank);
  check('ca hai: 3 cau kho + 1 cau cua minh', both.captionPool().length === 4, both.captionPool());
  check('kho chua nap + nguon kho -> khong co cau nao', load({}, []).captionPool().length === 0, null);
  check('khoa cau cua minh khong doi khi chen cau khac vao truoc',
    load({ captionSource: 'own', captions: 'Moi\n\ncua minh A' }).captionPool()[1].key === o.captionPool()[0].key, null);

  // Boc ngau nhien, khong lap
  check('pool rong -> null', t.pickCaption([], {}, '') === null, null);
  const pool = Array.from({ length: 50 }, (_, i) => ({ key: `b:${i}`, text: `cau ${i}` }));
  const usedCap = {};
  const got = [];
  for (let i = 0; i < 50; i++) {
    const c = t.pickCaption(pool, usedCap, '');
    got.push(c.key);
    usedCap[c.key] = 1;
    if (c.recycled) break;
  }
  check('50 cau: boc du 50 cau khac nhau, khong lap', new Set(got).size === 50, got.length);
  const again = t.pickCaption(pool, usedCap, 'b:7');
  check('dung het -> quay vong (recycled), khong boc lai cau vua dang', again.recycled && again.key !== 'b:7', again);
  let same = 0;
  const two = [{ key: 'b:0', text: 'A' }, { key: 'b:1', text: 'B' }];
  for (let i = 0; i < 200; i++) if (t.pickCaption(two, { 'b:0': 1, 'b:1': 1 }, 'b:1').key === 'b:1') same++;
  check('quay vong khong lap cau vua dang khi con cau khac', same === 0, same);
  check('mot cau duy nhat: dung lai cau do', t.pickCaption([two[0]], { 'b:0': 1 }, 'b:0').key === 'b:0', null);
  const firstPick = {};
  for (let i = 0; i < 3000; i++) {
    const k = t.pickCaption(pool.slice(0, 3), {}, '').key;
    firstPick[k] = (firstPick[k] || 0) + 1;
  }
  check('ngau nhien deu: 3 cau, moi cau 850-1150/3000 lan',
    Object.values(firstPick).length === 3 && Object.values(firstPick).every((n) => n > 850 && n < 1150), firstPick);

  check('caption binh thuong: khong loi', t.captionProblems('Xin chao #a #b 💗').length === 0, null);
  check('qua 2200 ky tu: bao loi', t.captionProblems('x'.repeat(2201)).length === 1, t.captionProblems('x'.repeat(2201)));
  check('emoji tinh 1 ky tu: 2200 emoji van duoc', t.captionProblems('💗'.repeat(2200)).length === 0, null);
  const tags31 = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
  check('31 hashtag: bao loi', t.captionProblems(tags31).length === 1, t.captionProblems(tags31));
}

// --- 3. tag nguoi -------------------------------------------------------------------
console.log('\n3. Tag nguoi');
{
  const r = t.parseTags('@Ling_Ling  orm.k, abc\n@ling_ling sai-ten @');
  check('bo @, chu thuong, bo trung, cach nhau bang dau cach/phay/xuong dong',
    r.users.join(' ') === 'ling_ling orm.k abc', r);
  check('ten sai dinh dang thi bao rieng', r.bad.join(' ') === 'sai-ten', r.bad);
  check('o trong -> khong ai', t.parseTags('  \n').users.length === 0, null);
  check('1 nguoi: bam giua anh', JSON.stringify(t.tagSpot(0, 1)) === '[0.5,0.5]', t.tagSpot(0, 1));
  const spots = Array.from({ length: 7 }, (_, i) => t.tagSpot(i, 7));
  check('7 nguoi: 7 cho khac nhau, nam trong 0.2-0.8 cua anh',
    new Set(spots.map(String)).size === 7 && spots.flat().every((v) => v >= 0.2 && v <= 0.8), spots);
}

// --- 4. loai file ---------------------------------------------------------------------
console.log('\n4. Loai file');
{
  check('jpg/png/heic: dang thang', ['a.JPG', 'b.jpeg', 'c.png', 'd.heic'].every((n) => t.imageKind(n) === 'keep'), null);
  check('webp/avif/gif: doi sang jpeg', ['a.webp', 'b.AVIF', 'c.gif'].every((n) => t.imageKind(n) === 'convert'), null);
  check('khong phai anh: bo', ['a.txt', 'desktop.ini', 'Thumbs.db', 'khongduoi', 'v.mp4'].every((n) => t.imageKind(n) === null), null);
}

// --- 5. khung gio va nhip -------------------------------------------------------------
console.log('\n5. Khung gio va nhip dang');
{
  const at = (h, m = 0) => new Date(2026, 10, 14, h, m);
  check('8-23: 7h ngoai, 8h trong, 22h59 trong, 23h ngoai',
    !t.inHours(at(7)) && t.inHours(at(8)) && t.inHours(at(22, 59)) && !t.inHours(at(23)), null);
  const pushed = new Date(t.alignToHours(at(2).getTime()));
  check('2h sang bi day toi 8h', pushed.getHours() === 8, pushed.toString());

  const p = load({ hourFrom: 0, hourTo: 0, gapMin: 60, gapMax: 180 });
  let out = 0;
  for (let i = 0; i < 300; i++) {
    const before = Date.now();
    p.scheduleNext();
    const gap = (p.state.nextAt - before) / 60000;
    if (gap < 60 || gap > 180.1) out++;
  }
  check('300 lan hen: luon trong khoang 60-180 phut', out === 0, out);
  let bad = 0;
  for (let i = 0; i < 300; i++) {
    const d = t.nextDelay(5, 15, true) / 60000;
    if (d < 5 || d > 15) bad++;
  }
  check('nhip comment 5-15 phut: 300 lan deu trong khoang', bad === 0, bad);
  check('khoang dao nguoc (15-5) van dung', t.nextDelay(15, 5, false) / 60000 >= 5, null);
  check('it nhat 1 phut', t.nextDelay(0, 0, true) === 60000, t.nextDelay(0, 0, true));
}

// --- 6. comment theo list -------------------------------------------------------------
console.log('\n6. Comment theo list');
{
  const raw = [
    'https://www.instagram.com/p/AAA111aaa11/?igsh=MWx0',
    'https://www.instagram.com/lena_account/p/BBB222bbb22/',
    'https://instagram.com/reel/CCC333ccc33',
    'https://www.instagram.com/reels/DDD444ddd44/ https://www.instagram.com/tv/EEE555eee55/',
    'https://www.instagram.com/p/AAA111aaa11/',
    'AAA111aaa11 https://www.instagram.com/lena_account/ abc',
  ].join('\n');
  const r = t.parsePostLinks(raw);
  check('lay ma bai tu /p/, /ten/p/, /reel/, /reels/, /tv/; bo ?igsh; bo trung',
    r.codes.join(',') === 'AAA111aaa11,BBB222bbb22,CCC333ccc33,DDD444ddd44,EEE555eee55', r.codes);
  check('ma tran, link trang ca nhan, chu thuong: bao la khong phai link bai',
    r.bad.join(' ') === 'AAA111aaa11 https://www.instagram.com/lena_account/ abc', r.bad);

  const c = load({ cmtList: 'https://www.instagram.com/p/A1b2C3d4E5f/\nhttps://www.instagram.com/p/B1b2C3d4E5f/\nhttps://www.instagram.com/p/C1b2C3d4E5f/', cmtTimes: 2 });
  const order = [];
  for (let j = c.nextComment(); j && order.length < 20; j = c.nextComment()) {
    order.push(`${j.index + 1}:${j.done + 1}/${j.times}`);
    if (j.code === 'B1b2C3d4E5f' && !c.state.cmtSkip[j.code]) { c.state.cmtSkip[j.code] = 'tat binh luan'; continue; }
    c.state.commented[j.code] = (c.state.commented[j.code] || 0) + 1;
  }
  check('tu tren xuong, moi bai du 2 lan; bai bi bo qua thi sang bai sau; xong thi null',
    order.join(' ') === '1:1/2 1:2/2 2:1/2 3:1/2 3:2/2', order);
  c.state.settings.cmtTimes = 3;
  check('tang so lan (2 -> 3): chi lam phan con thieu', c.nextComment()?.done === 2 && c.nextComment()?.index === 0, c.nextComment());
  check('list trong -> khong co viec', load({ cmtList: '' }).nextComment() === null, null);
}

console.log(`\n==== ${pass} dat / ${fail} hong ====`);
process.exit(fail ? 1 : 0);
