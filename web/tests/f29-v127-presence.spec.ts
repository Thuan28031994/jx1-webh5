import { test, expect } from '@playwright/test';

test('V12.7 presence: mac dinh tat, bat/tat doc lap voi PK va khong tao session khi tat', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/chat/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"online":0,"messages":[]}' }));
  await page.route('**/api/mp/session', route => {
    requests++;
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"mock offline"}' });
  });
  await page.goto('/');
  await page.locator('#pfName').fill('PresenceTest');
  await page.locator('.facpick button').first().click();
  await page.locator('#bNotice').click();
  const skip = page.locator('#tSkip');
  if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) await skip.click();
  const btn = page.locator('#vloPresenceToggle');
  await expect(btn).toHaveText('Online: tắt');
  expect(requests).toBe(0);
  await expect(page.locator('#mpStatus')).toHaveText('Map · Local');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => requests).toBeGreaterThan(0);
  const state = await page.evaluate(() => (window as any).__VLO_PRESENCE_V127());
  expect(state.active).toBe(true);
  expect(state.socketCount).toBe(0);
  await btn.click();
  await expect(btn).toHaveText('Online: tắt');
  await expect(page.locator('#mpStatus')).toHaveText('Map · Local');
  expect((await page.evaluate(() => (window as any).__VLO_PRESENCE_V127())).active).toBe(false);
});
