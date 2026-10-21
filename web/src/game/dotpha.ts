// @ts-nocheck — ĐỘT PHÁ CẢNH GIỚI — ĐẢ THÔNG KINH MẠCH (f34): canh giới tu luyện 12 tầng,
// mỗi lần đột phá là một canh bạc CÓ TỈ LỆ THẤT BẠI: thành công +4% sức mạnh VĨNH VIỄN,
// thất bại "tẩu hỏa nhập ma" mất một nửa nguyên liệu nhưng tích bảo hiểm (pity) +10% cho
// lần sau — không bao giờ mất trắng, càng trượt càng gần chắc chắn đỗ.
// Đây cũng là nơi TIÊU Huyền Tinh dư của Động Phủ (f32) và Phúc Duyên tích từ Kỳ Ngộ / bang hội.
//
// Hằng số cân bằng:
//   BP_TIERS — 12 cảnh giới: Luyện Khí → Đạo Tổ. BP_PER_TIER = 4 — mỗi tầng +4% toàn sức
//     mạnh (cộng dồn tối đa +48% ở Đạo Tổ), áp vào ĐÚNG 2 chỗ guildBuff/tâm pháp cộng %
//     trong calc() của stats.ts: P.dmgMul (sát thương) và P.life (sinh lực).
//   Chi phí tầng t (t = tầng kế, 1..12): Huyền Tinh = 2 + t viên (cấp Huyền Tinh theo cấp
//     nhân vật như kyngo htLvl), Phúc Duyên = 5 × t, lượng = 5.000 × t² (t1 5.000 → t12
//     720.000). Yêu cầu cấp: S.lvl >= 10 × t (t12 = cấp 120 — mốc cấp trong rewards.ts đi
//     tới 130+ sau chuyển sinh nên mốc này với tới được, không khóa chết người chơi).
//   Tỉ lệ: gốc = 90 − 5×(t−1) % (t1 90% → t12 35%), + BP_PITY_STEP = 10% mỗi lần trượt
//     liên tiếp (pity), kẹp [5, 100]. Trượt: chỉ mất 50% Huyền Tinh + Phúc Duyên (làm tròn
//     LÊN), lượng GIỮ NGUYÊN (luật thân thiện — vàng là tài nguyên cày cuốc, mất là nản).
//   Đại Ngộ: BP_CRIT_C = 10% mỗi lần THÀNH CÔNG là đại ngộ: +BP_CRIT_PTS = 2 điểm tiềm
//     năng qua grant({ pts }) sẵn có, đếm vào state.crits.
// TÍCH HỢP CHỈ SỐ (Step 0 — theo đúng khuôn guildBuff của activities.ts):
//   stats.ts calc() vốn đã cộng % vĩnh viễn của bang hội tại 2 dòng: P.dmgMul (nhân thêm
//   (1 + guildBuff().dmg/100)) và P.life (cộng guildBuff().life/100 + tpStacks().ho*0.06).
//   f34 thêm bpPct() vào đúng 2 chỗ đó (import { bpPct } from './dotpha' trong stats.ts):
//   dmgMul nhân thêm (1 + bpPct()/100), life cộng thêm bpPct()/100. bpPct() ĐỌC THUẦN
//   S.rw.bp.tier (không khởi tạo lười, không tác dụng phụ — an toàn khi calc() chạy sớm),
//   save mới / save cũ chưa có bp → 0% → cân bằng và test cũ không đổi một ly.
// Trạng thái lưu ở RW().bp = { tier, pity, tries, crits } (khởi tạo lười như kyngoState —
// KHÔNG sửa RW() trong rewards.ts).
'use strict';
import { clamp, esc, fmt } from './core';
import { RW, grant, openGiftTab } from './rewards';
import { S, save } from './save';
import { matAdd, matHave } from './recipes';
import { R, recalc } from './combat';
import { log, modal, toast } from './ui';

