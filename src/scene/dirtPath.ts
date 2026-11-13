import * as THREE from 'three';

/** Dirt ribbon laid on the ground along the camera route, plus a worn patch around the campfire. */

const HALF_WIDTH = 1.15; // average half width; the edge wobbles by about +-0.3
const LIFT = 0.04; // above the ground plane (polygon offset handles the rest)
const TILE = 3; // world units per texture repeat along the path
const DISC_RADIUS = 2.7;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function dirtTexture(kind: 'strip' | 'disc'): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  let seed = kind === 'strip' ? 11 : 23;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x / (S - 1)) * 2 - 1;
      const ny = (y / (S - 1)) * 2 - 1;
      // Ragged, noise-bitten edge (integer frequencies keep the strip tileable) with a short soft fade.
      const wob =
        kind === 'strip'
          ? 0.07 * Math.sin((Math.PI * 2 * 1 * y) / S + 1.3) + 0.05 * Math.sin((Math.PI * 2 * 2 * y) / S + 0.4)
          : 0.05 * Math.sin(Math.atan2(ny, nx) * 3 + 0.5) + 0.03 * Math.sin(Math.atan2(ny, nx) * 5);
      const edge = (kind === 'strip' ? Math.abs(nx) : Math.hypot(nx, ny)) + wob + (rnd() - 0.5) * 0.02;
      const alpha = 1 - smooth(0.5, 0.98, edge);
      // Integer sine frequencies keep the strip tileable along its length.
      const blot = 0.92 + 0.08 * Math.sin((Math.PI * 2 * 3 * y) / S + x * 0.19) * Math.sin((Math.PI * 2 * 2 * x) / S);
      const v = (0.76 + 0.24 * rnd()) * blot * (1 - 0.22 * smooth(0.5, 0.9, edge));
      const o = (y * S + x) * 4;
      img.data[o] = 98 * v;
      img.data[o + 1] = 76 * v;
      img.data[o + 2] = 56 * v;
      img.data[o + 3] = alpha * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (kind === 'strip') tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export interface DirtPath {
  group: THREE.Group;
  dispose(): void;
}

/** `points` are ground-plane samples of the route (only x and z are used), in walking order. */
export function createDirtPath(points: THREE.Vector3[], campfire: THREE.Vector3): DirtPath {
  const n = points.length;
  const positions = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const index: number[] = [];
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, n - 1)];
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    if (i > 0) dist += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    const w = HALF_WIDTH + 0.2 * Math.sin(i * 0.17) + 0.1 * Math.sin(i * 0.53 + 1);
    const nx = tz;
    const nz = -tx;
    const p = points[i];
    const k = i * 2;
    positions.set([p.x + nx * w, LIFT, p.z + nz * w, p.x - nx * w, LIFT, p.z - nz * w], k * 3);
    normals.set([0, 1, 0, 0, 1, 0], k * 3);
    uvs.set([0, dist / TILE, 1, dist / TILE], k * 2);
    if (i < n - 1) index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  ribbonGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  ribbonGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  ribbonGeo.setIndex(index);

  const stripTex = dirtTexture('strip');
  const discTex = dirtTexture('disc');
  const common = {
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  } as const;
  const ribbonMat = new THREE.MeshLambertMaterial({ map: stripTex, ...common });
  const discMat = new THREE.MeshLambertMaterial({ map: discTex, ...common });

  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
  ribbon.renderOrder = 1;
  const discGeo = new THREE.CircleGeometry(DISC_RADIUS, 36).rotateX(-Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.set(campfire.x, LIFT + 0.005, campfire.z);
  disc.renderOrder = 1;

  const group = new THREE.Group();
  group.name = 'dirt-path';
  group.add(ribbon, disc);
  return {
    group,
    dispose() {
      ribbonGeo.dispose();
      discGeo.dispose();
      stripTex.dispose();
      discTex.dispose();
      ribbonMat.dispose();
      discMat.dispose();
    },
  };
}
