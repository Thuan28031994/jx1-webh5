/* F35 — Ma Vương Thảo Phạt (mavuong.ts): boss ngày TẤT ĐỊNH theo localISODay (7 boss),
   3 lượt/ngày + mua thêm tối đa 3 lượt (5 Phúc Duyên), trận 90 giây với hook cộng dồn
   sát thương trong combat.ts (cờ R.mvboss + mvAddDamage qua heroHit), mốc sát thương
   ngày scale theo DPS thật (R.P.main.dps qua calc()) chốt stdRun đầu ngày, bảng đua
   10 NPC tất định theo seed, thưởng hạng settle lười khi qua ngày.
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

async function createCharacter(page: Page, name = 'ThảoMa') {
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

test('ma vương: boss ngày tất định — cùng ngày cùng boss, nhiều ngày có boss khác nhau', async ({ page }) => {
  await createCharacter(page);
  const r = await page.evaluate(() => {
    const W = (window as any).__G.WB;
    const a = W.bossFor('2026-10-22'), b = W.bossFor('2026-10-22');
    const names = new Set<string>();
    for (let d = 1; d <= 14; d++) names.add(W.bossFor(`2026-11-${String(d).padStart(2, '0')}`).name);
    return { same: a.name === b.name && a.series === b.series, distinct: names.size, today: W.boss().name, roster: W.bosses.length };
  });
  expect(r.same).toBe(true);
  expect(r.roster).toBe(7);
  expect(r.distinct).toBeGreaterThanOrEqual(3);   // 14 ngày phải luân phiên nhiều boss
  expect(r.today).toBeTruthy();
  assertNoErrors();
});

test('ma vương: tích hợp combat thật — vào trận sinh boss, auto-combat gây sát thương cộng dồn', async ({ page }) => {
  await createCharacter(page);
  await page.evaluate(() => { const G = (window as any).__G; G.S.lvl = 30; G.R.dirty = true; G.recalc(); });
  const start = await page.evaluate(() => { const G = (window as any).__G; const r = G.WB.start(); const st = G.WB.state; return { ok: r.ok, tries: st.tries, flag: !!G.R.mvboss, n: G.R.enemies.length, mv: G.R.enemies.length ? !!G.R.enemies[0].mvBoss : false, hp: G.R.enemies.length ? G.R.enemies[0].max : 0, cap: G.WB.hp(st.stdRun) }; });
  expect(start.ok).toBe(true);
  expect(start.tries).toBe(1);
  expect(start.flag).toBe(true);
  expect(start.n).toBe(1);
  expect(start.mv).toBe(true);
  expect(start.hp).toBe(start.cap);                       // máu boss = runStd × 6
  // auto-combat đánh thật: runDmg phải tăng > 0 nhờ hook heroHit (nếu gục giữa chừng, finish yên lặng đã chốt vào best)
  await expect.poll(() => page.evaluate(() => { const s = (window as any).__G.WB.state; return Math.max(s.runDmg, s.best); }), { timeout: 20000 }).toBeGreaterThan(0);
  const fin = await page.evaluate(() => { const G = (window as any).__G; const wasActive = !!G.R.mvboss; const run = wasActive ? G.WB.state.runDmg : G.WB.state.best; if (wasActive) G.WB.finish(false, false); const st = G.WB.state; return { run, best: st.best, total: st.total, flag: G.R.mvboss }; });
  expect(fin.best).toBe(Math.round(fin.run));
  expect(fin.total).toBeGreaterThanOrEqual(fin.best - 1);   // total chưa làm tròn, best đã round ở finish
  expect(fin.flag).toBeNull();
  assertNoErrors();
});

test('ma vương: addDamage cộng đúng runDmg + total, trần = máu boss; hết lượt bị chặn, mua lượt bằng Phúc Duyên', async ({ page }) => {
  await createCharacter(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, W = G.WB;
    W.start(); W.addDamage(1000);
    const mid = { run: W.state.runDmg, total: W.state.total };
    W.addDamage(1e12);                                    // vượt trần → kẹp ở hpCap
    const capped = { run: W.state.runDmg, cap: G.R.mvboss.hpCap };
    W.finish(false, true);
    W.state.tries = 3;                                    // dùng hết 3 lượt miễn phí
    const blocked = W.start();
    G.RW().fd = 20; G.save();
    const buy1 = W.buy();                                 // +1 lượt, −5 FD
    const afterBuy = { fd: G.RW().fd, bought: W.state.bought };
    const startOk = W.start(); W.finish(false, true);
    W.state.bought = 3;                                   // chạm trần mua
    const buyCap = W.buy();
    return { mid, capped, blocked, buy1, afterBuy, startOk, buyCap };
  });
  expect(r.mid).toEqual({ run: 1000, total: 1000 });
  expect(r.capped.run).toBe(r.capped.cap);
  expect(r.blocked.ok).toBe(false);
  expect(r.buy1.ok).toBe(true);
  expect(r.afterBuy).toEqual({ fd: 15, bought: 1 });
  expect(r.startOk.ok).toBe(true);
  expect(r.buyCap.ok).toBe(false);
  assertNoErrors();
});

test('ma vương: mốc thưởng — chưa đạt không nhận được, đạt thì grant đúng, nhận 2 lần bị chặn', async ({ page }) => {
  await createCharacter(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, W = G.WB, st = W.state;
    const ms = W.milestones(st.stdRun);
    const early = W.claim(0);                             // total = 0 < mốc 1
    st.total = ms[4].need; G.save();                      // đạt cả 5 mốc
    const fd0 = G.RW().fd || 0, knb0 = G.RW().knb || 0;
    const c1 = W.claim(0);                                // +3 FD
    const c1b = W.claim(0);                               // chặn nhận lại
    const ht0 = G.matHave('ht', W.state.stdRun ? Math.min(10, Math.floor(G.S.lvl / 15) + 1) : 1);
    const c4 = W.claim(3);                                // +15 FD + 2 Huyền Tinh
    const ht1 = G.matHave('ht', Math.min(10, Math.floor(G.S.lvl / 15) + 1));
    const c5 = W.claim(4);                                // +35 FD + 1 KNB
    return { ms: ms.map((x: any) => x.need), early, c1, c1b, c4, c5, fd: (G.RW().fd || 0) - fd0, knb: (G.RW().knb || 0) - knb0, htDelta: ht1 - ht0 };
  });
  expect(r.ms.length).toBe(5);
  expect(r.ms[0]).toBeGreaterThan(0);
  expect(r.ms[4]).toBeGreaterThan(r.ms[0]);
  expect(r.early.ok).toBe(false);
  expect(r.c1.ok).toBe(true);
  expect(r.c1b.ok).toBe(false);
  expect(r.c4.ok).toBe(true);
  expect(r.htDelta).toBe(2);
  expect(r.c5.ok).toBe(true);
  expect(r.fd).toBe(3 + 15 + 35);
  expect(r.knb).toBe(1);
  assertNoErrors();
});

test('ma vương: settle hạng hôm qua — qua ngày chốt hạng, nhận thưởng hạng 1 đúng 1 lần', async ({ page }) => {
  await createCharacter(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, W = G.WB, st = W.state;
    st.day = '2026-10-20';                                // giả lập hôm qua đã chơi
    st.total = (st.stdRun || W.runStd()) * 3 * 100;       // tổng khổng lồ → chắc chắn hạng 1
    G.save();
    const si = W.settleInfo();                            // truy cập state → settle lười chạy
    const fd0 = G.RW().fd || 0, knb0 = G.RW().knb || 0;
    const c = W.claimRank();
    const again = W.claimRank();
    return { si, c, again, fd: (G.RW().fd || 0) - fd0, knb: (G.RW().knb || 0) - knb0, today: W.state.day, totalReset: W.state.total };
  });
  expect(r.si.lastDay).toBe('2026-10-20');
  expect(r.si.lastRank).toBe(1);
  expect(r.si.canClaim).toBe(true);
  expect(r.c.ok).toBe(true);
  expect(r.fd).toBe(20);
  expect(r.knb).toBe(1);
  expect(r.again.ok).toBe(false);
  expect(r.totalReset).toBe(0);                           // ngày mới đã reset tổng
  assertNoErrors();
});

test('ma vương: UI — nút vào ở tab Dã Tẩu, view đủ boss hôm nay + 5 mốc + bảng đua 11 dòng', async ({ page }) => {
  await createCharacter(page);
  await page.locator('#qBar .qb[data-q="8"]').click();
  await page.locator('#giftTabs button[data-g="yt"]').click();
  await expect(page.locator('#mBody #mvGo')).toBeVisible();
  await expect(page.locator('#mBody #mvGo')).toContainText('Ma Vương Thảo Phạt');
  await page.locator('#mBody #mvGo').click();
  await expect(page.locator('#mBody')).toContainText('Ma Vương Thảo Phạt: mỗi ngày 1 Ma Vương');
  await expect(page.locator('#mBody [data-mv-claim]')).toHaveCount(5);
  await expect(page.locator('#mBody #mvStart')).toBeVisible();
  for (const n of ['Kiếm Thánh Vô Danh', 'Huyết Thủ Đồ Phu', 'Hắc Phong Song Sát']) {
    await expect(page.locator('#mBody')).toContainText(n);
  }
  await expect(page.locator('#mBody')).toContainText('(bạn)');
  await expect(page.locator('#mBody')).toContainText('Bảng đua hôm nay');
  assertNoErrors();
});
