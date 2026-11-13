// Dev-only performance overlay (?perf=1), loaded via dynamic import behind `import.meta.env.DEV`.
// Everything except fps / frame ms comes straight from renderer.info (values of the last render call).
import * as THREE from 'three';
import type { Quality } from './quality';

export function attachPerf(renderer: THREE.WebGLRenderer, scene: THREE.Scene, quality: Quality): { onDraw(): void; dispose(): void } {
  const el = document.createElement('pre');
  Object.assign(el.style, {
    position: 'fixed', bottom: '8px', left: '50%', transform: 'translateX(-50%)', zIndex: '99999', margin: '0',
    pointerEvents: 'none', font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace', color: '#e8e8e8',
    background: 'rgba(8,8,12,0.8)', padding: '6px 8px', border: '1px solid rgba(255,255,255,0.25)', borderRadius: '6px',
  } as CSSStyleDeclaration);
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);

  let text = '';
  let peakCalls = 0; // highest per-frame draw-call count seen while the overlay has been open
  const tick = () => {
    // The world resets renderer.info once per frame (autoReset is off), so `calls` covers every post pass too.
    const { render, memory } = renderer.info;
    peakCalls = Math.max(peakCalls, render.calls);
    let lights = 0;
    let point = 0;
    scene.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight && l.visible && l.intensity > 0) {
        lights++;
        if ((l as THREE.PointLight).isPointLight) point++;
      }
    });
    const avg = quality.avgMs();
    const q = quality.state();
    const next =
      `fps ${avg ? (1000 / avg).toFixed(0) : '-'}   frame ${avg ? avg.toFixed(1) : '-'} ms (idle between scrolls)\n` +
      `draw calls ${render.calls} (peak ${peakCalls})   triangles ${render.triangles}\n` +
      `geometries ${memory.geometries}   textures ${memory.textures}\n` +
      `lights ${lights} (${point} point)   dpr ${renderer.getPixelRatio()}${q.dprDropped ? ' (dropped)' : ''}${q.postDisabled ? '   post off' : ''}`;
    if (next !== text) {
      text = next;
      el.textContent = next;
    }
  };
  const timer = window.setInterval(tick, 250);
  tick();

  return {
    onDraw() {
      peakCalls = Math.max(peakCalls, renderer.info.render.calls);
    },
    dispose() {
      window.clearInterval(timer);
      el.remove();
    },
  };
}
