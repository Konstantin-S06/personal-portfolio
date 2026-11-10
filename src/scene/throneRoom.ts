import * as THREE from 'three';

/**
 * Ruined temple court at the end of the path (v2). No outer box: a broken gate with ragged wall stubs, a
 * colonnade of intact and fallen pillars, a tiled avenue with a carpet and a glowing emblem, a stepped dais
 * with the throne, and a ring of standing stones behind it. Teal braziers, drifting motes and low mist.
 *
 * Local frame: x = right, y = up, z = backward, so a point at distance u along the walking direction has
 * z = -u. The court starts where the forest curve ends. Listens for the window event "chat-speaking"
 * (detail: boolean) to pulse the rune face, the emblem and the glowing stones.
 * Public interface is unchanged from v1, so world.ts needs no edits.
 */

const U_GATE = 20;
const GATE_V = 2.9; // gate pillars sit at +-GATE_V
const GATE_H = 7;
const COL_V = 4.8;
const COL_US = [24, 28.5, 33, 37.5, 42];
const AVENUE_HALF = 3.7;
const THRONE_C = 47;
const FACE_U = 47.97;
const FACE_Y = 3.6;
const CAM_END_U = 32;
const MONO_R = 9.5;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
}

interface Part {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
  rx?: number;
  ry?: number;
  rz?: number;
}
interface Rot {
  rx?: number;
  ry?: number;
  rz?: number;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, parts: Part[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, parts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  parts.forEach((a, i) => {
    e.set(a.rx ?? 0, a.ry ?? 0, a.rz ?? 0);
    q.setFromEuler(e);
    p.set(a.x, a.y, a.z);
    s.set(a.sx, a.sy, a.sz);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHex(a.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const TEAL = '#7ff5e6';

const runeTexture = () =>
  canvasTex(256, (g, S) => {
    g.strokeStyle = TEAL;
    g.fillStyle = TEAL;
    g.lineCap = 'round';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(S / 2, S / 2, 104, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    g.arc(S / 2, S / 2, 92, 0, Math.PI * 2);
    g.stroke();
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(S / 2 + sx * 22, 104);
      g.quadraticCurveTo(S / 2 + sx * 46, 92, S / 2 + sx * 62, 108);
      g.quadraticCurveTo(S / 2 + sx * 44, 118, S / 2 + sx * 22, 104);
      g.fill();
    }
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(S / 2, 70);
    g.lineTo(S / 2, 96);
    g.moveTo(S / 2 - 40, 150);
    g.lineTo(S / 2 - 14, 170);
    g.lineTo(S / 2, 150);
    g.lineTo(S / 2 + 14, 170);
    g.lineTo(S / 2 + 40, 150);
    g.stroke();
    g.lineWidth = 4;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(S / 2 + Math.cos(a) * 112, S / 2 + Math.sin(a) * 112);
      g.lineTo(S / 2 + Math.cos(a) * 124, S / 2 + Math.sin(a) * 124);
      g.stroke();
    }
  });

/** Ground emblem laid on the carpet: rings, a six-pointed star, ticks. */
const emblemTexture = () =>
  canvasTex(512, (g, S) => {
    const c = S / 2;
    g.strokeStyle = TEAL;
    g.fillStyle = TEAL;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [r, w] of [[240, 8], [218, 3], [150, 5]] as [number, number][]) {
      g.lineWidth = w;
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.lineWidth = 4;
    for (let t = 0; t < 2; t++) {
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + (t ? Math.PI / 3 : 0) - Math.PI / 2;
        const x = c + Math.cos(a) * 150;
        const y = c + Math.sin(a) * 150;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.lineWidth = i % 2 ? 3 : 6;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 222, c + Math.sin(a) * 222);
      g.lineTo(c + Math.cos(a) * (i % 2 ? 232 : 238), c + Math.sin(a) * (i % 2 ? 232 : 238));
      g.stroke();
    }
    g.beginPath();
    g.arc(c, c, 16, 0, Math.PI * 2);
    g.fill();
  });

const glowTexture = () =>
  canvasTex(64, (g, S) => {
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  });

function mistTexture(): THREE.CanvasTexture {
  const tex = canvasTex(128, (g, S) => {
    const rnd = rng(5);
    for (let i = 0; i < 46; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 14 + rnd() * 26;
      for (const ox of [-S, 0, S]) {
        const grad = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.5)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x + ox - r, y - r, r * 2, r * 2);
      }
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

export interface ThroneRoom {
  /** Always in the scene (holds the one point light). */
  group: THREE.Group;
  /** True if a prop of radius r at (x, z) would sit on the court or its entrance. */
  blocks(x: number, z: number, r: number): boolean;
  /** Camera route from the end of the forest curve up to the gate, ground samples, without the start point. */
  routePoints: THREE.Vector3[];
  cameraAt(t: number, out: THREE.Vector3): THREE.Vector3;
  /** Blend the gaze from the campfire aim to the throne face. */
  gaze(t: number, fireAim: THREE.Vector3, out: THREE.Vector3): void;
  update(clock: number, camera: THREE.Vector3): void;
  dispose(): void;
}

export function createThroneRoom(endPt: THREE.Vector3, endTan: THREE.Vector3): ThroneRoom {
  const f = new THREE.Vector3(endTan.x, 0, endTan.z).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const rgt = new THREE.Vector3().crossVectors(f, up);
  const origin = new THREE.Vector3(endPt.x, 0, endPt.z);
  const toWorld = (u: number, v: number, y: number) =>
    new THREE.Vector3(origin.x + f.x * u + rgt.x * v, y, origin.z + f.z * u + rgt.z * v);

  const group = new THREE.Group();
  group.name = 'throne-court';
  group.position.copy(origin);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(rgt, up, f.clone().negate()));
  const body = new THREE.Group(); // meshes only; hidden when far away. The light stays outside it.
  group.add(body);

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  const keepGeo = <T extends THREE.BufferGeometry>(g: T): T => (geos.push(g), g);
  const keepMat = <T extends THREE.Material>(m: T): T => (mats.push(m), m);
  const keepTex = <T extends THREE.Texture>(t: T): T => (texs.push(t), t);

  const rand = rng(41);
  const pick = <T,>(a: T[]): T => a[(rand() * a.length) | 0];

  const WALL = [0x56566e, 0x4a4a62, 0x62627c, 0x504f68];
  const TILE = [0x40405a, 0x4a4a66, 0x383852, 0x444460];
  const DAIS = 0x6a6884;
  const THRONE = 0x35344d;
  const CARPET = 0x4a2a66;
  const MOSS = [0x2f5a46, 0x2a4f40, 0x37654c];

  const boxes: Part[] = [];
  const cyls: Part[] = [];
  const glow: Part[] = [];
  const boxUV = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, color: number, rot: Rot = {}) =>
    boxes.push({ x: (v0 + v1) / 2, y: (y0 + y1) / 2, z: -(u0 + u1) / 2, sx: v1 - v0, sy: y1 - y0, sz: u1 - u0, color, ...rot });
  const cylAt = (u: number, v: number, y0: number, h: number, r: number, color: number, rot: Rot = {}) =>
    cyls.push({ x: v, y: y0 + h / 2, z: -u, sx: r, sy: h, sz: r, color, ...rot });

  // ---- gate: two pillars, a broken lintel, ragged wall stubs ------------------------------------------------
  for (const s of [-1, 1]) {
    cylAt(U_GATE, s * GATE_V, 0, 0.5, 1.15, pick(WALL));
    cylAt(U_GATE, s * GATE_V, 0.5, GATE_H - 0.5, 0.8, pick(WALL));
  }
  boxUV(U_GATE - 0.6, U_GATE + 0.6, -3.9, 0.6, 6.95, 7.95, WALL[0], { rz: 0.02 });
  boxUV(U_GATE - 0.6, U_GATE + 0.6, 0.9, 3.9, 6.7, 7.6, WALL[1], { rz: -0.06 });
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const a = 3.9 + i * 1.15;
      const h = Math.max(0.5, 4.6 - i * 0.78 + (rand() - 0.5) * 1.1);
      const v0 = Math.min(s * a, s * (a + 1.1));
      const v1 = Math.max(s * a, s * (a + 1.1));
      boxUV(U_GATE - 0.5, U_GATE + 0.5, v0, v1, 0, h, pick(WALL));
      if (rand() < 0.7) {
        const w = 0.35 + rand() * 0.4;
        boxUV(U_GATE - 0.4, U_GATE + 0.4, v0 + 0.15, v1 - 0.15, h, h + w, pick(WALL), { rz: (rand() - 0.5) * 0.2 });
      }
    }
  }

  // ---- colonnade: intact pillars with capitals, broken ones with a fallen drum ------------------------------
  const broken = new Set(['1:1', '2:-1', '3:-1', '4:1']);
  const intact: { u: number; side: number }[] = [];
  const braziers: { u: number; v: number }[] = [];
  COL_US.forEach((u, i) => {
    for (const side of [-1, 1]) {
      const v = side * COL_V;
      const isBroken = broken.has(`${i}:${side}`);
      const H = isBroken ? 2.4 + rand() * 1.6 : 6.2;
      cylAt(u, v, 0, 0.35, 0.85, pick(WALL));
      cylAt(u, v, 0.35, H, 0.52, pick(WALL));
      if (isBroken) {
        cyls.push({ x: v - side * 1.5, y: 0.5, z: -(u + (rand() - 0.5)), sx: 0.5, sy: 1.5, sz: 0.5, color: pick(WALL), rx: Math.PI / 2, ry: rand() * Math.PI });
      } else {
        boxUV(u - 0.8, u + 0.8, v - 0.8, v + 0.8, 6.55, 6.95, pick(WALL));
        intact.push({ u, side });
      }
      braziers.push({ u, v: side * (COL_V - 1.5) });
    }
  });
  for (let i = 0; i < COL_US.length - 1; i++) {
    for (const side of [-1, 1]) {
      if (broken.has(`${i}:${side}`) || broken.has(`${i + 1}:${side}`)) continue;
      boxUV(COL_US[i] + 0.5, COL_US[i + 1] - 0.5, side * COL_V - 0.45, side * COL_V + 0.45, 6.95, 7.45, pick(WALL));
    }
  }
  for (const s of [-1, 1]) braziers.push({ u: U_GATE - 1.4, v: s * 4.6 }); // beacons flanking the entrance

  // ---- avenue: tiles with gaps, carpet, stepped dais ----------------------------------------------------------
  for (let u = 20.8; u < 40.5; u += 1.5) {
    for (let k = -2; k <= 2; k++) {
      if (rand() < 0.12) continue;
      boxUV(u - 0.7, u + 0.7, k * 1.5 - 0.7, k * 1.5 + 0.7, 0, 0.08, pick(TILE), { ry: (rand() - 0.5) * 0.05 });
    }
  }
  boxUV(20.6, 40.5, -1, 1, 0.08, 0.12, CARPET);
  boxUV(40.5, 51, -4.6, 4.6, 0, 0.3, DAIS);
  boxUV(43, 51, -3.7, 3.7, 0, 0.6, DAIS);
  boxUV(45, 51, -2.8, 2.8, 0, 0.9, DAIS);
  boxUV(40.5, 43, -1, 1, 0.3, 0.34, CARPET);
  boxUV(43, 45, -1, 1, 0.6, 0.64, CARPET);
  boxUV(45, 46.2, -1, 1, 0.9, 0.94, CARPET);
  for (const [uu, hh] of [[40.5, 0.3], [43, 0.6], [45, 0.9]] as [number, number][]) {
    const half = uu === 40.5 ? 4.6 : uu === 43 ? 3.7 : 2.8;
    glow.push({ x: 0, y: hh - 0.02, z: -(uu - 0.02), sx: half * 2, sy: 0.04, sz: 0.05, color: 0xffffff });
  }

  // ---- throne -------------------------------------------------------------------------------------------------
  boxUV(45.8, 48.2, -1.4, 1.4, 0.9, 1.2, THRONE); // plinth
  boxUV(46.2, 48.0, -0.95, 0.95, 1.2, 1.75, THRONE); // seat
  boxUV(46.2, 48.0, -1.3, -0.95, 1.2, 2.3, THRONE); // arms
  boxUV(46.2, 48.0, 0.95, 1.3, 1.2, 2.3, THRONE);
  boxUV(48.0, 48.7, -1.35, 1.35, 1.2, 5.4, THRONE); // back
  boxUV(48.0, 48.7, -1.0, 1.0, 5.4, 6.4, THRONE);
  boxUV(48.0, 48.7, -0.35, 0.35, 6.4, 8.0, THRONE, { rz: 0.0 });
  boxUV(48.0, 48.7, 1.35, 1.75, 1.2, 4.2, THRONE);
  boxUV(48.0, 48.7, -1.75, -1.35, 1.2, 4.2, THRONE);
  boxUV(48.0, 48.7, 1.75, 2.1, 1.2, 3.0, THRONE);
  boxUV(48.0, 48.7, -2.1, -1.75, 1.2, 3.0, THRONE);
  for (const s of [-1, 1]) {
    glow.push({ x: s * 1.3, y: 3.3, z: -(47.98), sx: 0.07, sy: 4.0, sz: 0.04, color: 0xffffff });
  }
  glow.push({ x: 0, y: 5.38, z: -(47.98), sx: 2.7, sy: 0.07, sz: 0.04, color: 0xffffff });

  // ---- standing stones behind the throne, each with a glowing face -------------------------------------------
  for (let i = 0; i < 9; i++) {
    const a = ((-72 + i * 18) * Math.PI) / 180;
    const x = MONO_R * Math.sin(a);
    const z = -(THRONE_C + MONO_R * Math.cos(a));
    const h = 5.5 + rand() * 4;
    const w = 1.7 + rand() * 0.9;
    const yaw = Math.atan2(0 - x, -THRONE_C - z);
    boxes.push({ x, y: h / 2, z, sx: w, sy: h, sz: 1.2, ry: yaw, rx: (rand() - 0.5) * 0.1, rz: (rand() - 0.5) * 0.1, color: pick(WALL) });
    glow.push({ x: x + Math.sin(yaw) * 0.63, y: h * 0.45, z: z + Math.cos(yaw) * 0.63, sx: 0.08, sy: h * 0.6, sz: 0.05, ry: yaw, color: 0xffffff });
  }

  // ---- rubble ------------------------------------------------------------------------------------------------
  for (let i = 0; i < 55; i++) {
    const u = 18 + rand() * 34;
    const v = (rand() < 0.5 ? -1 : 1) * (AVENUE_HALF + 0.3 + rand() * 7.5);
    const sz = 0.2 + rand() * 0.5;
    boxes.push({ x: v, y: sz * 0.35, z: -u, sx: sz * (1 + rand()), sy: sz, sz: sz * (1 + rand()), ry: rand() * Math.PI, rx: (rand() - 0.5) * 0.5, rz: (rand() - 0.5) * 0.5, color: pick(WALL) });
  }

  // ---- stone, cylinders, glow, moss ----------------------------------------------------------------------------
  const boxGeo = keepGeo(new THREE.BoxGeometry(1, 1, 1));
  const cylGeo = keepGeo(new THREE.CylinderGeometry(1, 1, 1, 14));
  const stoneMat = keepMat(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
  const stone = instanced(boxGeo, stoneMat, boxes);
  const columns = instanced(cylGeo, stoneMat, cyls);
  const glowMat = keepMat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const glowMesh = instanced(boxGeo, glowMat, glow);
  const tealBase = new THREE.Color(0x5ff0dc);
  body.add(stone, columns, glowMesh);
  meshes.push(stone, columns, glowMesh);

  const mossGeo = keepGeo(new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2));
  const mossMat = keepMat(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const mossParts: Part[] = [];
  for (let i = 0; i < 36; i++) {
    const u = 17 + rand() * 36;
    const v = (rand() < 0.5 ? -1 : 1) * (AVENUE_HALF + 0.1 + rand() * 7);
    const r = 1.2 + rand() * 2;
    mossParts.push({ x: v, y: 0.03, z: -u, sx: r, sy: 1, sz: r * (0.7 + rand() * 0.5), ry: rand() * Math.PI, color: pick(MOSS) });
  }
  const moss = instanced(mossGeo, mossMat, mossParts);
  body.add(moss);
  meshes.push(moss);

  // ---- banners on intact pillars --------------------------------------------------------------------------------
  const bannerGeo = keepGeo(new THREE.PlaneGeometry(1, 1));
  const bannerMat = keepMat(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
  const bannerParts: Part[] = intact.map(({ u, side }) => {
    const h = 2.8 + rand() * 1.0;
    return { x: side * (COL_V - 0.56), y: 6.0 - h / 2, z: -u, sx: 1.1, sy: h, sz: 1, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2, color: pick([0x3a2a5c, 0x5a1f35, 0x1f4a50]) };
  });
  const banners = instanced(bannerGeo, bannerMat, bannerParts);
  body.add(banners);
  meshes.push(banners);

  // ---- braziers: stands, bowls, two flame layers, halos --------------------------------------------------------------
  const standParts: Part[] = [];
  const flameParts: Part[] = [];
  const flamePos: THREE.Vector3[] = [];
  braziers.forEach(({ u, v }) => {
    standParts.push({ x: v, y: 0.6, z: -u, sx: 0.22, sy: 1.2, sz: 0.22, color: 0x2b2a3a });
    standParts.push({ x: v, y: 1.32, z: -u, sx: 0.55, sy: 0.3, sz: 0.55, color: 0x3a3950 });
    flamePos.push(new THREE.Vector3(v, 1.47, -u));
    flameParts.push({ x: v, y: 2, z: -u, sx: 0.34, sy: 1.2, sz: 0.34, color: 0x2fd2bd });
    flameParts.push({ x: v, y: 2, z: -u, sx: 0.2, sy: 0.7, sz: 0.2, color: 0xcafff6 });
  });
  const stands = instanced(cylGeo, stoneMat, standParts);
  const coneGeo = keepGeo(new THREE.ConeGeometry(1, 1, 8));
  const flameMat = keepMat(
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const flames = instanced(coneGeo, flameMat, flameParts);
  body.add(stands, flames);
  meshes.push(stands, flames);

  const glowTex = keepTex(glowTexture());
  const haloGeo = keepGeo(new THREE.BufferGeometry());
  haloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flamePos.flatMap((p) => [p.x, p.y + 0.5, p.z])), 3));
  const haloMat = keepMat(
    new THREE.PointsMaterial({ map: glowTex, size: 3.4, color: 0x4fe8d6, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  const halos = new THREE.Points(haloGeo, haloMat);
  halos.frustumCulled = false;
  const throneHaloGeo = keepGeo(new THREE.BufferGeometry());
  throneHaloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 3.8, -(FACE_U + 0.6)]), 3));
  const throneHaloMat = keepMat(
    new THREE.PointsMaterial({ map: glowTex, size: 11, color: 0x58f0dc, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  const throneHalo = new THREE.Points(throneHaloGeo, throneHaloMat);
  throneHalo.frustumCulled = false;
  body.add(halos, throneHalo);

  // ---- drifting motes ---------------------------------------------------------------------------------------------
  const MOTES = 130;
  const moteBase = new Float32Array(MOTES * 4); // x, z, speed, phase
  const motePos = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) {
    moteBase[i * 4] = (rand() - 0.5) * 16;
    moteBase[i * 4 + 1] = -(20 + rand() * 30);
    moteBase[i * 4 + 2] = 0.03 + rand() * 0.05;
    moteBase[i * 4 + 3] = rand();
  }
  const moteGeo = keepGeo(new THREE.BufferGeometry());
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = keepMat(
    new THREE.PointsMaterial({ map: glowTex, size: 0.16, color: 0x9ffff0, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  body.add(motes);

  // ---- rune face, ground emblem, gate mist, low mist ------------------------------------------------------------------
  const runeTex = keepTex(runeTexture());
  const runeGeo = keepGeo(new THREE.PlaneGeometry(2.6, 2.6));
  const runeMat = keepMat(new THREE.MeshBasicMaterial({ map: runeTex, transparent: true, depthWrite: false }));
  const rune = new THREE.Mesh(runeGeo, runeMat);
  rune.position.set(0, FACE_Y, -FACE_U);
  body.add(rune);

  const emblemTex = keepTex(emblemTexture());
  const emblemGeo = keepGeo(new THREE.PlaneGeometry(6.4, 6.4).rotateX(-Math.PI / 2));
  const emblemMat = keepMat(
    new THREE.MeshBasicMaterial({ map: emblemTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  const emblem = new THREE.Mesh(emblemGeo, emblemMat);
  emblem.position.set(0, 0.15, -33);
  emblem.renderOrder = 2;
  body.add(emblem);

  const mistTex = keepTex(mistTexture());
  const gateMistGeo = keepGeo(new THREE.PlaneGeometry(GATE_V * 2 - 1.6, GATE_H - 0.4));
  const gateMistMat = keepMat(
    new THREE.MeshBasicMaterial({ map: mistTex, color: 0x9fe8f0, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
  );
  const gateMist = new THREE.Mesh(gateMistGeo, gateMistMat);
  gateMist.position.set(0, (GATE_H - 0.4) / 2, -U_GATE);
  gateMist.renderOrder = 5;
  body.add(gateMist);

  const lowMistGeo = keepGeo(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const lowMistMat = keepMat(
    new THREE.MeshBasicMaterial({ map: mistTex, color: 0x8fd0e0, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  const lowMist = instanced(lowMistGeo, lowMistMat, [26, 34, 42, 49].map((u, i) => ({ x: (i % 2 ? 1 : -1) * 1.5, y: 0.3 + i * 0.02, z: -u, sx: 15, sy: 1, sz: 15, ry: i * 1.3, color: 0xffffff })));
  lowMist.renderOrder = 4;
  body.add(lowMist);
  meshes.push(lowMist);
  const gateWorld = toWorld(U_GATE, 0, GATE_H / 2);

  // ---- the court's one light --------------------------------------------------------------------------------------------
  const light = new THREE.PointLight(0x58f0dc, 30, 30, 2);
  light.position.set(0, 4.2, -36);
  group.add(light);

  // ---- camera route ----------------------------------------------------------------------------------------------------
  const y0 = endPt.y;
  const route = new THREE.CatmullRomCurve3(
    [
      toWorld(0, 0, y0),
      toWorld(2.6, 1.3, y0 - 0.1),
      toWorld(5.8, 3.5, 2.7),
      toWorld(9.5, 3.3, 2.35),
      toWorld(14, 1.4, 2.0),
      toWorld(18.5, 0.2, 1.8),
      toWorld(24, 0, 1.7),
      toWorld(CAM_END_U, 0, 1.7),
    ],
    false,
    'catmullrom',
    0.5,
  );
  const routePoints = route
    .getSpacedPoints(120)
    .filter((p) => (p.x - origin.x) * f.x + (p.z - origin.z) * f.z <= U_GATE)
    .slice(1);
  const faceWorld = toWorld(FACE_U, 0, FACE_Y - 0.2);

  // ---- speaking pulse ----------------------------------------------------------------------------------------------------
  let speakingTarget = 0;
  let speaking = 0;
  const onSpeaking = (e: Event) => {
    speakingTarget = (e as CustomEvent<boolean>).detail ? 1 : 0;
  };
  window.addEventListener('chat-speaking', onSpeaking);

  const centre = toWorld(36, 0, 0);
  let lastClock = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const p3 = new THREE.Vector3();

  return {
    group,
    routePoints,
    blocks(x, z, r) {
      const dx = x - origin.x;
      const dz = z - origin.z;
      const u = dx * f.x + dz * f.z;
      const v = dx * rgt.x + dz * rgt.z;
      return u >= U_GATE - 3 - r && u <= 60 + r && Math.abs(v) <= 13 + r;
    },
    cameraAt(t, out) {
      const e = t * t * (3 - 2 * t);
      return route.getPointAt(e, out);
    },
    gaze(t, fireAim, out) {
      out.lerpVectors(fireAim, faceWorld, smooth(0.35, 0.75, t));
    },
    update(clock, camera) {
      const dt = Math.min(Math.max(clock - lastClock, 0), 0.1);
      lastClock = clock;
      body.visible = camera.distanceTo(centre) < 100;
      if (!body.visible) return;
      speaking += (speakingTarget - speaking) * Math.min(1, dt * 6);

      for (let k = 0; k < flamePos.length; k++) {
        const fp = flamePos[k];
        const sy = 1 + 0.22 * Math.sin(clock * 9 + k * 1.7) + 0.1 * Math.sin(clock * 17 + k * 3.1);
        p3.set(fp.x, fp.y + 0.6 * sy, fp.z);
        s3.set(0.34, 1.2 * sy, 0.34);
        m4.compose(p3, q, s3);
        flames.setMatrixAt(k * 2, m4);
        const sy2 = 0.9 + 0.2 * Math.sin(clock * 12 + k * 2.3);
        p3.set(fp.x, fp.y + 0.35 * sy2, fp.z);
        s3.set(0.2, 0.7 * sy2, 0.2);
        m4.compose(p3, q, s3);
        flames.setMatrixAt(k * 2 + 1, m4);
      }
      flames.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < MOTES; i++) {
        const sp = moteBase[i * 4 + 2];
        const ph = moteBase[i * 4 + 3];
        const life = (ph + clock * sp) % 1;
        motePos[i * 3] = moteBase[i * 4] + Math.sin(clock * 0.4 + ph * 6.28) * 0.4;
        motePos[i * 3 + 1] = 0.3 + life * 6;
        motePos[i * 3 + 2] = moteBase[i * 4 + 1] + Math.cos(clock * 0.35 + ph * 6.28) * 0.4;
      }
      (moteGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

      const pulse = speaking * (0.55 + 0.3 * Math.sin(clock * 14));
      light.intensity = 30 * (0.92 + 0.08 * Math.sin(clock * 7.3) + 0.04 * Math.sin(clock * 13) + speaking * 0.25);
      glowMat.color.copy(tealBase).multiplyScalar(0.75 + 0.12 * Math.sin(clock * 1.6) + pulse);
      runeMat.color.setScalar(0.6 + 0.2 * Math.sin(clock * 1.6) + pulse);
      emblemMat.color.setScalar(0.55 + 0.15 * Math.sin(clock * 1.1) + pulse * 0.8);
      throneHaloMat.opacity = 0.3 + 0.08 * Math.sin(clock * 1.6) + speaking * 0.25;

      mistTex.offset.x = (clock * 0.01) % 1;
      gateMistMat.opacity = 0.5 * smooth(1.2, 7, camera.distanceTo(gateWorld));
      gateMist.visible = gateMistMat.opacity > 0.01;
    },
    dispose() {
      window.removeEventListener('chat-speaking', onSpeaking);
      meshes.forEach((m) => m.dispose());
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
}
