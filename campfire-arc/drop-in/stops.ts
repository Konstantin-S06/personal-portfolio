import generated from '../data/stops.generated.json';
import type { Chapter } from '../chapters';
import { chapterRanges, rangesFromCenters, type Range } from './progress';

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
  const byId = new Map(rows.map((s) => [s.chapterId, s.progress]));
  let k = 0;
  const found = chapters.map((ch) => byId.get(ch.kind === 'project' ? `project-${++k}` : ch.id) ?? null);
  const centers: number[] = [];
  for (let i = 0; i < found.length; i++) {
    const v = found[i];
    if (v !== null) {
      centers.push(v);
      continue;
    }
    const next = found[i + 1] ?? null;
    if (chapters[i].kind !== 'more' || i === 0 || next === null) return null;
    centers.push((centers[i - 1] + next) / 2);
  }
  for (let i = 1; i < centers.length; i++) if (centers[i] <= centers[i - 1]) return null;
  return centers;
}

/** Progress range per chapter: centred on the stops when possible, equal slices otherwise. */
export function layoutRanges(chapters: Chapter[]): { centers: number[] | null; ranges: Range[] } {
  const centers = stopCenters(chapters);
  return { centers, ranges: centers ? rangesFromCenters(centers) : chapterRanges(chapters.length) };
}
