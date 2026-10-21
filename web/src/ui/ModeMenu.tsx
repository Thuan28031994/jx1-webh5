'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGameTick } from './useGameTick';
import { S, save } from '../game/save';
import { setCtrl } from '../game/control';
import { openEventHub } from '../game/eventhub';
import { openGiftTab, towerStart, unlocked } from '../game/rewards';
import { uiSfx } from '../game/audio';
import { toast } from '../game/ui';

/*
 * BRONC3 V12.4 dropdown visibility fix, adapted for the React/Next.js port.
 * Only offers actions already backed by the current TS engine. The separate
 * BRONC3 "quest/dungeon/tower autopilot" state machine is NOT activated here.
 * The menu is portalled out of #battle (overflow: hidden).
 */
const ACTIONS = [
  { key: 'farm', glyph: '⚔', label: 'Tự đánh', help: 'Bật điều khiển tự động tại bãi hiện tại' },
  { key: 'dg', glyph: '🏯', label: 'Phó bản', help: 'Mở hoạt động Phó bản' },
  { key: 'quest', glyph: '📜', label: 'Nhiệm vụ', help: 'Mở bảng nhiệm vụ' },
  { key: 'tower', glyph: '🗼', label: 'Leo Tháp', help: 'Bắt đầu Thông Thiên Tháp I (cần cấp 10)' },
] as const;

type ActionKey = typeof ACTIONS[number]['key'];

const shell: React.CSSProperties = {
  position: 'absolute', top: 50, right: 8, zIndex: 8,
};
const triggerStyle: React.CSSProperties = {
  minHeight: 32, padding: '5px 10px', borderRadius: 8,
  border: '1px solid #b99a5e', color: '#f6d995',
  background: 'rgba(24, 32, 26, .96)', font: '600 12px system-ui',
  boxShadow: '0 3px 12px #0009', touchAction: 'manipulation',
};
const menuStyle: React.CSSProperties = {
  position: 'fixed', zIndex: 1200, width: 206, maxWidth: 'calc(100vw - 14px)',
  maxHeight: 'min(70dvh, 280px)', overflowY: 'auto',
  boxSizing: 'border-box', padding: 5, borderRadius: 8,
  border: '1px solid #b99a5e', background: 'rgba(19, 23, 19, .98)',
  boxShadow: '0 8px 24px #000c', display: 'grid', gap: 4,
};
const itemStyle: React.CSSProperties = {
  display: 'block', boxSizing: 'border-box', width: '100%',
  padding: '10px 9px', minHeight: 40, textAlign: 'left', borderRadius: 5,
  border: '1px solid #564b32', background: '#253329', color: '#eee2bf',
  font: '600 13px system-ui', cursor: 'pointer', touchAction: 'manipulation',
};

export default function ModeMenu() {
  useGameTick();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties>({ top: -9999, left: -9999 });
  const [host, setHost] = useState<HTMLElement | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const playerReady = !!(S && S.fac);

  // Fullscreen has its own top layer; portals to body can disappear behind it.
  const place = useCallback(() => {
    if (!open || !anchor.current || !panel.current) return;
    const a = anchor.current.getBoundingClientRect();
    const m = panel.current.getBoundingClientRect();
    const pad = 7, gap = 5, w = window.innerWidth, h = window.innerHeight;
    const mw = Math.min(206, w - 2 * pad);
    const mh = Math.min(m.height || 200, h - 2 * pad);
    const below = h - a.bottom - gap - pad, above = a.top - gap - pad;
    const upward = below < mh && above > below;
    const vx = Math.max(pad, Math.min(a.left, w - mw - pad));
    const vy = Math.max(pad, Math.min(upward ? a.top - gap - mh : a.bottom + gap, h - mh - pad));
    const parent = panel.current.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement) {
      const rect = parent.getBoundingClientRect();
      const t = getComputedStyle(parent);
      if (t.transform !== 'none' || t.perspective !== 'none' || t.filter !== 'none') {
        const sx = rect.width / (parent.offsetWidth || rect.width || 1);
        const sy = rect.height / (parent.offsetHeight || rect.height || 1);
        setPosition({ left: (vx - rect.left) / (sx || 1), top: (vy - rect.top) / (sy || 1), width: mw / (sx || 1) });
        return;
      }
    }
    setPosition({ top: vy, left: vx, width: mw });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setHost((document.fullscreenElement as HTMLElement | null) || document.body);
  }, [open]);

  useEffect(() => {
    if (!open || !host) return;
    place();
    const resize = () => place();
    const dismiss = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const fullscreen = () => { setHost((document.fullscreenElement as HTMLElement | null) || document.body); };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape);
    document.addEventListener('fullscreenchange', fullscreen);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('fullscreenchange', fullscreen);
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [open, host, place]);

  useEffect(() => { if (!playerReady) setOpen(false); }, [playerReady]);

  function activate(key: ActionKey) {
    setOpen(false);
    uiSfx('click');
    if (key === 'farm') {
      setCtrl('auto');
      save();
      toast('Đã bật tự đánh tại bãi hiện tại');
    } else if (key === 'dg') {
      openEventHub('dg');
    } else if (key === 'quest') {
      openGiftTab('quest');
    } else if (key === 'tower') {
      if (unlocked(10)) towerStart(1);
      else toast('Leo Tháp cần cấp 10');
    }
  }

  if (!playerReady) return null;

  return (
    <div id="modeSw" style={shell}>
      <button
        id="mswBtn" ref={anchor} type="button" style={triggerStyle}
        aria-haspopup="menu" aria-expanded={open} aria-controls="mswMenu"
        aria-label="Mở menu hoạt động" title="Mở nhanh hoạt động; không đổi chế độ tự chạy"
        onClick={() => setOpen(v => !v)}
      >Hoạt động {open ? '▴' : '▾'}</button>
      {open && host && createPortal(
        <div id="mswMenu" ref={panel} role="menu" aria-label="Hoạt động nhanh"
          style={{ ...menuStyle, ...position }}>
          {ACTIONS.map(a => (
            <button key={a.key} type="button" role="menuitem"
              data-msw={a.key} title={a.help} style={itemStyle}
              onClick={() => activate(a.key)}>
              {a.glyph} {a.label}
            </button>
          ))}
        </div>, host
      )}
    </div>
  );
}
