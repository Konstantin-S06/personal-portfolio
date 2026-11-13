import { clamp } from './progress';

let token = 0;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Tween window.scrollY to `target`. Duration 0.8-2s scaled by distance, ease-out only.
 * Only the most recent call may finish; older tweens stop on their next frame.
 */
export function tweenScrollTo(target: number, pinSpan: number): void {
  const mine = ++token;
  const from = window.scrollY;
  const distance = target - from;
  const root = document.documentElement;

  if (Math.abs(distance) < 1) {
    window.scrollTo(0, target);
    return;
  }

  const fraction = Math.abs(distance) / Math.max(pinSpan, 1);
  const duration = clamp(0.8 + (2.0 - 0.8) * fraction, 0.8, 2.0) * 1000;

  // CSS smooth scrolling would fight the per-frame scrollTo calls.
  const prevBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  const t0 = performance.now();

  const step = (now: number) => {
    if (mine !== token) return; // stale request: newer tween owns the scrollbar and the restore
    const t = clamp((now - t0) / duration);
    window.scrollTo(0, from + distance * easeOutCubic(t));
    if (t < 1) requestAnimationFrame(step);
    else root.style.scrollBehavior = prevBehavior;
  };
  requestAnimationFrame(step);
}

/** Cancel any running tween (e.g. when leaving pinned mode). */
export function cancelScrollTween(): void {
  token++;
  document.documentElement.style.scrollBehavior = '';
}
