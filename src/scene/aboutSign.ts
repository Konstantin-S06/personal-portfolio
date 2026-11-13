import * as THREE from 'three';
import * as L from './look';
import stopsJson from '../data/stops.generated.json';
import { BOARD_W_PX, BOARD_H_PX } from '../lib/quad';
import { BW, BH, CY, FACE_Z, FONT, RED, prng, spacing, wrapLines, inkText, mergeGeos } from './boards';

/**
 * The About banner: painted canvas hanging from a crossbar between two poles. Frame (poles, footings, crossbar, rope
 * loops) is one merged vertex-coloured mesh; the face is one alpha-tested plane, so the swallowtail cut shows the forest.
 * 2 draw calls, no lights. Real text lives in the DOM (AboutSignControls.tsx).
 */

export const ABOUT_ID = 'about';
const ABOUT_SIDE = -1; // left of the path (Home and project-1 are on the right)
const ABOUT_PULL = 1.2; // parks a little farther back so both poles are in view

export interface AboutContent {
  stopId: string;
  title: string;
  paragraphs: string[];
}

function paintAbout(ctx: CanvasRenderingContext2D, c: AboutContent) {
  const W = BOARD_W_PX;
  const H = BOARD_H_PX;
  const rand = prng(610);
  ctx.clearRect(0, 0, W, H);

  // cloth outline: ragged top and sides, swallowtail bottom
  const notch = 70;
  const jit = (a: number) => (rand() - 0.5) * a * 2;
  const pts: [number, number][] = [];
  for (let x = 6; x <= W - 6; x += 22) pts.push([x, 4 + Math.abs(jit(5))]);
  for (let y = 4; y < H - 4; y += 22) pts.push([W - 6 - Math.abs(jit(8)), y]);
  // torn swallowtail: uneven bites along both slopes
  const tail: [number, number][] = [[W - 6, H - 4], [W / 2, H - notch], [6, H - 4]];
  for (let s = 0; s < 2; s++) {
    const [ax, ay] = tail[s];
    const [bx, by] = tail[s + 1];
    for (let k = 0; k < 14; k++) {
      const t = k / 14;
      const bite = rand() < 0.25 ? 10 + rand() * 18 : 0;
      pts.push([ax + (bx - ax) * t + jit(4), Math.min(H - 3, ay + (by - ay) * t + jit(6) - bite)]);
    }
  }
  pts.push([6, H - 4]);
  for (let y = H - 26; y > 4; y -= 22) pts.push([6 + Math.abs(jit(8)), y]);
  const path = () => {
    ctx.beginPath();
    pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
    ctx.closePath();
  };

  ctx.save();
  path();
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, '#e9dfbc');
  g.addColorStop(1, '#d6c597');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // woven threads
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 4) {
    ctx.strokeStyle = `rgba(80,60,35,${0.03 + rand() * 0.04})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  for (let x = 0; x < W; x += 4) {
    ctx.strokeStyle = `rgba(80,60,35,${0.025 + rand() * 0.03})`;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  // vertical hanging folds
  for (let k = 0; k < 6; k++) {
    const x0 = (W * (k + 0.5 + (rand() - 0.5) * 0.3)) / 6;
    const fg = ctx.createLinearGradient(x0 - 60, 0, x0 + 60, 0);
    fg.addColorStop(0, 'rgba(255,240,200,0.1)');
    fg.addColorStop(0.5, 'rgba(40,25,10,0.15)');
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(x0 - 60, 0, 120, H);
  }
  // stains and a heavier, grimier lower edge
  for (let i = 0; i < 10; i++) {
    const sx = rand() * W;
    const sy = rand() * H;
    const sr = 40 + rand() * 110;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    sg.addColorStop(0, `rgba(90,60,25,${0.07 + rand() * 0.1})`);
    sg.addColorStop(1, 'rgba(90,60,25,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }
  const bg = ctx.createLinearGradient(0, H * 0.6, 0, H);
  bg.addColorStop(0, 'rgba(60,40,15,0)');
  bg.addColorStop(1, 'rgba(60,40,15,0.3)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, H * 0.6, W, H * 0.4);

  // hem and stitching
  ctx.fillStyle = 'rgba(70,45,20,0.2)';
  ctx.fillRect(0, 0, W, 42);
  ctx.setLineDash([10, 7]);
  ctx.strokeStyle = 'rgba(60,35,15,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(18, 36);
  ctx.lineTo(W - 18, 36);
  ctx.moveTo(18, 48);
  ctx.lineTo(18, H - 110);
  ctx.moveTo(W - 18, 48);
  ctx.lineTo(W - 18, H - 110);
  ctx.stroke();
  ctx.setLineDash([]);
    // age: mildew, scorch marks, water tide-lines and a clumsy patch
    for (let i = 0; i < 9; i++) {
      const sx = rand() * W;
      const sy = rand() * H;
      const sr = 18 + rand() * 50;
      const mg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      mg.addColorStop(0, i % 3 === 0 ? 'rgba(30,45,25,0.22)' : 'rgba(25,12,4,0.26)');
      mg.addColorStop(1, 'rgba(25,12,4,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    }
    ctx.strokeStyle = 'rgba(90,60,25,0.18)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const ty = H * (0.3 + rand() * 0.5);
      ctx.beginPath();
      ctx.moveTo(10, ty);
      for (let x = 10; x < W - 10; x += 30) ctx.lineTo(x, ty + (rand() - 0.5) * 9);
      ctx.stroke();
    }
  // frayed, darkened margin
  path();
  ctx.strokeStyle = 'rgba(70,38,12,0.45)';
  ctx.lineWidth = 24;
  ctx.stroke();

  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75);
  vg.addColorStop(0, 'rgba(50,30,10,0)');
  vg.addColorStop(1, 'rgba(50,30,10,0.38)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // warm lantern light from the top corners, plus soft shading toward the sides and hem
  for (const gx of [W * 0.1, W * 0.9]) {
    const lg = ctx.createRadialGradient(gx, 30, 10, gx, 30, W * 0.6);
    lg.addColorStop(0, 'rgba(255,196,110,0.3)');
    lg.addColorStop(1, 'rgba(255,196,110,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);
  }
  const sg2 = ctx.createLinearGradient(0, 0, W, 0);
  sg2.addColorStop(0, 'rgba(40,25,10,0.22)');
  sg2.addColorStop(0.15, 'rgba(40,25,10,0)');
  sg2.addColorStop(0.85, 'rgba(40,25,10,0)');
  sg2.addColorStop(1, 'rgba(40,25,10,0.22)');
  ctx.fillStyle = sg2;
  ctx.fillRect(0, 0, W, H);

  // text, centred in the space between the top hem and the swallowtail
  const TEXT = '#0d0805';
  const tw = W - 150;
  const top = 58;
  const avail = H - 105 - top;
  const layout = (level: number, draw: boolean, y0: number): number => {
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    let y = y0;
    const tSize = [54, 48, 44][level];
    ctx.font = `700 ${tSize}px ${FONT}`;
    ctx.fillStyle = TEXT;
    y += tSize;
    spacing(ctx, '3px');
    if (draw) inkText(ctx, c.title, W / 2, y);
    spacing(ctx, '0px');
    y += 16;
    if (draw) {
      ctx.fillStyle = RED;
      ctx.fillRect(W / 2 - 90, y, 180, 3);
      ctx.fillRect(W / 2 - 60, y + 7, 120, 1.5);
    }
    y += 24;
    const font = [28, 26, 24][level];
    const lh = [44, 40, 36][level];
    ctx.font = `600 ${font}px ${FONT}`;
    ctx.fillStyle = TEXT;
    for (const para of c.paragraphs) {
      for (const line of wrapLines(ctx, para, tw, 14)) {
        if (draw) inkText(ctx, line, W / 2, y + font);
        y += lh;
      }
      y += 12;
    }
    return y - 12 - y0;
  };
  let level = 0;
  while (level < 2 && layout(level, false, 0) > avail) level++;
  const textH = layout(level, false, 0);
  layout(level, true, top + Math.max(0, (avail - textH) / 2));
  ctx.restore();
}

/** Local space: +Z faces the viewer; the cloth plane sits at FACE_Z like the other boards, so the DOM mapping is shared. */
function buildBannerFrame(rand: () => number): THREE.BufferGeometry {
  const hw = BW / 2;
  const parts: THREE.BufferGeometry[] = [];
  const wood = L.PROP_COLORS.wood;
  const stone = L.PROP_COLORS.stone;
  const metal = L.PROP_COLORS.metal[0];
  const pickWood = () => wood[(rand() * wood.length) | 0];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, rz = 0, ry = 0, bright = L.SIGN_FRAME_BRIGHT) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    const ng = g.toNonIndexed();
    g.dispose();
    ng.deleteAttribute('uv');
    const base = new THREE.Color(color).multiplyScalar((0.85 + rand() * 0.3) * bright);
    const p = ng.getAttribute('position');
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const k = 0.8 + 0.2 * Math.min(1, Math.max(0, p.getY(i) / 3.3));
      cols[i * 3] = base.r * k;
      cols[i * 3 + 1] = base.g * k;
      cols[i * 3 + 2] = base.b * k;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    parts.push(ng);
  };

  const WOOD_B = 2.3; // lighter wood so the posts keep their shape against the sky
  const px = hw + 0.32;
  const boardTop = CY + BH / 2;
  const postH = boardTop + 0.55;
  const barY = boardTop + 0.1;
  for (const s of [-1, 1]) {
    const tilt = s < 0 ? 0.022 : -0.006;
    box(0.2, postH, 0.2, s * px, postH / 2, -0.02, pickWood(), tilt, 0, WOOD_B);
    box(0.15, 0.22, 0.15, s * px + tilt * -postH * 0.5, postH + 0.02, -0.02, pickWood(), tilt, 0, WOOD_B); // tapered top
    box(0.46, 0.2, 0.46, s * px, 0.1, -0.02, stone[(rand() * stone.length) | 0], 0, rand() * 1.5);
    // rope lashings where the bar meets the post
    for (let k = 0; k < 3; k++) box(0.25, 0.035, 0.25, s * px, barY - 0.09 + k * 0.09, -0.02, 0xb8955a, 0, 0, 1.6);
    // iron bracket and bolts
    box(0.07, 0.34, 0.05, s * (px - 0.14), barY, 0.1, metal, 0, 0, 2.6);
    for (const dy of [-0.11, 0.11]) box(0.06, 0.06, 0.06, s * (px - 0.14), barY + dy, 0.13, metal, 0.4, 0, 3);
  }
  box(2 * px + 0.3, 0.13, 0.12, 0, barY, -0.01, pickWood(), 0.004, 0, WOOD_B); // crossbar, one piece, barely off level
  box(BW + 0.04, 0.04, 0.05, 0, boardTop - 0.02, 0.07, 0xa08c66, 0, 0, 1.5); // rolled hem the cloth hangs from

  // thin tan rope loops over the bar (lighter than the wood, so they read)
  const loops = 7;
  for (let i = 0; i < loops; i++) {
    const x = -hw + ((i + 0.5) * 2 * hw) / loops;
    box(0.035, 0.14, 0.03, x, boardTop + 0.05, 0.09, 0xb8955a, 0, 0, 1.9);
    box(0.07, 0.035, 0.035, x, barY + 0.07, 0.09, 0xb8955a, 0, 0, 1.9); // knot over the bar
  }

  // ground detail around the footings
  box(0.9, 0.02, 0.7, 0, 0.01, 0.1, 0x2a2118, 0, 0.2, 1.2); // dirt patch
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const a = rand() * 6;
      const r = 0.42 + rand() * 0.15;
      const sz = 0.1 + rand() * 0.12;
      box(sz, sz * 0.7, sz, s * px + Math.cos(a) * r, sz * 0.3, -0.02 + Math.sin(a) * r, stone[(rand() * stone.length) | 0], rand(), rand() * 3);
    }
    for (let k = 0; k < 4; k++) {
      const a = rand() * 6;
      const r = 0.3 + rand() * 0.25;
      box(0.025, 0.12 + rand() * 0.1, 0.025, s * px + Math.cos(a) * r, 0.08, -0.02 + Math.sin(a) * r, 0x3f6b4a, (rand() - 0.5) * 0.5, 0, 1.4);
    }
  }
  box(0.4, 0.03, 0.26, px, 0.215, 0.05, 0x3f6b4a); // moss on one footing
  return mergeGeos(parts, ['position', 'normal', 'color']);
}

interface StopRow {
  chapterId: string;
  progress: number;
}

export interface AboutSign {
  group: THREE.Group;
  setContent(content: AboutContent | null): void;
  dolly(t: number, aspect: number, motion: boolean, dt: number, pos: THREE.Vector3, look: THREE.Vector3): void;
  project(camera: THREE.Camera, width: number, height: number): void;
  dispose(): void;
}

interface AboutSignOptions {
  curve: THREE.Curve<THREE.Vector3>;
  claim(x: number, z: number, r: number): void;
  anisotropy: number;
}

export function createAboutSign(opts: AboutSignOptions): AboutSign {
  const rows = stopsJson as unknown as StopRow[];
  const row = rows.find((r) => r.chapterId === ABOUT_ID) ?? rows[1] ?? rows[0];
  const stop = row.progress;
  const before = rows.filter((r) => r.progress < stop).map((r) => r.progress);
  const after = rows.filter((r) => r.progress > stop).map((r) => r.progress);
  const gapPrev = stop - (before.length ? Math.max(...before) : stop - 0.1);
  const gapNext = (after.length ? Math.min(...after) : stop + 0.1) - stop;

  const group = new THREE.Group();
  group.name = 'aboutSign';

  const T = new THREE.Vector3();
  const R = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const P = opts.curve.getPointAt(stop);
  opts.curve.getTangentAt(stop, T);
  T.y = 0;
  T.normalize();
  R.set(-T.z, 0, T.x);
  const side = ABOUT_SIDE;
  const cx = P.x + R.x * side * L.SIGN_OFFSET;
  const cz = P.z + R.z * side * L.SIGN_OFFSET;
  nrm.copy(R).multiplyScalar(-side * Math.cos(L.SIGN_YAW)).addScaledVector(T, -Math.sin(L.SIGN_YAW)).normalize();
  const M4 = new THREE.Matrix4().makeRotationY(Math.atan2(nrm.x, nrm.z)).setPosition(cx, 0, cz);

  const frameGeo = buildBannerFrame(prng(8101));
  frameGeo.applyMatrix4(M4);
  const frameMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  group.add(new THREE.Mesh(frameGeo, frameMat));

  const faceGeo = new THREE.PlaneGeometry(BW, BH);
  faceGeo.translate(0, CY, FACE_Z);
  faceGeo.applyMatrix4(M4);
  const canvas = document.createElement('canvas');
  canvas.width = BOARD_W_PX;
  canvas.height = BOARD_H_PX;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy;
  const faceMat = new THREE.MeshLambertMaterial({
    map: tex,
    alphaTest: 0.5,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: L.SIGN_EMISSIVE,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  group.add(new THREE.Mesh(faceGeo, faceMat));

  const corners = [
    [-BW / 2, CY + BH / 2],
    [BW / 2, CY + BH / 2],
    [BW / 2, CY - BH / 2],
    [-BW / 2, CY - BH / 2],
  ].map(([x, y]) => new THREE.Vector3(x, y, FACE_Z).applyMatrix4(M4));
  const center = new THREE.Vector3(0, CY, 0.07).applyMatrix4(M4);

  opts.claim(cx, cz, L.SIGN_CLAIM);
  opts.claim(P.x + R.x * side * 2.2, P.z + R.z * side * 2.2, 1.0);

  let has = false;
  let w = 0;
  let shown = false;
  const quad = new Array<number>(8).fill(0);

  const paint = (c: AboutContent | null) => {
    if (c) paintAbout(ctx, c);
    else ctx.clearRect(0, 0, BOARD_W_PX, BOARD_H_PX);
    has = !!c;
    tex.needsUpdate = true;
  };
  paint(null);

  const tmp = new THREE.Vector3();
  const v = new THREE.Vector3();
  const sendQuad = new Array<number>(8).fill(0);
  const send = (visible: boolean) =>
    window.dispatchEvent(
      new CustomEvent('board-screen', { detail: { id: ABOUT_ID, index: 0, visible, quad: visible ? quad.slice() : [], hits: [] } }),
    );

    const onRequest = () => {
        shown = false;
        };
        window.addEventListener('board-request', onRequest);

  return {
    group,
    setContent(content) {
      paint(content);
      shown = false;
    },
    dolly(t, aspect, motion, dt, pos, look) {
      if (!has) {
        w = 0;
        return;
      }
      const outer = motion ? L.SIGN_BLEND : L.SIGN_HOLD + 0.08;
      const follow = motion ? 1 - Math.exp(-dt / L.SIGN_EASE) : 1;
      const e = THREE.MathUtils.smootherstep;
      const target =
        e(t, stop - outer * gapPrev, stop - L.SIGN_HOLD * gapPrev) * (1 - e(t, stop + L.SIGN_HOLD * gapNext, stop + outer * gapNext));
      w += (target - w) * follow;
      if (w < 0.0005) w = 0;
      if (w <= 0) return;
      const dist = Math.max(L.SIGN_DIST, 3.65 / aspect) * ABOUT_PULL;
      tmp.copy(center).addScaledVector(nrm, dist);
      tmp.y = CY + 0.15;
      pos.lerp(tmp, w);
      tmp.copy(center);
      tmp.y += 0.2;
      look.lerp(tmp, w);
    },
    project(camera, width, height) {
      let ok = has && w > 0.02;
      if (ok) {
        camera.updateMatrixWorld();
        for (let k = 0; k < 4; k++) {
          v.copy(corners[k]).project(camera);
          if (v.z < -1 || v.z > 1) ok = false;
          sendQuad[k * 2] = (v.x * 0.5 + 0.5) * width;
          sendQuad[k * 2 + 1] = (0.5 - v.y * 0.5) * height;
        }
      }
      let changed = ok !== shown;
      if (ok) for (let k = 0; k < 8; k++) if (Math.abs(sendQuad[k] - quad[k]) > 0.05) changed = true;
      if (!changed) return;
      shown = ok;
      if (ok) for (let k = 0; k < 8; k++) quad[k] = sendQuad[k];
      send(ok);
    },
    dispose() {
      window.removeEventListener('board-request', onRequest);
      frameGeo.dispose();
      frameMat.dispose();
      faceGeo.dispose();
      faceMat.dispose();
      tex.dispose();
    },
  };
}