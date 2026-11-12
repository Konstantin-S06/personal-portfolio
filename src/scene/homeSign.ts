import * as THREE from 'three';
import * as L from './look';
import stopsJson from '../data/stops.generated.json';
import { BOARD_W_PX, BOARD_H_PX } from '../lib/quad';
import {
  BW, BH, CY, FACE_Z, FONT, PAINT, PAINT_DIM, INK, RED, GOLD, M, TOP, BOTTOM,
  prng, spacing, roundRect, wrapLines, carveText, inkText, paintWood, paintInset, weather, paintPaper, mergeGeos,
} from './boards';

/**
 * The Home signpost: one wooden board painted with the approved Home copy and two painted buttons. It reuses the shared
 * board helpers and frame, costs 2 draw calls (merged frame + one face) and no lights. The real text and links live in
 * the DOM (HomeSignControls.tsx); the scene only publishes the board's screen corners as "board-screen".
 */

export const HOME_ID = 'home';

/** Home parks a little farther back than the project signs so the gate (chains, beam, pillars) is in view. 1 = same as signs. */
const HOME_PULL = 1.3;

export interface HomeAction {
  /** Chapter id the button navigates to. */
  id: string;
  label: string;
}

export interface HomeContent {
  stopId: string;
  kicker: string;
  title: string;
  /** Body text on the notice; the last paragraph is set in red italics. */
  paragraphs: string[];
  actions: HomeAction[];
  /** Small painted hint beside the buttons. */
  hint: string;
}

export interface HomeHit {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Carved look: dark upper-left edge and a faint lit lower-right edge under the normal carved text. */
function bevelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(8,3,0,0.7)';
  ctx.fillText(text, x - 1.5, y - 1.5);
  ctx.fillStyle = 'rgba(255,205,140,0.28)';
  ctx.fillText(text, x + 1.2, y + 1.5);
  ctx.restore();
}

