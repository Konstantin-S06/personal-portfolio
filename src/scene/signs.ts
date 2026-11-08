// Text in the world, all decorative (the canvas is aria-hidden; the DOM panels carry the real text):
//  - one wall banner per stop, drawn into a single canvas atlas (one draw call), dim until the camera is near
//  - a floating rune numeral above every chair and a rune ring under it, brightened when the camera reaches
//    that seat (the light for that moment is a pooled light, driven from kitWorld using `seatSpot`)
import * as THREE from 'three';
import * as L from './look';
import type { Plan, TableLayout } from './plan';
import type { Journey } from './journey';
import { fadeToBlackInFog, type Fx } from './fx';
import { wallEdges, type WallEdge } from './scatter';

export interface BannerLabel {
  /** Stop id as used by stops.generated.json (home, about, project-1 .. project-6, tech, connect). */
  stopId: string;
  title: string;
  context?: string;
}

export interface SeatSpot {
  /** Index of the reached seat, or -1. */
  index: number;
  /** 0..1 ease of the reached seat. */
  weight: number;
  position: THREE.Vector3;
}

export interface Signs {
  group: THREE.Group;
  /** Edge keys taken by stop banners, so the decorative banners keep off them. */
  reservedEdges: Set<string>;
  /** Horizontal segments from where the camera parks at each stop to its banner; props keep clear of them. */
  sightLines: { ax: number; az: number; bx: number; bz: number }[];
  seatSpot: SeatSpot;
  setLabels(labels: BannerLabel[]): void;
  /** `s` is the camera's arc-length position on the path. */
  update(camera: THREE.Vector3, s: number, dt: number, seconds: number, animate: boolean): void;
  dispose(): void;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const fontFamily = (): string => {
  const style = getComputedStyle(document.documentElement);
  const site = style.getPropertyValue('--font-display').trim() || style.getPropertyValue('--font-main').trim();
  return site ? `${site}, ${L.BANNER_FONT_FALLBACK}` : L.BANNER_FONT_FALLBACK;
};

/** Makes a MeshBasicMaterial sample one tile of an atlas, chosen per instance by the `aTile` attribute. */
function atlasTiles(mat: THREE.MeshBasicMaterial, cols: number, rows: number, key: string, additive = false) {
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    if (additive) fadeToBlackInFog(shader);
    shader.uniforms.uTile = { value: new THREE.Vector2(1 / cols, 1 / rows) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aTile;\nuniform vec2 uTile;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vMapUv * uTile + aTile;\n#endif');
  };
}

function tileAttribute(count: number, cols: number, rows: number): THREE.InstancedBufferAttribute {
  const a = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    a[i * 2] = (i % cols) / cols;
    a[i * 2 + 1] = 1 - (Math.floor(i / cols) + 1) / rows;
  }
  return new THREE.InstancedBufferAttribute(a, 2);
}

// ---- banner artwork ----------------------------------------------------------------------------------------

function wrapLines(g: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (line && g.measureText(t).width > maxWidth) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function drawBanner(g: CanvasRenderingContext2D, ox: number, oy: number, label: BannerLabel | undefined, family: string, fallbackTitle: string) {
  const W = L.BANNER_TEX_W;
  const H = L.BANNER_TEX_H;
  g.save();
  g.translate(ox, oy);
  g.beginPath();
  g.rect(0, 0, W, H);
  g.clip();
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, L.BANNER_BG[0]);
  bg.addColorStop(1, L.BANNER_BG[1]);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = L.BANNER_BORDER;
  g.lineWidth = 7;
  g.strokeRect(22, 22, W - 44, H - 44);
  g.lineWidth = 2;
  g.strokeRect(38, 38, W - 76, H - 76);
  g.fillStyle = L.BANNER_BORDER;
  for (const [cx, cy] of [[22, 22], [W - 22, 22], [22, H - 22], [W - 22, H - 22]]) {
    g.beginPath();
    g.moveTo(cx, cy - 14); g.lineTo(cx + 14, cy); g.lineTo(cx, cy + 14); g.lineTo(cx - 14, cy);
    g.fill();
  }

  const title = label?.title || fallbackTitle;
  const context = label?.context;
  const maxW = W - 150;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = L.BANNER_TITLE_PX;
  let lines: string[] = [];
  for (; px >= 44; px -= 6) {
    g.font = `700 ${px}px ${family}`;
    lines = wrapLines(g, title, maxW);
    if (lines.length <= (context ? 2 : 3) && lines.every((l) => g.measureText(l).width <= maxW)) break;
  }
  const lineH = px * 1.12;
  const blockH = lines.length * lineH;
  const centre = context ? H * 0.43 : H * 0.5;
  g.fillStyle = L.BANNER_TEXT;
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 10;
  lines.forEach((l, i) => g.fillText(l, W / 2, centre - blockH / 2 + lineH * (i + 0.5)));
  g.shadowBlur = 0;

  if (context) {
    g.font = `500 ${L.BANNER_CONTEXT_PX}px ${family}`;
    let text = context;
    while (text.length > 4 && g.measureText(text).width > maxW) text = text.slice(0, -2).trimEnd() + '…';
    g.fillStyle = L.BANNER_CONTEXT_TEXT;
    g.fillText(text, W / 2, H * 0.84);
    g.strokeStyle = L.BANNER_BORDER;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W * 0.3, H * 0.74); g.lineTo(W * 0.7, H * 0.74);
    g.stroke();
  }
  g.restore();
}

