import * as THREE from 'three';
import { createQuality } from './quality';
import type { BannerLabel } from './signs';
import { pathDistance } from './scatter';
import { loadNatureKit, type NatureAsset, type NatureKit, type NatureProgress } from './nature';
import * as L from './look';

export interface World {
  /** Draw one frame for a 0-1 progress value. Call only when progress or size changed. */
  render(progress: number): void;
  resize(): void;
  /** Text for the decorative stop banners (kit world only). Safe to call at any time, repeatedly. */
  setLabels?(labels: BannerLabel[]): void;
  dispose(): void;
}

export interface CreateWorldOptions {
  onProgress?: NatureProgress;
}

const WAYPOINTS = [
  [0, 2.2, 10],
  [1, 2.0, -8],
  [-3, 2.4, -26],
  [-5, 2.0, -44],
  [-1, 2.6, -62],
  [4, 2.2, -80],
  [3, 2.8, -98],
  [0, 3.2, -118],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));

/** Deterministic PRNG so the world is identical every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function varyColor(base: number, rand: () => number, amount = L.TREE_COLOR_VAR): THREE.Color {
  const c = new THREE.Color(base);
  const k = 1 + (rand() * 2 - 1) * amount;
  return c.multiplyScalar(k);
}

function varyScale(base: number, rand: () => number, amount = L.TREE_SCALE_VAR): number {
  return base * (1 + (rand() * 2 - 1) * amount);
}

function gradientSky(): THREE.CanvasTexture {
  const W = 1024;
  const H = 640;
  const FOG = '#343262'; // must equal WORLD_FOG_COLOR in look.ts
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0b1030');
  grad.addColorStop(0.25, '#151a48');
  grad.addColorStop(0.42, FOG);
  grad.addColorStop(1, FOG);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  let seed = 12345;
  const rnd = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // stars, fading out toward the horizon
  g.fillStyle = '#e8ecff';
  for (let i = 0; i < 170; i++) {
    const x = rnd() * W;
    const y = rnd() * H * 0.36;
    g.globalAlpha = (0.35 + rnd() * 0.65) * (1 - y / (H * 0.4));
    g.beginPath();
    g.arc(x, y, 0.5 + rnd() * 1.1, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // moon with a soft glow
  const mx = W * 0.74;
  const my = H * 0.16;
  const glow = g.createRadialGradient(mx, my, 0, mx, my, 130);
  glow.addColorStop(0, 'rgba(190,200,255,0.45)');
  glow.addColorStop(0.25, 'rgba(150,160,240,0.18)');
  glow.addColorStop(1, 'rgba(120,130,220,0)');
  g.fillStyle = glow;
  g.fillRect(mx - 130, my - 130, 260, 260);
  g.fillStyle = '#eef1ff';
  g.beginPath();
  g.arc(mx, my, 22, 0, Math.PI * 2);
  g.fill();

  // two layers of distant hills that fade into the fog colour at their base
  const hill = (base: number, amp: number, f1: number, f2: number, p1: number, p2: number, top: string) => {
    const gr = g.createLinearGradient(0, base - amp, 0, base + 8);
    gr.addColorStop(0, top);
    gr.addColorStop(1, FOG);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const n = (Math.sin(x * f1 + p1) * 0.6 + Math.sin(x * f2 + p2) * 0.4 + 1) / 2;
      g.lineTo(x, base - amp * n);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  };
  hill(H * 0.5, H * 0.09, 0.006, 0.017, 1.3, 4.1, '#2a2960');
  hill(H * 0.52, H * 0.06, 0.009, 0.025, 2.7, 0.6, '#212056');

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function softDisc(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.45, '#888');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function cloudTexture(rand: () => number): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 22; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 30 + rand() * 48;
    const a = 0.2 + rand() * 0.28;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cx = x + ox * size;
        const cy = y + oy * size;
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

type ProcKind =
  | 'pineTrunk'
  | 'pineCrown'
  | 'decidTrunk'
  | 'decidCrown'
  | 'birchTrunk'
  | 'birchCrown'
  | 'rock'
  | 'bush'
  | 'grass'
  | 'fern'
  | 'flower'
  | 'mushStem'
  | 'mushCap'
  | 'stump'
  | 'log';

interface ProcPlacement {
  kind: ProcKind;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
  rx?: number;
  rz?: number;
  color: THREE.Color;
}

interface KitPlacement {
  asset: NatureAsset;
  x: number;
  y: number;
  z: number;
  scale: number;
  ry: number;
}

/**
 * Build the outdoor world. Tries the curated nature GLBs first; on any failure or >12s timeout,
 * logs a warning and falls back to the procedural primitive forest.
 */
