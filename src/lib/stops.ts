import generated from '../data/stops.generated.json';
import type { Chapter } from '../chapters';
import { chapterRanges, rangesFromCenters, type Range } from './progress';
import { CHAT_CENTER, WALK_END } from './timeline';

interface StopRow {
  chapterId: string;
  progress: number;
  anchor: [number, number, number];
}

const rows = generated as StopRow[];

/** Number of project seats baked into stops.generated.json (`project-1` .. `project-n`). */
export const projectSeatCount: number = rows.filter((s) => /^project-\d+$/.test(s.chapterId)).length;

/**
 * Stop progress for every chapter, in chapter order, or null if some chapter has no generated stop.
 * The k-th project chapter is `project-k`, so fewer projects than seats simply use seats 1..n.
 * The "more" chapter has no baked stop: it sits halfway between the stops on either side of it.
 */
export function stopCenters(chapters: Chapter[]): number[] | null {
  const byId = new Map(rows.map((s) => [s.chapterId, s.progress * WALK_END]));
  let k = 0;
  const found = chapters.map(
    (ch) => (ch.kind === 'chat' ? CHAT_CENTER : byId.get(ch.kind === 'project' ? `project-${++k}` : ch.id)) ?? null,
  );
  const centers: number[] = [];
  for (let i = 0; i < found.length; i++) {
    const v = found[i];
    if (v !== null) {
      centers.push(v);
      continue;
    }
    const next = found[i + 1] ?? null;
    if (chapters[i].kind !== 'more' || i === 0 || next === null) return null;
    centers.push(centers[i - 1] + (next - centers[i - 1]) * 0.3);
  }
  for (let i = 1; i < centers.length; i++) if (centers[i] <= centers[i - 1]) return null;
  return centers;
}

// Contact tuning. LINGER: how far past the stop the card lasts, as a multiple of the lead-in before it.
// FADE: share of the range spent fading at each end (lower = fully opaque for longer).
// MAX_END: latest progress Contact may run to, so Chat still has room to fade in before the camera parks.
const CONTACT_LINGER = 2.4;
const CONTACT_FADE = 0.2;
const CONTACT_MAX_END = 0.89;

export function layoutRanges(chapters: Chapter[]): { centers: number[] | null; ranges: Range[] } {
  const centers = stopCenters(chapters);
  const ranges = centers ? rangesFromCenters(centers) : chapterRanges(chapters.length);
  if (centers) {
    const i = chapters.findIndex((c) => c.kind === 'cta');
    if (i > 0 && i < ranges.length - 1) {
      const c = centers[i];
      const lead = c - ranges[i].start;
      const end = Math.min(c + lead * CONTACT_LINGER, CONTACT_MAX_END);
      if (lead > 0 && end > c) {
        ranges[i] = { start: ranges[i].start, end, fade: CONTACT_FADE };
        ranges[i + 1] = { start: end, end: ranges[i + 1].end };
      }
    }
  }
  return { centers, ranges };
}
