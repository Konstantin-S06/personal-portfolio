import * as THREE from 'three';

/**
 * Teal brazier flames: soft camera-facing sheets with a noise-driven shape (a wide base, a flicker, a
 * fading tip), the same technique as the campfire in fire.ts. Every sheet of every brazier lives in ONE
 * geometry, so all braziers cost a single draw call. No textures, no lights.
 */

/** Per brazier: three overlapping sheets. w/h in world units, gain = brightness. */
export const TEAL_FLAME_SHEETS = [
  { w: 0.62, h: 0.95, gain: 0.85, dx: 0.0, dz: 0.0, seed: 0.13 },
  { w: 0.46, h: 0.78, gain: 1.0, dx: -0.05, dz: 0.04, seed: 0.57 },
  { w: 0.3, h: 0.52, gain: 1.15, dx: 0.04, dz: -0.03, seed: 0.91 },
];

const vert = /* glsl */ `
  uniform float uTime;
  attribute vec3 aCenter;
  attribute vec4 aShape; // width, height, gain, seed
  varying vec2 vUv;
  varying float vSeed;
  varying float vGain;
  void main() {
    vUv = uv;
    vSeed = aShape.w;
    vGain = aShape.z;
    vec3 c = (modelMatrix * vec4(aCenter, 1.0)).xyz;
    vec2 d = cameraPosition.xz - c.xz;
    d /= max(length(d), 0.0001);
    vec3 right = vec3(d.y, 0.0, -d.x);
    float h = position.y;
    float fl = 1.0 + 0.16 * sin(uTime * 9.0 + aShape.w * 40.0) + 0.08 * sin(uTime * 17.0 + aShape.w * 23.0);
    float sway = sin(uTime * 2.3 + aShape.w * 6.0) * 0.08 + sin(uTime * 4.1 + aShape.w * 13.0) * 0.04;
    vec3 world = c + right * (position.x * aShape.x + sway * h * h * aShape.x) + vec3(0.0, h * aShape.y * fl, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  varying vec2 vUv;
  varying float vSeed;
  varying float vGain;
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
    vec2 q = vec2(x * 1.3 + vSeed * 10.0, y * 2.0 - uTime * 1.4);
    float n = fbm(q);
    float n2 = fbm(q * 1.9 + vec2(4.0, -uTime * 0.9));
    float bend = (n - 0.5) * 0.8 * y;
    float width = max(pow(max(1.0 - y, 0.0), 0.6) * 0.95, 0.04);
    float body = 1.0 - smoothstep(width * 0.08, width, abs(x + bend));
    float foot = smoothstep(0.0, 0.07, y);
    float tip = 1.0 - smoothstep(0.4, 1.0, y + (n2 - 0.5) * 0.55);
    float flame = clamp(body * tip * foot * (0.5 + 0.8 * n), 0.0, 1.0);
    vec3 core = vec3(0.72, 1.0, 0.95);
    vec3 mid = vec3(0.14, 0.82, 0.74);
    vec3 edge = vec3(0.03, 0.3, 0.52);
    vec3 col = mix(core, mid, smoothstep(0.0, 0.5, y + (1.0 - body) * 0.35));
    col = mix(col, edge, smoothstep(0.45, 1.0, y));
    gl_FragColor = vec4(col * vGain * (0.9 + uPulse * 0.5), flame);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface TealFlames {
  mesh: THREE.Mesh;
  /** pulse: 0..1, brightens the flames (the throne speaking). */
  update(clock: number, pulse?: number): void;
  dispose(): void;
}

/** bases: where each flame starts (bowl top), in the parent group's local space. */
export function createTealFlames(bases: THREE.Vector3[]): TealFlames {
  const sheets = TEAL_FLAME_SHEETS;
  const quads = bases.length * sheets.length;
  const pos = new Float32Array(quads * 4 * 3);
  const uv = new Float32Array(quads * 4 * 2);
  const center = new Float32Array(quads * 4 * 3);
  const shape = new Float32Array(quads * 4 * 4);
  const index = new Uint16Array(quads * 6);
  const corner = [
    [-0.5, 0, 0, 0],
    [0.5, 0, 1, 0],
    [0.5, 1, 1, 1],
    [-0.5, 1, 0, 1],
  ];
  let qd = 0;
  bases.forEach((b, k) => {
    sheets.forEach((s) => {
      for (let c = 0; c < 4; c++) {
        const vi = qd * 4 + c;
        pos.set([corner[c][0], corner[c][1], 0], vi * 3);
        uv.set([corner[c][2], corner[c][3]], vi * 2);
        center.set([b.x + s.dx, b.y, b.z + s.dz], vi * 3);
        shape.set([s.w, s.h, s.gain, s.seed + k * 0.173], vi * 4);
      }
      index.set([qd * 4, qd * 4 + 1, qd * 4 + 2, qd * 4, qd * 4 + 2, qd * 4 + 3], qd * 6);
      qd++;
    });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
  geo.setAttribute('aShape', new THREE.BufferAttribute(shape, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));

  const uniforms = { uTime: { value: 0 }, uPulse: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // the shader moves the vertices, so the bounding box is wrong
  mesh.renderOrder = 3;
  mesh.name = 'teal-flames';
  return {
    mesh,
    update(clock, pulse = 0) {
      uniforms.uTime.value = clock;
      uniforms.uPulse.value = pulse;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
