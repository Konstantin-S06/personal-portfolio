// Glowing rune lines on the floor, one ribbon either side of the camera path (one draw call). A shader fades
// them in over the stretch ahead of the camera, so the way forward lights up as you walk.
import * as THREE from 'three';
import * as L from './look';
import type { Journey } from './journey';
import type { Plan } from './plan';
import { fadeToBlackInFog, type Fx } from './fx';

export interface FloorRunes {
  mesh: THREE.Mesh;
  update(progress: number, seconds: number): void;
  dispose(): void;
}

function glyphTexture(): THREE.CanvasTexture {
  // One repeat of the line: a rail along the middle with deterministic rune branches.
  const w = 256;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, h / 2);
  g.lineTo(w, h / 2);
  g.stroke();
  g.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    const x = 20 + i * 62;
    const k = (i * 5 + 2) % 4;
    g.beginPath();
    g.moveTo(x, 10);
    g.lineTo(x, h - 10);
    if (k !== 0) { g.moveTo(x, 20); g.lineTo(x + 18, 30); }
    if (k > 1) { g.moveTo(x, 38); g.lineTo(x - 16, 48); }
    if (k === 3) { g.moveTo(x, 12); g.lineTo(x + 14, 22); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildFloorRunes(plan: Plan, journey: Journey, fx: Fx): FloorRunes {
  const count = Math.max(2, Math.ceil(journey.length / L.RUNE_SPACING));
  const pts = journey.polyline(count);
  const positions: number[] = [];
  const uvs: number[] = [];
  const arc: number[] = [];
  const indices: number[] = [];
  const halfW = L.RUNE_LINE_WIDTH / 2;
  for (const side of [-1, 1]) {
    const base = positions.length / 3;
    for (let i = 0; i < count; i++) {
      const a = pts[Math.max(i - 1, 0)];
      const b = pts[Math.min(i + 1, count - 1)];
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const s = (i / (count - 1)) * journey.length;
      const floorY = pts[i].y - plan.eye + L.RUNE_LIFT;
      const cx = pts[i].x + -tz * side * L.RUNE_LINE_OFFSET;
      const cz = pts[i].z + tx * side * L.RUNE_LINE_OFFSET;
      for (const v of [-1, 1]) {
        positions.push(cx + -tz * v * halfW, floorY, cz + tx * v * halfW);
        uvs.push(s / L.RUNE_TILE_LENGTH, v < 0 ? 0 : 1);
        arc.push(s);
      }
      if (i > 0) {
        const k = base + (i - 1) * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aS', new THREE.Float32BufferAttribute(arc, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();

  const tex = glyphTexture();
  const uniforms = {
    uCamS: { value: 0 },
    uNear: { value: L.RUNE_AHEAD_NEAR },
    uFar: { value: L.RUNE_AHEAD_FAR },
    uBehind: { value: L.RUNE_BEHIND },
  };
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  mat.customProgramCacheKey = () => 'floor-runes';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aS;\nvarying float vS;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvS = aS;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vS;\nuniform float uCamS; uniform float uNear; uniform float uFar; uniform float uBehind;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float ahead = vS - uCamS;
        diffuseColor.a *= (1.0 - smoothstep(uNear, uFar, ahead)) * smoothstep(-uBehind, 0.0, ahead);`,
      );
    fadeToBlackInFog(shader);
  };
  fx.glow(mat, L.RUNE_COLOR, L.RUNE_HDR_SCALE);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'floor-runes';
  mesh.frustumCulled = false;

  return {
    mesh,
    update(progress, seconds) {
      uniforms.uCamS.value = journey.sAt(progress);
      tex.offset.x = -(seconds * L.RUNE_SCROLL) % 1;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
