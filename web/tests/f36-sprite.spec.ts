/* F36 — fix sprite (render.ts + loop.ts):
   (1) Nhân vật ghép JX từng bị vẽ ở HERO_SCALE*0.6 = 0.81 -> cao ~36px trong khi quái thường
       (khung 'st' trung vị 80px × 0.8 × MON_SCALE 1.4) cao ~90px. Nay dùng JX_HERO_SCALE riêng
       -> hero cao ngang/trên quái thường một chút, boss vẫn lớn hơn. Test tính từ DỮ LIỆU game
       (jw.json + jxlook.json) nhân hệ số thật phơi qua __sprite() — không đo pixel canvas.
   (2) Pop-in hình quái: trước đây không có preload, sheet img/a/*.webp chỉ tải khi quái xuất hiện.
       Nay onZoneChange preload toàn bộ sprite của quái thuộc bãi (+ bãi theo cấp cho các mode boss)
       vào cache dùng chung. Test chỉ kiểm tra CÓ MẶT trong cache — không phụ thuộc tốc độ mạng.
   MOCK /api/chat/* như mọi test. */
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

async function createCharacter(page: Page, name = 'KiemSprite') {
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

test('sprite: nhân vật JX cao ngang/trên quái thường (từ dữ liệu game × hệ số thật)', async ({ page }) => {
  await createCharacter(page);
  const r = await page.evaluate(async () => {
    const P = (window as any).__sprite();
    const jw = await (await fetch('jdata/jw.json')).json();
    const jx = await (await fetch('jdata/jxlook.json')).json();
    // quái thường: trung vị chiều cao khung 'st' của mọi loại quái, vẽ ở sc 0.8 × MON_SCALE (render.ts)
    const hs: number[] = [];
    for (const k in jw.mon) { const a = jw.anim[jw.mon[k].anim]; if (a && a.st) hs.push(a.st.h); }
    hs.sort((x: number, y: number) => x - y);
    const med = hs[Math.floor(hs.length / 2)];
    const mobDrawn = med * 0.8 * P.mon;
    // nhân vật JX đứng yên, không ngựa: điểm cao nhất của các bộ phận tính từ neo chân jxlook.foot
    const PARTS = ['头部', '发型', '肩膀', '躯体', '左手', '右手', '左手武器', '右手武器'];
    let top = 0;
    for (const part of PARTS) {
      const rows = (jx.tabs.m[part] || {})['0'] || {};
      for (const act in rows) {
        if (!act.includes('站立')) continue;
        const sh = jx.sheets['m/' + rows[act]];
        if (sh) top = Math.max(top, jx.foot[1] - sh[3]);
        break;
      }
    }
    return { jxHero: P.jxHero, med, mobDrawn, heroNative: top, heroDrawn: top * P.jxHero };
  });
  expect(r.med).toBeGreaterThan(0);
  expect(r.heroNative).toBeGreaterThan(30);                    // dữ liệu neo chân hợp lệ (~44)
  expect(r.jxHero).toBeGreaterThan(2);                         // hệ số cũ 0.81 đã bị bỏ
  expect(r.heroDrawn).toBeGreaterThanOrEqual(r.mobDrawn);      // hero >= quái thường
  expect(r.heroDrawn).toBeLessThanOrEqual(r.mobDrawn * 1.35);  // nhưng không phóng đại vô lý
  assertNoErrors();
});

test('sprite: vào bãi là sprite quái của bãi + nhân vật đã có trong cache (preload)', async ({ page }) => {
  await createCharacter(page);
  await expect.poll(() => page.evaluate(async () => {
    const P = (window as any).__sprite();
    const jw = await (await fetch('jdata/jw.json')).json();
    const z = jw.zones[0];                                   // bãi đầu Dược Vương Cốc
    const m = jw.mon[z.m[0]], a = jw.anim[m.anim];
    const G = (window as any).__G;
    const hw = jw.hero[G.S.fac], ha = jw.anim[hw.anim];
    return P.has('img/a/' + a.st.f) && P.has('img/a/' + ha.st.f) && P.cached >= 20;
  }), { timeout: 15000 }).toBe(true);
  assertNoErrors();
});
