/* F39 — tăng tần suất xuất hiện quái (field.ts FIELD_MOBS + combat.ts nghi giua dot):
   - Bãi quái (field mode): mật độ perCell 2 -> 3 quái mỗi ô 400px, trần tổng 240 -> 320 (desktop),
     hồi sinh mỗi ô sau khi quái chết: respawn 5.6s + rnd(0, 2.8) -> 3.2s + rnd(0, 1.6).
   - Chế độ đợt: nghỉ giữa hai đợt R.spawnT 1.2s -> 0.7s (combat.ts waveCleared).
   Test đọc hằng số qua hook gỡ lỗi window.__field().mobs (phơi FIELD_MOBS) và đo HÀNH VI thật:
   mật độ slot quanh nhân vật + thời gian bãi hồi đủ quái sau khi bị quét sạch + khoảng nghỉ giữa đợt.
   Ngưỡng được chọn để code CŨ chắc chắn trượt: mật độ cũ ~2/3 mức mới; hồi sinh cũ [5.6, 8.4]s
   (sau 6s mới ~14% ô hồi), mới [3.2, 4.8]s (sau 6s hồi hết ô đủ điều kiện); nghỉ đợt cũ >= 1.2s, mới 0.7s.
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

async function createCharacter(page: Page, name = 'KiemSpawn') {
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

/* Bật bãi quái đúng như handler checkbox trong Cài đặt Auto (ui.ts) làm. */
async function enableFieldMode(page: Page) {
  await page.evaluate(() => {
    const G = (window as any).__G;
    G.S.fieldMode = true; G.R.field = null; G.R.enemies = []; G.R.spawnT = 0.3;
  });
  await expect.poll(() => page.evaluate(() => (window as any).__field().slots), { timeout: 20000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).__field().active), { timeout: 20000 }).toBe(true);
}

/* Tắt bãi quái đúng như handler checkbox trong Cài đặt Auto (ui.ts:1152) làm, để phép đo đợt
   quái chạy ở chế độ đợt thuần: fieldMode=false, R.field=null, đợt sinh qua cổng spawnT.
   Chờ đợt đầu xuất hiện rồi khẳng định mode đã ăn: hook __field báo mode/active đều false,
   R.field null và không kẻ thù nào mang fieldSlot. */
async function forceWaveMode(page: Page) {
  await page.evaluate(() => {
    const G = (window as any).__G;
    G.S.fieldMode = false; G.R.field = null; G.R.enemies = []; G.R.spawnT = 0.3;
  });
  await expect.poll(() => page.evaluate(() => (window as any).__G.R.enemies.length), { timeout: 20000 }).toBeGreaterThan(0);
  const st = await page.evaluate(() => {
    const G = (window as any).__G, F = (window as any).__field();
    return { mode: F.mode, active: F.active, hasField: !!G.R.field, fieldSlot: G.R.enemies.filter((e: any) => e.fieldSlot).length };
  });
  expect(st, JSON.stringify(st)).toEqual({ mode: false, active: false, hasField: false, fieldSlot: 0 });
}

test('spawn: hằng số FIELD_MOBS đã tăng (perCell 3, respawn 3.2, trần >= 300)', async ({ page }) => {
  await createCharacter(page);
  const m = await page.evaluate(() => (window as any).__field().mobs);
  expect(m.cell).toBe(400);            // ô lưới giữ nguyên
  expect(m.perCell).toBe(3);           // cũ: 2
  expect(m.respawn).toBe(3.2);         // cũ: 5.6
  expect(m.max).toBeGreaterThanOrEqual(300); // desktop cũ: 240, nay 320 (UA desktop -> COARSE=false)
  assertNoErrors();
});

test('spawn: bãi quái đặc hơn — nhiều slot quanh nhân vật ngay khi mở bãi', async ({ page }) => {
  await createCharacter(page);
  await enableFieldMode(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G, H = G.H, slots = G.R.field.slots;
    const near = slots.filter((s: any) => Math.hypot(s.x - H.x, s.y - H.y) <= 700).length;
    return { slots: slots.length, alive: G.R.enemies.length, near };
  });
  // Đo thực tế trên bãi đầu (Dược Vương Cốc, 2 lần chạy): perCell 3 cho 128-129 slot toàn bản đồ,
  // 18 slot trong vòng 700px quanh nhân vật, quái sống đủ 100% slot khi mở bãi.
  // perCell 2 cũ chỉ ~2/3 các con số đó (~86 slot / ~12 gần). Ngưỡng nằm giữa, chừa biên cả hai phía.
  expect(r.slots).toBeGreaterThanOrEqual(110);
  expect(r.near).toBeGreaterThanOrEqual(15);
  expect(r.alive).toBeGreaterThanOrEqual(Math.floor(r.slots * 0.9)); // mở bãi là quái có mặt gần như đủ slot
  assertNoErrors();
});

