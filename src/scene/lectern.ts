import * as THREE from 'three';
import * as L from './look';
import { FONT, GOLD, INK, inkText, mergeGeos, paintPaper, paintWood, prng, roundRect, weather } from './boards';

/**
 * Contact lectern: a small weathered wooden stand with a slanted desk. Frame (stand, desk slab, lip, rails, inkwell,
 * quill) is ONE merged vertex-coloured mesh; the desk top is ONE canvas-textured plane carrying the wood, the parchment
 * sheet and the painted form. 2 draw calls, no lights.
 *
 * Standalone: not wired into the world yet. world.ts will pass the fire position, the walk curve and its `claim`.
 * The DOM controls (ContactPaperControls, stage 2) listen for the 'board-screen' event with id CONTACT_PAPER_ID.
 * Its quad is the screen-space corners (TL, TR, BR, BL) of the PAPER rectangle, so map a
 * CONTACT_SHEET_W x CONTACT_SHEET_H element onto it with quadMatrix and place inputs using CONTACT_FIELDS.
 */

export const CONTACT_PAPER_ID = 'contact-paper';

type Rect = { x: number; y: number; w: number; h: number };
/** Control rectangles in sheet px (origin = paper top-left). Painted here, overlaid by real DOM controls. */
export const CONTACT_FIELDS: Record<'name' | 'email' | 'message' | 'send', Rect> = {
  name: { x: 44, y: 118, w: 712, h: 52 },
  email: { x: 44, y: 208, w: 712, h: 52 },
  message: { x: 44, y: 298, w: 712, h: 196 },
  send: { x: 536, y: 530, w: 220, h: 54 },
};

/** The sheet in world space, for the bird/scroll animation (stage 3). Vectors are unit length, in world space. */
export interface LecternPaperPose {
  center: THREE.Vector3;
  /** Surface normal (points up and toward the viewer). */
  normal: THREE.Vector3;
  /** Direction along the desk's slope toward its high edge. */
  up: THREE.Vector3;
  right: THREE.Vector3;
  /** Sheet size in world units. */
  width: number;
  height: number;
}

export interface Lectern {
  group: THREE.Group;
  paperPose: LecternPaperPose;
  /** Repaints the desk with or without the sheet (false once the bird has taken it). */
  setPaperVisible(visible: boolean): void;
  /** 0..1: how much the camera belongs to the lectern. The DOM quad is only published while this is above ~0.02. */
  setFocus(w: number): void;
  /** Publishes the paper's screen corners for the DOM controls. Call after the camera has been placed. */
  project(camera: THREE.Camera, width: number, height: number): void;
  dispose(): void;
}

interface LecternOptions {
  /** The walk curve; its end (t = 1) is where the camera stands for Contact. */
  curve: THREE.Curve<THREE.Vector3>;
  /** Campfire position (ground level). */
  fireAt: THREE.Vector3;
  claim(x: number, z: number, r: number): void;
  anisotropy: number;
}

const CW = L.CONTACT_TEX_W;
const CH = L.CONTACT_TEX_H;
const PPU = L.CONTACT_PX_PER_UNIT;
const PW = L.CONTACT_SHEET_W;
const PH = L.CONTACT_SHEET_H;
const PX = (CW - PW) / 2;
const PY = (CH - PH) / 2;
const DW = CW / PPU;
const DD = CH / PPU;
const FACE_N = 0.039; // texture plane sits just above the slab's top face
const META_RED = '#6a2010';

