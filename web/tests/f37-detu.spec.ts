/* F37 — Đệ Tử / Thu Nhận Môn Đồ (detu.ts): tuyển đệ tử tốn 20 Phúc Duyên, ô theo
   cấp (2 + floor(lvl/25), tối đa 6), danh tính TẤT ĐỊNH theo (seed save, thứ tự
   thu nhận) như ghGenMember f31, PHẨM CHẤT tung lúc tuyển (Thường 62% ×1.0 ·
   Lương Tài 26% ×1.5 · Tinh Anh 9% ×2.2 · Thiên Tài 3% ×3.5 — ép bằng roll qua
   __G.DT.recruit(roll)). Đệ tử tích giờ theo timestamp `since` (trần 8 giờ),
   3 việc: Luyện Công (60 XP/giờ × rate qua gainXp), Hái Thuốc (0.5 Huyền
   Tinh/giờ × rate, giữ phần lẻ htAcc), Du Ngoạn (300 lượng/giờ × rate + quà
   mỗi 4 giờ). rate = phẩm chất × (1 + 0.1×(cấp đệ tử − 1)) × (1 +
   floor(cấp người chơi/50)×0.5). Đổi việc thu tự động phần đã tích trước.
   Mọi đo delta (XP/lượng/Huyền Tinh) làm TRONG MỘT page.evaluate để game
   nền (auto-combat) không xen vào giữa hai lần đọc.
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

async function createCharacter(page: Page, name = 'SưPhụ') {
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

test('đệ tử: thu nhận trừ 20 Phúc Duyên, phẩm chất ép theo roll, đầy ô thì chặn không trừ', async ({ page }) => {
  await createCharacter(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, D = G.DT;
    G.RW().fd = 100; G.save();
    const q = [D.qualOf(0), D.qualOf(0.7), D.qualOf(0.9), D.qualOf(0.99)];   // ngưỡng phẩm chất
    const r1 = D.recruit(0.99);                        // Thiên Tài
    const fd1 = G.RW().fd;
    const r2 = D.recruit(0.0);                         // Thường
    const full = D.recruit(0.5);                       // ô cấp 1 = 2 → đầy, chặn
    const st = D.state;
    return { q, r1, r2, full, fd1, fd2: G.RW().fd, n: st.list.length, recruited: st.recruited, cap: D.cap() };
  });
  expect(r.q).toEqual([0, 1, 2, 3]);
  expect(r.r1.ok).toBe(true);
  expect(r.r1.d.qual).toBe(3);
  expect(r.r1.d.lvl).toBe(1);
  expect(r.r1.d.job).toBe('luyen');
  expect(r.r1.d.name).toBeTruthy();
  expect(r.r1.d.sect).toBeTruthy();
  expect(r.fd1).toBe(80);
  expect(r.r2.ok).toBe(true);
  expect(r.r2.d.qual).toBe(0);
  expect(r.r2.d.id).not.toBe(r.r1.d.id);
  expect(r.full.ok).toBe(false);
  expect(r.fd2).toBe(60);                              // bị chặn → không trừ thêm
  expect(r.n).toBe(2);
  expect(r.cap).toBe(2);
  expect(r.recruited).toBe(2);
  assertNoErrors();
});

test('đệ tử: luyện công 3 giờ → thu được đúng 60×3×rate XP, mốc since reset, đệ tử +30 XP', async ({ page }) => {
  await createCharacter(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, D = G.DT;
    G.S.lvl = 30; G.R.dirty = true; G.recalc();        // playerFactor = 1, xpSlow(30) = 1, không lên cấp vì 180 XP
    G.RW().fd = 100; G.save();
    const rec = D.recruit(0.0);                        // Thường, lvl 1 → rate 1.0
    const d = D.state.list[0];
    d.since = Date.now() - 3 * 3600000; G.save();
    const p = D.pending(d.id);
    const rate = D.rate(d);
    const xp0 = G.S.xp;
    const c = D.collect(d.id);
    const dxp = G.S.xp - xp0;
    return { p, rate, c, dxp, discXp: d.xp, discLvl: d.lvl, sinceAge: Date.now() - d.since };
  });
  expect(r.rate).toBe(1);
  expect(r.p.hours).toBeCloseTo(3, 1);
  expect(r.p.xp).toBe(180);
  expect(r.c.ok).toBe(true);
  expect(r.c.xp).toBe(180);
  expect(r.dxp).toBe(180);                             // gainXp cộng đúng (buff 0, xpSlow 1)
  expect(r.discXp).toBe(30);                           // floor(3 giờ × 10)
  expect(r.discLvl).toBe(1);
  expect(r.sinceAge).toBeLessThan(5000);
  assertNoErrors();
});

test('đệ tử: hái thuốc 8 giờ = 4 Huyền Tinh; để 20 giờ vẫn chỉ tính trần 8 giờ', async ({ page }) => {
  await createCharacter(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, D = G.DT;
    G.S.lvl = 30; G.R.dirty = true; G.recalc();
    G.RW().fd = 100; G.save();
    const rec = D.recruit(0.0);
    const d = D.state.list[0];
    D.assign(d.id, 'hai');
    d.since = Date.now() - 8 * 3600000; G.save();
    const tier = Math.min(10, Math.floor(G.S.lvl / 15) + 1);
    const p1 = D.pending(d.id);
    const ht0 = G.matHave('ht', tier);
    const c1 = D.collect(d.id);
    const htDelta = G.matHave('ht', tier) - ht0;
    const afterLvl = d.lvl;                            // 80 XP đệ tử → lên cấp 2
    d.since = Date.now() - 20 * 3600000; G.save();     // quá trần
    const p2 = D.pending(d.id);
    return { p1, c1, htDelta, tier, afterLvl, p2 };
  });
  expect(r.tier).toBe(3);
  expect(r.p1.hours).toBeCloseTo(8, 1);
  expect(r.p1.ht).toBe(4);                             // floor(8 × 1.0 × 0.5)
  expect(r.c1.ok).toBe(true);
  expect(r.c1.ht).toBe(4);
  expect(r.htDelta).toBe(4);
  expect(r.afterLvl).toBe(2);
  expect(r.p2.hours).toBe(8);                          // trần cứng 8 giờ
  expect(r.p2.ht).toBe(4);                             // floor(8 × 1.1 × 0.5) — rate cấp 2
  assertNoErrors();
});

test('đệ tử: du ngoạn 2 giờ = 600 lượng đúng công thức, chưa đủ khối 4 giờ nên không có quà', async ({ page }) => {
  await createCharacter(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, D = G.DT;
    G.RW().fd = 100; G.save();
    const rec = D.recruit(0.0);
    const d = D.state.list[0];
    D.assign(d.id, 'du');
    d.since = Date.now() - 2 * 3600000; G.save();
    const gold0 = G.S.gold;
    const c = D.collect(d.id);
    return { c, dGold: G.S.gold - gold0, fd: G.RW().fd };
  });
  expect(r.c.ok).toBe(true);
  expect(r.c.gold).toBe(600);                          // 300 × 2 giờ × rate 1.0
  expect(r.dGold).toBe(600);
  expect(r.c.blocks).toBe(0);
  expect(r.c.pots).toEqual([]);
  expect(r.fd).toBe(80);                               // chỉ tốn 20 lúc tuyển, thu không ra Phúc Duyên
  assertNoErrors();
});

test('đệ tử: đổi việc giữa chừng — phần đã tích của việc cũ được thu tự động rồi mới đổi', async ({ page }) => {
  await createCharacter(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, D = G.DT;
    G.S.lvl = 30; G.R.dirty = true; G.recalc();
    G.RW().fd = 100; G.save();
    const rec = D.recruit(0.0);
    const d = D.state.list[0];                         // đang Luyện Công
    d.since = Date.now() - 2 * 3600000; G.save();
    const xp0 = G.S.xp;
    const a = D.assign(d.id, 'du');
    const dxp = G.S.xp - xp0;
    const again = D.assign(d.id, 'du');                // đổi sang đúng việc đang làm
    return { a, dxp, job: d.job, pendH: D.pending(d.id).hours, again };
  });
  expect(r.a.ok).toBe(true);
  expect(r.a.collected).toBeTruthy();
  expect(r.a.collected.ok).toBe(true);
  expect(r.dxp).toBe(120);                             // 60 × 2 giờ × rate 1.0 — đã thu trước khi đổi
  expect(r.job).toBe('du');
  expect(r.pendH).toBeLessThan(0.05);
  expect(r.again.ok).toBe(true);
  expect(r.again.collected).toBeNull();
  assertNoErrors();
});

test('đệ tử: cho xuống núi trống ô, tuyển lại được; id lạ bị chặn', async ({ page }) => {
  await createCharacter(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, D = G.DT;
    G.RW().fd = 200; G.save();
    const a = D.recruit(0.0), b = D.recruit(0.0);
    const dis = D.dismiss(a.d.id);
    const n1 = D.state.list.length;
    const bad = D.dismiss(99999);
    const c = D.recruit(0.0);
    return { dis, n1, bad, c, n2: D.state.list.length, fd: G.RW().fd, recruited: D.state.recruited };
  });
  expect(r.dis.ok).toBe(true);
  expect(r.n1).toBe(1);
  expect(r.bad.ok).toBe(false);
  expect(r.c.ok).toBe(true);
  expect(r.n2).toBe(2);
  expect(r.fd).toBe(140);                              // 3 lần tuyển × 20
  expect(r.recruited).toBe(3);                         // id/thứ tự không tái sử dụng
  assertNoErrors();
});

test('đệ tử: UI — nút vào ở tab Dã Tẩu, mở view thấy nút thu nhận, tuyển xong hiện thẻ đệ tử đủ 3 nút việc', async ({ page }) => {
  await createCharacter(page);
  await page.evaluate(() => { const G = (window as any).__G; G.RW().fd = 100; G.save(); });
  await page.locator('#qBar .qb[data-q="8"]').click();
  await page.locator('#giftTabs button[data-g="yt"]').click();
  await expect(page.locator('#mBody #dtGo')).toBeVisible();
  await expect(page.locator('#mBody #dtGo')).toContainText('Đệ Tử');
  await page.locator('#mBody #dtGo').click();
  await expect(page.locator('#mBody')).toContainText('Đệ Tử: tốn');
  await expect(page.locator('#mBody #dtRecruit')).toBeVisible();
  await expect(page.locator('#mBody #dtRecruit')).toBeEnabled();
  await page.locator('#mBody #dtRecruit').click();     // tuyển qua UI → panel công bố phẩm chất
  await expect(page.locator('#mBody #dtRevealOk')).toBeVisible();
  await expect(page.locator('#mBody')).toContainText('THU NHẬN MÔN ĐỒ');
  const name = await page.evaluate(() => (window as any).__G.DT.state.list[0].name);
  await page.locator('#mBody #dtRevealOk').click();
  await expect(page.locator('#mBody')).toContainText(name);
  await expect(page.locator('#mBody [data-dt-job]')).toHaveCount(3);
  await expect(page.locator('#mBody [data-dt-collect]')).toHaveCount(1);
  await expect(page.locator('#mBody [data-dt-dismiss]')).toHaveCount(1);
  assertNoErrors();
});
