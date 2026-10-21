import { test, expect } from '@playwright/test';

test('V12.4: menu hoat dong khong bi cat, mo duoc pho ban va nhiem vu', async ({ page }) => {
  await page.route('**/api/chat/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"online":0,"messages":[]}' }));
  await page.goto('/');
  await expect(page.locator('#pfName')).toBeVisible();
  await page.locator('#pfName').fill('ModePortTest');
  await page.locator('.facpick button').first().click();
  await page.locator('#bNotice').click();
  const skip = page.locator('#tSkip');
  if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) await skip.click();

  await expect(page.locator('#mswBtn')).toBeVisible();
  await page.locator('#mswBtn').click();
  await expect(page.locator('#mswMenu [data-msw="dg"]')).toBeVisible();
  const host = await page.locator('#mswMenu').evaluate(n => n.parentElement?.tagName);
  expect(host).toBe('BODY');

  await page.locator('#mswMenu [data-msw="dg"]').click();
  await expect(page.locator('#mBody')).toContainText('Hoạt động giang hồ');
  await page.locator('#mClose').click();
  await page.locator('#mswBtn').click();
  await page.locator('#mswMenu [data-msw="quest"]').click();
  await expect(page.locator('#mBody')).toContainText('Nhiệm vụ');
});
