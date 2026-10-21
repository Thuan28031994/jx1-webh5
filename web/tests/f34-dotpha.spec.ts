/* F34 — Đột Phá Cảnh Giới (dotpha.ts): 12 tầng, +4%/tầng VĨNH VIỄN vào đúng pipeline
   % của stats.ts calc() (P.dmgMul + P.life — cùng chỗ guildBuff cộng), tỉ lệ gốc
   90 −5×(t−1) + pity 10%/lần trượt (kẹp [5,100]); trượt mất 50% Huyền Tinh/Phúc Duyên
   (làm tròn lên), lượng giữ nguyên; 10% lần đỗ là Đại Ngộ (+2 điểm tiềm năng).
   Ép xúc xắc tất định qua __G.BP.attempt(roll, critRoll); MOCK /api/chat/* như mọi test. */
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

async function createCharacter(page: Page, name = 'ĐộtPhá') {
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

/* Mở modal Phần thưởng → tab Bang hội → nút vào Đột Phá (điểm vào trong tab guild, khuôn f32/f33). */
async function openBP(page: Page) {
  await page.locator('#qBar .qb[data-q="8"]').click();
  await expect(page.locator('#mBody')).toContainText('Bang hội (NPC)');
  await page.locator('#mBody #bpGo').click();
  await expect(page.locator('#mBody')).toContainText('Đột Phá Cảnh Giới — Đả Thông Kinh Mạch');
}

test('đột phá: nhân vật mới — tier 0, cộng 0%, thang đủ 12 cảnh giới, tỉ lệ 90%, nút bị khoá vì cấp', async ({ page }) => {
  await createCharacter(page);
  await openBP(page);
  await expect(page.locator('#mBody .bp-row')).toHaveCount(12);
  for (const n of ['Luyện Khí', 'Trúc Cơ', 'Kim Đan', 'Nguyên Anh', 'Hóa Thần', 'Luyện Hư', 'Hợp Thể', 'Đại Thừa', 'Độ Kiếp', 'Chân Tiên', 'Kim Tiên', 'Đạo Tổ']) {
    await expect(page.locator('#mBody')).toContainText(n);
  }
  await expect(page.locator('#mBody')).toContainText('Phàm Nhân');            // cảnh giới hiện tại của người mới
  await expect(page.locator('#mBody')).toContainText('90%');                  // tỉ lệ tầng 1 (gốc 90, pity 0)
  await expect(page.locator('#mBody #bpTry')).toBeDisabled();
  await expect(page.locator('#mBody #bpTry')).toContainText('Cần cấp 10');
  const st = await page.evaluate(() => { const G = (window as any).__G; G.recalc(); return { tier: G.BP.tier(), pct: G.BP.pct(), chance: G.BP.chance(), life: G.R.P.life }; });
  expect(st.tier).toBe(0);
  expect(st.pct).toBe(0);                                                     // save mới: +0% — pipeline không đổi
  expect(st.chance).toBe(90);
  expect(st.life).toBeGreaterThan(0);
  assertNoErrors();
});

test('đột phá: bị chặn ở cổng — thiếu cấp / thiếu Huyền Tinh: không tung xúc xắc, không trừ gì', async ({ page }) => {
  await createCharacter(page);
  await openBP(page);
  const lowLvl = await page.evaluate(() => {
    const G = (window as any).__G;
    G.S.gold = 1000000; G.RW().fd = 100; G.matAdd('ht', 1, 10);               // dư tài nguyên, chỉ thiếu CẤP (1 < 10)
    const snap = { ht: G.matHave('ht', 1), fd: G.RW().fd, gold: G.S.gold };
    const res = G.BP.attempt(0);
    return { ok: res.ok, snap, ht: G.matHave('ht', 1), fd: G.RW().fd, gold: G.S.gold, tries: G.BP.state.tries, tier: G.BP.tier() };
  });
  expect(lowLvl.ok).toBe(false);
  expect(lowLvl.tries).toBe(0); expect(lowLvl.tier).toBe(0);
  expect(lowLvl.ht).toBe(lowLvl.snap.ht); expect(lowLvl.fd).toBe(lowLvl.snap.fd); expect(lowLvl.gold).toBe(lowLvl.snap.gold);
  const noMat = await page.evaluate(() => {
    const G = (window as any).__G;
    G.S.lvl = 10;                                                             // đủ cấp tầng 1…
    const have = G.matHave('ht', 1); if (have) G.matAdd('ht', 1, -have);      // …nhưng rút sạch Huyền Tinh cấp 1 (htLvl ở cấp 10)
    const snap = { fd: G.RW().fd, gold: G.S.gold };
    const res = G.BP.attempt(0);
    return { ok: res.ok, msg: res.msg, snapFd: snap.fd, snapGold: snap.gold, fd: G.RW().fd, gold: G.S.gold, tries: G.BP.state.tries };
  });
  expect(noMat.ok).toBe(false);
  expect(noMat.msg).toContain('Huyền Tinh');
  expect(noMat.tries).toBe(0); expect(noMat.fd).toBe(noMat.snapFd); expect(noMat.gold).toBe(noMat.snapGold);
  assertNoErrors();
});

test('đột phá: THÀNH CÔNG attempt(0) — lên Luyện Khí, trừ đủ chi phí, +4% chạy THẬT trong chỉ số (life + dmgMul ×1,04)', async ({ page }) => {
  await createCharacter(page);
  await openBP(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G;
    G.S.lvl = 10; G.S.gold = 100000; G.RW().fd = 100; G.matAdd('ht', 1, 10);   // htLvl(10) = 1; giá tầng 1: 3 HT · 5 FD · 5.000 lượng
    G.recalc();
    const life0 = G.R.P.life, mul0 = G.R.P.dmgMul;
    const res = G.BP.attempt(0, 0.99);                                        // roll 0 < 90% chắc đỗ; critRoll 0,99 → không Đại Ngộ
    G.recalc();
    return { res, ht: G.matHave('ht', 1), fd: G.RW().fd, gold: G.S.gold, tier: G.BP.tier(), pct: G.BP.pct(), ratioLife: G.R.P.life / life0, ratioMul: G.R.P.dmgMul / mul0 };
  });
  expect(r.res.ok).toBe(true); expect(r.res.success).toBe(true); expect(r.res.crit).toBe(false);
  expect(r.tier).toBe(1); expect(r.pct).toBe(4);
  expect(r.ht).toBe(7);                                                       // 10 − 3 (đỗ trừ ĐỦ)
  expect(r.fd).toBe(95);                                                      // 100 − 5
  expect(r.gold).toBe(95000);                                                 // 100.000 − 5.000
  expect(r.ratioLife).toBeCloseTo(1.04, 3);                                   // +4% sinh lực qua đúng dòng P.life của calc()
  expect(r.ratioMul).toBeCloseTo(1.04, 3);                                    // +4% sát thương qua đúng dòng P.dmgMul của calc()
  assertNoErrors();
});

