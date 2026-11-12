import * as THREE from 'three';
import * as L from './look';
import stopsJson from '../data/stops.generated.json';
import { JOB_H_PX, JOB_W_PX } from '../lib/quad';
import { JOB_BOARD_ID, type BoardHit, type JobBoardContent, type NoteContent } from '../lib/signContent';
import {
  BH,
  BW,
  CY,
  FACE_Z,
  FONT,
  GOLD,
  INK,
  M,
  PAINT,
  TOP,
  buildFrame,
  carveText,
  inkText,
  mergeGeos,
  paintInset,
  paintPaper,
  paintWood,
  prng,
  roundRect,
  spacing,
  weather,
  wrapLines,
} from './boards';

/**
 * One wide wooden job board that replaces the flat Tech Stack and More Projects cards. It reuses the signpost system
 * (frame mesh + one canvas-textured face mesh = 2 draw calls, no lights, "board-screen" events for the DOM links).
 * Left part of the sheet: the tech ledger. Right part: pinned notes for the projects without a chapter of their own.
 * The camera parks on the ledger for the `tech` stop, then slides along the board to the notes (the `more-projects`
 * stop has no baked entry; it sits halfway between `tech` and `connect`, exactly as lib/stops.ts places it).
 */

const W = JOB_W_PX;
const H = JOB_H_PX;
const BWJ = BW * 2;
const SPLIT = Math.round(W * L.JOB_SPLIT); // x where the tech zone ends
const HEAD_BOTTOM = 156; // paper starts below the heading
const BASE = 56; // clear wood under the paper
const TECH_X0 = M - 6;
const TECH_X1 = SPLIT - 18;
const TECH_CX = (TECH_X0 + TECH_X1) / 2;
const NOTE_X0 = SPLIT + 26;
const NOTE_X1 = W - M + 10;
const NOTE_CX = (NOTE_X0 + NOTE_X1) / 2;
const META_RED = '#6a2010'; // deeper oxide red for labels and meta lines: still red, holds up under the weathering pass

// ---- painting ---------------------------------------------------------------------------------------------

function nail(ctx: CanvasRenderingContext2D, cx: number, cy: number, rand: () => number) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(cx + 1.5, cy + 2, 8, 0, Math.PI * 2);
  ctx.fill();
  const ng = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 8);
  ng.addColorStop(0, '#8a4a22');
  ng.addColorStop(0.6, '#4a2410');
  ng.addColorStop(1, '#1c0e07');
  ctx.fillStyle = ng;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(120,54,20,${0.3 + rand() * 0.25})`;
  ctx.fillRect(cx - 2, cy + 6, 3.5, 18 + rand() * 30);
}

/** A vertical batten between the two halves: shaded groove, lit lip and iron nails. */
function paintDivider(ctx: CanvasRenderingContext2D, x: number, rand: () => number) {
  const y0 = 30;
  const y1 = H - 30;
  const g = ctx.createLinearGradient(x - 18, 0, x + 18, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.35, 'rgba(6,3,1,0.55)');
  g.addColorStop(0.5, 'rgba(6,3,1,0.8)');
  g.addColorStop(0.66, 'rgba(255,225,170,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 18, y0, 36, y1 - y0);
  for (const cy of [y0 + 22, H / 2, y1 - 22]) nail(ctx, x, cy, rand);
}

/** Warm lantern light on the wood behind a heading. */
function glow(ctx: CanvasRenderingContext2D, cx: number) {
  const lg = ctx.createRadialGradient(cx, TOP + 40, 20, cx, TOP + 40, 520);
  lg.addColorStop(0, 'rgba(255,185,95,0.2)');
  lg.addColorStop(1, 'rgba(255,185,95,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(cx - 520, 0, 1040, H * 0.6);
}

/** Title carved on the wood (same size as the project signs) with a double-ruled woodcut line and asterisks under it. */
function paintHeading(ctx: CanvasRenderingContext2D, title: string, cx: number, span: number) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 50px ${FONT}`;
  ctx.fillStyle = PAINT;
  carveText(ctx, wrapLines(ctx, title, span, 1)[0] ?? '', cx - 4, TOP + 48);
  const y = TOP + 66;
  const half = span / 2;
  ctx.fillStyle = 'rgba(212,161,76,0.85)';
  ctx.fillRect(cx - half + 12, y, half - 50, 2.5);
  ctx.fillRect(cx - half + 12, y + 5, half - 62, 1.2);
  ctx.fillRect(cx + 34, y, half - 46, 2.5);
  ctx.fillRect(cx + 46, y + 5, half - 58, 1.2);
  ctx.font = `700 24px ${FONT}`;
  ctx.fillStyle = GOLD;
  carveText(ctx, '* * *', cx - 2, y + 12);
  ctx.textAlign = 'left';
}

