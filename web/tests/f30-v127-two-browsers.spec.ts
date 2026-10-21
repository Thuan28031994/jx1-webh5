import { test, expect, BrowserContext, Page, WebSocketRoute } from '@playwright/test';

/*
 * V12.7 transport end-to-end test with two isolated browser profiles.
 * API and WS are local mocks: verifies protocol wiring without creating
 * live Worker sessions or requiring a production service.
 */

type Peer = { id: string; name: string; x: number; y: number; active: boolean; lvl: number; fac: string };
type PeerConn = { ws: WebSocketRoute; profile: Peer };
const online = new Map<string, PeerConn>();
const sessions = new Map<string, { id: string; name: string }>();
let nextId = 0;
let connections = 0;

async function mockWorker(ctx: BrowserContext) {
  await ctx.route('**/api/chat/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: '{"ok":true,"online":0,"messages":[]}',
  }));
  await ctx.route('**/api/mp/session', async route => {
    const body = route.request().postDataJSON();
    const name = String(body?.name || 'Player');
    const id = 'test-' + (++nextId);
    const token = 'mock-' + id;
    sessions.set(token, { id, name });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, token }) });
  });
  await ctx.routeWebSocket(/\/api\/mp\/socket/, ws => {
    connections++;
    const match = [...sessions.entries()].find(([token]) => {
      // The WS subprotocol is not exposed by routeWebSocket's url() API.
      // Associate by connection order: this test creates a single player at a time.
      return ![...online.values()].some(conn => conn.profile.id === sessions.get(token)?.id);
    });
    const v = match?.[1];
    if (!v) { ws.close(); return; }
    const profile: Peer = { id: v.id, name: v.name, x: 100, y: 100, active: true, lvl: 1, fac: '' };
    online.set(v.id, { ws, profile });
    ws.send(JSON.stringify({ type: 'welcome', players: [...online.values()].filter(x => x.profile.id !== v.id).map(x => x.profile) }));
    for (const c of online.values()) if (c.profile.id !== v.id) {
      c.ws.send(JSON.stringify({ type: 'move', player: profile }));
    }
    ws.onMessage(message => {
      let packet: any;
      try { packet = JSON.parse(String(message)); } catch { return; }
      if (packet.type !== 'move') return;
      const conn = online.get(v.id);
      if (!conn) return;
      Object.assign(profile, {
        x: Number(packet.x) || 100,
        y: Number(packet.y) || 100,
        lvl: Number(packet.lvl) || 1,
        fac: String(packet.fac || ''),
      });
      for (const c of online.values()) if (c.profile.id !== v.id) {
        c.ws.send(JSON.stringify({ type: 'move', player: profile }));
      }
    });
    ws.onClose(() => {
      online.delete(v.id);
      for (const c of online.values()) c.ws.send(JSON.stringify({ type: 'leave', id: v.id }));
    });
  });
}

async function hero(page: Page, name: string) {
  await page.goto('/');
  await expect(page.locator('#pfName')).toBeVisible();
  await page.locator('#pfName').fill(name);
  await page.locator('.facpick button').first().click();
  await page.locator('#bNotice').click();
  const skip = page.locator('#tSkip');
  if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) await skip.click();
  await expect(page.locator('#vloPresenceToggle')).toHaveText('Online: tắt');
}

test('V12.7 online: hai tab doc lap, nhan peers thuc, khong tao socket trung', async ({ browser, baseURL }) => {
  online.clear(); sessions.clear(); nextId = 0; connections = 0;
  const ca = await browser.newContext({ baseURL });
  const cb = await browser.newContext({ baseURL });
  try {
    await mockWorker(ca);
    await mockWorker(cb);
    const a = await ca.newPage();
    const b = await cb.newPage();
    await hero(a, 'TestPlayerA');
    await hero(b, 'TestPlayerB');
    await a.locator('#vloPresenceToggle').click();
    await expect.poll(() => a.evaluate(() => (window as any).__VLO_PRESENCE_V127().connected)).toBe(true);
    await expect(a.locator('#vloPresenceCount')).toContainText('1');
    await b.locator('#vloPresenceToggle').click();
    await expect.poll(() => b.evaluate(() => (window as any).__VLO_PRESENCE_V127().connected)).toBe(true);
    await expect.poll(() => a.evaluate(() => (window as any).__VLO_PRESENCE_V127().remoteCount)).toBe(1);
    await expect.poll(() => b.evaluate(() => (window as any).__VLO_PRESENCE_V127().remoteCount)).toBe(1);
    await expect(a.locator('#vloPresenceCount')).toContainText('2');
    await expect(b.locator('#vloPresenceCount')).toContainText('2');
    await a.locator('#vloPresenceCount').click();
    await expect(a.locator('#vloPresenceDetail')).toContainText('TestPlayerB');
    expect(connections).toBe(2);
    await a.locator('#vloPresenceToggle').click();
    await expect.poll(() => a.evaluate(() => (window as any).__VLO_PRESENCE_V127().socketCount)).toBe(0);
    await expect(a.locator('#vloPresenceToggle')).toHaveText('Online: tắt');
    await expect(b.locator('#mpStatus')).toHaveText('Map · Local');
  } finally {
    await ca.close();
    await cb.close();
  }
});
