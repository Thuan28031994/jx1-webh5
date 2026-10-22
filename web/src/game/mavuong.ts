// @ts-nocheck — MA VƯƠNG THẢO PHẠT (f35): ĐUA SÁT THƯƠNG BOSS mỗi ngày —
// mỗi ngày xuất hiện 1 Ma Vương (tên + ngũ hành TẤT ĐỊNH theo ngày), người chơi có
// lượt vào trận đánh boss trong 90 giây, MỌI sát thương lên boss được cộng dồn
// (hook heroHit trong combat.ts qua cờ R.mvboss + hàm mvAddDamage ở đây — khuôn
// R.gboss của Boss Bang f31). Tổng sát thương ngày mở khoá 5 MỐC THƯỞNG và xếp
// hạng trên BẢNG ĐUA 10 đối thủ NPC (tất định theo seed ngày); thưởng hạng nhận
// vào NGÀY HÔM SAU (settle lười khi qua ngày, khuôn điểm danh).
//
// LƯU Ý đặt tên: khoá save dùng RW().mv và cờ trận R.mvboss — RW().wb / R.wbArena
// ĐÃ thuộc về Boss Thế Giới (worldboss.ts), đụng vào là phá tính năng cũ.
//
// QUY MÔ THEO SỨC MẠNH THẬT (đọc từ calc() — stats.ts):
//   mvDps()    = R.P.main.dps — DPS kỳ vọng của chiêu chính do chính calc() tính
//                (đã gồm tỉ lệ trúng/chí mạng/tốc đánh/sustain nội lực; power()
//                trong stats.ts cũng dùng đúng số này). Dự phòng khi chưa có P:
//                10 + 2×cấp.
//   1 "lượt chuẩn" runStd = mvDps() × MV_TIME — sát thương lý thuyết của 1 lượt
//                90 giây đánh liên tục. Mốc ngày và máu boss đều tỉ lệ theo
//                runStd nên luôn có ý nghĩa ở mọi giai đoạn mạnh/yếu; runStd
//                được CHỐT vào state lúc đầu ngày (m.stdRun) để mốc không nhảy
//                giữa ngày khi thay đồ.
//   Máu boss   = runStd × MV_HP_X (6) — giết được trong 90 giây cần ~6 lần lượng
//                sát thương chuẩn (tính cả bùng nổ/chí mạng/thời gian đứng đánh
//                thực tế thấp hơn lý thuyết) → hạ boss là kỳ tích đáng khoe,
//                nhưng không phải không tưởng với người chơi mạnh + may mắn.
//   Mốc ngày   = runStd × [0.4, 1.2, 2.5, 5, 9]: mốc 1 sau ~nửa lượt tử tế,
//                mốc 3 ≈ 2.5 lượt chuẩn (gần hết 3 lượt miễn phí đánh tốt),
//                mốc 5 = 9 lượt chuẩn — phải hạ boss ít nhất 1 lần (1 lần hạ =
//                đủ 6 lượt chuẩn) hoặc đánh gần như hoàn hảo cả 6 lượt.
// Hằng số:
//   MV_TIME = 90 giây/lượt · MV_FREE = 3 lượt miễn phí/ngày · mua thêm tối đa
//   MV_BUY_MAX = 3 lượt, MV_BUY_FD = 5 Phúc Duyên/lượt.
//   Thưởng mốc (nhận 1 lần/ngày): Phúc Duyên 3/6/10/15/25, mốc 4 thêm 2 Huyền
//   Tinh (cấp theo nhân vật như kyngo), mốc 5 thêm 1 Kim Nguyên Bảo + 10 Phúc
//   Duyên (tổng mốc 5 = 35 Phúc Duyên + 1 KNB).
//   Thưởng hạng hôm qua: hạng 1 = 20 Phúc Duyên + 1 KNB; hạng 2–3 = 12 Phúc
//   Duyên; hạng 4–10 = 6 Phúc Duyên.
// State: RW().mv = { day, tries, bought, total, best, runDmg, claimed: [],
//   stdRun, lastDay, lastRank, rankClaimedDay, histBest } — khởi tạo lười.
'use strict';
import { ZONES, clamp, esc, fmt, inWorld } from './core';
import { RW, grant, openGiftTab } from './rewards';
import { S, save } from './save';
import { localISODay } from './journal';
import { knbGain } from './ktc';
import { H, R, makeEnemy } from './combat';
import { backFromTown } from './control';
import { SV } from './survival';
import { log, modal, toast } from './ui';

