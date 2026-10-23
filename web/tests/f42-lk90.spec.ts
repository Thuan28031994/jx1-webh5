/* F42 — Võ công bậc 90 luyện bằng Võ Lâm Mật Tịch (lk90) phải SỐNG THẬT trong game:
   Trước f42 cấp chiêu 90 nằm ở RW().lk90.lv còn MỌI nơi khác (tab võ công, calc() —
   chiêu chủ động / bị động / hỗ trợ, skillsys tung chiêu, survival, Lực Chiến) chỉ đọc
   S.sk (điểm kỹ năng). Hệ quả: chiêu đã lĩnh ngộ + luyện bằng sách vẫn hiện 0/20 ở tab
   võ công, nút + vẫn sáng và trừ điểm thật vào S.sk, và chiêu KHÔNG hề vào chiến đấu.
   Nay: stats.skillLv() là nguồn cấp chuẩn (chiêu 90 -> lk90Lv, không cộng trang bị),
   calc()/skillsys duyệt gộp cả hai kho id, canLearn() = false cho mọi chiêu 90
   (chặn cả autoSpendSkills + gợi ý), tab võ công hiện cấp sách; nút − ở chiêu 90 chỉ
   còn để hoàn điểm người chơi lỡ cộng nhầm trước đây (S.sk tồn dư).
   Kèm: nút "Chuyển sinh" ngay trong tab Nhân vật (trước đây chôn ở tab cuối cùng
   trong cửa sổ Phần thưởng — 17 tab — người chơi không tìm thấy).
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

async function createCharacter(page: Page, name = 'LĩnhNgộ90') {
  await page.goto('/');
  await expect(page.locator('#pfName')).toBeVisible();
  await page.fill('#pfName', name);
  await page.locator('.facpick button').first().click();   // phái đầu tiên = Thiếu Lâm (chiêu 90: 318/319/321)
  await expect(page.locator('#bNotice')).toBeVisible();
  await page.locator('#bNotice').click();
  const skip = page.locator('#tSkip');
  if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) await skip.click();
  await expect(page.locator('#qBar .qb')).toHaveCount(19);
}

const SK90 = 318;   // Đạt Ma Độ Giang — võ công bậc 90 của Thiếu Lâm (tấn công, req 80, max 20)

/* Chuẩn bị: cấp 90, 10 điểm kỹ năng, nhiều vàng, 6 Mật Tịch trong túi */
const setup = (page: Page) => page.evaluate(() => {
  const g = (window as any).__G;
  g.S.lvl = 90; g.S.skPts = 10; g.S.gold = 100000000;
  g.matAdd('misc', 'bk90', 6);
  g.recalc();
});

/* Lĩnh ngộ + luyện chiêu 318 lên cấp 5 bằng sách, qua đúng modal Lĩnh ngộ như người chơi */
async function learn90ByBooks(page: Page) {
  await page.evaluate(() => (window as any).lk90Modal());
  await expect(page.locator(`#mBody [data-lk-learn="${SK90}"]`)).toBeVisible();
  await page.locator(`#mBody [data-lk-learn="${SK90}"]`).click();
  for (let i = 0; i < 4; i++) {
    await expect(page.locator(`#mBody [data-lk-practice="${SK90}"]`)).toBeVisible();
    await page.locator(`#mBody [data-lk-practice="${SK90}"]`).click();
  }
  const lv = await page.evaluate(() => { const g = (window as any).__G; return (g.RW().lk90 || {}).lv?.[318] || 0; });
  expect(lv, 'sau 1 lĩnh ngộ + 4 luyện: cấp sách phải = 5').toBe(5);
  await page.locator('#mClose').click();
}

const openSkillTab = async (page: Page) => {
  await page.locator('#tabs button[data-t="skill"]').click();
  await expect(page.locator(`.skl[data-id="${SK90}"]`)).toBeVisible();
};

