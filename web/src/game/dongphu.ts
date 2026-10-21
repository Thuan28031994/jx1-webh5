// @ts-nocheck — ĐỘNG PHỦ / VƯỜN THUỐC (f32): trồng linh thảo theo THỜI GIAN THẬT —
// cây lớn cả khi đóng game (tính từ mốc `at` lúc gieo, so với Date.now() khi mở vườn /
// thao tác), không cần vòng tick. Thu hoạch đổi ra nguyên liệu qua grant() sẵn có.
// Hằng số cân bằng:
//   FP_START_PLOTS = 3 — ô mở sẵn; FP_MAX_PLOTS = 8 — trần ô đất.
//   FP_UNLOCK[i] — mở ô thứ i (4..8): { lvl, gold } cấp yêu cầu + lượng, mở TUẦN TỰ từng ô.
//   FP_CROPS — 5 loại thảo: dur giây lớn, seed lượng gieo, yield qua grant()
//     (fd = Phúc Duyên, ht = Huyền Tinh cấp theo nhân vật như kyngo, pot = thuốc, pts = điểm
//     tiềm năng), knbC = tỉ lệ rơi thêm 1 Kim Nguyên Bảo (knbGain của ktc.ts).
//   FP_BOOST_FD = 5 — bón linh khí tốn 5 Phúc Duyên, FP_BOOST_CUT = 0.5 — cắt 50% thời
//     gian còn lại (dịch mốc `at` lùi về quá khứ), chỉ khi cây đang lớn chưa chín.
// Trạng thái lưu ở RW().farm = { plots: [null | { crop, at, dur }], unlocked, total }
// (tự khởi tạo lười như kyngoState/guildState — KHÔNG sửa RW() trong rewards.ts).
'use strict';
import { clamp, esc, fmt } from './core';
import { RW, grant } from './rewards';
import { S, save } from './save';
import { knbGain } from './ktc';
import { toast } from './ui';

export const FP_START_PLOTS = 3;       // ô đất mở sẵn
export const FP_MAX_PLOTS = 8;         // tổng số ô tối đa
export const FP_BOOST_FD = 5;          // Phúc Duyên mỗi lần bón linh khí
export const FP_BOOST_CUT = 0.5;       // tỉ lệ thời gian còn lại bị cắt khi bón
/* Mở ô thứ n (khoá là số ô): yêu cầu cấp + lượng — mở tuần tự, không nhảy ô. */
export const FP_UNLOCK = { 4: { lvl: 15, gold: 10000 }, 5: { lvl: 25, gold: 30000 }, 6: { lvl: 35, gold: 80000 }, 7: { lvl: 50, gold: 200000 }, 8: { lvl: 65, gold: 500000 } };

const htLvl = () => clamp(Math.floor(S.lvl / 15) + 1, 1, 10);   // cấp Huyền Tinh theo cấp nhân vật (khuôn kyngo/hoatdong)

/* yield: { fd, ht (số Huyền Tinh), pot (thuốc qua grant), pts (điểm tiềm năng) } — mọi khóa đều đã verify trong grant(). */
export const FP_CROPS = [
  { id: 'linhchi', icon: '🌿', name: 'Linh Chi Thảo', dur: 1800, seed: 200, minLvl: 1, yield: { fd: 6, ht: 1 }, knbC: 0 },
  { id: 'tienthao', icon: '🍀', name: 'Tiên Thảo', dur: 7200, seed: 800, minLvl: 1, yield: { fd: 4, ht: 2 }, knbC: 0 },
  { id: 'huyettham', icon: '🌱', name: 'Huyết Sâm', dur: 14400, seed: 2000, minLvl: 1, yield: { fd: 8, pot: { kind: 'life', tier: 2, n: 3 } }, knbC: 0 },
  { id: 'ngoclo', icon: '🌸', name: 'Ngọc Lộ Hoa', dur: 28800, seed: 5000, minLvl: 1, yield: { fd: 15, ht: 4 }, knbC: 0.2 },
  { id: 'kimlien', icon: '🪷', name: 'Kim Liên', dur: 43200, seed: 12000, minLvl: 40, yield: { fd: 25, ht: 6, pts: 1 }, knbC: 0.35 },
];
export const fpCrop = id => FP_CROPS.find(c => c.id === id);