export async function createWorld(canvas: HTMLCanvasElement, opts: CreateWorldOptions = {}): Promise<World> {
  let kit: NatureKit | null = null;
  try {
    kit = await loadNatureKit(opts.onProgress);
  } catch (err) {
    console.warn('[world] nature kit unavailable, using procedural forest:', err);
    kit = null;
  }
  return buildWorld(canvas, kit);
}

function buildWorld(canvas: HTMLCanvasElement, kit: NatureKit | null): World {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, L.DPR_CAP);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = L.SHADOW_MAPS;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = gradientSky();
  scene.fog = new THREE.Fog(L.WORLD_FOG_COLOR, L.WORLD_FOG_NEAR, L.WORLD_FOG_FAR);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 220);
  const curve = new THREE.CatmullRomCurve3(WAYPOINTS, false, 'catmullrom', 0.5);

  const pathCore = curve.getSpacedPoints(360);
  const endPt = curve.getPointAt(1);
  const endTan = curve.getTangentAt(1).normalize();
  const pathPts: THREE.Vector3[] = [...pathCore];
  for (let d = 2; d <= L.PATH_EXTEND; d += 2) {
    pathPts.push(endPt.clone().addScaledVector(endTan, d));
  }
  const distToPath = pathDistance(pathPts);

  const campfire = endPt.clone().addScaledVector(endTan, 6);
  campfire.y = 0;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pathPts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }

  scene.add(new THREE.HemisphereLight(0x8fa0e0, 0x1c2a3a, 1.2));
  const sun = new THREE.DirectionalLight(0xa9b8ff, 1.3);
  scene.add(sun, sun.target);
  const fireLight = new THREE.PointLight(L.CAMPFIRE_LIGHT_COLOR, L.CAMPFIRE_LIGHT_INTENSITY, L.CAMPFIRE_LIGHT_DISTANCE, 2);
  fireLight.position.set(campfire.x, 1.15, campfire.z);
  scene.add(fireLight);

  const rand = rng(L.WORLD_SEED);
  const occupied: { x: number; z: number; r: number }[] = [];
  const claim = (x: number, z: number, r: number) => occupied.push({ x, z, r });
  const free = (x: number, z: number, r: number, clearance = L.PATH_CLEARANCE) =>
    distToPath(x, z) >= clearance + r &&
    Math.hypot(x - campfire.x, z - campfire.z) >= L.CAMPFIRE_CLEARING + r &&
    occupied.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + r);

  /** Sideways scatter along the extended path. `preferFar` biases acceptance toward the outer band. */
  const scatterSpot = (
    minOff: number,
    maxOff: number,
    radius: number,
    preferFar = false,
    tries = 28,
  ): { x: number; z: number; dist: number } | null => {
    const off0 = Math.max(minOff, L.PATH_CLEARANCE + radius);
    for (let t = 0; t < tries; t++) {
      const p = pathPts[(rand() * pathPts.length) | 0];
      const side = rand() < 0.5 ? -1 : 1;
      const along = (rand() - 0.5) * 5;
      const off = off0 + rand() * Math.max(0.01, maxOff - off0);
      const x = p.x + side * off + (rand() - 0.5) * 2;
      const z = p.z + along;
      if (!free(x, z, radius, L.PATH_CLEARANCE)) continue;
      const dist = distToPath(x, z);
      if (preferFar) {
        const tOff = (dist - off0) / Math.max(0.01, maxOff - off0);
        if (rand() > 0.28 + 0.72 * Math.min(1, Math.max(0, tOff))) continue;
      }
      return { x, z, dist };
    }
    return null;
  };

  const disposables: { dispose(): void }[] = [];
  const chunkGroups: THREE.Group[] = [];
  const chunkSpheres: THREE.Sphere[] = [];
  let propCount = 0;

  // ---- vegetation -------------------------------------------------------------------------------------
  if (kit) {
    const kitPlacements: KitPlacement[] = [];
    const pickAsset = (role: NatureAsset['role']) => {
      const list = kit.byRole.get(role);
      if (!list?.length) return null;
      return list[(rand() * list.length) | 0];
    };

    const placeKit = (role: NatureAsset['role'], count: number, minOff: number, maxOff: number, radius: number, preferFar = false) => {
      let n = 0;
      let guard = 0;
      while (n < count && guard++ < count * 40) {
        const asset = pickAsset(role);
        if (!asset) break;
        const spot = scatterSpot(minOff, maxOff, radius, preferFar);
        if (!spot) continue;
        claim(spot.x, spot.z, radius + 0.2);
        const scale = varyScale(asset.targetHeight / Math.max(0.05, asset.height), rand, L.TREE_SCALE_VAR);
        kitPlacements.push({ asset, x: spot.x, y: 0, z: spot.z, scale, ry: rand() * Math.PI * 2 });
        n++;
      }
      return n;
    };

    // Trees mostly 6–45 from the curve, denser farther out, clear 3-unit corridor.
    placeKit('tree-conifer', L.COUNTS.kitConifer, 6, 45, 1.1, true);
    placeKit('tree-round', L.COUNTS.kitRound, 6, 45, 1.1, true);
    placeKit('tree-birch', L.COUNTS.kitBirch, 6, 42, 0.9, true);
    // Undergrowth nearer the path.
    placeKit('bush', L.COUNTS.kitBush, 3.2, 18, 0.45, false);
    placeKit('plant', L.COUNTS.kitPlant, 3.1, 14, 0.2, false);
    placeKit('grass', L.COUNTS.kitGrass, 3.05, 12, 0.12, false);
    placeKit('rock', L.COUNTS.kitRock, 3.2, 20, 0.35, false);
    placeKit('log', L.COUNTS.kitLog, 5, 28, 0.55, false);

    for (const p of kitPlacements) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    propCount = kitPlacements.length;

    minX = Math.min(minX, campfire.x) - L.GROUND_MARGIN;
    maxX = Math.max(maxX, campfire.x) + L.GROUND_MARGIN;
    minZ = Math.min(minZ, campfire.z) - L.GROUND_MARGIN;
    maxZ = Math.max(maxZ, campfire.z) + L.GROUND_MARGIN;

    // Spatial chunks (~30×30) with bounding spheres.
    const cell = L.CHUNK_SIZE;
    type Bucket = { placements: KitPlacement[]; minX: number; maxX: number; minZ: number; maxZ: number };
    const buckets = new Map<string, Bucket>();
    for (const p of kitPlacements) {
      const cx = Math.floor(p.x / cell);
      const cz = Math.floor(p.z / cell);
      const key = `${cx},${cz}`;
      let b = buckets.get(key);
      if (!b) {
        b = { placements: [], minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        buckets.set(key, b);
      }
      b.placements.push(p);
      b.minX = Math.min(b.minX, p.x);
      b.maxX = Math.max(b.maxX, p.x);
      b.minZ = Math.min(b.minZ, p.z);
      b.maxZ = Math.max(b.maxZ, p.z);
    }

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pv = new THREE.Vector3();
    const sv = new THREE.Vector3();

    for (const b of buckets.values()) {
      const g = new THREE.Group();
      g.name = 'nature-chunk';
      const byAsset = new Map<NatureAsset, KitPlacement[]>();
      for (const p of b.placements) {
        const list = byAsset.get(p.asset) ?? [];
        list.push(p);
        byAsset.set(p.asset, list);
      }
      let maxR = 2;
      for (const [asset, list] of byAsset) {
        const mesh = new THREE.InstancedMesh(asset.geometry, kit.material, list.length);
        mesh.frustumCulled = true;
        list.forEach((p, i) => {
          e.set(0, p.ry, 0, 'XYZ');
          q.setFromEuler(e);
          m4.compose(pv.set(p.x, p.y, p.z), q, sv.set(p.scale, p.scale, p.scale));
          mesh.setMatrixAt(i, m4);
          maxR = Math.max(maxR, asset.targetHeight * 0.7 * p.scale);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        g.add(mesh);
      }
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const extent = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + maxR;
      chunkGroups.push(g);
      chunkSpheres.push(new THREE.Sphere(new THREE.Vector3(cx, 0, cz), Math.max(extent, cell * 0.7)));
      scene.add(g);
    }
  } else {
    // ---- procedural fallback --------------------------------------------------------------------------
    const placements: ProcPlacement[] = [];
    const push = (p: ProcPlacement) => placements.push(p);

    const placePine = (x: number, z: number, s: number, ry: number) => {
      const trunk = varyColor(L.TREE_COLORS.pineTrunk, rand);
      const needle = varyColor(L.TREE_COLORS.pineNeedle, rand);
      push({ kind: 'pineTrunk', x, y: 0.7 * s, z, sx: 0.18 * s, sy: 1.4 * s, sz: 0.18 * s, ry, color: trunk });
      for (let i = 0; i < 3; i++) {
        const cs = (1.15 - i * 0.22) * s;
        push({ kind: 'pineCrown', x, y: (1.35 + i * 0.85) * s, z, sx: cs, sy: 1.35 * s, sz: cs, ry, color: needle });
      }
    };
    const placeDeciduous = (x: number, z: number, s: number, ry: number) => {
      push({
        kind: 'decidTrunk',
        x,
        y: 0.85 * s,
        z,
        sx: 0.2 * s,
        sy: 1.7 * s,
        sz: 0.2 * s,
        ry,
        color: varyColor(L.TREE_COLORS.deciduousTrunk, rand),
      });
      push({
        kind: 'decidCrown',
        x,
        y: 2.35 * s,
        z,
        sx: 1.35 * s,
        sy: 1.2 * s,
        sz: 1.35 * s,
        ry,
        color: varyColor(L.TREE_COLORS.deciduousLeaf, rand),
      });
    };
    const placeBirch = (x: number, z: number, s: number, ry: number) => {
      push({
        kind: 'birchTrunk',
        x,
        y: 1.35 * s,
        z,
        sx: 0.11 * s,
        sy: 2.7 * s,
        sz: 0.11 * s,
        ry,
        color: varyColor(L.TREE_COLORS.birchTrunk, rand),
      });
      push({
        kind: 'birchCrown',
        x,
        y: 3.15 * s,
        z,
        sx: 0.7 * s,
        sy: 1.55 * s,
        sz: 0.7 * s,
        ry,
        color: varyColor(L.TREE_COLORS.birchLeaf, rand),
      });
    };

    const plantTrees = (count: number, place: (x: number, z: number, s: number, ry: number) => void) => {
      let n = 0;
      let guard = 0;
      while (n < count && guard++ < count * 40) {
        const spot = scatterSpot(6, 45, 0.8, true);
        if (!spot) continue;
        claim(spot.x, spot.z, 1.1);
        place(spot.x, spot.z, varyScale(1, rand), rand() * Math.PI * 2);
        n++;
      }
    };
    plantTrees(L.COUNTS.pine, placePine);
    plantTrees(L.COUNTS.deciduous, placeDeciduous);
    plantTrees(L.COUNTS.birch, placeBirch);

    let rocks = 0;
    while (rocks < L.COUNTS.rocks) {
      const spot = scatterSpot(3.2, 22, 0.35);
      if (!spot) break;
      claim(spot.x, spot.z, 0.45);
      const s = varyScale(0.55, rand, L.PROP_SCALE_VAR);
      push({
        kind: 'rock',
        x: spot.x,
        y: 0.22 * s,
        z: spot.z,
        sx: s * (0.7 + rand() * 0.5),
        sy: s * (0.45 + rand() * 0.4),
        sz: s * (0.7 + rand() * 0.5),
        ry: rand() * Math.PI * 2,
        rx: rand() * 0.6,
        rz: rand() * 0.6,
        color: varyColor(L.PROP_COLORS_OUTDOOR.rock[(rand() * L.PROP_COLORS_OUTDOOR.rock.length) | 0], rand),
      });
      rocks++;
    }

    for (let i = 0; i < L.COUNTS.bushes; i++) {
      const spot = scatterSpot(3.2, 18, 0.4);
      if (!spot) continue;
      claim(spot.x, spot.z, 0.5);
      const s = varyScale(0.7, rand, L.PROP_SCALE_VAR);
      push({
        kind: 'bush',
        x: spot.x,
        y: 0.35 * s,
        z: spot.z,
        sx: s * 1.1,
        sy: s * 0.7,
        sz: s * 1.1,
        ry: rand() * Math.PI * 2,
        color: varyColor(L.PROP_COLORS_OUTDOOR.bush[(rand() * L.PROP_COLORS_OUTDOOR.bush.length) | 0], rand),
      });
    }

    for (let i = 0; i < L.COUNTS.grass; i++) {
      const spot = scatterSpot(3.05, 12, 0.12);
      if (!spot) continue;
      const s = varyScale(0.35, rand, L.PROP_SCALE_VAR);
      push({
        kind: 'grass',
        x: spot.x,
        y: 0.22 * s,
        z: spot.z,
        sx: 0.12 * s,
        sy: 0.45 * s,
        sz: 0.12 * s,
        ry: rand() * Math.PI * 2,
        color: varyColor(L.PROP_COLORS_OUTDOOR.grass[(rand() * L.PROP_COLORS_OUTDOOR.grass.length) | 0], rand),
      });
    }

    for (let i = 0; i < L.COUNTS.flowers; i++) {
      const spot = scatterSpot(3.1, 14, 0.1);
      if (!spot) continue;
      const s = varyScale(0.18, rand, L.PROP_SCALE_VAR);
      push({
        kind: 'flower',
        x: spot.x,
        y: 0.2 * s + 0.12,
        z: spot.z,
        sx: s,
        sy: s,
        sz: s,
        ry: rand() * Math.PI * 2,
        color: varyColor(L.PROP_COLORS_OUTDOOR.flower[(rand() * 3) | 0], rand),
      });
    }

    for (let i = 0; i < L.COUNTS.stumps; i++) {
      const spot = scatterSpot(5, 28, 0.4);
      if (!spot) continue;
      claim(spot.x, spot.z, 0.5);
      const s = varyScale(0.7, rand, L.PROP_SCALE_VAR);
      push({
        kind: 'stump',
        x: spot.x,
        y: 0.22 * s,
        z: spot.z,
        sx: 0.35 * s,
        sy: 0.45 * s,
        sz: 0.35 * s,
        ry: rand() * Math.PI * 2,
        color: varyColor(L.PROP_COLORS_OUTDOOR.stump, rand),
      });
    }

    for (let i = 0; i < L.COUNTS.logs; i++) {
      const spot = scatterSpot(5, 28, 0.6);
      if (!spot) continue;
      claim(spot.x, spot.z, 0.7);
      const s = varyScale(1, rand, L.PROP_SCALE_VAR);
      push({
        kind: 'log',
        x: spot.x,
        y: 0.18 * s,
        z: spot.z,
        sx: 0.2 * s,
        sy: 1.6 * s,
        sz: 0.2 * s,
        ry: rand() * Math.PI * 2,
        rz: Math.PI / 2,
        color: varyColor(L.PROP_COLORS_OUTDOOR.log, rand),
      });
    }

    for (const p of placements) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    propCount = placements.length;
    minX = Math.min(minX, campfire.x) - L.GROUND_MARGIN;
    maxX = Math.max(maxX, campfire.x) + L.GROUND_MARGIN;
    minZ = Math.min(minZ, campfire.z) - L.GROUND_MARGIN;
    maxZ = Math.max(maxZ, campfire.z) + L.GROUND_MARGIN;

    const geos: Record<ProcKind, THREE.BufferGeometry> = {
      pineTrunk: new THREE.CylinderGeometry(1, 1.15, 1, 5),
      pineCrown: new THREE.ConeGeometry(1, 1, 6),
      decidTrunk: new THREE.CylinderGeometry(1, 1.2, 1, 5),
      decidCrown: new THREE.IcosahedronGeometry(1, 0),
      birchTrunk: new THREE.CylinderGeometry(1, 1.05, 1, 5),
      birchCrown: new THREE.IcosahedronGeometry(1, 0),
      rock: new THREE.IcosahedronGeometry(1, 0),
      bush: new THREE.IcosahedronGeometry(1, 0),
      grass: new THREE.ConeGeometry(1, 1, 4),
      fern: new THREE.ConeGeometry(1, 1, 4),
      flower: new THREE.SphereGeometry(1, 5, 4),
      mushStem: new THREE.CylinderGeometry(1, 1, 1, 5),
      mushCap: new THREE.SphereGeometry(1, 6, 4),
      stump: new THREE.CylinderGeometry(1, 1.15, 1, 6),
      log: new THREE.CylinderGeometry(1, 1, 1, 6),
    };
    Object.values(geos).forEach((g) => disposables.push(g));
    const lit = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true });
    disposables.push(lit);

    const cell = L.CHUNK_SIZE;
    type Bucket = { list: ProcPlacement[]; minX: number; maxX: number; minZ: number; maxZ: number };
    const buckets = new Map<string, Bucket>();
    for (const p of placements) {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      let b = buckets.get(key);
      if (!b) {
        b = { list: [], minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        buckets.set(key, b);
      }
      b.list.push(p);
      b.minX = Math.min(b.minX, p.x);
      b.maxX = Math.max(b.maxX, p.x);
      b.minZ = Math.min(b.minZ, p.z);
      b.maxZ = Math.max(b.maxZ, p.z);
    }

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pv = new THREE.Vector3();
    const sv = new THREE.Vector3();
    const kinds = Object.keys(geos) as ProcKind[];

    for (const b of buckets.values()) {
      const g = new THREE.Group();
      const lists = Object.fromEntries(kinds.map((k) => [k, [] as ProcPlacement[]])) as Record<ProcKind, ProcPlacement[]>;
      for (const p of b.list) lists[p.kind].push(p);
      for (const kind of kinds) {
        const list = lists[kind];
        if (!list.length) continue;
        const mesh = new THREE.InstancedMesh(geos[kind], lit, list.length);
        mesh.frustumCulled = true;
        list.forEach((p, i) => {
          e.set(p.rx ?? 0, p.ry, p.rz ?? 0, 'XYZ');
          q.setFromEuler(e);
          m4.compose(pv.set(p.x, p.y, p.z), q, sv.set(p.sx, p.sy, p.sz));
          mesh.setMatrixAt(i, m4);
          mesh.setColorAt(i, p.color);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        g.add(mesh);
      }
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const extent = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 4;
      chunkGroups.push(g);
      chunkSpheres.push(new THREE.Sphere(new THREE.Vector3(cx, 0, cz), Math.max(extent, cell * 0.7)));
      scene.add(g);
    }
  }

  const groundW = maxX - minX;
  const groundD = maxZ - minZ;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundW, groundD),
    new THREE.MeshLambertMaterial({ color: 0x3a5f55 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  scene.add(ground);
  disposables.push(ground.geometry, ground.material as THREE.Material);

  // ---- campfire clearing ------------------------------------------------------------------------------
  const campGroup = new THREE.Group();
  campGroup.name = 'campfire';
  const flameMat = new THREE.MeshStandardMaterial({
    color: L.CAMPFIRE_FLAME_COLOR,
    emissive: L.CAMPFIRE_FLAME_COLOR,
    emissiveIntensity: 2.2,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  disposables.push(flameMat);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pv = new THREE.Vector3();
  const sv = new THREE.Vector3();

  const logAsset = kit?.byRole.get('log')?.[0] ?? null;
  let campLogs: THREE.InstancedMesh;
  if (logAsset) {
    campLogs = new THREE.InstancedMesh(logAsset.geometry, kit!.material, 5);
    const baseScale = (logAsset.targetHeight / Math.max(0.05, logAsset.height)) * 0.55;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      e.set(0, a, Math.PI / 2.4, 'XYZ');
      q.setFromEuler(e);
      m4.compose(
        pv.set(campfire.x + Math.cos(a) * 0.35, 0.05, campfire.z + Math.sin(a) * 0.35),
        q,
        sv.set(baseScale, baseScale, baseScale),
      );
      campLogs.setMatrixAt(i, m4);
    }
  } else {
    const campLogGeo = new THREE.CylinderGeometry(0.12, 0.14, 1.1, 5);
    disposables.push(campLogGeo);
    const lit = new THREE.MeshLambertMaterial({ color: 0x5a3d28 });
    disposables.push(lit);
    campLogs = new THREE.InstancedMesh(campLogGeo, lit, 5);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      e.set(0, a, Math.PI / 2, 'XYZ');
      q.setFromEuler(e);
      m4.compose(
        pv.set(campfire.x + Math.cos(a) * 0.15, 0.12, campfire.z + Math.sin(a) * 0.15),
        q,
        sv.set(1, 1, 1),
      );
      campLogs.setMatrixAt(i, m4);
    }
  }
  campLogs.instanceMatrix.needsUpdate = true;
  campGroup.add(campLogs);

  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 5), flameMat);
  flame.position.set(campfire.x, 0.55, campfire.z);
  campGroup.add(flame);
  disposables.push(flame.geometry);

  // Clearing ring of rocks (kit or procedural).
  const rockAsset = kit?.byRole.get('rock')?.[0] ?? null;
  if (rockAsset && kit) {
    const stones = new THREE.InstancedMesh(rockAsset.geometry, kit.material, 7);
    const rs0 = rockAsset.targetHeight / Math.max(0.05, rockAsset.height);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      const s = rs0 * (0.35 + (i % 3) * 0.08);
      e.set(0, rand() * Math.PI, 0, 'XYZ');
      q.setFromEuler(e);
      m4.compose(
        pv.set(campfire.x + Math.cos(a) * 1.35, 0, campfire.z + Math.sin(a) * 1.35),
        q,
        sv.set(s, s * 0.75, s),
      );
      stones.setMatrixAt(i, m4);
    }
    stones.instanceMatrix.needsUpdate = true;
    campGroup.add(stones);
  }

  // Optional props around the clearing (tent / fence / statue) when the pack provides them.
  const props = kit?.byRole.get('prop') ?? [];
  props.slice(0, 3).forEach((asset: any, i: number) => {
    const mesh = new THREE.Mesh(asset.geometry, kit!.material);
    const s = asset.targetHeight / Math.max(0.05, asset.height);
    const a = -0.6 + i * 0.7;
    mesh.position.set(campfire.x + Math.cos(a) * 3.2, 0, campfire.z + Math.sin(a) * 3.2 - 1.2);
    mesh.rotation.y = a + Math.PI;
    mesh.scale.setScalar(s);
    campGroup.add(mesh);
  });

  scene.add(campGroup);

  // ---- atmosphere -------------------------------------------------------------------------------------
  const atmoGroup = new THREE.Group();
  atmoGroup.name = 'atmosphere';

  const flySeeds = new Float32Array(L.COUNTS.fireflies * 4);
  for (let i = 0; i < flySeeds.length; i++) flySeeds[i] = rand();
  const flyGeo = new THREE.BufferGeometry();
  flyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(L.COUNTS.fireflies * 3), 3));
  flyGeo.setAttribute('aSeed', new THREE.BufferAttribute(flySeeds, 4));
  disposables.push(flyGeo);
  const flyUniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(22, 5, 26) },
    uSize: { value: L.FIREFLY_SIZE },
    uPx: { value: 600 },
    uDrift: { value: L.FIREFLY_DRIFT },
    uPulse: { value: L.FIREFLY_PULSE },
    uOpacity: { value: L.FIREFLY_OPACITY },
    uMotion: { value: 1 },
  };
  const flyMat = new THREE.ShaderMaterial({
    uniforms: flyUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCam; uniform vec3 uBox;
      uniform float uSize; uniform float uPx; uniform float uDrift; uniform float uPulse; uniform float uMotion;
      attribute vec4 aSeed;
      varying float vA;
      void main() {
        vec3 p = aSeed.xyz * uBox;
        float t = uTime * uMotion;
        p.x += sin(t * 0.27 + aSeed.w * 6.283) * uDrift;
        p.z += cos(t * 0.21 + aSeed.w * 5.1) * uDrift;
        p.y += sin(t * 0.33 + aSeed.w * 8.2) * uDrift * 0.45;
        vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
        rel.y = clamp(rel.y, -1.2, 3.5);
        float pulse = 0.55 + 0.45 * sin(t * 1.7 + aSeed.w * 40.0) * uPulse;
        if (uMotion < 0.5) pulse = 0.85;
        vA = pulse;
        vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * uPx / max(-mv.z, 0.1), 1.0, 12.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vA;
      void main() {
        float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(1.0, 0.95, 0.55, a * a * vA * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  disposables.push(flyMat);
  const fireflies = new THREE.Points(flyGeo, flyMat);
  fireflies.frustumCulled = false;
  atmoGroup.add(fireflies);

  const shaftGeo = new THREE.ConeGeometry(1, 1, 16, 1, true).translate(0, -0.5, 0);
  disposables.push(shaftGeo);
  const shaftPos = shaftGeo.getAttribute('position');
  const shaftCols = new Float32Array(shaftPos.count * 3);
  for (let i = 0; i < shaftPos.count; i++) shaftCols.fill(shaftPos.getY(i) > -0.01 ? 1 : 0, i * 3, i * 3 + 3);
  shaftGeo.setAttribute('color', new THREE.BufferAttribute(shaftCols, 3));
  const shaftMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(L.SHAFT_COLOR_OUTDOOR).multiplyScalar(L.SHAFT_STRENGTH_OUTDOOR),
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  disposables.push(shaftMat);
  const shafts = new THREE.InstancedMesh(shaftGeo, shaftMat, L.COUNTS.lightShafts);
  {
    const m = new THREE.Matrix4();
    for (let i = 0; i < L.COUNTS.lightShafts; i++) {
      const t = 0.25 + (i / Math.max(1, L.COUNTS.lightShafts - 1)) * 0.7;
      const p = t >= 1 ? campfire.clone() : curve.getPointAt(Math.min(t, 0.98));
      const side = i % 2 ? 1 : -1;
      const x = p.x + side * (6 + (i % 3));
      const z = i === L.COUNTS.lightShafts - 1 ? campfire.z - 2 : p.z;
      const h = 9 + (i % 3);
      m.compose(
        new THREE.Vector3(x, h, z),
        new THREE.Quaternion(),
        new THREE.Vector3(L.SHAFT_RADIUS_OUTDOOR * (0.8 + (i % 3) * 0.15), h, L.SHAFT_RADIUS_OUTDOOR * (0.8 + (i % 3) * 0.15)),
      );
      shafts.setMatrixAt(i, m);
    }
    shafts.instanceMatrix.needsUpdate = true;
    shafts.computeBoundingSphere();
  }
  atmoGroup.add(shafts);

  const mistCloud = cloudTexture(rand);
  const mistFade = softDisc();
  disposables.push(mistCloud, mistFade);
  const mistMat = new THREE.MeshBasicMaterial({
    map: mistCloud,
    alphaMap: mistFade,
    transparent: true,
    opacity: L.MIST_OPACITY_OUTDOOR,
    depthWrite: false,
    color: L.MIST_COLOR_OUTDOOR,
  });
  disposables.push(mistMat);
  const mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mistMat, L.COUNTS.mistPlanes);
  disposables.push(mist.geometry);
  {
    const m = new THREE.Matrix4();
    for (let i = 0; i < L.COUNTS.mistPlanes; i++) {
      const t = i / Math.max(1, L.COUNTS.mistPlanes - 1);
      const p = t > 0.92 ? campfire : curve.getPointAt(t * 0.95);
      const size = L.MIST_SIZE_OUTDOOR[0] + rand() * (L.MIST_SIZE_OUTDOOR[1] - L.MIST_SIZE_OUTDOOR[0]);
      m.compose(
        new THREE.Vector3(p.x + (rand() - 0.5) * 8, L.MIST_LIFT_OUTDOOR + i * 0.02, p.z + (rand() - 0.5) * 4),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI),
        new THREE.Vector3(size, 1, size),
      );
      mist.setMatrixAt(i, m);
    }
    mist.instanceMatrix.needsUpdate = true;
    mist.computeBoundingSphere();
  }
  atmoGroup.add(mist);
  scene.add(atmoGroup);

  // ---- camera / motion --------------------------------------------------------------------------------
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motion = !reducedQuery.matches;
  fireflies.visible = motion;
  let clock = 0;
  let lastTime = performance.now();
  let lastProgress = 0;
  let lastDrawAt = 0;
  let disposed = false;

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  const quality = createQuality({
    currentPixelRatio: () => pixelRatio,
    dropPixelRatio: () => {
      pixelRatio = 1;
      renderer.setPixelRatio(1);
      resize();
    },
    disablePost: () => {},
  });

  const fogFar = L.WORLD_FOG_FAR;
  const updateChunks = () => {
    for (let i = 0; i < chunkGroups.length; i++) {
      const sph = chunkSpheres[i];
      chunkGroups[i].visible = camera.position.distanceTo(sph.center) - sph.radius <= fogFar;
    }
  };

  const draw = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    lastDrawAt = now;
    if (motion) clock += dt;

    const p = Math.min(Math.max(lastProgress, 0), 1);
    curve.getPointAt(p, pos);
    if (p < 0.92) {
      curve.getPointAt(Math.min(p + 0.02, 1), look);
    } else {
      const w = THREE.MathUtils.smoothstep(p, 0.92, 1);
      curve.getPointAt(Math.min(p + 0.02, 1), look);
      look.lerp(new THREE.Vector3(campfire.x, 0.7, campfire.z), w);
    }
    camera.position.copy(pos);
    camera.lookAt(look);

    sun.position.set(pos.x + 25, 40, pos.z + 15);
    sun.target.position.set(pos.x, 0, pos.z - 10);

    if (motion) {
      const flick = 0.85 + 0.2 * Math.sin(clock * 9.3) + 0.1 * Math.sin(clock * 17.1);
      flame.scale.set(0.9 + 0.15 * flick, flick, 0.9 + 0.12 * flick);
      flameMat.emissiveIntensity = 1.6 + 1.1 * flick;
      fireLight.intensity = L.CAMPFIRE_LIGHT_INTENSITY * (0.75 + 0.35 * flick);
      mistCloud.offset.x = (mistCloud.offset.x + L.MIST_SCROLL_OUTDOOR * dt) % 1;
    } else {
      flame.scale.set(1, 1, 1);
      flameMat.emissiveIntensity = 2.0;
      fireLight.intensity = L.CAMPFIRE_LIGHT_INTENSITY;
    }

    flyUniforms.uTime.value = clock;
    flyUniforms.uCam.value.copy(camera.position);
    flyUniforms.uPx.value = (canvas.clientHeight || window.innerHeight) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    flyUniforms.uMotion.value = motion ? 1 : 0;

    updateChunks();

    renderer.info.reset();
    renderer.render(scene, camera);
    quality.frame(now);
  };

  let rafId = 0;
  let onScreen = true;
  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          onScreen = entries[entries.length - 1].isIntersecting;
        })
      : null;
  io?.observe(canvas);
  if (L.AMBIENT_FPS > 0) {
    const interval = 1000 / L.AMBIENT_FPS;
    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (!motion || !onScreen || document.hidden || now - lastDrawAt < interval - 2) return;
      draw();
    };
    rafId = requestAnimationFrame(tick);
  }
  const onMotionChange = () => {
    motion = !reducedQuery.matches;
    fireflies.visible = motion;
    draw();
  };
  reducedQuery.addEventListener('change', onMotionChange);

  let perf: { onDraw(): void; dispose(): void } | null = null;
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('perf') === '1') {
      import('./perf').then(({ attachPerf }) => {
        if (disposed) return;
        perf = attachPerf(renderer, scene, quality);
      });
    }
  }

  draw();
  if (import.meta.env.DEV) {
    const { calls, triangles } = renderer.info.render;
    const stats = {
      mode: kit ? 'nature' : 'procedural',
      drawCalls: calls,
      triangles,
      lights: 3,
      chunks: chunkGroups.length,
      props: propCount,
      models: kit?.assets.length ?? 0,
      missingRoles: kit?.missingRoles ?? [],
    };
    (window as unknown as { __worldStats?: typeof stats }).__worldStats = stats;
    console.info(
      `[world] ${stats.mode} draw calls ${calls}/${L.MAX_DRAW_CALLS}, triangles ${triangles}, lights 3/${L.MAX_DYNAMIC_LIGHTS}, chunks ${chunkGroups.length}, props ${propCount}`,
    );
  }

  return {
    resize,
    render(progress) {
      lastProgress = Math.min(Math.max(progress, 0), 1);
      draw();
      perf?.onDraw();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      io?.disconnect();
      reducedQuery.removeEventListener('change', onMotionChange);
      perf?.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      disposables.forEach((d) => d.dispose());
      kit?.dispose();
      (scene.background as THREE.Texture).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
