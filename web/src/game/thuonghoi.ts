// @ts-nocheck — THƯƠNG HỘI / CHỢ GIÁ BIẾN ĐỘNG (f33): mua bán 6 thương phẩm, giá thay
// đổi THEO NGÀY — giá của 1 ngày là TẤT ĐỊNH (cùng ngày mở lại giá không đổi, qua ngày
// giá mới), nên người chơi canh ngày rẻ mua vào, ngày đắt bán ra. Hàng hoá là số đếm
// giao dịch riêng trong RW().market — KHÔNG phải vật phẩm hành trang, để chợ không làm
// lệch kinh tế rèn đồ / đồng hành.
// GIÁ: priceOn(good, isoDay) = base × hệ số, hệ số = sóng xu hướng trơn (sin chu kỳ
//   7 ngày biên 0,18 + sin chu kỳ 3 ngày biên 0,08, pha riêng từng mặt hàng từ hash id)
//   + nhiễu ngày tất định từ hash(isoDay|goodId) trong ±0,05 → hệ số luôn trong
//   [0,69..1,31], kẹp cứng [MK_FACTOR_MIN=0,65 .. MK_FACTOR_MAX=1,45] trước khi nhân
//   base và làm tròn. Ngày kề nhau trượt theo sóng nên thường lệch < ±30%.
// CHỐNG LẠM PHÁT (mọi giao dịch đều qua các trần này):
//   · MK_VOL_CAP = 200.000 — tổng lượng MUA tối đa mỗi ngày (bán không giới hạn).
//   · Sức chứa kho = MK_CAP_BASE = 100 + MK_CAP_PER_LV = 10 × cấp người chơi (tổng
//     đơn vị mọi mặt hàng) — không tích trữ vô hạn chờ ngày giá đỉnh.
//   · MK_FEE = 2% — bán chỉ nhận 98% (hao hụt vận chuyển / thuế chợ), mua bán cùng
//     ngày cùng giá là LỖ đúng phần phí, không có vòng lặp in tiền trong ngày.
//   · Giá vốn trung bình theo spent/stock; bán ghi lãi/lỗ THẬT vào market.profit
//     (net − vốn TB × số bán) để người chơi thấy mình lời lỗ bao nhiêu.
// Trạng thái lưu ở RW().market = { stock{}, spent{}, day, volDay, trades, profit }
// (tự khởi tạo lười như farmState/kyngoState — KHÔNG sửa RW() trong rewards.ts).
'use strict';
import { clamp, esc, fmt } from './core';
import { RW } from './rewards';
import { S, save } from './save';
import { localISODay } from './journal';
import { log, toast } from './ui';

export const MK_VOL_CAP = 200000;        // trần lượng MUA mỗi ngày
export const MK_CAP_BASE = 100;          // sức chứa kho cơ bản (đơn vị)
export const MK_CAP_PER_LV = 10;         // +10 đơn vị mỗi cấp người chơi
export const MK_FEE = 0.02;              // phí bán 2%
export const MK_FACTOR_MIN = 0.65, MK_FACTOR_MAX = 1.45;

/* 6 thương phẩm: base = giá gốc (lượng/đơn vị). */
export const MK_GOODS = [
  { id: 'lua', icon: '🧵', name: 'Tơ Lụa Tô Châu', base: 400 },
  { id: 'tra', icon: '🍵', name: 'Trà Phổ Nhĩ', base: 250 },
  { id: 'ngoc', icon: '🦪', name: 'Ngọc Trai Nam Hải', base: 900 },
  { id: 'sat', icon: '⛓️', name: 'Sắt Tinh Luyện', base: 150 },
  { id: 'tram', icon: '🪵', name: 'Gỗ Trầm Hương', base: 1500 },
  { id: 'ruou', icon: '🍶', name: 'Rượu Nữ Nhi Hồng', base: 600 },
];
export const mkGood = id => MK_GOODS.find(g => g.id === id);