test('chiêu 90 luyện bằng sách: tab hiện cấp sách, vào được chiến đấu, không cộng điểm được', async ({ page }) => {
  await createCharacter(page);
  await setup(page);
  await learn90ByBooks(page);

  await openSkillTab(page);
  await expect(page.locator(`.skl[data-id="${SK90}"] .lvl`), 'tab võ công phải hiện cấp sách 5/20 (trước f42: 0/20)').toHaveText('5/20');

  const combat = await page.evaluate(() => {
    const g = (window as any).__G, P = g.R.P;
    const a = (P.actives || []).find((x: any) => x.id === 318);
    return { found: !!a, L: a ? a.L : null, dps: a ? a.dps : null };
  });
  expect(combat.found, 'chiêu 90 phải có mặt trong P.actives (trước f42: không hề vào chiến đấu)').toBe(true);
  expect(combat.L).toBe(5);
  expect(combat.dps).toBeGreaterThan(0);

  /* nút + phải tắt; bấm cố cũng không trừ điểm, không ghi S.sk */
  const plus = page.locator(`.skl[data-id="${SK90}"] .plus`);
  await expect(plus).toBeDisabled();
  await plus.click({ force: true }).catch(() => {});
  const after = await page.evaluate(() => { const g = (window as any).__G; return { sk: g.S.sk[318] || 0, pts: g.S.skPts }; });
  expect(after.sk, 'cộng điểm vào chiêu 90 phải bị chặn (S.sk giữ nguyên)').toBe(0);
  expect(after.pts).toBe(10);

  /* cửa sổ chi tiết chiêu khớp với tab: 5/20 */
  await page.locator(`.skl[data-id="${SK90}"] .skinfo`).click();
  await expect(page.locator('.skill-detail-level')).toHaveText(/^5\/20/);
  await page.locator('#mClose').click();
  assertNoErrors();
});

test('chiêu 90: điểm lỡ cộng nhầm trước đây (S.sk tồn dư) hoàn được bằng nút −, cấp sách không đổi', async ({ page }) => {
  await createCharacter(page);
  await setup(page);
  await learn90ByBooks(page);
  /* mô phỏng save cũ: người chơi từng bị dụ cộng 3 điểm vào S.sk của chiêu 90 */
  await page.evaluate(() => { const g = (window as any).__G; g.S.sk[318] = 3; g.recalc(); });

  await openSkillTab(page);
  await expect(page.locator(`.skl[data-id="${SK90}"] .lvl`), 'cấp hiện vẫn là cấp sách 5/20, không phải 3 hay 8').toHaveText('5/20');
  const minus = page.locator(`.skl[data-id="${SK90}"] .minus`);
  await expect(minus, 'nút − phải sáng để hoàn điểm tồn dư').toBeEnabled();
  await minus.click();
  const after = await page.evaluate(() => {
    const g = (window as any).__G;
    return { sk: g.S.sk[318] || 0, pts: g.S.skPts, lk: (g.RW().lk90 || {}).lv?.[318] || 0 };
  });
  expect(after.sk).toBe(2);
  expect(after.pts).toBe(11);
  expect(after.lk, 'hoàn điểm không được đụng vào cấp sách').toBe(5);
  assertNoErrors();
});

test('nút Chuyển sinh có mặt ngay trong tab Nhân vật và mở đúng màn hình chuyển sinh', async ({ page }) => {
  await createCharacter(page);
  await setup(page);   // cấp 90 < 100: chưa đủ lần 1
  await page.locator('#tabs button[data-t="char"]').click();
  const btn = page.locator('#bReborn');
  await expect(btn, 'tab Nhân vật phải có nút Chuyển sinh').toBeVisible();
  await expect(btn).toContainText('Chuyển sinh');
  await expect(btn).toContainText('cần cấp 100');

  await page.evaluate(() => { const g = (window as any).__G; g.S.lvl = 100; g.recalc(); });
  await page.locator('#tabs button[data-t="char"]').click();
  await expect(page.locator('#bReborn')).toContainText('đủ cấp');

  await page.locator('#bReborn').click();
  await expect(page.locator('#giftTabs button[data-g="reborn"]')).toHaveClass(/on/);
  await expect(page.locator('#gReborn')).toBeVisible();
  await expect(page.locator('#gReborn')).toHaveText('Chuyển sinh');
  assertNoErrors();
});
