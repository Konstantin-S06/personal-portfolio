// Shared helpers for deterministic placement: seeded RNG, wall edges, distance to the camera path.
import type * as THREE from 'three';
import { DIRS, emptySides, type Dir, type Plan } from './plan';
import { torchWall } from './kit';

/** Small seeded PRNG (mulberry32): the same seed always gives the same scene. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: T[], rand: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length) % list.length];

/** One wall of a walkable cell, with the cell side it stands on. */
export interface WallEdge {
  key: string;
  r: number;
  c: number;
  dir: Dir;
  /** Cell centre. */
  cx: number;
  cz: number;
  /** Floor height of the cell. */
  y: number;
  /** Midpoint of the wall's inner face. */
  x: number;
  z: number;
  /** Y rotation that makes +Z point into the room (same convention as DIRS). */
  rot: number;
  /** Unit normal pointing into the room. */
  nx: number;
  nz: number;
}

/**
 * Wall edges that are free of kit furniture: not on a door or stairs cell and not holding a torch.
 * Pillars are in the middle of their cell, so they do not matter here.
 */
export function wallEdges(plan: Plan): WallEdge[] {
  const half = plan.cell / 2;
  const skip = new Set<string>();
  plan.doors.forEach((d) => skip.add(`${d.r},${d.c}`));
  plan.stairs.forEach((s) => {
    skip.add(`${s.bottom.r},${s.bottom.c}`);
    skip.add(`${s.top.r},${s.top.c}`);
  });
  const torchEdges = new Set<string>();
  plan.torches.forEach((t) => {
    const d = torchWall(plan, t);
    if (d) torchEdges.add(`${t.r},${t.c},${d}`);
  });
  const out: WallEdge[] = [];
  for (let r = 0; r < plan.rows; r++) {
    for (let c = 0; c < plan.cols; c++) {
      if (!plan.walkable[r][c] || skip.has(`${r},${c}`)) continue;
      const cx = c * plan.cell;
      const cz = r * plan.cell;
      for (const d of emptySides(plan, r, c)) {
        const key = `${r},${c},${d}`;
        if (torchEdges.has(key)) continue;
        const { dr, dc, rot } = DIRS[d];
        out.push({ key, r, c, dir: d, cx, cz, y: plan.height[r][c], x: cx + dc * half, z: cz + dr * half, rot, nx: -dc, nz: -dr });
      }
    }
  }
  return out;
}

/** Horizontal distance from (x, z) to the nearest of the given path points. */
export function pathDistance(points: THREE.Vector3[]): (x: number, z: number) => number {
  return (x, z) => {
    let best = Infinity;
    for (const p of points) {
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
}
