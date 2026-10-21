'use client';
import React, { useState } from 'react';
import { useGameTick } from './useGameTick';
import { presenceToggle, presenceView } from '../game/presenceV127';
import { S } from '../game/save';

/* Opt-in presence only; independent of PK /mp. No synthetic online count. */
export default function OnlinePresence() {
  useGameTick();
  const [detail, setDetail] = useState(false);
  const view = presenceView();
  if (!S?.fac) return null;
  return (
    <div className="presence-v127" style={{ position: 'relative', display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      <button id="vloPresenceToggle" type="button" onClick={presenceToggle}
        aria-pressed={view.active} title={view.state}
        style={{ fontSize: 11, padding: '3px 5px', borderRadius: 5, color: '#f6d995', background: '#263328', border: '1px solid #876b39' }}>
        {view.active ? view.connected ? 'Online' : 'Đang nối' : 'Online: tắt'}
      </button>
      {view.active && <button id="vloPresenceCount" type="button"
        title={view.connected ? 'Số người thực tế trong phòng' : view.state}
        onClick={() => setDetail(v => !v)}
        style={{ fontSize: 11, padding: '3px 5px', borderRadius: 5, color: '#f6d995', background: '#263328', border: '1px solid #876b39' }}>
        {view.connected ? '👥 ' + view.realCount : '👥 —'}
      </button>}
      {view.active && detail && <section id="vloPresenceDetail" role="dialog" aria-label="Người chơi Online"
        style={{ position: 'absolute', top: '100%', left: 0, zIndex: 1400, width: 210, maxHeight: 240, overflowY: 'auto', padding: 8, border: '1px solid #a98b51', borderRadius: 6, background: '#17211d', color: '#e6dbba', boxShadow: '0 3px 16px #000b' }}>
        <strong>{view.connected ? view.realCount + ' người trong phòng' : view.state}</strong>
        {view.connected && <><div>{S.name} (mày)</div>{view.peers.map((p, i) => <div key={i}>{p}</div>)}</>}
        <button type="button" onClick={() => setDetail(false)} style={{ marginTop: 5 }}>Đóng</button>
      </section>}
    </div>
  );
}
