// @ts-nocheck — chuyen tu vanilla JS: bat lai check tung file dan dan (xem README muc TypeScript)
import { $, FAC, ZONES, esc, fmt, inWorld, pick, rnd } from './core';
import { localISODay } from './journal';
import { addTimedBuff } from './ktc';
import { H, R, heal, makeEnemy } from './combat';
import { itemPower } from './loot';
import { matAdd, matHave } from './recipes';
import { achCheck, grant, giftText, openGiftTab, RW, unlocked } from './rewards';
import { farmBind, farmBody, farmReadyCount, fpExpose } from './dongphu';
import { marketBind, marketBody, mkBestMove, mkExpose } from './thuonghoi';
import { bpBind, bpBody, bpExpose, bpInfo } from './dotpha';
import { mvBind, mvBody, mvExpose, mvInfo } from './mavuong';
import { log, sellProtected, setInvDirty, toast } from './ui';
import { SV } from './survival';
import { backFromTown } from './control';
import { towerExit } from './rewards';
import { S, save } from './save';
import { applyWeekMod, weekKey, weekModsText, weekRewardMul } from './depth';

/* ======================= HOAT DONG: DA TAU · BANG HOI · TONG KIM =======================
   Port tu js/activities.js ban vinarpg. Muc dich can bang, khong them viec bat buoc moi:
   · Da Tau  - chuoi nhiem vu dai han, hut do thua va nguyen lieu du (Tinh Hong Bao Thach, Thuy Tinh Trang); thuong nho (diem tiem nang, Phuc Duyen).
   · Bang hoi - noi tieu vang khong day: dong gop vang len cap bang, moi cap mo buff nho co tran.
   · Tong Kim - 1 tran / tuan: 5 dot tinh anh roi trum co Tuyet chieu; thuong "Tong Kim Lenh" doi nguyen lieu / Phuc Duyen, KHONG doi do Hoang Kim. */
'use strict';

/* ---------- Dã Tẩu ---------- */
const YT_TYPES = ['kills', 'bosses', 'item', 'mats', 'stages'];
function ytState() {
  const r = RW(); r.yt = r.yt || { i: 0, have: 0, done: false, lvl: S.lvl };
  if (!r.yt.lvl) r.yt.lvl = r.yt.done && r.yt.i % 5 === 0 ? Math.max(1, Math.floor((r.yt.have - 200) / 4)) : S.lvl;
  return r.yt;
}
function ytStep() {
  const y = ytState(), t = YT_TYPES[y.i % 5], c = Math.floor(y.i / 5), lv = y.lvl;
  const step = { t, n: 1, rw: { pts: 1, fd: 5 + c }, txt: '' };
  if (t === 'kills') { step.n = 200 + lv * 4; step.txt = `Hạ ${step.n} quái`; }
  else if (t === 'bosses') { step.n = 3; step.txt = 'Hạ 3 trùm'; }
  else if (t === 'item') { step.n = 3; step.txt = 'Nộp 3 món đồ Xanh trở lên (không phải đồ bộ / Tím / Bạch Kim, chưa khóa)'; }
  else if (t === 'mats') { step.n = 1; step.txt = 'Nộp 5 Tinh Hồng Bảo Thạch + 3 Thủy Tinh Trắng'; step.rw = { pts: 1, fd: 8 + c, gold: 1500 }; }
  else { step.n = 5; step.txt = 'Vượt 5 ải'; }
  return step;
}
export function ytTick(k, n = 1) {
  if (!S || !S.fac) return;
  const y = ytState(), st = ytStep();
  if (y.done || st.t !== k) return;
  y.have = Math.min(st.n, y.have + n); if (y.have >= st.n) { y.done = true; const r = RW(); r.stat.ytQuests = (r.stat.ytQuests || 0) + 1; }
}
const ytItems = () => S.inv.filter(it => !it.locked && !sellProtected(it) && it.r >= 1).sort((a, b) => itemPower(a) - itemPower(b));
function ytDeliverable() {
  const y = ytState(), st = ytStep(); if (y.done) return false;
  if (st.t === 'item') return ytItems().length >= st.n;
  if (st.t === 'mats') return matHave('misc', 'thbt') >= 5 && matHave('misc', 'wc') >= 3;
  return false;
}
function ytDeliver() {
  const y = ytState(), st = ytStep(); if (y.done || !ytDeliverable()) return { ok: false, msg: 'Chưa đủ vật phẩm' };
  if (st.t === 'item') { for (const it of ytItems().slice(0, st.n)) S.inv.splice(S.inv.indexOf(it), 1); setInvDirty(true); }
  else { matAdd('misc', 'thbt', -5); matAdd('misc', 'wc', -3); }
  y.have = st.n; y.done = true; return { ok: true, msg: 'Đã nộp' };
}
function ytClaim() {
  const y = ytState(), st = ytStep(); if (!y.done) return;
  y.i++; y.have = 0; y.done = false; y.lvl = S.lvl; grant(st.rw, 'Dã Tẩu · ' + st.txt); achCheck();
}

