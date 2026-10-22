/* F40 — Dòng +cấp kỹ năng trên trang bị (allskill_v, attr 139) phải CÓ TÁC DỤNG thật:
   - Biến thể generic (tham số 3 = 0): +cấp cho mọi chiêu.
   - Biến thể riêng từng chiêu (tham số 3 = id chiêu): chỉ chiêu đó được +cấp.
   Trước f40: calc() đã gom đúng (P.plusSkill / P.skAdd qua lvOf nội bộ) nên DPS trong P.actives
   vốn đã nhúc nhích, NHƯNG (a) bảng kỹ năng + cửa sổ chi tiết chiêu tính sát thương / hiệu quả
   theo CẤP HỌC GỐC (ui.ts renderSkill / skillModal dùng S.sk thô) — người chơi nhìn vào thấy
   không đổi gì; (b) skillsys.ts (bùa lợi / bùa hại / vòng sáng) và survival.ts tự tính cấp chỉ
   với plusSkill — dòng +cấp RIÊNG không bao giờ tới được lúc tung chiêu.
   Nay mọi nơi dùng chung stats.skillLv() = cấp học + plusSkill + skAdd[id].
   Bất biến kiểm chứng: hiển thị ở (học 5 + đồ +2) phải BẰNG hiển thị ở (học 7, không đồ).
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

async function createCharacter(page: Page, name = 'CộngKỹNăng') {
  await page.goto('/');
  await expect(page.locator('#pfName')).toBeVisible();
  await page.fill('#pfName', name);
  await page.locator('.facpick button').first().click();   // phái đầu tiên = Thiếu Lâm
  await expect(page.locator('#bNotice')).toBeVisible();
  await page.locator('#bNotice').click();
  const skip = page.locator('#tSkip');
  if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) await skip.click();
  await expect(page.locator('#qBar .qb')).toHaveCount(19);
}

const SK_ATK = 10;    // Kim Cang Phục Ma (Thiếu Lâm, tấn công)
const SK_BUFF = 15;   // Bất động Minh Vương (Thiếu Lâm, bùa lợi): skDur L5 = 132.6s -> 133, L7 = 138.9 -> 139, L8 = 142.1 -> 142

/* Gán trạng thái: học chiêu + mặc áo chứa dòng allskill_v cho trước (null = cởi) */
const setState = (page: Page, sk: Record<number, number>, mag: any[] | null) => page.evaluate(({ sk, mag }) => {
  const g = (window as any).__G;
  g.S.sk = sk;
  g.S.eq.armor = mag ? { n: 'Áo cộng kỹ năng', d: 3, r: 1, s: 0, base: [], mag, req: [], enh: 0, plv: 0 } : null;
  g.recalc();
}, { sk, mag });

const pState = (page: Page) => page.evaluate(() => {
  const g = (window as any).__G, P = g.R.P;
  const a = (P.actives || []).find((x: any) => x.id === 10);
  return { plus: P.plusSkill, skAdd: JSON.parse(JSON.stringify(P.skAdd || {})), actL: a ? a.L : null, actDps: a ? a.dps : null };
});

async function openSkillTab(page: Page) {
  await page.locator('#tabs button[data-t="skill"]').click();
  await expect(page.locator('.skl[data-id="10"]')).toBeVisible();
}
/* Chuỗi sát thương trong hàng chiêu 10 ở tab kỹ năng ("… · 123 sát thương · …") */
const rowDmgText = (page: Page) => page.evaluate(() => {
  const small = document.querySelector('.skl[data-id="10"] small');
  const m = (small?.textContent || '').match(/·\s*(.+?)\s*sát thương/);
  return m ? m[1] : null;
});
const buffHintSec = (page: Page) => page.evaluate(() => {
  const small = document.querySelector('.skl[data-id="15"] small');
  const m = (small?.textContent || '').match(/Bùa lợi (\d+) giây/);
  return m ? +m[1] : null;
});