test('đột phá: THẤT BẠI attempt(0.999) — tẩu hỏa: mất 50% HT/FD (làm tròn lên), lượng nguyên vẹn, pity +1, tỉ lệ lên 100%', async ({ page }) => {
  await createCharacter(page);
  await openBP(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G;
    G.S.lvl = 10; G.S.gold = 100000; G.RW().fd = 100; G.matAdd('ht', 1, 10);
    const res = G.BP.attempt(0.999, 0.99);                                    // 99,9 >= 90 → trượt
    return { res, ht: G.matHave('ht', 1), fd: G.RW().fd, gold: G.S.gold, tier: G.BP.tier(), pity: G.BP.state.pity, chance: G.BP.chance() };
  });
  expect(r.res.ok).toBe(true); expect(r.res.success).toBe(false);
  expect(r.tier).toBe(0); expect(r.pity).toBe(1);
  expect(r.ht).toBe(8);                                                       // mất ceil(3/2) = 2
  expect(r.fd).toBe(97);                                                      // mất ceil(5/2) = 3
  expect(r.gold).toBe(100000);                                                // lượng GIỮ NGUYÊN khi trượt
  expect(r.res.chanceNext).toBe(100);                                         // 90 + pity 10
  expect(r.chance).toBe(100);
  assertNoErrors();
});

