/* F31 — Bang Hội 2.0 (activities.ts): mở rộng bang NPC sẵn có (góp vàng / cấp / buff giữ nguyên)
   thêm: thành viên NPC sinh tất định từ seed, nhiệm vụ bang 3/ngày đọc số đếm Sổ tay + dgSave,
   Boss Bang 3 lượt/tuần (khuôn Tống Kim, R.gboss), cửa hàng điểm cống hiến.
   Hằng số: 10.000 lượng góp = 1 điểm · nhiệm vụ +25 điểm/+3 Phúc Duyên · Boss Bang 4 đợt, trùm ×10 máu.
   MOCK /api/chat/* như mọi test; ép state qua __G.GH (khuôn __G.KN của f27). */
import { test, expect, Page } from '@playwright/test';

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.route('**/api/chat/status', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, online: 0 }) }));
  page.route('**/api/chat/stream*', r => { /* treo */ });
  page.route('**/api/chat/messages*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, messages: [] }) }));
  page.route('**/api/chat/presence*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
});
const assertNoErrors = () => expect(errors, errors.join('\n')).toEqual([]);

async function createCharacter(page: Page, name = 'BangHội2') {
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

async function openGuild(page: Page) {
  await page.locator('#qBar .qb[data-q="8"]').click();          // nút nhanh "Bang hội" trên thanh Giang hồ
  await expect(page.locator('#mBody')).toContainText('Bang hội (NPC)');
}

test('bang hội 2.0: tab giữ UI góp vàng cũ + đủ mục mới (thành viên, 3 nhiệm vụ, Boss Bang 3/3, shop >= 4, điểm cống hiến)', async ({ page }) => {
  await createCharacter(page);
  await openGuild(page);
  // UI cũ còn nguyên
  await expect(page.locator('#mBody')).toContainText('Cấp bang');
  await expect(page.locator('#mBody [data-gd]').first()).toBeVisible();
  // Điểm cống hiến + thành viên NPC
  await expect(page.locator('#mBody')).toContainText('Điểm cống hiến');
  await expect(page.locator('#mBody')).toContainText('Thành viên');
  expect(await page.locator('#mBody .gh-mems .qrow').count()).toBeGreaterThanOrEqual(8);
  const mem = await page.evaluate(() => { const G = (window as any).__G; const ms = G.GH.members(); return { n: ms.length, ok: ms.every((m: any) => m.name && m.fac && m.lvl >= 1) }; });
  expect(mem.n).toBeGreaterThanOrEqual(8);
  expect(mem.ok).toBe(true);
  // Nhiệm vụ bang: đúng 3
  await expect(page.locator('#mBody')).toContainText('Nhiệm vụ bang hôm nay');
  await expect(page.locator('#mBody [data-gq]')).toHaveCount(3);
  // Boss Bang: còn 3/3 lượt tuần
  await expect(page.locator('#mBody')).toContainText('Boss Bang');
  await expect(page.locator('#mBody')).toContainText('còn 3/3 lượt');
  await expect(page.locator('#gbGo')).toBeVisible();
  // Cửa hàng bang >= 4 món
  await expect(page.locator('#mBody')).toContainText('Cửa hàng bang');
  expect(await page.locator('#mBody [data-ghs]').count()).toBeGreaterThanOrEqual(4);
  assertNoErrors();
});

test('bang hội 2.0: đóng góp vàng — cấp bang tăng VÀ điểm cống hiến tăng (10.000 lượng = 1 điểm)', async ({ page }) => {
  await createCharacter(page);
  await page.evaluate(() => { const G = (window as any).__G; G.S.gold = 100000000; G.save(); });
  await openGuild(page);
  const before = await page.evaluate(() => { const g = (window as any).__G.GH.state; return { lv: g.lv, pts: g.pts }; });
  expect(before.lv).toBe(0);
  await page.locator('#mBody [data-gd]').nth(2).click();        // nút góp TRỌN chi phí cấp kế (c) — đủ lên cấp 1
  const after = await page.evaluate(() => { const g = (window as any).__G.GH.state; return { lv: g.lv, pts: g.pts }; });
  expect(after.lv).toBeGreaterThanOrEqual(1);
  expect(after.pts).toBeGreaterThanOrEqual(10);                 // c >= 100.000 -> >= 10 điểm
  expect(after.pts).toBeGreaterThan(before.pts);
  assertNoErrors();
});

test('bang hội 2.0: nhiệm vụ ngày — đủ tiến độ thì Nhận được, +25 điểm +3 Phúc Duyên, không nhận 2 lần', async ({ page }) => {
  await createCharacter(page);
  await page.evaluate(() => {
    const G = (window as any).__G, p2 = (n: number) => String(n).padStart(2, '0'), d = new Date();
    const iso = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;          // localISODay (có đệm 0)
    const dgk = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;                  // dayKey của hoatdong (không đệm)
    G.S.journal = { days: { [iso]: { sec: 0, xp: 0, gold: 1000000000, kills: 99999, bosses: 999, r2: 500, r3: 500, set: 100, other: 500, deaths: [], deathN: 0 } } };
    const r = G.RW(); r.dgSave = { day: dgk, runs: { dvc: 9 }, boat: 9 };
    G.save();
  });
  await openGuild(page);
  const btn = page.locator('#mBody [data-gq="0"]');
  await expect(btn).toBeEnabled();
  const before = await page.evaluate(() => { const G = (window as any).__G; return { pts: G.GH.state.pts, fd: G.RW().fd }; });
  await btn.click();
  const after = await page.evaluate(() => { const G = (window as any).__G; return { pts: G.GH.state.pts, fd: G.RW().fd, claimed: G.GH.daily().quests[0].claimed }; });
  expect(after.claimed).toBe(true);
  expect(after.pts).toBe(before.pts + 25);
  expect(after.fd).toBe(before.fd + 3);
  await expect(page.locator('#mBody [data-gq="0"]')).toBeDisabled();
  await expect(page.locator('#mBody [data-gq="0"]')).toContainText('Đã nhận');
  const again = await page.evaluate(() => (window as any).__G.GH.claim(0));
  expect(again.ok).toBe(false);
  assertNoErrors();
});

test('bang hội 2.0: Boss Bang — vào trận sinh quái + tính 1 lượt, rời trận dọn sạch state và cộng điểm', async ({ page }) => {
  await createCharacter(page);
  await page.evaluate(() => { const G = (window as any).__G; G.S.lvl = 50; G.R.dirty = true; G.save(); });
  await openGuild(page);
  const ptsBefore = await page.evaluate(() => (window as any).__G.GH.state.pts);
  await page.locator('#gbGo').click();
  await expect.poll(() => page.evaluate(() => { const G = (window as any).__G; return !!(G.R.gboss && G.R.enemies.length > 0); }), { timeout: 8000 }).toBe(true);
  const mid = await page.evaluate(() => { const G = (window as any).__G; return { wave: G.R.gboss.wave, tries: G.GH.bossState().tries, flagged: G.R.enemies.every((e: any) => e.gboss) }; });
  expect(mid.wave).toBe(1);
  expect(mid.tries).toBe(1);
  expect(mid.flagged).toBe(true);
  await page.evaluate(() => (window as any).__G.GH.exit(false, false));
  const end = await page.evaluate(() => { const G = (window as any).__G; return { gboss: G.R.gboss, pts: G.GH.state.pts, enemies: G.R.enemies.length }; });
  expect(end.gboss).toBeNull();
  expect(end.pts).toBeGreaterThanOrEqual(ptsBefore + 10);      // rời ngay đợt 1: vẫn nhận điểm cơ bản
  assertNoErrors();
});

test('bang hội 2.0: cửa hàng — đổi Phúc Duyên bằng điểm cống hiến, điểm trừ đúng giá', async ({ page }) => {
  await createCharacter(page);
  await openGuild(page);                                        // mở tab trước: __G.GH chỉ expose khi tab Bang hội render
  await page.evaluate(() => { const G = (window as any).__G; G.GH.state.pts = 200; G.save(); });
  await page.locator('#giftTabs [data-g="guild"]').click();     // render lại tab với số điểm mới (nút Đổi hết disabled)
  await expect(page.locator('#mBody [data-ghs="0"]')).toBeEnabled();
  const before = await page.evaluate(() => { const G = (window as any).__G; return { pts: G.GH.state.pts, fd: G.RW().fd }; });
  await page.locator('#mBody [data-ghs="0"]').click();          // 50 điểm -> 20 Phúc Duyên
  const after = await page.evaluate(() => { const G = (window as any).__G; return { pts: G.GH.state.pts, fd: G.RW().fd }; });
  expect(after.pts).toBe(before.pts - 50);
  expect(after.fd).toBe(before.fd + 20);
  assertNoErrors();
});