export const BP_TIERS = ['Luyện Khí', 'Trúc Cơ', 'Kim Đan', 'Nguyên Anh', 'Hóa Thần', 'Luyện Hư', 'Hợp Thể', 'Đại Thừa', 'Độ Kiếp', 'Chân Tiên', 'Kim Tiên', 'Đạo Tổ'];
export const BP_PER_TIER = 4;          // % sức mạnh vĩnh viễn mỗi tầng
export const BP_BASE0 = 90;            // tỉ lệ gốc tầng 1
export const BP_STEP = 5;              // tỉ lệ gốc giảm mỗi tầng
export const BP_PITY_STEP = 10;        // +10% mỗi lần trượt liên tiếp
export const BP_CRIT_C = 0.10;         // 10% lần đỗ là Đại Ngộ
export const BP_CRIT_PTS = 2;          // Đại Ngộ: +2 điểm tiềm năng
export const BP_GOLD0 = 5000;          // lượng = BP_GOLD0 × t²

const htLvl = () => clamp(Math.floor(S.lvl / 15) + 1, 1, 10);   // cấp Huyền Tinh theo cấp nhân vật (khuôn kyngo)

/* ---------- chi phí / cổng / tỉ lệ (hàm thuần theo tầng kế t = 1..12) ---------- */
export const bpGateLvl = t => 10 * t;                    // yêu cầu cấp
export const bpCostHt = t => 2 + t;                      // Huyền Tinh (cấp htLvl)
export const bpCostFd = t => 5 * t;                      // Phúc Duyên
export const bpCostGold = t => BP_GOLD0 * t * t;         // lượng
export const bpBaseChance = t => BP_BASE0 - BP_STEP * (t - 1);

/* ---------- trạng thái (RW().bp) ---------- */
export function bpState() {
  const r = RW(), b = r.bp = r.bp || {};
  if (b.tier == null) b.tier = 0;
  if (b.pity == null) b.pity = 0;
  if (b.tries == null) b.tries = 0;
  if (b.crits == null) b.crits = 0;
  bpExpose();
  return b;
}
/* % cộng vĩnh viễn hiện tại — ĐỌC THUẦN từ save (không qua bpState để tránh khởi tạo lười
   giữa lúc calc() chạy); chưa có bp → 0. stats.ts calc() gọi hàm này ở dmgMul + life. */
export function bpPct() { try { const b = S && S.rw && S.rw.bp; return (b ? (b.tier | 0) : 0) * BP_PER_TIER; } catch (e) { return 0; } }
export const bpTierName = tier => tier > 0 ? BP_TIERS[tier - 1] : 'Phàm Nhân';
/* Tỉ lệ tầng kế (đã gồm pity, kẹp [5,100]); đạt đỉnh → 0. */
export function bpChance() { const b = bpState(); if (b.tier >= BP_TIERS.length) return 0; return clamp(bpBaseChance(b.tier + 1) + b.pity * BP_PITY_STEP, 5, 100); }
export function bpCostNext() {
  const b = bpState(); if (b.tier >= BP_TIERS.length) return null;
  const t = b.tier + 1;
  return { t, gate: bpGateLvl(t), ht: bpCostHt(t), htK: htLvl(), fd: bpCostFd(t), gold: bpCostGold(t), base: bpBaseChance(t) };
}
/* Tóm tắt cho nút vào ở tab Bang hội (an toàn khi save chưa sẵn sàng). */
export function bpInfo() { try { const b = bpState(); return { name: bpTierName(b.tier), tier: b.tier, pct: bpPct(), chance: b.tier >= BP_TIERS.length ? null : bpChance() }; } catch (e) { return { name: 'Phàm Nhân', tier: 0, pct: 0, chance: null }; } }

