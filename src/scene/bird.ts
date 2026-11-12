import * as THREE from 'three';
import * as L from './look';
import { mergeGeos } from './boards';
import type { Lectern } from './lectern';

/**
 * Contact bird: flies in, hovers over the lectern, lifts the sheet, rolls it into a scroll and flies off with it.
 * Standalone: not wired into the world yet. Everything is in WORLD space (`group` sits at the origin; add it to the scene).
 * Body (body, head, beak, tail) is ONE merged vertex-coloured mesh, wings are 2 meshes (shared material), plus the
 * sheet and the scroll: 5 draw calls while playing, 0 while idle (group hidden). No lights, no particles.
 *
 * Runs on its own clock: world.ts calls `update(dt)` every frame (dt in seconds). It does not follow scroll progress.
 * Trigger: `play()` after a successful POST. `reset()` brings the paper back (e.g. to send another message).
 */

export interface ContactBird {
  group: THREE.Group;
  /** True from play() until the bird has left. */
  readonly playing: boolean;
  /**
   * Starts the flight. Returns true if a flight started. Returns false if one is already running (nothing happens)
   * or if reduced motion is on (no flight; the paper stays on the desk and onDone fires at once so the caller can
   * show its success state).
   */
  play(): boolean;
  /** Stops any flight, hides the bird and puts the paper back on the desk. */
  reset(): void;
  update(dt: number): void;
  dispose(): void;
}

interface BirdOptions {
  lectern: Pick<Lectern, 'paperPose' | 'setPaperVisible'>;
  reducedMotion(): boolean;
  /** Fires when the bird has left (or immediately under reduced motion). */
  onDone?(): void;
}

type Phase = 'idle' | 'in' | 'grab' | 'roll' | 'out' | 'regen' | 'done';
const REGEN_SECONDS = 0.9; // keep equal to the DOM fade in ContactPaperControls

const sm = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const BEAK_LOCAL = new THREE.Vector3(0, 0.02, 0.36);

