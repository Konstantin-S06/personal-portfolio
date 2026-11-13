// Atmosphere: dust motes (one Points), light shafts under chamber torches (one instanced mesh of additive
// gradient cones) and low ground mist (one instanced mesh of large soft planes). Three draw calls in total.
import * as THREE from 'three';
import * as L from './look';
import type { Plan } from './plan';
import type { Zones, ZoneSample } from './zones';
import type { TorchSpot } from './kit';
import { mulberry32, shuffle } from './scatter';
import { fadeToBlackInFog } from './fx';

export interface Atmosphere {
  group: THREE.Group;
  /** Called every draw. `seconds` is a clock that only advances while motion is allowed. */
  update(camera: THREE.PerspectiveCamera, zone: ZoneSample, seconds: number, dt: number, pixelHeight: number): void;
  dispose(): void;
}

const softDisc = (): THREE.CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.45, '#888');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
};

/** Seamlessly tiling cloud: soft blobs, each drawn at 9 offsets so it wraps. */
const cloudTexture = (rand: () => number): THREE.CanvasTexture => {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 26; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 28 + rand() * 46;
    const a = 0.22 + rand() * 0.3;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cx = x + ox * size;
        const cy = y + oy * size;
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

export function buildAtmosphere(plan: Plan, zones: Zones, torches: TorchSpot[]): Atmosphere {
  const rand = mulberry32(L.SEED + 1);
  const group = new THREE.Group();
  group.name = 'atmosphere';
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o);
    return o;
  };

  // ---- dust motes ----------------------------------------------------------------------------------------
  const seeds = new Float32Array(L.DUST_COUNT * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  const dustGeo = own(new THREE.BufferGeometry());
  dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(L.DUST_COUNT * 3), 3)); // unused, sets the count
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const dustUniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(...L.DUST_BOX) },
    uSize: { value: L.DUST_SIZE },
    uPx: { value: 600 },
    uDrift: { value: L.DUST_DRIFT },
    uOpacity: { value: L.DUST_OPACITY },
    uColor: { value: new THREE.Color(0xffffff) },
  };
  const dustMat = own(
    new THREE.ShaderMaterial({
      uniforms: dustUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform float uSize; uniform float uPx; uniform float uDrift;
        attribute vec4 aSeed;
        varying float vA;
        void main() {
          vec3 p = aSeed.xyz * uBox;
          p.x += sin(uTime * 0.31 + aSeed.w * 6.283) * 0.6;
          p.z += cos(uTime * 0.23 + aSeed.w * 9.1) * 0.6;
          p.y += uTime * uDrift * (0.4 + 0.6 * aSeed.w);
          vec3 rel = mod(p - uCam, uBox) - uBox * 0.5;
          vec3 e = abs(rel) / (uBox * 0.5);
          vA = (1.0 - smoothstep(0.65, 1.0, max(e.x, max(e.y, e.z)))) * (0.55 + 0.45 * sin(uTime * 1.3 + aSeed.w * 40.0));
          vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * uPx / max(-mv.z, 0.1), 1.0, 14.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity;
        varying float vA;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(uColor, a * a * vA * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.name = 'dust';
  dust.frustumCulled = false;
  group.add(dust);

  // ---- light shafts: additive gradient cones under chamber torches --------------------------------------------
  const chamberTorches = torches.filter((t) => zones.indexAt(t.light.z) === 1);
  const shaftTorches = shuffle([...chamberTorches], rand).slice(0, L.SHAFT_COUNT);
  let shafts: THREE.InstancedMesh | null = null;
  if (shaftTorches.length) {
    // apex at y = 0, base at y = -1; colour fades from 1 at the apex to 0 at the base (additive: black is invisible)
    const geo = own(new THREE.ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0));
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) colors.fill(pos.getY(i) > -0.01 ? 1 : 0, i * 3, i * 3 + 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = own(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(L.SHAFT_COLOR).multiplyScalar(L.SHAFT_STRENGTH),
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    // Soft silhouette: fade by how squarely the cone surface faces the camera.
    mat.customProgramCacheKey = () => 'light-shafts';
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vFres;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvFres = clamp(abs(dot(normalize(normalMatrix * normal), normalize(-mvPosition.xyz))), 0.0, 1.0);');
      // (vFres * vFres rather than pow(): pow(0.0, y) is undefined in GLSL and produced NaNs on some drivers)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFres;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFres * vFres;');
      fadeToBlackInFog(shader);
    };
    shafts = new THREE.InstancedMesh(geo, mat, shaftTorches.length);
    shafts.name = 'light-shafts';
    const m = new THREE.Matrix4();
    shaftTorches.forEach((t, i) => {
      const apexY = t.light.y - 0.2;
      m.compose(new THREE.Vector3(t.light.x, apexY, t.light.z), new THREE.Quaternion(), new THREE.Vector3(L.SHAFT_RADIUS, apexY, L.SHAFT_RADIUS));
      shafts!.setMatrixAt(i, m);
    });
    shafts.instanceMatrix.needsUpdate = true;
    shafts.computeBoundingSphere();
    group.add(shafts);
  }

  // ---- ground mist: big low planes in the chamber and the final hall -----------------------------------------
  const cells: { r: number; c: number; zone: number }[] = [];
  for (let r = 0; r < plan.rows; r++) {
    for (let c = 0; c < plan.cols; c++) {
      if (!plan.walkable[r][c]) continue;
      const zone = zones.indexAt(r * plan.cell);
      if (zone >= 1) cells.push({ r, c, zone });
    }
  }
  let mist: THREE.InstancedMesh | null = null;
  let cloud: THREE.CanvasTexture | null = null;
  const wanted = [0, L.MIST_CHAMBER_COUNT, L.MIST_HALL_COUNT];
  const mistItems: { x: number; y: number; z: number; size: number; color: number }[] = [];
  for (let zone = 1; zone < wanted.length; zone++) {
    const pool = shuffle(cells.filter((cell) => cell.zone === zone), rand);
    for (let i = 0; i < Math.min(wanted[zone], pool.length); i++) {
      const cell = pool[i];
      mistItems.push({
        x: cell.c * plan.cell + (rand() - 0.5) * plan.cell,
        y: plan.height[cell.r][cell.c] + L.MIST_LIFT + i * 0.03,
        z: cell.r * plan.cell + (rand() - 0.5) * plan.cell,
        size: L.MIST_SIZE[0] + rand() * (L.MIST_SIZE[1] - L.MIST_SIZE[0]),
        color: L.MIST_COLORS[Math.min(zone - 1, L.MIST_COLORS.length - 1)],
      });
    }
  }
  if (mistItems.length) {
    cloud = own(cloudTexture(rand));
    const fade = own(softDisc());
    const geo = own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const mat = own(
      new THREE.MeshBasicMaterial({ map: cloud, alphaMap: fade, transparent: true, opacity: L.MIST_OPACITY, depthWrite: false }),
    );
    mist = new THREE.InstancedMesh(geo, mat, mistItems.length);
    mist.name = 'ground-mist';
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    mistItems.forEach((it, i) => {
      m.compose(new THREE.Vector3(it.x, it.y, it.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI), new THREE.Vector3(it.size, 1, it.size));
      mist!.setMatrixAt(i, m);
      mist!.setColorAt(i, c.set(it.color));
    });
    mist.instanceMatrix.needsUpdate = true;
    if (mist.instanceColor) mist.instanceColor.needsUpdate = true;
    mist.computeBoundingSphere();
    group.add(mist);
  }

  return {
    group,
    update(camera, zone, seconds, dt, pixelHeight) {
      dustUniforms.uTime.value = seconds;
      dustUniforms.uCam.value.copy(camera.position);
      dustUniforms.uPx.value = pixelHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
      dustUniforms.uColor.value.copy(zone.dust);
      if (cloud && dt > 0) cloud.offset.x = (cloud.offset.x + L.MIST_SCROLL * dt) % 1;
    },
    dispose() {
      shafts?.dispose();
      mist?.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}