test('allskill generic (+2 mọi chiêu): tab kỹ năng + cửa sổ chiêu hiện theo cấp hiệu lực', async ({ page }) => {
  await createCharacter(page);
  // mốc chuẩn: học thẳng cấp 7, không đồ — hiển thị phải bằng (học 5 + đồ generic +2)
  await setState(page, { [SK_ATK]: 7 }, null);
  await openSkillTab(page);
  const dmgLearned7 = await rowDmgText(page);
  expect(dmgLearned7).toBeTruthy();

  await setState(page, { [SK_ATK]: 5 }, null);
  const p0 = await pState(page);
  expect(p0.plus).toBe(0); expect(p0.actL).toBe(5);

  await setState(page, { [SK_ATK]: 5 }, [{ a: 139, p: [2, 0, 0] }]);   // generic +2
  const p1 = await pState(page);
  expect(p1.plus, 'collector: plusSkill phải = 2').toBe(2);
  expect(p1.actL, 'P.actives phải tính chiêu 10 ở cấp 7').toBe(7);
  expect(p1.actDps).toBeGreaterThan(p0.actDps as number);

  await openSkillTab(page);
  expect(await rowDmgText(page), 'sát thương ở tab kỹ năng phải theo cấp hiệu lực (= học 7)').toBe(dmgLearned7);

  // cửa sổ chi tiết chiêu: huy hiệu cấp "5+2/…", thẻ hiệu quả hiện tại ở Cấp 7
  await page.locator('.skl[data-id="10"] .skinfo').click();
  await expect(page.locator('.skill-detail-level')).toHaveText(/^5\+2\//);
  await expect(page.locator('.skill-level-card:not(.is-next) .skill-level-head span')).toHaveText('Cấp 7');
  assertNoErrors();
});

test('allskill riêng từng chiêu (+3 cho chiêu 10): chỉ chiêu đó lên cấp, cởi đồ là hết', async ({ page }) => {
  await createCharacter(page);
  await setState(page, { [SK_ATK]: 8 }, null);
  await openSkillTab(page);
  const dmgLearned8 = await rowDmgText(page);
  expect(dmgLearned8).toBeTruthy();

  await setState(page, { [SK_ATK]: 5 }, [{ a: 139, p: [3, 0, SK_ATK] }]);   // riêng chiêu 10: +3
  const p1 = await pState(page);
  expect(p1.plus, 'dòng riêng KHÔNG được cộng vào plusSkill chung').toBe(0);
  expect(p1.skAdd[SK_ATK], 'collector: skAdd[10] phải = 3').toBe(3);
  expect(p1.actL, 'P.actives phải tính chiêu 10 ở cấp 8').toBe(8);

  await openSkillTab(page);
  expect(await rowDmgText(page), 'sát thương ở tab phải theo cấp hiệu lực (= học 8)').toBe(dmgLearned8);
  await page.locator('.skl[data-id="10"] .skinfo').click();
  await expect(page.locator('.skill-detail-level')).toHaveText(/^5\+3\//);
  await expect(page.locator('.skill-level-card:not(.is-next) .skill-level-head span')).toHaveText('Cấp 8');
  await page.locator('#mClose, .modal-close, #modal .x').first().click().catch(() => page.keyboard.press('Escape'));

  // cởi đồ: mọi thứ về cấp học gốc
  await setState(page, { [SK_ATK]: 5 }, null);
  const p2 = await pState(page);
  expect(p2.skAdd[SK_ATK] || 0).toBe(0); expect(p2.actL).toBe(5);
  await openSkillTab(page);
  await page.locator('.skl[data-id="10"] .skinfo').click();
  await expect(page.locator('.skill-detail-level')).toHaveText(/^5\//);
  assertNoErrors();
});

test('allskill qua skillsys: thời lượng bùa lợi tính theo cấp hiệu lực (gồm dòng riêng)', async ({ page }) => {
  await createCharacter(page);
  await setState(page, { [SK_BUFF]: 5 }, null);
  await openSkillTab(page);
  expect(await buffHintSec(page), 'bùa 15 học 5: 133 giây').toBe(133);

  await setState(page, { [SK_BUFF]: 5 }, [{ a: 139, p: [2, 0, 0] }]);        // generic +2 -> cấp 7
  await openSkillTab(page);
  expect(await buffHintSec(page), 'generic +2: bùa tính ở cấp 7 = 139 giây').toBe(139);

  await setState(page, { [SK_BUFF]: 5 }, [{ a: 139, p: [3, 0, SK_BUFF] }]);   // riêng chiêu 15: +3 -> cấp 8
  await openSkillTab(page);
  expect(await buffHintSec(page), 'dòng riêng +3: bùa phải tính ở cấp 8 = 142 giây (trước f40 đứng yên 133)').toBe(142);

  await setState(page, { [SK_BUFF]: 5 }, null);
  await openSkillTab(page);
  expect(await buffHintSec(page), 'cởi đồ: về 133 giây').toBe(133);
  assertNoErrors();
});
