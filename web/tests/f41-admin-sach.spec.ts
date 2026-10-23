/* F41 — Bảng thử nghiệm (admin.ts): thêm 2 nút tạo sách nhanh "Tạo Tẩy Tủy Kinh" (ttk)
   và "Tạo Dịch Căn Kinh" (vlmt), dùng chung modal số lượng adminBookModal(key, name, desc)
   với bk90 (Võ Lâm Mật Tịch). Cả hai sách đều vào túi nguyên liệu qua matAdd('misc', key, n)
   và dùng qua useBook (rewards.ts): ttk +điểm tiềm năng từ cấp 80, vlmt +1 điểm võ công
   từ cấp 80/đã chuyển sinh, tối đa 15 cuốn mỗi nhân vật.
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

async function createCharacter(page: Page, name = 'TạoSách') {
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

/* Mở Bảng thử nghiệm (đường UI như f38) */
async function openAdmin(page: Page) {
  await page.locator('#tabs button[data-t="more"]').click();
  await page.locator('#t-more [data-account-tab="test"]').click();
  await page.locator('#bAdmin').click();
  await expect(page.locator('#modal:not(.hidden)')).toBeVisible();
  await expect(page.locator('#mBody [data-ad="bk90"]')).toBeVisible();
}

const miscCount = (page: Page, k: string) => page.evaluate((key) => {
  const S = (window as any).__G.S;
  return (((S.mats || {}).misc || {})[key] || 0) as number;
}, k);

/* Bấm nút tạo sách trong Bảng thử nghiệm, nhập số lượng trong modal, xác nhận;
   modal OK xong tự quay lại Bảng thử nghiệm (adminModal). */
async function grantBook(page: Page, k: string, title: string, n: number) {
  await page.locator(`#mBody [data-ad="${k}"]`).click();
  await expect(page.locator('#mBody h3', { hasText: title })).toBeVisible();
  await page.fill('#aiBookCount', String(n));
  await page.locator('#aiBookOk').click();
  await expect(page.locator('#mBody [data-ad="bk90"]')).toBeVisible();
}

test('bảng thử nghiệm: có đủ 2 nút tạo sách mới Tẩy Tủy Kinh + Dịch Căn Kinh', async ({ page }) => {
  await createCharacter(page);
  await openAdmin(page);
  const ttk = page.locator('#mBody [data-ad="ttk"]');
  const vlmt = page.locator('#mBody [data-ad="vlmt"]');
  await expect(ttk).toBeVisible();
  await expect(vlmt).toBeVisible();
  // nút nằm trong card có đúng tên sách như hiển thị trong game
  await expect(page.locator('#mBody .card:has([data-ad="ttk"])')).toContainText('Tạo Tẩy Tủy Kinh');
  await expect(page.locator('#mBody .card:has([data-ad="vlmt"])')).toContainText('Tạo Dịch Căn Kinh');
  assertNoErrors();
});

test('tạo Tẩy Tủy Kinh: nhập 3 -> túi nguyên liệu có đúng +3 ttk', async ({ page }) => {
  await createCharacter(page);
  await openAdmin(page);
  const before = await miscCount(page, 'ttk');
  expect(before).toBe(0);
  await grantBook(page, 'ttk', 'Tạo Tẩy Tủy Kinh', 3);
  expect(await miscCount(page, 'ttk')).toBe(before + 3);
  assertNoErrors();
});

test('tạo Dịch Căn Kinh: nhập 2 -> túi nguyên liệu có đúng +2 vlmt', async ({ page }) => {
  await createCharacter(page);
  await openAdmin(page);
  const before = await miscCount(page, 'vlmt');
  expect(before).toBe(0);
  await grantBook(page, 'vlmt', 'Tạo Dịch Căn Kinh', 2);
  expect(await miscCount(page, 'vlmt')).toBe(before + 2);
  assertNoErrors();
});

test('hồi quy: tạo Võ Lâm Mật Tịch (bk90) vẫn chạy qua modal dùng chung', async ({ page }) => {
  await createCharacter(page);
  await openAdmin(page);
  const before = await miscCount(page, 'bk90');
  expect(before).toBe(0);
  await grantBook(page, 'bk90', 'Tạo Võ Lâm Mật Tịch', 2);
  expect(await miscCount(page, 'bk90')).toBe(before + 2);
  assertNoErrors();
});
