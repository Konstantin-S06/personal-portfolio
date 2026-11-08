// Builds the dungeon from the floor plan using the Kenney modular kit (public/models/kit).
//
// Orientation assumptions (see docs/kit-notes.md, not yet visually confirmed by the notes):
//  - Wall-style pieces (wall, wall-detail, wall-corner) have their pivot on the +Z face and the body
//    extends towards -Z. The +Z (pivot) face is assumed to be the decorated, visible side.
//    Each wall is placed with its pivot face on the cell edge, body in the neighbouring empty cell,
//    rotated so +Z points into the floor cell. Set params.wallFace to "back" in layout.json to flip this.
//  - Gates are symmetric front/back, 4.4 wide along X: rotated 90 degrees when the passage runs along X.
//  - Stairs rise towards local -Z (the pivot sits 2.2 in from the +Z end). Scaled down in height so the
//    8.55 unit rise becomes plan.raise.
//  - The kit has no ceiling piece, so template-floor is reused, flipped, at wall height.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DIRS, emptySides, type Cell, type Dir, type KitRole, type Plan } from './plan';
import { KIT_BRIGHTNESS_VARIATION } from './look';
import type { Zones } from './zones';

const KIT_URL = `${import.meta.env.BASE_URL}models/kit/`;
const LOAD_TIMEOUT_MS = 15000;

const CHUNK_CELLS = 4; // instanced meshes are split into chunks of 4 x 4 plan cells
const WALL_HEIGHT = 4.05;
const WALL_DEPTH = 1.9936;
const STAIRS_RISE = 8.55; // unscaled
const STAIRS_LEN = 8.4;
const STAIRS_WIDTH = 4.4;
const RAISED_BLOCK_HEIGHT = 3;
const PILLAR_HEIGHT = 4.2333;

export interface KitPieces {
  geometries: Map<string, THREE.BufferGeometry>;
  material: THREE.MeshLambertMaterial;
  dispose(): void;
}

/** Loads every GLB the plan needs. Rejects if any single file fails (the caller then falls back). */
export async function loadKit(plan: Plan): Promise<KitPieces> {
  const names = [...new Set(Object.values(plan.kit))];
  const loader = new GLTFLoader();
  const geometries = new Map<string, THREE.BufferGeometry>();
  let material: THREE.MeshLambertMaterial | null = null;
  const sources: THREE.MeshStandardMaterial[] = []; // the GLB materials; replaced by one Lambert material below

  const loadOne = async (name: string) => {
    const gltf = await loader.loadAsync(`${KIT_URL}${name}.glb`);
    gltf.scene.updateMatrixWorld(true);
    let mesh: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
    });
    if (!mesh) throw new Error(`kit: ${name}.glb contains no mesh`);
    const m = mesh as THREE.Mesh;
    // Bake the node transform into the geometry so instance matrices only carry our placement.
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    m.geometry.dispose();
    geometries.set(name, geo);
    sources.push(m.material as THREE.MeshStandardMaterial);
  };

  const disposeAll = () => {
    geometries.forEach((g) => g.dispose());
    new Set(sources.map((s) => s.map)).forEach((tex) => tex?.dispose());
    sources.forEach((s) => s.dispose());
    material?.dispose();
  };

  try {
    await Promise.race([
      Promise.all(names.map(loadOne)),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('kit: load timed out')), LOAD_TIMEOUT_MS)),
    ]);
  } catch (e) {
    disposeAll();
    throw e;
  }
  // Every piece samples the same colormap: one cheap Lambert material (map, color, vertexColors copied) is shared.
  const first = sources[0];
  material = new THREE.MeshLambertMaterial({ map: first.map, color: first.color.clone(), vertexColors: first.vertexColors });
  for (const s of sources.splice(1)) {
    if (s.map && s.map !== first.map) s.map.dispose();
    s.dispose();
  }
  first.dispose(); // the texture stays alive (the Lambert material uses it); disposeAll releases it
  return { geometries, material: material!, dispose: disposeAll };
}

export interface TorchSpot {
  /** Where the point light sits (a little in front of the flame). */
  light: THREE.Vector3;
}

export interface KitBuild {
  group: THREE.Group;
  torches: TorchSpot[];
  chunkCount: number;
  /** Shows only the chunks within `far` (plus their own radius) of the camera. */
  update(camera: THREE.Vector3, far: number): void;
  dispose(): void;
}