/* ---------- Bang hội ---------- */
export const GUILD_MAX = 20;
export const guildCost = lv => Math.round(100000 * Math.pow(1.3, lv) * (1 + S.lvl / 20));
function guildState() { const r = RW(); const g = r.guild = r.guild || { lv: 0, gold: 0 }; if (g.pts == null) g.pts = 0; return g; }
/* buff moi cap: kinh nghiem +0,5%, sinh luc +0,5%, sat thuong +0,25%, may man +0,25 (cap 20: +10% / +10% / +5% / +5) */
export function guildBuff() { const lv = S && S.rw && S.rw.guild ? S.rw.guild.lv : 0; return { xp: lv * 0.5, life: lv * 0.5, dmg: lv * 0.25, lucky: lv * 0.25 }; }
export function guildDonate(amount) {
  const g = guildState(); amount = Math.floor(+amount);
  if (!(amount > 0) || S.gold < amount) return { ok: false, msg: 'Không đủ ngân lượng' };
  if (g.lv >= GUILD_MAX) return { ok: false, msg: 'Bang hội đã đạt cấp tối đa' };
  S.gold -= amount; g.gold += amount; let up = 0;
  while (g.lv < GUILD_MAX && g.gold >= guildCost(g.lv)) { g.gold -= guildCost(g.lv); g.lv++; up++; }
  if (g.lv >= GUILD_MAX) g.gold = 0;
  if (up) R.dirty = true;
  const earned = Math.floor(amount / GH_PTS_PER_GOLD);          // Bang Hội 2.0: góp vàng cũng tích điểm cống hiến
  if (earned > 0) g.pts = (g.pts || 0) + earned;
  return { ok: true, msg: (up ? `Bang hội lên cấp ${g.lv}!` : `Đã đóng góp ${fmt(amount)} lượng`) + (earned > 0 ? ` · +${earned} điểm cống hiến` : '') };
}

/* ======================= BANG HỘI 2.0 (f31) =======================
   Mở rộng bang NPC sẵn có ở trên (góp vàng / cấp / buff giữ nguyên, không thay thế):
   thêm thành viên NPC, nhiệm vụ bang theo ngày, Boss Bang theo tuần và cửa hàng điểm cống hiến.
   Trạng thái nằm chung RW().guild: { pts, seed, members[], memLv, daily{day,quests[]}, boss{week,tries,best} }
   (khởi tạo lười trong guildState / các helper gh* — save cũ tự có thêm trường khi đọc).
   Hằng số cân bằng:
   · GH_PTS_PER_GOLD = 10.000 — đóng góp 10.000 lượng = 1 điểm cống hiến (làm tròn xuống).
   · Thành viên: GH_MEMBERS_BASE = 8 người ở cấp bang 0, +1 mỗi GH_MEMBERS_PER_LV = 3 cấp bang,
     trần GH_MEMBERS_MAX = 14. Đội hình sinh TẤT ĐỊNH từ seed lưu trong save (cùng save = cùng người,
     cùng cấp lúc sinh); cấp bang tăng thì mỗi thành viên +GH_MEM_LV_PER_GUILD_LV = 2 cấp;
     tụt sau người chơi quá GH_CATCHUP_GAP = 30 cấp thì được kéo lên (người chơi - 10) — "bang chúng cũng luyện công".
     Sức mạnh hiển thị = cấp^1,6 × hệ số riêng 0,8–1,2 (lưu ở m.v).
   · Nhiệm vụ ngày: đúng 3 nhiệm vụ/ngày, chọn tất định theo ngày (hash ngày) từ 5 loại đã có số đếm THẬT:
     kills + bosses + gold + drops (Sổ tay hôm nay — combat ghi jrAdd kills/gold, bosses ghi từ f31)
     và dg (tổng lượt phó bản + thuyền hôm nay trong RW().dgSave). Mốc theo cấp người chơi lúc đầu ngày:
     kills 120 + 3×cấp · bosses 2 + cấp/40 · gold 15.000 + 500×cấp · drops 12 + cấp/2 · dg 2.
     Mỗi nhiệm vụ thưởng GH_QUEST_PTS = 25 điểm cống hiến + GH_QUEST_FD = 3 Phúc Duyên (qua grant).
   · Boss Bang: GH_BOSS_TRIES = 3 lượt/tuần (khóa tuần như tkState), GH_BOSS_WAVES = 4 đợt
     (3 đợt tinh anh + trùm), máu trùm ×GH_BOSS_HP_X = 10 (Boss tuần là ×60 đấu DPS 75s; Boss Bang
     đánh tới hạ nên để ×10, bù lại có hồi 35% máu giữa đợt như Tống Kim). Thưởng khi rời/thắng:
     điểm cống hiến = 10 + 15×số đợt qua (+30 khi thắng), quỹ bang = 2.000 + 3.000×số đợt qua
     (quỹ chạy cùng vòng lên cấp như tiền đóng góp). Kỷ lục tuần = số đợt qua cao nhất.
   · Cửa hàng bang: giá bằng điểm cống hiến, hiệu ứng chỉ đi qua grant() / addTimedBuff sẵn có
     (Phúc Duyên, thuốc, Huyền Tinh, lượng, buff %XP, điểm tiềm năng) — xem GH_SHOP. */