/** The tech stack as a tacked ledger: group names in red on the left, the tools in ink beside them, hand-ruled lines between. */
function paintLedger(ctx: CanvasRenderingContext2D, groups: JobBoardContent['tech']) {
  const x = TECH_X0;
  const y = HEAD_BOTTOM;
  const w = TECH_X1 - TECH_X0;
  const h = H - BASE - y;
  const pad = 34;
  const labelW = 168;
  const textX = x + pad + labelW + 12;
  const textW = x + w - pad - textX;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-0.008);
  ctx.translate(-(x + w / 2), -(y + h / 2));
  paintPaper(ctx, x, y, w, h, prng(2400), { tacks: [0, 1, 2], curl: true });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const layout = (level: number, draw: boolean): number => {
    const fs = [24, 21, 19, 17][level]; // roomiest size that fits: a short stack is not left lost on the paper
    const lh = [34, 29, 26, 23][level];
    const maxLines = [3, 3, 3, 2][level];
    let cy = y + 30;
    groups.forEach((g, i) => {
      ctx.font = `600 ${fs}px ${FONT}`;
      const rows = wrapLines(ctx, g.items.join('  ·  '), textW, maxLines);
      if (draw) {
        ctx.font = `italic 700 ${fs}px ${FONT}`;
        ctx.fillStyle = META_RED;
        const label = wrapLines(ctx, g.label, labelW, 1)[0] ?? '';
        inkText(ctx, label, x + pad, cy + fs);
        ctx.fillRect(x + pad, cy + fs + 5, Math.min(ctx.measureText(label).width, labelW), 1.4);
        ctx.font = `600 ${fs}px ${FONT}`;
        ctx.fillStyle = INK;
        rows.forEach((r, k) => inkText(ctx, r, textX, cy + fs + k * lh));
      }
      cy += Math.max(rows.length, 1) * lh + 12;
      if (draw && i < groups.length - 1) {
        ctx.save();
        ctx.translate(x + pad, cy - 7);
        ctx.rotate(i % 2 ? 0.002 : -0.0015);
        ctx.fillStyle = 'rgba(43,29,18,0.22)';
        ctx.fillRect(0, 0, w - 2 * pad, 1.2);
        ctx.restore();
      }
    });
    return cy;
  };
  const limit = y + h - 28;
  let level = 0;
  while (level < 3 && layout(level, false) > limit) level++;
  layout(level, true);
  ctx.restore();
}

