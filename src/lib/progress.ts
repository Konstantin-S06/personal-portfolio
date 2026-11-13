export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export interface Range {
  start: number;
  end: number;
  /** Fraction of the range spent fading at each end (default 0.35). */
  fade?: number;
}

/** Equal progress ranges, one per chapter. */
export function chapterRanges(count: number): Range[] {
  return Array.from({ length: count }, (_, i) => ({ start: i / count, end: (i + 1) / count }));
}

/**
 * Chapter ranges around given centres (stop progress values): each boundary sits halfway between neighbouring centres,
 * the first range starts at 0 and the last ends at 1.
 */
export function rangesFromCenters(centers: number[]): Range[] {
  return centers.map((c, i) => ({
    start: i === 0 ? 0 : (centers[i - 1] + c) / 2,
    end: i === centers.length - 1 ? 1 : (c + centers[i + 1]) / 2,
  }));
}

const fadeLength = (r: Range) => (r.end - r.start) * (r.fade ?? 0.35);

export function chapterOpacity(r: Range, progress: number): number {
  const fade = fadeLength(r);
  const fadeIn = r.start === 0 ? 1 : clamp((progress - r.start) / fade);
  const fadeOut = r.end === 1 ? 1 : clamp((r.end - progress) / fade);
  return Math.min(fadeIn, fadeOut);
}

/** Progress at which navigation lands: just inside the fade, where the panel is already opaque. */
export function chapterLanding(r: Range): number {
  const fade = fadeLength(r);
  return r.start === 0 ? r.start + fade : r.start + fade * 1.25;
}

/** Index of the chapter with the highest opacity (ties go to the earlier one). */
export function activeIndex(ranges: Range[], progress: number): number {
  let best = 0;
  let bestOpacity = -1;
  ranges.forEach((r, i) => {
    const o = chapterOpacity(r, progress);
    if (o > bestOpacity + 1e-6) {
      best = i;
      bestOpacity = o;
    }
  });
  return best;
}