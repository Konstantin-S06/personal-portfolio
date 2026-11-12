import * as THREE from 'three';
import * as L from './look';

/**
 * World-space sky: a camera-centred dome (gradient and moon in an equirectangular texture; stars are separate crisp points) plus a
 * camera-centred silhouette ring (distant hills and tree line). Both follow the camera's position every frame
 * but never rotate, so the moon, stars and ridges stay fixed in the world as the camera turns.
 * Three draw calls. Materials are tone-mapped like the fogged forest so the horizon matches WORLD_FOG_COLOR.
 */

const FOG = '#' + L.WORLD_FOG_COLOR.toString(16).padStart(6, '0');
const TAU = Math.PI * 2;

function prng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Canvas pixel for a world direction, matching THREE.SphereGeometry's UV layout (u = atan2(z,-x), v from the pole). */
function dirToPx(x: number, y: number, z: number, W: number, H: number): [number, number] {
  let phi = Math.atan2(z, -x);
  if (phi < 0) phi += TAU;
  return [(phi / TAU) * W, (Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI) * H];
}

function makeDomeTexture(): THREE.CanvasTexture {
  const W = L.SKY_TEX_W;
  const H = W / 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  // top of canvas = zenith, middle = horizon, bottom half = fog colour
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0b1030');
  grad.addColorStop(0.26, '#151a48');
  grad.addColorStop(0.46, FOG);
  grad.addColorStop(1, FOG);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // moon with a soft glow, drawn round by widening x by 1/cos(elevation)
  const el = THREE.MathUtils.degToRad(L.SKY_MOON_ELEV_DEG);
  const az = THREE.MathUtils.degToRad(L.SKY_MOON_AZIMUTH_DEG);
  const [mx, my] = dirToPx(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az), W, H);
  const pxPerDeg = H / 180;
  const R = L.SKY_MOON_RADIUS_DEG * pxPerDeg;
  const GR = R * 6;
  g.save();
  g.translate(mx, my);
  g.scale(1 / Math.cos(el), 1);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, GR);
  glow.addColorStop(0, 'rgba(190,200,255,0.45)');
  glow.addColorStop(0.25, 'rgba(150,160,240,0.18)');
  glow.addColorStop(1, 'rgba(120,130,220,0)');
  g.fillStyle = glow;
  g.fillRect(-GR, -GR, GR * 2, GR * 2);
  g.fillStyle = '#eef1ff';
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.fill();
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  return tex;
}

