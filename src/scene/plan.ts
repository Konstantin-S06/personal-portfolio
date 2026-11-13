// Parses src/data/layout.json into a typed Plan. Pure data, no three.js and no DOM,
// so the stops generator (scripts/gen-stops.ts) can run it under Node.
import layoutJson from '../data/layout.json';

export type Dir = 'N' | 'E' | 'S' | 'W';

/**
 * Grid conventions: row 0 is the top of the map (north, -Z), column 0 is the left (west, -X).
 * World position of a cell centre is (col * cell, row * cell).
 * `rot` is the Y rotation that turns a wall-style piece (pivot on its +Z face) so that +Z points
 * INTO the cell that owns the wall on that side.
 */
export const DIRS: Record<Dir, { dr: number; dc: number; rot: number }> = {
  N: { dr: -1, dc: 0, rot: 0 },
  E: { dr: 0, dc: 1, rot: -Math.PI / 2 },
  S: { dr: 1, dc: 0, rot: Math.PI },
  W: { dr: 0, dc: -1, rot: Math.PI / 2 },
};
export const DIR_ORDER: Dir[] = ['N', 'E', 'S', 'W'];

export type KitRole = 'floor' | 'wall' | 'wallAlt' | 'corner' | 'gate' | 'stairs' | 'pillar' | 'raised';

interface LegendEntry {
  type: 'empty' | 'floor' | 'door' | 'torch' | 'pillar' | 'stairs' | 'table' | 'chair' | 'path' | 'stop';
  raised?: boolean;
  dir?: Dir;
  n?: number;
  id?: string;
}

interface LayoutFile {
  cell: number;
  params: {
    eyeHeight: number;
    raiseHeight: number;
    wallFace: 'front' | 'back';
    lookAhead: number;
    slowSpeed: number;
    slowPlateau: number;
    slowRadius: number;
  };
  kit: Record<KitRole, string>;
  plan: string[];
  legend: Record<string, LegendEntry>;
}

export interface Cell {
  r: number;
  c: number;
}

export interface StairsPiece {
  /** Lower cell and upper cell. The stairs rise from `bottom` towards `top` (direction `dir`). */
  bottom: Cell;
  top: Cell;
  dir: Dir;
}

export interface Plan {
  rows: number;
  cols: number;
  cell: number;
  eye: number;
  raise: number;
  wallFace: 'front' | 'back';
  lookAhead: number;
  slowSpeed: number;
  slowPlateau: number;
  slowRadius: number;
  kit: Record<KitRole, string>;
  /** Raw ASCII rows, kept for the debug map. */
  rowsText: string[];
  legend: Record<string, LegendEntry>;
  walkable: boolean[][];
  raised: boolean[][];
  /** Floor height at the cell centre (0, raise, or a stairs half-step). */
  height: number[][];
  doors: Cell[];
  torches: Cell[];
  pillars: Cell[];
  stairs: StairsPiece[];
  table: Cell | null;
  chairMarkers: (Cell | undefined)[];
  /** Ordered P1..Pn. */
  waypoints: Cell[];
  stopMarkers: Record<string, Cell>;
}

export const cellXZ = (plan: Plan, cell: Cell): [number, number] => [cell.c * plan.cell, cell.r * plan.cell];

export function isWalkable(plan: Plan, r: number, c: number): boolean {
  return r >= 0 && c >= 0 && r < plan.rows && c < plan.cols && plan.walkable[r][c];
}

/** Sides of a cell that border empty space (or the edge of the map), in N, E, S, W order. */
export function emptySides(plan: Plan, r: number, c: number): Dir[] {
  return DIR_ORDER.filter((d) => !isWalkable(plan, r + DIRS[d].dr, c + DIRS[d].dc));
}