/* ---------- RNG tất định theo chuỗi (cyrb53 — cùng họ hash với sigOf của save.ts) ---------- */
function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const unitOf = (id, tag) => (hash53(id + '|' + tag) % 100000) / 100000;                    // [0,1) tất định theo mặt hàng
const noiseOf = (id, iso) => ((hash53(iso + '|' + id) % 2001) - 1000) / 1000 * 0.05;      // ±0,05 tất định theo ngày + hàng

/* ---------- giá theo ngày (thuần hàm — cùng input cùng giá, không phụ thuộc state) ---------- */
function dayNumOf(iso) { const [y, m, d] = String(iso).split('-').map(Number); return Math.floor(Date.UTC(y || 1970, (m || 1) - 1, d || 1) / 86400000); }
export function mkFactorOn(id, iso) {
  const g = mkGood(id); if (!g) return 1;
  const dn = dayNumOf(iso);
  const wave = 0.18 * Math.sin(dn * Math.PI * 2 / 7 + unitOf(id, 'ph1') * Math.PI * 2)
             + 0.08 * Math.sin(dn * Math.PI * 2 / 3 + unitOf(id, 'ph2') * Math.PI * 2);
  return clamp(1 + wave + noiseOf(id, iso), MK_FACTOR_MIN, MK_FACTOR_MAX);
}
export function mkPriceOn(id, iso) { const g = mkGood(id); return g ? Math.max(1, Math.round(g.base * mkFactorOn(id, iso))) : 0; }
export const mkPrice = id => mkPriceOn(id, localISODay());
export const mkYesterdayISO = () => { const t = new Date(); t.setDate(t.getDate() - 1); return localISODay(t); };
export function mkChangePct(id) {                       // % giá hôm nay so với hôm qua
  const p = mkPrice(id), y = mkPriceOn(id, mkYesterdayISO());
  return y > 0 ? Math.round((p - y) / y * 100) : 0;
}
export function mkBestMove() {                          // mặt hàng biến động mạnh nhất hôm nay (cho nút vào)
  let best = null;
  for (const g of MK_GOODS) { const pct = mkChangePct(g.id); if (!best || Math.abs(pct) > Math.abs(best.pct)) best = { id: g.id, name: g.name, pct }; }
  return best;
}

/* ---------- trạng thái (RW().market) ---------- */
export function marketState() {
  const r = RW(), m = r.market = r.market || {};
  if (!m.stock || typeof m.stock !== 'object') m.stock = {};
  if (!m.spent || typeof m.spent !== 'object') m.spent = {};
  for (const g of MK_GOODS) { if (m.stock[g.id] == null) m.stock[g.id] = 0; if (m.spent[g.id] == null) m.spent[g.id] = 0; }
  if (m.day !== localISODay()) { m.day = localISODay(); m.volDay = 0; }          // qua ngày: reset hạn mức mua
  if (m.volDay == null) m.volDay = 0;
  if (m.trades == null) m.trades = 0;
  if (m.profit == null) m.profit = 0;
  mkExpose();
  return m;
}
export const mkCap = () => MK_CAP_BASE + MK_CAP_PER_LV * Math.max(1, Math.floor(S.lvl) || 1);
export const mkTotalUnits = () => { const m = marketState(); return MK_GOODS.reduce((a, g) => a + (m.stock[g.id] || 0), 0); };
export const mkAvgCost = id => { const m = marketState(); return m.stock[id] > 0 ? m.spent[id] / m.stock[id] : 0; };