function paintHome(ctx: CanvasRenderingContext2D, c: HomeContent): HomeHit[] {
  const W = BOARD_W_PX;
  const H = BOARD_H_PX;
  const maxW = W - 2 * M;
  const pm = M + 14; // text margin inside the notice
  const pw = maxW - 28;
  const LINK_H = 48;
  const linksTop = H - BOTTOM - LINK_H;
  const paperBottom = linksTop - 18;
  const limit = paperBottom - 14;

  const layout = (level: number, draw: boolean): number => {
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    let y = TOP;

    // kicker, a slightly crooked stamp
    ctx.font = `700 17px ${FONT}`;
    spacing(ctx, '3px');
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'center';
    if (draw) {
      ctx.save();
      ctx.translate(W / 2, y + 14);
      ctx.rotate(-0.012);
      bevelText(ctx, c.kicker.toUpperCase(), 0, 0);
      carveText(ctx, c.kicker.toUpperCase(), 0, 0);
      ctx.restore();
    }
    spacing(ctx, '0px');
    y += 26;

    // name, painted on the wood
    const tSize = level >= 1 ? 56 : 64;
    ctx.font = `700 ${tSize}px ${FONT}`;
    ctx.fillStyle = PAINT;
    y += tSize;
    if (draw) {
      bevelText(ctx, c.title, W / 2 - 4, y);
      carveText(ctx, c.title, W / 2 - 4, y);
    }
    y += tSize * 0.1;

    // double-ruled woodcut line with stamped asterisks
    y += 16;
    if (draw) {
      ctx.fillStyle = 'rgba(212,161,76,0.85)';
      ctx.fillRect(M + 12, y, W / 2 - M - 50, 2.5);
      ctx.fillRect(M + 12, y + 5, W / 2 - M - 62, 1.2);
      ctx.fillRect(W / 2 + 34, y, W / 2 - M - 58, 2.5);
      ctx.fillRect(W / 2 + 46, y + 5, W / 2 - M - 70, 1.2);
      ctx.font = `700 24px ${FONT}`;
      ctx.fillStyle = GOLD;
      carveText(ctx, '* * *', W / 2 - 2, y + 12);
    }
    ctx.textAlign = 'left';
    y += 24;

    // the notice, tacked on slightly askew; the text is drawn inside the same rotation
    const paperTop = y;
    const ph = paperBottom - paperTop;
    if (draw && ph > 40) {
      ctx.save();
      ctx.translate(W / 2, paperTop + ph / 2);
      ctx.rotate(-0.011);
      ctx.translate(-W / 2, -(paperTop + ph / 2));
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 9;
      ctx.fillStyle = '#000';
      ctx.fillRect(M + 6, paperTop + 10, maxW - 4, ph - 20); // hidden under the sheet; only its shadow shows
      ctx.restore();
      paintPaper(ctx, M - 6, paperTop, maxW + 12, ph, prng(520), { tacks: [0, 1, 2], curl: true });
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = 'rgba(255,210,140,0.4)';
      ctx.fillRect(M + 4, paperTop + 10, maxW, ph - 20); // inset so the torn edge never tints the wood
      ctx.restore();
    }
    y += 24;

    const font = [28, 26, 24][level];
    const lh = [37, 34, 31][level];
    c.paragraphs.forEach((para, i) => {
      const last = i === c.paragraphs.length - 1 && c.paragraphs.length > 1;
      ctx.font = `${last ? 'italic ' : ''}${font}px ${FONT}`;
      ctx.fillStyle = last ? RED : INK;
      for (const line of wrapLines(ctx, para, pw, 8)) {
        if (draw) inkText(ctx, line, pm, y + font);
        y += lh;
      }
      y += 10;
    });
    if (draw && ph > 40) ctx.restore();
    return y;
  };

  let level = 0;
  while (level < 2 && layout(level, false) > limit) level++;
  layout(level, true);
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  for (const gx of [M - 10, W - M + 10]) {
    const g = ctx.createRadialGradient(gx, TOP - 10, 10, gx, TOP - 10, W * 0.34);
    g.addColorStop(0, 'rgba(255,170,70,0.45)');
    g.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.8);
  }
  ctx.restore();

  // painted buttons (small planks nailed to the board); the real links are DOM anchors over them
  const hits: HomeHit[] = [];
  let x = M;
  ctx.textAlign = 'left';
  ctx.font = `700 23px ${FONT}`;
  c.actions.forEach((a, i) => {
    const label = `${a.label} →`;
    const w = Math.round(ctx.measureText(label).width + 44);
    ctx.save();
    if (i === 0) {
      ctx.shadowColor = 'rgba(255,170,60,0.65)';
      ctx.shadowBlur = 16;
    }
    roundRect(ctx, x, linksTop, w, LINK_H, 6);
    ctx.fillStyle = i === 0 ? '#e0a845' : 'rgba(10,5,2,0.8)';
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = i === 0 ? '#f6d98c' : GOLD;
    roundRect(ctx, x, linksTop, w, LINK_H, 6);
    ctx.stroke();
    if (i > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; // recessed: inner shadow along the top
      ctx.fillRect(x + 4, linksTop + 4, w - 8, 5);
    }
    ctx.fillStyle = i === 0 ? '#2a1405' : GOLD;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 22, linksTop + LINK_H / 2 + 1);
    hits.push({ id: a.id, label: a.label, x, y: linksTop, w, h: LINK_H });
    x += w + 16;
  });
  if (c.hint) {
    ctx.font = `italic 20px ${FONT}`;
    ctx.fillStyle = '#ecd6a4';
    ctx.textAlign = 'right';
    const tw = ctx.measureText(c.hint).width;
    carveText(ctx, c.hint, W - M, linksTop + LINK_H / 2 + 1);
    const ix = W - M - tw - 32;
    const iy = linksTop + LINK_H / 2 - 13;
    roundRect(ctx, ix, iy, 17, 27, 8.5);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ecd6a4';
    ctx.stroke();
    ctx.fillRect(ix + 7.5, iy + 6, 2.5, 7); // wheel
    ctx.textAlign = 'left';
  }
  ctx.textBaseline = 'alphabetic';
  return hits;
}

/**
 * Trailhead gate: pale stone-block pillars set well clear of the board carry a heavy beam; the board hangs from it on
 * iron chains inside a grey iron border, with a glowing lantern in each gap. One merged vertex-coloured mesh. Local
 * space: +Z faces the viewer; the board plate sits at z = 0 as in buildFrame, so the face quad and DOM mapping are unchanged.
 */