export const GH_PTS_PER_GOLD = 10000;
export const GH_MEMBERS_BASE = 8, GH_MEMBERS_MAX = 14, GH_MEMBERS_PER_LV = 3, GH_MEM_LV_PER_GUILD_LV = 2, GH_CATCHUP_GAP = 30;
export const GH_QUEST_PTS = 25, GH_QUEST_FD = 3;
export const GH_BOSS_TRIES = 3, GH_BOSS_WAVES = 4, GH_BOSS_HP_X = 10;
export const GH_BOSS_PTS_BASE = 10, GH_BOSS_PTS_WAVE = 15, GH_BOSS_PTS_WIN = 30, GH_BOSS_FUNDS_BASE = 2000, GH_BOSS_FUNDS_WAVE = 3000;

/* ---------- thành viên NPC (sinh tất định từ seed) ---------- */
const GH_NAME_A = ['Thiết', 'Ngọc', 'Huyết', 'Phong', 'Tuyết', 'Hắc', 'Bạch', 'Kim', 'Thạch', 'Lâm', 'Vân', 'Hỏa', 'Thủy', 'Long', 'Hổ', 'Phi'];
const GH_NAME_B = ['Chưởng', 'Kiếm', 'Đao', 'Quyền', 'Tâm', 'Ảnh', 'Phong', 'Sơn', 'Giang', 'Nguyệt', 'Tinh', 'Vũ', 'Hồn', 'Thiên', 'Địa', 'Long'];
const ghPower = m => Math.round(Math.pow(Math.max(1, m.lvl), 1.6) * (m.v || 1));
function ghGenMember(seed, idx) {
  let s = (seed + idx * 7919) >>> 0;
  const srnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const keys = Object.keys(FAC);
  return {
    name: GH_NAME_A[Math.floor(srnd() * GH_NAME_A.length)] + ' ' + GH_NAME_B[Math.floor(srnd() * GH_NAME_B.length)],
    fac: keys.length ? keys[Math.floor(srnd() * keys.length)] : 'shaolin',
    lvl: Math.max(1, Math.round(S.lvl + (srnd() * 11 - 5))),
    v: 0.8 + srnd() * 0.4,
  };
}
function ghMemSync(g) {
  if (!g.seed) g.seed = 1 + Math.floor(Math.random() * 1e9);       // seed sinh 1 lần rồi lưu — đội hình ổn định theo save
  if (!Array.isArray(g.members)) g.members = [];
  const target = Math.min(GH_MEMBERS_MAX, GH_MEMBERS_BASE + Math.floor((g.lv || 0) / GH_MEMBERS_PER_LV));
  while (g.members.length < target) g.members.push(ghGenMember(g.seed, g.members.length));
  if (g.memLv == null) g.memLv = g.lv || 0;
  if ((g.lv || 0) > g.memLv) { const up = ((g.lv || 0) - g.memLv) * GH_MEM_LV_PER_GUILD_LV; for (const m of g.members) m.lvl += up; g.memLv = g.lv || 0; }
  const avg = g.members.reduce((a, m) => a + m.lvl, 0) / Math.max(1, g.members.length);
  if (S.lvl - avg > GH_CATCHUP_GAP) for (const m of g.members) m.lvl = Math.max(m.lvl, S.lvl - 10);
  return g.members;
}
export function ghMembers() { return ghMemSync(guildState()); }