test('đột phá: pity bảo hiểm — tầng 6 gốc 65% + pity 4 = 100%: attempt(0.999) vẫn ĐỖ', async ({ page }) => {
  await createCharacter(page);
  await openBP(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G;
    G.BP.state.tier = 5; G.BP.state.pity = 4;                                 // tầng kế 6: gốc 90 − 5×5 = 65, +40 pity → kẹp 100
    G.S.lvl = 60; G.S.gold = 1000000; G.RW().fd = 200; G.matAdd('ht', 5, 20);  // htLvl(60) = 5; giá tầng 6: 8 HT · 30 FD · 180.000 lượng
    const chance = G.BP.chance();
    const res = G.BP.attempt(0.999, 0.99);
    return { chance, res, tier: G.BP.tier(), pity: G.BP.state.pity };
  });
  expect(r.chance).toBe(100);
  expect(r.res.ok).toBe(true); expect(r.res.success).toBe(true);
  expect(r.tier).toBe(6); expect(r.pity).toBe(0);                             // đỗ → pity reset
  assertNoErrors();
});

test('đột phá: ĐẠI NGỘ attempt(0, 0) — crit khi đỗ: +2 điểm tiềm năng, crits = 1', async ({ page }) => {
  await createCharacter(page);
  await openBP(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G;
    G.S.lvl = 10; G.S.gold = 100000; G.RW().fd = 100; G.matAdd('ht', 1, 10);
    const pts0 = G.S.attrPts;
    const res = G.BP.attempt(0, 0);                                           // roll 0 đỗ; critRoll 0 < 10% → Đại Ngộ
    return { res, pts: G.S.attrPts - pts0, crits: G.BP.state.crits };
  });
  expect(r.res.success).toBe(true); expect(r.res.crit).toBe(true);
  expect(r.pts).toBe(2);
  expect(r.crits).toBe(1);
  assertNoErrors();
});

test('đột phá: UI — pity ép tỉ lệ 100% rồi bấm nút Đột Phá: hiện bảng THÀNH CÔNG, quay lại view thấy đã đạt Luyện Khí', async ({ page }) => {
  await createCharacter(page, 'ĐộtPháUI');
  await openBP(page);
  await page.evaluate(() => {
    const G = (window as any).__G;
    G.S.lvl = 10; G.S.gold = 500000; G.RW().fd = 200; G.matAdd('ht', 1, 50);
    G.BP.attempt(0.999);                                                      // trượt cố ý 1 lần → pity 1 → tỉ lệ tầng 1 = 100% (UI bấm là chắc đỗ, không flaky)
  });
  await page.locator('#giftTabs [data-g="guild"]').click();                   // render lại: nút Đột Phá phải bật
  await page.locator('#mBody #bpGo').click();
  await expect(page.locator('#mBody')).toContainText('100%');
  await expect(page.locator('#mBody #bpTry')).toBeEnabled();
  await page.locator('#mBody #bpTry').click();
  await expect(page.locator('#mBody')).toContainText('ĐỘT PHÁ THÀNH CÔNG!');
  await expect(page.locator('#mBody')).toContainText('Luyện Khí');
  await page.locator('#mBody #bpOk').click();                                 // quay lại view Đột Phá
  await expect(page.locator('#mBody')).toContainText('Đột Phá Cảnh Giới — Đả Thông Kinh Mạch');
  await expect(page.locator('#mBody')).toContainText('✔ Luyện Khí');
  const tier = await page.evaluate(() => (window as any).__G.BP.tier());
  expect(tier).toBe(1);
  assertNoErrors();
});