export function createContactBird(opts: BirdOptions): ContactBird {
  const pose = opts.lectern.paperPose;
  const n = pose.normal;
  const c = pose.center.clone().addScaledVector(n, 0.012);

  // horizontal frame: f = toward the viewer, rt = the viewer's right
  const f = new THREE.Vector3(n.x, 0, n.z);
  if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
  f.normalize();
  const rt = new THREE.Vector3(f.z, 0, -f.x);
  const pt = (fw: number, side: number, up: number) =>
    new THREE.Vector3().copy(c).addScaledVector(f, fw).addScaledVector(rt, side).add(new THREE.Vector3(0, up, 0));

  const hover = c.clone().addScaledVector(n, L.BIRD_HOVER);
  const grab = c.clone().addScaledVector(n, L.BIRD_GRAB_HEIGHT).addScaledVector(f, -0.1);
  const D = L.BIRD_START_DIST;
  const inCurve = new THREE.CatmullRomCurve3([
    pt(-D, -D * 0.6, L.BIRD_START_HEIGHT),
    pt(-D * 0.45, -D * 0.25, L.BIRD_START_HEIGHT * 0.6),
    pt(-1.8, -0.6, 2.0),
    hover,
  ]);
  const outCurve = new THREE.CatmullRomCurve3([
    hover.clone(),
    pt(-1.2, 0.8, 1.9),
    pt(-6, 3.5, 4.5),
    pt(-D * 1.3, 9, L.BIRD_START_HEIGHT * 2),
  ]);
  const holdDir = f.clone().setY(-0.1).normalize();

  // ---- bird meshes ----
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: number) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    ng.deleteAttribute('uv');
    const col = new THREE.Color(color);
    const cnt = ng.getAttribute('position').count;
    const cols = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) {
      cols[i * 3] = col.r;
      cols[i * 3 + 1] = col.g;
      cols[i * 3 + 2] = col.b;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    parts.push(ng);
  };
  const C = L.BIRD_COLORS;
  add(new THREE.IcosahedronGeometry(1, 0).scale(0.11, 0.1, 0.2), C.body);
  add(new THREE.IcosahedronGeometry(0.075, 0).translate(0, 0.06, 0.2), C.head);
  add(new THREE.ConeGeometry(0.028, 0.1, 4).rotateX(Math.PI / 2).translate(0, 0.055, 0.31), C.beak);
  add(new THREE.BoxGeometry(0.1, 0.012, 0.17).rotateX(-0.2).translate(0, 0.01, -0.27), C.tail);
  const bodyGeo = mergeGeos(parts, ['position', 'normal', 'color']);
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: C.glow });
  const wingGeo = (side: 1 | -1) => {
    const g = new THREE.BoxGeometry(0.42, 0.012, 0.2);
    g.translate(side * 0.21, 0, 0);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * (1 - 0.5 * (Math.abs(p.getX(i)) / 0.42)));
    g.computeVertexNormals();
    return g;
  };
  const wingGeoR = wingGeo(1);
  const wingGeoL = wingGeo(-1);
  const wingMat = new THREE.MeshLambertMaterial({ color: C.wing, flatShading: true, side: THREE.DoubleSide, emissive: C.glow });

  const bird = new THREE.Group();
  bird.scale.setScalar(L.BIRD_SCALE);
  bird.add(new THREE.Mesh(bodyGeo, bodyMat));
  const wingR = new THREE.Mesh(wingGeoR, wingMat);
  const wingL = new THREE.Mesh(wingGeoL, wingMat);
  wingR.position.set(0.09, 0.04, 0.02);
  wingL.position.set(-0.09, 0.04, 0.02);
  bird.add(wingR, wingL);

  // ---- paper (replaces the painted sheet while it is lifted) and scroll ----
  const parchment = L.PROP_COLORS.parchment[0];
  const paperGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const scrollGeo = new THREE.CylinderGeometry(L.BIRD_SCROLL_RADIUS, L.BIRD_SCROLL_RADIUS, L.BIRD_SCROLL_LEN, 10, 1).rotateX(Math.PI / 2);
  const paperMat = new THREE.MeshLambertMaterial({
    color: parchment,
    emissive: parchment,
    emissiveIntensity: L.CONTACT_EMISSIVE,
    side: THREE.DoubleSide,
  });
  const paper = new THREE.Mesh(paperGeo, paperMat);
  const scroll = new THREE.Mesh(scrollGeo, paperMat);
  paper.visible = false;
  scroll.visible = false;
  // Plain sheet laid over the restored painted paper, fading out so the painting "inks in".
  const fadeMat = paperMat.clone();
  fadeMat.transparent = true;
  fadeMat.depthWrite = false;
  const regen = new THREE.Mesh(paperGeo, fadeMat);
  regen.scale.set(pose.width, 1, pose.height);
  regen.position.copy(c);
  regen.visible = false;

  const group = new THREE.Group();
  group.name = 'contact-bird';
  group.visible = false;
  group.add(bird, paper, scroll, regen);

  const paperQuat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(pose.right, n, new THREE.Vector3().crossVectors(pose.right, n)),
  );
  const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  regen.quaternion.copy(paperQuat);

  // ---- state ----
  let phase: Phase = 'idle';
  let t = 0;
  let flap = 0;
  let regenT = 0;
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  const beak = new THREE.Vector3();
  const q = new THREE.Quaternion();

  const place = (dt: number) => {
    dir.lerp(tgt, 1 - Math.exp(-8 * dt)).normalize();
    bird.position.copy(pos);
    bird.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
    bird.updateMatrixWorld(true);
  };
  const follow = (curve: THREE.Curve<THREE.Vector3>, e: number) => {
    curve.getPointAt(e, pos);
    curve.getTangentAt(e, tgt);
    tgt.y *= 0.6;
  };
  const carry = (e: number) => {
    beak.copy(BEAK_LOCAL);
    bird.localToWorld(beak);
    q.copy(bird.quaternion).multiply(qY);
    scroll.position.lerpVectors(c, beak, e);
    scroll.quaternion.copy(paperQuat).slerp(q, e);
    paper.position.copy(scroll.position);
    paper.quaternion.copy(paperQuat);
  };
  const finish = () => {
    phase = 'regen';
    regenT = 0;
    fadeMat.opacity = 1;
    bird.visible = false;
    paper.visible = false;
    scroll.visible = false;
    regen.visible = true; // group stays visible while the sheet fades
    opts.lectern.setPaperVisible(true);
    opts.onDone?.();
  };    

  return {
    group,
    get playing() {
      return phase === 'in' || phase === 'grab' || phase === 'roll' || phase === 'out';
    },
    play() {
      if (phase === 'in' || phase === 'grab' || phase === 'roll' || phase === 'out') return false;
      if (opts.reducedMotion()) {
        opts.onDone?.();
        return false;
      }
      phase = 'in';
      t = 0;
      flap = 0;
      group.visible = true;
      bird.visible = true;
      regen.visible = false;
      paper.visible = false;
      scroll.visible = false;
      follow(inCurve, 0);
      dir.copy(tgt).normalize();
      place(0);
      return true;
    },
    reset() {
        phase = 'idle';
        t = 0;
        regen.visible = false;
        group.visible = false;
      paper.visible = false;
      scroll.visible = false;
      opts.lectern.setPaperVisible(true);
    },
    update(dt) {
        if (phase === 'regen') {
            regenT += Math.min(dt, 0.1);
            const u = clamp01(regenT / REGEN_SECONDS);
            fadeMat.opacity = 1 - sm(u);
            if (u >= 1) {
              phase = 'done';
              regen.visible = false;
              group.visible = false;
            }
            return;
          }
          if (phase === 'idle' || phase === 'done') return;
      dt = Math.min(dt, 0.1);
      t += dt;
      const hovering = phase === 'grab' || phase === 'roll';
      flap += dt * L.BIRD_FLAP_HZ * (hovering ? 1.4 : 1) * Math.PI * 2;
      const ang = Math.sin(flap) * L.BIRD_FLAP_AMP * (hovering ? 1.2 : 1) + 0.15;
      wingR.rotation.z = ang;
      wingL.rotation.z = -ang;

      if (phase === 'in') {
        const u = clamp01(t / L.BIRD_IN_SECONDS);
        follow(inCurve, 1 - (1 - u) * (1 - u)); // eases out: slows into the hover
        place(dt);
        if (u >= 1) {
          phase = 'grab';
          t = 0;
        }
      } else if (phase === 'grab') {
        const u = clamp01(t / L.BIRD_GRAB_SECONDS);
        pos.lerpVectors(hover, grab, sm(u));
        tgt.copy(holdDir);
        place(dt);
        if (u >= 1) {
          opts.lectern.setPaperVisible(false);
          paper.visible = true;
          paper.scale.set(pose.width, 1, pose.height);
          paper.position.copy(c);
          paper.quaternion.copy(paperQuat);
          phase = 'roll';
          t = 0;
        }
      } else if (phase === 'roll') {
        const u = clamp01(t / L.BIRD_ROLL_SECONDS);
        const e = sm(u);
        pos.lerpVectors(grab, hover, e);
        tgt.copy(holdDir);
        place(dt);
        const k = sm(clamp01(u / 0.6));
        paper.scale.set(pose.width * (1 - k * 0.95), 1, pose.height + (L.BIRD_SCROLL_LEN - pose.height) * k);
        if (u >= 0.6) {
          paper.visible = false;
          scroll.visible = true;
        }
        carry(e);
        if (u >= 1) {
          phase = 'out';
          t = 0;
        }
      } else {
        const u = clamp01(t / L.BIRD_OUT_SECONDS);
        follow(outCurve, u * u); // eases in: picks up speed
        place(dt);
        carry(1);
        if (u >= 1) finish();
      }
    },
    dispose() {
      bodyGeo.dispose();
      wingGeoR.dispose();
      wingGeoL.dispose();
      paperGeo.dispose();
      scrollGeo.dispose();
      bodyMat.dispose();
      wingMat.dispose();
      paperMat.dispose();
      fadeMat.dispose();
    },
  };
}