/** Pinned, slightly rotated notes in a loose grid that overlaps at the edges. Returns the link hit rectangles. */
function paintNotes(ctx: CanvasRenderingContext2D, notes: NoteContent[]): BoardHit[] {
  const hits: BoardHit[] = [];
  const n = notes.length;
  if (!n) return hits;
  const zw = NOTE_X1 - NOTE_X0;
  const top = HEAD_BOTTOM - 4;
  const bottom = H - 46;
  const overlap = 8;
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cw = Math.min((zw + overlap * (cols - 1)) / cols, 470);
  const ch = Math.min((bottom - top + overlap * (rows - 1)) / rows, 310);
  const gridH = rows * ch - (rows - 1) * overlap;
  const y0 = top + (bottom - top - gridH) / 2;

  notes.forEach((note, i) => {
    const r = Math.floor(i / cols);
    const col = i % cols;
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const rowW = inRow * cw - (inRow - 1) * overlap;
    const rand = prng(3100 + i * 31);
    const x = NOTE_X0 + (zw - rowW) / 2 + col * (cw - overlap) + (rand() - 0.5) * 8;
    const y = y0 + r * (ch - overlap) + (rand() - 0.5) * 8;
    const rot = (rand() - 0.5) * 0.05;
    const cx = x + cw / 2;
    const cy = y + ch / 2;
    const links = /portfolio/i.test(note.title) ? [] : note.links;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.translate(-cx, -cy);
    paintPaper(ctx, x, y, cw, ch, prng(3300 + i * 17), { tacks: [i % 2 === 0 ? 0 : 1], kraft: i % 3 === 1 });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const px = 28;
    const tw = cw - 2 * px;
    const left = x + px;
    let ty = y + 22;

    ctx.font = `700 23px ${FONT}`;
    ctx.fillStyle = INK;
    for (const line of wrapLines(ctx, note.title, tw, 2)) {
      ty += 27;
      inkText(ctx, line, left, ty);
    }
    const metaText = [note.category, note.context ?? note.date].filter(Boolean).join('  ·  ');
    if (metaText) {
      ctx.font = `italic 700 16px ${FONT}`;
      ctx.fillStyle = META_RED;
      for (const line of wrapLines(ctx, metaText, tw, 2)) {
        ty += 20;
        inkText(ctx, line, left, ty);
      }
    }

    const linkH = links.length ? 32 : 0;
    const innerBottom = y + ch - 24;
    const linksTop = innerBottom - linkH;
    ctx.font = `700 14px ${FONT}`;
    spacing(ctx, '1.5px');
    const tools = note.tech.length ? wrapLines(ctx, `TOOLS: ${note.tech.join('  ·  ').toUpperCase()}`, tw, 3) : [];
    spacing(ctx, '0px');
    const toolsTop = (linkH ? linksTop - 8 : innerBottom) - tools.length * 18;

    if (note.summary) {
      const room = toolsTop - 6 - ty;
      const sizes: [number, number][] = [
        [19, 24],
        [18, 22],
        [17, 21],
        [16, 19],
      ];
      let fs = sizes[0][0];
      let lh = sizes[0][1];
      let lines: string[] = [];
      for (const [f, l] of sizes) {
        fs = f;
        lh = l;
        ctx.font = `600 ${f}px ${FONT}`;
        lines = wrapLines(ctx, note.summary, tw, 99);
        if (lines.length <= Math.max(1, Math.floor(room / l))) break;
      }
      ctx.font = `600 ${fs}px ${FONT}`;
      const cap = Math.max(1, Math.floor(room / lh));
      if (lines.length > cap) lines = wrapLines(ctx, note.summary, tw, cap); // last resort: ellipsis
      ctx.fillStyle = INK;
      ty += 6;
      for (const line of lines) {
        ty += lh;
        inkText(ctx, line, left, ty);
      }
    }
    if (tools.length) {
      ctx.font = `700 14px ${FONT}`;
      spacing(ctx, '1.5px');
      ctx.fillStyle = INK;
      tools.forEach((line, k) => inkText(ctx, line, left, toolsTop + 14 + k * 18));
      spacing(ctx, '0px');
    }
    if (linkH) {
      let bx = left;
      ctx.font = `700 17px ${FONT}`;
      for (const l of links) {
        const label = `${l.label} →`;
        const bw = ctx.measureText(label).width + 28;
        roundRect(ctx, bx, linksTop, bw, linkH, 5);
        ctx.fillStyle = 'rgba(18,9,4,0.7)';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = GOLD;
        ctx.stroke();
        ctx.fillStyle = GOLD;
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + 14, linksTop + linkH / 2 + 1);
        ctx.textBaseline = 'alphabetic';
        // the note is rotated about its centre: carry the button's centre through the same rotation
        const dx = bx + bw / 2 - cx;
        const dy = linksTop + linkH / 2 - cy;
        const hx = cx + dx * Math.cos(rot) - dy * Math.sin(rot);
        const hy = cy + dx * Math.sin(rot) + dy * Math.cos(rot);
        hits.push({ id: `${note.id}-${l.id}`, label: `${note.title}: ${l.label}`, href: l.href, x: hx - bw / 2, y: hy - linkH / 2, w: bw, h: linkH });
        bx += bw + 12;
      }
    }
    ctx.restore();
  });
  return hits;
}

