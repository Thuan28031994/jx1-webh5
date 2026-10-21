/* F33 — Thương Hội / Chợ giá biến động (thuonghoi.ts): giá 6 thương phẩm TẤT ĐỊNH theo
   ngày (hash ngày + sóng sin 7/3 ngày, hệ số trong [0,65..1,45]×base), mua bán với
   trần kho (100 + 10×cấp), trần lượng mua 200.000/ngày, phí bán 2%, lãi/lỗ theo vốn TB.
   Hàng là số đếm riêng trong RW().market — không phải vật phẩm hành trang.
   MOCK /api/chat/* như mọi test; ép state qua __G.MK (khuôn __G.KN/F27, __G.FP/F32).
   Mọi assert tiền đều theo CÔNG THỨC đọc giá từ __G.MK nên không phụ thuộc ngày chạy test. */
import { test, expect, Page } from '@playwright/test';

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.route('**/api/chat/status', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, online: 0 }) }));
  page.route('**/api/chat/stream*', () => { /* treo */ });
  page.route('**/api/chat/messages*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, messages: [] }) }));
  page.route('**/api/chat/presence*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
});
const assertNoErrors = () => expect(errors, errors.join('\n')).toEqual([]);

async function createCharacter(page: Page, name = 'ThươngHội') {
  await page.goto('/');
  await expect(page.locator('#pfName')).toBeVisible();
  await page.fill('#pfName', name);
  await page.locator('.facpick button').first().click();
  await expect(page.locator('#bNotice')).toBeVisible();
  await page.locator('#bNotice').click();
  const skip = page.locator('#tSkip');
  if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) await skip.click();
  await expect(page.locator('#qBar .qb')).toHaveCount(19);
}

/* Mở modal Phần thưởng → tab Bang hội → nút vào Thương Hội (điểm vào trong tab guild). */
async function openMarket(page: Page) {
  await page.locator('#qBar .qb[data-q="8"]').click();
  await expect(page.locator('#mBody')).toContainText('Bang hội (NPC)');
  await page.locator('#mBody #mkGo').click();
  await expect(page.locator('#mBody')).toContainText('Thương Hội — Chợ giá biến động');
}

test('thương hội: giá tất định theo ngày — gọi 2 lần bằng nhau, quét 30 ngày trong biên 0,6–1,5×base, 2 ngày xa nhau có giá khác', async ({ page }) => {
  await createCharacter(page);
  await openMarket(page);                                                    // mở chợ 1 lần để __G.MK được expose
  const r = await page.evaluate(() => {
    const G = (window as any).__G, M = G.MK;
    const days: string[] = [];
    for (let i = 0; i < 30; i++) { const d = new Date(2026, 0, 5 + i); days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }
    let bandOk = true;
    for (const g of M.goods) for (const iso of days) { const f = M.priceOn(g.id, iso) / g.base; if (f < 0.6 || f > 1.5) bandOk = false; }
    let differs = false;
    for (const g of M.goods) if (M.priceOn(g.id, '2026-01-05') !== M.priceOn(g.id, '2026-03-20')) differs = true;
    return { p1: M.price('lua'), p2: M.price('lua'), bandOk, differs };
  });
  expect(r.p1).toBeGreaterThan(0);
  expect(r.p1).toBe(r.p2);                                                   // cùng ngày = cùng giá
  expect(r.bandOk).toBe(true);
  expect(r.differs).toBe(true);
  assertNoErrors();
});

test('thương hội: UI — đủ 6 mặt hàng, hiện % thay đổi so với hôm qua, nút bán disabled khi không có hàng', async ({ page }) => {
  await createCharacter(page);
  await openMarket(page);
  await expect(page.locator('#mBody .mk-good')).toHaveCount(6);
  for (const n of ['Tơ Lụa Tô Châu', 'Trà Phổ Nhĩ', 'Ngọc Trai Nam Hải', 'Sắt Tinh Luyện', 'Gỗ Trầm Hương', 'Rượu Nữ Nhi Hồng']) {
    await expect(page.locator('#mBody')).toContainText(n);
  }
  await expect(page.locator('#mBody')).toContainText('so với hôm qua');
  await expect(page.locator('#mBody')).toContainText('Kho hàng');
  await expect(page.locator('#mBody')).toContainText('0/110 đơn vị');        // cấp 1: kho 100 + 10×1
  await expect(page.locator('#mBody [data-mk-sell="lua:1"]')).toBeDisabled();
  await expect(page.locator('#mBody [data-mk-sell="lua:10"]')).toBeDisabled();
  await expect(page.locator('#mBody [data-mk-sell="lua:all"]')).toBeDisabled();
  await expect(page.locator('#mBody [data-mk-buy="tram:max"]')).toBeVisible();
  assertNoErrors();
});