/* ---------- giao dịch ---------- */
export function mkBuy(id, qty) {
  const m = marketState(), g = mkGood(id); qty = Math.floor(+qty) || 0;
  if (!g || qty <= 0) return { ok: false, msg: 'Số lượng không hợp lệ' };
  const price = mkPrice(id), cost = price * qty;
  if (mkTotalUnits() + qty > mkCap()) return { ok: false, msg: `Kho đầy — sức chứa ${fmt(mkCap())} đơn vị (nâng cấp để chứa thêm)` };
  if (m.volDay + cost > MK_VOL_CAP) return { ok: false, msg: `Vượt hạn mức mua hôm nay — còn ${fmt(MK_VOL_CAP - m.volDay)} lượng` };
  if (S.gold < cost) return { ok: false, msg: `Không đủ lượng — cần ${fmt(cost)}` };
  S.gold -= cost; m.stock[id] += qty; m.spent[id] += cost; m.volDay += cost; m.trades++;
  log(`🏮 Thương Hội: mua ${qty} ${esc(g.name)} giá ${fmt(price)} · −${fmt(cost)} lượng`);
  save();
  return { ok: true, msg: `Đã mua ${qty} ${g.name} · −${fmt(cost)} lượng` };
}
export function mkBuyMax(id) {
  const m = marketState(); if (!mkGood(id)) return { ok: false, msg: 'Mặt hàng không hợp lệ' };
  const price = mkPrice(id);
  const qty = Math.min(mkCap() - mkTotalUnits(), Math.floor(S.gold / price), Math.floor((MK_VOL_CAP - m.volDay) / price));
  if (qty <= 0) return { ok: false, msg: 'Không mua thêm được — kho đầy, hết hạn mức hôm nay, hoặc không đủ lượng' };
  return mkBuy(id, qty);
}
export function mkSell(id, qty) {
  const m = marketState(), g = mkGood(id); qty = Math.floor(+qty) || 0;
  if (!g || qty <= 0) return { ok: false, msg: 'Số lượng không hợp lệ' };
  if ((m.stock[id] || 0) < qty) return { ok: false, msg: `Chỉ đang giữ ${m.stock[id] || 0} ${g.name}` };
  const price = mkPrice(id), gross = price * qty, net = Math.round(gross * (1 - MK_FEE));
  const avg = mkAvgCost(id), realized = net - Math.round(avg * qty);
  S.gold += net;
  m.spent[id] = qty >= m.stock[id] ? 0 : Math.round(m.spent[id] - avg * qty);
  m.stock[id] -= qty; m.profit += realized; m.trades++;
  log(`🏮 Thương Hội: bán ${qty} ${esc(g.name)} giá ${fmt(price)} · +${fmt(net)} lượng (phí ${Math.round(MK_FEE * 100)}%) · lãi/lỗ ${realized >= 0 ? '+' : ''}${fmt(realized)}`);
  save();
  return { ok: true, msg: `Đã bán ${qty} ${g.name} · +${fmt(net)} lượng (sau phí ${Math.round(MK_FEE * 100)}%)` };
}
export const mkSellAll = id => { const m = marketState(); return (m.stock[id] || 0) > 0 ? mkSell(id, m.stock[id]) : { ok: false, msg: 'Không có hàng để bán' }; };

