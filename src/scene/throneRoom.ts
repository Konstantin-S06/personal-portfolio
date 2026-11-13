import * as THREE from 'three';

/**
 * Ruined temple court at the end of the path (v3). No outer box: a broken gate with ragged wall stubs, a
 * colonnade of intact and fallen pillars with hanging lanterns, moon shafts, a tiled avenue with a carpet and
 * glowing inlay, a stepped dais carrying a LECTERN with an open BOOK, a ruined arch with a rune disc behind
 * it, and a ring of standing stones. The throne is gone.
 *
 * Local frame: x = right, y = up, z = backward, so a point at distance u along the walking direction has
 * z = -u. The court starts where the forest curve ends.
 *
 * Window events IN:
 *   "chat-speaking"  detail: boolean                  pulses the glow (book, runes, stones, light)
 *   "chat-message"   detail: { role: 'user' | 'assistant', text: string }   writes a page and turns to it
 *   "chat-reset"                                       clears the book back to the title page
 *   "book-nav"       detail: 'prev' | 'next' | 'first' | 'last'   turns pages to read history
 * Window events OUT:
 *   "book-state"     detail: { index, count, canPrev, canNext }   so the chat panel can enable its buttons
 *
 * Public interface of createThroneRoom is unchanged, so world.ts needs no edits.
 */

const U_GATE = 20;
const GATE_V = 2.9; // gate pillars sit at +-GATE_V
const GATE_H = 7;
const COL_V = 4.8;
const COL_US = [24, 28.5, 33, 37.5, 42];
const AVENUE_HALF = 3.7;
const STONE_C = 47; // centre of the standing-stone ring
const MONO_R = 9.5;
const ARCH_U = 52.5;

// Camera route pacing: always moving. Speed never drops to zero, so every scroll step moves the camera.
const routeE = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * 0.8 + c * c * (3 - 2 * c) * 0.2;
};

// ---- lectern tunables --------------------------------------------------------------------------------------
const LECT_U = 47.3; // distance of the lectern along the court
const LECT_S = 0.85; // lectern scale. 1.0 = the approved preview size
const DESK_TILT = 0.38;
const BOOK_LIFT = 0.05; // the book sits this far above the desk, so the page stack and cover slab have thickness
const BOOK_Y = 0.9 + LECT_S * (3.12 + BOOK_LIFT); // world height of the book centre
const CAM_END_U = LECT_U - 1.1; // the camera finishes this far along, above and in front of the book
const CAM_END_Y = BOOK_Y + 1.25; // higher = looks down on the pages more squarely (more readable), lower = more cinematic
const LIGHT_BASE = 50;

// ---- book page layout --------------------------------------------------------------------------------------
const PAGE_W_PX = 512;
const PAGE_H_PX = 704;
const PAGE_MARGIN = 28;
const LINE_H = 27;
const TEXT_TOP = 60;
const LINES_PER_PAGE = 17; // the foot of each page is left free for the input, buttons and chips
const FONT_BODY = '21px Georgia, "Times New Roman", serif';
const FONT_USER = 'italic 21px Georgia, "Times New Roman", serif';
const FONT_LEAD = 'bold 21px Georgia, "Times New Roman", serif';
const FONT_META = 'italic 16px Georgia, "Times New Roman", serif';
const BULLET_IN = 20; // bullet text is indented this far
const PARA_INDENT = 22; // first line of a long paragraph
// Line prefixes (control characters) mark a line's style: 1 lead, 2 bullet start, 3 bullet continuation, 4 detail.

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

const glowTexture = () =>
  canvasTex(64, (g, S) => {
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  });

/** Soft vertical beam: bright in the middle, fading at the sides and at both ends. */
function shaftTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(255,255,255,0)');
  h.addColorStop(0.5, 'rgba(255,255,255,1)');
  h.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 128);
  g.globalCompositeOperation = 'destination-in';
  const v = g.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.3, 'rgba(0,0,0,1)');
  v.addColorStop(0.7, 'rgba(0,0,0,0.6)');
  v.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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

// ===========================================================================================================
// Chat book: pages, layout, painting
// ===========================================================================================================

type Role = 'user' | 'assistant';
interface Page {
  kind: 'blank' | 'title' | Role;
  lines: string[];
  first: boolean;
  num: number;
  /** Characters shown so far (Infinity = all). Drives the writing-in effect for answers. */
  reveal: number;
  /** Index of the exchange this page starts the answer for, else -1. */
  answer: number;
  /** Placeholder shown between sending a question and the answer arriving. */
  pending: boolean;
  /** The answer carries on onto the next page: a note is painted at the foot. */
  more: boolean;
}
interface PageTex {
  ink: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
  ci: CanvasRenderingContext2D;
  cg: CanvasRenderingContext2D;
}

export interface BookState {
  /** Spread number: 0 is the title page, 1 the first question and answer, and so on. */
  index: number;
  count: number;
  canPrev: boolean;
  canNext: boolean;
  turning: boolean;
  /** Exchange whose answer starts on the right page of this spread, else -1. */
  answer: number;
}

const measureCtx = document.createElement('canvas').getContext('2d')!;

function wrapText(text: string, font: string, maxW: number): string[] {
  measureCtx.font = font;
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (let word of para.split(/\s+/)) {
      if (!word) continue;
      while (measureCtx.measureText(word).width > maxW) {
        // break a very long word (URL, identifier) across lines
        let k = word.length - 1;
        while (k > 1 && measureCtx.measureText(word.slice(0, k)).width > maxW) k--;
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(word.slice(0, k));
        word = word.slice(k);
      }
      const test = line ? line + ' ' + word : word;
      if (line && measureCtx.measureText(test).width > maxW) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/** Answer text -> styled lines. First paragraph is the lead when bullets follow; "- " is a bullet; "~ " is a detail line. */
function layoutAnswer(text: string, W: number): string[] {
  const out: string[] = [];
  const paras = text.split('\n');
  const lead = paras.some((q) => q.startsWith('- '));
  const explicit = paras.some((q) => q.startsWith('^ '));
  let first = true;
  for (const para of paras) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    if (para.startsWith('- ')) {
      wrapText(para.slice(2), FONT_BODY, W - BULLET_IN).forEach((l, i) => out.push((i ? '\x03' : '\x02') + l));
    } else if (para.startsWith('~ ')) {
      wrapText(para.slice(2), FONT_META, W - BULLET_IN).forEach((l) => out.push('\x04' + l));
    } else if (para.startsWith('^ ')) {
      wrapText(para.slice(2), FONT_LEAD, W).forEach((l) => out.push('\x01' + l));
    } else if (first && lead && !explicit) {
      wrapText(para, FONT_LEAD, W).forEach((l) => out.push('\x01' + l));
    } else if (para.length > 80) {
      const flat = para.split(/\s+/).filter(Boolean).join(' ');
      const head = wrapText(flat, FONT_BODY, W - PARA_INDENT)[0] ?? '';
      out.push('\x05' + head);
      out.push(...wrapText(flat.slice(head.length).trim(), FONT_BODY, W));
    } else {
      out.push(...wrapText(para, FONT_BODY, W));
    }
    first = false;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

const cleanText = (t: string) =>
  t
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\r/g, '')
    .trim();

/** What is typed in the question field. Painted on the right-hand page; the real input is an invisible hit area. */
const inputState = { text: '', focus: false, caret: 0, blink: true };

const FOOT_M = 28;
/** Which Page buttons can be used on the spread on screen; unusable ones are painted dimmed. */
const navState = { prev: false, next: false };

const PAPER_ASH = '#b8aa85';
const PAPER_SEED = (Math.random() * 1e6) | 0;
const INK = '#10141c';
const INK_SOFT = '#343c4a';
const INK_RED = '#1b5953';
const SERIF = 'Georgia, "Times New Roman", serif';

function diamond(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fill();
}

/** Text with extra letter spacing (canvas letterSpacing is not available everywhere). */
function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, gap: number, align: CanvasTextAlign = 'left') {
  let w = -gap;
  for (const ch of text) w += g.measureText(ch).width + gap;
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const prev = g.textAlign;
  g.textAlign = 'left';
  for (const ch of text) {
    g.fillText(ch, cx, y);
    cx += g.measureText(ch).width + gap;
  }
  g.textAlign = prev;
}

/** A hairline with a small diamond ornament in the middle. */
function ornamentRule(g: CanvasRenderingContext2D, x0: number, x1: number, y: number) {
  const mid = (x0 + x1) / 2;
  g.save();
  g.fillStyle = INK_SOFT;
  g.globalAlpha = 0.6;
  g.fillRect(x0, y, mid - 22 - x0, 1.2);
  g.fillRect(mid + 22, y, x1 - mid - 22, 1.2);
  g.globalAlpha = 0.9;
  diamond(g, mid, y + 0.6, 4.5);
  diamond(g, mid - 12, y + 0.6, 2.2);
  diamond(g, mid + 12, y + 0.6, 2.2);
  g.restore();
}

// --- ashen, scorched parchment, painted once per side and cached -------------------------------------------------------
const paperCache: Record<string, HTMLCanvasElement> = {};
function paperCanvas(rightPage: boolean, variant = 0): HTMLCanvasElement {
  const key = (rightPage ? 'R' : 'L') + variant;
  const hit = paperCache[key];
  if (hit) return hit;
  const W = PAGE_W_PX;
  const H = PAGE_H_PX;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rnd = rng((rightPage ? 7 : 13) + variant * 977 + PAPER_SEED);
  g.fillStyle = PAPER_ASH;
  g.fillRect(0, 0, W, H);
  const blot = (x: number, y: number, r: number, rgb: string, a: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rgb},${a})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  };
  for (let i = 0; i < 36; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 40 + rnd() * 130;
    const k = rnd();
    if (k < 0.45) blot(x, y, r, '70,48,22', 0.06 + rnd() * 0.09); // old stain
    else if (k < 0.8) blot(x, y, r, '120,118,108', 0.07 + rnd() * 0.08); // ash
    else blot(x, y, r * 0.7, '205,192,160', 0.08 + rnd() * 0.08); // faded patch
  }
  g.lineWidth = 1;
  for (let i = 0; i < 700; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const a = rnd() * Math.PI;
    const l = 3 + rnd() * 9;
    g.strokeStyle = `rgba(60,42,22,${0.05 + rnd() * 0.08})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(40,26,12,${0.1 + rnd() * 0.16})`;
    g.beginPath();
    g.arc(rnd() * W, rnd() * H, 0.5 + rnd() * 1, 0, Math.PI * 2);
    g.fill();
  }
  // a thin singed border only: the text area, the running heads and the footer all stay on clean parchment
  const burn = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number, a: number) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, `rgba(28,16,7,${a})`);
    gr.addColorStop(1, 'rgba(28,16,7,0)');
    g.fillStyle = gr;
    g.fillRect(rx, ry, rw, rh);
  };
  burn(0, 0, 0, 22, 0, 0, W, 22, 0.5);
  burn(0, H, 0, H - 22, 0, H - 22, W, 22, 0.5);
  burn(0, 0, 22, 0, 0, 0, 22, H, 0.45);
  burn(W, 0, W - 22, 0, W - 22, 0, 22, H, 0.45);
  // small ragged scorch marks hugging the edges
  for (let i = 0; i < 22; i++) {
    const side = Math.floor(rnd() * 4);
    const t = rnd();
    const x = side === 0 ? t * W : side === 1 ? W : side === 2 ? t * W : 0;
    const y = side === 0 ? 0 : side === 1 ? t * H : side === 2 ? H : t * H;
    blot(x, y, 10 + rnd() * 20, '22,12,5', 0.3 + rnd() * 0.25);
  }
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) blot(x, y, 52, '18,9,3', 0.5);
  // the gutter side darkens a little toward the spine (kept narrow so the first letters of each line stay clear)
  if (rightPage) burn(0, 0, 120, 0, 0, 0, 120, H, 0.34);
  else burn(W, 0, W - 120, 0, W - 120, 0, 120, H, 0.34);
    // heavy vignette: the edges darken and brown, the middle stays clean for the text
    {
      const vg = g.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.74);
      vg.addColorStop(0, 'rgba(34,20,8,0)');
      vg.addColorStop(1, 'rgba(34,20,8,0.5)');
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
    }
    g.lineWidth = 1;
    for (let i = 0; i < 5; i++) { // old fold creases
      const x = rnd() * W;
      const y = rnd() * H;
      g.strokeStyle = `rgba(40,28,14,${0.07 + rnd() * 0.07})`;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 220, y + (rnd() - 0.5) * 260);
      g.stroke();
    }
    for (let i = 0; i < 900; i++) { // soot and ash flecks
      g.fillStyle = rnd() < 0.5 ? `rgba(20,12,6,${0.08 + rnd() * 0.14})` : `rgba(140,134,120,${0.06 + rnd() * 0.1})`;
      g.fillRect(rnd() * W, rnd() * H, 0.6 + rnd() * 1.4, 0.6 + rnd() * 1.4);
    }
  g.save();
  g.globalCompositeOperation = 'color'; // keeps the stains and burns, shifts the hue toward slate
  g.globalAlpha = 0.6;
  g.fillStyle = '#5d7c8a';
  g.fillRect(0, 0, W, H);
  g.restore();
  paperCache[key] = c;
  return c;
}

