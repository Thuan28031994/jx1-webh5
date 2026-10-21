'use client';
import React, { useEffect, useState } from 'react';

/* V22 mobile landscape: fullscreen requires a user gesture on most browsers.
 * Never try to force orientation, move live React nodes or override the game layout.
 * This small control is additive and hidden in portrait/desktop.
 */
export default function MobileLandscapeFullscreen() {
  const [landscape, setLandscape] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => {
      const mobile = window.matchMedia('(pointer: coarse)').matches ||
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      setLandscape(mobile && window.innerWidth > window.innerHeight);
      setFullscreen(Boolean(document.fullscreenElement));
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      document.removeEventListener('fullscreenchange', sync);
    };
  }, []);
  if (!landscape || fullscreen) return null;
  async function enter() {
    try {
      await (document.getElementById('app') || document.documentElement).requestFullscreen();
    } catch {
      // iOS Safari may not offer the Fullscreen API for arbitrary DOM elements.
      // In that case retain standard landscape layout.
    }
  }
  return <button id="vloLandscapeFullscreen" type="button" title="Bật toàn màn hình ngang"
    aria-label="Bật toàn màn hình ngang" onClick={enter}
    style={{ position: 'absolute', top: 7, left: 7, zIndex: 9, border: '1px solid #b99a5e',
      borderRadius: 6, padding: '6px 8px', color: '#ffe4af', background: '#15231ed9',
      font: '600 12px system-ui', cursor: 'pointer' }}>⛶ Toàn màn hình</button>;
}
