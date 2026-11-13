import * as THREE from 'three';

/**
 * Procedural campfire: layered camera-facing flame sheets (noise shader), rising embers, ground glow,
 * stone ring and coals. No textures, no extra lights (world.ts keeps its one point light and drives
 * `flicker`). Everything here is a tunable at the top of the file.
 */

/** Camera gaze toward the fire near the end of the path (used by world.ts). */
export const FIRE_GAZE = {
  /** Progress where the camera starts turning toward the fire (the "more projects" chapter sits after this). */
  start: 0.78,
  /** Progress where the sideways shift starts (fire slides left of centre for Contact). */
  sideStart: 0.93,
  /** The fire's base sits this many degrees BELOW screen centre (half the vertical FOV is 25). Bigger = lower. */
  baseDeg: 14,
  /** Final sideways shift in degrees; positive puts the fire left of centre. */
  sideDeg: 10,
};

const FLAME_LAYERS = [
  // width, height, brightness, seed, x offset, z offset
  { w: 1.5, h: 2.1, gain: 1.0, seed: 0.1, dx: 0.0, dz: 0.0 },
  { w: 1.2, h: 1.7, gain: 1.3, seed: 0.5, dx: 0.1, dz: -0.05 },
  { w: 0.9, h: 1.35, gain: 1.7, seed: 0.9, dx: -0.12, dz: 0.08 },
  { w: 0.55, h: 0.95, gain: 2.2, seed: 0.3, dx: 0.0, dz: 0.0 },
];
const EMBER_COUNT = 70;
const STONE_COUNT = 10;
const STONE_RING_RADIUS = 1.15;
const GLOW_RADIUS = 4.5;

export interface CampfireFx {
  group: THREE.Group;
  /** ~0.55-1.15, set by world.ts every frame from its flicker value (1 when motion is reduced). */
  flicker: number;
  update(clock: number, pxPerUnit: number): void;
  dispose(): void;
}

const flameVert = /* glsl */ `
  uniform vec2 uSize;
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec2 d = cameraPosition.xz - center.xz;
    d /= max(length(d), 0.0001);
    vec3 right = vec3(d.y, 0.0, -d.x);
    float h = position.y;
    float sway = sin(uTime * 2.1 + uSeed * 6.0) * 0.07 + sin(uTime * 3.7 + uSeed * 11.0) * 0.04;
    vec3 world = center + right * (position.x * uSize.x + sway * h * h * uSize.x) + vec3(0.0, h * uSize.y, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const flameFrag = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uGain;
  uniform float uFlicker;
  varying vec2 vUv;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash(i); float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)); float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  void main() {
    float y = vUv.y;
    float x = vUv.x * 2.0 - 1.0;
    vec2 q = vec2(x * 1.4 + uSeed * 10.0, y * 2.2 - uTime * 1.5);
    float n = fbm(q);
    float n2 = fbm(q * 1.9 + vec2(4.0, -uTime * 0.9));
    float bend = (n - 0.5) * 0.9 * y;
    float width = max(pow(max(1.0 - y, 0.0), 0.75) * 0.8, 0.03);
    float dist = abs(x + bend);
    float body = 1.0 - smoothstep(width * 0.25, width, dist);
    float tip = 1.0 - smoothstep(0.55, 1.0, y + (n2 - 0.5) * 0.5);
    float flame = clamp(body * tip * (0.55 + 0.7 * n), 0.0, 1.0);
    float hot = smoothstep(0.0, 0.5, y);
    vec3 col = mix(vec3(1.0, 0.92, 0.55), vec3(1.0, 0.42, 0.06), hot);
    col = mix(col, vec3(0.65, 0.08, 0.02), smoothstep(0.5, 1.0, y));
    gl_FragColor = vec4(col * uGain * (0.8 + 0.4 * uFlicker), flame);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const emberVert = /* glsl */ `
  uniform float uTime;
  uniform float uPx;
  attribute vec3 aRand;
  varying float vLife;
  varying float vTw;
  void main() {
    float speed = 0.12 + aRand.x * 0.18;
    float t = fract(uTime * speed + aRand.y);
    float ang = aRand.z * 6.2831;
    float r = 0.25 + aRand.x * 0.5;
    vec3 p = vec3(
      cos(ang) * r * (0.4 + t) + sin(uTime * 1.7 + aRand.y * 40.0) * 0.3 * t,
      0.4 + t * 3.6,
      sin(ang) * r * (0.4 + t) + cos(uTime * 1.3 + aRand.x * 40.0) * 0.3 * t
    );
    vLife = 1.0 - t;
    vTw = 0.6 + 0.4 * sin(uTime * 14.0 + aRand.z * 50.0);
    vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(uPx * 0.045 * (0.5 + aRand.x) * vLife / max(-mv.z, 0.1), 2.0);
  }
