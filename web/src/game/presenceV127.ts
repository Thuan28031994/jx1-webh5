/*
 * BRONC3 V12.7 presence bridge for the Next.js port.
 *
 * The existing mpworld.ts implements PK over /mp and MUST remain separate.
 * This opt-in bridge uses the upstream /api/mp/session + /api/mp/socket
 * protocol strictly for presence (one WebSocket per session token).
 * No currency, saves, PK, or Worker/D1 records are modified.
 */
import { H, R } from './combat';
import { S } from './save';
import { uiBump } from './store';

const DEFAULT_WORKER = 'https://vo-lam-idle-production.gmpaopao.workers.dev';
const SESSION_KEY = 'vlo_mp_session_v1'; // tab-scoped only, never character save
const ROOM = 'main';
const MAX_PEERS = 120;
const MAX_COORD = 50000;

type Session = { id: string; token: string; name: string };
type Peer = {
  id: string; name: string; x: number; y: number; tx: number; ty: number;
  lvl: number; fac: string; lastPacket: number; stage: number | null; town: boolean | null;
};
type View = { active: boolean; connected: boolean; state: string; realCount: number; peers: string[] };

let active = false;
let session: Session | null = null;
let socket: WebSocket | null = null;
let creating = false;
let generation = 0;
let retryAt = 0;
let fails = 0;
let connectedAt = 0;
let lastSendAt = 0;
let lastFingerprint = '';
let state = 'Đã tắt';
const peers = new Map<string, Peer>();

const playerReady = () => Boolean(S && S.fac && String(S.name || '').trim().length >= 2);
const playerName = () => String(S.name || '').trim();
const workerUrl = () => {
  const configured = typeof window !== 'undefined' ? (window as any).VLO_MP_WORKER_URL : '';
  const candidate = String(configured || DEFAULT_WORKER).trim().replace(/\/+$/, '');
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.origin : '';
  } catch { return ''; }
};
const signal = (message: string) => { state = message; uiBump(); };
const clearPeers = () => { peers.clear(); uiBump(); };
const validSession = (v: any): v is Session =>
  v && typeof v.id === 'string' && !!v.id &&
  typeof v.token === 'string' && !!v.token &&
  v.name === playerName();