/* ---------- trạng thái (RW().farm) ---------- */
export function farmState() {
  const r = RW(), f = r.farm = r.farm || {};
  if (!Array.isArray(f.plots)) f.plots = [];
  f.plots.length = FP_MAX_PLOTS;
  for (let i = 0; i < FP_MAX_PLOTS; i++) if (f.plots[i] === undefined) f.plots[i] = null;
  if (f.unlocked == null) f.unlocked = FP_START_PLOTS;
  f.unlocked = clamp(Math.floor(f.unlocked) || FP_START_PLOTS, FP_START_PLOTS, FP_MAX_PLOTS);
  if (f.total == null) f.total = 0;
  fpExpose();
  return f;
}

/* ---------- thời gian (thuần timestamp — chạy cả khi offline) ---------- */
const fpElapsed = p => (Date.now() - p.at) / 1000;                       // giây đã lớn
export const fpRemaining = p => p ? Math.max(0, p.dur - fpElapsed(p)) : 0;   // giây còn lại
export const fpReady = p => !!p && fpRemaining(p) <= 0;
export const farmReadyCount = () => { try { return farmState().plots.filter(fpReady).length; } catch (e) { return 0; } };
export function fmtDur(sec) {                       // "8 giờ 0 phút" / "29 phút 12 giây" / "45 giây"
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (h) return `${h} giờ ${m} phút`;
  if (m) return `${m} phút ${s} giây`;
  return `${s} giây`;
}
function yieldText(c) {
  const y = c.yield, out = [];
  if (y.fd) out.push(`+${y.fd} Phúc Duyên`);
  if (y.ht) out.push(`${y.ht} Huyền Tinh`);
  if (y.pot) out.push(`${y.pot.n} Kim Sáng Dược`);
  if (y.pts) out.push(`+${y.pts} điểm tiềm năng`);
  if (c.knbC) out.push(`${Math.round(c.knbC * 100)}% ra 1 KNB`);
  return out.join(', ');
}