function buildGateFrame(rand: () => number, mossSide: number, width = BW): THREE.BufferGeometry {
  const hw = width / 2;
  const parts: THREE.BufferGeometry[] = [];
  const wood = L.PROP_COLORS.wood;
  const stone = L.PROP_COLORS.stone;
  const metal = L.PROP_COLORS.metal[0];
  const pickWood = () => wood[(rand() * wood.length) | 0];
  const pickStone = () => stone[(rand() * stone.length) | 0];
  const rust = () => (rand() < 0.5 ? 0x7a3a1a : 0x6a3a22);
  const box = (
    w: number, h: number, d: number, x: number, y: number, z: number, color: number, rz = 0, ry = 0,
    bright = L.SIGN_FRAME_BRIGHT, shade = true,
  ) => {
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
      const k = shade ? 0.8 + 0.2 * Math.min(1, Math.max(0, p.getY(i) / 3.3)) : 1; // darker toward the ground
      cols[i * 3] = base.r * k;
      cols[i * 3 + 1] = base.g * k;
      cols[i * 3 + 2] = base.b * k;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    parts.push(ng);
  };

  const px = hw + 0.8; // pillar centre: well clear of the board, so sky and forest show between them
  const boardTop = CY + BH / 2;
  const yb = boardTop + 0.7; // beam centre
  const postH = yb + 0.3;

  // wooden posts (as the project signs) on small stone footings
  for (const s of [-1, 1]) {
    box(0.22, postH + rand() * 0.1, 0.22, s * px, postH / 2, 0, pickWood(), s * (0.008 + rand() * 0.02));
    box(0.5, 0.22, 0.5, s * px, 0.11, 0, pickStone(), 0, rand() * 1.5);
  }
  box(0.4, 0.03, 0.26, -mossSide * px, 0.235, 0.08, 0x3f6b4a); // moss on the far footing

  // heavy beam with an iron band beside each post
  box(2 * px + 0.5, 0.3, 0.36, 0, yb, 0, pickWood());
  box(2 * px + 0.5, 0.04, 0.38, 0, yb + 0.15, 0.01, pickWood(), 0, 0, 1.4); // lit top bevel
  box(2 * px + 0.5, 0.04, 0.38, 0, yb - 0.15, 0.01, pickWood(), 0, 0, 0.6); // shaded underside

  for (const s of [-1, 1]) box(0.1, 0.34, 0.4, s * (px - 0.2), yb, 0, metal, 0, 0, 2.2);
  box(1.0, 0.03, 0.3, mossSide * 0.6, yb + 0.16, 0.02, 0x3f6b4a);

  // board: plate (hidden) plus a grey iron border with rivets, instead of the wooden trim of the project signs
  box(width + 0.12, BH + 0.1, 0.1, 0, CY, 0, pickWood());
  box(width + 0.26, 0.11, 0.12, 0, boardTop + 0.04, 0.075, metal, 0, 0, 2.2);
  box(width + 0.26, 0.11, 0.12, 0, CY - BH / 2 - 0.04, 0.075, metal, 0, 0, 2.2);
  for (const s of [-1, 1]) box(0.11, BH + 0.1, 0.12, s * (hw + 0.04), CY, 0.075, metal, 0, 0, 2.2);
  box(width + 0.26, 0.03, 0.04, 0, boardTop + 0.095, 0.14, metal, 0, 0, 3); // iron edge highlight
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) box(0.12, 0.12, 0.06, sx * (hw + 0.06), CY + sy * (BH / 2 + 0.02), 0.12, rust(), Math.PI / 4, 0, 2);
  }

  // chains: alternate links turned 90 degrees, brackets at beam and board
  const cTop = yb - 0.15;
  const cBot = boardTop + 0.1;
  const links = 4;
  const step = (cTop - cBot) / links;
  for (const s of [-1, 1]) {
    const cx = s * (hw - 0.3);
    box(0.18, 0.05, 0.22, cx, cTop - 0.02, 0.02, metal, 0, 0, 2.2);
    box(0.16, 0.06, 0.16, cx, cBot + 0.02, 0.03, metal, 0, 0, 2.2);
    for (let i = 0; i < links; i++) {
      const odd = i % 2 === 1;
      box(odd ? 0.04 : 0.1, step * 1.2, odd ? 0.1 : 0.04, cx, cTop - step * (i + 0.5), 0.03, metal, 0, 0, 2.2);
    }
  }

  // lanterns hanging in the gaps either side of the board: glowing vertex colours (no extra light, no extra draw call)
  for (const s of [-1, 1]) {
    const lx = s * (hw + 0.4);
    const ly = yb - 0.15 - 0.42;
    box(0.03, 0.2, 0.03, lx, yb - 0.27, 0.05, metal, 0, 0, 2.2, false);
    box(0.24, 0.05, 0.24, lx, ly + 0.17, 0.05, metal, 0, 0, 2.2, false);
    box(0.16, 0.22, 0.16, lx, ly, 0.05, 0xffb25a, 0, 0, 3.2, false);
    box(0.22, 0.04, 0.22, lx, ly - 0.13, 0.05, metal, 0, 0, 2.2, false);
  }
  return mergeGeos(parts, ['position', 'normal', 'color']);
}

// ---- 3D ----------------------------------------------------------------------------------------------------

interface StopRow {
  chapterId: string;
  progress: number;
}