function paintForm(ctx: CanvasRenderingContext2D) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 38px ${FONT}`;
  ctx.fillStyle = INK;
  inkText(ctx, 'Send a message', 44, 64);
  ctx.fillStyle = 'rgba(43,29,18,0.35)';
  ctx.fillRect(44, 78, PW - 88, 1.4);

  const labels: [keyof typeof CONTACT_FIELDS, string][] = [
    ['name', 'Name'],
    ['email', 'Email'],
    ['message', 'Message'],
  ];
  for (const [key, label] of labels) {
    const f = CONTACT_FIELDS[key];
    ctx.font = `italic 700 20px ${FONT}`;
    ctx.fillStyle = META_RED;
    inkText(ctx, label, f.x, f.y - 10);
    ctx.fillStyle = 'rgba(43,29,18,0.07)';
    ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.fillStyle = 'rgba(43,29,18,0.55)';
    ctx.fillRect(f.x, f.y + f.h - 2, f.w, 1.8);
  }

  const s = CONTACT_FIELDS.send;
  roundRect(ctx, s.x, s.y, s.w, s.h, 5);
  ctx.fillStyle = 'rgba(18,9,4,0.7)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  ctx.font = `700 22px ${FONT}`;
  ctx.fillStyle = GOLD;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Send →', s.x + s.w / 2, s.y + s.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export function createLectern(opts: LecternOptions): Lectern {
  const group = new THREE.Group();
  group.name = 'contact-lectern';

  // placement: between the camera's end of the path and the fire, to the viewer's right of the fire, facing the camera
  const cam = opts.curve.getPointAt(1);
  const d = new THREE.Vector3(cam.x - opts.fireAt.x, 0, cam.z - opts.fireAt.z);
  if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
  d.normalize();
  const r = new THREE.Vector3(d.z, 0, -d.x);
  const lx = opts.fireAt.x + d.x * L.CONTACT_FIRE_DIST + r.x * L.CONTACT_SIDE;
  const lz = opts.fireAt.z + d.z * L.CONTACT_FIRE_DIST + r.z * L.CONTACT_SIDE;
  const toCam = new THREE.Vector3(cam.x - lx, 0, cam.z - lz);
  if (toCam.lengthSq() < 1e-6) toCam.copy(d);
  toCam.normalize();
  const M4 = new THREE.Matrix4().makeRotationY(Math.atan2(toCam.x, toCam.z)).setPosition(lx, 0, lz);
  opts.claim(lx, lz, L.CONTACT_CLAIM);
  opts.claim(lx + toCam.x * 1.2, lz + toCam.z * 1.2, L.CONTACT_CLAIM * 0.7);

  // ---- frame ----
  const rand = prng(7000);
  const parts: THREE.BufferGeometry[] = [];
  const wood = L.PROP_COLORS.wood;
  const stone = L.PROP_COLORS.stone;
  const add = (g: THREE.BufferGeometry, color: number, moss = false) => {
    const ng = g.toNonIndexed();
    g.dispose();
    ng.deleteAttribute('uv');
    const base = new THREE.Color(color).multiplyScalar((0.85 + rand() * 0.3) * L.SIGN_FRAME_BRIGHT);
    const mossCol = new THREE.Color(0x3d5a3a).multiplyScalar(L.SIGN_FRAME_BRIGHT * 0.8);
    const p = ng.getAttribute('position');
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i += 3) {
      const jit = 0.84 + rand() * 0.32; // per-face variation (flat shading shows it as weathered facets)
      const mossy = moss && rand() < 0.3;
      for (let j = 0; j < 3; j++) {
        const k = (0.8 + 0.2 * Math.min(1, Math.max(0, p.getY(i + j) / 1.6))) * jit;
        const c = mossy ? base.clone().lerp(mossCol, 0.55) : base;
        cols[(i + j) * 3] = c.r * k;
        cols[(i + j) * 3 + 1] = c.g * k;
        cols[(i + j) * 3 + 2] = c.b * k;
      }
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    parts.push(ng);
  };
  const box = (w: number, h: number, dd: number, x: number, y: number, z: number, color: number, rz = 0, ry = 0, moss = false) => {
    const g = new THREE.BoxGeometry(w, h, dd);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    add(g, color, moss);
  };
  // desk-local box: x across, n along the desk normal, s down the slope (+s = toward the low front edge)
  const deskBox = (w: number, nn: number, ss: number, x: number, n: number, s: number, color: number) => {
    const g = new THREE.BoxGeometry(w, nn, ss);
    g.translate(x, n, s);
    g.rotateX(L.CONTACT_TILT);
    g.translate(0, L.CONTACT_DESK_Y, 0);
    add(g, color);
  };

  const iron = L.PROP_COLORS.metal[0];
  // stone foundation: two stepped tiers plus loose rubble, mossy in patches
  box(0.88, 0.12, 0.88, 0, 0.06, 0, stone[0], 0, rand() * 0.4, true);
  box(0.64, 0.1, 0.64, 0, 0.17, 0, stone[2], 0, rand() * 0.6, true);
  box(0.3, 0.12, 0.26, 0.56, 0.06, 0.3, stone[1], 0, rand() * 2, true);
  box(0.2, 0.09, 0.22, -0.55, 0.045, -0.3, stone[2], 0, rand() * 2, true);
  box(0.16, 0.07, 0.18, -0.46, 0.035, 0.52, stone[0], 0, rand() * 2, true);
  // timber plinth, collar, post, collar
  box(0.46, 0.1, 0.46, 0, 0.27, 0, wood[1]);
  box(0.34, 0.08, 0.34, 0, 0.36, 0, wood[2]);
  box(0.26, 0.78, 0.26, 0, 0.67, 0, wood[0], 0.01 + rand() * 0.02);
  box(0.36, 0.08, 0.36, 0, 1.02, 0, wood[1]);
  // iron bands on the post
  box(0.29, 0.04, 0.29, 0, 0.5, 0, iron);
  box(0.29, 0.04, 0.29, 0, 0.86, 0, iron);
  // splayed struts with foot blocks, and a cross bar
  for (const s of [-1, 1]) {
    box(0.08, 0.55, 0.08, s * 0.22, 0.62, 0, wood[2], -s * 0.45);
  }
  box(0.44, 0.05, 0.05, 0, 0.45, 0.1, wood[1]);
  deskBox(0.9, 0.1, 0.14, 0, -0.09, 0.05, wood[2]);
  deskBox(0.22, 0.12, 0.17, 0, -0.09, 0.05, L.PROP_COLORS.metal[0]);
  deskBox(DW + 0.12, 0.07, DD + 0.1, 0, 0, 0, wood[0]);
  deskBox(DW + 0.12, 0.06, 0.07, 0, 0.06, DD / 2 + 0.02, wood[2]); // front lip
  for (const s of [-1, 1]) deskBox(0.05, 0.05, DD + 0.1, s * (DW / 2 + 0.03), 0.055, 0, wood[1]);
  for (const x of [-0.55, 0.55]) deskBox(0.05, 0.03, 0.05, x, 0.1, DD / 2 + 0.02, 0x4a2a1a); // rusted nails
  deskBox(0.09, 0.09, 0.09, 0.71, 0.08, -0.35, 0x15110e); // inkwell
  deskBox(0.015, 0.015, 0.28, 0.72, 0.045, 0.1, L.PROP_COLORS.parchment[0]); // quill

  const frameGeo = mergeGeos(parts, ['position', 'normal', 'color']);
  frameGeo.applyMatrix4(M4);
  const frameMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  group.add(new THREE.Mesh(frameGeo, frameMat));

  // ---- desk face ----
  const deskM = new THREE.Matrix4().makeTranslation(0, L.CONTACT_DESK_Y, 0).multiply(new THREE.Matrix4().makeRotationX(L.CONTACT_TILT));
  const full = M4.clone().multiply(deskM);
  const face = new THREE.PlaneGeometry(DW, DD).rotateX(-Math.PI / 2).translate(0, FACE_N, 0).toNonIndexed();
  face.applyMatrix4(full);
  const faceGeo = mergeGeos([face], ['position', 'normal', 'uv']);

  const canvas = document.createElement('canvas');
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy;
  const faceMat = new THREE.MeshLambertMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: L.CONTACT_EMISSIVE,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  group.add(new THREE.Mesh(faceGeo, faceMat));

  // ---- paper geometry in world space ----
  const surf = (px: number, py: number) =>
    new THREE.Vector3((px / CW - 0.5) * DW, FACE_N, -(0.5 - py / CH) * DD).applyMatrix4(full);
  const corners = [surf(PX, PY), surf(PX + PW, PY), surf(PX + PW, PY + PH), surf(PX, PY + PH)];
  const paperPose: LecternPaperPose = {
    center: surf(CW / 2, CH / 2),
    normal: new THREE.Vector3(0, 1, 0).transformDirection(full),
    up: new THREE.Vector3(0, 0, -1).transformDirection(full),
    right: new THREE.Vector3(1, 0, 0).transformDirection(full),
    width: PW / PPU,
    height: PH / PPU,
  };

  let hasPaper = true;
  let focus = 0;
  let shown = false;
  const quad = new Array<number>(8).fill(0);
  const sendQuad = new Array<number>(8).fill(0);
  const v = new THREE.Vector3();

  const paint = () => {
    ctx.save();
    paintWood(ctx, prng(7100), CW, CH);
    if (hasPaper) {
      paintPaper(ctx, PX, PY, PW, PH, prng(7200), { tacks: [0, 1, 2, 3] });
      ctx.save();
      ctx.translate(PX, PY);
      paintForm(ctx);
      ctx.restore();
    }
    weather(ctx, prng(7300), CW, CH);
    ctx.restore();
    tex.needsUpdate = true;
  };
  paint();

  return {
    group,
    paperPose,
    setPaperVisible(visible) {
      if (visible === hasPaper) return;
      hasPaper = visible;
      paint();
      shown = false; // resend visibility on the next project()
    },
    setFocus(w) {
      focus = w;
    },
    project(camera, width, height) {
      let ok = hasPaper && focus > 0.02;
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
      window.dispatchEvent(
        new CustomEvent('board-screen', { detail: { id: CONTACT_PAPER_ID, index: 0, visible: ok, quad: ok ? quad.slice() : [], hits: [] } }),
      );
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