/* ---------- đột phá ----------
   roll / critRoll trong [0,1) — test ép tất định qua __G.BP.attempt(roll, critRoll);
   UI gọi không tham số (Math.random thật). Trả { ok:false, msg } khi bị chặn (không trừ
   gì, không tính lượt) hoặc { ok:true, success, ... } khi đã tung xúc xắc. */
export function bpAttempt(roll, critRoll) {
  const b = bpState(), r = RW();
  if (b.tier >= BP_TIERS.length) return { ok: false, msg: 'Đã đạt Đạo Tổ — cảnh giới tối cao, không còn tầng nào để phá.' };
  const t = b.tier + 1, name = BP_TIERS[t - 1], k = htLvl();
  const cHt = bpCostHt(t), cFd = bpCostFd(t), cGold = bpCostGold(t);
  if (S.lvl < bpGateLvl(t)) return { ok: false, msg: `Đột phá ${name} cần cấp ${bpGateLvl(t)} (hiện cấp ${S.lvl}) — hãy tu luyện thêm.` };
  if (matHave('ht', k) < cHt) return { ok: false, msg: `Cần ${cHt} Huyền Tinh cấp ${k} (đang có ${matHave('ht', k)}) — trồng thêm ở Động Phủ hoặc đánh quái.` };
  if ((r.fd || 0) < cFd) return { ok: false, msg: `Cần ${cFd} Phúc Duyên (đang có ${r.fd || 0})` };
  if (S.gold < cGold) return { ok: false, msg: `Cần ${fmt(cGold)} lượng (đang có ${fmt(S.gold)})` };
  b.tries++;
  const chance = bpChance();
  const rv = roll == null ? Math.random() : roll;
  if (rv * 100 < chance) {                                   /* ===== THÀNH CÔNG ===== */
    matAdd('ht', k, -cHt); r.fd -= cFd; S.gold -= cGold;
    b.tier = t; b.pity = 0;
    const cv = critRoll == null ? Math.random() : critRoll;
    const crit = cv < BP_CRIT_C;
    if (crit) { b.crits++; grant({ pts: BP_CRIT_PTS }, 'Đột Phá Đại Ngộ'); }
    R.dirty = true; try { recalc(); } catch (e) { /* chi so se tu tinh lai o tick ke */ }
    log(`⚡ <b>Đột phá thành công!</b> Đạt cảnh giới <b>${esc(name)}</b> — sức mạnh vĩnh viễn +${BP_PER_TIER}% (tổng +${bpPct()}%)${crit ? ' · <b>ĐẠI NGỘ</b>: +2 điểm tiềm năng!' : ''}`);
    save();
    return { ok: true, success: true, crit, tier: t, name, pct: bpPct(), chance };
  }
  /* ===== THẤT BẠI — tẩu hỏa nhập ma: mất 50% HT/FD (làm tròn lên), lượng giữ nguyên ===== */
  const lostHt = Math.ceil(cHt / 2), lostFd = Math.ceil(cFd / 2);
  matAdd('ht', k, -lostHt); r.fd -= lostFd;
  b.pity++;
  log(`💥 <b>Tẩu hỏa nhập ma!</b> Đột phá ${esc(name)} thất bại — mất ${lostHt} Huyền Tinh cấp ${k}, ${lostFd} Phúc Duyên (lượng được giữ lại). Bảo hiểm tu luyện: lần sau +${BP_PITY_STEP}% (pity ${b.pity}).`);
  save();
  return { ok: true, success: false, tier: b.tier, name, lostHt, lostFd, htK: k, pity: b.pity, chanceNext: bpChance(), chance };
}