test('thương hội: mua 10 Tơ Lụa qua UI — stock/volDay/spent đúng theo giá hôm nay, nút bán bật lên', async ({ page }) => {
  await createCharacter(page);
  await openMarket(page);
  const prep = await page.evaluate(() => { const G = (window as any).__G; G.S.gold = 1000000; G.save(); return { price: G.MK.price('lua'), gold: G.S.gold }; });
  await page.locator('#giftTabs [data-g="guild"]').click();                  // render lại với số vàng mới
  await page.locator('#mBody #mkGo').click();
  await page.locator('#mBody [data-mk-buy="lua:10"]').click();
  const st = await page.evaluate(() => { const G = (window as any).__G; const m = G.MK.state; return { stock: m.stock.lua, vol: m.volDay, spent: m.spent.lua, trades: m.trades, gold: G.S.gold }; });
  expect(st.stock).toBe(10);
  expect(st.vol).toBe(10 * prep.price);                                      // hạn mức mua trừ đúng theo giá ngày
  expect(st.spent).toBe(10 * prep.price);
  expect(st.trades).toBe(1);
  // vàng trừ đúng 10×giá; dung sai +150 vì nhân vật idle vẫn nhặt lượng rơi trong lúc bấm (như f32)
  expect(st.gold).toBeGreaterThanOrEqual(prep.gold - 10 * prep.price);
  expect(st.gold).toBeLessThanOrEqual(prep.gold - 10 * prep.price + 150);
  await expect(page.locator('#mBody [data-mk-sell="lua:10"]')).toBeEnabled();
  await expect(page.locator('#mBody')).toContainText('Đang giữ:');           // dòng đang giữ + vốn TB hiện ra
  assertNoErrors();
});

test('thương hội: bán 10 — nhận đúng 98% × giá × 10, stock về 0, profit = net − vốn TB × 10 (âm đúng phần phí)', async ({ page }) => {
  await createCharacter(page);
  await openMarket(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, M = G.MK;                                  // mọi thao tác trong 1 evaluate: không lọt nhịp idle
    G.S.gold = 1000000;
    const price = M.price('lua');
    const b = M.buy('lua', 10);
    const g0 = G.S.gold, avg = M.avgCost('lua');
    const s = M.sell('lua', 10);
    const net = Math.round(10 * price * 0.98);
    return { buyOk: b.ok, sellOk: s.ok, price, avg, gained: G.S.gold - g0, net, stock: M.state.stock.lua, spent: M.state.spent.lua, profit: M.state.profit, trades: M.state.trades };
  });
  expect(r.buyOk).toBe(true);
  expect(r.sellOk).toBe(true);
  expect(r.avg).toBe(r.price);                                               // mua 1 lần 1 giá: vốn TB = giá mua
  expect(r.gained).toBe(r.net);                                              // nhận đúng 98%
  expect(r.stock).toBe(0);
  expect(r.spent).toBe(0);
  expect(r.profit).toBe(r.net - Math.round(r.avg * 10));                     // = −2% × giá trị (phí) khi mua bán cùng giá
  expect(r.profit).toBeLessThan(0);
  expect(r.trades).toBe(2);
  assertNoErrors();
});

test('thương hội: các trần chống lạm phát — mua Max theo vàng, kho đầy chặn mua, hạn mức mua/ngày chặn mua', async ({ page }) => {
  await createCharacter(page);
  await openMarket(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, M = G.MK;
    const reset = () => { for (const g of M.goods) { M.state.stock[g.id] = 0; M.state.spent[g.id] = 0; } M.state.volDay = 0; };
    // 1) Mua tối đa: vàng chỉ đủ 3 đơn vị Trà → mua đúng 3, vàng về 0
    const pTra = M.price('tra'); G.S.gold = pTra * 3;
    const bm = M.buyMax('tra');
    const maxQty = M.state.stock.tra, goldAfterMax = G.S.gold;
    // 2) Sức chứa kho: cấp 1 → cap 110; chừa 5 chỗ → mua 10 bị chặn, mua 5 vừa đầy thì được
    reset(); G.S.gold = 100000000;
    const cap = M.cap(), pLua = M.price('lua');
    M.state.stock.lua = cap - 5; M.state.spent.lua = (cap - 5) * pLua;
    const over = M.buy('lua', 10), fit = M.buy('lua', 5), fullAt = M.totalUnits();
    // 3) Hạn mức mua/ngày: còn 100 lượng hạn mức, giá Sắt thấp nhất cũng > 100 → mua 1 cũng bị chặn
    reset(); M.state.volDay = M.VOL_CAP - 100;
    const v = M.buy('sat', 1);
    return { bmOk: bm.ok, maxQty, goldAfterMax, cap, overOk: over.ok, fitOk: fit.ok, fullAt, volOk: v.ok, satStock: M.state.stock.sat };
  });
  expect(r.bmOk).toBe(true);
  expect(r.maxQty).toBe(3);
  expect(r.goldAfterMax).toBe(0);
  expect(r.cap).toBe(110);
  expect(r.overOk).toBe(false);
  expect(r.fitOk).toBe(true);
  expect(r.fullAt).toBe(110);
  expect(r.volOk).toBe(false);
  expect(r.satStock).toBe(0);
  assertNoErrors();
});
