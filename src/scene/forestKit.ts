import * as THREE from 'three';
import * as L from './look';

/**
 * Procedural low-poly forest pieces. Every kind is ONE merged geometry with baked vertex colours, so a kind
 * costs one draw call per chunk (the old pine took two kinds: trunk + crown). world.ts multiplies the
 * vertex colours by a per-instance tint, so variation stays cheap.
 */

export type ForestKind =
  | 'pine'
  | 'decid'
  | 'birch'
  | 'rockA'
  | 'rockB'
  | 'bush'
  | 'grass'
  | 'fern'
  | 'flower'
  | 'mushroom'
  | 'stump'
  | 'log';

interface Part {
  geo: THREE.BufferGeometry;
  color: (x: number, y: number, z: number) => THREE.Color;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const fract = (v: number) => v - Math.floor(v);
const hash3 = (x: number, y: number, z: number) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
const hash2 = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Shade a base colour by a brightness factor. */
const shade = (base: number, k: number) => new THREE.Color(base).multiplyScalar(k);

/** Move every vertex along its own radius by a position-based factor (shared corners move together). */
function displace(geo: THREE.BufferGeometry, amount: number, salt = 0) {
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + (hash3(Math.round(x * 1000) + salt, Math.round(y * 1000), Math.round(z * 1000)) - 0.5) * amount;
    p.setXYZ(i, x * k, y * k, z * k);
  }
}

function merge(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    const a = g.getAttribute('position');
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i);
      const y = a.getY(i);
      const z = a.getZ(i);
      pos.push(x, y, z);
      const c = part.color(x, y, z);
      col.push(c.r, c.g, c.b);
    }
    if (g !== part.geo) g.dispose();
    part.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  out.computeVertexNormals();
  return out;
}

/** Plain geometry that only needs a white vertex colour (the instance colour supplies the hue). */
function whiten(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = geo.getAttribute('position').count;
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return geo;
}

function lean(k: number) {
  return new THREE.Matrix4().set(1, k, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
}

// ---- trees ----------------------------------------------------------------------------------------------

function pine(rand: () => number): THREE.BufferGeometry {
  const parts: Part[] = [];
  const sh = lean(0.035);
  const trunk = new THREE.CylinderGeometry(0.13, 0.21, 1.7, 5).translate(0, 0.85, 0);
  trunk.applyMatrix4(sh);
  parts.push({ geo: trunk, color: (_x, y) => shade(L.TREE_COLORS.pineTrunk, 0.75 + 0.35 * clamp01(y / 1.7)) });
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = (1.3 - 0.85 * t) * (0.88 + rand() * 0.24);
    const h = (1.25 - 0.3 * t) * (0.9 + rand() * 0.2);
    const y0 = 0.95 + i * 0.74;
    const g = new THREE.ConeGeometry(r, h, 6 + (i % 2), 1, true);
    g.rotateY(rand() * Math.PI);
    g.translate((rand() - 0.5) * 0.16, y0 + h / 2, (rand() - 0.5) * 0.16);
    g.applyMatrix4(sh);
    parts.push({
      geo: g,
      color: (_x, y) => {
        const local = clamp01((y - y0) / h);
        const overall = clamp01((y - 0.9) / 4.2);
        return shade(L.TREE_COLORS.pineNeedle, (0.55 + 0.5 * overall) * (0.82 + 0.28 * local));
      },
    });
  }
  return merge(parts);
}

function blob(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  base: number,
  salt: number,
): Part {
  const g = new THREE.IcosahedronGeometry(1, 0);
  displace(g, 0.28, salt);
  g.scale(rx, ry, rz);
  g.translate(cx, cy, cz);
  return {
    geo: g,
    color: (_x, y) => shade(base, 0.62 + 0.5 * clamp01((y - (cy - ry)) / (2 * ry))),
  };
}

function decid(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const trunk = new THREE.CylinderGeometry(0.15, 0.25, 1.9, 5).translate(0, 0.95, 0);
  parts.push({ geo: trunk, color: (_x, y) => shade(L.TREE_COLORS.deciduousTrunk, 0.7 + 0.4 * clamp01(y / 1.9)) });
  for (const side of [-1, 1]) {
    const b = new THREE.CylinderGeometry(0.05, 0.11, 1.0, 4).translate(0, 0.5, 0);
    b.rotateZ(-side * 0.55);
    b.translate(0, 1.6, 0);
    parts.push({ geo: b, color: () => shade(L.TREE_COLORS.deciduousTrunk, 0.95) });
  }
  const leaf = L.TREE_COLORS.deciduousLeaf;
  parts.push(blob(0, 2.75, 0, 1.0, 0.85, 1.0, leaf, 1));
  parts.push(blob(0.85, 2.3, 0.25, 0.75, 0.65, 0.75, leaf, 2));
  parts.push(blob(-0.8, 2.4, -0.3, 0.8, 0.7, 0.8, leaf, 3));
  parts.push(blob(0.1, 2.35, -0.85, 0.7, 0.6, 0.7, leaf, 4));
  parts.push(blob(-0.15, 3.35, 0.2, 0.62, 0.55, 0.62, leaf, 5));
  return merge(parts);
}

