// Shared effect state: the one flame flicker uniform, the flame material, and a registry of emissive materials
// whose brightness depends on whether the HDR post stack is running.
import * as THREE from 'three';
import * as L from './look';

export interface Fx {
  /** The single shared flicker uniform (1 +- FLICKER_AMPLITUDE). */
  flicker: { value: number };
  flameMaterial: THREE.MeshBasicMaterial;
  /** Register an emissive material: its colour becomes `base * (hdr ? hdrScale : GLOW_LDR_SCALE)`. */
  glow(mat: THREE.MeshBasicMaterial, base: THREE.ColorRepresentation, hdrScale: number): void;
  setHdr(on: boolean): void;
  setTorchColor(c: THREE.Color): void;
  /** Advance the flicker. With `animate` false the flames hold still. */
  update(seconds: number, animate: boolean): void;
  dispose(): void;
}

interface GlowEntry {
  mat: THREE.MeshBasicMaterial;
  base: THREE.Color;
  hdr: number;
}

/**
 * Additive materials must fade to black with distance. The stock fog mixes towards the fog colour, which for an
 * additive surface would ADD fog-coloured light to the far, faint things (a visible silhouette instead of a fade).
 * Call from an onBeforeCompile hook; the scene uses linear fog.
 */
export function fadeToBlackInFog(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <fog_fragment>',
    `#ifdef USE_FOG
      gl_FragColor.rgb *= 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
    #endif`,
  );
}

export function createFx(): Fx {
  const flicker = { value: 1 };
  const entries: GlowEntry[] = [];
  let hdr = false;

  const apply = (e: GlowEntry) => {
    e.mat.color.copy(e.base).multiplyScalar(hdr ? e.hdr : L.GLOW_LDR_SCALE);
  };

  const flameMaterial = new THREE.MeshBasicMaterial({ color: L.FLAME_COLOR });
  flameMaterial.customProgramCacheKey = () => 'flame-flicker';
  flameMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uFlicker = flicker;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFlicker;\nvarying float vK;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        float k = (uFlicker - 1.0) * mix(-1.0, 1.0, step(0.5, ph)) * (0.6 + 0.8 * fract(ph * 13.7));
        vK = k;
        transformed.y *= 1.0 + k * ${L.FLAME_STRETCH.toFixed(3)};
        transformed.xz *= 1.0 - k * ${(L.FLAME_STRETCH * 0.4).toFixed(3)};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vK;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n        diffuseColor.rgb *= 1.0 + vK * ${L.FLAME_BRIGHTNESS_SWING.toFixed(3)};`);
  };
  const flameEntry: GlowEntry = { mat: flameMaterial, base: new THREE.Color(L.FLAME_COLOR), hdr: L.FLAME_HDR_SCALE };
  entries.push(flameEntry);
  apply(flameEntry);

  return {
    flicker,
    flameMaterial,
    glow(mat, base, hdrScale) {
      const e = { mat, base: new THREE.Color(base), hdr: hdrScale };
      entries.push(e);
      apply(e);
    },
    setHdr(on) {
      if (on === hdr) return;
      hdr = on;
      entries.forEach(apply);
    },
    setTorchColor(c) {
      flameEntry.base.copy(c);
      apply(flameEntry);
    },
    update(t, animate) {
      flicker.value = animate
        ? 1 + L.FLICKER_AMPLITUDE * (0.55 * Math.sin(t * 7.3) + 0.3 * Math.sin(t * 13.1 + 1.7) + 0.15 * Math.sin(t * 23 + 0.4))
        : 1;
    },
    dispose() {
      flameMaterial.dispose();
    },
  };
}
