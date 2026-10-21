// @ts-nocheck — KỲ NGỘ GIANG HỒ (f27): sự kiện ngẫu nhiên CÓ LỰA CHỌN xuất hiện khi đang
// luyện công ngoài bãi — cao nhân truyền công, thương nhân bí ẩn, mai phục sơn tặc...
// Hằng số cân bằng:
//   KN_WAIT_MIN/MAX = 300..540s — đếm ngược giữa 2 kỳ ngộ (chỉ chạy khi ngoài bãi, không
//     bận hoạt động khác, không mở modal — cùng khuôn goldBossTick của rewards.ts).
//   KN_DAY_MAX = 8 — tối đa 8 kỳ ngộ/ngày (khóa theo ngày local như journal/dgSave).
//   KN_RETRY = 5s — tới giờ mà đang bị chặn (bận/modal) thì thử lại sau 5s.
// Trạng thái lưu ở RW().kn = { t, day, n, total, lastId, pending } (tự khởi tạo lười như
// dgSaveState/guildState — KHÔNG sửa RW()). pending = id sự kiện đang chờ chọn: modal khóa
// (locked) không đóng được nếu chưa chọn; nạp lại game giữa chừng thì mở lại đúng sự kiện đó,
// không bao giờ chồng 2 kỳ ngộ. Thưởng chỉ đi qua hệ thống sẵn có: grant() (lượng / Phúc
// Duyên / Huyền Tinh / thuốc / điểm tiềm năng), knbGain + addTimedBuff của ktc.ts (KNB,
// buff %XP / may mắn theo phút), gainXp / heal / makeEnemy của combat.ts.
'use strict';
import { MON, STAGES, clamp, esc, fmt, inWorld, pick } from './core';
import { H, R, expFor, gainXp, heal, makeEnemy, zoneOf } from './combat';
import { RW, grant } from './rewards';
import { S, save } from './save';
import { addTimedBuff, knbGain } from './ktc';
import { localISODay } from './journal';
import { SV } from './survival';
import { closeModal, log, modal, toast } from './ui';

export const KN_WAIT_MIN = 300;        // giây chờ tối thiểu giữa 2 kỳ ngộ
export const KN_WAIT_MAX = 540;        // giây chờ tối đa
export const KN_DAY_MAX = 8;           // kỳ ngộ tối đa mỗi ngày
export const KN_RETRY = 5;             // giây thử lại khi tới giờ mà đang bị chặn

const knWait = () => KN_WAIT_MIN + Math.random() * (KN_WAIT_MAX - KN_WAIT_MIN);
const htLvl = () => clamp(Math.floor(S.lvl / 15) + 1, 1, 10);   // cấp Huyền Tinh theo cấp nhân vật (khuôn hoatdong)

/* ---------- trạng thái (RW().kn) ---------- */
export function kyngoState() {
  const r = RW(), k = r.kn = r.kn || {};
  if (k.day !== localISODay()) { k.day = localISODay(); k.n = 0; }        // qua ngày mới: reset lượt
  if (k.t == null) k.t = knWait();
  if (k.n == null) k.n = 0;
  if (k.total == null) k.total = 0;
  if (k.lastId == null) k.lastId = '';
  if (k.pending == null) k.pending = '';
  return k;
}

/* Admin / debug: kỳ ngộ tới ngay ở tick tiếp theo (vẫn tôn trọng guard). */
export function kyngoCallNow() { const k = kyngoState(); k.t = 0; save(); }

/* ---------- điều kiện chặn ---------- */
const modalOpen = () => { const m = document.querySelector('#modal'); return !!m && !m.classList.contains('hidden'); };
/* Bận = đang trong hoạt động khép kín / trong thành / đã gục — kỳ ngộ chỉ tới khi luyện công tự do. */
export const kyngoBlocked = () => !S.fac || !!R.town || !!R.dg || !!R.tower || !!R.tk || !!R.tyvo || !!R.wbArena || !!R.petRealm || !!(SV && SV.on) || R.deadT > 0;