export interface HomeSign {
  group: THREE.Group;
  /** Repaints the board. Null clears it (no camera glide, nothing published). */
  setContent(content: HomeContent | null): void;
  /** Eases the camera onto the board from the start of the walk until just past the Home stop. Mutates `pos` and `look`. */
  dolly(t: number, aspect: number, motion: boolean, dt: number, pos: THREE.Vector3, look: THREE.Vector3): void;
  /** Publishes the board's screen corners for the DOM controls. Call after the camera has been placed. */
  project(camera: THREE.Camera, width: number, height: number): void;
  dispose(): void;
}

interface HomeSignOptions {
  curve: THREE.Curve<THREE.Vector3>;
  /** Reserve ground (x, z, radius) so scatter keeps clear. */
  claim(x: number, z: number, r: number): void;
  anisotropy: number;
}

export function createHomeSign(opts: HomeSignOptions): HomeSign {
  const rows = stopsJson as unknown as StopRow[];
  const home = rows.find((r) => r.chapterId === 'home') ?? rows.reduce((a, b) => (b.progress < a.progress ? b : a));
  const stop = home.progress;
  const after = rows.filter((r) => r.progress > stop).map((r) => r.progress);
  const gapNext = (after.length ? Math.min(...after) : stop + 0.1) - stop;

  const group = new THREE.Group();
  group.name = 'homeSign';

  // placement: beside the path at the Home stop, turned a little toward visitors still approaching
  const T = new THREE.Vector3();
  const R = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const P = opts.curve.getPointAt(stop);
  opts.curve.getTangentAt(stop, T);
  T.y = 0;
  T.normalize();
  R.set(-T.z, 0, T.x); // right-hand side of the walking direction
  const side = L.HOME_SIDE;
  const cx = P.x + R.x * side * L.SIGN_OFFSET;
  const cz = P.z + R.z * side * L.SIGN_OFFSET;
  nrm.copy(R).multiplyScalar(-side * Math.cos(L.SIGN_YAW)).addScaledVector(T, -Math.sin(L.SIGN_YAW)).normalize();
  const M4 = new THREE.Matrix4().makeRotationY(Math.atan2(nrm.x, nrm.z)).setPosition(cx, 0, cz);

  const frameGeo = buildGateFrame(prng(7001), 1);
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
  opts.claim(P.x + R.x * side * 2.2, P.z + R.z * side * 2.2, 1.0); // keep the line of sight clear

  let hits: HomeHit[] = [];
  let has = false;
  let w = 0;
  let shown = false;
  const quad = new Array<number>(8).fill(0);

  const paint = (c: HomeContent | null) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, BOARD_W_PX, BOARD_H_PX);
    ctx.clip();
    paintWood(ctx, prng(9101));
    for (let sy = BOARD_H_PX / 6; sy < BOARD_H_PX - 10; sy += BOARD_H_PX / 6) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, sy, BOARD_W_PX, 3);
      ctx.fillStyle = 'rgba(255,200,130,0.12)';
      ctx.fillRect(0, sy + 3, BOARD_W_PX, 2);
    }
    paintInset(ctx, prng(9102));
    hits = c ? paintHome(ctx, c) : [];
    weather(ctx, prng(9103));
    ctx.restore();
    has = !!c;
    tex.needsUpdate = true;
  };
  paint(null);

  const tmp = new THREE.Vector3();
  const v = new THREE.Vector3();
  const sendQuad = new Array<number>(8).fill(0);
  const send = (visible: boolean) =>
    window.dispatchEvent(
      new CustomEvent('board-screen', { detail: { id: HOME_ID, index: 0, visible, quad: visible ? quad.slice() : [], hits } }),
    );

  return {
    group,
    setContent(content) {
      paint(content);
      shown = false; // hits changed: resend on the next project()
    },
    dolly(t, aspect, motion, dt, pos, look) {
      if (!has) {
        w = 0;
        return;
      }
      // Reduced motion: the same positions but a near-instant cut instead of a glide.
      const outer = motion ? L.SIGN_BLEND : L.SIGN_HOLD + 0.08;
      const follow = motion ? 1 - Math.exp(-dt / L.SIGN_EASE) : 1;
      // Parked from the very start of the walk (the page opens on this board), eased away once the Home stop is passed.
      const target = 1 - THREE.MathUtils.smootherstep(t, stop + L.SIGN_HOLD * gapNext, stop + outer * gapNext);
      w += (target - w) * follow;
      if (w < 0.0005) w = 0;
      if (w <= 0) return;
      const dist = Math.max(L.SIGN_DIST, 3.65 / aspect) * HOME_PULL;
      tmp.copy(center).addScaledVector(nrm, dist);
      tmp.y = CY + 0.25;
      pos.lerp(tmp, w);
      tmp.copy(center);
      tmp.y += 0.3;
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
      frameGeo.dispose();
      frameMat.dispose();
      faceGeo.dispose();
      faceMat.dispose();
      tex.dispose();
    },
  };
}