test('spawn: quét sạch bãi -> quái hồi nhanh (mốc đầu <= 4.2s, 90% ô đủ điều kiện <= 6s)', async ({ page }) => {
  await createCharacter(page);
  await enableFieldMode(page);
  await page.evaluate(() => { (window as any).__G.R.life = 1e9; }); // nhân vật bất tử trong lúc đo: chết -> spawnWave dựng lại bãi, hỏng phép đo
  // Quét sạch: hạ mọi quái thuộc slot bãi, ghi nhận các ô đủ điều kiện hồi ngay (cách nhân vật > 120px;
  // fieldTick chỉ hồi ô khi nhân vật cách > 60px — chừa biên vì nhân vật còn di chuyển đôi chút).
  const setup = await page.evaluate(() => {
    const G = (window as any).__G, H = G.H;
    for (const e of G.R.enemies) if (e.fieldSlot) e.hp = 0;
    const eligible = G.R.field.slots.filter((s: any) => Math.hypot(s.x - H.x, s.y - H.y) > 120).length;
    return { eligible, slots: G.R.field.slots.length };
  });
  expect(setup.eligible).toBeGreaterThanOrEqual(100);
  // t0 = lúc bãi thực sự trống (killCheck đã xử lý xác)
  const t0 = Date.now();
  await expect.poll(() => page.evaluate(() => (window as any).__G.R.enemies.length), { timeout: 10000 }).toBe(0);
  const target = Math.floor(setup.eligible * 0.9);
  let firstAt = 0, fullAt = 0;
  while (Date.now() - t0 < 12000) {
    const alive = await page.evaluate(() => (window as any).__G.R.enemies.length);
    const now = Date.now() - t0;
    if (!firstAt && alive >= 10) firstAt = now;
    if (alive >= target) { fullAt = now; break; }
    await page.waitForTimeout(100);
  }
  expect(firstAt).toBeGreaterThan(0);
  expect(firstAt).toBeLessThanOrEqual(4200);  // hồi sinh mới tối thiểu 3.2s; cũ tối thiểu 5.6s -> trượt chắc
  expect(fullAt).toBeGreaterThan(0);
  expect(fullAt).toBeLessThanOrEqual(6000);   // mới: mọi ô hồi trong [3.2, 4.8]s; cũ: sau 6s mới ~14% ô hồi
  expect(await page.evaluate(() => (window as any).__G.R.deadT)).toBe(0); // nhân vật không chết giữa phép đo
  assertNoErrors();
});

test('spawn: nghỉ giữa hai đợt quái rút xuống ~0.7s (cũ 1.2s)', async ({ page }) => {
  await createCharacter(page);
  // Ghim chế độ đợt trước khi đo: phép đo chỉ có nghĩa khi đợt sinh qua waveCleared -> spawnT.
  // Ở chế độ bãi (field), quái hồi theo từng ô sau 3.2-4.8s và S.wave đi theo nhiệm vụ bãi,
  // không qua spawnT — forceWaveMode cũng khẳng định mode đã ăn (field hook + fieldSlot).
  await forceWaveMode(page);
  // Nhân vật bất tử trong lúc đo: nếu chết, nhánh hồi sinh (combat.ts) đặt lại S.wave = 1 và gọi
  // spawnWave ngay — kẻ thù "quay lại" không qua spawnT, phép đo mất nghĩa.
  // Ghim wave = 1 cho tất định (tránh trường hợp nhân vật đã tự qua đợt / đang ở đợt cuối WAVES -> clear ải).
  // Ghim stall = 0: stallOut (45s không tiến triển) cũng gọi spawnWave mà không cộng đợt.
  const waveBefore = await page.evaluate(() => { const G = (window as any).__G; G.R.life = 1e9; G.S.wave = 1; G.R.stall = 0; return G.S.wave; });
  const t0 = Date.now();
  await page.evaluate(() => {
    const G = (window as any).__G;
    for (const e of G.R.enemies) e.hp = 0;
    G.R.ground.length = 0; G.R.lootWait = 99;   // lootWait=99 chỉ bỏ qua cổng chờ nhặt đồ (tối đa 8s) trước spawnWave;
                                                // waveCleared chạy trong killCheck của tick, không bị cổng này chặn
  });
  // Chặng 1: chờ killCheck xử lý xác — waveCleared cộng đúng 1 đợt và gài spawnT=0.7.
  // KHÔNG đọc "quái đã về" trước chặng này: R.enemies còn chứa xác hp=0 cho tới tick xử lý,
  // đọc sớm sẽ tưởng quái về ngay lập tức với wave cũ (đây là gốc flaky của bản test trước).
  await expect.poll(() => page.evaluate(() => (window as any).__G.S.wave), { timeout: 5000 }).toBe(waveBefore + 1);
  // Chặng 2: đo từ lúc hạ đợt (t0) tới lúc đợt mới xuất hiện — gồm tối đa 1 frame xử lý xác
  // + spawnT 0.7s + 1 frame sinh đợt; code cũ spawnT >= 1.2s nên không thể kịp 1150ms.
  let backAt = 0;
  while (Date.now() - t0 < 5000) {
    const s = await page.evaluate(() => {
      const G = (window as any).__G;
      if (!G.R.enemies.length) { G.R.ground.length = 0; G.R.lootWait = 99; }
      return { n: G.R.enemies.length, deadT: G.R.deadT };
    });
    expect(s.deadT).toBe(0);
    if (s.n > 0) { backAt = Date.now() - t0; break; }
    await page.waitForTimeout(25);
  }
  expect(backAt).toBeGreaterThan(0);
  expect(backAt).toBeLessThanOrEqual(1150);    // 0.7s + vài frame xử lý; cũ >= 1.2s + frame -> trượt
  assertNoErrors();
});