export const MV_TIME = 90;             // giây cho mỗi lượt thảo phạt
export const MV_FREE = 3;              // lượt miễn phí mỗi ngày
export const MV_BUY_MAX = 3;           // số lượt mua thêm tối đa/ngày
export const MV_BUY_FD = 5;            // Phúc Duyên cho 1 lượt mua thêm
export const MV_HP_X = 6;              // máu boss = runStd × 6
const MV_MILE_FR = [0.4, 1.2, 2.5, 5, 9];                    // mốc = runStd × hệ số này
const MV_MILE_RW = [{ fd: 3 }, { fd: 6 }, { fd: 10 }, { fd: 15, ht: 2 }, { fd: 35, knb: 1 }];
const MV_ELEM_VI = ['Vật lý', 'Độc', 'Băng', 'Hỏa', 'Lôi'];  // series 0..4 (khớp ELEM của engine)

/* 7 Ma Vương luân phiên theo ngày — tên + ngũ hành (series) tất định. */
export const MV_BOSSES = [
  { name: 'Huyết Ma', series: 3 },
  { name: 'Kim Sí Đại Bằng', series: 4 },
  { name: 'Thạch Cự Nhân', series: 0 },
  { name: 'Băng Long', series: 2 },
  { name: 'Viêm Ma Quân', series: 3 },
  { name: 'Lôi Thần Thú', series: 4 },
  { name: 'Âm Dương Quỷ Vương', series: 1 },
];
/* 10 đối thủ NPC của bảng đua — sát thương tất định theo seed ngày (xem mvRankList). */
const MV_NPCS = ['Kiếm Thánh Vô Danh', 'Huyết Thủ Đồ Phu', 'Thiết Chưởng Lão Quái', 'Ngọc Nữ Kiếm Cơ', 'Cuồng Đao Bá Thiên', 'Ảnh Sát Vô Hình', 'Thiên Sơn Đồng Lão', 'Kim Cang Bất Hoại', 'Lưu Vân Tán Nhân', 'Hắc Phong Song Sát'];
const MV_NPC_FR = [2.4, 1.9, 1.55, 1.25, 1.0, 0.8, 0.62, 0.45, 0.3, 0.18];   // tỉ lệ theo "ngày chuẩn" (3 lượt chuẩn) — jitter ±15% theo hash

const htLvl = () => clamp(Math.floor(S.lvl / 15) + 1, 1, 10);   // cấp Huyền Tinh theo cấp nhân vật (khuôn kyngo)

/* ---------- hash tất định (cyrb53 — cùng họ thuonghoi/sigOf của save.ts) ---------- */
function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/* ---------- boss của 1 ngày (hàm thuần theo isoDay) ---------- */
export function mvBossFor(dayIso) {
  const d = dayIso || localISODay();
  const b = MV_BOSSES[hash53('mvboss|' + d) % MV_BOSSES.length];
  return { name: b.name, series: b.series, elem: MV_ELEM_VI[b.series] || 'Vật lý', day: d };
}
export const mvBossToday = () => mvBossFor(localISODay());

/* ---------- quy mô theo sức mạnh thật ---------- */
export function mvDps() {
  try { const P = R.P; if (P && P.main && P.main.dps > 0) return P.main.dps; } catch (e) { /* chưa recalc */ }
  return 10 + 2 * (S ? S.lvl : 1);
}
export const mvRunStd = () => Math.max(1, Math.round(mvDps() * MV_TIME));        // sát thương 1 lượt chuẩn (90s)
export const mvBossHp = stdRun => Math.max(1, Math.round((stdRun || mvRunStd()) * MV_HP_X));
export function mvMilestones(stdRun) {
  const sr = stdRun || mvRunStd();
  return MV_MILE_FR.map((fr, i) => ({ i, need: Math.round(sr * fr), rw: MV_MILE_RW[i] }));
}
function mileRwText(rw) {
  const o = [];
  if (rw.fd) o.push(`+${rw.fd} Phúc Duyên`);
  if (rw.ht) o.push(`${rw.ht} Huyền Tinh`);
  if (rw.knb) o.push(`${rw.knb} Kim Nguyên Bảo`);
  return o.join(' · ');
}

