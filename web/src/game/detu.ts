// @ts-nocheck — ĐỆ TỬ / THU NHẬN MÔN ĐỒ (f37): tuyển đệ tử NPC, phân công việc,
// đệ tử tự làm việc theo THỜI GIAN THẬT (mốc `since`, chạy cả khi offline như Động
// Phủ) rồi quay lại THU thành quả. Vòng chơi: đốt Phúc Duyên tuyển người → cầu may
// PHẨM CHẤT lúc thu nhận → phân công theo nhu cầu (XP / Huyền Tinh / lượng) →
// quay lại thu hoạch, đệ tử lên cấp thì sản lượng tăng theo.
//
// Hằng số cân bằng:
//   DT_COST_FD = 20 — Phúc Duyên mỗi lần thu nhận.
//   Ô đệ tử: DT_CAP = min(6, 2 + floor(cấp người chơi / 25)) — cấp 0–24: 2 ô,
//     25: 3, 50: 4, 75: 5, 100+: 6.
//   DT_QUAL — phẩm chất, tung 1 số [0,1) lúc thu nhận (Math.random, LƯU vào đệ tử):
//     Thường 62% (hệ số ×1.0, xám) · Lương Tài 26% (×1.5, xanh) · Tinh Anh 9%
//     (×2.2, tím) · Thiên Tài 3% (×3.5, vàng). DANH TÍNH (tên + môn phái) thì
//     TẤT ĐỊNH theo (seed save, số thứ tự thu nhận) — khuôn ghGenMember của f31,
//     cùng save luôn sinh cùng một dãy người; chỉ phẩm chất là may rủi.
//   DT_CAP_H = 8 — mỗi đệ tử tích tối đa 8 giờ (khớp trần offline của game);
//     phần thời gian thừa sau 8 giờ không tính.
//   Sản lượng/giờ = MỨC GỐC × dtRate, với dtRate = hệ số phẩm chất
//     × (1 + 0.1 × (cấp đệ tử − 1)) × hệ số người chơi
//     (1 + floor(cấp người chơi / 50) × 0.5 — mốc 50/100/150… để thu nhập không
//     bị bỏ lại ở hậu kỳ):
//     · 'luyen' Luyện Công: 60 XP/giờ → trao qua gainXp() của combat (đã gồm
//       buff chuyển sinh/bang hội như XP tự đánh; grant() KHÔNG có khoá xp).
//     · 'hai' Hái Thuốc: 0.5 Huyền Tinh/giờ (cấp vật liệu htLvl như kyngo) —
//       cộng dồn phần lẻ vào d.htAcc, chỉ lấy phần nguyên khi thu (không mất
//       lẻ qua các lần thu). Thêm kỳ vọng Phúc Duyên: mỗi GIỜ TRÒN +0.1 vào
//       d.fdAcc, đủ 1.0 thì trả 1 Phúc Duyên (tương đương "10% mỗi giờ" nhưng
//       TẤT ĐỊNH, không tung xu từng lần thu).
//     · 'du' Du Ngoạn: 300 lượng/giờ (cộng thẳng S.gold như lượng rơi quái —
//       grant({gold}) có hệ số ẩn (1+cấp/10) làm lệch công thức nên không dùng)
//       + mỗi khối 4 giờ 1 lần "chiến lợi phẩm" tung TẤT ĐỊNH theo
//       (seed, id đệ tử, số khối đã lãnh d.duBlocks): thuốc sinh lực cấp 1/2,
//       thuốc nội lực cấp 1/2, hoặc +2 Phúc Duyên (qua grant pot/fd).
//   Đệ tử lên cấp: khi thu nhận được floor(giờ × 10) XP đệ tử; lên cấp khi
//     xp >= cấp hiện tại × 40 (cấp 1→2: 40 XP = 4 giờ công). Sản lượng của lần
//     thu tính theo cấp TRƯỚC khi cộng XP lần thu đó.
//   Đổi việc: THU TỰ ĐỘNG phần đã tích của việc cũ trước rồi mới đổi (không mất
//     giờ công). Xuống núi: xoá hẳn đệ tử, trống ô, không hoàn Phúc Duyên.
// State: RW().dt = { list: [{ id, name, sect (khoá FAC), qual 0..3, lvl, xp,
//   job: 'luyen'|'hai'|'du', since (epoch ms), htAcc, fdAcc, duBlocks }],
//   recruited (tổng số đã thu nhận — cũng là nguồn id/seed danh tính, không
//   tái sử dụng), lastCollect, seed } — khởi tạo lười, KHÔNG sửa RW().
'use strict';
import { FAC, clamp, esc, fmt } from './core';
import { RW, grant, openGiftTab } from './rewards';
import { S, save } from './save';
import { gainXp } from './combat';
import { log, modal, toast } from './ui';