function birch(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.13, 3.0, 5, 12).translate(0, 1.5, 0);
  parts.push({
    geo: trunk,
    color: (x, y, z) => {
      const mark = Math.sin(y * 31 + hash2(Math.round(x * 50), Math.round(z * 50)) * 6) > 0.86 ? 0.32 : 1;
      return shade(L.TREE_COLORS.birchTrunk, mark * (0.8 + 0.25 * clamp01(y / 3)));
    },
  });
  const leaf = L.TREE_COLORS.birchLeaf;
  parts.push(blob(0, 3.4, 0, 0.62, 1.05, 0.62, leaf, 11));
  parts.push(blob(0.28, 2.75, 0.1, 0.5, 0.7, 0.5, leaf, 12));
  parts.push(blob(-0.25, 3.9, -0.1, 0.42, 0.6, 0.42, leaf, 13));
  return merge(parts);
}

// ---- rocks, bushes --------------------------------------------------------------------------------------

function rockPart(
  detail: number,
  sx: number,
  sy: number,
  sz: number,
  ox: number,
  oz: number,
  amount: number,
  moss: number,
  salt: number,
  rotY: number,
): Part {
  const g = new THREE.IcosahedronGeometry(1, detail);
  displace(g, amount, salt);
  g.scale(sx, sy, sz);
  g.rotateY(rotY);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, Math.max(p.getY(i), -0.45 * sy) + 0.45 * sy);
  g.translate(ox, 0, oz);
  const top = 1.45 * sy;
  return {
    geo: g,
    color: (_x, y) => {
      const t = clamp01(y / top);
      const grey = 0.68 + 0.42 * t;
      return new THREE.Color(grey, grey, grey).lerp(new THREE.Color(0.8, 1.15, 0.7), moss * smooth(0.55, 0.9, t));
    },
  };
}

function rockA(): THREE.BufferGeometry {
  return merge([rockPart(1, 1, 0.75, 0.9, 0, 0, 0.5, 0.8, 21, 0.4)]);
}

function rockB(): THREE.BufferGeometry {
  return merge([
    rockPart(1, 0.8, 0.55, 0.7, 0, 0, 0.45, 0.35, 31, 1.1),
    rockPart(0, 0.38, 0.26, 0.34, 0.95, 0.35, 0.3, 0.1, 32, 0.3),
    rockPart(0, 0.26, 0.2, 0.26, -0.7, 0.75, 0.3, 0.1, 33, 2.0),
    rockPart(0, 0.2, 0.15, 0.2, 0.35, -0.95, 0.3, 0.0, 34, 0.9),
    rockPart(0, 0.16, 0.12, 0.16, -1.0, -0.2, 0.3, 0.0, 35, 1.7),
  ]);
}

function bush(): THREE.BufferGeometry {
  const a = new THREE.IcosahedronGeometry(1, 1);
  displace(a, 0.35, 41);
  const b = new THREE.IcosahedronGeometry(0.6, 1);
  displace(b, 0.35, 42);
  b.translate(0.7, -0.2, 0.2);
  const c = (_x: number, y: number) => {
    const k = 0.6 + 0.5 * clamp01((y + 1) / 2);
    return new THREE.Color(k, k, k);
  };
  return merge([
    { geo: a, color: c },
    { geo: b, color: c },
  ]);
}

// ---- undergrowth ----------------------------------------------------------------------------------------

function grassTuft(rand: () => number): THREE.BufferGeometry {
  const parts: Part[] = [];
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const h = 0.55 + rand() * 0.55;
    const g = new THREE.ConeGeometry(0.05, h, 3, 1, true).translate(0, h / 2, 0);
    g.rotateZ(0.12 + rand() * 0.38);
    g.rotateY((i / blades) * Math.PI * 2 + rand() * 0.6);
    g.translate((rand() - 0.5) * 0.12, 0, (rand() - 0.5) * 0.12);
    parts.push({
      geo: g,
      color: (_x, y) => {
        const k = 0.5 + 0.7 * clamp01(y / 0.9);
        return new THREE.Color(k, k, k);
      },
    });
  }
  return merge(parts);
}