/* ---------- bảng đua NPC (hàm thuần: ngày + ngày chuẩn + tổng của người chơi) ---------- */
export function mvRankList(dayIso, playerTotal, dayStd) {
  const d = dayIso || localISODay(), ds = Math.max(1, dayStd || mvRunStd() * MV_FREE);
  const rows = MV_NPCS.map((name, i) => {
    const j = 0.85 + (hash53('mvnpc|' + d + '|' + name) % 1000) / 1000 * 0.3;   // jitter 0.85–1.15
    return { name, dmg: Math.round(ds * MV_NPC_FR[i] * j), me: false };
  });
  rows.push({ name: S && S.name ? S.name : 'Bạn', dmg: Math.round(playerTotal || 0), me: true });
  rows.sort((a, b) => b.dmg - a.dmg);
  rows.forEach((r, i) => r.rank = i + 1);
  return rows;
}
export const mvRankOf = (dayIso, playerTotal, dayStd) => { const me = mvRankList(dayIso, playerTotal, dayStd).find(r => r.me); return me ? me.rank : MV_NPCS.length + 1; };

/* ---------- trạng thái ngày + settle hạng hôm qua (lười, khi qua ngày) ---------- */
export function mvState() {
  const r = RW(), m = r.mv = r.mv || {};
  const today = localISODay();
  if (m.day !== today) {
    // settle ngày cũ: chốt hạng theo tổng sát thương + mốc quy mô đã chốt của ngày đó
    if (m.day && m.lastDay !== m.day) {
      m.lastDay = m.day;
      m.lastRank = mvRankOf(m.day, m.total || 0, (m.stdRun || mvRunStd()) * MV_FREE);
    }
    m.day = today; m.tries = 0; m.bought = 0; m.total = 0; m.best = 0; m.runDmg = 0; m.claimed = [];
    m.stdRun = mvRunStd();
  }
  if (!Array.isArray(m.claimed)) m.claimed = [];
  if (m.tries == null) m.tries = 0;
  if (m.bought == null) m.bought = 0;
  if (m.total == null) m.total = 0;
  if (m.best == null) m.best = 0;
  if (m.runDmg == null) m.runDmg = 0;
  if (m.histBest == null) m.histBest = 0;
  if (m.lastRank == null) m.lastRank = 0;
  if (!m.stdRun) m.stdRun = mvRunStd();
  mvExpose();
  return m;
}
export const mvTriesLeft = m => Math.max(0, MV_FREE + (m.bought || 0) - (m.tries || 0));
export function mvInfo() {
  try {
    const m = mvState(), b = mvBossToday();
    return { boss: b.name, elem: b.elem, total: m.total || 0, left: mvTriesLeft(m), rank: mvRankOf(m.day, m.total || 0, (m.stdRun || mvRunStd()) * MV_FREE) };
  } catch (e) { return { boss: '', elem: '', total: 0, left: 0, rank: 0 }; }
}

/* ---------- vào trận / cộng sát thương / kết thúc ---------- */
export function mvStart() {
  if (R.tyvo) { toast('Hãy kết thúc Tỷ Võ trước khi thảo phạt Ma Vương'); return { ok: false, msg: 'Đang ở Tỷ Võ' }; }
  if (!S.fac || R.mvboss || SV.on) return { ok: false, msg: 'Chưa thể vào trận lúc này' };
  if (R.tk || R.dg || R.tower || R.wbArena || R.gboss) { toast('Hãy kết thúc hoạt động hiện tại trước khi thảo phạt Ma Vương'); return { ok: false, msg: 'Đang bận hoạt động khác' }; }
  const m = mvState();
  if (mvTriesLeft(m) <= 0) { toast('Đã hết lượt thảo phạt hôm nay — mua thêm lượt hoặc chờ ngày mai'); return { ok: false, msg: 'Hết lượt' }; }
  if (R.town) backFromTown();
  const boss = mvBossToday(), hp = mvBossHp(m.stdRun);
  m.tries++; m.runDmg = 0; save();
  R.pickTarget = null; R.enemies = []; R.corpses = []; R.stall = 0;
  R.mvboss = { t: MV_TIME, hpCap: hp, warned: {} };
  const L = Math.max(10, S.lvl), z = ZONES[Math.min(ZONES.length - 1, Math.floor(L / 12))];
  const [x, y] = inWorld(H.x + 180, H.y);
  const e = makeEnemy(z.boss, L + 3, 'boss', x, y);
  e.hp = e.max = hp; e.n = boss.name; e.series = boss.series; e.mvBoss = true; e.regen = 0;
  R.enemies.push(e);
  R.banner = { t: 2.6, text: boss.name, sub: `Ma Vương hệ ${boss.elem} — thảo phạt trong ${MV_TIME} giây!` };
  log(`👹 <b class="boss">${esc(boss.name)}</b> (hệ ${esc(boss.elem)}) hiện thân — máu ${fmt(hp)}. Gây càng nhiều sát thương càng tốt trong ${MV_TIME} giây!`);
  toast(`Thảo phạt ${boss.name} — ${MV_TIME} giây, đánh hết sức!`); R.logDirty = true;
  return { ok: true };
}
/* Hook từ combat.ts (heroHit + độc DoT): chỉ cộng khi đang trong trận và đánh trúng Ma Vương.
   Trần cộng = tổng máu boss (kể cả đòn kết liễu) để "hạ boss = đủ toàn bộ máu". */
