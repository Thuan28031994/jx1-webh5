import { test, expect } from '@playwright/test';

test('V12.7: vao pho ban khong tru luot khi chua chien thang', async ({ page }) => {
  await page.route('**/api/chat/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"online":0,"messages":[]}' }));
  await page.goto('/');
  await expect(page.locator('#pfName')).toBeVisible();
  await page.locator('#pfName').fill('V127PatchTest');
  await page.locator('.facpick button').first().click();
  await page.locator('#bNotice').click();
  const skip = page.locator('#tSkip');
  if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) await skip.click();

  await page.evaluate(() => {
    const G = (window as any).__G;
    G.S.lvl = 30;
    const s = G.RW().dgSave = G.RW().dgSave || {};
    s.day = `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`;
    s.runs = {};
    G.R.dirty = true;
  });
  await page.locator('#qBar .qb[data-q="3"]').click();
  await expect(page.locator('#mBody [data-dg="dvc"]')).toBeEnabled();
  await page.locator('#mBody [data-dg="dvc"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__G.R.dg?.kind)).toBe('dg');
  const attempts = await page.evaluate(() => (window as any).__G.RW().dgSave?.runs?.dvc || 0);
  expect(attempts).toBe(0);
});