// --- page-block edge: fine leaf lines, a touch darker than the page face, shaded under the page and against the cover ---
let pageEdgeTex: THREE.CanvasTexture | null = null;
function pageEdgeTexture(): THREE.CanvasTexture {
  if (pageEdgeTex) return pageEdgeTex;
  const H = 48;
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = H;
  const g = c.getContext('2d')!;
  const rnd = rng(11);
  for (let y = 0; y < H; y++) {
    const v = 70 + rnd() * 22;
    g.fillStyle = `rgb(${Math.round(v - 8)},${Math.round(v + 2)},${Math.round(v + 4)})`;
    g.fillRect(0, y, 16, 1);
    if (y % 3 === 1) {
      g.fillStyle = 'rgba(8,12,18,0.28)'; // the gap between leaves
      g.fillRect(0, y, 16, 1);
    }
  }
  const sh = g.createLinearGradient(0, 0, 0, H);
  sh.addColorStop(0, 'rgba(8,10,16,0.6)');
  sh.addColorStop(0.35, 'rgba(8,10,16,0)');
  sh.addColorStop(0.8, 'rgba(8,10,16,0)');
  sh.addColorStop(1, 'rgba(8,10,16,0.5)');
  g.fillStyle = sh;
  g.fillRect(0, 0, 16, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  pageEdgeTex = t;
  return t;
}

/** A soft dark ring around a rectangular footprint (the footprint itself stays clear). Used as a contact shadow. */
function frameShadowTexture(w: number, h: number, x: number, y: number, iw: number, ih: number, blur: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.shadowColor = 'rgba(0,0,0,0.95)';
  g.shadowBlur = blur;
  g.fillStyle = '#000';
  g.fillRect(x, y, iw, ih);
  g.shadowColor = 'transparent';
  g.shadowBlur = 0;
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(x, y, iw, ih);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --- the cover (top face of each cover board): worn black leather, tarnished iron brackets and a clasp ----------------
const coverCache: Record<string, THREE.CanvasTexture> = {};
function coverTexture(left: boolean): THREE.CanvasTexture {
  const key = left ? 'L' : 'R';
  const hit = coverCache[key];
  if (hit) return hit;
  const W = 512;
  const H = 724;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rnd = rng(left ? 3 : 5);
  g.save();
  if (!left) {
    g.translate(W, 0);
    g.scale(-1, 1); // painted with the outer edge at x = 0, mirrored for the right cover
  }
  g.fillStyle = '#15100c';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rnd() < 0.55 ? `rgba(0,0,0,${0.1 + rnd() * 0.15})` : `rgba(95,75,52,${0.04 + rnd() * 0.08})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
  const wear = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(110,90,68,0.3)');
    gr.addColorStop(1, 'rgba(110,90,68,0)');
    g.fillStyle = gr;
    g.fillRect(rx, ry, rw, rh);
  };
  wear(0, 0, 70, 0, 0, 0, 70, H);
  wear(0, 0, 0, 60, 0, 0, W, 60);
  wear(0, H, 0, H - 60, 0, H - 60, W, 60);
  g.strokeStyle = 'rgba(120,100,75,0.35)';
  g.lineWidth = 2;
  g.strokeRect(14, 14, W - 28, H - 28);
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 1.5;
  g.strokeRect(22, 22, W - 44, H - 44);
  g.save();
  g.setLineDash([7, 6]);
  g.strokeStyle = 'rgba(170,142,102,0.55)';
  g.lineWidth = 1.6;
  g.strokeRect(28, 11, W - 40, H - 22);
  g.restore();

  const ironGrad = (y0: number, y1: number) => {
    const b = g.createLinearGradient(0, y0, 60, y1);
    b.addColorStop(0, '#4a4842');
    b.addColorStop(0.5, '#33312d');
    b.addColorStop(1, '#1d1c19');
    return b;
  };
  const rivet = (x: number, y: number) => {
    g.fillStyle = '#0d0b09';
    g.beginPath();
    g.arc(x, y, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5a574f';
    g.beginPath();
    g.arc(x - 1, y - 1, 3.4, 0, Math.PI * 2);
    g.fill();
  };
  const rust = (x0: number, y0: number, w: number, h: number) => {
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(120,58,24,${0.12 + rnd() * 0.25})`;
      g.beginPath();
      g.arc(x0 + rnd() * w, y0 + rnd() * h, 1 + rnd() * 2.6, 0, Math.PI * 2);
      g.fill();
    }
  };
  const bracket = () => {
    g.fillStyle = ironGrad(0, 60);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(150, 0);
    g.lineTo(150, 36);
    g.lineTo(46, 36);
    g.lineTo(46, 150);
    g.lineTo(0, 150);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.lineWidth = 2;
    g.stroke();
    rust(0, 0, 150, 36);
    rust(0, 36, 46, 114);
    rivet(22, 20);
    rivet(104, 18);
    rivet(22, 104);
  };
  bracket();
  g.save();
  g.translate(0, H);
  g.scale(1, -1);
  bracket();
  g.restore();

    // ash, soot and charring so the cover ages like the pages
    for (let i = 0; i < 30; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 30 + rnd() * 90;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rnd() < 0.6 ? 'rgba(135,130,116,0.17)' : 'rgba(18,9,3,0.3)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    for (let i = 0; i < 600; i++) {
      g.fillStyle = `rgba(150,145,128,${0.03 + rnd() * 0.08})`;
      g.fillRect(rnd() * W, rnd() * H, 1, 1 + rnd() * 2.5);
    }
    g.lineWidth = 1;
    for (let i = 0; i < 14; i++) { // fine leather cracks
      let x = rnd() * W;
      let y = rnd() * H;
      g.strokeStyle = `rgba(0,0,0,${0.25 + rnd() * 0.25})`;
      g.beginPath();
      g.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += (rnd() - 0.5) * 26;
        y += (rnd() - 0.2) * 22;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 34; i++) { // charred rim
      const side = Math.floor(rnd() * 4);
      const t = rnd();
      const x = side === 0 ? t * W : side === 1 ? W : side === 2 ? t * W : 0;
      const y = side === 0 ? 0 : side === 1 ? t * H : side === 2 ? H : t * H;
      const r = 14 + rnd() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(8,4,1,${0.45 + rnd() * 0.3})`);
      gr.addColorStop(1, 'rgba(8,4,1,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    g.globalCompositeOperation = 'color';
    g.globalAlpha = 0.55;
    g.fillStyle = '#4a6578';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(6,9,14,0.28)';
    g.fillRect(0, 0, W, H);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  coverCache[key] = t;
  return t;
}

/** Footer of every page: left pages carry Prev / Next and a folio, right pages the question line and the Ask seal. */
function drawFooter(g: CanvasRenderingContext2D, p: Page) {
  const W = PAGE_W_PX;
  const M = FOOT_M;
  const rightPage = (p.num - 1) % 2 === 0;
  g.save();
  g.textBaseline = 'alphabetic';
  if (p.more && p.reveal === Infinity) {
    g.fillStyle = INK_SOFT;
    g.font = `italic 15px ${SERIF}`;
    g.textAlign = 'right';
    g.fillText(rightPage ? 'continued on the next page \u203a' : 'continued on the facing page \u203a', W - M, 629);
  }
  ornamentRule(g, M, W - M, 636);
  if (!rightPage) {
    g.font = `italic 20px ${SERIF}`;
    for (const [x, label, on, align] of [
      [M, '\u2039 Prev', navState.prev, 'left'],
      [W - M, 'Next \u203a', navState.next, 'right'],
    ] as [number, string, boolean, CanvasTextAlign][]) {
      g.globalAlpha = on ? 1 : 0.3;
      g.fillStyle = INK;
      g.textAlign = align;
      g.fillText(label, x, 676);
      const tw = g.measureText(label).width;
      g.globalAlpha = on ? 0.5 : 0.15;
      g.fillRect(align === 'left' ? x : x - tw, 682, tw, 1);
    }
    g.globalAlpha = 1;
    if (p.num > 0) {
      g.fillStyle = INK_SOFT;
      g.font = `italic 18px ${SERIF}`;
      g.textAlign = 'center';
      g.fillText(String(p.num), W / 2, 676);
    }
  } else {
    if (p.num > 0) {
      g.fillStyle = INK_SOFT;
      g.font = `italic 16px ${SERIF}`;
      g.textAlign = 'right';
      g.fillText(String(p.num), W - M, 42);
    }
    g.textAlign = 'left';
    g.font = `20px ${SERIF}`;
    const txt = inputState.text;
    const caret = Math.min(Math.max(inputState.caret, 0), txt.length);
    const caretW = g.measureText(txt.slice(0, caret)).width;
    const scroll = Math.max(0, caretW - 322); // keep the caret inside the field
    g.save();
    g.beginPath();
    g.rect(M, 646, 346, 46);
    g.clip();
    if (txt) {
      g.fillStyle = INK;
      g.fillText(txt, M + 4 - scroll, 676);
    } else {
      g.fillStyle = 'rgba(60,46,30,0.85)';
      g.font = `italic 20px ${SERIF}`;
      g.fillText('Ask a question\u2026', M + 4, 676);
      g.font = `20px ${SERIF}`;
    }
    if (inputState.focus && inputState.blink) {
      g.fillStyle = INK;
      g.fillRect(M + 4 + caretW - scroll, 656, 2, 24);
    }
    g.restore();
    g.fillStyle = INK_SOFT;
    g.globalAlpha = 0.75;
    for (let x = M; x < M + 346; x += 5) g.fillRect(x, 686, 2.5, 1.2); // a dotted line to write on
    g.globalAlpha = 1;    const bx = W - M - 92;
    const bw = 92;
    const ready = inputState.text.trim().length > 0;
    g.save();
    // plain ink: lettering with a fine rule and two small diamonds beneath, like a catchword in a printed book
    g.globalAlpha = ready ? 1 : 0.5;
    g.font = `italic 22px ${SERIF}`;
    g.textAlign = 'center';
    g.fillStyle = ready ? INK_RED : INK_SOFT;
    g.fillText('Ask', bx + bw / 2, 676);
    g.fillRect(bx + 14, 683, bw - 28, ready ? 1.4 : 1);
    diamond(g, bx + 12, 683.6, 2.6);
    diamond(g, bx + bw - 12, 683.6, 2.6);
    g.globalAlpha = 1;
    g.restore();
  }
  g.restore();
}

// Keep in sync with SUGGESTIONS in ChatPanel.tsx. They are painted on the title page so they curve with the paper;
// the DOM chips are invisible hit areas over these rows (see "Chat book v11" in styles.css).
const STARTERS = ['How many projects use Python?', 'Which projects are featured?', 'What did you build with Flask?'];
const STARTER_Y = [540, 566, 592]; // baselines on the 512x704 page

function drawStarters(g: CanvasRenderingContext2D) {
  const M = FOOT_M;
  g.save();
  g.globalAlpha = 0.55;
  g.fillStyle = INK_SOFT;
  g.fillRect(M, 508, PAGE_W_PX - 2 * M, 1.2);
  g.globalAlpha = 1;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  STARTERS.forEach((s, i) => {
    g.font = `16px ${SERIF}`;
    g.fillStyle = INK_SOFT;
    g.fillText(`${i + 1}.`, M + 4, STARTER_Y[i]);
    g.font = `italic 19px ${SERIF}`;
    g.fillStyle = INK;
    g.fillText(s, M + 26, STARTER_Y[i]);
  });
  g.restore();
}

function paintPage(g: CanvasRenderingContext2D, p: Page, glow: boolean) {
  const W = PAGE_W_PX;
  const H = PAGE_H_PX;
  const rightPage = (p.num - 1) % 2 === 0;
  g.clearRect(0, 0, W, H);
  if (!glow) g.drawImage(paperCanvas(rightPage, (p.num >> 1) % 5), 0, 0);
  if (p.kind === 'blank') {
    if (!glow) drawFooter(g, p);
    return;
  }
  const col = glow ? '#7ff5e4' : INK;
  g.fillStyle = col;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  let budget = p.reveal;
  const write = (x0: number, y0: number) => {
    const baseFont = g.font;
    p.lines.forEach((l, i) => {
      if (budget <= 0) return;
      const k = l.charCodeAt(0);
      const styled = k >= 1 && k <= 5;
      const body = styled ? l.slice(1) : l;
      const n = budget >= l.length ? body.length : Math.max(0, Math.floor(budget) - (styled ? 1 : 0));
      budget -= l.length;
      if (n <= 0) return;
      const y = y0 + i * LINE_H;
      const text = body.slice(0, n);
      if (k === 1) {
        g.font = FONT_LEAD;
        g.fillStyle = glow ? col : INK_RED;
        g.fillText(text, x0, y);
        g.fillStyle = col;
      } else if (k === 2 || k === 3) {
        if (k === 2) {
          g.fillStyle = glow ? col : INK_RED;
          g.fillText('\u2022', x0 + 4, y);
          g.fillStyle = col;
        }
        g.fillText(text, x0 + BULLET_IN, y);
      } else if (k === 4) {
        g.font = FONT_META;
        g.fillStyle = glow ? col : '#3f5d68';
        g.fillText(text, x0 + BULLET_IN, y - 4);
        g.fillStyle = col;
      } else if (k === 5) {
        g.fillText(text, x0 + PARA_INDENT, y);
      } else {
        g.fillText(text, x0, y);
      }
      g.font = baseFont;
    });
  };
  if (p.kind === 'title') {
    g.font = `30px ${SERIF}`;
    spaced(g, 'QUESTIONS', W / 2, 104, 8, 'center');
    if (!glow) ornamentRule(g, PAGE_MARGIN + 70, W - PAGE_MARGIN - 70, 128);
    g.textAlign = 'left';
    g.font = FONT_BODY;
    write(PAGE_MARGIN, 200);
    if (!glow) drawStarters(g);
  } else {
    g.font = `13px ${SERIF}`;
    spaced(g, (p.kind === 'user' ? 'YOUR QUESTION' : 'THE ANSWER') + (p.first ? '' : ' (CONTINUED)'), PAGE_MARGIN, 42, 3);
    if (glow) {
      g.fillRect(PAGE_MARGIN, 52, W - 2 * PAGE_MARGIN, 1.5);
    } else {
      g.save();
      g.globalAlpha = 0.55;
      g.fillRect(PAGE_MARGIN, 52, W - 2 * PAGE_MARGIN, 1.2);
      g.restore();
    }
    g.font = p.kind === 'user' || p.pending ? FONT_USER : FONT_BODY;
    write(PAGE_MARGIN, TEXT_TOP + 22);
  }
  if (!glow) drawFooter(g, p);
}

function makePageTex(p: Page): PageTex {
  const mk = (glow: boolean) => {
    const c = document.createElement('canvas');
    c.width = PAGE_W_PX;
    c.height = PAGE_H_PX;
    const g = c.getContext('2d')!;
    paintPage(g, p, glow);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { t, g };
  };
  const a = mk(false);
  const b = mk(true);
  return { ink: a.t, glow: b.t, ci: a.g, cg: b.g };
}

// ===========================================================================================================

export interface ThroneRoom {
  /** Always in the scene (holds the one point light). */
  group: THREE.Group;
  /** True if a prop of radius r at (x, z) would sit on the court or its entrance. */
  blocks(x: number, z: number, r: number): boolean;
  /** Camera route from the end of the forest curve up to the gate, ground samples, without the start point. */
  routePoints: THREE.Vector3[];
  cameraAt(t: number, out: THREE.Vector3): THREE.Vector3;
  /** Blend the gaze from the campfire aim to the book on the lectern. */
  gaze(t: number, fireAim: THREE.Vector3, out: THREE.Vector3, pos: THREE.Vector3): void;
  update(clock: number, camera: THREE.Vector3): void;
  /** Project the open book's page corners to screen pixels and publish them as the window event "book-screen". */
  projectBook(camera: THREE.Camera, width: number, height: number): void;
  dispose(): void;
}

/** Helpers for the chat panel (no import of the scene needed). */
export function announceChatMessage(role: Role, text: string) {
  window.dispatchEvent(new CustomEvent('chat-message', { detail: { role, text } }));
}
export function resetChatBook() {
  window.dispatchEvent(new Event('chat-reset'));
}
export function turnBook(dir: 'prev' | 'next' | 'first' | 'last') {
  window.dispatchEvent(new CustomEvent('book-nav', { detail: dir }));
}

// ---- floor cracks: baked height field -> colour + normal map, laid as decals on the tile tops -------------------
const CR_U0 = 20.0;
const CR_U1 = 41.2;
const CR_V = 3.75;
const CR_PPU = 128; // pixels per world unit. Drop to 96 if load time or memory is a problem
const CR_W = Math.round(2 * CR_V * CR_PPU);
const CR_H = Math.round((CR_U1 - CR_U0) * CR_PPU);

const hash2 = (x: number, y: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const vnoise = (x: number, y: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};

function crackTextures(seed: number): { color: THREE.DataTexture; normal: THREE.DataTexture } {
  const W = CR_W;
  const H = CR_H;
  const N = W * H;
  const hgt = new Float32Array(N); // world-unit height: <= 0 in recesses, small + on pebbles
  const cov = new Float32Array(N); // 0..1 across the V, 1 at the crack centre
  const halo = new Float32Array(N); // soft dark ambient-occlusion halo around cracks
  const deb = new Float32Array(N); // debris: + light pebble, - dark pit
  const rnd = rng(seed);
  const edgeN = (x: number, y: number) => 0.6 * vnoise(x * 0.55, y * 0.55) + 0.4 * vnoise(x * 0.17 + 31.7, y * 0.17 + 17.3);

  // one tapered segment: half-width w0 at (v0,u0) to w1 at (v1,u1), V-shaped profile, ragged rim
  const seg = (v0: number, u0: number, w0: number, v1: number, u1: number, w1: number) => {
    const ax = (v0 + CR_V) * CR_PPU;
    const ay = (u0 - CR_U0) * CR_PPU;
    const bx = (v1 + CR_V) * CR_PPU;
    const by = (u1 - CR_U0) * CR_PPU;
    const rp = (Math.max(w0, w1) + 0.04) * CR_PPU;
    const xa = Math.max(0, Math.floor(Math.min(ax, bx) - rp));
    const xb = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + rp));
    const ya = Math.max(0, Math.floor(Math.min(ay, by) - rp));
    const yb = Math.min(H - 1, Math.ceil(Math.max(ay, by) + rp));
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-6;
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        let t = ((x - ax) * dx + (y - ay) * dy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x;
        const ey = ay + dy * t - y;
        const d = Math.sqrt(ex * ex + ey * ey) / CR_PPU;
        const hw = w0 + (w1 - w0) * t;
        if (hw < 0.0012 || d > hw + 0.035) continue;
        const de = d + (edgeN(x, y) - 0.5) * (hw * 0.9 + 0.005); // ragged, chipped rim
        const i = y * W + x;
        const hs = hw + 0.035;
        const q = 1 - Math.min(1, Math.max(de, 0) / hs);
        const hv = 0.5 * q * q;
        if (hv > halo[i]) halo[i] = hv;
        if (de < hw) {
          const c = 1 - Math.max(de, 0) / hw;
          if (c > cov[i]) cov[i] = c;
          const hh = -hw * 0.9 * c;
          if (hh < hgt[i]) hgt[i] = hh;
        }
      }
    }
  };

  // shallow spall: a chipped-out pit beside a crack
  const chip = (v: number, u: number, r: number) => {
    const cx = (v + CR_V) * CR_PPU;
    const cy = (u - CR_U0) * CR_PPU;
    const rp = r * CR_PPU * 1.5;
    for (let y = Math.max(0, Math.floor(cy - rp)); y <= Math.min(H - 1, Math.ceil(cy + rp)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rp)); x <= Math.min(W - 1, Math.ceil(cx + rp)); x++) {
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / CR_PPU;
        const de = d + (edgeN(x, y) - 0.5) * r * 0.9;
        if (de >= r) continue;
        const c = 1 - Math.max(de, 0) / r;
        const i = y * W + x;
        const hh = -0.01 * (0.5 + 0.5 * c);
        if (hh < hgt[i]) hgt[i] = hh;
        const cv = 0.15 + 0.25 * c;
        if (cv > cov[i]) cov[i] = cv;
      }
    }
  };

  // small pebble (sgn +1) or dark pit (sgn -1)
  const pebble = (v: number, u: number, r: number, sgn: number) => {
    const cx = (v + CR_V) * CR_PPU;
    const cy = (u - CR_U0) * CR_PPU;
    const rp = r * CR_PPU + 1;
    for (let y = Math.max(0, Math.floor(cy - rp)); y <= Math.min(H - 1, Math.ceil(cy + rp)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rp)); x <= Math.min(W - 1, Math.ceil(cx + rp)); x++) {
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / CR_PPU;
        if (d >= r) continue;
        const val = sgn * (1 - d / r);
        const i = y * W + x;
        if (Math.abs(val) > Math.abs(deb[i])) deb[i] = val;
      }
    }
  };

  // a fractal crack: midpoint displacement, width noise, taper, debris, and recursive side branches
  const crack = (v0: number, u0: number, v1: number, u1: number, w0: number, depth: number, tailIn: boolean) => {
    let pts: number[][] = [[v0, u0], [v1, u1]];
    const levels = Math.max(3, 6 - depth);
    for (let L = 0; L < levels; L++) {
      const out: number[][] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dv = b[0] - a[0];
        const du = b[1] - a[1];
        const len = Math.sqrt(dv * dv + du * du) || 1e-6;
        const k = (rnd() - 0.5) * len * 0.6;
        out.push([(a[0] + b[0]) / 2 - (du / len) * k, (a[1] + b[1]) / 2 + (dv / len) * k]);
        out.push(b);
      }
      pts = out;
    }
    const n = pts.length;
    const ph = rnd() * 100;
    const ws = pts.map((_, i) => {
      const t = i / (n - 1);
      const tp = tailIn ? Math.pow(Math.sin(Math.PI * t), 0.6) : Math.pow(1 - t, 0.7) * Math.min(1, t * 8 + 0.3);
      return w0 * tp * (0.6 + 0.8 * vnoise(t * 9 + ph, 3.7));
    });
    for (let i = 0; i < n - 1; i++) seg(pts[i][0], pts[i][1], ws[i], pts[i + 1][0], pts[i + 1][1], ws[i + 1]);
    for (let i = 1; i < n - 1; i++) {
      const pv = pts[i][0];
      const pu = pts[i][1];
      const w = ws[i];
      const tv = pts[i + 1][0] - pts[i - 1][0];
      const tu = pts[i + 1][1] - pts[i - 1][1];
      const tl = Math.sqrt(tv * tv + tu * tu) || 1e-6;
      const nv = -tu / tl;
      const nu = tv / tl;
      if (w > 0.006 && rnd() < 0.08) {
        const side = rnd() < 0.5 ? -1 : 1;
        const off = w + 0.004 + rnd() * 0.02;
        chip(pv + nv * side * off, pu + nu * side * off, 0.01 + rnd() * 0.022);
      }
      if (w > 0.004 && rnd() < 0.3) {
        const cnt = 1 + ((rnd() * 3) | 0);
        for (let k = 0; k < cnt; k++) {
          const side = rnd() < 0.5 ? -1 : 1;
          const off = w * (1.1 + rnd() * 1.2) + 0.004 + rnd() * 0.01;
          pebble(pv + nv * side * off + (rnd() - 0.5) * 0.02, pu + nu * side * off + (rnd() - 0.5) * 0.02, 0.005 + rnd() * 0.008, rnd() < 0.65 ? 1 : -1);
        }
      }
      if (depth < 3 && i > 3 && i < n - 4 && rnd() < 0.045) {
        const a = Math.atan2(tu, tv) + (rnd() < 0.5 ? -1 : 1) * (0.4 + rnd() * 0.8);
        const L = (0.5 + rnd() * 1.1) * Math.pow(0.6, depth);
        crack(pv, pu, pv + Math.cos(a) * L, pu + Math.sin(a) * L, Math.max(0.004, w * 0.65), depth + 1, false);
      }
    }
  };

  for (let k = 0; k < 26; k++) {
    const v = (rnd() < 0.5 ? -1 : 1) * (1.3 + rnd() * 2.3);
    const u = CR_U0 + 1 + rnd() * (CR_U1 - CR_U0 - 2);
    const a = rnd() * Math.PI * 2;
    const L = 2 + rnd() * 4;
    crack(v, u, v + Math.cos(a) * L, u + Math.sin(a) * L, 0.012 + rnd() * 0.016, 0, true);
  }

  // pebbles stand slightly proud of the surface
  for (let i = 0; i < N; i++) if (deb[i] > 0) hgt[i] += 0.004 * deb[i];

  const col = new Uint8Array(N * 4);
  const nor = new Uint8Array(N * 4);
  let cr = 0;
  let cg = 0;
  let cb = 0;
  let ca = 0;
  const over = (r: number, g: number, b: number, a: number) => {
    if (a <= 0) return;
    const oa = a + ca * (1 - a);
    cr = (r * a + cr * ca * (1 - a)) / oa;
    cg = (g * a + cg * ca * (1 - a)) / oa;
    cb = (b * a + cb * ca * (1 - a)) / oa;
    ca = oa;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = i * 4;
      // colour
      cr = 8;
      cg = 8;
      cb = 20;
      ca = 0;
      const hl = halo[i];
      const cv = cov[i];
      const db = deb[i];
      if (hl > 0 || cv > 0 || db !== 0) {
        over(8, 8, 20, hl * 0.45); // ambient-occlusion halo
        if (cv > 0 && cv < 0.22) over(105, 110, 148, (1 - cv / 0.22) * 0.5); // fresh, lighter broken lip
        if (cv > 0) over(4, 4, 12, Math.min(1, cv * 2.2) * 0.97); // dark core
        if (db > 0) over(172, 178, 208, db * 0.75); // grit
        else if (db < 0) over(5, 5, 12, -db * 0.8); // pits
      }
      col[o] = Math.round(cr);
      col[o + 1] = Math.round(cg);
      col[o + 2] = Math.round(cb);
      col[o + 3] = Math.round(ca * 255);
      // normal from the height field (tangent space: +x = +v, +y = +u)
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x < W - 1 ? x + 1 : x;
      const y0 = y > 0 ? y - 1 : y;
      const y1 = y < H - 1 ? y + 1 : y;
      const dhx = (hgt[y * W + x1] - hgt[y * W + x0]) / ((x1 - x0) / CR_PPU);
      const dhy = (hgt[y1 * W + x] - hgt[y0 * W + x]) / ((y1 - y0) / CR_PPU);
      if (dhx === 0 && dhy === 0) {
        nor[o] = 128;
        nor[o + 1] = 128;
        nor[o + 2] = 255;
      } else {
        const nx = -dhx;
        const ny = -dhy;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        nor[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
        nor[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
        nor[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      }
      nor[o + 3] = 255;
    }
  }
  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { color: mk(col, true), normal: mk(nor, false) };
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
  const LECT_DARK = 0x3d3c58;
  const LECT_LIGHT = 0x55547a;
  const LECT_BASE = 0x34334c; // plinth
  const LECT_STEP = 0x4b4a6c; // upper step
  const LECT_RIM = 0x6c668f; // collar
  const LECT_LIP = 0x2c2842; // desk lips
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
  const lanternPos: THREE.Vector3[] = [];
  COL_US.forEach((u, i) => {
    for (const side of [-1, 1]) {
      const v = side * COL_V;
      const isBroken = broken.has(`${i}:${side}`);
      const H = isBroken ? 2.4 + rand() * 1.6 : 6.2;
      cylAt(u, v, 0, 0.35, 0.85, pick(WALL));
      cylAt(u, v, 0.35, H, 0.52, pick(WALL));
      if (isBroken) {
        boxes.push({ x: v, y: 0.35 + H + 0.1, z: -u, sx: 0.75, sy: 0.3, sz: 0.7, color: pick(WALL), rx: (rand() - 0.5) * 0.7, rz: (rand() - 0.5) * 0.7 });
        cyls.push({ x: v + side * 1.9, y: 0.5, z: -(u + (rand() - 0.5)), sx: 0.5, sy: 1.5, sz: 0.5, color: pick(WALL), rx: Math.PI / 2, ry: rand() * Math.PI });
      } else {
        boxUV(u - 0.8, u + 0.8, v - 0.8, v + 0.8, 6.55, 6.95, pick(WALL));
        intact.push({ u, side });
        // cross-beam stub reaching into the aisle, with a chain and a hanging lantern
        const v0 = Math.min(v, side * (COL_V - 2.4));
        const v1 = Math.max(v, side * (COL_V - 2.4));
        boxUV(u - 0.4, u + 0.4, v0, v1, 6.95, 7.4, pick(WALL), { rz: side * 0.03 });
        const lv = side * (COL_V - 2.2);
        cylAt(u, lv, 4.9, 2.1, 0.03, 0x2b2a3a);
        glow.push({ x: lv, y: 4.6, z: -u, sx: 0.28, sy: 0.42, sz: 0.28, color: 0xffffff });
        lanternPos.push(new THREE.Vector3(lv, 4.6, -u));
        // lantern housing: iron caps and four posts around the glowing core
        boxes.push({ x: lv, y: 4.88, z: -u, sx: 0.46, sy: 0.08, sz: 0.46, color: 0x2b2a3a });
        boxes.push({ x: lv, y: 4.34, z: -u, sx: 0.36, sy: 0.08, sz: 0.36, color: 0x2b2a3a });
        for (const [dx, dz] of [[-0.16, -0.16], [0.16, -0.16], [0.16, 0.16], [-0.16, 0.16]] as [number, number][]) {
          boxes.push({ x: lv + dx, y: 4.6, z: -u + dz, sx: 0.04, sy: 0.54, sz: 0.04, color: 0x2b2a3a });
        }
        // column bands and a flared capital
        cyls.push({ x: v, y: 1.3, z: -u, sx: 0.6, sy: 0.14, sz: 0.6, color: WALL[2] });
        cyls.push({ x: v, y: 3.6, z: -u, sx: 0.58, sy: 0.1, sz: 0.58, color: WALL[2] });
        cyls.push({ x: v, y: 6.36, z: -u, sx: 0.68, sy: 0.26, sz: 0.68, color: WALL[0] });
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

  // ---- avenue: tiles with gaps, carpet with glowing inlay, stepped dais -----------------------------------------
  const shade = (c: number, k: number) => {
    const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
    const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
    const b = Math.min(255, Math.round((c & 255) * k));
    return (r << 16) | (g << 8) | b;
  };
  const tiles: { u: number; v: number; top: number; hw: number; col: number; flat: boolean; chip?: [number, number, number] }[] = [];
  const rt2 = rng(555);
  for (let u = 20.8; u < 40.5; u += 1.5) {
    for (let k = -2; k <= 2; k++) {
      if (rand() < 0.12) continue;
      const base = pick(TILE);
      const yaw0 = (rand() - 0.5) * 0.05;
      const cu = u;
      const cv = k * 1.5;
      const hw = 0.64 + rt2() * 0.06; // half size, so joints vary in width
      const top = 0.08 + (rt2() - 0.5) * 0.05 - (rt2() < 0.22 ? 0.03 : 0); // some tiles have sunk deeper
      const col = shade(base, 0.78 + rt2() * 0.42);
      const rx = (rt2() - 0.5) * 0.024;
      const rz = (rt2() - 0.5) * 0.024;
      const yaw = yaw0 + (rt2() - 0.5) * 0.03;
      const kind = Math.abs(cv) < 1.2 ? 1 : rt2(); // the centre tile sits under the carpet, keep it plain

      if (kind < 0.15) {
        // broken in two: halves at different heights with a dark gap between
        const alongU = rt2() < 0.5;
        const f = 0.35 + rt2() * 0.3;
        const tB = Math.max(0.02, Math.min(0.11, top + (0.02 + rt2() * 0.04) * (rt2() < 0.5 ? -1 : 1)));
        const rA = { rx: (rt2() - 0.5) * 0.03, rz: (rt2() - 0.5) * 0.03 };
        const rB = { rx: (rt2() - 0.5) * 0.03, rz: (rt2() - 0.5) * 0.03 };
        if (alongU) {
          const cut = cu - hw + f * 2 * hw;
          boxUV(cu - hw, cut - 0.025, cv - hw, cv + hw, -0.3, top, col, rA);
          boxUV(cut + 0.025, cu + hw, cv - hw, cv + hw, -0.3, tB, shade(col, 0.92), rB);
        } else {
          const cut = cv - hw + f * 2 * hw;
          boxUV(cu - hw, cu + hw, cv - hw, cut - 0.025, -0.3, top, col, rA);
          boxUV(cu - hw, cu + hw, cut + 0.025, cv + hw, -0.3, tB, shade(col, 0.92), rB);
        }
        tiles.push({ u: cu, v: cv, top, hw, col, flat: false });
      } else if (kind < 0.45) {
        // chipped corner: the tile is an L shape plus a lower, darker step where the corner broke off
        const su = rt2() < 0.5 ? -1 : 1;
        const sv = rt2() < 0.5 ? -1 : 1;
        const c = 0.22 + rt2() * 0.25;
        const drop = 0.04 + rt2() * 0.04;
        const vCut = sv > 0 ? cv + hw - c : cv - hw + c;
        boxUV(cu - hw, cu + hw, sv > 0 ? cv - hw : vCut, sv > 0 ? vCut : cv + hw, -0.3, top, col);
        boxUV(su > 0 ? cu - hw : cu - hw + c, su > 0 ? cu + hw - c : cu + hw, sv > 0 ? vCut : cv - hw, sv > 0 ? cv + hw : vCut, -0.3, top, col);
        boxUV(su > 0 ? cu + hw - c : cu - hw, su > 0 ? cu + hw : cu - hw + c, sv > 0 ? vCut : cv - hw, sv > 0 ? cv + hw : vCut, -0.3, Math.max(0.015, top - drop), shade(col, 0.72));
        tiles.push({ u: cu, v: cv, top, hw, col, flat: true, chip: [su, sv, c] });
      } else {
        boxUV(cu - hw, cu + hw, cv - hw, cv + hw, -0.3, top, col, { ry: yaw, rx, rz });
        tiles.push({ u: cu, v: cv, top, hw, col, flat: true });
      }

      // moss creeping out of a joint on some tiles
      if (rt2() < 0.35) {
        const e = (rt2() * 4) | 0;
        const len = 0.4 + rt2() * 0.6;
        const off = (rt2() - 0.5) * (2 * hw - len);
        const mc = MOSS[(rt2() * 3) | 0];
        const s = e % 2 ? 1 : -1;
        if (e < 2) boxUV(cu + s * hw - 0.05, cu + s * hw + 0.05, cv + off - len / 2, cv + off + len / 2, 0, top + 0.01, mc);
        else boxUV(cu + off - len / 2, cu + off + len / 2, cv + s * hw - 0.05, cv + s * hw + 0.05, 0, top + 0.01, mc);
      }
    }
  }
  boxUV(20.6, 40.5, -1, 1, 0.08, 0.12, CARPET);
  for (const s of [-1, 1]) {
    glow.push({ x: s * 1.06, y: 0.125, z: -30.55, sx: 0.06, sy: 0.02, sz: 19.9, color: 0xffffff });
  }
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
  // low kerbs framing the top step, so the lectern sits in a stone-edged platform
  for (const s of [-1, 1]) boxUV(45, 51, s * 2.8 - 0.12, s * 2.8 + 0.12, 0.9, 1.05, WALL[2]);
  boxUV(50.9, 51.1, -2.8, 2.8, 0.9, 1.05, WALL[2]);

  // ---- ruined arch behind the dais, holding the rune disc ---------------------------------------------------------
  for (const s of [-1, 1]) {
    cylAt(ARCH_U, s * 3.6, 0, 0.55, 1.3, pick(WALL));
    cylAt(ARCH_U, s * 3.6, 0.55, 9.0, 0.95, pick(WALL));
    boxUV(ARCH_U - 1.1, ARCH_U + 1.1, s * 3.6 - 1.15, s * 3.6 + 1.15, 9.45, 9.85, pick(WALL));
  }
  boxUV(ARCH_U - 0.7, ARCH_U + 0.7, -4.9, -0.7, 9.85, 10.8, WALL[0], { rz: 0.035 });
  boxUV(ARCH_U - 0.7, ARCH_U + 0.7, 1.0, 4.9, 9.7, 10.6, WALL[1], { rz: -0.08 });
  boxes.push({ x: 0.9, y: 0.45, z: -(ARCH_U + 1.8), sx: 1.6, sy: 0.9, sz: 1.1, color: WALL[3], ry: 0.5, rz: 0.1 }); // fallen keystone

  // ---- lectern base kerb glow: replaced by the lectern itself (built below as real meshes) -----------------------------

  // ---- standing stones behind the dais, each with a glowing face -------------------------------------------
  for (let i = 0; i < 9; i++) {
    const a = ((-72 + i * 18) * Math.PI) / 180;
    const x = MONO_R * Math.sin(a);
    const z = -(STONE_C + MONO_R * Math.cos(a));
    const h = 5.5 + rand() * 4;
    const w = 1.7 + rand() * 0.9;
    const yaw = Math.atan2(0 - x, -STONE_C - z);
    boxes.push({ x, y: h / 2, z, sx: w, sy: h, sz: 1.2, ry: yaw, rx: (rand() - 0.5) * 0.1, rz: (rand() - 0.5) * 0.1, color: pick(WALL) });
    glow.push({ x: x + Math.sin(yaw) * 0.63, y: h * 0.45, z: z + Math.cos(yaw) * 0.63, sx: 0.08, sy: h * 0.6, sz: 0.05, ry: yaw, color: 0xffffff });
  }

  // ---- rubble ------------------------------------------------------------------------------------------------
  /*(for (let i = 0; i < 55; i++) {
    const u = 18 + rand() * 34;
    const v = (rand() < 0.5 ? -1 : 1) * (AVENUE_HALF + 0.3 + rand() * 7.5);
    const sz = 0.2 + rand() * 0.5;
    boxes.push({ x: v, y: sz * 0.35, z: -u, sx: sz * (1 + rand()), sy: sz, sz: sz * (1 + rand()), ry: rand() * Math.PI, rx: (rand() - 0.5) * 0.5, rz: (rand() - 0.5) * 0.5, color: pick(WALL) });
  }*/

  // keep-out zones so nothing lands on a brazier, a column or a statue
  const STATUES: [number, number, boolean][] = [[-9, 27, false], [9, 27, false], [-9, 36, false], [9, 36, true]]; // v, u, headless
  const clearOf = (u: number, v: number, extra = 0) =>
    !braziers.some((b) => Math.hypot(b.u - u, b.v - v) < 1.3 + extra) &&
    !COL_US.some((cu) => [-1, 1].some((s) => Math.hypot(cu - u, s * COL_V - v) < 1.5 + extra)) &&
    !STATUES.some(([sv, su]) => Math.hypot(su - u, sv - v) < 1.6 + extra);

  for (let i = 0; i < 55; i++) {
    const u = 18 + rand() * 34;
    const v = (rand() < 0.5 ? -1 : 1) * (AVENUE_HALF + 0.3 + rand() * 7.5);
    const sz = 0.2 + rand() * 0.5;
    const rb: Part = { x: v, y: sz * 0.35, z: -u, sx: sz * (1 + rand()), sy: sz, sz: sz * (1 + rand()), ry: rand() * Math.PI, rx: (rand() - 0.5) * 0.5, rz: (rand() - 0.5) * 0.5, color: pick(WALL) };
    if (clearOf(u, v)) boxes.push(rb);
  }

  // broken flagstone patches either side of the avenue, for ground texture
  const rp = rng(91);
  for (let i = 0; i < 90; i++) {
    const u = 17 + rp() * 36;
    const v = (rp() < 0.5 ? -1 : 1) * (AVENUE_HALF + 0.2 + rp() * 6.5);
    const w = 0.7 + rp() * 0.8;
    const h = 0.06 + rp() * 0.08;
    const col = TILE[(rp() * TILE.length) | 0];
    const slab: Part = { x: v, y: h / 2 - 0.01, z: -u, sx: w, sy: h, sz: w * (0.7 + rp() * 0.4), ry: rp() * Math.PI, rx: (rp() - 0.5) * 0.08, rz: (rp() - 0.5) * 0.08, color: col };
    if (clearOf(u, v, -0.5) && !(u > 39.5 && u < 52 && Math.abs(v) < 5.3)) boxes.push(slab);
  }

  // crack decals: one quad per tile top at that tile's own height, all sharing the baked crack maps (one draw call).
  // Broken tiles get none; chipped tiles get two quads matching their L shape. Quads sit 0.04 inside the tile edge.
  {
    const ct = crackTextures(2026);
    const crackMap = keepTex(ct.color);
    const crackNormal = keepTex(ct.normal);
    const pos: number[] = [];
    const uvs: number[] = [];
    const nrm: number[] = [];
    const idx: number[] = [];
    const INS = 0.04;
    const quad = (u0: number, u1: number, v0: number, v1: number, y: number, k: [boolean, boolean, boolean, boolean]) => {
      const a0 = u0 + (k[0] ? 0 : INS);
      const a1 = u1 - (k[1] ? 0 : INS);
      const b0 = v0 + (k[2] ? 0 : INS);
      const b1 = v1 - (k[3] ? 0 : INS);
      if (a1 <= a0 || b1 <= b0) return;
      const base = pos.length / 3;
      const vs: [number, number][] = [[b0, a1], [b0, a0], [b1, a1], [b1, a0]]; // [v, u]
      for (const [vv, uu] of vs) {
        pos.push(vv, y, -uu);
        uvs.push((vv + CR_V) / (2 * CR_V), (uu - CR_U0) / (CR_U1 - CR_U0));
        nrm.push(0, 1, 0);
      }
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    };
    for (const t of tiles) {
      if (!t.flat || Math.abs(t.v) < 1.2) continue; // broken tiles and the carpet column
      const y = t.top + 0.012;
      const hw = t.hw;
      if (t.chip) {
        const [su, sv, c] = t.chip;
        const vCut = sv > 0 ? t.v + hw - c : t.v - hw + c;
        quad(t.u - hw, t.u + hw, sv > 0 ? t.v - hw : vCut, sv > 0 ? vCut : t.v + hw, y, [false, false, sv <= 0, sv > 0]);
        quad(su > 0 ? t.u - hw : t.u - hw + c, su > 0 ? t.u + hw - c : t.u + hw, sv > 0 ? vCut : t.v - hw, sv > 0 ? t.v + hw : vCut, y, [su <= 0, su > 0, sv > 0, sv <= 0]);
      } else {
        quad(t.u - hw, t.u + hw, t.v - hw, t.v + hw, y, [false, false, false, false]);
      }
    }
    if (idx.length) {
      const g = keepGeo(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setIndex(idx);
      const m = keepMat(
        new THREE.MeshLambertMaterial({
          map: crackMap,
          normalMap: crackNormal,
          normalScale: new THREE.Vector2(1.6, 1.6),
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 1;
      mesh.frustumCulled = false;
      body.add(mesh);
    }
  }

  // hooded guardian statues outside the colonnade, facing the avenue; one has lost its head
  for (const [v, u, headless] of STATUES) {
    const s = v > 0 ? 1 : -1;
    const c = WALL[2];
    boxUV(u - 0.8, u + 0.8, v - 0.8, v + 0.8, 0, 0.5, WALL[1]);
    boxUV(u - 0.6, u + 0.6, v - 0.6, v + 0.6, 0.5, 0.7, WALL[3]);
    boxUV(u - 0.5, u + 0.5, v - 0.45, v + 0.45, 0.7, 2.4, c); // robe
    boxUV(u - 0.4, u + 0.4, v - 0.5, v + 0.5, 2.4, 3.2, c); // torso
    boxUV(u - 0.3, u + 0.3, v - 0.78, v + 0.78, 3.0, 3.4, c); // shoulders
    cylAt(u, v - s * 0.62, 0.7, 3.4, 0.05, 0x2b2a3a); // staff on the aisle side
    if (headless) {
      boxUV(u - 0.25, u + 0.25, v - 0.25, v + 0.25, 3.4, 3.65, c, { rz: 0.15 });
      boxes.push({ x: v - s * 1.4, y: 0.3, z: -(u + 0.5), sx: 0.6, sy: 0.6, sz: 0.6, color: c, ry: 0.6, rz: 0.3 });
    } else {
      boxUV(u - 0.3, u + 0.3, v - 0.3, v + 0.3, 3.4, 4.05, c); // hood
      glow.push({ x: v - s * 0.31, y: 3.75, z: -u, sx: 0.04, sy: 0.07, sz: 0.3, color: 0xffffff }); // eye slit
    }
  }

  // ---- extra ground and skyline detail: glowing cracks, fallen shafts, far ruin silhouettes --------------------------
  for (let k = 0; k < 10; k++) {
    let u = 22 + rand() * 18;
    let v = (rand() < 0.5 ? -1 : 1) * (1.7 + rand() * 1.8);
    let ang = rand() * Math.PI;
    for (let j = 0; j < 5; j++) {
      const len = 0.5 + rand() * 0.45;
      //glow.push({ x: v + Math.sin(ang) * len * 0.5, y: 0.1, z: -(u + Math.cos(ang) * len * 0.5), sx: 0.045, sy: 0.02, sz: len, ry: ang, color: 0xffffff });
      v += Math.sin(ang) * len;
      u += Math.cos(ang) * len;
      ang += (rand() - 0.5) * 1.3;
    }
  }
  for (const [fv, fu, fa] of [[-7, 31, 0.5], [6.6, 25, -0.3], [-6.2, 40, 1.2]] as [number, number, number][]) {
    cyls.push({ x: fv, y: 0.5, z: -fu, sx: 0.55, sy: 3.4, sz: 0.55, color: pick(WALL), rx: Math.PI / 2, ry: fa });
  }
  for (let i = 0; i < 16; i++) {
    const a = ((-80 + i * 10.6) * Math.PI) / 180;
    const R = 26 + rand() * 12;
    const h = 9 + rand() * 13;
    boxes.push({ x: R * Math.sin(a), y: h / 2, z: -(STONE_C + R * Math.cos(a)), sx: 2 + rand() * 2.5, sy: h, sz: 2 + rand() * 1.5, ry: rand() * 3, rx: (rand() - 0.5) * 0.12, rz: (rand() - 0.5) * 0.12, color: 0x23233f });
  }
  for (let i = 0; i < 12; i++) {
    const h = 7 + rand() * 12;
    boxes.push({ x: (i % 2 ? 1 : -1) * (19 + rand() * 14), y: h / 2, z: -(22 + rand() * 40), sx: 2 + rand() * 2, sy: h, sz: 2 + rand() * 2, ry: rand() * 3, rz: (rand() - 0.5) * 0.14, color: 0x23233f });
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

  // ---- moon shafts: crossed soft beams slanting through the colonnade -----------------------------------------------
  const shaftTex = keepTex(shaftTexture());
  const shaftGeo = keepGeo(new THREE.PlaneGeometry(1, 1));
  const shaftMat = keepMat(
    new THREE.MeshBasicMaterial({ map: shaftTex, color: 0xa8d8ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
  );
  const shaftParts: Part[] = [];
  [26, 31, 36, 41].forEach((u, i) => {
    const v = (i % 2 ? 1 : -1) * 3;
    for (const ry of [0, Math.PI / 2]) {
      shaftParts.push({ x: v, y: 5, z: -u, sx: 2.6, sy: 11, sz: 1, rz: (i % 2 ? 1 : -1) * 0.22, ry, color: 0xffffff });
    }
  });
  const shafts = instanced(shaftGeo, shaftMat, shaftParts);
  shafts.renderOrder = 4;
  body.add(shafts);
  meshes.push(shafts);

  // ---- contact shadows under every pillar base, and shallow puddles that catch the lantern light ----------------------
  const aoTex = keepTex(
    canvasTex(64, (g, S) => {
      const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      gr.addColorStop(0, 'rgba(0,0,0,0.75)');
      gr.addColorStop(0.5, 'rgba(0,0,0,0.4)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
    }),
  );
  const flatGeo = keepGeo(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const aoMat = keepMat(new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false }));
  const aoParts: Part[] = cyls
    .filter((c) => c.sy < 0.6 && c.sx >= 0.85)
    .map((c) => ({ x: c.x, y: 0.045, z: c.z, sx: c.sx * 3.6, sy: 1, sz: c.sx * 3.6, color: 0xffffff }));
  aoParts.push({ x: 0, y: 0.95, z: -LECT_U, sx: 3.2, sy: 1, sz: 3.2, color: 0xffffff });
  const ao = instanced(flatGeo, aoMat, aoParts);
  ao.renderOrder = 1;
  body.add(ao);
  meshes.push(ao);

  const puddleList: [number, number, number][] = [[-2.6, 27, 1.1], [2.4, 31, 1.4], [-3.0, 35.5, 1.2], [2.8, 22.5, 1.0], [-1.9, 39, 0.9], [3.1, 38, 1.2]];
  const puddleMat = keepMat(new THREE.MeshBasicMaterial({ map: aoTex, color: 0x2a6f9a, transparent: true, opacity: 0.6, depthWrite: false }));
  const puddles = instanced(flatGeo, puddleMat, puddleList.map(([v, u, r]) => ({ x: v, y: 0.105, z: -u, sx: r * 2.2, sy: 1, sz: r * 2.8, color: 0xffffff })));
  puddles.renderOrder = 2;
  const sheenMat = keepMat(
    new THREE.MeshBasicMaterial({ map: shaftTex, color: 0x8ff5ea, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  const sheen = instanced(flatGeo, sheenMat, puddleList.map(([v, u, r]) => ({ x: v, y: 0.11, z: -u, sx: 0.5, sy: 1, sz: r * 2.2, color: 0xffffff })));
  sheen.renderOrder = 3;
  body.add(puddles, sheen);
  meshes.push(puddles, sheen);

  // ---- braziers: stands, bowls, two flame layers, halos --------------------------------------------------------------
  const standParts: Part[] = [];
  const standBoxes: Part[] = [];
  const flameParts: Part[] = [];
  const flamePos: THREE.Vector3[] = [];
  const IRON = 0x2b2a3a;
  braziers.forEach(({ u, v }, bi) => {
    const yaw = bi * 0.37;
    // stepped square plinth
    standBoxes.push({ x: v, y: 0.12, z: -u, sx: 1.1, sy: 0.24, sz: 1.1, color: 0x62627c, ry: yaw });
    standBoxes.push({ x: v, y: 0.34, z: -u, sx: 0.8, sy: 0.2, sz: 0.8, color: 0x4a4a62, ry: yaw });
    // collared shaft with a knob
    standParts.push({ x: v, y: 0.5, z: -u, sx: 0.34, sy: 0.12, sz: 0.34, color: IRON });
    standParts.push({ x: v, y: 0.9, z: -u, sx: 0.2, sy: 0.7, sz: 0.2, color: 0x504f68 });
    standParts.push({ x: v, y: 0.9, z: -u, sx: 0.3, sy: 0.14, sz: 0.3, color: IRON });
    standParts.push({ x: v, y: 1.28, z: -u, sx: 0.34, sy: 0.12, sz: 0.34, color: IRON });
    // stepped bowl and rim
    standParts.push({ x: v, y: 1.38, z: -u, sx: 0.4, sy: 0.12, sz: 0.4, color: 0x3a3950 });
    standParts.push({ x: v, y: 1.5, z: -u, sx: 0.58, sy: 0.12, sz: 0.58, color: 0x504f68 });
    standParts.push({ x: v, y: 1.6, z: -u, sx: 0.7, sy: 0.08, sz: 0.7, color: 0x62627c });

  
    flamePos.push(new THREE.Vector3(v, 1.64, -u));
    flameParts.push({ x: v, y: 2, z: -u, sx: 0.34, sy: 1.2, sz: 0.34, color: 0x2fd2bd });
    flameParts.push({ x: v, y: 2, z: -u, sx: 0.2, sy: 0.7, sz: 0.2, color: 0xcafff6 });
  });
  const stands = instanced(cylGeo, stoneMat, standParts);
  const standBlocks = instanced(boxGeo, stoneMat, standBoxes);
  body.add(standBlocks);
  meshes.push(standBlocks);
  const coneGeo = keepGeo(new THREE.ConeGeometry(1, 1, 8));
  const flameMat = keepMat(
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const flames = instanced(coneGeo, flameMat, flameParts);
  body.add(stands, flames);
  meshes.push(stands, flames);

  // grass and fern tufts creeping through the ruin
  const rt = rng(77);
  const tuftParts: Part[] = [];
  for (let i = 0; i < 140; i++) {
    const u = 17 + rt() * 36;
    const v = (rt() < 0.5 ? -1 : 1) * (3.9 + rt() * 8);
    if (!clearOf(u, v, -0.4)) continue;
    for (let b = 0; b < 4; b++) {
      const h = 0.35 + rt() * 0.35;
      tuftParts.push({ x: v + (rt() - 0.5) * 0.35, y: h / 2, z: -(u + (rt() - 0.5) * 0.35), sx: 0.07, sy: h, sz: 0.07, rx: (rt() - 0.5) * 0.5, rz: (rt() - 0.5) * 0.5, color: MOSS[(rt() * 3) | 0] });
    }
  }
  const tufts = instanced(coneGeo, stoneMat, tuftParts);
  body.add(tufts);
  meshes.push(tufts);

  const glowTex = keepTex(glowTexture());
  const haloGeo = keepGeo(new THREE.BufferGeometry());
  const haloPts = [...flamePos.map((p) => [p.x, p.y + 0.5, p.z]), ...lanternPos.map((p) => [p.x, p.y, p.z])];
  haloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(haloPts.flat()), 3));
  const haloMat = keepMat(
    new THREE.PointsMaterial({ map: glowTex, size: 3.4, color: 0x4fe8d6, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  const halos = new THREE.Points(haloGeo, haloMat);
  halos.frustumCulled = false;
  const archHaloGeo = keepGeo(new THREE.BufferGeometry());
  archHaloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 6.4, -(ARCH_U - 0.8)]), 3));
  const archHaloMat = keepMat(
    new THREE.PointsMaterial({ map: glowTex, size: 14, color: 0x58f0dc, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  const archHalo = new THREE.Points(archHaloGeo, archHaloMat);
  archHalo.frustumCulled = false;
  body.add(halos, archHalo);

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
    // embers drifting up around the lectern
    const EMBERS = 34;
    const emberBase = new Float32Array(EMBERS * 4); // angle, radius, speed, phase
    const emberPos = new Float32Array(EMBERS * 3);
    for (let i = 0; i < EMBERS; i++) {
      emberBase[i * 4] = rand() * Math.PI * 2;
      emberBase[i * 4 + 1] = 1.1 + rand() * 1.5;
      emberBase[i * 4 + 2] = 0.05 + rand() * 0.07;
      emberBase[i * 4 + 3] = rand();
    }
    const emberGeo = keepGeo(new THREE.BufferGeometry());
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
    const emberMat = keepMat(
      new THREE.PointsMaterial({ map: glowTex, size: 0.1, color: 0xff8a3a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    const embers = new THREE.Points(emberGeo, emberMat);
    embers.frustumCulled = false;
    body.add(embers); 

  // ---- rune disc in the arch, ground emblems, gate mist, low mist ------------------------------------------------------------------

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

  // ==========================================================================================================
  // Lectern and book (ported from the approved standalone preview; z there is z here, x right, y up)
  // ==========================================================================================================
  const lect = new THREE.Group();
  lect.position.set(0, 0.9, -LECT_U);
  lect.scale.setScalar(LECT_S);
  body.add(lect);

  const lm = new Map<number, THREE.MeshLambertMaterial>();
  const lmat = (c: number) => {
    let m = lm.get(c);
    if (!m) {
      m = keepMat(new THREE.MeshLambertMaterial({ color: c, flatShading: true }));  
      lm.set(c, m);
    }
    return m;
  };
  const trimM = keepMat(new THREE.MeshBasicMaterial({ color: 0x4fe8d6, transparent: true, opacity: 0.25, fog: false }));
  const lbox = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number, par: THREE.Object3D, m?: THREE.Material) => {
    const o = new THREE.Mesh(keepGeo(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)), m ?? lmat(c));
    o.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    par.add(o);
    return o;
  };
  const lcyl = (rt: number, rb: number, h: number, y: number, c: number, m?: THREE.Material) => {
    const o = new THREE.Mesh(keepGeo(new THREE.CylinderGeometry(rt, rb, h, 8)), m ?? lmat(c));
    o.position.set(0, y, 0);
    o.rotation.y = Math.PI / 8;
    lect.add(o);
  };
  // stepped plinth, octagonal column, collar, flared neck
  lbox(-0.85, 0.85, 0, 0.25, -0.85, 0.85, LECT_BASE, lect);
  lbox(-0.65, 0.65, 0.25, 0.4, -0.65, 0.65, LECT_STEP, lect);
  lbox(-0.87, 0.87, 0.225, 0.245, -0.87, 0.87, 0, lect, trimM);
  lcyl(0.42, 0.52, 2, 1.4, LECT_DARK);
  lcyl(0.62, 0.55, 0.18, 2.45, LECT_RIM);
  lcyl(0.8, 0.6, 0.2, 2.64, LECT_DARK); // lower and narrower so it stays under the desk
  lcyl(0.64, 0.64, 0.03, 2.56, 0, trimM);
  // tilted desk with a lip
  const D = new THREE.Group();
  D.position.set(0, 3, 0);
  D.rotation.x = DESK_TILT;
  lect.add(D);
  lbox(-1.05, 1.05, -0.07, 0.07, -0.75, 0.75, LECT_LIGHT, D);
  lbox(-1.05, 1.05, -0.07, 0.2, 0.67, 0.75, LECT_LIP, D);
  lbox(-1.05, 1.05, -0.07, 0.22, -0.75, -0.66, LECT_LIP, D);
  lbox(-1, 1, 0.2, 0.215, 0.69, 0.73, 0, D, trimM);
  // open book
  const B = new THREE.Group();
  B.position.set(0, 0.07 + BOOK_LIFT, 0);
  D.add(B);
  // leather cover boards (unlit, so the court's blue light cannot turn them black), cream page edges, dark spine cord
  const leatherSideM = keepMat(new THREE.MeshBasicMaterial({ color: 0x1e232c })); // a shade lighter than the painted top, so the board reads as a thick slab
  const spineM = keepMat(new THREE.MeshBasicMaterial({ color: 0x0b0e13 }));
  const bbox = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material | THREE.Material[]) => {
    const o = new THREE.Mesh(keepGeo(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)), m);
    o.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    B.add(o);
    return o;
  };
  // cover boards: thin slabs resting on the desk (desk surface at y = -BOOK_LIFT in book space), a small overhang past the pages
  const COV_X = 0.845;
  const COV_Z = 0.52;
  bbox(-COV_X, -0.02, -BOOK_LIFT, 0, -COV_Z, COV_Z, leatherSideM);
  bbox(0.02, COV_X, -BOOK_LIFT, 0, -COV_Z, COV_Z, leatherSideM);
  bbox(-0.03, 0.03, -BOOK_LIFT, 0.005, -COV_Z, COV_Z, spineM);

  // the open book's anatomy: each page dips into the gutter and rises to a gentle crown near the outer edge
  const PAGE_DIP = 0.1;
  const PAGE_SEG = 20;
  const SPAN = 0.7; // page width (same as PW below)
  const pageCurve = (t: number) => -PAGE_DIP * Math.pow(1 - t, 2.2) + 0.012 * Math.sin(Math.PI * t); // t: 0 at the gutter, 1 at the outer edge

  // page stack: one lofted mesh per side. Its top follows the page curve; the front and outer faces carry the page-edge
  // lines and flare out a little toward the cover, like leaves fanning out from the spine.
  const stackMat = keepMat(new THREE.MeshBasicMaterial({ map: pageEdgeTexture(), side: THREE.DoubleSide }));
  const FLX = 0.06;
  const FLZ = 0.004;
  const stackGeo = (s: number) => {
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const topAt = (t: number) => 0.111 + pageCurve(t);
    const strip = (zs: number) => {
      const b = pos.length / 3;
      for (let i = 0; i <= PAGE_SEG; i++) {
        const t = i / PAGE_SEG;
        const x = s * (0.02 + t * SPAN);
        const xb = s * (0.02 + t * SPAN + FLX * Math.pow(t, 6));
        pos.push(x, topAt(t), zs * 0.48, xb, 0, zs * (0.48 + FLZ));
        uvs.push(t, topAt(t) / 0.111, t, 0);
      }
      for (let i = 0; i < PAGE_SEG; i++) {
        const a = b + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    };
    strip(1);
    strip(-1);
    const b = pos.length / 3; // the outer face
    const xo = s * (0.02 + SPAN);
    const xb = s * (0.02 + SPAN + FLX);
    pos.push(xo, topAt(1), -0.48, xo, topAt(1), 0.48, xb, 0, -(0.48 + FLZ), xb, 0, 0.48 + FLZ);
    uvs.push(0, 1, 1, 1, 0, 0, 1, 0);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    const g = keepGeo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return g;
  };
  B.add(new THREE.Mesh(stackGeo(-1), stackMat), new THREE.Mesh(stackGeo(1), stackMat));
  // painted leather on top of each cover board: tooled border, iron corner brackets and a clasp on the outer edge
  const coverPlane = (x: number, left: boolean) => {
    const o = new THREE.Mesh(
      keepGeo(new THREE.PlaneGeometry(COV_X - 0.02, COV_Z * 2).rotateX(-Math.PI / 2)),
      keepMat(new THREE.MeshBasicMaterial({ map: coverTexture(left) })),
    );
    o.position.set(x, 0.0015, 0); 
    B.add(o);
  };
  coverPlane(-(COV_X + 0.02) / 2, true);
  coverPlane((COV_X + 0.02) / 2, false);
  // soft shadow ring where each page block sits on its cover board, and a shadow under the whole book on the desk
  const blockShadowM = keepMat(
    new THREE.MeshBasicMaterial({ map: keepTex(frameShadowTexture(440, 540, 40, 20, 360, 500, 22)), transparent: true, opacity: 0.8, depthWrite: false }),
  );
  for (const sx of [-0.38, 0.38]) {
    const o = new THREE.Mesh(keepGeo(new THREE.PlaneGeometry(0.88, 1.08).rotateX(-Math.PI / 2)), blockShadowM);
    o.position.set(sx, 0.0025, 0);
    o.renderOrder = 1;
    B.add(o);
  }
  const deskShadowM = keepMat(
    new THREE.MeshBasicMaterial({ map: keepTex(frameShadowTexture(800, 600, 64, 76, 672, 448, 40)), transparent: true, opacity: 0.7, depthWrite: false }),
  );
  const deskShadow = new THREE.Mesh(keepGeo(new THREE.PlaneGeometry(2.0, 1.0).rotateX(-Math.PI / 2)), deskShadowM);
  deskShadow.position.set(0, -0.044, 0);
  deskShadow.renderOrder = 1;
  B.add(deskShadow);

  // ---- pages -------------------------------------------------------------------------------------------------
  const PW = 0.7;
  const PH = 0.96;
  const pageGeo = (side: number) => {
    const g = keepGeo(new THREE.PlaneGeometry(PW, PH, PAGE_SEG, 1).rotateX(-Math.PI / 2));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = side > 0 ? (p.getX(i) + PW / 2) / PW : (PW / 2 - p.getX(i)) / PW; // 0 at the gutter, 1 at the outer edge
      p.setY(i, pageCurve(t));
    }
    return g;
  };
  const mkInk = () => keepMat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const mkGlow = () => keepMat(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }));
  const leftInk = mkInk();
  const rightInk = mkInk();
  const leftGlow = mkGlow();
  const rightGlow = mkGlow();
  const place = (m: THREE.Material, x: number, y: number, order = 0) => {
    const o = new THREE.Mesh(pageGeo(x < 0 ? -1 : 1), m);
    o.position.set(x, y, 0);
    o.renderOrder = order;
    B.add(o);
    return o;
  };
  place(leftInk, -0.37, 0.112);
  place(rightInk, 0.37, 0.112);
  place(leftGlow, -0.37, 0.116, 3);
  place(rightGlow, 0.37, 0.116, 3);

  // turning leaf: a strip rotated about the spine, far edge lagging so it curls. Front and back are separate
  // meshes so the text reads correctly on both faces (the back uses a mirrored texture).
  const NU = 20;
  const fg = keepGeo(new THREE.BufferGeometry());
  const fp = new Float32Array((NU + 1) * 6);
  const fu = new Float32Array((NU + 1) * 4);
  const fi: number[] = [];
  for (let i = 0; i <= NU; i++) {
    for (let r = 0; r < 2; r++) {
      const k = i * 2 + r;
      fu[k * 2] = i / NU;
      fu[k * 2 + 1] = r ? 0 : 1;
    }
  }
  for (let i = 0; i < NU; i++) {
    const a = i * 2;
    fi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  fg.setAttribute('uv', new THREE.BufferAttribute(fu, 2));
  fg.setIndex(fi);
  const frontMat = keepMat(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide }));
  const backMat = keepMat(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }));
  const leafF = new THREE.Mesh(fg, frontMat);
  const leafB = new THREE.Mesh(fg, backMat);
  leafF.frustumCulled = leafB.frustumCulled = false;
  leafF.visible = leafB.visible = false;
  B.add(leafF, leafB);
  const poseFlip = (th: number) => {
    for (let i = 0; i <= NU; i++) {
      const u = (i / NU) * PW;
      const ph = Math.min(Math.PI, Math.max(0, th - 0.75 * Math.sin(th) * Math.pow(u / PW, 1.1)));
      for (let r = 0; r < 2; r++) {
        const k = (i * 2 + r) * 3;
        fp[k] = (0.02 + u) * Math.cos(ph);
        fp[k + 1] = 0.12 + (0.02 + u) * Math.sin(ph) + pageCurve(u / PW) * (1 - Math.sin(ph));
        fp[k + 2] = r ? 0.48 : -0.48;
      }
    }
    fg.attributes.position.needsUpdate = true;
  };

  // glow above the book, soft backlight behind the lectern
  const bookGlowM = keepMat(
    new THREE.SpriteMaterial({ map: glowTex, color: 0x7ff5e4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 }),
  );
  const bookGlow = new THREE.Sprite(bookGlowM);
  bookGlow.scale.set(3.4, 2.2, 1);
  bookGlow.position.set(0, 0.4, 0.1);
  D.add(bookGlow);
  const backM = keepMat(
    new THREE.MeshBasicMaterial({ map: glowTex, color: 0x7ff5e4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.25 }),
  );
  const backGlow = new THREE.Mesh(keepGeo(new THREE.PlaneGeometry(5.5, 3.6)), backM);
  backGlow.position.set(0, BOOK_Y, -(LECT_U + 1.4));
  backGlow.renderOrder = 1;
  body.add(backGlow);

  // ---- chat book state: a spread shows pages[cur] on the right and pages[cur - 1] on the left; cur is always even.
  // One question and its answer share a spread (question left, answer right), so one question is one page turn.
  const mkPage = (o: Partial<Page>): Page => ({ kind: 'blank', lines: [], first: true, num: 0, reveal: Infinity, answer: -1, pending: false, more: false, ...o });
  const blankPage = mkPage({});
  const blankTex = makePageTex(blankPage);
  const pages: Page[] = [
    mkPage({
      kind: 'title',
      num: 1,
      lines: ['Ask about the projects, the', 'stack or the background.', '', 'Write your question below.', 'Each answer is written here.'],
    }),
  ];
  const cache = new Map<number, PageTex>();
  let cur = 0;
  let target = 0;
  let exchanges = 0;
  let pendingIdx = -1;
  let revealing = -1;
  let leftShown = -2;
  let rightShown = -2;
  let flipping: { dir: 1 | -1; t: number; dur: number } | null = null;
  let mirrored: THREE.CanvasTexture | null = null;

  const lastCur = () => ((pages.length - 1) % 2 === 0 ? pages.length - 1 : pages.length);
  const texFor = (i: number): PageTex => {
    if (i < 0 || (i >= pages.length && i % 2 !== 0)) return blankTex;
    let t = cache.get(i);
    if (!t) {
      t = makePageTex(i < pages.length ? pages[i] : mkPage({ num: i + 1 }));
      cache.set(i, t);
    }
    return t;
  };
  const setMap = (m: THREE.MeshBasicMaterial, t: THREE.Texture | null) => {
    if (m.map !== t) {
      m.map = t;
      m.needsUpdate = true;
    }
  };
  const setLeft = (i: number) => {
    leftShown = i;
    const t = texFor(i);
    setMap(leftInk, t.ink);
    setMap(leftGlow, t.glow);
  };
  const setRight = (i: number) => {
    rightShown = i;
    const t = texFor(i);
    setMap(rightInk, t.ink);
    setMap(rightGlow, t.glow);
  };
  const dropTex = (i: number) => {
    const t = cache.get(i);
    if (t) {
      t.ink.dispose();
      t.glow.dispose();
      cache.delete(i);
    }
  };
  const prune = () => {
    for (const k of [...cache.keys()]) if (k < cur - 5 || k > cur + 5) dropTex(k);
  };
  const repaint = (i: number) => {
    const t = cache.get(i);
    if (!t) return;
    const pg = pages[i] ?? mkPage({ num: i + 1 }); // the trailing blank right page has no entry in pages
    paintPage(t.ci, pg, false);
    paintPage(t.cg, pg, true);
    t.ink.needsUpdate = true;
    t.glow.needsUpdate = true;
  };
  const emit = () => {
    const last = lastCur();
    const detail: BookState = {
      index: cur / 2,
      count: last / 2 + 1,
      canPrev: cur > 0,
      canNext: cur < last,
      turning: !!flipping,
      answer: pages[cur]?.answer ?? -1,
    };
    window.dispatchEvent(new CustomEvent('book-state', { detail }));
    repaintNav();
  };
  const repaintInput = () => {
    if (cache.has(cur)) repaint(cur);
  };
  const repaintNav = () => {
    navState.prev = cur > 0;
    navState.next = cur < lastCur();
    if (cur - 1 < 0) {
      paintPage(blankTex.ci, blankPage, false);
      blankTex.ink.needsUpdate = true;
    } else {
      repaint(cur - 1);
    }
  };
  const refresh = () => {
    setLeft(cur - 1);
    setRight(cur);
    repaintInput();
    repaintNav();
  };
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const mirrorOf = (t: THREE.CanvasTexture) => {
    const c = t.clone();
    c.wrapS = THREE.RepeatWrapping;
    c.repeat.x = -1;
    c.offset.x = 1;
    c.colorSpace = THREE.SRGBColorSpace;
    c.needsUpdate = true;
    return c;
  };

  const pump = () => {
    if (flipping || cur === target) return;
    const dir: 1 | -1 = target > cur ? 1 : -1;
    if (reduceMotion()) {
      cur += dir * 2;
      refresh();
      prune();
      emit();
      pump();
      return;
    }
    const dur = Math.abs(target - cur) > 2 ? 0.45 : 1.2;
    // forward: the leaf carries the right page over to the left; its back is the new left page; the new right page waits underneath.
    // backward: the leaf carries the left page over to the right; its front is the new right page; the new left page waits underneath.
    const front = dir > 0 ? texFor(cur) : texFor(cur - 2);
    const back = dir > 0 ? texFor(cur + 1) : texFor(cur - 1);
    setMap(frontMat, front.ink);
    if (mirrored) mirrored.dispose();
    mirrored = mirrorOf(back.ink);
    setMap(backMat, mirrored);
    if (dir > 0) setRight(cur + 2);
    else setLeft(cur - 3);
    flipping = { dir, t: 0, dur };
    poseFlip(dir > 0 ? 0 : Math.PI);
    leafF.visible = leafB.visible = true;
    emit();
  };
  const endFlip = () => {
    if (!flipping) return;
    cur += flipping.dir * 2;
    flipping = null;
    leafF.visible = leafB.visible = false;
    refresh();
    if (mirrored) {
      mirrored.dispose();
      mirrored = null;
    }
    prune();
    emit();
    pump();
  };
  const goTo = (i: number) => {
    let t = Math.max(0, Math.min(lastCur(), i));
    if (t % 2) t -= 1;
    target = t;
    pump();
  };

  const tickReveal = (dt: number) => {
    if (revealing < 0) return;
    const p = pages[revealing];
    if (!p || !Number.isFinite(p.reveal)) {
      revealing = -1;
      return;
    }
    const total = p.lines.reduce((n, l) => n + l.length, 0);
    const before = Math.floor(p.reveal / 3);
    p.reveal += dt * 100;
    if (p.reveal >= total) {
      p.reveal = Infinity;
      repaint(revealing);
      revealing = -1;
    } else if (Math.floor(p.reveal / 3) !== before) {
      repaint(revealing);
    }
  };

  const onMessage = (e: Event) => {
    const d = (e as CustomEvent<{ role?: string; text?: string }>).detail;
    const text = d && typeof d.text === 'string' ? cleanText(d.text) : '';
    if (!text) return;
    const W = PAGE_W_PX - 2 * PAGE_MARGIN;
    if (d.role === 'user') {
      for (const k of [...cache.keys()]) if (k >= pages.length) dropTex(k);
      if (pages.length % 2 === 0) pages.push(mkPage({ num: pages.length + 1 })); // keep every question on a left page
      pages.push(mkPage({ kind: 'user', num: pages.length + 1, lines: wrapText(text, FONT_USER, W).slice(0, LINES_PER_PAGE) }));
      pendingIdx = pages.length;
      pages.push(mkPage({ kind: 'assistant', num: pages.length + 1, lines: ['Thinking...'], pending: true, answer: exchanges }));
      exchanges++;
      emit();
      goTo(pendingIdx);
      return;
    }
    if (pendingIdx < 0) return;
    const idx = pendingIdx;
    pendingIdx = -1;
    const lines = layoutAnswer(text, W);
    const head = pages[idx];
    head.pending = false;
    head.lines = lines.slice(0, LINES_PER_PAGE);
    head.reveal = reduceMotion() ? Infinity : 0;
    for (let i = LINES_PER_PAGE; i < lines.length; i += LINES_PER_PAGE) {
      pages.push(mkPage({ kind: 'assistant', num: pages.length + 1, lines: lines.slice(i, i + LINES_PER_PAGE), first: false }));
    }
    for (let k = idx; k < pages.length - 1; k++) pages[k].more = true;
    for (const k of [...cache.keys()]) if (k > idx) dropTex(k);
    dropTex(idx);
    if (rightShown === idx) setRight(idx);
    if (leftShown === idx) setLeft(idx);
    revealing = Number.isFinite(head.reveal) ? idx : -1;
    emit();
  };
  const onReset = () => {
    pages.length = 1;
    cur = 0;
    target = 0;
    exchanges = 0;
    pendingIdx = -1;
    revealing = -1;
    flipping = null;
    leafF.visible = leafB.visible = false;
    for (const k of [...cache.keys()]) dropTex(k);
    if (mirrored) {
      mirrored.dispose();
      mirrored = null;
    }
    refresh();
    emit();
  };
  const onNav = (e: Event) => {
    const d = (e as CustomEvent<string>).detail;
    if (d === 'prev') goTo(target - 2);
    else if (d === 'next') goTo(target + 2);
    else if (d === 'first') goTo(0);
    else if (d === 'last') goTo(lastCur());
    else if (d === 'query') emit();
  };
  window.addEventListener('chat-message', onMessage);
  window.addEventListener('chat-reset', onReset);
  let blinkAt = 0;
  const onInput = (e: Event) => {
    const d = (e as CustomEvent<{ text?: string; focus?: boolean; caret?: number }>).detail;
    inputState.text = d && typeof d.text === 'string' ? d.text : '';
    inputState.focus = !!(d && d.focus);
    inputState.caret = d && typeof d.caret === 'number' ? d.caret : inputState.text.length;
    inputState.blink = true; // the caret stays solid while you type or move it
    blinkAt = performance.now();
    if (!flipping) repaintInput();
  };
  window.addEventListener('book-input', onInput);
  window.addEventListener('book-nav', onNav);
  refresh();
  emit();

  // ---- the court's one light: above and in front of the lectern so the avenue and the book both catch it -------------
  const light = new THREE.PointLight(0x58f0dc, LIGHT_BASE, 40, 2);
  light.position.set(0, 7, -41);
  group.add(light);
  const WARM_BASE = 3.5;
  const warm = new THREE.PointLight(0xff9a50, WARM_BASE, 6, 2);
  warm.position.set(0, BOOK_Y + 1.1, -(LECT_U - 1.3));
  group.add(warm);

  // ---- camera route ----------------------------------------------------------------------------------------------------
  const y0 = endPt.y;
  const route = new THREE.CatmullRomCurve3(
    [
      toWorld(0, 0, y0),
      toWorld(3, 1.6, y0 - 0.3),
      toWorld(6.5, 4.4, 2.8),
      toWorld(11, 4.6, 2.5),
      toWorld(15.5, 2.8, 2.1),
      toWorld(19.5, 0.5, 1.8),
      toWorld(24, 0, 1.7),
      toWorld(32, 0, 2.0),
      toWorld(38, 0, 3.6),
      toWorld(CAM_END_U, 0, CAM_END_Y),
    ],
    false,
    'catmullrom',
    0.5,
  );
  const routePoints = route
    .getSpacedPoints(120)
    .filter((p) => (p.x - origin.x) * f.x + (p.z - origin.z) * f.z <= U_GATE)
    .slice(1);
  const bookWorld = toWorld(LECT_U, 0, BOOK_Y);

  // ---- speaking pulse ----------------------------------------------------------------------------------------------------
  let speakingTarget = 0;
  let speaking = 0;
  let bookLevel = 0;
  const onSpeaking = (e: Event) => {
    speakingTarget = (e as CustomEvent<boolean>).detail ? 1 : 0;
  };
  window.addEventListener('chat-speaking', onSpeaking);

  const lastCam = new THREE.Vector3();
  const bq = new THREE.Vector3();
  const BQX = [-0.72, 0.72, 0.72, -0.72];
  const BQZ = [-0.48, -0.48, 0.48, 0.48];
  const quadNow = [0, 0, 0, 0, 0, 0, 0, 0];
  const quadSent = [0, 0, 0, 0, 0, 0, 0, 0];
  let quadOk: boolean | null = null;
  const gzA = new THREE.Vector3();
  const gzB = new THREE.Vector3();
  const gzC = new THREE.Vector3();
  const endDirV = new THREE.Vector3().subVectors(bookWorld, toWorld(CAM_END_U, 0, CAM_END_Y));
  const endYaw = Math.atan2(endDirV.x, endDirV.z);
  const endPitch = Math.atan2(endDirV.y, Math.hypot(endDirV.x, endDirV.z));
  const aimYawPitch = (A: THREE.Vector3, yaw1: number, pitch1: number, k: number, out: THREE.Vector3) => {
    const a = gzA.subVectors(A, lastCam);
    const ya = Math.atan2(a.x, a.z);
    let dy = yaw1 - ya;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const pa = Math.atan2(a.y, Math.hypot(a.x, a.z));
    const yaw = ya + dy * k;
    const pitch = pa + (pitch1 - pa) * k;
    out.set(
      lastCam.x + Math.sin(yaw) * Math.cos(pitch) * 10,
      lastCam.y + Math.sin(pitch) * 10,
      lastCam.z + Math.cos(yaw) * Math.cos(pitch) * 10,
    );
  };
  const gzD = new THREE.Vector3();
  const blendAim = (A: THREE.Vector3, B: THREE.Vector3, s: number, out: THREE.Vector3) => {
    const a = gzA.subVectors(A, lastCam);
    const b = gzB.subVectors(B, lastCam);
    const ya = Math.atan2(a.x, a.z);
    let dy = Math.atan2(b.x, b.z) - ya;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const pa = Math.atan2(a.y, Math.hypot(a.x, a.z));
    const pb = Math.atan2(b.y, Math.hypot(b.x, b.z));
    const yaw = ya + dy * s;
    const pitch = pa + (pb - pa) * s;
    const dist = Math.max(1, a.length() + (b.length() - a.length()) * s);
    out.set(
      lastCam.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      lastCam.y + Math.sin(pitch) * dist,
      lastCam.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    );
  };
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
      route.getPointAt(routeE(t), out);
      lastCam.copy(out); // gaze() runs right after this, so it sees the current frame's camera
      return out;
    },
    gaze(_t, fireAim, out, pos) {
      // Pure function of the camera's distance along the court. Stage 1 (u 5..16): turn from the fire to straight
      // down the court. Stage 2 (u 22..end): tilt down onto the book. Both ease out to zero speed, and the fire is
      // never used once it is behind the camera, so there is no wrap-around flip at the end.
      void gzC;
      void gzD;
      void blendAim;
      void aimYawPitch;
      void endDirV;
      void endYaw;
      void endPitch;
      const uCam = (pos.x - origin.x) * f.x + (pos.z - origin.z) * f.z;
      const a = gzA.subVectors(fireAim, pos);
      const ya = Math.atan2(a.x, a.z);
      const pa = Math.atan2(a.y, Math.hypot(a.x, a.z));
      let dy = Math.atan2(f.x, f.z) - ya;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const kTurn = smooth(5, 16, uCam);
      const kDrop = smooth(22, CAM_END_U, uCam);
      const pitchEnd = Math.atan2(BOOK_Y - CAM_END_Y, LECT_U - CAM_END_U);
      const yaw = ya + dy * kTurn;
      const p1 = pa + (-0.08 - pa) * kTurn;
      const pitch = p1 + (pitchEnd - p1) * kDrop;
      out.set(
        pos.x + Math.sin(yaw) * Math.cos(pitch) * 10,
        pos.y + Math.sin(pitch) * 10,
        pos.z + Math.cos(yaw) * Math.cos(pitch) * 10,
      );
    },
    projectBook(camera, width, height) {
      // Page corners (top-left, top-right, bottom-right, bottom-left) in screen pixels, for the DOM controls.
      let ok = body.visible;
      if (ok) {
        camera.updateMatrixWorld();
        B.updateWorldMatrix(true, false);
        for (let i = 0; i < 4; i++) {
          bq.set(BQX[i], 0.1, BQZ[i]).applyMatrix4(B.matrixWorld).project(camera);
          if (bq.z < -1 || bq.z > 1) ok = false;
          quadNow[i * 2] = (bq.x * 0.5 + 0.5) * width;
          quadNow[i * 2 + 1] = (0.5 - bq.y * 0.5) * height;
        }
      }
      let changed = ok !== quadOk;
      if (ok) for (let i = 0; i < 8; i++) if (Math.abs(quadNow[i] - quadSent[i]) > 0.05) changed = true;
      if (!changed) return;
      quadOk = ok;
      if (ok) for (let i = 0; i < 8; i++) quadSent[i] = quadNow[i];
      window.dispatchEvent(new CustomEvent('book-screen', { detail: { visible: ok, quad: quadSent.slice() } }));
    },
    update(clock, camera) {
      const dt = Math.min(Math.max(clock - lastClock, 0), 0.1);
      lastClock = clock;
      lastCam.copy(camera);
      body.visible = camera.distanceTo(centre) < 100;
      if (!body.visible) return;
      speaking += (speakingTarget - speaking) * Math.min(1, dt * 6);
      bookLevel += (speakingTarget - bookLevel) * (1 - Math.exp(-dt / (speakingTarget > bookLevel ? 0.6 : 1.5)));

      tickReveal(dt);
      if (inputState.focus) {
        const on = (performance.now() - blinkAt) % 1060 < 640;
        if (on !== inputState.blink) {
          inputState.blink = on;
          if (!flipping) repaintInput();
        }
      }
      if (flipping) {
        flipping.t += dt;
        const p = Math.min(1, flipping.t / flipping.dur);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        poseFlip(flipping.dir > 0 ? e * Math.PI : Math.PI * (1 - e));
        if (p >= 1) endFlip();
      }

      for (let k = 0; k < flamePos.length; k++) {
        const fpz = flamePos[k];
        const sy = 1 + 0.22 * Math.sin(clock * 9 + k * 1.7) + 0.1 * Math.sin(clock * 17 + k * 3.1);
        p3.set(fpz.x, fpz.y + 0.6 * sy, fpz.z);
        s3.set(0.34, 1.2 * sy, 0.34);
        m4.compose(p3, q, s3);
        flames.setMatrixAt(k * 2, m4);
        const sy2 = 0.9 + 0.2 * Math.sin(clock * 12 + k * 2.3);
        p3.set(fpz.x, fpz.y + 0.35 * sy2, fpz.z);
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
      for (let i = 0; i < EMBERS; i++) {
        const life = (emberBase[i * 4 + 3] + clock * emberBase[i * 4 + 2]) % 1;
        const a = emberBase[i * 4] + clock * 0.1;
        const r = emberBase[i * 4 + 1] * (1 + 0.25 * life);
        emberPos[i * 3] = Math.cos(a) * r;
        emberPos[i * 3 + 1] = 3.4 + life * 2.6;
        emberPos[i * 3 + 2] = -LECT_U + Math.sin(a) * r * 0.8;
      }
      (emberGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      emberMat.opacity = 0.85 * smooth(1.2, 2.8, camera.distanceTo(bookWorld)); // fades near the end so nothing crosses the page

      const pulse = speaking * (0.55 + 0.3 * Math.sin(clock * 14));
      light.intensity = LIGHT_BASE * (0.92 + 0.08 * Math.sin(clock * 7.3) + 0.04 * Math.sin(clock * 13) + bookLevel * 0.25);
      warm.intensity = WARM_BASE * (0.9 + 0.07 * Math.sin(clock * 8.1) + 0.04 * Math.sin(clock * 15.7));
      glowMat.color.copy(tealBase).multiplyScalar(0.75 + 0.12 * Math.sin(clock * 1.6) + pulse);
      archHaloMat.opacity = 0.3 + 0.08 * Math.sin(clock * 1.6) + speaking * 0.25;
      shaftMat.opacity = 0.14 + 0.04 * Math.sin(clock * 0.5);

      // book glow: the written words light up while the bot speaks
      leftGlow.opacity = rightGlow.opacity = 0; // lit words were unreadable on the pale paper; the book still glows around the edges
      trimM.opacity = 0.25 + 0.6 * bookLevel;
      bookGlowM.opacity = 0; // an additive glow washes out the parchment
      backM.opacity = 0.25 + 0.15 * bookLevel;

      moteMat.opacity = 0.8 * smooth(1.5, 4.5, camera.distanceTo(bookWorld)); // drifting lights must not cross the page
      mistTex.offset.x = (clock * 0.01) % 1;
      gateMistMat.opacity = 0.5 * smooth(1.2, 7, camera.distanceTo(gateWorld));
      gateMist.visible = gateMistMat.opacity > 0.01;
    },
    dispose() {
      window.removeEventListener('chat-speaking', onSpeaking);
      window.removeEventListener('chat-message', onMessage);
      window.removeEventListener('chat-reset', onReset);
      window.removeEventListener('book-nav', onNav);
      window.removeEventListener('book-input', onInput);
      for (const v of cache.values()) {
        v.ink.dispose();
        v.glow.dispose();
      }
      cache.clear();
      blankTex.ink.dispose();
      blankTex.glow.dispose();
      mirrored?.dispose();
      meshes.forEach((m) => m.dispose());
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
}