/* ---------- kết quả dùng chung ---------- */
const skipMsg = () => 'Bạn lặng lẽ rời đi, kỳ ngộ tan vào giang hồ.';
function hurtFrac(f) { if (R.P && R.life > 1) R.life = Math.max(1, Math.round(R.life - R.P.life * f)); }
function fightSpawn(name) {           // sinh 1 tinh anh gần nhân vật (khuôn spawnGoldBoss)
  const z = zoneOf(Math.min(S.stage, STAGES));
  const tids = (z.m || []).filter(id => MON[id]);
  const tid = tids.length ? pick(tids) : z.boss;
  const [x, y] = inWorld(H.x + 200, H.y - 100);
  const e = makeEnemy(tid, clamp(S.lvl + 2, 1, 9999), 'elite', x, y);
  e.knAmbush = true; e.n = name + ' · ' + e.n;
  R.enemies.push(e);
  R.banner = { t: 2.5, text: 'Mai phục!', sub: 'Hạ địch để lấy chiến lợi phẩm' };
  return 'Địch xuất hiện ngay cạnh — quyết chiến! Tinh anh rơi đồ ngon hơn quái thường.';
}
function gamble() {                  // đặt cược 50/50: stake theo cấp, thắng gấp đôi / thua mất stake
  const stake = Math.round(200 * (1 + S.lvl / 10));
  if (S.gold < stake) return `Muốn đặt cược cần ${fmt(stake)} lượng — trong túi không đủ, đành thôi.`;
  if (Math.random() < 0.5) { S.gold += stake; return `Vận đỏ! Thắng cược +${fmt(stake)} lượng.`; }
  S.gold -= stake; return `Vận đen... thua cược −${fmt(stake)} lượng.`;
}