/* ---------- giao diện (thân view Thương Hội trong modal Phần thưởng) ---------- */
const pctHtml = pct => pct > 0 ? `<b style="color:#7bc47f">▲ +${pct}%</b>` : pct < 0 ? `<b style="color:#e57373">▼ ${pct}%</b>` : '<b class="dim">● 0%</b>';
export function marketBody() {
  mkExpose();
  const m = marketState(), cap = mkCap(), units = mkTotalUnits();
  const cards = MK_GOODS.map(g => {
    const price = mkPrice(g.id), pct = mkChangePct(g.id), qty = m.stock[g.id] || 0, avg = mkAvgCost(g.id);
    const pl = qty > 0 ? Math.round((price - avg) / avg * 100) : 0;
    const canBuy = S.gold >= price && units < cap && m.volDay + price <= MK_VOL_CAP;
    return `<div class="card mk-good"><b>${g.icon} ${esc(g.name)}</b> ${pctHtml(pct)} <small class="dim">so với hôm qua</small>
      <div><small>Giá hôm nay: <b>${fmt(price)}</b> lượng/đơn vị · giá gốc ${fmt(g.base)}</small></div>
      <div><small>Đang giữ: <b>${qty}</b>${qty > 0 ? ` · vốn TB ${fmt(avg)} · lãi/lỗ <b style="color:${pl >= 0 ? '#7bc47f' : '#e57373'}">${pl >= 0 ? '+' : ''}${pl}%</b>` : ''}</small></div>
      <div class="btnrow"><span><small>Mua</small> <button class="btn sm" data-mk-buy="${g.id}:1" ${canBuy ? '' : 'disabled'}>×1</button> <button class="btn sm" data-mk-buy="${g.id}:10" ${canBuy ? '' : 'disabled'}>×10</button> <button class="btn sm" data-mk-buy="${g.id}:max" ${canBuy ? '' : 'disabled'}>Tối đa</button></span>
      <span><small>Bán</small> <button class="btn sm" data-mk-sell="${g.id}:1" ${qty >= 1 ? '' : 'disabled'}>×1</button> <button class="btn sm" data-mk-sell="${g.id}:10" ${qty >= 10 ? '' : 'disabled'}>×10</button> <button class="btn sm" data-mk-sell="${g.id}:all" ${qty > 0 ? '' : 'disabled'}>Hết</button></span></div></div>`;
  }).join('');
  return `<p class="desc">Thương Hội — Chợ giá biến động: giá 6 thương phẩm thay đổi <b>mỗi ngày</b> (cả ngày giữ nguyên một giá). Canh ngày rẻ mua vào, ngày đắt bán ra. Bán chịu phí ${Math.round(MK_FEE * 100)}%; kho và hạn mức mua mỗi ngày có trần — không tích trữ vô hạn được.</p>
    <div class="card stats"><span>Ngân lượng</span><span>${fmt(S.gold)}</span><span>Kho hàng</span><span>${units}/${cap} đơn vị</span><span>Hạn mức mua hôm nay còn</span><span>${fmt(MK_VOL_CAP - m.volDay)} / ${fmt(MK_VOL_CAP)}</span><span>Tổng lãi đã thực hiện</span><span>${m.profit >= 0 ? '+' : ''}${fmt(m.profit)} lượng</span><span>Tổng số giao dịch</span><span>${m.trades}</span></div>
    <div class="mk-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin-top:8px">${cards}</div>`;
}
export function marketBind(refreshGift) {
  const rf = () => { if (refreshGift) refreshGift(); };
  document.querySelectorAll('#mBody [data-mk-buy]').forEach(x => x.onclick = () => { const [id, q] = x.dataset.mkBuy.split(':'); const r = q === 'max' ? mkBuyMax(id) : mkBuy(id, +q); toast(r.msg); rf(); });
  document.querySelectorAll('#mBody [data-mk-sell]').forEach(x => x.onclick = () => { const [id, q] = x.dataset.mkSell.split(':'); const r = q === 'all' ? mkSellAll(id) : mkSell(id, +q); toast(r.msg); rf(); });
}

/* Test/debug: phơi MK cho __G (khuôn knExpose của kyngo / fpExpose của dongphu). */
const MK_API = { get state() { return marketState(); }, goods: MK_GOODS, price: mkPrice, priceOn: mkPriceOn, factorOn: mkFactorOn, changePct: mkChangePct, bestMove: mkBestMove, cap: mkCap, totalUnits: mkTotalUnits, avgCost: mkAvgCost, buy: mkBuy, buyMax: mkBuyMax, sell: mkSell, sellAll: mkSellAll, body: marketBody, VOL_CAP: MK_VOL_CAP, FEE: MK_FEE };
export function mkExpose() { try { const g = (window as any).__G; if (g && !('MK' in g)) Object.defineProperty(g, 'MK', { get: () => MK_API }); } catch (e) { /* bo qua */ } }