/* ---------- bảng kết quả (panel giữa modal — thay nội dung modal hiện tại) ---------- */
function bpResultModal(res) {
  if (res.success) {
    modal(`<div style="text-align:center;padding:10px 4px">
      <div style="font-size:44px">⚡</div>
      <h3 style="color:var(--gold);font-size:24px;margin:6px 0">ĐỘT PHÁ THÀNH CÔNG!</h3>
      <p style="font-size:19px">Đạt cảnh giới <b style="color:var(--gold)">${esc(res.name)}</b></p>
      <p class="desc">Kinh mạch đả thông, chân khí như sông vỡ bờ — sức mạnh vĩnh viễn <b>+${BP_PER_TIER}%</b> (tổng cộng hiện tại <b>+${res.pct}%</b>).</p>
      ${res.crit ? `<p style="color:var(--gold);font-size:16px">🌟 <b>ĐẠI NGỘ!</b> Tâm cảnh bừng sáng giữa lúc đột phá — nhận thêm <b>+${BP_CRIT_PTS} điểm tiềm năng</b>!</p>` : ''}
      <div class="btnrow" style="justify-content:center;margin-top:12px"><button class="btn" id="bpOk">Tiếp tục tu luyện</button></div></div>`,
      () => { const el = document.querySelector('#mBody #bpOk'); if (el) (el as any).onclick = () => openGiftTab('bp'); });
  } else {
    modal(`<div style="text-align:center;padding:10px 4px">
      <div style="font-size:44px">💥</div>
      <h3 style="color:#ff6b5e;font-size:24px;margin:6px 0">TẨU HỎA NHẬP MA!</h3>
      <p class="desc">Chân khí đảo lộn khi xung kích <b>${esc(res.name)}</b> — kinh mạch chấn động, phải ngồi thiền điều tức. Mất <b>${res.lostHt} Huyền Tinh cấp ${res.htK}</b> và <b>${res.lostFd} Phúc Duyên</b>; ngân lượng được giữ nguyên.</p>
      <p>🛡️ <b>Bảo hiểm tu luyện:</b> mỗi lần trượt +${BP_PITY_STEP}% cho lần sau — tỉ lệ đột phá kế tiếp giờ là <b style="font-size:18px">${res.chanceNext}%</b> (đã trượt ${res.pity} lần liên tiếp).</p>
      <div class="btnrow" style="justify-content:center;margin-top:12px"><button class="btn" id="bpOk">Điều tức, thử lại sau</button></div></div>`,
      () => { const el = document.querySelector('#mBody #bpOk'); if (el) (el as any).onclick = () => openGiftTab('bp'); });
  }
}