/* ---------- nhiệm vụ bang theo ngày ---------- */
const GH_QUEST_KINDS = ['kills', 'bosses', 'gold', 'drops', 'dg'];
function ghQuestNeed(kind) {
  const lv = S.lvl;
  switch (kind) {
    case 'kills': return 120 + lv * 3;
    case 'bosses': return 2 + Math.floor(lv / 40);
    case 'gold': return 15000 + lv * 500;
    case 'drops': return 12 + Math.floor(lv / 2);
    case 'dg': return 2;
  }
  return 1;
}
function ghQuestText(q) {
  switch (q.kind) {
    case 'kills': return `Hạ ${fmt(q.need)} quái`;
    case 'bosses': return `Hạ ${fmt(q.need)} trùm`;
    case 'gold': return `Kiếm ${fmt(q.need)} lượng từ quái`;
    case 'drops': return `Nhặt ${fmt(q.need)} món đồ rơi`;
    case 'dg': return `Qua ${fmt(q.need)} lượt phó bản / thuyền`;
  }
  return q.kind;
}
export function ghDaily() {
  const g = guildState(), day = localISODay();
  if (!g.daily || g.daily.day !== day) {
    let h = 0; for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const start = h % GH_QUEST_KINDS.length;
    g.daily = { day, quests: [0, 1, 2].map(i => { const kind = GH_QUEST_KINDS[(start + i) % GH_QUEST_KINDS.length]; return { kind, need: ghQuestNeed(kind), claimed: false }; }) };
  }
  return g.daily;
}
export function ghQuestProgress(q) {
  if (q.kind === 'dg') {                                   // lượt phó bản + thuyền HÔM NAY (dgSave khóa theo ngày của hoatdong)
    const s = RW().dgSave, d = new Date(), dk = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (!s || s.day !== dk) return 0;
    return Object.values(s.runs || {}).reduce((a, b) => a + (b || 0), 0) + (s.boat || 0);
  }
  const j = (S.journal && S.journal.days && S.journal.days[localISODay()]) || {};
  if (q.kind === 'kills') return j.kills || 0;
  if (q.kind === 'bosses') return j.bosses || 0;
  if (q.kind === 'gold') return j.gold || 0;
  if (q.kind === 'drops') return (j.r2 || 0) + (j.r3 || 0) + (j.set || 0) + (j.other || 0);
  return 0;
}
export function ghClaimQuest(i) {
  const g = guildState(), d = ghDaily(), q = d.quests[i];
  if (!q || q.claimed) return { ok: false, msg: 'Đã nhận thưởng nhiệm vụ này' };
  if (ghQuestProgress(q) < q.need) return { ok: false, msg: 'Chưa hoàn thành nhiệm vụ bang' };
  q.claimed = true; g.pts = (g.pts || 0) + GH_QUEST_PTS;
  grant({ fd: GH_QUEST_FD }, 'Nhiệm vụ bang · ' + ghQuestText(q));
  toast(`Nhiệm vụ bang hoàn thành: +${GH_QUEST_PTS} điểm cống hiến`);
  save(); achCheck();
  return { ok: true };
}

/* ---------- Boss Bang (khuôn Tống Kim: đợt tinh anh + trùm, gục/rời vẫn tính đợt đã qua) ---------- */
function ghBossState() { const g = guildState(), w = weekKey(); if (!g.boss || g.boss.week !== w) g.boss = { week: w, tries: 0, best: 0 }; return g.boss; }
function ghAddFunds(amount) {
  const g = guildState(); g.gold += amount; let up = 0;
  while (g.lv < GUILD_MAX && g.gold >= guildCost(g.lv)) { g.gold -= guildCost(g.lv); g.lv++; up++; }
  if (g.lv >= GUILD_MAX) g.gold = 0;
  if (up) R.dirty = true;
  return up;
}
export function gbossStart() {
  if (R.tyvo) { toast('Hãy kết thúc Tỷ Võ trước khi vào Boss Bang'); return; }
  if (!S.fac || R.gboss || SV.on) return;
  if (R.tk || R.dg || R.tower || R.wbArena || R.mvboss) { toast('Hãy kết thúc hoạt động hiện tại trước khi vào Boss Bang'); return; }
  const b = ghBossState();
  if (b.tries >= GH_BOSS_TRIES) { toast('Đã hết lượt Boss Bang tuần này, thứ Hai quay lại'); return; }
  if (R.town) backFromTown();
  b.tries++; save(); R.pickTarget = null; R.gboss = { wave: 1, score: 0, kills: 0 }; R.enemies = []; R.corpses = []; R.spawnT = 0.5;
  toast(`Boss Bang: ${GH_BOSS_WAVES} đợt, đợt cuối là Thủ Lĩnh Phản Bang · gục là kết thúc`); R.logDirty = true;
}
export function gbossSpawn() {
  const w = R.gboss.wave, L = Math.max(10, S.lvl), boss = w === GH_BOSS_WAVES; R.enemies = []; R.stall = 0;
  const z = ZONES[Math.min(ZONES.length - 1, Math.floor(L / 12))], n = boss ? 1 : 3 + w;
  for (let i = 0; i < n; i++) {
    const [x, y] = inWorld(H.x + rnd(-260, 260), H.y + rnd(-220, 220)), e = makeEnemy(boss ? z.boss : pick(z.m), boss ? L + 3 : L, boss ? 'boss' : 'elite', x, y);
    e.hp = e.max = e.max * (boss ? GH_BOSS_HP_X : 1 + 0.12 * w); e.dmg *= 1 + 0.08 * w; e.gboss = true; if (boss) e.n = 'Thủ Lĩnh Phản Bang · ' + e.n;
    R.enemies.push(e);
  }
}
export function gbossCleared() {
  const k = R.gboss; k.score += 50 * k.wave;
  if (k.wave >= GH_BOSS_WAVES) { gbossExit(false, true); return; }
  heal(R.P.life * 0.35, true); R.mana = Math.min(R.P.mana, R.mana + R.P.mana * 0.35);
  k.wave++; R.spawnT = 1.5;
  toast(k.wave === GH_BOSS_WAVES ? 'Thủ Lĩnh Phản Bang xuất hiện — bang chúng theo sau!' : `Đợt ${k.wave}/${GH_BOSS_WAVES} — phản bang kéo đến`);
}
export function gbossExit(dead, won) {
  if (!R.gboss) return;
  const k = R.gboss, b = ghBossState(), cleared = won ? GH_BOSS_WAVES : k.wave - 1;
  const pts = GH_BOSS_PTS_BASE + GH_BOSS_PTS_WAVE * cleared + (won ? GH_BOSS_PTS_WIN : 0);
  const funds = GH_BOSS_FUNDS_BASE + GH_BOSS_FUNDS_WAVE * cleared;
  const g = guildState(); g.pts = (g.pts || 0) + pts; const up = ghAddFunds(funds);
  b.best = Math.max(b.best, cleared);
  const msg = `${won ? 'Thắng Boss Bang!' : dead ? 'Gục ở Boss Bang.' : 'Rời Boss Bang.'} Qua ${cleared}/${GH_BOSS_WAVES} đợt · điểm ${k.score + k.kills} · +${pts} điểm cống hiến · +${fmt(funds)} quỹ bang${up ? ` · BANG LÊN CẤP ${g.lv}!` : ''}`;
  log(`<b class="up">${esc(msg)}</b>`); toast(msg);
  R.gboss = null; R.enemies = []; S.wave = 1; R.spawnT = 0.5; R.zoneShown = null; save();
}