const hash = (a: number, b: number, c: number) => {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** The wall a torch cell mounts its torch on (alternates so corridors do not get one-sided), or null. */
export function torchWall(plan: Plan, t: Cell): Dir | null {
  const sides = emptySides(plan, t.r, t.c);
  return sides.length ? sides[(t.r + t.c) % sides.length] : null;
}

export interface KitOptions {
  /** The shared flicker material for torch flames (owned by the caller). */
  flameMaterial: THREE.Material;
  zones: Zones;
}

export function buildKit(plan: Plan, pieces: KitPieces, opts: KitOptions): KitBuild {
  const cs = plan.cell;
  const half = cs / 2;
  const group = new THREE.Group();
  group.name = 'kit';
  const owned: THREE.BufferGeometry[] = [];

  const mats: Record<KitRole, THREE.Matrix4[]> = {
    floor: [], wall: [], wallAlt: [], corner: [], gate: [], stairs: [], pillar: [], raised: [],
  };
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const add = (role: KitRole, x: number, y: number, z: number, rotY: number, sx = 1, sy = 1, sz = 1, rotX = 0) => {
    q.setFromAxisAngle(up, rotY);
    if (rotX) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotX));
    mats[role].push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.clone(), new THREE.Vector3(sx, sy, sz)));
  };

  const doorKey = new Set(plan.doors.map((d) => `${d.r},${d.c}`));
  const stairsKey = new Set<string>();
  plan.stairs.forEach((s) => { stairsKey.add(`${s.bottom.r},${s.bottom.c}`); stairsKey.add(`${s.top.r},${s.top.c}`); });

  for (let r = 0; r < plan.rows; r++) {
    for (let c = 0; c < plan.cols; c++) {
      if (!plan.walkable[r][c]) continue;
      const cx = c * cs;
      const cz = r * cs;

      // Floor and ceiling. A raised cell is a solid block scaled down from the kit's 3 unit platform.
      if (plan.raised[r][c]) add('raised', cx, 0, cz, 0, 1, plan.raise / RAISED_BLOCK_HEIGHT, 1);
      else add('floor', cx, 0, cz, 0);
      add('floor', cx, WALL_HEIGHT, cz, 0, 1, 1, 1, Math.PI); // flipped tile as ceiling

      // One wall on every side that borders empty space.
      const sides = emptySides(plan, r, c);
      for (const d of sides) {
        const { dr, dc, rot } = DIRS[d];
        const alt = hash(r, c, d.charCodeAt(0)) < 0.2;
        const role: KitRole = alt ? 'wallAlt' : 'wall';
        if (plan.wallFace === 'front') {
          // pivot face on the cell edge, body outside the cell
          add(role, cx + dc * half, 0, cz + dr * half, rot);
        } else {
          // flipped: pivot face on the far side, so the back face sits on the cell edge
          add(role, cx + dc * (half + WALL_DEPTH), 0, cz + dr * (half + WALL_DEPTH), rot + Math.PI);
        }
      }

      // Seal the pin-hole at a corner where two walls meet with only a diagonal gap between them.
      for (const sz of [-1, 1] as const) {
        for (const sx of [-1, 1] as const) {
          const sideX = sx > 0 ? 'E' : 'W';
          const sideZ = sz > 0 ? 'S' : 'N';
          if (sides.includes(sideX) && sides.includes(sideZ)) {
            const rot = sx === 1 && sz === 1 ? 0 : sx === -1 && sz === -1 ? Math.PI : sx === 1 ? Math.PI / 2 : -Math.PI / 2;
            add('corner', cx + sx * (half + 1), 0, cz + sz * (half + 1), rot);
          }
        }
      }

      // Gate on door cells, spanning the walkway.
      if (doorKey.has(`${r},${c}`)) {
        const wallsEW = sides.includes('E') && sides.includes('W');
        const wallsNS = sides.includes('N') && sides.includes('S');
        if (!wallsEW && !wallsNS) throw new Error(`layout: door at row ${r}, col ${c} needs walls on two opposite sides`);
        add('gate', cx, plan.height[r][c], cz, wallsEW ? 0 : Math.PI / 2);
      }
    }
  }

  for (const p of plan.pillars) {
    add('pillar', p.c * cs, plan.height[p.r][p.c], p.r * cs, 0, 1, WALL_HEIGHT / PILLAR_HEIGHT, 1);
  }

  for (const s of plan.stairs) {
    const { dr, dc } = DIRS[s.dir];
    const mx = ((s.bottom.c + s.top.c) / 2) * cs;
    const mz = ((s.bottom.r + s.top.r) / 2) * cs;
    const theta = Math.atan2(-dc, -dr); // local -Z (the rising end) points along the stairs direction
    // pivot = centre of the 2-cell span + R * (0, 0, +2 * scaleZ), because the piece spans z in [-6.2, 2.2]
    const sz = (2 * cs) / STAIRS_LEN;
    add('stairs', mx + 2 * sz * Math.sin(theta), 0, mz + 2 * sz * Math.cos(theta), theta, cs / STAIRS_WIDTH, plan.raise / STAIRS_RISE, sz);
  }

  // One InstancedMesh per unique piece and spatial chunk (CHUNK_CELLS x CHUNK_CELLS plan cells), each with a
  // computed bounding sphere. update() hides chunks beyond the fog, so only nearby chunks are drawn.
  const chunks: THREE.InstancedMesh[] = [];
  const chunkSize = CHUNK_CELLS * cs;
  // Per-instance colour: +-KIT_BRIGHTNESS_VARIATION brightness (hashed from the placement, so it is stable)
  // times the zone tint at the instance's z.
  const tmpColor = new THREE.Color();
  const tint = new THREE.Color();
  const instanceColor = (m: THREE.Matrix4, out: THREE.Color) => {
    const e = m.elements;
    const salt = Math.round(e[0] * 100) + 7 * Math.round(e[2] * 100) + 13 * Math.round(e[13] * 10);
    const k = 1 + (hash(Math.round(e[12] * 8), Math.round(e[14] * 8), salt) * 2 - 1) * KIT_BRIGHTNESS_VARIATION;
    return out.copy(opts.zones.tintAt(e[14], tint)).multiplyScalar(k);
  };

  const addChunked = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], colorize = false) => {
    const buckets = new Map<string, THREE.Matrix4[]>();
    for (const m of matrices) {
      const key = `${Math.floor((m.elements[12] + half) / chunkSize)},${Math.floor((m.elements[14] + half) / chunkSize)}`;
      const list = buckets.get(key);
      if (list) list.push(m);
      else buckets.set(key, [m]);
    }
    for (const [key, list] of buckets) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.name = `${name}@${key}`;
      list.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        if (colorize) mesh.setColorAt(i, instanceColor(m, tmpColor));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      chunks.push(mesh);
    }
  };

  const byName = new Map<string, { role: KitRole; matrices: THREE.Matrix4[] }>();
  (Object.keys(mats) as KitRole[]).forEach((role) => {
    if (mats[role].length === 0) return;
    const name = plan.kit[role];
    const entry = byName.get(name) ?? { role, matrices: [] };
    entry.matrices.push(...mats[role]);
    byName.set(name, entry);
  });
  for (const [name, { matrices }] of byName) {
    const geo = pieces.geometries.get(name);
    if (!geo) throw new Error(`kit: piece ${name} was not loaded`);
    addChunked(`kit:${name}`, geo, pieces.material, matrices, true);
  }

  // Torches: no torch in the kit, so a bracket and an emissive flame, instanced.
  const torches: TorchSpot[] = [];
  const bracketGeo = new THREE.BoxGeometry(0.12, 0.6, 0.12).rotateX(0.35).translate(0, 0, 0.2);
  const flameGeo = new THREE.IcosahedronGeometry(0.17, 1).scale(1, 1.5, 1).translate(0, 0.38, 0.32);
  owned.push(bracketGeo, flameGeo);
  const bracketMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1c });
  const flameMat = opts.flameMaterial;
  const torchCells = plan.torches.filter((t) => torchWall(plan, t) !== null);
  if (torchCells.length) {
    const torchMatrices: THREE.Matrix4[] = [];
    torchCells.forEach((t) => {
      const d = torchWall(plan, t)!;
      const { dr, dc, rot } = DIRS[d];
      const y = plan.height[t.r][t.c] + 2.3;
      const x = t.c * cs + dc * (half - 0.1);
      const z = t.r * cs + dr * (half - 0.1);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(up, rot), new THREE.Vector3(1, 1, 1));
      torchMatrices.push(m);
      torches.push({ light: new THREE.Vector3(x - dc * 0.9, y + 0.5, z - dr * 0.9) });
    });
    addChunked('torch-brackets', bracketGeo, bracketMat, torchMatrices);
    addChunked('torch-flames', flameGeo, flameMat, torchMatrices);
  }

  const toCamera = new THREE.Vector3();
  return {
    group,
    torches,
    chunkCount: chunks.length,
    update(camera: THREE.Vector3, far: number) {
      for (const mesh of chunks) {
        const s = mesh.boundingSphere!;
        const reach = far + s.radius;
        mesh.visible = toCamera.copy(s.center).sub(camera).lengthSq() <= reach * reach;
      }
    },
    dispose() {
      chunks.forEach((mesh) => mesh.dispose());
      owned.forEach((g) => g.dispose());
      bracketMat.dispose();
      pieces.dispose();
    },
  };
}
