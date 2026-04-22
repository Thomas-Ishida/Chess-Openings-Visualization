/* ============================================================
   heatmap.ts — Control map computation and heatmap UI
============================================================ */

import { Board, Color, pieceMoves, col } from './chess.js';

export type HeatMode = 'white' | 'black' | 'both' | 'off';

export interface CtrlMap { w: number[][]; b: number[][]; }

export function computeCtrl(bd: Board): CtrlMap {
  const w: number[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
  const b: number[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = bd[r][c]; if (!p) continue;
    for (const [tr, tc] of pieceMoves(bd, r, c, null, null, true)) {
      if (col(p) === 'w') w[tr][tc]++; else b[tr][tc]++;
    }
  }
  return { w, b };
}

export function applyHeatOverlay(
  sqEl: HTMLElement,
  wv: number,
  bv: number,
  mode: HeatMode
): void {
  if (mode === 'off') return;
  const ov = document.createElement('div');
  ov.className = 'heat-overlay';
  const mx = 4;
  if (mode === 'white' && wv > 0) {
    ov.style.background = `rgba(74,143,255,${(Math.min(wv / mx, 1) * 0.72).toFixed(2)})`;
  } else if (mode === 'black' && bv > 0) {
    ov.style.background = `rgba(255,80,80,${(Math.min(bv / mx, 1) * 0.72).toFixed(2)})`;
  } else if (mode === 'both' && (wv > 0 || bv > 0)) {
    if (wv > bv) {
      ov.style.background = `rgba(74,143,255,${(Math.min(wv / mx, 1) * 0.65).toFixed(2)})`;
    } else if (bv > wv) {
      ov.style.background = `rgba(255,80,80,${(Math.min(bv / mx, 1) * 0.65).toFixed(2)})`;
    } else {
      ov.style.background = `rgba(160,80,200,${(Math.min(wv / mx, 1) * 0.65).toFixed(2)})`;
    }
  }
  sqEl.appendChild(ov);
}

export function toggleHeat(mode: HeatMode, render: () => void): void {
  (window as any).heatMode = mode;
  const setClass = (id: string, active: boolean, cls: string) => {
    const el = document.getElementById(id);
    if (el) el.className = 'heat-btn' + (active ? ' ' + cls : '');
  };
  setClass('heat-white', mode === 'white', 'on-white');
  setClass('heat-black', mode === 'black', 'on-black');
  setClass('heat-both',  mode === 'both',  'on-both');
  const offEl = document.getElementById('heat-off');
  if (offEl) offEl.className = 'heat-btn';
  const legend = document.getElementById('heat-legend');
  if (legend) legend.style.display = mode === 'off' ? 'none' : 'flex';
  render();
}