// ---- 3D ---------------------------------------------------------------------------------------------------

interface StopRow {
  chapterId: string;
  progress: number;
}

export interface JobBoard {
  group: THREE.Group;
  /** Repaints the board. Null (or no tech and no notes) leaves it blank and out of the camera's way. */
  setContent(content: JobBoardContent | null): void;
  /** Eases the camera onto the board around the `tech` stop and slides it to the notes around `more-projects`. Mutates `pos` and `look`. */
  dolly(t: number, aspect: number, motion: boolean, dt: number, pos: THREE.Vector3, look: THREE.Vector3): void;
  /** Publishes the board's screen corners and hit rectangles for the DOM controls. Call after the camera has been placed. */
  project(camera: THREE.Camera, width: number, height: number): void;
  dispose(): void;
}

interface JobBoardOptions {
  curve: THREE.Curve<THREE.Vector3>;
  claim(x: number, z: number, r: number): void;
  anisotropy: number;
}

export function createJobBoard(opts: JobBoardOptions): JobBoard {
  const rows = stopsJson as unknown as StopRow[];
  const tA = rows.find((r) => r.chapterId === 'tech')?.progress ?? 0.9;
  const tEnd = rows.find((r) => r.chapterId === 'connect')?.progress ?? 1;
  const tPrev = Math.max(...rows.filter((r) => /^project-\d+$/.test(r.chapterId)).map((r) => r.progress), 0);
  const tB = (tA + tEnd) / 2; // lib/stops.ts: the "more" chapter sits halfway between tech and connect
  const tc = (tA + tB) / 2;
  const gapPrev = Math.max(tA - tPrev, 0.05);
  const gapAB = tB - tA;

  const group = new THREE.Group();
  group.name = 'job-board';

  // placement: beside the path, facing it, turned a little toward visitors still approaching
  const T = new THREE.Vector3();
  const R = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const P = opts.curve.getPointAt(tc);
  opts.curve.getTangentAt(tc, T);
  T.y = 0;
  T.normalize();
  R.set(-T.z, 0, T.x);
  const side = L.JOB_SIDE;
  const cx = P.x + R.x * side * L.JOB_OFFSET;
  const cz = P.z + R.z * side * L.JOB_OFFSET;
  nrm.copy(R).multiplyScalar(-side * Math.cos(L.SIGN_YAW)).addScaledVector(T, -Math.sin(L.SIGN_YAW)).normalize();
  const M4 = new THREE.Matrix4().makeRotationY(Math.atan2(nrm.x, nrm.z)).setPosition(cx, 0, cz);

  const rand = prng(5150);
  const frameGeo = buildFrame(rand, rand() < 0.5 ? -1 : 1, BWJ);
  frameGeo.applyMatrix4(M4);
  const frameMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  group.add(new THREE.Mesh(frameGeo, frameMat));

  const face = new THREE.PlaneGeometry(BWJ, BH).toNonIndexed();
  face.translate(0, CY, FACE_Z);
  face.applyMatrix4(M4);
  const faceGeo = mergeGeos([face], ['position', 'normal', 'uv']);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy;
  const faceMat = new THREE.MeshLambertMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: L.JOB_EMISSIVE,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  group.add(new THREE.Mesh(faceGeo, faceMat));

  // keep trees and rocks off the board and out of the line of sight
  for (const x of [-BW * 1.1, -BW * 0.55, 0, BW * 0.55, BW * 1.1]) {
    const c = new THREE.Vector3(x, 0, 0).applyMatrix4(M4);
    opts.claim(c.x, c.z, L.JOB_CLAIM);
  }
  for (let k = 0; k <= 8; k++) {
    const t = tA - 0.04 + ((tB - tA + 0.08) * k) / 8;
    const p = opts.curve.getPointAt(Math.min(Math.max(t, 0), 1));
    for (const d of [1.6, 2.6]) opts.claim(p.x + R.x * side * d, p.z + R.z * side * d, 1.2);
  }

  const localX = (px: number) => (px / W - 0.5) * BWJ;
  const focusA = new THREE.Vector3(localX(TECH_CX), CY, 0.07).applyMatrix4(M4);
  const focusB = new THREE.Vector3(localX(NOTE_CX), CY, 0.07).applyMatrix4(M4);
  const corners = [
    [-BWJ / 2, CY + BH / 2],
    [BWJ / 2, CY + BH / 2],
    [BWJ / 2, CY - BH / 2],
    [-BWJ / 2, CY - BH / 2],
  ].map(([x, y]) => new THREE.Vector3(x, y, FACE_Z).applyMatrix4(M4));

  let has = false;
  let hasNotes = false;
  let hits: BoardHit[] = [];
  let w = 0; // how much the camera belongs to the board (0..1)
  let s = 0; // 0 = tech half, 1 = notes half
  let shown = false;
  const quad = new Array<number>(8).fill(0);
  const sendQuad = new Array<number>(8).fill(0);

  const setContent = (c: JobBoardContent | null) => {
    ctx.save();
    paintWood(ctx, prng(2100), W, H);
    paintInset(ctx, prng(2200), W, H);
    hits = [];
    hasNotes = !!c && c.notes.length > 0;
    has = !!c && (c.tech.length > 0 || hasNotes);
    if (c) {
      if (hasNotes) paintDivider(ctx, SPLIT, prng(2250));
      if (c.tech.length) {
        glow(ctx, TECH_CX);
        paintHeading(ctx, c.techTitle, TECH_CX, TECH_X1 - TECH_X0);
        paintLedger(ctx, c.tech);
      }
      if (hasNotes) {
        glow(ctx, NOTE_CX);
        paintHeading(ctx, c.notesTitle, NOTE_CX, NOTE_X1 - NOTE_X0);
        hits = paintNotes(ctx, c.notes);
      }
    }
    weather(ctx, prng(2300), W, H); // last, over wood, paper and lettering, as on the featured signs
    ctx.restore();
    tex.needsUpdate = true;
    shown = false; // hits changed: resend on the next project()
  };
  setContent(null);

  const tmp = new THREE.Vector3();
  const v = new THREE.Vector3();
  const e = THREE.MathUtils.smootherstep;

  return {
    group,
    setContent,
    dolly(t, aspect, motion, dt, pos, look) {
      if (!has) {
        w = 0;
        return;
      }
      // Reduced motion: the same positions but a near-instant cut instead of a glide.
      const outer = motion ? L.JOB_BLEND : L.JOB_HOLD + 0.08;
      const follow = motion ? 1 - Math.exp(-dt / L.JOB_EASE) : 1;
      const last = hasNotes ? tB : tA;
      const gapNext = Math.max(tEnd - last, 0.03);
      const target = e(t, tA - outer * gapPrev, tA - L.JOB_HOLD * gapPrev) * (1 - e(t, last + L.JOB_HOLD * gapNext, last + outer * gapNext));
      w += (target - w) * follow;
      if (w < 0.0005) w = 0;
      const sTarget = !hasNotes ? 0 : motion ? e(t, tA + L.JOB_SLIDE_HOLD * gapAB, tB - L.JOB_SLIDE_HOLD * gapAB) : t >= tc ? 1 : 0;
      s += (sTarget - s) * follow;
      if (w <= 0) return;
      const dist = Math.max(L.JOB_DIST, L.JOB_VIEW_K / aspect);
      tmp.lerpVectors(focusA, focusB, s);
      v.copy(tmp).addScaledVector(nrm, dist);
      v.y = CY + 0.05;
      pos.lerp(v, w);
      tmp.y += 0.1;
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
      window.dispatchEvent(new CustomEvent('board-screen', { detail: { id: JOB_BOARD_ID, index: 0, visible: ok, quad: ok ? quad.slice() : [], hits } }));
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