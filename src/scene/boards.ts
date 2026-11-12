import * as THREE from 'three';
import * as L from './look';
import stopsJson from '../data/stops.generated.json';
import { BOARD_W_PX, BOARD_H_PX } from '../lib/quad';
import type { BoardHit, SignContent } from '../lib/signContent';

/**
 * Shared board system: wooden signposts with canvas-painted faces.
 *  - all frames (posts, plate, trim, roof, brackets, footings) are merged into ONE vertex-coloured mesh,
 *  - all faces are merged into ONE mesh that samples a single canvas atlas (one cell per sign),
 *  so any number of signs costs 2 draw calls and no lights.
 * The lettering is painted straight onto the planks (no separate panel), then weathered with the same grain
 * and wear as the wood so it reads as part of the board.
 * The scene dispatches "board-screen" ({ id, visible, quad, hits }) so the DOM can lay invisible, real links over
 * the painted buttons (same idea as the book's "book-screen"). The paint helpers below are reusable by the
 * job board, Home, About and the contact paper.
 */

const BW = 2.6; // face width, world units
const BH = (BW * BOARD_H_PX) / BOARD_W_PX;
const CY = L.SIGN_BOARD_Y;
const FACE_Z = 0.057; // just in front of the back plate

const FONT = L.BANNER_FONT_FALLBACK;
const PAINT = '#e6d5a4'; // warm bone paint: headings
const INK = '#2b1d12'; // ink on the paper notice
const RED = '#7b2a17'; // oxide red: labels and dashes on paper
const PAINT_DIM = '#c9b27e'; // secondary lettering
const GOLD = '#d4a14c'; // tarnished headings, labels, rules
const GROOVE = 'rgba(14,7,3,0.75)'; // routed grooves and carved edges
const M = 68; // text margin on the board
const TOP = 62;
const BOTTOM = 60;
const INSET = 24; // routed border distance from the board edge