// ---- rune artwork ------------------------------------------------------------------------------------------

const NUMERAL_CELL = 256;
const NUMERAL_COLS = 3;
const NUMERAL_ROWS = 2;

/** Numerals 1..6 as bind-runes: a stem with n branches, inside a ring. */
function numeralAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = NUMERAL_CELL * NUMERAL_COLS;
  c.height = NUMERAL_CELL * NUMERAL_ROWS;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  for (let n = 1; n <= 6; n++) {
    const cx = ((n - 1) % NUMERAL_COLS) * NUMERAL_CELL + NUMERAL_CELL / 2;
    const cy = Math.floor((n - 1) / NUMERAL_COLS) * NUMERAL_CELL + NUMERAL_CELL / 2;
    g.lineWidth = 7;
    g.beginPath();
    g.arc(cx, cy, 104, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 11;
    g.beginPath();
    g.moveTo(cx, cy - 72);
    g.lineTo(cx, cy + 72);
    g.stroke();
    for (let i = 0; i < n; i++) {
      const y = cy - 60 + (i + 0.5) * (120 / n);
      const dir = i % 2 ? -1 : 1;
      g.beginPath();
      g.moveTo(cx, y);
      g.lineTo(cx + dir * 34, y - 24);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function seatRingTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;
  const px = (r: number) => (r / L.SEAT_RING_OUTER) * mid;
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineWidth = 5;
  for (const r of [L.SEAT_RING_INNER + 0.03, L.SEAT_RING_OUTER - 0.03]) {
    g.beginPath();
    g.arc(mid, mid, px(r), 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 6;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const r0 = L.SEAT_RING_INNER + 0.08;
    const r1 = L.SEAT_RING_OUTER - 0.08;
    g.beginPath();
    g.moveTo(mid + dx * px(r0), mid + dy * px(r0));
    g.lineTo(mid + dx * px(r1), mid + dy * px(r1));
    const k = (i * 7) % 4;
    if (k > 0) {
      const rm = (r0 + r1) / 2;
      g.moveTo(mid + dx * px(rm), mid + dy * px(rm));
      g.lineTo(mid + (dx - dy * 0.5) * px(r1), mid + (dy + dx * 0.5) * px(r1));
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- build -----------------------------------------------------------------------------------------------

export function buildSigns(plan: Plan, tbl: TableLayout, journey: Journey, fx: Fx): Signs {
  const group = new THREE.Group();
  group.name = 'signs';
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o);
    return o;
  };
  const half = plan.cell / 2;

  // --- stop banners: wall nearest each stop, one atlas, one draw call ---
  const stops = journey.stops;
  const cols = L.BANNER_ATLAS_COLS;
  const rows = Math.ceil(stops.length / cols);
  const edges = wallEdges(plan);
  const reservedEdges = new Set<string>();
  const chosen: WallEdge[] = [];
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  for (const stop of stops) {
    journey.sample(stop.progress, pos, look);
    const vx = look.x - pos.x;
    const vz = look.z - pos.z;
    const vl = Math.hypot(vx, vz) || 1;
    let best: WallEdge | null = null;
    let bestScore = Infinity;
    for (const ed of edges) {
      if (reservedEdges.has(ed.key)) continue;
      if (chosen.some((o) => Math.hypot(o.x - ed.x, o.z - ed.z) < L.BANNER_W + 0.3)) continue;
      const facing = Math.max(0, -((vx / vl) * ed.nx + (vz / vl) * ed.nz));
      const score = Math.hypot(ed.x - stop.anchor[0], ed.z - stop.anchor[2]) - L.BANNER_FACING_BONUS * facing;
      if (score < bestScore) {
        bestScore = score;
        best = ed;
      }
    }
    if (!best) throw new Error(`signs: no free wall for stop ${stop.chapterId}`);
    reservedEdges.add(best.key);
    chosen.push(best);
  }

  const atlas = document.createElement('canvas');
  atlas.width = L.BANNER_TEX_W * cols;
  atlas.height = L.BANNER_TEX_H * rows;
  const ag = atlas.getContext('2d')!;
  const atlasTex = own(new THREE.CanvasTexture(atlas));
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = 4;
  let labels: BannerLabel[] = [];
  const paintBanners = () => {
    const family = fontFamily();
    stops.forEach((stop, i) => {
      const label = labels.find((l) => l.stopId === stop.chapterId);
      const fallback = stop.chapterId.replace(/-/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase());
      drawBanner(ag, (i % cols) * L.BANNER_TEX_W, Math.floor(i / cols) * L.BANNER_TEX_H, label, family, fallback);
    });
    atlasTex.needsUpdate = true;
  };
  paintBanners();
  let disposed = false;
  document.fonts?.ready.then(() => {
    if (!disposed) paintBanners(); // the site font may arrive after the first paint
  });

  const bannerGeo = own(new THREE.PlaneGeometry(L.BANNER_W, L.BANNER_H));
  bannerGeo.setAttribute('aTile', tileAttribute(stops.length, cols, rows));
  const bannerMat = own(new THREE.MeshBasicMaterial({ map: atlasTex }));
  atlasTiles(bannerMat, cols, rows, 'atlas-banners');
  const banners = new THREE.InstancedMesh(bannerGeo, bannerMat, stops.length);
  banners.name = 'stop-banners';
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  chosen.forEach((ed, i) => {
    quat.setFromAxisAngle(up, ed.rot);
    m4.compose(
      new THREE.Vector3(ed.cx - ed.nx * (half - L.BANNER_WALL_GAP), ed.y + L.BANNER_Y, ed.cz - ed.nz * (half - L.BANNER_WALL_GAP)),
      quat,
      new THREE.Vector3(1, 1, 1),
    );
    banners.setMatrixAt(i, m4);
    banners.setColorAt(i, col.setScalar(L.BANNER_DIM));
  });
  banners.instanceMatrix.needsUpdate = true;
  banners.computeBoundingSphere();
  group.add(banners);
  const bannerLevel = new Float32Array(stops.length).fill(-1);
  // Where the camera parks for each stop (it stops on the path, a few units from the stop's anchor).
  const parks = stops.map((stop) => {
    const p = new THREE.Vector3();
    journey.sample(stop.progress, p, look);
    return p;
  });

  // --- rune numerals and seat rings ---
  const seats = tbl.seats;
  const numTex = own(numeralAtlas());
  const numGeo = own(new THREE.PlaneGeometry(1, 1));
  numGeo.setAttribute('aTile', tileAttribute(seats.length, NUMERAL_COLS, NUMERAL_ROWS));
  const numMat = own(new THREE.MeshBasicMaterial({ map: numTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  atlasTiles(numMat, NUMERAL_COLS, NUMERAL_ROWS, 'atlas-numerals', true);
  fx.glow(numMat, L.NUMERAL_COLOR, L.NUMERAL_HDR_SCALE);
  const numerals = new THREE.InstancedMesh(numGeo, numMat, seats.length);
  numerals.name = 'seat-numerals';
  numerals.frustumCulled = false; // matrices change every frame
  group.add(numerals);

  const ringTex = own(seatRingTexture());
  const ringGeo = own(new THREE.RingGeometry(L.SEAT_RING_INNER, L.SEAT_RING_OUTER, 48).rotateX(-Math.PI / 2));
  const ringMat = own(new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  ringMat.customProgramCacheKey = () => 'seat-rings';
  ringMat.onBeforeCompile = fadeToBlackInFog;
  fx.glow(ringMat, L.NUMERAL_COLOR, L.SEAT_RING_HDR_SCALE);
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, seats.length);
  rings.name = 'seat-rings';
  seats.forEach((seat, i) => {
    m4.compose(new THREE.Vector3(seat.x, 0.02, seat.z), quat.identity(), new THREE.Vector3(1, 1, 1));
    rings.setMatrixAt(i, m4);
    rings.setColorAt(i, col.setScalar(L.SEAT_RING_DIM));
  });
  rings.instanceMatrix.needsUpdate = true;
  rings.computeBoundingSphere();
  group.add(rings);

  const seatW = new Float32Array(seats.length);
  const seatSpot: SeatSpot = { index: -1, weight: 0, position: new THREE.Vector3() };
  const scale = new THREE.Vector3(L.NUMERAL_SIZE, L.NUMERAL_SIZE, 1);
  let lastNumeralKey = '';
  const seatStopS = seats.map((seat) => {
    const i = stops.findIndex((st) => st.chapterId === `project-${seat.n}`);
    return i >= 0 ? journey.stopS[i] : Infinity;
  });

  return {
    group,
    reservedEdges,
    sightLines: parks.map((p, i) => ({
      ax: p.x,
      az: p.z,
      bx: chosen[i].cx - chosen[i].nx * half,
      bz: chosen[i].cz - chosen[i].nz * half,
    })),
    seatSpot,
    setLabels(next) {
      labels = next;
      paintBanners();
    },
    update(camera, s, dt, seconds, animate) {
      // banners: bright when the camera is within BANNER_NEAR of where it parks for that stop
      let bannersDirty = false;
      stops.forEach((_stop, i) => {
        const d = Math.hypot(camera.x - parks[i].x, camera.z - parks[i].z);
        const level = Math.round((L.BANNER_DIM + (L.BANNER_BRIGHT - L.BANNER_DIM) * (1 - smooth(L.BANNER_NEAR, L.BANNER_NEAR + L.BANNER_FADE, d))) * 200) / 200;
        if (level !== bannerLevel[i]) {
          bannerLevel[i] = level;
          banners.setColorAt(i, col.setScalar(level));
          bannersDirty = true;
        }
      });
      if (bannersDirty && banners.instanceColor) banners.instanceColor.needsUpdate = true;

      // seats: seat N is reached while the camera is near stop project-N along the path (the path circles the
      // table about 6-8 units from the chairs, so path position is a steadier signal than distance to the chair)
      const k = 1 - Math.exp(-L.SEAT_EASE * dt);
      let bestI = -1;
      let bestW = 0.001;
      seats.forEach((_seat, i) => {
        const target = 1 - smooth(L.SEAT_ARC_FULL, L.SEAT_ARC_FADE, Math.abs(s - seatStopS[i]));
        seatW[i] += (target - seatW[i]) * (dt > 0 ? k : 1);
        if (seatW[i] > bestW) {
          bestW = seatW[i];
          bestI = i;
        }
      });
      seatSpot.index = bestI;
      seatSpot.weight = bestI < 0 ? 0 : bestW;
      if (bestI >= 0) seatSpot.position.set(seats[bestI].x, L.SEAT_LIGHT_HEIGHT, seats[bestI].z);

      // numerals face the camera and bob; rings and numerals brighten with their seat's weight
      const key = `${camera.x.toFixed(2)},${camera.z.toFixed(2)},${animate ? seconds.toFixed(2) : 0},${Array.from(seatW, (w) => w.toFixed(2)).join()}`;
      if (key === lastNumeralKey) return;
      lastNumeralKey = key;
      seats.forEach((seat, i) => {
        const bob = animate ? Math.sin(seconds * 1.3 + i * 1.1) * L.NUMERAL_BOB : 0;
        quat.setFromAxisAngle(up, Math.atan2(camera.x - seat.x, camera.z - seat.z));
        m4.compose(pos.set(seat.x, L.NUMERAL_Y + bob, seat.z), quat, scale);
        numerals.setMatrixAt(i, m4);
        numerals.setColorAt(i, col.setScalar(L.NUMERAL_DIM + (L.NUMERAL_BRIGHT - L.NUMERAL_DIM) * seatW[i]));
        rings.setColorAt(i, col.setScalar(L.SEAT_RING_DIM + (L.SEAT_RING_BRIGHT - L.SEAT_RING_DIM) * seatW[i]));
      });
      numerals.instanceMatrix.needsUpdate = true;
      if (numerals.instanceColor) numerals.instanceColor.needsUpdate = true;
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    },
    dispose() {
      disposed = true;
      banners.dispose();
      numerals.dispose();
      rings.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}
