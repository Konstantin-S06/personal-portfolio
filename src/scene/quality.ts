// Frame-time monitor with one-way adaptive quality.
// The world renders on demand, so only gaps between consecutive draws (<= IDLE_GAP_MS) count as frames.
//  1. Average frame time over WINDOW frames above LIMIT_MS: drop the pixel ratio to 1.
//  2. Still above LIMIT_MS over the next window: disable every registered post effect.
// Quality never goes back up within a session.

const WINDOW = 60;
const LIMIT_MS = 24;
const IDLE_GAP_MS = 100;
const WARMUP_FRAMES = 10; // shader compilation and first uploads are not representative

export interface Quality {
  /** Call once per draw. */
  frame(now: number): void;
  /** Milliseconds between the two most recent consecutive draws (0 when idle). */
  lastMs(): number;
  /** Exponential moving average of the frame time, in ms (0 until measured). */
  avgMs(): number;
  state(): { dprDropped: boolean; postDisabled: boolean };
}

export interface QualityOptions {
  /** Current pixel ratio, so the first step can be skipped when it is already 1. */
  currentPixelRatio(): number;
  /** Apply pixel ratio 1 (and whatever resize that needs). */
  dropPixelRatio(): void;
  /** Turn off post-processing. The scene currently has none, so callers may pass a no-op. */
  disablePost(): void;
}

export function createQuality(opts: QualityOptions): Quality {
  let prev = 0;
  let warmup = WARMUP_FRAMES;
  let sum = 0;
  let count = 0;
  let last = 0;
  let ema = 0;
  let dprDropped = false;
  let postDisabled = false;

  return {
    frame(now) {
      const dt = now - prev;
      prev = now;
      if (dt <= 0 || dt > IDLE_GAP_MS) {
        last = 0;
        return;
      }
      last = dt;
      ema = ema === 0 ? dt : ema * 0.9 + dt * 0.1;
      if (postDisabled) return; // nothing left to give up
      if (warmup > 0) {
        warmup--;
        return;
      }
      sum += dt;
      if (++count < WINDOW) return;
      const avg = sum / count;
      sum = 0;
      count = 0;
      if (avg <= LIMIT_MS) return;
      if (!dprDropped) {
        dprDropped = true;
        if (opts.currentPixelRatio() > 1) {
          opts.dropPixelRatio();
          console.info(`[quality] avg frame ${avg.toFixed(1)} ms > ${LIMIT_MS}: pixel ratio -> 1`);
          warmup = WARMUP_FRAMES;
          return;
        }
      }
      postDisabled = true;
      opts.disablePost();
      console.info(`[quality] avg frame ${avg.toFixed(1)} ms > ${LIMIT_MS}: post effects disabled`);
    },
    lastMs: () => last,
    avgMs: () => ema,
    state: () => ({ dprDropped, postDisabled }),
  };
}