function makeRingTexture(circumference: number, height: number): THREE.CanvasTexture {
  const W = L.SKY_TEX_W;
  const H = L.SKY_RING_TEX_H;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // world units -> pixels (the texture is stretched over the ring, so x and y scales differ)
  const sx = W / circumference;
  const sy = H / height;
  const base = H - L.SKY_RING_SINK * sy; // canvas y of world height 0
  const Y = (h: number) => base - h * sy;
  const rnd = prng(777);

  // ridges: periodic in the angle so the seam at u = 0 is invisible
  const hill = (baseH: number, amp: number, k1: number, k2: number, p1: number, p2: number, top: string) => {
    const gr = g.createLinearGradient(0, Y(baseH + amp), 0, Y(baseH - 1));
    gr.addColorStop(0, top);
    gr.addColorStop(1, FOG);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const a = (x / W) * TAU;
      const n = (Math.sin(k1 * a + p1) * 0.6 + Math.sin(k2 * a + p2) * 0.4 + 1) / 2;
      g.lineTo(x, Y(baseH + amp * n));
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  };
  hill(4.0, 11, 5, 13, 0.4, 2.2, '#3b3b7c');
  hill(3.0, 9, 6, 17, 5.1, 3.3, '#313170');
  hill(2.0, 8, 8, 21, 1.3, 4.1, '#2a2960');
  hill(1.0, 5, 11, 29, 2.7, 0.6, '#212056');
  // everything below the ridges is solid fog colour so the ring never shows a gap above the dome's horizon
  g.fillStyle = FOG;
  g.fillRect(0, Y(0.5), W, H - Y(0.5));

  // distant tree line along the nearest ridge (triangles, drawn twice near the edges to wrap)
  g.globalAlpha = 0.75;
  g.fillStyle = '#18174a';
  const tri = (cx: number, tw: number, th: number, by: number) => {
    g.beginPath();
    g.moveTo(cx - tw, by);
    g.lineTo(cx, by - th);
    g.lineTo(cx + tw, by);
    g.closePath();
    g.fill();
  };
  for (let tx = 0; tx < W; tx += (4 + rnd() * 6)) {
    const th = (2.2 + rnd() * 4.5) * sy;
    const tw = (0.8 + rnd() * 1.0) * sx;
    const by = Y(1.2);
    tri(tx, tw, th, by);
    if (tx < tw * 2) tri(tx + W, tw, th, by);
    if (tx > W - tw * 2) tri(tx - W, tw, th, by);
  }
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

const starVert = /* glsl */ `
  uniform float uPx;
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_PointSize = aSize * uPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const starFrag = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.45, 1.0, d)) * vAlpha;
    gl_FragColor = vec4(vec3(0.91, 0.925, 1.0), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Stars as crisp round points on the dome radius (one draw call, no texture). */
function makeStars() {
  const n = L.SKY_STAR_COUNT;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const alpha = new Float32Array(n);
  const rnd = prng(12345);
  const R = L.SKY_DOME_RADIUS * 0.95;
  for (let i = 0; i < n; i++) {
    const y = 0.08 + rnd() * 0.92; // sin(elevation): just above the horizon up to the zenith
    const a = rnd() * TAU;
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * R;
    pos[i * 3 + 1] = y * R;
    pos[i * 3 + 2] = Math.sin(a) * r * R;
    alpha[i] = (0.35 + rnd() * 0.65) * Math.min(1, y * 3.5); // fade toward the horizon
    size[i] = L.SKY_STAR_SIZE_PX[0] + rnd() * rnd() * (L.SKY_STAR_SIZE_PX[1] - L.SKY_STAR_SIZE_PX[0]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const uniforms = { uPx: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: starVert,
    fragmentShader: starFrag,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: L.SKY_TONE_MAPPED,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = -9; // after the dome, before the hill ring so ridges cover them
  points.frustumCulled = false;
  return { points, geo, mat, uniforms };
}

export interface Sky {
  group: THREE.Group;
  /** Re-centre on the camera. Call every frame after the camera has moved. */
  update(camera: THREE.Camera, pixelRatio?: number): void;
  dispose(): void;
}

export function createSky(): Sky {
  const group = new THREE.Group();
  group.name = 'sky';

  const domeTex = makeDomeTexture();
  const domeGeo = new THREE.SphereGeometry(L.SKY_DOME_RADIUS, 48, 24);
  const domeMat = new THREE.MeshBasicMaterial({
    map: domeTex,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    depthTest: false,
    toneMapped: L.SKY_TONE_MAPPED,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = -10; // first in the opaque pass
  dome.frustumCulled = false;
  group.add(dome);

  const stars = makeStars();
  group.add(stars.points);

  const ringH = L.SKY_RING_HEIGHT;
  const ringR = L.SKY_RING_RADIUS;
  const ringTex = makeRingTexture(TAU * ringR, ringH);
  const ringGeo = new THREE.CylinderGeometry(ringR, ringR, ringH, 96, 1, true);
  ringGeo.translate(0, ringH / 2 - L.SKY_RING_SINK, 0);
  const ringMat = new THREE.MeshBasicMaterial({
    map: ringTex,
    side: THREE.BackSide,
    transparent: true,
    fog: false,
    depthWrite: false,
    toneMapped: L.SKY_TONE_MAPPED,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.renderOrder = -5;
  ring.frustumCulled = false;
  group.add(ring);

  return {
    group,
    update(camera, pixelRatio = 1) {
      dome.position.copy(camera.position);
      stars.points.position.copy(camera.position);
      stars.uniforms.uPx.value = pixelRatio;
      ring.position.set(camera.position.x, 0, camera.position.z);
    },
    dispose() {
      domeGeo.dispose();
      domeMat.dispose();
      domeTex.dispose();
      stars.geo.dispose();
      stars.mat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      ringTex.dispose();
    },
  };
}