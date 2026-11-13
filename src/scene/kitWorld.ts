// The kit-based world. Same `World` contract as the procedural one in world.ts.
// Budgets (R1): <= 120 draw calls (post passes included), <= 4 dynamic lights, no shadow maps.
import * as THREE from 'three';
import type { World } from './world';
import { buildKit, type KitPieces } from './kit';
import { buildTable } from './table';
import { buildJourney } from './journey';
import { tableLayout, type Plan } from './plan';
import { createQuality } from './quality';
import { createFx } from './fx';
import { buildZones, newZoneSample } from './zones';
import { buildSigns } from './signs';
import { buildProps } from './props';
import { buildAtmosphere } from './atmosphere';
import { buildFloorRunes } from './floorRunes';
import type { Post } from './post';
import * as L from './look';

const FOG_NEAR = 3;
const FOG_FAR = 46;
const MAX_TORCH_LIGHTS = 4; // budget: at most 4 dynamic point lights, no shadow maps (the seat spotlight borrows one)

export function createKitWorld(canvas: HTMLCanvasElement, plan: Plan, pieces: KitPieces): World {
  // Anything created below is pushed here so a failure part-way through can clean up before the fallback runs.
  const cleanup: (() => void)[] = [() => pieces.dispose()];
  const disposeAll = () => {
    while (cleanup.length) cleanup.pop()!();
  };

  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    cleanup.push(() => renderer.dispose());
    let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; // used when drawing straight to the screen (post off)
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = false; // no shadow maps at all
    renderer.info.autoReset = false; // the post stack renders several times per frame; draw() resets once per frame

    const zones = buildZones(plan);
    const zs = newZoneSample();
    zones.sample(0, zs);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(zs.fog);
    scene.fog = new THREE.Fog(zs.fog, FOG_NEAR, FOG_FAR);

    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);

    const journey = buildJourney(plan);
    const tbl = tableLayout(plan);

    const fx = createFx();
    cleanup.push(() => fx.dispose());
    const kit = buildKit(plan, pieces, { flameMaterial: fx.flameMaterial, zones });
    cleanup.push(() => kit.dispose());
    const table = buildTable(tbl);
    cleanup.push(() => table.dispose());
    const signs = buildSigns(plan, tbl, journey, fx);
    cleanup.push(() => signs.dispose());
    const props = buildProps(plan, tbl, journey, zones, fx, signs.reservedEdges, signs.sightLines);
    cleanup.push(() => props.dispose());
    const atmosphere = buildAtmosphere(plan, zones, kit.torches);
    cleanup.push(() => atmosphere.dispose());
    const runes = buildFloorRunes(plan, journey, fx);
    cleanup.push(() => runes.dispose());
    scene.add(kit.group, table.group, signs.group, props.group, atmosphere.group, runes.mesh);

    // Lights: hemisphere plus a fixed pool of point lights (positions reassigned per frame).
    const hemi = new THREE.HemisphereLight(zs.hemiSky, zs.hemiGround, zs.hemiIntensity);
    scene.add(hemi);

    const pool: THREE.PointLight[] = [];
    for (let i = 0; i < MAX_TORCH_LIGHTS; i++) {
      const l = new THREE.PointLight(zs.torch, 0, L.TORCH_DISTANCE, L.TORCH_DECAY);
      pool.push(l);
      scene.add(l);
    }

    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    const order: number[] = kit.torches.map((_, i) => i);
    const dist2: number[] = kit.torches.map(() => 0);
    const seatColor = new THREE.Color(L.SEAT_LIGHT_COLOR);
    const lightColor = new THREE.Color();
    const lightPos = new THREE.Vector3();
    let lastProgress = 0;
    let flying = false;

    const assignLights = () => {
      const t = kit.torches;
      for (let i = 0; i < t.length; i++) dist2[i] = t[i].light.distanceToSquared(camera.position);
      order.sort((a, b) => dist2[a] - dist2[b]);
      const flick = (L.TORCH_FLICKER_AMOUNT / L.FLICKER_AMPLITUDE) * (fx.flicker.value - 1);
      for (let i = 0; i < pool.length; i++) {
        const idx = order[i];
        const l = pool[i];
        if (idx === undefined) {
          l.intensity = 0;
          continue;
        }
        l.position.copy(t[idx].light);
        l.intensity = L.TORCH_INTENSITY * (1 + flick * (i % 2 ? 1 : -0.6));
        l.color.copy(zs.torch);
        l.distance = L.TORCH_DISTANCE;
      }
      // The seat spotlight is one pooled light: the farthest torch light hands over to the reached chair.
      const spot = signs.seatSpot;
      const last = pool[pool.length - 1];
      if (spot.index >= 0 && spot.weight > 0) {
        const w = spot.weight;
        lightPos.copy(last.position).lerp(spot.position, w);
        last.position.copy(lightPos);
        last.intensity = THREE.MathUtils.lerp(last.intensity, L.SEAT_LIGHT_INTENSITY, w);
        last.color.copy(lightColor.copy(zs.torch).lerp(seatColor, w));
        last.distance = THREE.MathUtils.lerp(L.TORCH_DISTANCE, L.SEAT_LIGHT_DISTANCE, w);
      }
    };

    // ---- motion preference ----------------------------------------------------------------------------
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let motion = !reducedQuery.matches;
    let clock = 0; // seconds; only advances while motion is allowed
    let lastTime = performance.now();
    let lastDrawAt = 0;

    // ---- post stack -------------------------------------------------------------------------------------
    let post: Post | null = null;
    let postLoading = false;
    // Set by the adaptive-quality system and never undone. Dev only: ?post=0 starts with it off, to compare costs.
    let postOff = import.meta.env.DEV && new URLSearchParams(window.location.search).get('post') === '0';
    let disposed = false;

    const resize = () => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      post?.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    const ensurePost = () => {
      if (post || postLoading || postOff || !motion || disposed) return;
      postLoading = true;
      import('./post')
        .then(({ createPost }) => createPost(renderer, scene, camera))
        .then((p) => {
          postLoading = false;
          if (disposed || postOff || !motion) {
            p.dispose();
            return;
          }
          post = p;
          resize();
          draw();
        })
        .catch((err) => {
          postLoading = false;
          postOff = true; // do not retry
          console.warn('[scene] post-processing unavailable, rendering without it:', err);
        });
    };

    // Adaptive quality: one-way (never goes back up in a session).
    const quality = createQuality({
      currentPixelRatio: () => pixelRatio,
      dropPixelRatio: () => {
        pixelRatio = 1;
        renderer.setPixelRatio(1);
        resize();
      },
      disablePost: () => {
        postOff = true;
        post?.dispose();
        post = null;
      },
    });

    // ---- camera feel: breathing sway and a slight roll into turns ------------------------------------------
    const sway = new THREE.Vector3();
    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();
    const pc = new THREE.Vector3();
    const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const applyCameraFeel = () => {
      if (!motion) return;
      const t = clock * L.SWAY_SPEED;
      sway
        .set(Math.sin(t) * 0.5, Math.sin(t * 0.73 + 1.3) * 0.7, Math.sin(t * 0.51 + 0.4) * 0.3)
        .multiplyScalar(L.SWAY_AMPLITUDE); // length <= 0.91 * SWAY_AMPLITUDE
      camera.position.add(sway);

      const s = journey.sAt(lastProgress);
      journey.pointAt(s - L.ROLL_WINDOW, pa);
      journey.pointAt(s, pb);
      journey.pointAt(s + L.ROLL_WINDOW, pc);
      if (pa.distanceToSquared(pb) < 1e-6 || pb.distanceToSquared(pc) < 1e-6) return; // at either end of the path
      const h0 = Math.atan2(-(pb.x - pa.x), -(pb.z - pa.z));
      const h1 = Math.atan2(-(pc.x - pb.x), -(pc.z - pb.z));
      const maxRad = THREE.MathUtils.degToRad(L.ROLL_MAX_DEG);
      const roll = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(wrapPi(h1 - h0) * L.ROLL_DEG_PER_RAD), -maxRad, maxRad);
      camera.rotateZ(roll);
    };

    const draw = () => {
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      lastDrawAt = now;
      if (motion) clock += dt;

      renderer.info.reset();
      if (!flying) {
        journey.sample(lastProgress, pos, look);
        camera.position.copy(pos);
        camera.lookAt(look);
        applyCameraFeel();
      }

      // atmosphere by zone: fog, background, hemisphere and torch colours follow the camera's z
      zones.sample(camera.position.z, zs);
      (scene.fog as THREE.Fog).color.copy(zs.fog);
      (scene.background as THREE.Color).copy(zs.fog);
      hemi.color.copy(zs.hemiSky);
      hemi.groundColor.copy(zs.hemiGround);
      hemi.intensity = zs.hemiIntensity;
      fx.setTorchColor(zs.torch);

      const usePost = post !== null && motion && !postOff;
      fx.setHdr(usePost);
      fx.update(clock, motion);
      signs.update(camera.position, journey.sAt(lastProgress), dt, clock, motion);
      atmosphere.update(camera, zs, clock, motion ? dt : 0, renderer.domElement.height);
      runes.update(lastProgress, motion ? clock : 0);
      assignLights();
      kit.update(camera.position, FOG_FAR);

      if (usePost) post!.render(dt);
      else renderer.render(scene, camera);
      debug?.onDraw();
      perf?.onDraw();
    };
    resize();
    ensurePost();
    // Ambient loop: flicker, drifting dust and sway need a clock, so redraw at AMBIENT_FPS while the canvas is on
    // screen and the tab is visible. Scroll-driven draws count for the same budget (no double draw in a frame).
    let rafId = 0;
    let onScreen = true;
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => { onScreen = entries[entries.length - 1].isIntersecting; }) : null;
    io?.observe(canvas);
    if (L.AMBIENT_FPS > 0) {
      const interval = 1000 / L.AMBIENT_FPS;
      const tick = (now: number) => {
        rafId = requestAnimationFrame(tick);
        if (!motion || !onScreen || document.hidden || now - lastDrawAt < interval - 2) return;
        draw();
      };
      rafId = requestAnimationFrame(tick);
    }
    const onMotionChange = () => {
      motion = !reducedQuery.matches;
      if (motion) ensurePost();
      draw(); // repaint in the new state (post off, no sway, flames still)
    };
    reducedQuery.addEventListener('change', onMotionChange);

    // Dev-only tools. The condition is a compile-time constant, so production builds drop all of this.
    let debug: { onDraw(): void; dispose(): void } | null = null;
    let perf: { onDraw(): void; dispose(): void } | null = null;
    if (import.meta.env.DEV) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug') === '1') {
        import('./debug').then(({ attachDebug }) => {
          if (disposed) return;
          debug = attachDebug({
            plan,
            journey,
            camera,
            scene,
            kitGroup: kit.group,
            getProgress: () => lastProgress,
            setFlying: (f) => { flying = f; },
            redraw: draw,
          });
          draw();
        });
      }
      if (params.get('perf') === '1') {
        import('./perf').then(({ attachPerf }) => {
          if (disposed) return;
          perf = attachPerf(renderer, scene, quality);
        });
      }
    }

    return {
      resize,
      setLabels: signs.setLabels,
      render(progress: number) {
        lastProgress = Math.min(Math.max(progress, 0), 1);
        draw();
        quality.frame(performance.now()); // only scroll-driven draws are timed, so the ambient loop cannot trip it
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(rafId);
        io?.disconnect();
        reducedQuery.removeEventListener('change', onMotionChange);
        post?.dispose();
        post = null;
        debug?.dispose();
        debug = null;
        perf?.dispose();
        perf = null;
        // Release the GL context itself (renderer.dispose() alone leaves it alive until GC), after freeing resources.
        cleanup.unshift(() => renderer.forceContextLoss());
        disposeAll();
      },
    };
  } catch (e) {
    disposeAll(); // no forced context loss here: the fallback world reuses this canvas and its context
    throw e;
  }
}
