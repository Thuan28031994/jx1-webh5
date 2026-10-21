/* F27 — Kỳ Ngộ Giang Hồ: sự kiện ngẫu nhiên có lựa chọn khi luyện công (kyngo.ts).
   Đồng hồ 300–540s ngoài bãi, tối đa 8/ngày (KN_DAY_MAX), modal khóa phải chọn mới thoát,
   pending lưu trong RW().kn. Test ép mở qua __G.KN (trigger/state/events) như f17 ép state. */
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

async function createCharacter(page: Page, name = 'KỳNgộ') {
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

test('kỳ ngộ: ép mở sự kiện — modal khóa hiện tiêu đề + ít nhất 2 lựa chọn, kho sự kiện >= 10', async ({ page }) => {
  await createCharacter(page);
  const pool = await page.evaluate(() => (window as any).__G.KN.events.length);
  expect(pool).toBeGreaterThanOrEqual(10);
  const ok = await page.evaluate(() => (window as any).__G.KN.trigger('caonhan'));
  expect(ok).toBe(true);
  await expect(page.locator('#modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('#modal')).toHaveAttribute('data-locked', '1');   // khóa: không đóng/X thoát được
  await expect(page.locator('#mBody h3')).toContainText('Kỳ Ngộ');
  await expect(page.locator('#mBody h3')).toContainText('Cao Nhân Truyền Công');
  await expect(page.locator('#mBody [data-kn-choice]')).toHaveCount(3);
  assertNoErrors();
});

test('kỳ ngộ: chọn 1 lựa chọn — modal đóng, state total=1 n=1, đồng hồ đặt lại > 0, buff XP được cộng', async ({ page }) => {
  await createCharacter(page);
  await page.evaluate(() => (window as any).__G.KN.trigger('caonhan'));
  await page.locator('#mBody [data-kn-choice="0"]').click();          // "Lắng nghe chỉ điểm": buff +30% XP 30 phút (ktc)
  await expect(page.locator('#modal')).toHaveClass(/hidden/);
  const st = await page.evaluate(() => {
    const G = (window as any).__G, k = G.KN.state, buf = (G.RW().ktcBuf || {}).xp;
    return { total: k.total, n: k.n, t: k.t, pending: k.pending, buffP: buf && buf.p, buffLeft: buf && (buf.until - Date.now()) };
  });
  expect(st.total).toBe(1);
  expect(st.n).toBe(1);
  expect(st.t).toBeGreaterThan(0);
  expect(st.pending).toBeFalsy();
  expect(st.buffP).toBe(30);
  expect(st.buffLeft).toBeGreaterThan(0);
  assertNoErrors();
});

test('kỳ ngộ: đạt trần ngày (n = 8) — ép mở không hiện modal', async ({ page }) => {
  await createCharacter(page);
  const ok = await page.evaluate(() => {
    const G = (window as any).__G;
    G.KN.state.n = 8; G.save();                                        // KN_DAY_MAX = 8
    return G.KN.trigger('caonhan');
  });
  expect(ok).toBe(false);
  await expect(page.locator('#modal')).toHaveClass(/hidden/);
  assertNoErrors();
});

test('kỳ ngộ: đang bận (hero gục — deadT) — ép mở không hiện modal, hết bận mở lại được', async ({ page }) => {
  await createCharacter(page);
  const blocked = await page.evaluate(() => {
    const G = (window as any).__G;
    G.R.deadT = 999;                                                   // guard: hero đang gục
    const ok = G.KN.trigger('caonhan');
    G.R.deadT = 0;                                                     // dọn cờ ngay trong cùng evaluate (tick không chen giữa)
    return ok;
  });
  expect(blocked).toBe(false);
  await expect(page.locator('#modal')).toHaveClass(/hidden/);
  const ok2 = await page.evaluate(() => (window as any).__G.KN.trigger('caonhan'));
  expect(ok2).toBe(true);
  await expect(page.locator('#mBody h3')).toContainText('Kỳ Ngộ');
  assertNoErrors();
});