/* ---------- cửa hàng bang (điểm cống hiến — hiệu ứng qua grant / addTimedBuff sẵn có) ---------- */
const GH_SHOP = [
  [50, () => grant({ fd: 20 }, 'Cửa hàng bang'), '20 Phúc Duyên'],
  [60, () => grant({ pot: { kind: 'life', tier: 4, n: 10 } }, 'Cửa hàng bang'), '10 Kim Sáng Dược bậc 4'],
  [80, () => grant({ mat: { g: 'ht', k: htTier(), n: 2 } }, 'Cửa hàng bang'), '2 Huyền Tinh (cấp theo nhân vật)'],
  [100, () => grant({ gold: 15000 }, 'Cửa hàng bang'), '15.000 lượng'],
  [120, () => { addTimedBuff('xp', 30, 30); log('🏯 Cửa hàng bang: Bang chủ truyền công — +30% kinh nghiệm trong 30 phút'); }, 'Truyền công: +30% kinh nghiệm 30 phút'],
  [150, () => grant({ pts: 3 }, 'Cửa hàng bang'), '3 điểm tiềm năng'],
];
function ghBuy(i) {
  const g = guildState(), [c, run, txt] = GH_SHOP[i];
  if ((g.pts || 0) < c) { toast(`Cần ${c} điểm cống hiến`); return; }
  g.pts -= c; run(); toast(`Đã đổi: ${txt}`); save();
}

/* ---------- thân tab Bang hội 2.0 (nối dưới phần góp vàng sẵn có) ---------- */
function gh2Body(g) {
  const mem = ghMembers(), totPow = mem.reduce((a, m) => a + ghPower(m), 0);
  const d = ghDaily(), b = ghBossState(), left = Math.max(0, GH_BOSS_TRIES - b.tries);
  return `<h4 style="margin-top:14px">Điểm cống hiến: <b>${fmt(g.pts || 0)}</b> <small class="dim">(10.000 lượng đóng góp = 1 điểm · nhiệm vụ + Boss Bang cũng cho điểm)</small></h4>
    <h4>Thành viên <small>${mem.length} người · tổng sức mạnh ${fmt(totPow)}</small></h4>
    <div class="gh-mems" style="max-height:180px;overflow-y:auto">${mem.map(m => `<div class="qrow"><span><b>${esc(m.name)}</b><small>${esc(FAC[m.fac] ? FAC[m.fac].n : m.fac)}</small></span><small>Cấp ${m.lvl} · SM ${fmt(ghPower(m))}</small></div>`).join('')}</div>
    <h4>Nhiệm vụ bang hôm nay</h4>
    ${d.quests.map((q, i) => { const p = Math.min(ghQuestProgress(q), q.need); return `<div class="qrow"><span>${esc(ghQuestText(q))}<small>+${GH_QUEST_PTS} điểm cống hiến · +${GH_QUEST_FD} Phúc Duyên</small></span><small>${fmt(p)}/${fmt(q.need)}</small><button class="btn sm" data-gq="${i}" ${q.claimed || p < q.need ? 'disabled' : ''}>${q.claimed ? 'Đã nhận' : 'Nhận'}</button></div>`; }).join('')}
    <h4>Boss Bang <small>tuần này còn ${left}/${GH_BOSS_TRIES} lượt · kỷ lục ${b.best}/${GH_BOSS_WAVES} đợt</small></h4>
    <p class="desc">Dẫn bang chúng nghênh chiến Thủ Lĩnh Phản Bang: ${GH_BOSS_WAVES - 1} đợt tinh anh rồi trùm (máu ×${GH_BOSS_HP_X}), hồi 35% máu giữa đợt. Thắng hay gục đều nhận điểm cống hiến + quỹ bang theo số đợt đã qua.</p>
    <div class="btnrow">${R.gboss ? '<button class="btn red" id="gbOut">Rời Boss Bang</button>' : left <= 0 ? '<button class="btn" disabled>Đã hết lượt tuần này</button>' : '<button class="btn" id="gbGo">Vào Boss Bang</button>'}</div>
    <h4>Cửa hàng bang <small>điểm cống hiến: ${fmt(g.pts || 0)}</small></h4>
    ${GH_SHOP.map(([c, , txt], i) => `<div class="qrow"><span>${txt}</span><small>${c} điểm</small><button class="btn sm" data-ghs="${i}" ${(g.pts || 0) >= c ? '' : 'disabled'}>Đổi</button></div>`).join('')}`;
}

