// Camera journey: P1..Pn -> CatmullRomCurve3 -> arc-length table -> speed profile (slow near stops).
// Only three.js math here (no DOM), so scripts/gen-stops.ts can run it under Node.
import * as THREE from 'three';
import { cellXZ, tableLayout, type Cell, type Plan } from './plan';

export interface Stop {
  chapterId: string;
  progress: number;
  anchor: [number, number, number];
}

export interface Journey {
  curve: THREE.CatmullRomCurve3;
  /** Total arc length in world units. */
  length: number;
  stops: Stop[];
  /** Arc-length position of each stop, parallel to `stops`. */
  stopS: number[];
  /** Camera position and look-at target for a 0..1 progress value. */
  sample(progress: number, pos: THREE.Vector3, look: THREE.Vector3): void;
  /** Evenly spaced (by arc length) points for drawing the path. */
  polyline(count: number): THREE.Vector3[];
  /** Arc-length position (0..length) the camera is at for a 0..1 progress value. */
  sAt(progress: number): number;
  /** Curve point at an arc-length position (clamped to 0..length). */
  pointAt(s: number, out: THREE.Vector3): THREE.Vector3;
}

const ARC_SAMPLES = 4000;
const SPEED_SAMPLES = 3000;
const MIN_STOP_GAP = 4; // units of arc between consecutive stops

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const STOP_ORDER = ['home', 'about', 'project-1', 'project-2', 'project-3', 'project-4', 'project-5', 'project-6', 'tech', 'connect'];

export function buildJourney(plan: Plan): Journey {
  const tbl = tableLayout(plan);
  const heightAt = (cell: Cell) => plan.height[cell.r][cell.c];

  // 1. Curve through the waypoints at eye height (plus floor height, so the raised end lifts the camera).
  const pts = plan.waypoints.map((w) => {
    const [x, z] = cellXZ(plan, w);
    return new THREE.Vector3(x, plan.eye + heightAt(w), z);
  });
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');

  // 2. Arc-length table: arcS[i] is the length of the curve from u=0 to u=i/ARC_SAMPLES.
  const arcS = new Float64Array(ARC_SAMPLES + 1);
  const arcPts: THREE.Vector3[] = [];
  const tmp = new THREE.Vector3();
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const p = curve.getPoint(i / ARC_SAMPLES, new THREE.Vector3());
    arcPts.push(p);
    arcS[i] = i === 0 ? 0 : arcS[i - 1] + p.distanceTo(arcPts[i - 1]);
  }
  const length = arcS[ARC_SAMPLES];

  const uAtS = (s: number) => {
    const t = Math.min(Math.max(s, 0), length);
    let lo = 0;
    let hi = ARC_SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arcS[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = arcS[hi] - arcS[lo] || 1;
    return (lo + (t - arcS[lo]) / span) / ARC_SAMPLES;
  };
  const pointAtS = (s: number, out: THREE.Vector3) => curve.getPoint(uAtS(s), out);

  // 3. Stop anchors and their arc positions. Search forward only, so stops stay in order even where the
  //    path loops around the table.
  const anchors: { id: string; anchor: THREE.Vector3 }[] = [];
  const marker = (id: string) => {
    const m = plan.stopMarkers[id];
    if (!m) throw new Error(`layout: stop marker "${id}" is missing from the plan`);
    const [x, z] = cellXZ(plan, m);
    return new THREE.Vector3(x, plan.eye + heightAt(m), z);
  };
  for (const id of STOP_ORDER) {
    if (id.startsWith('project-')) {
      const seat = tbl.seats[Number(id.slice(8)) - 1];
      anchors.push({ id, anchor: new THREE.Vector3(seat.x, 1.0, seat.z) });
    } else {
      anchors.push({ id, anchor: marker(id) });
    }
  }

  const stopS: number[] = [];
  let from = 0;
  for (const { anchor } of anchors) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i <= ARC_SAMPLES; i++) {
      if (arcS[i] < from) continue;
      const dx = arcPts[i].x - anchor.x;
      const dz = arcPts[i].z - anchor.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const s = arcS[best < 0 ? ARC_SAMPLES : best];
    stopS.push(s);
    from = s + MIN_STOP_GAP;
  }

  // 4. Speed profile: 1 everywhere, `slowSpeed` inside a plateau around each stop, smooth ramp out to
  //    `slowRadius`. Progress is the normalised time it takes to travel there.
  const speedAt = (s: number) => {
    let env = 0;
    for (const ss of stopS) env = Math.max(env, 1 - smoothstep(plan.slowPlateau, plan.slowRadius, Math.abs(s - ss)));
    return 1 - (1 - plan.slowSpeed) * env;
  };
  const timeAt = new Float64Array(SPEED_SAMPLES + 1);
  const ds = length / SPEED_SAMPLES;
  for (let j = 1; j <= SPEED_SAMPLES; j++) {
    timeAt[j] = timeAt[j - 1] + ds / speedAt((j - 0.5) * ds);
  }
  const totalTime = timeAt[SPEED_SAMPLES];

  const progressAtS = (s: number) => {
    const f = Math.min(Math.max(s / ds, 0), SPEED_SAMPLES);
    const j = Math.min(Math.floor(f), SPEED_SAMPLES - 1);
    return (timeAt[j] + (timeAt[j + 1] - timeAt[j]) * (f - j)) / totalTime;
  };
  const sAtProgress = (p: number) => {
    const t = Math.min(Math.max(p, 0), 1) * totalTime;
    let lo = 0;
    let hi = SPEED_SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (timeAt[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = timeAt[hi] - timeAt[lo] || 1;
    return (lo + (t - timeAt[lo]) / span) * ds;
  };

  const stops: Stop[] = anchors.map(({ id, anchor }, i) => ({
    chapterId: id,
    progress: Math.round(progressAtS(stopS[i]) * 10000) / 10000,
    anchor: [round2(anchor.x), round2(anchor.y), round2(anchor.z)],
  }));

  // 5. Sampling: look a little ahead along the curve, and near each stop swing the gaze onto its anchor.
  const ahead = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const sample = (progress: number, pos: THREE.Vector3, look: THREE.Vector3) => {
    const s = sAtProgress(progress);
    pointAtS(s, pos);
    if (s + plan.lookAhead <= length) pointAtS(s + plan.lookAhead, ahead);
    else {
      curve.getTangent(1, tangent);
      ahead.copy(pos).addScaledVector(tangent, 10);
    }
    look.copy(ahead);
    // Only the strongest stop influences the gaze, so overlapping windows do not compound.
    let bestW = 0;
    let bestI = -1;
    for (let i = 0; i < stopS.length; i++) {
      const a = anchors[i].anchor;
      const near = 1 - smoothstep(plan.slowPlateau, plan.slowRadius, Math.abs(s - stopS[i]));
      if (near <= 0) continue;
      // Anchors that sit on the path itself (e.g. the Home marker) would make the gaze degenerate.
      const flat = Math.hypot(a.x - pos.x, a.z - pos.z);
      const w = near * smoothstep(2, 6, flat);
      if (w > bestW) {
        bestW = w;
        bestI = i;
      }
    }
    if (bestI >= 0) look.lerp(anchors[bestI].anchor, bestW);
  };

  const polyline = (count: number) => {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) out.push(pointAtS((i / (count - 1)) * length, tmp.clone()));
    return out;
  };

  return { curve, length, stops, stopS, sample, polyline, sAt: sAtProgress, pointAt: pointAtS };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