export function mvAddDamage(n) {
  if (!R.mvboss || !(n > 0)) return;
  const r = RW(), m = r.mv; if (!m) return;
  const cap = R.mvboss.hpCap || Infinity, cur = m.runDmg || 0;
  const add = Math.max(0, Math.min(n, cap - cur));
  if (add <= 0) return;
  m.runDmg = cur + add; m.total = (m.total || 0) + add;
}
export function mvbossTick(dt) {
  mvExpose();   // phơi __G.WB ngay từ những tick đầu (test/debug gọi trước khi mở view)
  const k = R.mvboss; if (!k) return;
  k.t -= dt;
  for (const s of [60, 30, 10]) if (k.t <= s && !k.warned[s]) { k.warned[s] = 1; log(`⏳ Còn <b>${s} giây</b> — tổng sát thương lượt này: <b>${fmt(Math.round((RW().mv || {}).runDmg || 0))}</b>`); }
  if (k.t <= 0) mvbossFinish(false, false);
}
export function mvbossVictory() { mvbossFinish(true, false); }   // gọi từ waveCleared của combat.ts khi boss gục
export function mvbossFinish(killed, quiet) {
  if (!R.mvboss) return;
  const m = mvState(), run = Math.round(m.runDmg || 0);
  m.best = Math.max(m.best || 0, run); m.histBest = Math.max(m.histBest || 0, m.total || 0);
  const miles = mvMilestones(m.stdRun).filter(x => (m.total || 0) >= x.need).length;
  R.mvboss = null; R.enemies = []; R.corpses = []; S.wave = 1; R.spawnT = 0.5; R.zoneShown = null; m.runDmg = 0; save();
  const head = killed ? '👑 DIỆT MA THÀNH CÔNG!' : '⏱ HẾT GIỜ THẢO PHẠT';
  log(`<b class="up">${head}</b> Lượt này gây <b>${fmt(run)}</b> sát thương · tổng hôm nay <b>${fmt(Math.round(m.total))}</b> · đạt ${miles}/5 mốc thưởng.`);
  if (quiet) return;   // gục giữa trận: chỉ ghi log (heroDeath xử lý phần còn lại)
  modal(`<div style="text-align:center;padding:10px 4px">
    <div style="font-size:44px">${killed ? '👑' : '👹'}</div>
    <h3 style="color:${killed ? 'var(--gold)' : '#ff9a5e'};font-size:24px;margin:6px 0">${killed ? 'DIỆT MA THÀNH CÔNG!' : 'HẾT GIỜ!'}</h3>
    <p style="font-size:19px">Sát thương lượt này: <b style="color:var(--gold)">${fmt(run)}</b></p>
    <p class="desc">${killed ? `Hạ gục <b>${esc(mvBossToday().name)}</b> trước giờ — sát thương tính đủ toàn bộ máu boss!` : `${esc(mvBossToday().name)} vẫn còn đứng vững.`}<br>
    Kỷ lục lượt hôm nay: <b>${fmt(m.best)}</b> · Tổng sát thương ngày: <b>${fmt(Math.round(m.total))}</b><br>
    Đã đạt <b>${miles}/5 mốc thưởng</b> — mở Ma Vương Thảo Phạt để nhận thưởng mốc.</p>
    <div class="btnrow" style="justify-content:center;margin-top:12px"><button class="btn" id="mvOk">Xem mốc thưởng</button></div></div>`,
    () => { const el = document.querySelector('#mBody #mvOk'); if (el) (el as any).onclick = () => openGiftTab('wboss'); });
}