/* ---------- giao diện (thân view Đột Phá trong modal Phần thưởng) ---------- */
export function bpBody() {
  bpExpose();
  const b = bpState(), r = RW(), c = bpCostNext(), maxed = !c;
  const ladder = BP_TIERS.map((n, i) => {
    const tn = i + 1, got = tn <= b.tier, cur = tn === b.tier + 1;
    return `<div class="qrow bp-row${got ? ' got' : ''}"${cur ? ' style="border:1px solid var(--gold);border-radius:6px;padding:4px 6px"' : ''}><span><b>${got ? '✔' : cur ? '⚡' : '🔒'} ${esc(n)}</b><small>cần cấp ${bpGateLvl(tn)} · mốc cộng dồn +${tn * BP_PER_TIER}%</small></span><small>${got ? 'Đã đạt' : cur ? 'Đang xung kích' : ''}</small></div>`;
  }).join('');
  let next = '';
  if (maxed) {
    next = `<div class="card" style="text-align:center"><b style="color:var(--gold);font-size:17px">👑 ĐẠO TỔ — CẢNH GIỚI TỐI CAO</b><p class="desc">Đã đứng trên đỉnh tu luyện: sức mạnh vĩnh viễn +${bpPct()}%. Giang hồ từ nay chỉ còn là hậu bối.</p></div>`;
  } else {
    const haveHt = matHave('ht', c.htK), haveFd = r.fd || 0;
    let reason = '';
    if (S.lvl < c.gate) reason = `Cần cấp ${c.gate}`;
    else if (haveHt < c.ht) reason = `Thiếu Huyền Tinh cấp ${c.htK}`;
    else if (haveFd < c.fd) reason = 'Thiếu Phúc Duyên';
    else if (S.gold < c.gold) reason = 'Thiếu lượng';
    next = `<div class="card bp-next">
      <h4 style="margin-top:0">Xung kích: ${esc(BP_TIERS[c.t - 1])} <small class="dim">(tầng ${c.t}/12 · đỗ là +${BP_PER_TIER}% vĩnh viễn, tổng +${(b.tier + 1) * BP_PER_TIER}%)</small></h4>
      <div class="card stats"><span>Yêu cầu cấp</span><span>${S.lvl}/${c.gate} ${S.lvl >= c.gate ? '✔' : '✘'}</span>
      <span>Huyền Tinh cấp ${c.htK}</span><span>${haveHt}/${c.ht} ${haveHt >= c.ht ? '✔' : '✘'}</span>
      <span>Phúc Duyên</span><span>${haveFd}/${c.fd} ${haveFd >= c.fd ? '✔' : '✘'}</span>
      <span>Ngân lượng</span><span>${fmt(S.gold)}/${fmt(c.gold)} ${S.gold >= c.gold ? '✔' : '✘'}</span></div>
      <p style="text-align:center;margin:10px 0 4px">Tỉ lệ thành công: <b style="font-size:26px;color:var(--gold)">${bpChance()}%</b></p>
      <p class="desc" style="text-align:center">(gốc ${c.base}%${b.pity ? ` + bảo hiểm ${b.pity * BP_PITY_STEP}% từ ${b.pity} lần trượt` : ''} — trượt chỉ mất nửa Huyền Tinh/Phúc Duyên, lượng giữ nguyên, ${BP_CRIT_C * 100}% cơ hội Đại Ngộ +${BP_CRIT_PTS} điểm tiềm năng)</p>
      <div class="btnrow" style="justify-content:center"><button class="btn red" id="bpTry" ${reason ? 'disabled' : ''}>⚡ ĐỘT PHÁ ${reason ? `— ${reason}` : ''}</button></div></div>`;
  }
  return `<p class="desc">Đột Phá Cảnh Giới — Đả Thông Kinh Mạch: xung kích 12 tầng cảnh giới, mỗi tầng <b>+${BP_PER_TIER}% sức mạnh vĩnh viễn</b> (sát thương + sinh lực, cộng cùng nguồn buff bang hội / tâm pháp). Có tỉ lệ trượt thật: trượt là <b>tẩu hỏa nhập ma</b> — nhưng có bảo hiểm pity, không bao giờ mất trắng. Nơi tiêu Huyền Tinh của Động Phủ.</p>
    <div class="card stats"><span>Cảnh giới hiện tại</span><span><b>${esc(bpTierName(b.tier))}</b></span><span>Sức mạnh vĩnh viễn</span><span>+${bpPct()}%</span><span>Tổng lượt đột phá</span><span>${b.tries}</span><span>Số lần Đại Ngộ</span><span>${b.crits}</span></div>
    ${next}
    <h4>Thang cảnh giới</h4>
    ${ladder}`;
}
export function bpBind(refreshGift) {
  const el = document.querySelector('#mBody #bpTry');
  if (el) (el as any).onclick = () => {
    const res = bpAttempt();
    if (!res.ok) { toast(res.msg); if (refreshGift) refreshGift(); return; }
    bpResultModal(res);
  };
}

/* Test/debug: phơi BP cho __G (khuôn knExpose của kyngo / fpExpose của dongphu). */
const BP_API = { get state() { return bpState(); }, tiers: BP_TIERS, tier: () => bpState().tier, pct: bpPct, chance: bpChance, cost: bpCostNext, attempt: bpAttempt, info: bpInfo, body: bpBody };
export function bpExpose() { try { const g = (window as any).__G; if (g && !('BP' in g)) Object.defineProperty(g, 'BP', { get: () => BP_API }); } catch (e) { /* bo qua */ } }