/* ---------- thao tác ---------- */
export function fpPlant(i, cropId) {
  const f = farmState(), c = fpCrop(cropId);
  if (!c || i < 0 || i >= f.unlocked) return { ok: false, msg: 'Ô đất không hợp lệ' };
  if (f.plots[i]) return { ok: false, msg: 'Ô này đã có cây' };
  if (S.lvl < c.minLvl) return { ok: false, msg: `${c.name} cần cấp ${c.minLvl}` };
  if (S.gold < c.seed) return { ok: false, msg: `Gieo ${c.name} cần ${fmt(c.seed)} lượng` };
  S.gold -= c.seed;
  f.plots[i] = { crop: c.id, at: Date.now(), dur: c.dur };
  save();
  return { ok: true, msg: `Đã gieo ${c.name} — chín sau ${fmtDur(c.dur)}` };
}
export function fpHarvest(i) {
  const f = farmState(), p = f.plots[i];
  if (!p) return { ok: false, msg: 'Ô trống' };
  if (!fpReady(p)) return { ok: false, msg: `Chưa chín — còn ${fmtDur(fpRemaining(p))}` };
  const c = fpCrop(p.crop); if (!c) { f.plots[i] = null; save(); return { ok: false, msg: 'Cây lạ đã héo' }; }
  const g = {};
  if (c.yield.fd) g.fd = c.yield.fd;
  if (c.yield.ht) g.mat = { g: 'ht', k: htLvl(), n: c.yield.ht };
  if (c.yield.pot) g.pot = c.yield.pot;
  if (c.yield.pts) g.pts = c.yield.pts;
  grant(g, `Động Phủ thu hoạch «${c.name}»`);
  let bonus = '';
  if (c.knbC && Math.random() < c.knbC) { knbGain(1); bonus = ' May mắn: thêm 1 Kim Nguyên Bảo!'; }
  f.plots[i] = null; f.total++;
  save();
  return { ok: true, msg: `Thu hoạch ${c.name} xong.${bonus}` };
}
export function fpHarvestAll() {
  const f = farmState(); let n = 0, msg = '';
  for (let i = 0; i < f.unlocked; i++) if (fpReady(f.plots[i])) { const r = fpHarvest(i); if (r.ok) { n++; msg = r.msg; } }
  return n ? { ok: true, msg: `Đã thu hoạch ${n} ô.${msg.includes('Kim Nguyên Bảo') ? ' Có ô ra KNB!' : ''}` } : { ok: false, msg: 'Chưa có ô nào chín' };
}
export function fpBoost(i) {
  const f = farmState(), p = f.plots[i];
  if (!p) return { ok: false, msg: 'Ô trống' };
  if (fpReady(p)) return { ok: false, msg: 'Cây đã chín — thu hoạch đi' };
  const r = RW(); if ((r.fd || 0) < FP_BOOST_FD) return { ok: false, msg: `Bón linh khí cần ${FP_BOOST_FD} Phúc Duyên` };
  const left = fpRemaining(p), cut = left * FP_BOOST_CUT;
  r.fd -= FP_BOOST_FD;
  p.at -= Math.round(cut * 1000);                    // dịch mốc gieo lùi → còn lại giảm 50%
  save();
  return { ok: true, msg: `Bón linh khí: rút ngắn ${fmtDur(cut)} — còn ${fmtDur(fpRemaining(p))}` };
}
export function fpUnlock() {
  const f = farmState();
  if (f.unlocked >= FP_MAX_PLOTS) return { ok: false, msg: 'Đã mở hết ô đất' };
  const n = f.unlocked + 1, u = FP_UNLOCK[n]; if (!u) return { ok: false, msg: 'Không mở được ô này' };
  if (S.lvl < u.lvl) return { ok: false, msg: `Mở ô ${n} cần cấp ${u.lvl}` };
  if (S.gold < u.gold) return { ok: false, msg: `Mở ô ${n} cần ${fmt(u.gold)} lượng` };
  S.gold -= u.gold; f.unlocked = n;
  save();
  return { ok: true, msg: `Đã mở ô đất ${n}!` };
}

