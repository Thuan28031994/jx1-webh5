/* F38 — Dropdown thuộc tính trong "Tạo vật phẩm theo ý" (admin.ts): nhãn option phải là
   ĐÚNG dòng chữ sẽ in trên đồ — attrText(attrName(a), affixMax map -1 -> 0) như loot.ts
   render tooltip — thay cho nhãn cũ `${a.n} · ${attrName(a.a)}` (tên bậc + khóa thô tiếng
   Anh kiểu "Trường thọ · lifemax_v", không khớp gì trên đồ). Option value vẫn là id thuộc
   tính; danh sách sắp xếp theo nhãn mới.
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

async function createCharacter(page: Page, name = 'QuảnĐồ') {
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

/* Bảng thử nghiệm -> "Tạo vật phẩm theo ý" (đường UI như f7 mở admin) */
async function openItemCreator(page: Page) {
  await page.locator('#tabs button[data-t="more"]').click();
  await page.locator('#t-more [data-account-tab="test"]').click();
  await page.locator('#bAdmin').click();
  await expect(page.locator('#modal:not(.hidden)')).toBeVisible();
  await page.locator('#mBody [data-ad="item"]').click();
  await expect(page.locator('#mBody .admin-item-form')).toBeVisible();
  await expect(page.locator('#mBody [data-ai-aff]')).toHaveCount(6);
}

const readOptions = (page: Page) => page.evaluate(() => {
  const sel = document.querySelector('#mBody [data-ai-aff]') as HTMLSelectElement;
  return [...sel.options].map(o => ({ v: o.value, t: o.textContent || '' }));
});

test('dropdown thuộc tính: nhãn là chữ trên đồ, không còn khóa thô, sắp xếp theo nhãn', async ({ page }) => {
  await createCharacter(page);
  await openItemCreator(page);
  const opts = (await readOptions(page)).filter(o => o.v !== '');
  expect(opts.length, 'pool thuộc tính phải có hơn 40 lựa chọn').toBeGreaterThan(40);
  for (const o of opts) {
    expect(o.t, `nhãn của thuộc tính ${o.v} còn chứa khóa thô`).not.toContain('_');
    expect(o.t, `nhãn của thuộc tính ${o.v} còn dạng "tên · khóa"`).not.toMatch(/[a-z]+_(v|p|b|a)\b/);
  }
  // sắp xếp theo nhãn mới (đối chiếu bằng chính localeCompare trong trang)
  const sorted = await page.evaluate(() => {
    const sel = document.querySelector('#mBody [data-ai-aff]') as HTMLSelectElement;
    const ls = [...sel.options].slice(1).map(o => o.textContent || '');
    return { ls, srt: [...ls].sort((a, b) => a.localeCompare(b)) };
  });
  expect(sorted.ls).toEqual(sorted.srt);
  // hai thuộc tính quen thuộc: nhãn = attrText ở giá trị mặc định (max của bậc cao nhất)
  expect(opts.find(o => o.v === '85')?.t, 'lifemax_v phải hiện như trên đồ').toBe('Sinh lực tối đa: +200 điểm');
  expect(opts.find(o => o.v === '43')?.t, 'indestructible_b phải hiện như trên đồ').toBe('Không thể phá hủy');
  assertNoErrors();
});

test('dropdown thuộc tính: nhãn khớp dòng xem trước và món tạo ra mang đúng dòng đó', async ({ page }) => {
  await createCharacter(page);
  await openItemCreator(page);
  const opts = await readOptions(page);
  const lbl85 = opts.find(o => o.v === '85')?.t || '';
  const lbl43 = opts.find(o => o.v === '43')?.t || '';
  expect(lbl85).toBe('Sinh lực tối đa: +200 điểm');

  const sels = page.locator('#mBody [data-ai-aff]');
  await sels.nth(0).selectOption('85');   // Dòng 1: hiện (class m), không hậu tố
  await sels.nth(1).selectOption('43');   // Dòng 2: dòng ẩn, có thể kèm hậu tố " (ẩn...)"
  await expect.poll(() => page.evaluate(() => {
    const divs = [...document.querySelectorAll('#aiPreview .sl div')].map(d => d.textContent || '');
    return divs.some(t => t === 'Sinh lực tối đa: +200 điểm');
  }), { timeout: 8000 }).toBe(true);

  const lines = await page.evaluate(() => [...document.querySelectorAll('#aiPreview .sl div')].map(d => d.textContent || ''));
  const line85 = lines.find(t => t.includes('Sinh lực tối đa'));
  expect(line85, 'dòng xem trước của Dòng 1 phải BẰNG nhãn dropdown').toBe(lbl85);
  const line43 = lines.find(t => t.includes('Không thể phá hủy'));
  expect(line43, 'dòng xem trước của Dòng 2 phải bắt đầu bằng nhãn dropdown').toBeDefined();
  expect(line43 === lbl43 || (line43 as string).startsWith(lbl43 + ' (ẩn'), `dòng 2 "${line43}" phải là nhãn "${lbl43}" (+ hậu tố ẩn)`).toBe(true);

  // tạo thật vào hành trang: món mới mang đúng 2 dòng đã chọn, giá trị mặc định = max
  const before = await page.evaluate(() => (window as any).__G.S.inv.length);
  await page.locator('#aiCreate').click();
  await expect(page.locator('#modal')).toBeHidden();
  const after = await page.evaluate(() => {
    const it = (window as any).__G.S.inv[0];
    return { n: (window as any).__G.S.inv.length, mag: it.mag.map((m: any) => ({ a: m.a, p0: m.p[0] })), locked: it.locked };
  });
  expect(after.n).toBe(before + 1);
  expect(after.mag).toEqual([{ a: 85, p0: 200 }, { a: 43, p0: 1 }]);
  expect(after.locked).toBe(true);
  assertNoErrors();
});