// ---- small helpers ----------------------------------------------------------------------------------------

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const spacing = (ctx: CanvasRenderingContext2D, v: string) => {
  (ctx as unknown as { letterSpacing?: string }).letterSpacing = v;
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Word-wrap with a line limit; the last line gets an ellipsis if text was cut. Uses the ctx's current font. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (!cur || ctx.measureText(test).width <= maxW) cur = test;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = lines.slice(maxLines - 1).join(' ');
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

// ---- painting: wood and content ---------------------------------------------------------------------------

/** Weathered planks with grain, knots and nails, in the current (translated) cell. Mid-tone so paint reads on it. */
export function paintWood(ctx: CanvasRenderingContext2D, rand: () => number) {
  const W = BOARD_W_PX;
  const H = BOARD_H_PX;
  const planks = 4;
  const raw = Array.from({ length: planks }, () => 0.85 + rand() * 0.3);
  const sum = raw.reduce((a, b) => a + b, 0);
  let y = 0;
  for (let i = 0; i < planks; i++) {
    const ph = (raw[i] / sum) * H;
    // varied tones per plank: warm brown, charcoal-tinted, sun-bleached grey
    const tone = rand();
    ctx.fillStyle =
      tone < 0.3
        ? `hsl(${24 + rand() * 8}, ${14 + rand() * 8}%, ${27 + rand() * 5}%)` // charcoal-tinted
        : tone < 0.55
          ? `hsl(${32 + rand() * 6}, ${12 + rand() * 8}%, ${38 + rand() * 6}%)` // bleached
          : `hsl(${24 + rand() * 8}, ${28 + rand() * 8}%, ${31 + rand() * 6}%)`; // brown
    ctx.fillRect(0, y, W, ph + 1);
    // dark water stains and pale sun patches
    for (let s = 0; s < 5; s++) {
      const sx = rand() * W;
      const sy = y + rand() * ph;
      const sr = 40 + rand() * 120;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      const dark = rand() < 0.65;
      sg.addColorStop(0, dark ? `rgba(15,8,4,${0.15 + rand() * 0.2})` : `rgba(200,180,150,${0.06 + rand() * 0.08})`);
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sx - sr, Math.max(y, sy - sr), sr * 2, Math.min(ph, sr * 2));
    }
    for (let j = 0; j < 30; j++) {
      const gy = y + rand() * ph;
      const amp = 0.8 + rand() * 2.2;
      const f = 0.004 + rand() * 0.012;
      const p0 = rand() * 6;
      ctx.strokeStyle = rand() < 0.7 ? `rgba(0,0,0,${0.07 + rand() * 0.1})` : `rgba(255,220,170,${0.04 + rand() * 0.05})`;
      ctx.lineWidth = 0.8 + rand() * 1.6;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 32) {
        const yy = gy + Math.sin(x * f + p0) * amp;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    // a knot or two per plank
    for (let k = 0; k < 2; k++) {
      if (rand() < 0.5) continue;
      const kx = 120 + rand() * (W - 240);
      const ky = y + ph * (0.25 + rand() * 0.5);
      const kr = 7 + rand() * 9;
      const kg = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr * 2.2);
      kg.addColorStop(0, 'rgba(30,16,8,0.7)');
      kg.addColorStop(0.45, 'rgba(30,16,8,0.25)');
      kg.addColorStop(1, 'rgba(30,16,8,0)');
      ctx.fillStyle = kg;
      ctx.fillRect(kx - kr * 2.2, ky - kr * 2.2, kr * 4.4, kr * 4.4);
    }
    // bevel: bright top edge catching light, dark groove along the bottom
    ctx.fillStyle = 'rgba(255,225,170,0.22)';
    ctx.fillRect(0, y, W, 2);
    const bg = ctx.createLinearGradient(0, y + ph - 14, 0, y + ph);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, y + ph - 14, W, 14);
    y += ph;
    if (i < planks - 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, y - 1.5, W, 3);
      ctx.fillStyle = 'rgba(255,220,170,0.1)';
      ctx.fillRect(0, y + 1.5, W, 1.5);
    }
  }
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = `rgba(255,235,200,${0.02 + rand() * 0.04})`;
    ctx.fillRect(rand() * W, rand() * H, 6 + rand() * 30, 1 + rand() * 1.5);
  }
  // scratches, knife cuts and gouges
  for (let i = 0; i < 38; i++) {
    const x0 = rand() * W;
    const y0 = rand() * H;
    const len = 20 + rand() * 120;
    const a = (rand() - 0.5) * 1.2;
    ctx.strokeStyle = `rgba(10,5,2,${0.25 + rand() * 0.3})`;
    ctx.lineWidth = 0.8 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,225,180,0.12)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + 1.5);
    ctx.lineTo(x0 + Math.cos(a) * len, y0 + 1.5 + Math.sin(a) * len);
    ctx.stroke();
  }
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = `rgba(12,6,3,${0.45 + rand() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(rand() * W, rand() * H, 5 + rand() * 12, 2 + rand() * 4, (rand() - 0.5) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // heavy vignette and grime pooling toward the edges and corners
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, W * 0.6);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.36)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  for (const [cx, cy] of [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ]) {
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 170 + rand() * 60);
    cg.addColorStop(0, 'rgba(8,4,2,0.4)');
    cg.addColorStop(1, 'rgba(8,4,2,0)');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, W, H);
  }
  // soot streaks running down from the top edge
  for (let i = 0; i < 14; i++) {
    const sx = rand() * W;
    const sg = ctx.createLinearGradient(0, 0, 0, 40 + rand() * 110);
    sg.addColorStop(0, `rgba(8,4,2,${0.2 + rand() * 0.2})`);
    sg.addColorStop(1, 'rgba(8,4,2,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sx, 0, 3 + rand() * 10, 150);
  }
  // splintered, worn edges
  for (let i = 0; i < 60; i++) {
    const side = (rand() * 4) | 0;
    const t = rand();
    const px = side < 2 ? t * W : side === 2 ? 0 : W;
    const py = side === 0 ? 0 : side === 1 ? H : t * H;
    ctx.fillStyle = `rgba(8,4,2,${0.5 + rand() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(px, py, 3 + rand() * 9, 2 + rand() * 6, rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A routed groove border cut into the planks (dark channel with a lit lip) and iron nails in the corners. */
export function paintInset(ctx: CanvasRenderingContext2D, rand: () => number) {
  const W = BOARD_W_PX;
  const H = BOARD_H_PX;
  const x = INSET;
  const y = INSET;
  const w = W - 2 * INSET;
  const h = H - 2 * INSET;
  // recessed backboard: heavy shadow under the top beam and along the left post
  const rt = ctx.createLinearGradient(0, 0, 0, 120);
  rt.addColorStop(0, 'rgba(6,3,1,0.75)');
  rt.addColorStop(1, 'rgba(6,3,1,0)');
  ctx.fillStyle = rt;
  ctx.fillRect(0, 0, W, 120);
  const rl = ctx.createLinearGradient(0, 0, 80, 0);
  rl.addColorStop(0, 'rgba(6,3,1,0.55)');
  rl.addColorStop(1, 'rgba(6,3,1,0)');
  ctx.fillStyle = rl;
  ctx.fillRect(0, 0, 80, H);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,225,170,0.12)'; // lit lip
  ctx.lineWidth = 3;
  roundRect(ctx, x + 2, y + 3, w, h, 8);
  ctx.stroke();
  // grime settled in the groove
  ctx.strokeStyle = 'rgba(6,3,1,0.45)';
  ctx.lineWidth = 9;
  roundRect(ctx, x, y, w, h, 8);
  ctx.stroke();
  ctx.strokeStyle = GROOVE;
  ctx.lineWidth = 4;
  roundRect(ctx, x, y, w, h, 8);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(14,7,3,0.5)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x + 11, y + 11, w - 22, h - 22, 5);
  ctx.stroke();
  // nails
  for (const [cx, cy] of [
    [x - 2, y - 2],
    [x + w + 2, y - 2],
    [x + w + 2, y + h + 2],
    [x - 2, y + h + 2],
  ]) {
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
    // rust bloom and streak below the nail
    const rg = ctx.createRadialGradient(cx, cy, 6, cx, cy, 20);
    rg.addColorStop(0, 'rgba(140,64,24,0.45)');
    rg.addColorStop(1, 'rgba(140,64,24,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(cx - 20, cy - 20, 40, 40);
    ctx.fillStyle = `rgba(120,54,20,${0.35 + rand() * 0.25})`;
    ctx.fillRect(cx - 2, cy + 6, 3.5, 22 + rand() * 40);
  }
  ctx.restore();
}

/** Final wear over everything painted: grain and scuffs run across the lettering so paint and wood are one surface. */
function weather(ctx: CanvasRenderingContext2D, rand: () => number) {
  const W = BOARD_W_PX;
  const H = BOARD_H_PX;
  ctx.save();
  ctx.shadowColor = 'transparent';
  for (let j = 0; j < 46; j++) {
    const gy = rand() * H;
    const amp = 0.8 + rand() * 2;
    const f = 0.004 + rand() * 0.01;
    const p0 = rand() * 6;
    ctx.strokeStyle = `rgba(30,16,8,${0.1 + rand() * 0.14})`;
    ctx.lineWidth = 0.8 + rand() * 1.4;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 32) {
      const yy = gy + Math.sin(x * f + p0) * amp;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(40,22,10,${0.12 + rand() * 0.2})`;
    ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 3, 1 + rand() * 2);
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(40,22,10,${0.1 + rand() * 0.14})`;
    ctx.fillRect(rand() * W, rand() * H, 14 + rand() * 60, 1 + rand() * 2);
  }
  // faded, rubbed-off paint: patches where the lettering has worn thin, plus fine flaking
  for (let i = 0; i < 9; i++) {
    const fx = M + rand() * (W - 2 * M);
    const fy = TOP + rand() * (H - TOP - BOTTOM);
    const fr = 30 + rand() * 90;
    const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
    fg.addColorStop(0, `rgba(34,20,10,${0.28 + rand() * 0.22})`);
    fg.addColorStop(1, 'rgba(34,20,10,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
  }
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(34,20,10,${0.35 + rand() * 0.35})`;
    ctx.fillRect(M + rand() * (W - 2 * M), TOP + rand() * (H - TOP - BOTTOM), 1 + rand() * 2.2, 1 + rand() * 1.6);
  }
  ctx.restore();
}

const COLO_FONT = `700 15px ${FONT}`;
const COLO_LH = 23;

interface PaperOpts {
  /** Corner indices (0 TL, 1 TR, 2 BR, 3 BL) that get an iron tack. */
  tacks: number[];
  /** Lift the bottom-left corner off the board. */
  curl?: boolean;
  /** Unruled, warmer and darker manila/kraft card stock (the small slip). */
  kraft?: boolean;
}

/**
 * A weathered paper notice with torn edges, stains, a fold and burnt margins. Its shadow is tight at the tacks (pinned
 * flat) and wide along the middle of each edge (bowing away from the planks); an optional curled corner lifts off with
 * a sharper contact shadow.
 */
function paintPaper(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number, o: PaperOpts) {
  const pts: [number, number][] = [];
  const step = 34;
  const j = () => (rand() - 0.5) * 5;
  for (let px = x; px < x + w; px += step) pts.push([px, y + j()]);
  for (let py = y; py < y + h; py += step) pts.push([x + w + j(), py]);
  for (let px = x + w; px > x; px -= step) pts.push([px, y + h + j()]);
  for (let py = y + h; py > y; py -= step) pts.push([x + j(), py]);
  const path = () => {
    ctx.beginPath();
    pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
    ctx.closePath();
  };
  const corners: [number, number][] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];

  // 1) wide soft shadow, clipped away near the corners so it only bows out along the edge middles
  ctx.save();
  const cl = Math.min(70, w * 0.3, h * 0.3);
  ctx.beginPath();
  ctx.rect(x - 80, y - 80, w + 160, h + 160);
  for (const [cx, cy] of corners) ctx.rect(cx - cl, cy - cl, cl * 2, cl * 2);
  ctx.clip('evenodd');
  path();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#cdb88a';
  ctx.fill();
  ctx.restore();

  // 2) curl: a sharp, dark contact shadow beneath the lifted corner
  if (o.curl) {
    const [bx, by] = corners[3];
    const cg = ctx.createRadialGradient(bx + 14, by + 4, 2, bx + 14, by + 4, 56);
    cg.addColorStop(0, 'rgba(0,0,0,0.75)');
    cg.addColorStop(0.5, 'rgba(0,0,0,0.35)');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.fillRect(bx - 20, by - 30, 100, 80);
    // hairline: a sharp, dark sliver right where the lifted edge meets the wood
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.moveTo(bx - 1, by - 12);
    ctx.lineTo(bx + 62, by + 5);
    ctx.lineTo(bx - 1, by + 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 3) the sheet, with a tight shadow close to the board
  ctx.save();
  path();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 2.5;
  ctx.fillStyle = '#cdb88a';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, o.kraft ? '#c9a468' : '#dccb9e');
  g.addColorStop(1, o.kraft ? '#b48a4e' : '#c8b17e');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 18; i++) {
    const cx = x + rand() * w;
    const cy = y + rand() * h;
    const r = 25 + rand() * 80;
    const st = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    st.addColorStop(0, `rgba(120,80,30,${0.06 + rand() * 0.1})`);
    st.addColorStop(1, 'rgba(120,80,30,0)');
    ctx.fillStyle = st;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = rand() < 0.7 ? `rgba(70,45,20,${0.05 + rand() * 0.1})` : `rgba(255,248,225,${0.06 + rand() * 0.08})`;
    ctx.fillRect(x + rand() * w, y + rand() * h, 1 + rand() * 2.5, 1 + rand() * 1.5);
  }
  // fold creases
  if (!o.kraft) {
    ctx.fillStyle = 'rgba(70,45,20,0.16)';
    ctx.fillRect(x + w * (0.45 + rand() * 0.1), y, 2, h);
    ctx.fillStyle = 'rgba(255,245,215,0.12)';
    ctx.fillRect(x + w * 0.5 + 1, y, 1.5, h);
    ctx.fillStyle = 'rgba(70,45,20,0.12)';
    ctx.fillRect(x, y + h * (0.4 + rand() * 0.2), w, 1.6);
  }
  // burnt, darkened margins
  path();
  ctx.strokeStyle = 'rgba(70,38,12,0.4)';
  ctx.lineWidth = 26;
  ctx.stroke();
  // lifted corner: a pale underside flap folded back over the sheet
  if (o.curl) {
    const [bx, by] = corners[3];
    const f = 54;
    const fg = ctx.createLinearGradient(bx, by - f, bx + f, by);
    fg.addColorStop(0, '#b8a272');
    fg.addColorStop(1, '#eadcb2');
    ctx.fillStyle = fg;
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = -3;
    ctx.beginPath();
    ctx.moveTo(bx - 2, by - f);
    ctx.lineTo(bx + f, by + 2);
    ctx.lineTo(bx - 2, by + 2);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(60,35,12,0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx - 2, by - f);
    ctx.lineTo(bx + f, by + 2);
    ctx.stroke();
  }
  ctx.restore();

  // iron tacks, tight to the sheet
  for (const k of o.tacks) {
    const [cx, cy] = corners[k];
    const tx = cx + (k === 0 || k === 3 ? 16 : -16);
    const ty = cy + (k < 2 ? 16 : -16);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(tx + 1.2, ty + 1.8, 6.5, 0, Math.PI * 2);
    ctx.fill();
    const tg = ctx.createRadialGradient(tx - 2, ty - 2, 1, tx, ty, 7);
    tg.addColorStop(0, '#8a8078');
    tg.addColorStop(1, '#241d19');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.arc(tx, ty, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Paints one project and returns the clickable regions. The heading (number, title, date, rule) is carved/painted
 * straight onto the planks; the dense body text sits on a tacked paper notice in dark ink; the tools list is a small
 * slip pinned over the notice's bottom-right corner; links are on the wood below. If the body would overrun the notice
 * the layout tightens in up to two steps (smaller type, never an ellipsis unless it truly cannot fit).
 */
export function paintProject(ctx: CanvasRenderingContext2D, c: SignContent): BoardHit[] {
  const W = BOARD_W_PX;
  const H = BOARD_H_PX;
  const maxW = W - 2 * M;
  const pm = M + 14; // text margin inside the notice
  const pw = maxW - 28;

  // tools slip
  const slipW = Math.round(maxW * 0.58);
  ctx.font = COLO_FONT;
  spacing(ctx, '1.5px');
  const colo = c.tech.length ? wrapLines(ctx, `TOOLS: ${c.tech.join('  ·  ').toUpperCase()}`, slipW - 40, 3) : [];
  spacing(ctx, '0px');
  const slipH = colo.length ? colo.length * COLO_LH + 24 : 0;
  const slipTop = H - BOTTOM - slipH;
  const LINK_H = 44;
  const linksTop = H - BOTTOM - LINK_H;
  let paperBottom = colo.length ? slipTop + 24 : H - BOTTOM;
  if (c.links.length) paperBottom = Math.min(paperBottom, linksTop - 14);
  const limit = paperBottom - 16;

  const layout = (level: number, draw: boolean): number => {
    const T = (s: string, x: number, y: number) => {
      if (!draw) return;
      const fs = ctx.fillStyle;
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = 'rgba(255,215,160,0.2)'; // warm rim along the bottom of each stroke
      ctx.fillText(s, x, y + 1.5);
      ctx.shadowColor = 'rgba(8,4,1,0.9)'; // dark cut along the top
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = -1.6;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = fs;
      ctx.fillText(s, x, y);
      ctx.restore();
    };
    // ink pressed into paper: a pale rim below the stroke, a little bleed, a little fade
    const I = (s: string, x: number, y: number) => {
      if (!draw) return;
      const fs = ctx.fillStyle;
      ctx.save();
      ctx.fillStyle = 'rgba(255,246,220,0.45)';
      ctx.fillText(s, x, y + 1);
      ctx.shadowColor = 'rgba(43,29,18,0.45)';
      ctx.shadowBlur = 1.2;
      ctx.globalAlpha = 0.93;
      ctx.fillStyle = fs;
      ctx.fillText(s, x, y);
      ctx.restore();
    };
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    let y = TOP;

    // lantern light from above, warming the wood behind the heading
    if (draw) {
      const lg = ctx.createRadialGradient(W / 2, TOP + 40, 20, W / 2, TOP + 40, W * 0.5);
      lg.addColorStop(0, 'rgba(255,185,95,0.2)');
      lg.addColorStop(1, 'rgba(255,185,95,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, W, H * 0.6);
    }

    // header: a slightly crooked stamp, set off-grid
    ctx.font = `700 18px ${FONT}`;
    spacing(ctx, '3px');
    ctx.fillStyle = GOLD;
    if (draw) {
      ctx.save();
      ctx.translate(M + 6, y + 14);
      ctx.rotate(-0.02);
      T(`PROJECT ${c.index} OF ${c.total}`, 0, 0);
      ctx.restore();
    }
    spacing(ctx, '0px');
    y += 26;

    // title and metadata, painted on the wood
    const tSize = level >= 1 ? 42 : 50;
    ctx.font = `700 ${tSize}px ${FONT}`;
    ctx.fillStyle = PAINT;
    ctx.textAlign = 'center';
    for (const line of wrapLines(ctx, c.title, maxW, 2)) {
      y += tSize;
      T(line, W / 2 - 4, y);
      y += tSize * 0.1;
    }
    const meta = [c.date, c.category].filter(Boolean).join('  ·  ');
    ctx.font = `italic 21px ${FONT}`;
    ctx.fillStyle = PAINT_DIM;
    const withCtx = c.context ? `${meta}  ·  ${c.context}` : meta;
    const metaLine = ctx.measureText(withCtx).width <= maxW ? withCtx : meta;
    if (metaLine) {
      y += 28;
      T(metaLine, W / 2 - 2, y);
    }

    // double-ruled woodcut line that does not quite span the board, with stamped asterisks
    y += 16;
    if (draw) {
      ctx.fillStyle = 'rgba(212,161,76,0.85)';
      ctx.fillRect(M + 12, y, W / 2 - M - 50, 2.5);
      ctx.fillRect(M + 12, y + 5, W / 2 - M - 62, 1.2);
      ctx.fillRect(W / 2 + 34, y, W / 2 - M - 58, 2.5);
      ctx.fillRect(W / 2 + 46, y + 5, W / 2 - M - 70, 1.2);
      ctx.font = `700 24px ${FONT}`;
      ctx.fillStyle = GOLD;
      T('* * *', W / 2 - 2, y + 12);
    }
    ctx.textAlign = 'left';
    y += 24;

    // the notice, tacked on slightly askew; body text is drawn inside the same rotation
    const paperTop = y;
    const ph = paperBottom - paperTop;
    if (draw && ph > 40) {
      ctx.save();
      ctx.translate(W / 2, paperTop + ph / 2);
      ctx.rotate(-0.011);
      ctx.translate(-W / 2, -(paperTop + ph / 2));
      paintPaper(ctx, M - 6, paperTop, maxW + 12, ph, prng(500 + c.index), { tacks: [0, 1, 2], curl: true });
    }
    y += 20;

    const sumFont = [25, 23, 21][level];
    const sumLH = [32, 29, 26][level];
    const hiFont = [21, 20, 19][level];
    const hiLH = [27, 25, 23][level];

    // summary
    ctx.font = `${sumFont}px ${FONT}`;
    ctx.fillStyle = INK;
    for (const line of wrapLines(ctx, c.summary, pw, 3)) {
      I(line, pm, y + sumFont);
      y += sumLH;
    }
    y += 6;

    // role, as a ledger entry
    if (c.role) {
      ctx.font = `italic 700 ${hiFont}px ${FONT}`;
      const label = 'Filed under:';
      const lw = ctx.measureText(label).width + 12;
      ctx.fillStyle = RED;
      I(label, pm, y + hiFont + 1);
      if (draw) ctx.fillRect(pm, y + hiFont + 6, lw - 12, 1.4);
      ctx.font = `${hiFont + 2}px ${FONT}`;
      ctx.fillStyle = INK;
      for (const line of wrapLines(ctx, c.role, pw - lw, 2)) {
        I(line, pm + lw, y + hiFont + 1);
        y += hiLH + 2;
      }
      y += 6;
    }

    // highlights, each marked with a bold printed dash; wrapped to the full notice width, never ellipsised early
    ctx.font = `${hiFont}px ${FONT}`;
    for (const h of c.highlights.slice(0, 3)) {
      const lines = wrapLines(ctx, h, pw - 32, 3);
      if (draw) {
        ctx.save();
        ctx.translate(pm, y + hiFont * 0.6);
        ctx.rotate(-0.06);
        ctx.fillStyle = RED;
        ctx.fillRect(0, -2, 17, 4.5);
        ctx.restore();
        ctx.fillStyle = INK;
      }
      for (const line of lines) {
        I(line, pm + 32, y + hiFont);
        y += hiLH;
      }
      y += 6;
    }
    if (draw && ph > 40) ctx.restore();
    return y;
  };

  let level = 0;
  while (level < 2 && layout(level, false) > limit) level++;
  layout(level, true);

  // tools slip pinned over the notice's bottom-right corner
  if (colo.length) {
    const sx = W - M + 10 - slipW;
    ctx.save();
    ctx.translate(sx + slipW / 2, slipTop + slipH / 2);
    ctx.rotate(0.022);
    ctx.translate(-slipW / 2, -slipH / 2);
    paintPaper(ctx, 0, 0, slipW, slipH, prng(700 + c.index), { tacks: [0], kraft: true });
    ctx.font = COLO_FONT;
    spacing(ctx, '1.5px');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    colo.forEach((line, i) => {
      const ty = 14 + (i + 1) * COLO_LH - 8;
      ctx.fillStyle = 'rgba(255,246,220,0.45)';
      ctx.fillText(line, 36, ty + 1);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = INK;
      ctx.fillText(line, 36, ty);
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  // links (small planks nailed to the board, real DOM links over them)
  const hits: BoardHit[] = [];
  if (c.links.length) {
    let x = M;
    const y = linksTop;
    ctx.font = `700 21px ${FONT}`;
    for (const l of c.links) {
      const label = `${l.label} →`;
      const w = ctx.measureText(label).width + 40;
      roundRect(ctx, x, y, w, LINK_H, 6);
      ctx.fillStyle = 'rgba(18,9,4,0.55)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = GOLD;
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 20, y + LINK_H / 2 + 1);
      hits.push({ id: l.id, label: l.label, href: l.href, x, y, w, h: LINK_H });
      x += w + 14;
    }
    ctx.textBaseline = 'alphabetic';
  }
  return hits;
}

// ---- 3D: signpost geometry --------------------------------------------------------------------------------

function mergeGeos(list: THREE.BufferGeometry[], names: string[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = list[0].getAttribute(n).itemSize;
    let len = 0;
    for (const g of list) len += g.getAttribute(n).array.length;
    const arr = new Float32Array(len);
    let off = 0;
    for (const g of list) {
      const a = g.getAttribute(n).array as Float32Array;
      arr.set(a, off);
      off += a.length;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  for (const g of list) g.dispose();
  return out;
}

/** Posts, back plate, trim, little gable roof, iron brackets and stone footings. Local space: +Z faces the viewer. */
function buildFrame(rand: () => number, mossSide: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const wood = L.PROP_COLORS.wood;
  const stone = L.PROP_COLORS.stone;
  const pickWood = () => wood[(rand() * wood.length) | 0];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, rz = 0, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    const ng = g.toNonIndexed();
    g.dispose();
    ng.deleteAttribute('uv');
    const base = new THREE.Color(color).multiplyScalar((0.85 + rand() * 0.3) * L.SIGN_FRAME_BRIGHT);
    const p = ng.getAttribute('position');
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const k = 0.8 + 0.2 * Math.min(1, Math.max(0, p.getY(i) / 3.3)); // darker toward the ground
      cols[i * 3] = base.r * k;
      cols[i * 3 + 1] = base.g * k;
      cols[i * 3 + 2] = base.b * k;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    parts.push(ng);
  };

  for (const s of [-1, 1]) {
    box(0.2, 3.15 + rand() * 0.12, 0.2, s * 1.5, 1.6, -0.08, pickWood(), s * (0.01 + rand() * 0.025));
    box(0.44, 0.2, 0.44, s * 1.5, 0.1, -0.08, stone[(rand() * stone.length) | 0], 0, rand() * 1.5);
  }
  box(0.3, 0.14, 0.26, (rand() - 0.5) * 1.2, 0.07, 0.55, stone[0], 0, rand() * 2);
  box(2.72, BH + 0.1, 0.1, 0, CY, 0, pickWood());
  box(2.86, 0.11, 0.12, 0, CY + BH / 2 + 0.04, 0.075, pickWood());
  box(2.86, 0.11, 0.12, 0, CY - BH / 2 - 0.04, 0.075, pickWood());
  for (const s of [-1, 1]) box(0.11, BH + 0.1, 0.12, s * 1.34, CY, 0.075, pickWood());
  // thick top eave jutting out over the board
  box(2.98, 0.17, 0.38, 0, CY + BH / 2 + 0.15, 0.18, pickWood());
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) box(0.16, 0.16, 0.05, sx * 1.36, CY + sy * (BH / 2 + 0.02), 0.115, rand() < 0.5 ? 0x4a2a1a : 0x3a2a22); // rusted iron
  // gable roof: two sloped planks, a ridge cap and a patch of moss on one side
  for (const s of [-1, 1]) box(1.7, 0.07, 0.62, s * 0.82, 3.28, 0.12, pickWood(), -s * 0.32);
  box(0.12, 0.1, 0.66, 0, 3.56, 0.12, wood[2]);
  box(0.7, 0.03, 0.4, mossSide * 1.05, 3.255, 0.2, 0x3f6b4a, -mossSide * 0.32);
  return mergeGeos(parts, ['position', 'normal', 'color']);
}

// ---- 3D: the signpost set ---------------------------------------------------------------------------------

interface StopRow {
  chapterId: string;
  progress: number;
}

interface Sign {
  stopId: string;
  /** Walk-curve parameter of the stop (the same `p` world.ts feeds the camera). */
  t: number;
  gapPrev: number;
  gapNext: number;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  corners: THREE.Vector3[];
  hits: BoardHit[];
  has: boolean;
  w: number;
  shown: boolean;
  quad: number[];
}

export interface Signposts {
  group: THREE.Group;
  /** Repaints every board. Items are matched by `stopId`; seats without an item stay blank and are skipped. */
  setContent(items: SignContent[]): void;
  /** Eases the camera toward the sign whose stop `t` is near. Mutates `pos` and `look`. */
  dolly(t: number, aspect: number, motion: boolean, dt: number, pos: THREE.Vector3, look: THREE.Vector3): void;
  /** Publishes the board's screen corners for the DOM controls. Call after the camera has been placed. */
  project(camera: THREE.Camera, width: number, height: number): void;
  dispose(): void;
}

interface SignpostOptions {
  curve: THREE.Curve<THREE.Vector3>;
  /** Reserve ground (x, z, radius) so scatter keeps clear. */
  claim(x: number, z: number, r: number): void;
  anisotropy: number;
}

export function createSignposts(opts: SignpostOptions): Signposts {
  const rows = (stopsJson as unknown as StopRow[])
    .filter((r) => /^project-\d+$/.test(r.chapterId))
    .sort((a, b) => +a.chapterId.slice(8) - +b.chapterId.slice(8));
  const n = rows.length;

  const group = new THREE.Group();
  group.name = 'signposts';
  const signs: Sign[] = [];
  const frames: THREE.BufferGeometry[] = [];
  const faces: THREE.BufferGeometry[] = [];

  const atlasRows = Math.max(1, Math.ceil(n / 2));
  const aw = BOARD_W_PX * 2;
  const ah = BOARD_H_PX * atlasRows;

  const T = new THREE.Vector3();
  const R = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = rows[i].progress;
    const P = opts.curve.getPointAt(t);
    opts.curve.getTangentAt(t, T);
    T.y = 0;
    T.normalize();
    R.set(-T.z, 0, T.x); // right-hand side of the walking direction
    const side = i % 2 === 0 ? 1 : -1; // alternate sides so the camera swings gently left and right
    const cx = P.x + R.x * side * L.SIGN_OFFSET;
    const cz = P.z + R.z * side * L.SIGN_OFFSET;
    // face the path, turned a little toward visitors who are still approaching
    nrm.copy(R).multiplyScalar(-side * Math.cos(L.SIGN_YAW)).addScaledVector(T, -Math.sin(L.SIGN_YAW)).normalize();
    const yaw = Math.atan2(nrm.x, nrm.z);
    const M4 = new THREE.Matrix4().makeRotationY(yaw).setPosition(cx, 0, cz);

    const rand = prng(4242 + i * 97);
    const frame = buildFrame(rand, rand() < 0.5 ? -1 : 1);
    frame.applyMatrix4(M4);
    frames.push(frame);

    const face = new THREE.PlaneGeometry(BW, BH).toNonIndexed();
    const col = i % 2;
    const row = Math.floor(i / 2);
    const u0 = (col * BOARD_W_PX) / aw;
    const u1 = ((col + 1) * BOARD_W_PX) / aw;
    const v1 = 1 - (row * BOARD_H_PX) / ah;
    const v0 = 1 - ((row + 1) * BOARD_H_PX) / ah;
    const uv = face.getAttribute('uv');
    for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
    face.translate(0, CY, FACE_Z);
    face.applyMatrix4(M4);
    faces.push(face);

    const corners = [
      [-BW / 2, CY + BH / 2],
      [BW / 2, CY + BH / 2],
      [BW / 2, CY - BH / 2],
      [-BW / 2, CY - BH / 2],
    ].map(([x, y]) => new THREE.Vector3(x, y, FACE_Z).applyMatrix4(M4));

    opts.claim(cx, cz, L.SIGN_CLAIM);
    opts.claim(P.x + R.x * side * 2.2, P.z + R.z * side * 2.2, 1.0); // keep the line of sight clear

    signs.push({
      stopId: rows[i].chapterId,
      t,
      gapPrev: 0,
      gapNext: 0,
      center: new THREE.Vector3(0, CY, 0.07).applyMatrix4(M4),
      normal: nrm.clone(),
      corners,
      hits: [],
      has: false,
      w: 0,
      shown: false,
      quad: new Array<number>(8).fill(0),
    });
  }
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? signs[i].t - signs[i - 1].t : n > 1 ? signs[1].t - signs[0].t : 0.08;
    const next = i < n - 1 ? signs[i + 1].t - signs[i].t : prev;
    signs[i].gapPrev = prev;
    signs[i].gapNext = next;
  }

  const frameGeo = mergeGeos(frames, ['position', 'normal', 'color']);
  const frameMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  group.add(frameMesh);

  const canvas = document.createElement('canvas');
  canvas.width = aw;
  canvas.height = ah;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy;
  const faceGeo = mergeGeos(faces, ['position', 'normal', 'uv']);
  // Emissive keeps the lettering readable at dusk while the board still takes some light and fog.
  const faceMat = new THREE.MeshLambertMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: L.SIGN_EMISSIVE,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const faceMesh = new THREE.Mesh(faceGeo, faceMat);
  group.add(faceMesh);

  const paintAll = (items: SignContent[]) => {
    const byId = new Map(items.map((c) => [c.stopId, c]));
    signs.forEach((s, i) => {
      const c = byId.get(s.stopId);
      ctx.save();
      ctx.translate((i % 2) * BOARD_W_PX, Math.floor(i / 2) * BOARD_H_PX);
      ctx.beginPath();
      ctx.rect(0, 0, BOARD_W_PX, BOARD_H_PX);
      ctx.clip();
      paintWood(ctx, prng(900 + i));
      paintInset(ctx, prng(1300 + i));
      s.hits = c ? paintProject(ctx, c) : [];
      weather(ctx, prng(1700 + i));
      s.has = !!c;
      ctx.restore();
    });
    tex.needsUpdate = true;
  };
  paintAll([]);

  const tmp = new THREE.Vector3();
  const v = new THREE.Vector3();
  const sendQuad = new Array<number>(8).fill(0);
  const send = (s: Sign, i: number, visible: boolean) =>
    window.dispatchEvent(
      new CustomEvent('board-screen', { detail: { id: s.stopId, index: i, visible, quad: visible ? s.quad.slice() : [], hits: s.hits } }),
    );

  return {
    group,
    setContent(items) {
      paintAll(items);
      for (const s of signs) s.shown = false; // hits changed: resend on the next project()
    },
    dolly(t, aspect, motion, dt, pos, look) {
      // Reduced motion: the same positions but a near-instant cut instead of a glide.
      const outer = motion ? L.SIGN_BLEND : L.SIGN_HOLD + 0.08;
      // The blend also follows a time constant, so a fast scroll never snaps the camera onto the sign.
      const follow = motion ? 1 - Math.exp(-dt / L.SIGN_EASE) : 1;
      for (const s of signs) {
        if (!s.has) {
          s.w = 0;
          continue;
        }
        const e = THREE.MathUtils.smootherstep;
        const target =
          e(t, s.t - outer * s.gapPrev, s.t - L.SIGN_HOLD * s.gapPrev) *
          (1 - e(t, s.t + L.SIGN_HOLD * s.gapNext, s.t + outer * s.gapNext));
        s.w += (target - s.w) * follow;
        if (s.w < 0.0005) s.w = 0;
        const w = s.w;
        if (w <= 0) continue;
        const dist = Math.max(L.SIGN_DIST, 3.65 / aspect);
        tmp.copy(s.center).addScaledVector(s.normal, dist);
        tmp.y = CY + 0.05;
        pos.lerp(tmp, w);
        tmp.copy(s.center);
        tmp.y += 0.1;
        look.lerp(tmp, w);
      }
    },
    project(camera, width, height) {
      let updated = false;
      signs.forEach((s, i) => {
        let ok = s.has && s.w > 0.02;
        if (ok) {
          if (!updated) {
            camera.updateMatrixWorld();
            updated = true;
          }
          for (let k = 0; k < 4; k++) {
            v.copy(s.corners[k]).project(camera);
            if (v.z < -1 || v.z > 1) ok = false;
            sendQuad[k * 2] = (v.x * 0.5 + 0.5) * width;
            sendQuad[k * 2 + 1] = (0.5 - v.y * 0.5) * height;
          }
        }
        let changed = ok !== s.shown;
        if (ok) for (let k = 0; k < 8; k++) if (Math.abs(sendQuad[k] - s.quad[k]) > 0.05) changed = true;
        if (!changed) return;
        s.shown = ok;
        if (ok) for (let k = 0; k < 8; k++) s.quad[k] = sendQuad[k];
        send(s, i, ok);
      });
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