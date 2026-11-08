// Zones: corridor | chamber | final hall, split by the plan's door cells (largest z first, because the walk
// starts at the south end). Pure z-based, so it works for the camera, for instances and for prop placement.
import * as THREE from 'three';
import type { Plan } from './plan';
import { ZONE_BLEND, ZONE_LOOKS } from './look';

export interface ZoneSample {
  /** Continuous zone value: 0 corridor, 1 chamber, 2 final hall (blended near the doors). */
  value: number;
  fog: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  torch: THREE.Color;
  dust: THREE.Color;
  hemiIntensity: number;
}

export interface Zones {
  count: number;
  /** z of each door, in walking order. */
  doorZ: number[];
  valueAt(z: number): number;
  /** Hard zone index (nearest) for a z. */
  indexAt(z: number): number;
  sample(z: number, out?: ZoneSample): ZoneSample;
  /** Kit tint for a z, written into `out`. */
  tintAt(z: number, out: THREE.Color): THREE.Color;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const newZoneSample = (): ZoneSample => ({
  value: 0,
  fog: new THREE.Color(),
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  torch: new THREE.Color(),
  dust: new THREE.Color(),
  hemiIntensity: 1,
});

export function buildZones(plan: Plan): Zones {
  const doorZ = plan.doors.map((d) => d.r * plan.cell).sort((a, b) => b - a);
  const looks = ZONE_LOOKS.map((l) => ({
    fog: new THREE.Color(l.fog),
    hemiSky: new THREE.Color(l.hemiSky),
    hemiGround: new THREE.Color(l.hemiGround),
    torch: new THREE.Color(l.torch),
    dust: new THREE.Color(l.dust),
    tint: new THREE.Color(l.tint[0], l.tint[1], l.tint[2]),
    hemiIntensity: l.hemiIntensity,
  }));
  const last = looks.length - 1;

  const valueAt = (z: number) => {
    let v = 0;
    for (const dz of doorZ) v += smooth(dz + ZONE_BLEND, dz - ZONE_BLEND, z); // 0 south of a door, 1 north of it
    return Math.min(v, last);
  };

  const pick = (z: number) => {
    const v = valueAt(z);
    const i = Math.min(Math.floor(v), last - 1);
    return { a: looks[Math.max(i, 0)], b: looks[Math.min(i + 1, last)], f: last === 0 ? 0 : v - Math.max(i, 0), v };
  };

  return {
    count: looks.length,
    doorZ,
    valueAt,
    indexAt: (z) => Math.round(valueAt(z)),
    sample(z, out = newZoneSample()) {
      const { a, b, f, v } = pick(z);
      out.value = v;
      out.fog.copy(a.fog).lerp(b.fog, f);
      out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, f);
      out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, f);
      out.torch.copy(a.torch).lerp(b.torch, f);
      out.dust.copy(a.dust).lerp(b.dust, f);
      out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * f;
      return out;
    },
    tintAt(z, out) {
      const { a, b, f } = pick(z);
      return out.copy(a.tint).lerp(b.tint, f);
    },
  };
}