/* Phơi GH cho debug / test E2E (khuôn svExpose của survival.ts / knExpose của kyngo.ts) */
const GH_API = { get state() { return guildState(); }, members: ghMembers, daily: ghDaily, progress: ghQuestProgress, claim: ghClaimQuest, bossState: ghBossState, start: gbossStart, exit: gbossExit, buy: ghBuy, shop: GH_SHOP, donate: guildDonate };
function ghExpose() { try { const g = (window as any).__G; if (g && !('GH' in g)) Object.defineProperty(g, 'GH', { get: () => GH_API }); } catch (e) { /* bo qua */ } }

/* ---------- Tống Kim (1 trận / tuần) ---------- */
const TK_ELITE_WAVES = 5;
export const TK_WAVES = TK_ELITE_WAVES + 1;
function tkState() { const r = RW(); if (!r.tk || r.tk.week !== weekKey()) r.tk = { week: weekKey(), used: 0, best: 0 }; return r.tk; }
function tkTokens() { const r = RW(); r.tkTok = r.tkTok || 0; return r.tkTok; }
export function tkStart() {
  if (R.tyvo) { toast('Hãy kết thúc Tỷ Võ trước khi vào Tống Kim'); return; }
  if (!S.fac || !unlocked(30) || R.tk || R.mvboss || SV.on) return;
  const t = tkState();
  if (t.used >= 1) { toast('Tuần này đã đánh Tống Kim rồi, thứ Hai quay lại'); return; }
  if (R.town) backFromTown();
  if (R.tower) towerExit(false);
  t.used = 1; save(); R.pickTarget = null; R.tk = { wave: 1, score: 0, kills: 0 }; R.enemies = []; R.corpses = []; R.spawnT = 0.5;
  toast(`Chiến trường Tống Kim: ${TK_WAVES} đợt, đợt cuối có Tướng Kim · gục là kết thúc`); R.logDirty = true;
}
export function tkSpawn() {
  const w = R.tk.wave, L = Math.max(10, S.lvl), boss = w === TK_WAVES; R.enemies = []; R.stall = 0;
  const z = ZONES[Math.min(ZONES.length - 1, Math.floor(L / 12))], n = boss ? 1 : 3 + w;
  for (let i = 0; i < n; i++) {
    const [x, y] = inWorld(H.x + rnd(-260, 260), H.y + rnd(-220, 220)), e = makeEnemy(boss ? z.boss : pick(z.m), boss ? L + 2 : L, boss ? 'boss' : 'elite', x, y);
    e.hp = e.max = e.max * (boss ? 1.5 : 1 + 0.12 * w); e.dmg *= 1 + 0.08 * w; e.tk = true; if (boss) { e.goldBoss = true; e.n = 'Tướng Kim · ' + e.n; }
    applyWeekMod(e);
    R.enemies.push(e);
  }
}
export function tkCleared() {
  const k = R.tk; k.score += 50 * k.wave;
  if (k.wave >= TK_WAVES) { tkExit(false, true); return; }
  heal(R.P.life * 0.35, true); R.mana = Math.min(R.P.mana, R.mana + R.P.mana * 0.35);
  k.wave++; R.spawnT = 1.5;
  toast(k.wave === TK_WAVES ? 'Tướng Kim xuất hiện!' : `Đợt ${k.wave}/${TK_WAVES} — quân Kim tiến lên`);
}
export function tkExit(dead, won) {
  if (!R.tk) return;
  const k = R.tk, t = tkState(), cleared = won ? TK_WAVES : k.wave - 1;
  const tok = Math.round((10 + 8 * cleared + (won ? 20 : 0)) * (1 + S.lvl / 100) * weekRewardMul());
  const r = RW(); r.tkTok = (r.tkTok || 0) + tok; t.best = Math.max(t.best, cleared); r.stat.tkWins = (r.stat.tkWins || 0) + (won ? 1 : 0);
  const msg = `${won ? 'Thắng Tống Kim!' : dead ? 'Gục ở Tống Kim.' : 'Rời Tống Kim.'} Qua ${cleared}/${TK_WAVES} đợt · điểm ${k.score + k.kills} · +${tok} Tống Kim Lệnh`;
  log(`<b class="up">${esc(msg)}</b>`); toast(msg);
  R.tk = null; R.enemies = []; S.wave = 1; R.spawnT = 0.5; R.zoneShown = null; save();
}
const htTier = () => Math.max(1, Math.min(10, Math.round(S.lvl / 10)));
/* phan thuong la HAM (goi luc doi) — khong duoc goi htTier() luc module evaluation (S chua co) */
const TK_SHOP = [
  [30, () => [{ mat: { g: 'ht', k: htTier(), n: 2 } }], '2 Huyền Tinh (cấp theo nhân vật)'],
  [40, () => [{ fd: 25 }], '25 Phúc Duyên'],
  [40, () => [{ mat: { g: 'misc', k: 'wc', n: 3 } }, { mat: { g: 'misc', k: 'mys', n: 3 } }], '3 Thủy Tinh Trắng + 3 Thần Bí Khoáng Thạch'],
  [120, () => [{ pts: 4 }], '4 điểm tiềm năng'],
  [120, () => [{ pot: { kind: 'life', tier: 5, n: 20 } }], '20 Kim Sáng Dược bậc 5'],
];
function tkBuy(i) {
  const [c, mk] = TK_SHOP[i]; if (tkTokens() < c) { toast(`Cần ${c} Tống Kim Lệnh`); return; }
  RW().tkTok = tkTokens() - c; for (const g of mk()) grant(g, 'Tống Kim');
}