export function parsePlan(raw: unknown = layoutJson): Plan {
  const file = raw as LayoutFile;
  const rowsText = file.plan;
  if (!Array.isArray(rowsText) || rowsText.length === 0) throw new Error('layout: "plan" must be a non-empty array of strings');
  const rows = rowsText.length;
  const cols = Math.max(...rowsText.map((s) => s.length));

  const plan: Plan = {
    rows,
    cols,
    cell: file.cell,
    eye: file.params.eyeHeight,
    raise: file.params.raiseHeight,
    wallFace: file.params.wallFace,
    lookAhead: file.params.lookAhead,
    slowSpeed: file.params.slowSpeed,
    slowPlateau: file.params.slowPlateau,
    slowRadius: file.params.slowRadius,
    kit: file.kit,
    rowsText,
    legend: file.legend,
    walkable: Array.from({ length: rows }, () => Array(cols).fill(false)),
    raised: Array.from({ length: rows }, () => Array(cols).fill(false)),
    height: Array.from({ length: rows }, () => Array(cols).fill(0)),
    doors: [],
    torches: [],
    pillars: [],
    stairs: [],
    table: null,
    chairMarkers: [],
    waypoints: [],
    stopMarkers: {},
  };

  const pathByN = new Map<number, Cell>();
  const stairsByDir = new Map<Dir, Cell[]>();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = rowsText[r][c] ?? '.';
      const e = file.legend[ch];
      if (!e) throw new Error(`layout: char "${ch}" at row ${r}, col ${c} is not in the legend`);
      if (e.type === 'empty') continue;
      plan.walkable[r][c] = true;
      const here: Cell = { r, c };
      switch (e.type) {
        case 'floor':
          if (e.raised) {
            plan.raised[r][c] = true;
            plan.height[r][c] = plan.raise;
          }
          break;
        case 'door': plan.doors.push(here); break;
        case 'torch': plan.torches.push(here); break;
        case 'pillar': plan.pillars.push(here); break;
        case 'table':
          if (plan.table) throw new Error('layout: only one table marker is allowed');
          plan.table = here;
          break;
        case 'chair':
          plan.chairMarkers[(e.n ?? 0) - 1] = here;
          break;
        case 'path':
          if (pathByN.has(e.n!)) throw new Error(`layout: waypoint P${e.n} appears twice`);
          pathByN.set(e.n!, here);
          break;
        case 'stop':
          if (plan.stopMarkers[e.id!]) throw new Error(`layout: stop "${e.id}" appears twice`);
          plan.stopMarkers[e.id!] = here;
          break;
        case 'stairs': {
          const list = stairsByDir.get(e.dir!) ?? [];
          list.push(here);
          stairsByDir.set(e.dir!, list);
          break;
        }
      }
    }
  }

  // Waypoints must be P1..Pn without gaps.
  const n = pathByN.size;
  for (let i = 1; i <= n; i++) {
    const w = pathByN.get(i);
    if (!w) throw new Error(`layout: waypoint P${i} is missing (waypoints must be numbered P1..P${n} without gaps)`);
    plan.waypoints.push(w);
  }
  if (n < 2) throw new Error('layout: need at least two path waypoints');

  // Stairs: every piece covers two cells in a line. Pair them bottom-first.
  for (const [dir, cells] of stairsByDir) {
    const { dr, dc } = DIRS[dir];
    const key = (x: Cell) => x.r * dr + x.c * dc; // smaller = lower
    cells.sort((a, b) => key(a) - key(b));
    const used = new Set<string>();
    const id = (x: Cell) => `${x.r},${x.c}`;
    const has = new Set(cells.map(id));
    for (const bottom of cells) {
      if (used.has(id(bottom))) continue;
      const top: Cell = { r: bottom.r + dr, c: bottom.c + dc };
      if (!has.has(id(top)) || used.has(id(top))) {
        throw new Error(`layout: stairs at row ${bottom.r}, col ${bottom.c} (${dir}) need a second stairs cell directly ahead`);
      }
      used.add(id(bottom));
      used.add(id(top));
      plan.stairs.push({ bottom, top, dir });
      plan.height[bottom.r][bottom.c] = plan.raise * 0.25;
      plan.height[top.r][top.c] = plan.raise * 0.75;
    }
  }

  return plan;
}

// ---- table layout (shared by the geometry and the stop generator) -------------------------

export const TABLE_RADIUS = 3;
export const SEAT_RADIUS = 4.8;

export interface Seat {
  n: number;
  /** Compass angle in radians, clockwise from north. */
  angle: number;
  x: number;
  z: number;
}

export interface TableLayout {
  x: number;
  z: number;
  seats: Seat[];
}

/**
 * Six seats spaced 60 degrees apart. Chair marker 1 sets the start angle and marker 2 sets the
 * direction (clockwise or counter-clockwise). The remaining markers are just visual hints on the map.
 */
export function tableLayout(plan: Plan): TableLayout {
  if (!plan.table) throw new Error('layout: no table marker ("@") in the plan');
  const [x, z] = cellXZ(plan, plan.table);
  const angleOf = (m: Cell | undefined, fallback: number) => {
    if (!m) return fallback;
    const [mx, mz] = cellXZ(plan, m);
    return Math.atan2(mx - x, -(mz - z));
  };
  const a1 = angleOf(plan.chairMarkers[0], Math.PI);
  const a2 = angleOf(plan.chairMarkers[1], a1 + Math.PI / 3);
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const sign = delta >= 0 ? 1 : -1;
  const seats: Seat[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = a1 + sign * i * (Math.PI / 3);
    seats.push({ n: i + 1, angle, x: x + SEAT_RADIUS * Math.sin(angle), z: z - SEAT_RADIUS * Math.cos(angle) });
  }
  return { x, z, seats };
}