/* ---------- kho sự kiện (12) — mỗi lựa chọn 1 hàm run() trả câu kết quả ---------- */
export const KN_EVENTS = [
  { id: 'caonhan', icon: '🧙', title: 'Cao Nhân Truyền Công',
    desc: 'Một lão tiền bối râu bạc dừng bước ngắm thế võ của bạn, gật gù: "Tư chất không tệ. Lão phu chỉ điểm một phen, lĩnh ngộ được bao nhiêu là tùy duyên."',
    choices: [
      { label: 'Lắng nghe chỉ điểm', run: () => { addTimedBuff('xp', 30, 30); return 'Tiền bối vẽ lại đường khí: +30% kinh nghiệm trong 30 phút.'; } },
      { label: 'Thỉnh giáo tuyệt chiêu', run: () => { const x = Math.round(expFor(S.lvl) * 0.3); gainXp(x); return `Một chiêu khai sáng — nhận ${fmt(x)} kinh nghiệm.`; } },
      { label: 'Chắp tay cáo từ', run: skipMsg },
    ] },
  { id: 'thuongnhan', icon: '🧳', title: 'Thương Nhân Bí Ẩn',
    desc: 'Gã thương nhân trùm khăn kín mặt chìa ra một rương hàng "không rõ nguồn gốc", giá rẻ bất ngờ — mua hay không là ở gan của bạn.',
    choices: [
      { label: 'Mua Huyền Tinh (500 lượng)', run: () => { if (S.gold < 500) return 'Không đủ 500 lượng — gã thương nhân cười khẩy rồi biến mất.'; S.gold -= 500; grant({ mat: { g: 'ht', k: htLvl(), n: 2 } }, 'Kỳ Ngộ «Thương Nhân Bí Ẩn»'); return ''; } },
      { label: 'Đặt cược tay đôi', run: gamble },
      { label: 'Không dây vào hàng lạ', run: skipMsg },
    ] },
  { id: 'bitich', icon: '📜', title: 'Bí Tịch Thất Lạc',
    desc: 'Trong bụi cỏ lấp lánh một cuốn bí tịch rách nát, chữ còn đọc được — hẳn là của vị cao thủ nào đánh rơi khi giao chiến.',
    choices: [
      { label: 'Ngồi xuống nghiên cứu', run: () => { const x = Math.round(expFor(S.lvl) * 0.2); gainXp(x); return `Đọc một lượt đã thông mấy chỗ bế tắc bấy lâu — nhận ${fmt(x)} kinh nghiệm.`; } },
      { label: 'Ghi nhớ khẩu quyết mang về', run: () => { addTimedBuff('xp', 20, 20); return 'Khẩu quyết khắc sâu vào trí nhớ: +20% kinh nghiệm trong 20 phút.'; } },
      { label: 'Để lại cho người hữu duyên', run: skipMsg },
    ] },
  { id: 'maiphuc', icon: '🗡️', title: 'Mai Phục Sơn Tặc',
    desc: 'Tiếng huýt sáo vang lên bốn phía — sơn tặc chặn đường đòi lộ phí. Đao đã ra khỏi vỏ, lùi hay tiến chỉ trong một ý niệm.',
    choices: [
      { label: 'Quyết chiến', run: () => fightSpawn('Sơn tặc') },
      { label: 'Thương lượng danh tiếng', run: () => { grant({ fd: 3 }, 'Kỳ Ngộ «Mai Phục Sơn Tặc»'); return ''; } },
      { label: 'Nộp lộ phí 300 lượng', run: () => { if (S.gold < 300) return 'Không đủ lộ phí — sơn tặc khinh khỉnh bỏ đi tìm con mồi khác.'; S.gold -= 300; return 'Mất 300 lượng, đổi lấy yên ổn qua đường.'; } },
    ] },
  { id: 'anmay', icon: '🍶', title: 'Lão Ăn Mày Kỳ Lạ',
    desc: 'Lão ăn mày rách rưới ngồi vệ đường, mắt sáng lạ thường, bát không mà chẳng hề xin — cứ nhìn bạn cười như biết hết mọi chuyện.',
    choices: [
      { label: 'Bố thí 200 lượng', run: () => { if (S.gold < 200) return 'Trong túi chẳng còn mấy đồng — lão phất tay: "Duyên chưa tới."'; S.gold -= 200; addTimedBuff('luck', 20, 30); return 'Lão cười ha hả, vỗ vai bạn ba cái: +20 may mắn trong 30 phút. Phúc báo đấy!'; } },
      { label: 'Ngồi trò chuyện một lát', run: () => { grant({ fd: 3 }, 'Kỳ Ngộ «Lão Ăn Mày Kỳ Lạ»'); return ''; } },
      { label: 'Đi ngang qua', run: skipMsg },
    ] },
  { id: 'ruongco', icon: '🧰', title: 'Rương Cổ Bên Đường',
    desc: 'Một chiếc rương đồng xanh rêu trồi lên sau cơn mưa, khóa đã mục — bên trong là của ai, giờ là của người thấy trước.',
    choices: [
      { label: 'Mở rương', run: () => { grant({ gold: 300, mat: { g: 'ht', k: htLvl(), n: 1 } }, 'Kỳ Ngộ «Rương Cổ Bên Đường»'); return ''; } },
      { label: 'Tìm ngăn bí mật', run: () => { knbGain(1); return 'Đáy rương có ngăn ẩn — 1 Kim Nguyên Bảo lăn ra!'; } },
      { label: 'Không động vào của lạ', run: skipMsg },
    ] },
  { id: 'suoilinh', icon: '💧', title: 'Suối Linh Giữa Rừng',
    desc: 'Dòng suối trong vắt bốc hơi mát lạ, cá bơi ngược dòng như có linh tính. Người xưa nói uống nước này gột sạch mệt mỏi.',
    choices: [
      { label: 'Uống nước suối', run: () => { heal(R.P ? Math.round(R.P.life * 0.6) : 100); return 'Nước suối mát lạnh — hồi phục 60% sinh lực.'; } },
      { label: 'Tĩnh tọa bên suối', run: () => { addTimedBuff('xp', 25, 30); return 'Tâm thần sảng khoái: +25% kinh nghiệm trong 30 phút.'; } },
      { label: 'Rửa mặt rồi đi tiếp', run: skipMsg },
    ] },
  { id: 'nguahoang', icon: '🐎', title: 'Ngựa Hoang',
    desc: 'Một con ngựa hoang lông bóng như lụa đang gặm cỏ, thỉnh thoảng liếc bạn đầy thách thức. Thuần được nó là cả một duyên phận.',
    choices: [
      { label: 'Thử thuần phục', run: () => { if (Math.random() < 0.5) { grant({ fd: 8, gold: 200 }, 'Kỳ Ngộ «Ngựa Hoang»'); return ''; } hurtFrac(0.2); return 'Ngựa hất tung bạn xuống đất (−20% sinh lực) rồi phóng đi mất hút...'; } },
      { label: 'Quan sát tập tính ngựa', run: () => { const x = Math.round(expFor(S.lvl) * 0.1); gainXp(x); return `Nhìn ngựa chạy mà ngộ ra thân pháp — nhận ${fmt(x)} kinh nghiệm.`; } },
      { label: 'Để nó yên', run: skipMsg },
    ] },
  { id: 'thayboi', icon: '🔮', title: 'Thầy Bói Đầu Chợ',
    desc: 'Thầy bói mù lần tràng hạt, chưa mở miệng đã nói trúng tên bạn: "Hôm nay thí chủ có số kỳ ngộ — gieo một quẻ xem vận may rủi?"',
    choices: [
      { label: 'Gieo quẻ (100 lượng)', run: () => { if (S.gold < 100) return 'Không đủ 100 lượng gieo quẻ — thầy bói lắc đầu.'; S.gold -= 100; if (Math.random() < 0.5) { addTimedBuff('luck', 15, 30); return 'Quẻ Đại Cát! +15 may mắn trong 30 phút.'; } addTimedBuff('xp', 25, 30); return 'Quẻ Tiến Thân! +25% kinh nghiệm trong 30 phút.'; } },
      { label: 'Nghe lời khuyên miễn phí', run: () => { grant({ fd: 2 }, 'Kỳ Ngộ «Thầy Bói Đầu Chợ»'); return ''; } },
      { label: 'Không tin bói toán', run: skipMsg },
    ] },
  { id: 'detu', icon: '🆘', title: 'Đệ Tử Cầu Cứu',
    desc: 'Một đệ tử trẻ bị truy sát chạy tới, áo rách đẫm mồ hôi: "Tiền bối cứu mạng! Kẻ đuổi theo sắp tới nơi rồi!"',
    choices: [
      { label: 'Ra tay chặn địch', run: () => fightSpawn('Kẻ truy sát') },
      { label: 'Cho thuốc rồi hộ tống về trấn', run: () => { grant({ fd: 5, pot: { kind: 'life', tier: 2, n: 3 } }, 'Kỳ Ngộ «Đệ Tử Cầu Cứu»'); return ''; } },
      { label: 'Việc giang hồ, không xen vào', run: skipMsg },
    ] },
  { id: 'linhthao', icon: '🌿', title: 'Linh Thảo Phát Sáng',
    desc: 'Một khóm cỏ lạ phát ánh sáng xanh dịu giữa bãi luyện công — linh thảo hấp thụ tinh hoa đất trời, hái đúng lúc là nguyên liệu quý.',
    choices: [
      { label: 'Hái ngay', run: () => { grant({ mat: { g: 'ht', k: htLvl(), n: 2 } }, 'Kỳ Ngộ «Linh Thảo Phát Sáng»'); return ''; } },
      { label: 'Đánh dấu, chờ thảo trưởng thành', run: () => { addTimedBuff('luck', 15, 30); return 'Hơi thở linh thảo quyện vào người: +15 may mắn trong 30 phút.'; } },
      { label: 'Không hái của trời', run: skipMsg },
    ] },
  { id: 'ditich', icon: '🏺', title: 'Tàn Tích Cổ Động',
    desc: 'Sau tảng đá đổ là cửa động phủ cũ khắc đầy chữ cổ — nơi tiền nhân từng bế quan. Trong động tối om, cơ duyên và hiểm nguy song hành.',
    choices: [
      { label: 'Vào động khám phá', run: () => { grant({ gold: 400, pts: 1 }, 'Kỳ Ngộ «Tàn Tích Cổ Động»'); return ''; } },
      { label: 'Đốt nén hương tưởng niệm', run: () => { grant({ fd: 4 }, 'Kỳ Ngộ «Tàn Tích Cổ Động»'); return ''; } },
      { label: 'Đánh dấu rồi rời đi', run: skipMsg },
    ] },
];