/* ---------- giao dien (cac the moi cua nut qua tang) ---------- */
export const ACT_TABS = [['yt', 'Dã Tẩu'], ['guild', 'Bang hội'], ['tk', 'Tống Kim'], ['farm', 'Động Phủ'], ['market', 'Thương Hội'], ['bp', 'Đột Phá'], ['wboss', 'Ma Vương']];
export function actBody(tab) {
  if (tab === 'yt') {
    mvExpose();
    const y = ytState(), st = ytStep(), mv = mvInfo();
    return `<div class="btnrow"><button class="btn" id="mvGo">👹 Ma Vương Thảo Phạt — đua sát thương boss mỗi ngày · <b>${esc(mv.boss)}</b> (hệ ${esc(mv.elem)}) · tổng hôm nay <b>${fmt(mv.total)}</b> · hạng <b>${mv.rank}</b> · còn <b>${mv.left}</b> lượt</button></div>
      <p class="desc">Chuỗi nhiệm vụ Dã Tẩu (bước ${y.i + 1}): hút đồ thừa và nguyên liệu dư, thưởng nhỏ nhưng không giới hạn ngày.</p>
      <div class="qrow"><span><b>${esc(st.txt)}</b><small>${giftText(st.rw)}</small></span><small>${y.have}/${st.n}</small>
      <button class="btn sm" id="ytGo" ${y.done ? '' : ytDeliverable() ? '' : 'disabled'}>${y.done ? 'Nhận' : st.t === 'item' || st.t === 'mats' ? 'Nộp' : 'Đang làm'}</button></div>`;
  }
  if (tab === 'guild') {
    ghExpose(); fpExpose(); mkExpose(); bpExpose();
    const g = guildState(), b = guildBuff(), full = g.lv >= GUILD_MAX, c = guildCost(g.lv), pct = full ? 100 : Math.floor(g.gold / c * 100), fpReady = farmReadyCount(), mkMove = mkBestMove(), bpInf = bpInfo();
    return `<p class="desc">Bang hội (NPC): đóng góp ngân lượng để lên cấp, mỗi cấp mở thêm buff nhỏ (tối đa cấp ${GUILD_MAX}: +10% kinh nghiệm, +10% sinh lực, +5% sát thương, +5 may mắn).</p>
      <div class="btnrow"><button class="btn" id="fpGo">🌱 Động Phủ / Vườn Thuốc — trồng linh thảo theo thời gian${fpReady ? ` · <b>${fpReady} ô sẵn sàng thu hoạch!</b>` : ''}</button></div>
      <div class="btnrow"><button class="btn" id="mkGo">🏮 Thương Hội / Chợ — mua bán theo giá biến động mỗi ngày${mkMove && mkMove.pct ? ` · <b>${esc(mkMove.name)} hôm nay ${mkMove.pct > 0 ? '▲ +' : '▼ '}${mkMove.pct}%</b>` : ''}</button></div>
      <div class="btnrow"><button class="btn" id="bpGo">⚡ Đột Phá Cảnh Giới — đả thông kinh mạch, mỗi tầng +4% sức mạnh vĩnh viễn · <b>${esc(bpInf.name)}</b>${bpInf.chance != null ? ` · tỉ lệ tầng kế <b>${bpInf.chance}%</b>` : ' · 👑 ĐÃ ĐẠT ĐỈNH'}</button></div>
      <div class="card stats"><span>Cấp bang</span><span>${g.lv}/${GUILD_MAX}</span><span>Kinh nghiệm</span><span>+${b.xp}%</span><span>Sinh lực</span><span>+${b.life}%</span><span>Sát thương</span><span>+${b.dmg}%</span><span>May mắn</span><span>+${b.lucky}</span>
      <span>Tiến độ cấp kế</span><span>${full ? 'Tối đa' : fmt(g.gold) + ' / ' + fmt(c) + ' (' + pct + '%)'}</span></div>
      ${full ? '' : [c / 10, c / 2, c].map(a => `<div class="btnrow"><small>${fmt(a)} lượng</small><button class="btn" data-gd="${Math.round(a)}" ${S.gold >= a ? '' : 'disabled'}>Đóng góp</button></div>`).join('')}
      ${gh2Body(g)}`;
  }
  if (tab === 'tk') {
    const t = tkState();
    return `<p class="dim small">Luật tuần này: ${weekModsText()}</p><p class="desc">Chiến trường Tống Kim: mỗi tuần 1 trận, ${TK_ELITE_WAVES} đợt tinh anh rồi Tướng Kim. Thưởng Tống Kim Lệnh theo số đợt vượt qua, đổi nguyên liệu và Phúc Duyên (không đổi đồ Hoàng Kim). Gục là kết thúc, vẫn nhận lệnh theo số đợt đã qua.</p>
      <p>Tống Kim Lệnh: <b>${tkTokens()}</b> · tuần này: ${t.used ? 'đã đánh' : 'chưa đánh'} · kỷ lục tuần: ${t.best}/${TK_WAVES}</p>
      <div class="btnrow">${R.tk ? '<button class="btn red" id="tkOut">Rời trận</button>' : !unlocked(30) ? '<button class="btn" disabled>Cần cấp 30</button>' : t.used ? '<button class="btn" disabled>Đã đánh tuần này</button>' : '<button class="btn" id="tkGo">Vào chiến trường</button>'}</div>
      ${TK_SHOP.map(([c, , txt], i) => `<div class="qrow"><span>${txt}</span><small>${c} lệnh</small><button class="btn sm" data-tk="${i}" ${tkTokens() >= c ? '' : 'disabled'}>Đổi</button></div>`).join('')}`;
  }
  if (tab === 'farm') return farmBody();
  if (tab === 'market') return marketBody();
  if (tab === 'bp') return bpBody();
  if (tab === 'wboss') return mvBody();
  return null;
}
export function actBind(refreshGift) {
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('#ytGo', () => { const y = ytState(); if (y.done) ytClaim(); else { const r = ytDeliver(); toast(r.msg); } refreshGift(); });
  on('#tkGo', tkStart); on('#tkOut', () => { tkExit(false); refreshGift(); });
  on('#gbGo', gbossStart); on('#gbOut', () => { gbossExit(false, false); refreshGift(); });
  on('#fpGo', () => openGiftTab('farm'));
  on('#mkGo', () => openGiftTab('market'));
  on('#bpGo', () => openGiftTab('bp'));
  on('#mvGo', () => openGiftTab('wboss'));
  farmBind(refreshGift);
  marketBind(refreshGift);
  bpBind(refreshGift);
  mvBind(refreshGift);
  document.querySelectorAll('#mBody [data-gd]').forEach(x => x.onclick = () => { const r = guildDonate(+x.dataset.gd); toast(r.msg); save(); refreshGift(); });
  document.querySelectorAll('#mBody [data-tk]').forEach(x => x.onclick = () => { tkBuy(+x.dataset.tk); refreshGift(); });
  document.querySelectorAll('#mBody [data-gq]').forEach(x => x.onclick = () => { const r = ghClaimQuest(+x.dataset.gq); if (!r.ok) toast(r.msg); refreshGift(); });
  document.querySelectorAll('#mBody [data-ghs]').forEach(x => x.onclick = () => { ghBuy(+x.dataset.ghs); refreshGift(); });
}

/* Badge cho hang nut nhanh the Giang ho: '!' khi co viec lam duoc */
export function tkBadge() { try { const t = tkState(); return unlocked(30) && !t.used ? '!' : ''; } catch (e) { return ''; } }
export function ytBadge() { try { const y = ytState(); return y.done || ytDeliverable() ? '!' : ''; } catch (e) { return ''; } }
export function guildBadge() { try { const d = ghDaily(); return d.quests.some(q => !q.claimed && ghQuestProgress(q) >= q.need) ? '!' : ''; } catch (e) { return ''; } }
