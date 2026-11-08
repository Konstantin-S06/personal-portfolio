// Procedural props, all instanced primitives (box, cylinder, bowl, icosahedron, torus, cloth plane, flame):
// braziers at the pillars, a candle chandelier over the table, table dressing, barrels and crates in the
// corridor, wall banners, hanging chains and rubble. One draw call per primitive, whatever the count.
import * as THREE from 'three';
import * as L from './look';
import type { Plan, TableLayout } from './plan';
import type { Journey } from './journey';
import type { Zones } from './zones';
import type { Fx } from './fx';
import { TABLE_HEIGHT } from './table';
import { mulberry32, pathDistance, pick, shuffle, wallEdges, type WallEdge } from './scatter';

export interface Props {
  group: THREE.Group;
  /** Number of instances per primitive, for the dev overlay. */
  counts: Record<string, number>;
  dispose(): void;
}

type Kind = 'box' | 'cyl' | 'bowl' | 'ico' | 'torus' | 'cloth' | 'flame';

const WALL_HEIGHT = 4.05; // matches kit.ts

export function buildProps(
  plan: Plan,
  tbl: TableLayout,
  journey: Journey,
  zones: Zones,
  fx: Fx,
  reservedEdges: Set<string>,
  sightLines: { ax: number; az: number; bx: number; bz: number }[],
): Props {
  const rand = mulberry32(L.SEED);
  const half = plan.cell / 2;
  const group = new THREE.Group();
  group.name = 'props';

  const geos: Record<Kind, THREE.BufferGeometry> = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
    bowl: new THREE.CylinderGeometry(1, 0.55, 1, 10),
    ico: new THREE.IcosahedronGeometry(1, 0),
    torus: new THREE.TorusGeometry(1, 0.035, 6, 28),
    cloth: new THREE.PlaneGeometry(1, 1),
    // flame: base at y = 0, 0.4 tall at scale 1
    flame: new THREE.IcosahedronGeometry(1, 1).scale(0.11, 0.2, 0.11).translate(0, 0.2, 0),
  };
  const lit = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const clothMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const mats: Record<Kind, THREE.Material> = {
    box: lit, cyl: lit, bowl: lit, ico: lit, torus: lit, cloth: clothMat, flame: fx.flameMaterial,
  };

  interface Inst { m: THREE.Matrix4; c: THREE.Color }
  const items: Record<Kind, Inst[]> = { box: [], cyl: [], bowl: [], ico: [], torus: [], cloth: [], flame: [] };

  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /** Place one primitive. Rotations are Euler YXZ (yaw, pitch, roll). */
  const put = (kind: Kind, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, yaw = 0, pitch = 0, roll = 0) => {
    q.setFromEuler(e.set(pitch, yaw, roll, 'YXZ'));
    items[kind].push({ m: new THREE.Matrix4().compose(p.set(x, y, z), q, s.set(sx, sy, sz)), c: new THREE.Color(color) });
  };
  /** A cylinder stretched between two points. */
  const segment = (a: THREE.Vector3, b: THREE.Vector3, radius: number, color: number) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    q.setFromUnitVectors(UP, d.divideScalar(len));
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    items.cyl.push({ m: new THREE.Matrix4().compose(mid, q, s.set(radius, len, radius)), c: new THREE.Color(color) });
  };
  const flame = (x: number, y: number, z: number, scale: number) => put('flame', x, y, z, scale, scale, scale, 0xffffff);

  const polyline = journey.polyline(Math.max(2, Math.ceil(journey.length / 0.5)));
  const pathDist = pathDistance(polyline);
  const edges = wallEdges(plan);
  const occupied: { x: number; z: number; r: number }[] = [];
  /** Distance from (x, z) to the nearest stop-to-banner sight line, so props never stand in front of a banner. */
  const sightDist = (x: number, z: number) => {
    let best = Infinity;
    for (const l of sightLines) {
      const dx = l.bx - l.ax;
      const dz = l.bz - l.az;
      const t = Math.min(1, Math.max(0, ((x - l.ax) * dx + (z - l.az) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(x - (l.ax + dx * t), z - (l.az + dz * t)));
    }
    return best;
  };
  const free = (x: number, z: number, r: number, clearance: number) =>
    pathDist(x, z) >= clearance + r &&
    sightDist(x, z) >= L.PROP_SIGHT_CLEARANCE + r &&
    occupied.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + r);
  const claim = (x: number, z: number, r: number) => occupied.push({ x, z, r });

  /** A position against a wall edge, pulled in by the wall margin and slid along it. */
  const wallSpot = (ed: WallEdge) => {
    const along = (rand() * 2 - 1) * (half - 0.85);
    const inset = half - L.PROP_WALL_MARGIN - rand() * 0.3;
    return { x: ed.cx - ed.nx * inset + Math.abs(ed.nz) * along, z: ed.cz - ed.nz * inset + Math.abs(ed.nx) * along, y: ed.y };
  };
  const spots = (filter: (ed: WallEdge) => boolean, count: number, radius: number) => {
    const out: { x: number; z: number; y: number; ed: WallEdge }[] = [];
    for (const ed of shuffle(edges.filter(filter), rand)) {
      if (out.length >= count) break;
      for (let tries = 0; tries < 3; tries++) {
        const sp = wallSpot(ed);
        if (!free(sp.x, sp.z, radius, L.PROP_PATH_CLEARANCE)) continue;
        claim(sp.x, sp.z, radius);
        out.push({ ...sp, ed });
        break;
      }
    }
    return out;
  };
  const inZone = (zone: number) => (ed: WallEdge) => zones.indexAt(ed.cz) === zone;

  // ---- braziers at the pillars ----------------------------------------------------------------------
  for (const pil of plan.pillars) {
    const cx = pil.c * plan.cell;
    const cz = pil.r * plan.cell;
    const y = plan.height[pil.r][pil.c];
    const dirs: [number, number][] = (pil.r + pil.c) % 2 ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const ok = ([dx, dz]: [number, number], sight: boolean) => {
      const x = cx + dx * L.BRAZIER_OFFSET;
      const z = cz + dz * L.BRAZIER_OFFSET;
      return pathDist(x, z) >= 1.0 && (!sight || sightDist(x, z) >= L.PROP_SIGHT_CLEARANCE);
    };
    const d = dirs.find((dir) => ok(dir, true)) ?? dirs.find((dir) => ok(dir, false)) ?? dirs[0];
    const bx = cx + d[0] * L.BRAZIER_OFFSET;
    const bz = cz + d[1] * L.BRAZIER_OFFSET;
    claim(bx, bz, 0.4);
    put('cyl', bx, y + L.BRAZIER_HEIGHT / 2, bz, 0.07, L.BRAZIER_HEIGHT, 0.07, L.PROP_COLORS.metal[0]);
    put('bowl', bx, y + L.BRAZIER_HEIGHT + 0.14, bz, 0.38, 0.28, 0.38, L.PROP_COLORS.metal[0]);
    flame(bx, y + L.BRAZIER_HEIGHT + 0.2, bz, L.BRAZIER_FLAME_SCALE);
  }

  // ---- chandelier ring over the table, 12 candle flames ------------------------------------------------
  {
    const R = L.CHANDELIER_RADIUS;
    const ringY = L.CHANDELIER_Y;
    put('torus', tbl.x, ringY, tbl.z, R, R, R, L.PROP_COLORS.metal[0], 0, Math.PI / 2);
    for (let i = 0; i < L.CHANDELIER_CANDLES; i++) {
      const a = (i / L.CHANDELIER_CANDLES) * Math.PI * 2;
      const x = tbl.x + Math.sin(a) * R;
      const z = tbl.z - Math.cos(a) * R;
      put('cyl', x, ringY + 0.13, z, 0.045, 0.22, 0.045, L.PROP_COLORS.candle[0]);
      flame(x, ringY + 0.24, z, L.CHANDELIER_FLAME_SCALE);
    }
    const apex = new THREE.Vector3(tbl.x, WALL_HEIGHT, tbl.z);
    for (let i = 0; i < L.CHANDELIER_CHAINS; i++) {
      const a = (i / L.CHANDELIER_CHAINS) * Math.PI * 2 + 0.4;
      segment(new THREE.Vector3(tbl.x + Math.sin(a) * R, ringY, tbl.z - Math.cos(a) * R), apex, 0.018, L.PROP_COLORS.metal[0]);
    }
  }

  // ---- table dressing: candles, stacked books, rolled scrolls -----------------------------------------------
  {
    const top = TABLE_HEIGHT;
    const at = (r: number, a: number) => [tbl.x + Math.sin(a) * r, tbl.z - Math.cos(a) * r] as const;
    for (let i = 0; i < L.TABLE_CANDLES; i++) {
      const [x, z] = at(1.55, (i / L.TABLE_CANDLES) * Math.PI * 2 + 0.2);
      put('cyl', x, top + 0.125, z, 0.04, 0.25, 0.04, L.PROP_COLORS.candle[0]);
      flame(x, top + 0.25, z, L.TABLE_FLAME_SCALE);
    }
    for (let k = 0; k < L.TABLE_BOOK_STACKS; k++) {
      const [x, z] = at(0.95, Math.PI / 6 + 0.35 + (k / L.TABLE_BOOK_STACKS) * Math.PI * 2);
      for (let b = 0; b < L.TABLE_BOOKS_PER_STACK; b++) {
        const w = 0.46 + rand() * 0.1;
        put('box', x + (rand() - 0.5) * 0.04, top + 0.05 + b * 0.1, z + (rand() - 0.5) * 0.04, w, 0.09, 0.34, pick(L.PROP_COLORS.book, rand), (rand() - 0.5) * 0.6);
      }
    }
    for (let i = 0; i < L.TABLE_SCROLLS; i++) {
      const [x, z] = at(0.3 + rand() * 0.45, rand() * Math.PI * 2);
      put('cyl', x, top + 0.06, z, 0.055, 0.5, 0.055, L.PROP_COLORS.parchment[0], rand() * Math.PI, 0, Math.PI / 2);
    }
  }

  // ---- corridor alcoves: barrels and crates ----------------------------------------------------------
  for (const sp of spots(inZone(0), L.BARREL_COUNT, 0.5)) {
    put('cyl', sp.x, sp.y + 0.45, sp.z, 0.42, 0.9, 0.42, pick(L.PROP_COLORS.wood, rand), rand() * Math.PI);
  }
  for (const sp of spots(inZone(0), L.CRATE_COUNT, 0.6)) {
    const size = 0.7 + rand() * 0.3;
    const yaw = (rand() - 0.5) * 0.9;
    put('box', sp.x, sp.y + size / 2, sp.z, size, size, size, pick(L.PROP_COLORS.crate, rand), yaw);
    if (rand() < 0.4) put('box', sp.x + 0.05, sp.y + size + size * 0.3, sp.z, size * 0.6, size * 0.6, size * 0.6, pick(L.PROP_COLORS.crate, rand), yaw + 0.5);
  }

  // ---- rubble piles ------------------------------------------------------------------------------------
  for (const sp of spots(() => true, L.RUBBLE_PILES, 0.6)) {
    for (let i = 0; i < L.RUBBLE_PER_PILE; i++) {
      const rr = 0.12 + rand() * 0.32;
      put('ico', sp.x + (rand() - 0.5) * 0.9, sp.y + rr * 0.55, sp.z + (rand() - 0.5) * 0.9, rr, rr * 0.8, rr, pick(L.PROP_COLORS.stone, rand), rand() * Math.PI * 2, rand(), rand());
    }
  }

  // ---- wall banners (decorative cloth), spread over all zones -------------------------------------------
  {
    const placed: { x: number; z: number }[] = [];
    for (const ed of shuffle(edges.filter((x) => !reservedEdges.has(x.key)), rand)) {
      if (placed.length >= L.BANNER_DECOR_COUNT) break;
      if (placed.some((o) => Math.hypot(o.x - ed.x, o.z - ed.z) < 4.5)) continue;
      placed.push({ x: ed.x, z: ed.z });
      const gap = half - 0.09;
      const x = ed.cx - ed.nx * gap;
      const z = ed.cz - ed.nz * gap;
      const color = L.PROP_COLORS.cloth[zones.indexAt(ed.cz) % L.PROP_COLORS.cloth.length];
      put('cloth', x, ed.y + 2.55, z, 0.95, 2.1, 1, color, ed.rot);
      put('box', x - ed.nx * 0.03, ed.y + 3.62, z - ed.nz * 0.03, ed.nz !== 0 ? 1.25 : 0.06, 0.06, ed.nx !== 0 ? 1.25 : 0.06, L.PROP_COLORS.metal[0]);
    }
  }

  // ---- hanging chains --------------------------------------------------------------------------------
  {
    const cells: [number, number][] = [];
    for (let r = 0; r < plan.rows; r++) for (let c = 0; c < plan.cols; c++) if (plan.walkable[r][c]) cells.push([r, c]);
    let made = 0;
    for (const [r, c] of shuffle(cells, rand)) {
      if (made >= L.CHAIN_COUNT) break;
      const x = c * plan.cell + (rand() * 2 - 1) * (half - 0.7);
      const z = r * plan.cell + (rand() * 2 - 1) * (half - 0.7);
      if (pathDist(x, z) < 0.5) continue;
      made++;
      const top = plan.height[r][c] + WALL_HEIGHT;
      const yaw0 = rand() * Math.PI;
      for (let i = 0; i < L.CHAIN_LINKS; i++) {
        put('box', x, top - 0.07 - i * 0.11, z, 0.07, 0.13, 0.025, L.PROP_COLORS.metal[0], yaw0 + (i % 2) * Math.PI / 2);
      }
    }
  }

  // ---- build the instanced meshes ---------------------------------------------------------------------
  const counts: Record<string, number> = {};
  (Object.keys(items) as Kind[]).forEach((kind) => {
    const list = items[kind];
    counts[kind] = list.length;
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geos[kind], mats[kind], list.length);
    mesh.name = `props:${kind}`;
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      if (kind !== 'flame') mesh.setColorAt(i, it.c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  return {
    group,
    counts,
    dispose() {
      Object.values(geos).forEach((g) => g.dispose());
      lit.dispose();
      clothMat.dispose();
      group.children.forEach((c) => (c as THREE.InstancedMesh).dispose());
    },
  };
}