/* ---------- mở kỳ ngộ ---------- */
function pickEvent() {
  const k = kyngoState();
  const pool = KN_EVENTS.filter(e => e.id !== k.lastId);
  return pick(pool.length ? pool : KN_EVENTS);
}
function knShow(ev) {
  const k = kyngoState();
  const btns = ev.choices.map((c, i) => `<button class="btn" data-kn-choice="${i}">${esc(c.label)}</button>`).join('');
  modal(`<h3>${ev.icon} Kỳ Ngộ — ${esc(ev.title)}</h3>
    <p class="desc">${esc(ev.desc)}</p>
    <div class="kn-choices" style="display:flex;flex-direction:column;gap:8px;margin-top:10px">${btns}</div>
    <p class="desc small" style="margin-top:10px">Kỳ ngộ hôm nay: <b>${k.n}/${KN_DAY_MAX}</b> · tổng đã gặp: ${k.total}</p>`,
    () => { document.querySelectorAll('#mBody [data-kn-choice]').forEach(b => { (b as any).onclick = () => knResolve(ev, +(b as any).dataset.knChoice); }); },
    true);                                     // locked: phải chọn 1 lối, không đóng/X thoát được
}
function knFire(id) {
  const k = kyngoState();
  if (k.pending || k.n >= KN_DAY_MAX || kyngoBlocked() || modalOpen()) return false;
  const ev = id ? KN_EVENTS.find(e => e.id === id) : pickEvent();
  if (!ev) return false;
  k.pending = ev.id; k.lastId = ev.id; save();
  knShow(ev);
  log(`✨ <b>Kỳ Ngộ Giang Hồ</b>: ${esc(ev.title)}`);
  return true;
}
function knResolve(ev, i) {
  const k = kyngoState();
  if (k.pending !== ev.id) return;                       // đã xử lý / sự kiện cũ — bỏ qua click thừa
  const ch = ev.choices[i]; if (!ch) return;
  k.pending = '';
  let msg = '';
  try { msg = ch.run() || ''; } catch (e) { msg = 'Kỳ ngộ tan biến trong gang tấc...'; }
  k.n++; k.total++; k.t = knWait();
  closeModal(true);
  if (msg) { log(`✨ Kỳ Ngộ «${esc(ev.title)}»: ${esc(msg)}`); toast(msg); }
  save();                                                // grant/buff/gamble đã tự save từng phần; chốt luôn trạng thái kn
}