function readSession() {
  try {
    const candidate = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    session = validSession(candidate) ? candidate : null;
    if (!session) sessionStorage.removeItem(SESSION_KEY);
  } catch { session = null; }
}
function forgetSession() {
  session = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage may be blocked */ }
}
function backoff() {
  fails = Math.min(6, fails + 1);
  retryAt = Date.now() + Math.min(18000, Math.round(3000 * (1.5 ** (fails - 1))));
}
function cleanSocket() {
  const old = socket;
  socket = null;
  if (old) {
    old.onopen = null; old.onmessage = null; old.onerror = null; old.onclose = null;
    try { old.close(1000, 'leaving'); } catch { /* browser already closed */ }
  }
}
export function presenceEnable() {
  if (active) return;
  active = true;
  generation++;
  retryAt = 0; fails = 0;
  readSession();
  signal('Đang kết nối');
}
export function presenceDisable() {
  active = false;
  generation++;
  creating = false;
  cleanSocket();
  clearPeers();
  signal('Đã tắt');
}
export function presenceToggle() { if (active) presenceDisable(); else presenceEnable(); }
export function presenceView(): View {
  const connected = active && socket?.readyState === WebSocket.OPEN;
  return {
    active, connected, state,
    realCount: connected ? peers.size + 1 : 0,
    peers: connected ? Array.from(peers.values()).map(p => p.name).slice(0, 80) : [],
  };
}
function addPeer(raw: any) {
  if (!raw || typeof raw !== 'object' || raw.active === false) return;
  const id = String(raw.id || '').slice(0, 120);
  if (!id || id === session?.id) return;
  const x = Number(raw.x), y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const prev = peers.get(id);
  if (!prev && peers.size >= MAX_PEERS) return;
  const next: Peer = prev || {
    id, x, y, tx: x, ty: y, name: '', lvl: 1, fac: '',
    lastPacket: Date.now(), stage: null, town: null,
  };
  if (Math.hypot(x - next.x, y - next.y) > 380) { next.x = x; next.y = y; }
  next.tx = x; next.ty = y;
  next.name = String(raw.name || raw.display_name || 'Người chơi').slice(0, 40);
  next.fac = String(raw.fac || '').slice(0, 30);
  next.lvl = Math.max(1, Math.min(300, Number(raw.lvl) || 1));
  next.stage = raw.stage != null && Number.isFinite(+raw.stage) ? +raw.stage : null;
  next.town = typeof raw.town === 'boolean' ? raw.town : null;
  next.lastPacket = Date.now();
  peers.set(id, next);
}
function sendMove(force = false) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !playerReady()) return;
  const x = Number(H.x), y = Number(H.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const packet = JSON.stringify({
    type: 'move', x: Math.max(0, Math.min(MAX_COORD, x)),
    y: Math.max(0, Math.min(MAX_COORD, y)),
    face: H.face || 1, lvl: Number(S.lvl) || 1,
    fac: String(S.fac || ''),
    riding: Boolean((S as any).riding || (S as any).mount || (R as any).mounted),
  });
  const now = Date.now();
  if (!force && packet === lastFingerprint && now - lastSendAt < 4000) return;
  try { socket.send(packet); lastSendAt = now; lastFingerprint = packet; } catch { /* reconnect loop will retry */ }
}
function connect() {
  if (!active || !session || socket) return;
  const base = workerUrl();
  if (!base) { signal('Worker URL không hợp lệ'); return; }
  let next: WebSocket;
  try {
    const url = new URL('/api/mp/socket', base);
    url.protocol = 'wss:';
    url.searchParams.set('map', ROOM);
    next = new WebSocket(url.toString(), ['mp-token.' + session.token]);
  } catch {
    backoff(); signal('Không mở được WebSocket'); return;
  }
  socket = next; signal('Đang nối WebSocket');
  next.onopen = () => {
    if (!active || socket !== next) return;
    connectedAt = Date.now(); fails = 0; lastFingerprint = ''; lastSendAt = 0;
    clearPeers(); signal('Đã kết nối'); sendMove(true);
  };
  next.onmessage = ev => {
    if (!active || socket !== next) return;
    let m: any;
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.type === 'welcome' && Array.isArray(m.players)) {
      peers.clear(); for (const p of m.players) addPeer(p);
    } else if (m.type === 'move' && m.player) {
      addPeer(m.player);
    } else if (m.type === 'leave') {
      peers.delete(String(m.id || ''));
    }
    uiBump();
  };
  next.onerror = () => { if (socket === next) signal('Lỗi kết nối WebSocket'); };
  next.onclose = ev => {
    if (socket !== next) return;
    socket = null; clearPeers(); lastFingerprint = '';
    if (ev.code === 1002 || ev.code === 1008) forgetSession();
    const wasStable = connectedAt > 0 && Date.now() - connectedAt >= 30000;
    connectedAt = 0;
    if (!active) return;
    if (wasStable) fails = 0;
    backoff(); signal('Mất kết nối WS ' + ev.code + ' · đang thử lại');
  };
}
async function createSession() {
  if (!active || creating || !playerReady()) return;
  const base = workerUrl();
  if (!base) { signal('Worker URL không hợp lệ'); return; }
  creating = true;
  const epoch = generation, name = playerName();
  signal('Đang tạo phiên');
  try {
    const res = await fetch(base + '/api/mp/session', {
      method: 'POST', mode: 'cors', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || typeof data.id !== 'string' || !data.id ||
        typeof data.token !== 'string' || !data.token) throw Error('Phiên không hợp lệ');
    if (!active || epoch !== generation || name !== playerName()) return;
    session = { id: data.id, token: data.token, name };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* no storage */ }
    connect();
  } catch {
    if (active && epoch === generation) { backoff(); signal('Không tạo được phiên Online'); }
  } finally {
    if (epoch === generation) creating = false;
  }
}
// Called within the existing frame loop: avoids duplicate timers and sockets.
export function presenceTick(dt: number) {
  if (!active) return;
  if (!playerReady()) { presenceDisable(); return; }
  if (session && session.name !== playerName()) {
    generation++; creating = false; forgetSession(); cleanSocket(); clearPeers();
  }
  if (socket?.readyState === WebSocket.OPEN) {
    const interval = document.hidden ? 1200 : 220;
    if (Date.now() - lastSendAt >= interval) sendMove();
  } else if (!socket && !creating && Date.now() >= retryAt) {
    if (session) connect(); else { readSession(); if (session) connect(); else void createSession(); }
  }
  for (const [id, p] of peers) {
    if (Date.now() - p.lastPacket > 30000) { peers.delete(id); continue; }
    const alpha = Math.min(1, Math.max(0, dt * 8));
    p.x += (p.tx - p.x) * alpha; p.y += (p.ty - p.y) * alpha;
  }
}
// Only draw peers with server-supplied matching stage/town metadata.
// The upstream global "main" room may contain players on other maps.
// No map metadata => count is shown, avatar is NOT placed on the wrong map.
export function presenceEntities() {
  if (!active || socket?.readyState !== WebSocket.OPEN) return [];
  return [...peers.values()].filter(p =>
    p.stage !== null && p.stage === S.stage &&
    p.town !== null && p.town === Boolean(R.town) &&
    Math.abs(p.x - H.x) < 900 && Math.abs(p.y - H.y) < 600
  ).map(p => ({ presence127: true, y: p.y, p }));
}
// Read-only observability for debugging and regression tests; never exposes token.
export const presenceDebug = () => ({
  active, connected: socket?.readyState === WebSocket.OPEN,
  socketCount: socket && socket.readyState <= WebSocket.OPEN ? 1 : 0,
  remoteCount: peers.size, room: ROOM,
});
if (typeof window !== 'undefined') {
  (window as any).__VLO_PRESENCE_V127 = presenceDebug;
  window.addEventListener('pagehide', () => { cleanSocket(); clearPeers(); active = false; });
}