function fern(rand: () => number): THREE.BufferGeometry {
  const parts: Part[] = [];
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const h = 0.55 + rand() * 0.3;
    const g = new THREE.ConeGeometry(0.14, h, 3, 1, true).translate(0, h / 2, 0);
    g.scale(1, 1, 0.25);
    g.rotateZ(0.95 + rand() * 0.3);
    g.rotateY((i / fronds) * Math.PI * 2 + rand() * 0.4);
    g.translate(0, 0.05, 0);
    parts.push({
      geo: g,
      color: (x, y, z) => {
        const k = 0.55 + 0.6 * clamp01(Math.hypot(x, z) / 0.6) + 0.1 * y;
        return new THREE.Color(k, k, k);
      },
    });
  }
  return merge(parts);
}

function mushroom(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const make = (ox: number, oz: number, s: number) => {
    const stem = new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.26 * s, 5).translate(ox, 0.13 * s, oz);
    parts.push({ geo: stem, color: () => new THREE.Color(0xd8d0e0) });
    const cap = new THREE.SphereGeometry(0.17 * s, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(ox, 0.25 * s, oz);
    parts.push({ geo: cap, color: () => new THREE.Color(0xd9607a) });
  };
  make(0, 0, 1);
  make(0.2, 0.12, 0.6);
  make(-0.15, 0.17, 0.45);
  return merge(parts);
}

function flower(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const stem = new THREE.CylinderGeometry(0.012, 0.018, 0.36, 3).translate(0, 0.18, 0);
  parts.push({ geo: stem, color: () => new THREE.Color(0.2, 0.42, 0.18) });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const g = new THREE.SphereGeometry(0.06, 4, 3).scale(1, 0.45, 1).translate(Math.cos(a) * 0.08, 0.38, Math.sin(a) * 0.08);
    parts.push({ geo: g, color: () => new THREE.Color(1, 1, 1) });
  }
  const mid = new THREE.SphereGeometry(0.045, 4, 3).translate(0, 0.39, 0);
  parts.push({ geo: mid, color: () => new THREE.Color(1, 0.8, 0.25) });
  return merge(parts);
}

/** All forest geometries, keyed by kind. The caller owns (and disposes) them. */
export function buildProcGeometries(): Record<ForestKind, THREE.BufferGeometry> {
  const rand = mulberry(L.WORLD_SEED * 31 + 5);
  return {
    pine: pine(rand),
    decid: decid(),
    birch: birch(),
    rockA: rockA(),
    rockB: rockB(),
    bush: bush(),
    grass: grassTuft(rand),
    fern: fern(rand),
    flower: flower(),
    mushroom: mushroom(),
    stump: whiten(new THREE.CylinderGeometry(1, 1.15, 1, 6)),
    log: whiten(new THREE.CylinderGeometry(1, 1, 1, 6)),
  };
}

// ---- ground ---------------------------------------------------------------------------------------------

function vnoise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, y: number) => 0.55 * vnoise(x, y) + 0.3 * vnoise(x * 2.1, y * 2.1) + 0.15 * vnoise(x * 4.3, y * 4.3);

/**
 * Ground plane in world coordinates with baked colour: dark patches, moss, leaf litter, a brown wash near the
 * path so the dirt blends in, and shadowy discs under every claimed prop.
 */
export function buildGround(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  distToPath: (x: number, z: number) => number,
  occupied: { x: number; z: number; r: number }[],
): THREE.BufferGeometry {
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cell = 2;
  const sx = Math.min(240, Math.max(1, Math.round(w / cell)));
  const sz = Math.min(240, Math.max(1, Math.round(d / cell)));
  const geo = new THREE.PlaneGeometry(w, d, sx, sz);
  geo.rotateX(-Math.PI / 2);
  geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);

  const base = new THREE.Color(0x3a5f55);
  const dark = new THREE.Color(0x22403f);
  const moss = new THREE.Color(0x52804f);
  const litter = new THREE.Color(0x5b4c3a);
  const wash = new THREE.Color(0x3a3a2c);
  const c = new THREE.Color();
  const p = geo.getAttribute('position');
  const cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    c.copy(base);
    c.lerp(dark, smooth(0.45, 0.72, fbm(x * 0.07, z * 0.07)) * 0.7);
    c.lerp(moss, smooth(0.55, 0.8, fbm(x * 0.22 + 40, z * 0.22)) * 0.55);
    c.lerp(litter, smooth(0.6, 0.82, fbm(x * 0.14 - 30, z * 0.14 + 7)) * 0.5);
    const dp = distToPath(x, z);
    c.lerp(wash, (1 - smooth(1.4, 4.8, dp)) * 0.6);
    let under = 0;
    for (const o of occupied) {
      const dx = o.x - x;
      if (dx > 4 || dx < -4) continue;
      const dist = Math.hypot(dx, o.z - z);
      under = Math.max(under, 1 - smooth(o.r * 0.4, o.r * 2.4 + 0.4, dist));
    }
    c.multiplyScalar((0.93 + 0.14 * hash2(i * 0.37, i * 0.11)) * (1 - 0.38 * under));
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}