/* ---------- tick (gọi từ combat.tick cạnh goldBossTick) ---------- */
export function kyngoTick(dt) {
  knExpose();
  if (!S.fac) return;
  const k = kyngoState();
  if (k.pending) {                                       // đang chờ chọn (kể cả sau khi nạp lại game): mở lại đúng sự kiện
    if (!kyngoBlocked() && !modalOpen()) { const ev = KN_EVENTS.find(e => e.id === k.pending); if (ev) knShow(ev); }
    return;
  }
  if (k.n >= KN_DAY_MAX || kyngoBlocked() || modalOpen()) return;
  k.t -= dt;
  if (k.t <= 0 && !knFire()) k.t = KN_RETRY;             // tới giờ mà bị chặn giữa chừng: 5s sau thử lại
}

/* Test/debug: force mở kỳ ngộ (id tùy chọn) — tôn trọng pending/cap/guard như tick. */
export const kyngoTrigger = id => knFire(id);

/* ---------- phơi KN cho debug / test E2E (khuôn svExpose của survival.ts) ---------- */
const KN_API = { get state() { return kyngoState(); }, trigger: kyngoTrigger, callNow: kyngoCallNow, events: KN_EVENTS, tick: kyngoTick, blocked: kyngoBlocked };
function knExpose() { try { const g = (window as any).__G; if (g && !('KN' in g)) Object.defineProperty(g, 'KN', { get: () => KN_API }); } catch (e) { /* bo qua */ } }