`;

const emberFrag = /* glsl */ `
  varying float vLife;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = (1.0 - smoothstep(0.0, 0.5, d)) * vLife * vTw;
    gl_FragColor = vec4(vec3(1.0, 0.6, 0.2) * 2.5, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const glowVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const glowFrag = /* glsl */ `
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float r = clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0);
    float a = pow(1.0 - r, 2.2) * 0.55 * uIntensity;
    gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * 1.2, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createCampfireFx(at: THREE.Vector3): CampfireFx {
  const group = new THREE.Group();
  group.name = 'campfire-fx';
  group.position.set(at.x, 0, at.z);

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const shared = { uTime: { value: 0 }, uFlicker: { value: 1 } };

  // Flame sheets: a 1x1 plane whose base sits at y=0; the vertex shader turns it to face the camera around Y.
  const planeGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  geos.push(planeGeo);
  for (const l of FLAME_LAYERS) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uFlicker: shared.uFlicker,
        uSeed: { value: l.seed },
        uGain: { value: l.gain },
        uSize: { value: new THREE.Vector2(l.w, l.h) },
      },
      vertexShader: flameVert,
      fragmentShader: flameFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    mats.push(mat);
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.position.set(l.dx, 0.14, l.dz);
    mesh.frustumCulled = false; // the shader moves the vertices, so the bounding box is wrong
    mesh.renderOrder = 3;
    group.add(mesh);
  }

  // Embers
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBER_COUNT * 3), 3));
  const rr = new Float32Array(EMBER_COUNT * 3);
  let s = 91;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
  for (let i = 0; i < rr.length; i++) rr[i] = rnd();
  emberGeo.setAttribute('aRand', new THREE.BufferAttribute(rr, 3));
  geos.push(emberGeo);
  const emberU = { uTime: shared.uTime, uPx: { value: 600 } };
  const emberMat = new THREE.ShaderMaterial({
    uniforms: emberU,
    vertexShader: emberVert,
    fragmentShader: emberFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  mats.push(emberMat);
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.frustumCulled = false;
  embers.renderOrder = 4;
  group.add(embers);

  // Ground glow
  const glowGeo = new THREE.CircleGeometry(GLOW_RADIUS, 40).rotateX(-Math.PI / 2);
  geos.push(glowGeo);
  const glowU = { uIntensity: { value: 1 } };
  const glowMat = new THREE.ShaderMaterial({
    uniforms: glowU,
    vertexShader: glowVert,
    fragmentShader: glowFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  mats.push(glowMat);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.y = 0.04;
  glow.renderOrder = 1;
  group.add(glow);

  // Stone ring + coals
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  geos.push(rockGeo);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x4a4d66, flatShading: true });
  mats.push(rockMat);
  const stones = new THREE.InstancedMesh(rockGeo, rockMat, STONE_COUNT);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eu = new THREE.Euler();
  for (let i = 0; i < STONE_COUNT; i++) {
    const a = (i / STONE_COUNT) * Math.PI * 2 + rnd() * 0.25;
    const r = STONE_RING_RADIUS + (rnd() - 0.5) * 0.2;
    const sx = 0.28 + rnd() * 0.12;
    eu.set(rnd() * 0.5, rnd() * Math.PI, rnd() * 0.5);
    q.setFromEuler(eu);
    m4.compose(
      new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r),
      q,
      new THREE.Vector3(sx, 0.2 + rnd() * 0.1, sx * (0.85 + rnd() * 0.3)),
    );
    stones.setMatrixAt(i, m4);
  }
  stones.instanceMatrix.needsUpdate = true;
  group.add(stones);

  const coalGeo = new THREE.IcosahedronGeometry(1, 0);
  geos.push(coalGeo);
  const coalBase = new THREE.Color(0xff5a1a).multiplyScalar(1.4);
  const coalMat = new THREE.MeshBasicMaterial({ color: coalBase.clone() });
  mats.push(coalMat);
  const coals = new THREE.InstancedMesh(coalGeo, coalMat, 7);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.5;
    const sc = 0.12 + rnd() * 0.08;
    m4.compose(
      new THREE.Vector3(Math.cos(a) * r, 0.06, Math.sin(a) * r),
      q.identity(),
      new THREE.Vector3(sc, sc * 0.6, sc),
    );
    coals.setMatrixAt(i, m4);
  }
  coals.instanceMatrix.needsUpdate = true;
  group.add(coals);

  const fx: CampfireFx = {
    group,
    flicker: 1,
    update(clock, pxPerUnit) {
      shared.uTime.value = clock;
      shared.uFlicker.value = fx.flicker;
      emberU.uPx.value = pxPerUnit;
      glowU.uIntensity.value = 0.75 + 0.3 * fx.flicker;
      coalMat.color.copy(coalBase).multiplyScalar(0.8 + 0.5 * fx.flicker);
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      stones.dispose();
      coals.dispose();
    },
  };
  return fx;
}
