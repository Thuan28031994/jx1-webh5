import { test, expect } from '@playwright/test';

async function newHero(page) {
  await page.goto('/');
  await expect(page.locator('#pfName')).toBeVisible();
  await page.locator('#pfName').fill('V127PatchTest');
  await page.locator('.facpick button').first().click();
  await page.locator('#bNotice').click();
  const skip = page.locator('#tSkip');
  if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) await skip.click();
}

test('V12.7 phó bản: vào trận không trừ lượt; thắng mới trừ lượt', async ({ page }) => {
  await newHero(page);
  const r = await page.evaluate(() => {
    const G = (window as any).__G;
    G.S.lvl = 30;
    const st = G.RW().dgSave = G.RW().dgSave || {};
    st.day = `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`;
    st.runs = {};
    const started = G.dungeonStart('dvc');
    const before = st.runs.dvc || 0;
    G.R.dg.room = G.R.dg.rooms;
    G.dgVictory();
    return { started, before, after: st.runs.dvc || 0 };
  });
  expect(r.started).toBe(true);
  expect(r.before).toBe(0);
  expect(r.after).toBe(1);
});