/* ---------- mua lượt / nhận thưởng ---------- */
export function mvBuyTry() {
  const m = mvState(), r = RW();
  if ((m.bought || 0) >= MV_BUY_MAX) return { ok: false, msg: `Mỗi ngày chỉ mua thêm tối đa ${MV_BUY_MAX} lượt` };
  if ((r.fd || 0) < MV_BUY_FD) return { ok: false, msg: `Mua lượt cần ${MV_BUY_FD} Phúc Duyên` };
  r.fd -= MV_BUY_FD; m.bought++;
  save();
  return { ok: true, msg: `Đã mua thêm 1 lượt thảo phạt (−${MV_BUY_FD} Phúc Duyên)` };
}
export function mvClaim(i) {
  const m = mvState(), ms = mvMilestones(m.stdRun)[i];
  if (!ms) return { ok: false, msg: 'Mốc không hợp lệ' };
  if ((m.claimed || []).includes(i)) return { ok: false, msg: 'Đã nhận thưởng mốc này rồi' };
  if ((m.total || 0) < ms.need) return { ok: false, msg: `Chưa đạt mốc — cần ${fmt(ms.need)} sát thương` };
  m.claimed.push(i);
  const rw = ms.rw, g = {};
  if (rw.fd) g.fd = rw.fd;
  if (rw.ht) g.mat = { g: 'ht', k: htLvl(), n: rw.ht };
  grant(g, `Ma Vương Thảo Phạt · mốc ${i + 1}`);
  if (rw.knb) knbGain(rw.knb);
  save();
  return { ok: true, msg: `Nhận thưởng mốc ${i + 1}: ${mileRwText(rw)}` };
}
export function mvRankReward(rank) {
  if (rank === 1) return { fd: 20, knb: 1 };
  if (rank === 2 || rank === 3) return { fd: 12 };
  if (rank >= 4 && rank <= 10) return { fd: 6 };
  return null;
}
export function mvClaimRank() {
  const m = mvState();
  if (!m.lastDay || !m.lastRank) return { ok: false, msg: 'Chưa có kết quả hạng hôm qua' };
  if (m.rankClaimedDay === m.lastDay) return { ok: false, msg: 'Đã nhận thưởng hạng hôm qua rồi' };
  const rw = mvRankReward(m.lastRank);
  if (!rw) return { ok: false, msg: 'Hạng này không có thưởng' };
  m.rankClaimedDay = m.lastDay;
  grant({ fd: rw.fd }, `Ma Vương Thảo Phạt · thưởng hạng ${m.lastRank} (${m.lastDay})`);
  if (rw.knb) knbGain(rw.knb);
  save();
  return { ok: true, msg: `Nhận thưởng hạng ${m.lastRank} hôm qua: ${mileRwText(rw)}` };
}
export const mvSettleInfo = () => { const m = mvState(); return { lastDay: m.lastDay || '', lastRank: m.lastRank || 0, rankClaimedDay: m.rankClaimedDay || '', canClaim: !!(m.lastDay && m.lastRank && m.rankClaimedDay !== m.lastDay && mvRankReward(m.lastRank)) }; };