/* ---------- giao diện (thân tab Động Phủ trong modal Phần thưởng) ---------- */
export function farmBody() {
  fpExpose();
  const f = farmState(), r = RW(), ready = farmReadyCount();
  const cards = [];
  for (let i = 0; i < FP_MAX_PLOTS; i++) {
    if (i >= f.unlocked) {                                   // ô khoá
      const u = FP_UNLOCK[i + 1], next = i === f.unlocked;
      cards.push(`<div class="card farm-plot lock"><b>🔒 Ô đất ${i + 1}</b><small class="dim">${u ? `Cần cấp ${u.lvl} · ${fmt(u.gold)} lượng` : ''}</small>
        <div class="btnrow"><button class="btn sm" data-fp-unlock ${next && S.lvl >= (u ? u.lvl : 1e9) && S.gold >= (u ? u.gold : 1e18) ? '' : 'disabled'}>${next ? 'Mở ô' : 'Mở ô trước đã'}</button></div></div>`);
      continue;
    }
    const p = f.plots[i];
    if (!p) {                                                // ô trống: bảng chọn cây
      cards.push(`<div class="card farm-plot"><b>Ô đất ${i + 1} — trống</b>${FP_CROPS.map(c => `<div class="qrow"><span>${c.icon} <b>${esc(c.name)}</b><small>Lớn ${fmtDur(c.dur)} · hạt ${fmt(c.seed)} lượng${c.minLvl > 1 ? ` · cần cấp ${c.minLvl}` : ''}<br>Thu: ${yieldText(c)}</small></span><button class="btn sm" data-fp-plant="${i}:${c.id}" ${S.gold >= c.seed && S.lvl >= c.minLvl ? '' : 'disabled'}>Gieo</button></div>`).join('')}</div>`);
      continue;
    }
    const c = fpCrop(p.crop) || FP_CROPS[0], left = fpRemaining(p);
    if (left <= 0) {                                         // sẵn sàng thu hoạch
      cards.push(`<div class="card farm-plot ready" style="border-color:var(--gold)"><b>${c.icon} ${esc(c.name)} — ✨ chín rồi!</b><small>Thu: ${yieldText(c)}</small>
        <div class="btnrow"><button class="btn" data-fp-harvest="${i}">Thu hoạch</button></div></div>`);
    } else {                                                 // đang lớn
      const pct = clamp(Math.floor((1 - left / p.dur) * 100), 0, 100);
      cards.push(`<div class="card farm-plot"><b>${c.icon} ${esc(c.name)}</b><small>Còn ${fmtDur(left)} (${pct}%)</small>
        <div style="background:#2a2f3a;height:8px;border-radius:4px;margin:6px 0"><div style="background:#7bc47f;height:8px;border-radius:4px;width:${pct}%"></div></div>
        <div class="btnrow"><button class="btn sm" data-fp-boost="${i}" ${(r.fd || 0) >= FP_BOOST_FD ? '' : 'disabled'}>Bón linh khí (${FP_BOOST_FD} Phúc Duyên) −50% giờ</button></div></div>`);
    }
  }
  return `<p class="desc">Động Phủ — Vườn Thuốc: gieo linh thảo xuống ô đất, cây lớn theo <b>thời gian thật</b> (đi offline cây vẫn lớn). Thu hoạch lấy Phúc Duyên, Huyền Tinh, thuốc và điểm tiềm năng.</p>
    <div class="card stats"><span>Ô đất</span><span>${f.unlocked}/${FP_MAX_PLOTS}</span><span>Tổng lượt thu hoạch</span><span>${f.total}</span><span>Phúc Duyên hiện có</span><span>${r.fd || 0}</span><span>Ô sẵn sàng</span><span>${ready}</span></div>
    ${ready ? '<div class="btnrow"><button class="btn" id="fpAll">Thu hoạch tất cả (' + ready + ' ô)</button></div>' : ''}
    <div class="farm-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;margin-top:8px">${cards.join('')}</div>`;
}
export function farmBind(refreshGift) {
  const rf = () => { if (refreshGift) refreshGift(); };
  document.querySelectorAll('#mBody [data-fp-plant]').forEach(x => x.onclick = () => { const [i, id] = x.dataset.fpPlant.split(':'); const r = fpPlant(+i, id); toast(r.msg); rf(); });
  document.querySelectorAll('#mBody [data-fp-harvest]').forEach(x => x.onclick = () => { const r = fpHarvest(+x.dataset.fpHarvest); toast(r.msg); rf(); });
  document.querySelectorAll('#mBody [data-fp-boost]').forEach(x => x.onclick = () => { const r = fpBoost(+x.dataset.fpBoost); toast(r.msg); rf(); });
  document.querySelectorAll('#mBody [data-fp-unlock]').forEach(x => x.onclick = () => { const r = fpUnlock(); toast(r.msg); rf(); });
  const all = document.querySelector('#mBody #fpAll'); if (all) all.onclick = () => { const r = fpHarvestAll(); toast(r.msg); rf(); };
}

/* Test/debug: phơi FP cho __G (khuôn knExpose của kyngo / ghExpose của activities). */
const FP_API = { get state() { return farmState(); }, crops: FP_CROPS, plant: fpPlant, harvest: fpHarvest, harvestAll: fpHarvestAll, boost: fpBoost, unlock: fpUnlock, ready: farmReadyCount, remaining: fpRemaining, body: farmBody };
export function fpExpose() { try { const g = (window as any).__G; if (g && !('FP' in g)) Object.defineProperty(g, 'FP', { get: () => FP_API }); } catch (e) { /* bo qua */ } }