export const DT_COST_FD = 20;          // Phúc Duyên mỗi lần thu nhận
export const DT_CAP_MAX = 6;           // trần ô đệ tử
export const DT_CAP_H = 8;             // giờ tích tối đa mỗi đệ tử
export const DT_MIN_H = 0.05;          // giờ tích tối thiểu để thu (3 phút)
export const DT_XP_H = 60;             // luyện công: XP/giờ ở hệ số 1.0
export const DT_HT_H = 0.5;            // hái thuốc: Huyền Tinh/giờ ở hệ số 1.0
export const DT_GOLD_H = 300;          // du ngoạn: lượng/giờ ở hệ số 1.0
export const DT_DISC_XP_H = 10;        // XP đệ tử nhận mỗi giờ khi thu
export const DT_LVL_XP = 40;           // lên cấp cần cấp hiện tại × 40 XP đệ tử
export const DT_DU_BLOCK_H = 4;        // du ngoạn: mỗi 4 giờ 1 lần chiến lợi phẩm

/* Phẩm chất: cum = ngưỡng tung tích luỹ; mul = hệ số sản lượng; col = màu hiển thị. */
export const DT_QUAL = [
  { name: 'Thường', col: '#b8b0a0', mul: 1.0, cum: 0.62 },
  { name: 'Lương Tài', col: '#6aa8ff', mul: 1.5, cum: 0.88 },
  { name: 'Tinh Anh', col: '#c77bff', mul: 2.2, cum: 0.97 },
  { name: 'Thiên Tài', col: '#ffd24a', mul: 3.5, cum: 1.0 },
];
export const DT_JOBS = {
  luyen: { icon: '🧘', name: 'Luyện Công' },
  hai: { icon: '🌿', name: 'Hái Thuốc' },
  du: { icon: '🧭', name: 'Du Ngoạn' },
};
const DT_HO = ['Trần', 'Nguyễn', 'Lý', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lê', 'Trịnh', 'Đinh', 'Mai'];
const DT_TEN = ['Văn Đức', 'Thanh Tùng', 'Ngọc Anh', 'Minh Quân', 'Hoài Nam', 'Tuấn Kiệt', 'Bảo Long', 'Xuân Trường', 'Hữu Phước', 'Đức Anh', 'Thanh Hà', 'Ngọc Trâm', 'Thùy Linh', 'Phương Thảo', 'Kim Ngân', 'Hải Yến'];

const htLvl = () => clamp(Math.floor(S.lvl / 15) + 1, 1, 10);   // cấp Huyền Tinh theo cấp nhân vật (khuôn kyngo)
function hash53(str, seed = 0) {   // cyrb53 — cùng họ mavuong/thuonghoi
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/* ---------- trạng thái (RW().dt) ---------- */
export function dtState() {
  const r = RW(), d = r.dt = r.dt || {};
  if (!Array.isArray(d.list)) d.list = [];
  if (d.recruited == null) d.recruited = 0;
  if (d.lastCollect == null) d.lastCollect = 0;
  if (!d.seed) d.seed = 1 + Math.floor(Math.random() * 1e9);       // seed sinh 1 lần rồi lưu (khuôn guild f31)
  for (const x of d.list) {                                        // bổ sung trường cho save cũ / dữ liệu lệch
    if (x.lvl == null) x.lvl = 1; if (x.xp == null) x.xp = 0;
    if (!DT_JOBS[x.job]) x.job = 'luyen';
    if (!x.since) x.since = Date.now();
    if (x.htAcc == null) x.htAcc = 0; if (x.fdAcc == null) x.fdAcc = 0; if (x.duBlocks == null) x.duBlocks = 0;
  }
  dtExpose();
  return d;
}
export const dtCap = () => Math.min(DT_CAP_MAX, 2 + Math.floor((S ? S.lvl : 1) / 25));
export const dtFind = id => dtState().list.find(x => x.id === id) || null;
export const dtSectName = d => (FAC[d.sect] ? FAC[d.sect].n : d.sect) || '';

/* ---------- sinh danh tính tất định (khuôn ghGenMember — LCG theo seed + thứ tự) ---------- */
export function dtGen(seed, idx) {
  let s = ((seed || 1) + idx * 7919) >>> 0;
  const srnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const keys = Object.keys(FAC);
  return {
    name: DT_HO[Math.floor(srnd() * DT_HO.length)] + ' ' + DT_TEN[Math.floor(srnd() * DT_TEN.length)],
    sect: keys.length ? keys[Math.floor(srnd() * keys.length)] : 'shaolin',
  };
}
export const dtQualOf = roll => { for (let i = 0; i < DT_QUAL.length; i++) if (roll < DT_QUAL[i].cum) return i; return DT_QUAL.length - 1; };

/* ---------- sản lượng ---------- */
export const dtPlayerFactor = () => 1 + Math.floor((S ? S.lvl : 1) / 50) * 0.5;
export const dtRate = d => (DT_QUAL[d.qual] ? DT_QUAL[d.qual].mul : 1) * (1 + 0.1 * (Math.max(1, d.lvl || 1) - 1)) * dtPlayerFactor();
export const dtHours = (d, now) => clamp(((now || Date.now()) - (d.since || Date.now())) / 3600000, 0, DT_CAP_H);
/* Tính thành quả của h giờ (h đã kẹp trần) — hàm thuần, KHÔNG đổi state (htCarry/fdPreview chỉ để hiển thị + đối chiếu). */
export function dtRewardFor(d, h) {
  const rate = dtRate(d), out = { xp: 0, gold: 0, ht: 0, fd: 0, pots: [], blocks: 0, htCarry: d.htAcc || 0, fdPreview: 0 };
  if (d.job === 'luyen') out.xp = Math.round(DT_XP_H * h * rate);
  else if (d.job === 'hai') {
    const raw = h * rate * DT_HT_H + (d.htAcc || 0);
    out.ht = Math.floor(raw); out.htCarry = raw - out.ht;
    out.fdPreview = Math.floor((d.fdAcc || 0) + Math.floor(h) * 0.1);
  } else if (d.job === 'du') {
    out.gold = Math.round(DT_GOLD_H * h * rate);
    out.blocks = Math.floor(h / DT_DU_BLOCK_H);
  }
  return out;
}
export function dtPending(id) {
  const d = dtFind(id); if (!d) return null;
  const h = dtHours(d), rw = dtRewardFor(d, h);
  return { id: d.id, job: d.job, hours: h, rate: dtRate(d), xp: rw.xp, gold: rw.gold, ht: rw.ht, fd: rw.fdPreview, pots: rw.pots, blocks: rw.blocks };
}
export function dtInfo() {
  try {
    const d = dtState();
    let pendingH = 0; for (const x of d.list) pendingH += dtHours(x);
    return { n: d.list.length, cap: dtCap(), pendingH: Math.round(pendingH * 10) / 10 };
  } catch (e) { return { n: 0, cap: 0, pendingH: 0 }; }
}
function fmtHours(h) {
  if (h < 1) return `${Math.round(h * 60)} phút`;
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return mm ? `${hh} giờ ${mm} phút` : `${hh} giờ`;
}
function rwText(rw) {
  const o = [];
  if (rw.xp) o.push(`${fmt(rw.xp)} XP`);
  if (rw.gold) o.push(`${fmt(rw.gold)} lượng`);
  if (rw.ht) o.push(`${rw.ht} Huyền Tinh`);
  if (rw.fd) o.push(`+${rw.fd} Phúc Duyên`);
  for (const p of rw.pots || []) o.push(`${p.n} ${p.kind === 'life' ? 'Kim Sáng Dược' : 'Ngưng Thần đan'} cấp ${p.tier}`);
  return o.join(' · ');
}

/* ---------- thu nhận ---------- */
export function dtRecruit(qualRoll) {
  const d = dtState(), r = RW();
  if (d.list.length >= dtCap()) return { ok: false, msg: `Đã đầy ô đệ tử (${d.list.length}/${dtCap()}) — lên cấp để mở thêm ô` };
  if ((r.fd || 0) < DT_COST_FD) return { ok: false, msg: `Thu nhận cần ${DT_COST_FD} Phúc Duyên` };
  r.fd -= DT_COST_FD;
  const idx = d.recruited, g = dtGen(d.seed, idx);
  const roll = (typeof qualRoll === 'number' && qualRoll >= 0 && qualRoll < 1) ? qualRoll : Math.random();
  const x = { id: idx, name: g.name, sect: g.sect, qual: dtQualOf(roll), lvl: 1, xp: 0, job: 'luyen', since: Date.now(), htAcc: 0, fdAcc: 0, duBlocks: 0 };
  d.list.push(x); d.recruited++;
  save();
  return { ok: true, d: x, msg: `Đã thu nhận ${x.name}` };
}

/* ---------- thu thành quả (lõi — dùng cho thu tay, thu tất cả, đổi việc) ---------- */
export function dtCollect(id) {
  const d = dtFind(id); if (!d) return { ok: false, msg: 'Không thấy đệ tử' };
  const h = dtHours(d);
  if (h < DT_MIN_H) return { ok: false, msg: 'Chưa tích được giờ công nào đáng kể' };
  const rw = dtRewardFor(d, h), st = dtState(), lvl0 = d.lvl;
  if (d.job === 'hai') {                       // chốt phần lẻ Huyền Tinh + kỳ vọng Phúc Duyên
    d.htAcc = rw.htCarry;
    d.fdAcc = (d.fdAcc || 0) + Math.floor(h) * 0.1;
    rw.fd = Math.floor(d.fdAcc); d.fdAcc -= rw.fd;
  }
  if (d.job === 'du' && rw.blocks > 0) {       // chiến lợi phẩm tất định theo (seed, id, số khối)
    const pots = {};
    for (let b = 0; b < rw.blocks; b++) {
      const roll = hash53(`dtloot|${st.seed}|${d.id}|${d.duBlocks + b}`) % 4;
      if (roll === 3) rw.fd += 2;
      else { const k = roll === 2 ? 'mana:1' : roll === 1 ? 'life:2' : 'life:1'; pots[k] = (pots[k] || 0) + 1; }
    }
    d.duBlocks += rw.blocks;
    rw.pots = Object.keys(pots).map(k => { const [kind, tier] = k.split(':'); return { kind, tier: +tier, n: pots[k] }; });
  }
  if (rw.xp > 0) gainXp(rw.xp);
  if (rw.gold > 0) { S.gold += rw.gold; log(`🧑‍🎓 Đệ tử <b>${esc(d.name)}</b> du ngoạn trở về: +${fmt(rw.gold)} lượng`); }
  const g = {};
  if (rw.fd) g.fd = rw.fd;
  if (rw.ht) g.mat = { g: 'ht', k: htLvl(), n: rw.ht };
  if (rw.pots.length === 1) g.pot = rw.pots[0];
  if (g.fd || g.mat || g.pot) grant(g, `Đệ tử «${d.name}» · ${DT_JOBS[d.job].name}`);
  if (rw.pots.length > 1) for (let i = 1; i < rw.pots.length; i++) grant({ pot: rw.pots[i] }, `Đệ tử «${d.name}» · chiến lợi phẩm`);
  const dxp = Math.floor(h * DT_DISC_XP_H);
  d.xp += dxp;
  while (d.xp >= d.lvl * DT_LVL_XP) { d.xp -= d.lvl * DT_LVL_XP; d.lvl++; }
  d.since = Date.now(); st.lastCollect = Date.now();
  save();
  return { ok: true, id: d.id, hours: h, xp: rw.xp, gold: rw.gold, ht: rw.ht, fd: rw.fd, pots: rw.pots, blocks: rw.blocks, discXp: dxp, lvlUp: d.lvl - lvl0, msg: `Thu của ${d.name}: ${rwText(rw) || 'chưa có gì'}` };
}
export function dtCollectAll() {
  const d = dtState(); let n = 0; const tot = { xp: 0, gold: 0, ht: 0, fd: 0 };
  for (const x of [...d.list]) if (dtHours(x) >= DT_MIN_H) { const r = dtCollect(x.id); if (r.ok) { n++; tot.xp += r.xp || 0; tot.gold += r.gold || 0; tot.ht += r.ht || 0; tot.fd += r.fd || 0; } }
  return n ? { ok: true, n, tot, msg: `Đã thu của ${n} đệ tử` } : { ok: false, msg: 'Chưa có giờ công nào để thu' };
}

/* ---------- phân công (thu tự động việc cũ trước) + xuống núi ---------- */
export function dtAssign(id, job) {
  const d = dtFind(id); if (!d) return { ok: false, msg: 'Không thấy đệ tử' };
  if (!DT_JOBS[job]) return { ok: false, msg: 'Công việc không hợp lệ' };
  if (d.job === job) return { ok: true, msg: `${d.name} đang làm ${DT_JOBS[job].name} rồi`, collected: null };
  let collected = null;
  if (dtHours(d) >= DT_MIN_H) collected = dtCollect(id);
  d.job = job; d.since = Date.now();
  save();
  return { ok: true, msg: `Đã phân ${d.name} sang ${DT_JOBS[job].name}${collected && collected.ok ? ` (đã thu việc cũ: ${rwText(collected)})` : ''}`, collected };
}
export function dtDismiss(id) {
  const d = dtState(), i = d.list.findIndex(x => x.id === id);
  if (i < 0) return { ok: false, msg: 'Không thấy đệ tử' };
  const [x] = d.list.splice(i, 1);
  save();
  return { ok: true, msg: `Đã truyền công cho ${x.name} và cho xuống núi` };
}

/* ---------- giao diện (view 'detu' trong modal Phần thưởng) ---------- */
function yieldText(d) {
  const rate = dtRate(d);
  if (d.job === 'luyen') return `~${fmt(Math.round(DT_XP_H * rate))} XP/giờ`;
  if (d.job === 'hai') return `~${(DT_HT_H * rate).toFixed(1)} Huyền Tinh/giờ · cơ hội Phúc Duyên`;
  return `~${fmt(Math.round(DT_GOLD_H * rate))} lượng/giờ · quà mỗi ${DT_DU_BLOCK_H} giờ`;
}
export function dtBody() {
  dtExpose();
  const d = dtState(), r = RW(), cap = dtCap(), inf = dtInfo();
  const canRecruit = d.list.length < cap && (r.fd || 0) >= DT_COST_FD;
  const cards = d.list.map(x => {
    const q = DT_QUAL[x.qual] || DT_QUAL[0], p = dtPending(x.id), need = x.lvl * DT_LVL_XP;
    const pendTxt = p && p.hours >= DT_MIN_H ? rwText({ xp: p.xp, gold: p.gold, ht: p.ht, fd: p.fd, pots: [] }) : '';
    return `<div class="card dt-card"><b>🧑‍🎓 ${esc(x.name)}</b> <small class="dim">${esc(dtSectName(x))}</small>
      <div><span style="color:${q.col};font-weight:bold">${q.name}</span> <small class="dim">· phẩm chất ×${q.mul}</small></div>
      <small>Cấp ${x.lvl} · XP đệ tử ${x.xp}/${need} · hệ số sản lượng ×${dtRate(x).toFixed(2)}</small>
      <div style="margin:6px 0"><b>${DT_JOBS[x.job].icon} ${DT_JOBS[x.job].name}</b> <small class="dim">${yieldText(x)}</small><br>
      <small>Đã tích: <b>${fmtHours(p ? p.hours : 0)}</b>/${DT_CAP_H} giờ${pendTxt ? ` · chờ thu: <b>${pendTxt}</b>` : ''}</small></div>
      <div class="btnrow"><button class="btn sm" data-dt-collect="${x.id}" ${p && p.hours >= DT_MIN_H ? '' : 'disabled'}>Thu</button>
      ${Object.keys(DT_JOBS).map(j => `<button class="btn sm" data-dt-job="${x.id}:${j}" ${x.job === j ? 'style="border-color:var(--gold);color:var(--gold)"' : ''}>${DT_JOBS[j].name}</button>`).join('')}
      <button class="btn sm" data-dt-dismiss="${x.id}">Xuống núi</button></div></div>`;
  }).join('');
  return `<p class="desc">Đệ Tử: tốn <b>${DT_COST_FD} Phúc Duyên</b> thu nhận 1 môn đồ — <b>phẩm chất là may rủi</b> (Thường 62% · Lương Tài 26% · Tinh Anh 9% · <span style="color:#ffd24a">Thiên Tài 3%</span>), hệ số sản lượng ×1.0/×1.5/×2.2/×3.5. Phân công Luyện Công (XP cho bạn), Hái Thuốc (Huyền Tinh) hoặc Du Ngoạn (lượng + quà); đệ tử làm việc theo thời gian thật, tích tối đa ${DT_CAP_H} giờ, lên cấp theo giờ công thì sản lượng tăng thêm. Đổi việc sẽ thu tự động phần đã tích trước.</p>
    <div class="card stats"><span>Phúc Duyên hiện có</span><span>${r.fd || 0}</span><span>Ô đệ tử</span><span>${d.list.length}/${cap}</span><span>Tổng đã thu nhận</span><span>${d.recruited}</span><span>Giờ công chờ thu</span><span>${inf.pendingH} giờ</span></div>
    <div class="btnrow"><button class="btn" id="dtRecruit" ${canRecruit ? '' : 'disabled'}>Thu nhận đệ tử (${DT_COST_FD} Phúc Duyên)</button>
    ${d.list.length >= cap ? `<small class="dim">Đã đầy ô — cấp ${cap < DT_CAP_MAX ? (cap - 1) * 25 + 25 : ''} mở ô kế</small>` : (r.fd || 0) < DT_COST_FD ? `<small class="dim">Chưa đủ Phúc Duyên</small>` : ''}
    ${inf.pendingH >= DT_MIN_H ? '<button class="btn" id="dtCollectAll">Thu tất cả</button>' : ''}</div>
    <div class="dt-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin-top:8px">${cards || '<p class="dim">Chưa có đệ tử nào — thu nhận người đầu tiên để bắt đầu.</p>'}</div>`;
}
function dtReveal(x) {
  const q = DT_QUAL[x.qual] || DT_QUAL[0];
  modal(`<div style="text-align:center;padding:10px 4px">
    <div style="font-size:44px">🧑‍🎓</div>
    <h3 style="margin:6px 0">THU NHẬN MÔN ĐỒ</h3>
    <p style="font-size:20px"><b>${esc(x.name)}</b> · ${esc(dtSectName(x))}</p>
    <p style="font-size:22px;color:${q.col};font-weight:bold">${q.name}</p>
    <p class="desc">Hệ số sản lượng <b>×${q.mul}</b>${x.qual === 3 ? ' — <b style="color:#ffd24a">THIÊN TÀI trăm năm có một!</b>' : x.qual === 2 ? ' — tư chất tinh anh, đáng bồi dưỡng!' : x.qual === 1 ? ' — tư chất khá, chăm chỉ là nên.' : ' — tư chất bình thường, cần cù bù thông minh.'}<br>
    Đệ tử bắt đầu với công việc Luyện Công — vào mục Đệ Tử để phân công lại.</p>
    <div class="btnrow" style="justify-content:center;margin-top:12px"><button class="btn" id="dtRevealOk">Xem Đệ Tử</button></div></div>`,
    () => { const el = document.querySelector('#mBody #dtRevealOk'); if (el) (el as any).onclick = () => openGiftTab('detu'); });
}
export function dtBind(refreshGift) {
  const rf = () => { if (refreshGift) refreshGift(); };
  const rec = document.querySelector('#mBody #dtRecruit');
  if (rec) (rec as any).onclick = () => { const r = dtRecruit(); if (!r.ok) { toast(r.msg); rf(); } else dtReveal(r.d); };
  const all = document.querySelector('#mBody #dtCollectAll');
  if (all) (all as any).onclick = () => { const r = dtCollectAll(); toast(r.msg); rf(); };
  document.querySelectorAll('#mBody [data-dt-collect]').forEach(x => (x as any).onclick = () => { const r = dtCollect(+x.dataset.dtCollect); toast(r.msg); rf(); });
  document.querySelectorAll('#mBody [data-dt-job]').forEach(x => (x as any).onclick = () => { const [id, job] = x.dataset.dtJob.split(':'); const r = dtAssign(+id, job); toast(r.msg); rf(); });
  document.querySelectorAll('#mBody [data-dt-dismiss]').forEach(x => (x as any).onclick = () => { const r = dtDismiss(+x.dataset.dtDismiss); toast(r.msg); rf(); });
}

/* Tick nhẹ gọi từ combat mỗi nhịp: đệ tử tích giờ thuần theo timestamp nên
   không có việc gì phải chạy — chỉ để phơi __G.DT ngay từ những tick đầu cho
   test/debug gọi trước khi mở view (khuôn mvbossTick f35). */
export function dtTick() { dtExpose(); }

/* Test/debug: phơi DT cho __G (khuôn KN/GH/FP/MK/BP/WB). */
const DT_API = {
  get state() { return dtState(); }, cap: dtCap, recruit: dtRecruit, assign: dtAssign,
  collect: dtCollect, collectAll: dtCollectAll, dismiss: dtDismiss, pending: dtPending,
  rate: dtRate, info: dtInfo, gen: dtGen, qualOf: dtQualOf, qual: DT_QUAL, jobs: DT_JOBS, body: dtBody,
};
export function dtExpose() { try { const g = (window as any).__G; if (g && !('DT' in g)) Object.defineProperty(g, 'DT', { get: () => DT_API }); } catch (e) { /* bo qua */ } }