/* ---------- giao diện (view 'wboss' trong modal Phần thưởng) ---------- */
export function mvBody() {
  mvExpose();
  const m = mvState(), r = RW(), boss = mvBossToday(), left = mvTriesLeft(m), inFight = !!R.mvboss;
  const dayStd = (m.stdRun || mvRunStd()) * MV_FREE, rows = mvRankList(m.day, m.total || 0, dayStd);
  const myRank = (rows.find(x => x.me) || {}).rank || 0;
  const si = mvSettleInfo(), rankRw = si.lastRank ? mvRankReward(si.lastRank) : null;
  const miles = mvMilestones(m.stdRun);
  return `<p class="desc">Ma Vương Thảo Phạt: mỗi ngày 1 Ma Vương, <b>${MV_FREE} lượt miễn phí</b> (mua thêm tối đa ${MV_BUY_MAX} lượt, ${MV_BUY_FD} Phúc Duyên/lượt). Vào trận có <b>${MV_TIME} giây</b> — mọi sát thương lên boss đều được cộng vào tổng ngày để mở mốc thưởng và đua hạng với 10 cao thủ NPC. Hạ boss trước giờ = tính đủ toàn bộ máu!</p>
    ${si.lastDay ? `<div class="qrow"><span>🏆 Kết quả hôm qua (${esc(si.lastDay)}): <b>hạng ${si.lastRank}</b>${rankRw ? ` — thưởng: ${mileRwText(rankRw)}` : ''}</span>${si.canClaim ? '<button class="btn sm" id="mvRankClaim">Nhận thưởng hạng</button>' : '<small>Đã nhận</small>'}</div>` : ''}
    <div class="card stats"><span>Ma Vương hôm nay</span><span>👹 ${esc(boss.name)} (hệ ${esc(boss.elem)})</span><span>Máu boss</span><span>${fmt(mvBossHp(m.stdRun))}</span><span>Lượt còn</span><span>${left}/${MV_FREE + (m.bought || 0)}</span><span>Tổng sát thương hôm nay</span><span>${fmt(Math.round(m.total || 0))}</span><span>Kỷ lục 1 lượt hôm nay</span><span>${fmt(m.best || 0)}</span><span>Hạng hiện tại</span><span>${myRank}/11</span></div>
    <div class="btnrow">${inFight ? '<button class="btn red" id="mvQuit">Rời trận (giữ sát thương đã gây)</button>' : left <= 0 ? '<button class="btn" disabled>Đã hết lượt hôm nay</button>' : '<button class="btn" id="mvStart">Vào trận thảo phạt</button>'}
    ${!inFight && (m.bought || 0) < MV_BUY_MAX ? `<button class="btn" id="mvBuy" ${(r.fd || 0) >= MV_BUY_FD ? '' : 'disabled'}>Mua thêm lượt (${MV_BUY_FD} Phúc Duyên)</button>` : ''}</div>
    <h4>Mốc sát thương ngày <small>nhận 1 lần mỗi mốc</small></h4>
    ${miles.map(x => { const got = (m.total || 0) >= x.need, cl = (m.claimed || []).includes(x.i); return `<div class="qrow"><span><b>Mốc ${x.i + 1}</b> — ${mileRwText(x.rw)}<small>${fmt(Math.min(Math.round(m.total || 0), x.need))}/${fmt(x.need)} sát thương</small></span><button class="btn sm" data-mv-claim="${x.i}" ${cl || !got ? 'disabled' : ''}>${cl ? 'Đã nhận' : got ? 'Nhận' : 'Chưa đạt'}</button></div>`; }).join('')}
    <h4>Bảng đua hôm nay <small>thưởng hạng nhận vào ngày mai</small></h4>
    ${rows.map(x => `<div class="qrow" ${x.me ? 'style="border-color:var(--gold)"' : ''}><span>${x.rank}. <b>${esc(x.name)}</b>${x.me ? ' (bạn)' : ''}</span><small>${fmt(x.dmg)} sát thương</small></div>`).join('')}`;
}
export function mvBind(refreshGift) {
  const rf = () => { if (refreshGift) refreshGift(); };
  const on = (id, fn) => { const el = document.querySelector('#mBody ' + id); if (el) (el as any).onclick = fn; };
  on('#mvStart', () => { const r = mvStart(); if (!r.ok) toast(r.msg); rf(); });
  on('#mvQuit', () => { mvbossFinish(false, false); rf(); });
  on('#mvBuy', () => { const r = mvBuyTry(); toast(r.msg); rf(); });
  on('#mvRankClaim', () => { const r = mvClaimRank(); toast(r.msg); rf(); });
  document.querySelectorAll('#mBody [data-mv-claim]').forEach(x => (x as any).onclick = () => { const r = mvClaim(+x.dataset.mvClaim); toast(r.msg); rf(); });
}
export function mvHudState() { try { const k = R.mvboss; if (!k) return { on: false, t: 0, dmg: 0 }; return { on: true, t: Math.max(0, k.t), dmg: Math.round((RW().mv || {}).runDmg || 0), hpCap: k.hpCap }; } catch (e) { return { on: false, t: 0, dmg: 0 }; } }

/* Test/debug: phơi WB cho __G (khuôn GH/FP/MK/BP). Tên khoá __G.WB — RW().wb là của worldboss, còn __G.WB đang trống. */
const WB_API = {
  get state() { return mvState(); }, boss: mvBossToday, bossFor: mvBossFor, bosses: MV_BOSSES,
  start: mvStart, addDamage: mvAddDamage, finish: mvbossFinish, tick: mvbossTick,
  claim: mvClaim, claimRank: mvClaimRank, buy: mvBuyTry, buyTry: mvBuyTry,
  rank: () => { const m = mvState(); return mvRankOf(m.day, m.total || 0, (m.stdRun || mvRunStd()) * MV_FREE); },
  rankList: mvRankList, milestones: mvMilestones, settleInfo: mvSettleInfo, hp: mvBossHp, runStd: mvRunStd, dps: mvDps, hud: mvHudState, body: mvBody,
};
export function mvExpose() { try { const g = (window as any).__G; if (g && !('WB' in g)) Object.defineProperty(g, 'WB', { get: () => WB_API }); } catch (e) { /* bo qua */ } }
