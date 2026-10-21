/* F32 — Động Phủ / Vườn Thuốc (dongphu.ts): trồng linh thảo theo THỜI GIAN THẬT
   (mốc at lúc gieo, chín cả khi offline), 3 ô sẵn / tối đa 8 ô, bón linh khí −50% giờ.
   Thu qua grant(): Phúc Duyên / Huyền Tinh / thuốc / điểm tiềm năng + KNB qua knbGain.
   MOCK /api/chat/* như mọi test; ép state qua __G.FP (khuôn __G.KN của f27). */
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

async function createCharacter(page: Page, name = 'ĐộngPhủ') {
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

/* Mở modal Phần thưởng → tab Bang hội → nút vào Động Phủ (điểm vào trong tab guild). */
async function openFarm(page: Page) {
  await page.locator('#qBar .qb[data-q="8"]').click();
  await expect(page.locator('#mBody')).toContainText('Bang hội (NPC)');
  await page.locator('#mBody #fpGo').click();
  await expect(page.locator('#mBody')).toContainText('Động Phủ — Vườn Thuốc');
}

test('động phủ: vào vườn — 3 ô trống, đủ 5 loại cây, ô khoá hiện giá mở', async ({ page }) => {
  await createCharacter(page);
  await openFarm(page);
  await expect(page.locator('#mBody .farm-plot')).toHaveCount(8);            // 3 trống + 5 khoá
  await expect(page.locator('#mBody')).toContainText('Ô đất 1 — trống');
  await expect(page.locator('#mBody')).toContainText('Ô đất 3 — trống');
  for (const n of ['Linh Chi Thảo', 'Tiên Thảo', 'Huyết Sâm', 'Ngọc Lộ Hoa', 'Kim Liên']) {
    await expect(page.locator('#mBody')).toContainText(n);
  }
  await expect(page.locator('#mBody')).toContainText('Ô đất 4');
  await expect(page.locator('#mBody')).toContainText('10.0k');               // giá mở ô 4 (fmt: 10.000 -> "10.0k")
  await expect(page.locator('#mBody')).toContainText('Cần cấp 15');
  await expect(page.locator('#mBody [data-fp-plant]')).toHaveCount(15);      // 3 ô × 5 cây
  const st = await page.evaluate(() => { const G = (window as any).__G; return { unlocked: G.FP.state.unlocked, total: G.FP.state.total, crops: G.FP.crops.length }; });
  expect(st.unlocked).toBe(3);
  expect(st.total).toBe(0);
  expect(st.crops).toBe(5);
  assertNoErrors();
});

test('động phủ: gieo Linh Chi qua UI — trừ đúng 200 lượng, ô có cây + mốc at', async ({ page }) => {
  await createCharacter(page);
  await openFarm(page);
  const before = await page.evaluate(() => { const G = (window as any).__G; G.S.gold = 100000; G.save(); return G.S.gold; });
  await page.locator('#giftTabs [data-g="guild"]').click();                  // render lại với số vàng mới
  await page.locator('#mBody #fpGo').click();
  await page.locator('#mBody [data-fp-plant="0:linhchi"]').click();
  const st = await page.evaluate(() => { const G = (window as any).__G; const p = G.FP.state.plots[0]; return { crop: p && p.crop, dur: p && p.dur, atOk: !!p && Math.abs(p.at - Date.now()) < 60000, gold: G.S.gold }; });
  expect(st.crop).toBe('linhchi');
  expect(st.dur).toBe(1800);
  expect(st.atOk).toBe(true);
  // trừ đúng 200 hạt giống; dung sai +100 vì nhân vật idle vẫn nhặt lượng rơi trong lúc bấm
  expect(st.gold).toBeGreaterThanOrEqual(before - 200);
  expect(st.gold).toBeLessThanOrEqual(before - 200 + 100);
  assertNoErrors();
});

test('động phủ: lùi at 31 phút — ô chín, thu hoạch qua UI: +6 Phúc Duyên, +1 Huyền Tinh, total=1, ô trống lại', async ({ page }) => {
  await createCharacter(page);
  await openFarm(page);
  const base = await page.evaluate(() => {
    const G = (window as any).__G; G.S.gold = 100000;
    const r = G.FP.plant(0, 'linhchi');
    G.FP.state.plots[0].at = Date.now() - 31 * 60000; G.save();
    return { ok: r.ok, fd: G.RW().fd || 0, ht: G.matHave('ht', 1) };
  });
  expect(base.ok).toBe(true);
  await page.locator('#giftTabs [data-g="guild"]').click();                  // render lại sau khi ép thời gian
  await page.locator('#mBody #fpGo').click();
  await expect(page.locator('#mBody [data-fp-harvest="0"]')).toBeVisible();
  await page.locator('#mBody [data-fp-harvest="0"]').click();
  const st = await page.evaluate(() => { const G = (window as any).__G; return { fd: G.RW().fd || 0, ht: G.matHave('ht', 1), total: G.FP.state.total, plot: G.FP.state.plots[0] }; });
  expect(st.fd).toBe(base.fd + 6);
  expect(st.ht).toBe(base.ht + 1);
  expect(st.total).toBe(1);
  expect(st.plot).toBeNull();
  assertNoErrors();
});

test('động phủ: bón linh khí — thời gian còn lại giảm ~50%, Phúc Duyên −5', async ({ page }) => {
  await createCharacter(page);
  await openFarm(page);                                                      // mở tab 1 lần để __G.FP được expose (khuôn GH/KN)
  const r = await page.evaluate(() => {
    const G = (window as any).__G; G.S.gold = 100000; G.RW().fd = 20;
    G.FP.plant(1, 'tienthao');                                               // 2 giờ = 7200s
    const p = G.FP.state.plots[1], before = G.FP.remaining(p);
    const b = G.FP.boost(1);
    return { ok: b.ok, before, after: G.FP.remaining(p), fd: G.RW().fd };
  });
  expect(r.ok).toBe(true);
  expect(r.before).toBeGreaterThan(7000);
  expect(r.after).toBeLessThan(r.before * 0.6);                              // ~50% (trừ hao vài ms chạy test)
  expect(r.after).toBeGreaterThan(r.before * 0.4);
  expect(r.fd).toBe(15);
  assertNoErrors();
});

test('động phủ: mở ô 4 — đủ cấp+vàng thì mở (trừ đúng 10.000), thiếu cấp thì chặn', async ({ page }) => {
  await createCharacter(page);
  await openFarm(page);
  const low = await page.evaluate(() => { const G = (window as any).__G; G.S.gold = 999999; const r = G.FP.unlock(); return { ok: r.ok, unlocked: G.FP.state.unlocked, lvl: G.S.lvl }; });
  expect(low.lvl).toBeLessThan(15);
  expect(low.ok).toBe(false);                                                // cấp 1 < 15: không mở được
  expect(low.unlocked).toBe(3);
  const hi = await page.evaluate(() => { const G = (window as any).__G; G.S.lvl = 15; const g0 = G.S.gold; const r = G.FP.unlock(); return { ok: r.ok, unlocked: G.FP.state.unlocked, spent: g0 - G.S.gold }; });
  expect(hi.ok).toBe(true);
  expect(hi.unlocked).toBe(4);
  expect(hi.spent).toBe(10000);
  assertNoErrors();
});

test('động phủ: offline — gieo Huyết Sâm, at lùi 5 giờ: mở vườn là thu hoạch được ngay (+3 thuốc, +8 Phúc Duyên)', async ({ page }) => {
  await createCharacter(page);
  await openFarm(page);
  const base = await page.evaluate(() => {
    const G = (window as any).__G; G.S.gold = 100000;
    G.FP.plant(0, 'huyettham');                                              // 4 giờ
    G.FP.state.plots[0].at = Date.now() - 5 * 3600 * 1000; G.save();         // như đã đóng game 5 giờ
    return { fd: G.RW().fd || 0, pot: (G.S.potStock.life || {})[2] || 0, ready: G.FP.ready() };
  });
  expect(base.ready).toBe(1);
  await page.locator('#giftTabs [data-g="guild"]').click();                  // render lại vườn sau khi ép thời gian
  await page.locator('#mBody #fpGo').click();
  await expect(page.locator('#mBody [data-fp-harvest="0"]')).toBeVisible();  // chín sẵn ngay khi mở
  await page.locator('#mBody [data-fp-harvest="0"]').click();
  const st = await page.evaluate(() => { const G = (window as any).__G; return { fd: G.RW().fd || 0, pot: (G.S.potStock.life || {})[2] || 0, total: G.FP.state.total }; });
  expect(st.fd).toBe(base.fd + 8);
  expect(st.pot).toBe(base.pot + 3);
  expect(st.total).toBe(1);
  assertNoErrors();
});
