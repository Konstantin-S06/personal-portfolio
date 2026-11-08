// Dev-only tools, loaded via dynamic import behind `import.meta.env.DEV` and `?debug=1`.
//  - Top-down map overlay of the plan, the camera path, stops, and the camera.
//  - Free-fly camera: WASD to move, Q/E down/up, Shift to go faster, drag with the mouse to look,
//    R prints the camera position, F toggles back to the scroll-driven camera, C hides the ceiling.
import * as THREE from 'three';
import { cellXZ, tableLayout, type Plan } from './plan';
import type { Journey } from './journey';

export interface DebugContext {
  plan: Plan;
  journey: Journey;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  kitGroup: THREE.Group;
  getProgress(): number;
  setFlying(flying: boolean): void;
  redraw(): void;
}

const PX = 9; // map pixels per cell

export function attachDebug(ctx: DebugContext): { onDraw(): void; dispose(): void } {
  const { plan, journey, camera } = ctx;

  // ---- overlay -----------------------------------------------------------------------------
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'fixed', top: '8px', right: '8px', zIndex: '99999', pointerEvents: 'none',
    font: '11px/1.4 ui-monospace, Menlo, Consolas, monospace', color: '#e8e8e8',
    background: 'rgba(8,8,12,0.78)', padding: '6px', border: '1px solid rgba(255,255,255,0.25)', borderRadius: '6px',
  } as CSSStyleDeclaration);
  const map = document.createElement('canvas');
  map.width = plan.cols * PX;
  map.height = plan.rows * PX;
  const hud = document.createElement('div');
  hud.style.whiteSpace = 'pre';
  wrap.append(map, hud);
  document.body.appendChild(wrap);

  const g = map.getContext('2d')!;
  const toMap = (x: number, z: number): [number, number] => [(x / plan.cell + 0.5) * PX, (z / plan.cell + 0.5) * PX];

  // Static layer is drawn once into an offscreen canvas.
  const base = document.createElement('canvas');
  base.width = map.width;
  base.height = map.height;
  const b = base.getContext('2d')!;
  b.fillStyle = '#0b0b10';
  b.fillRect(0, 0, base.width, base.height);
  for (let r = 0; r < plan.rows; r++) {
    for (let c = 0; c < plan.cols; c++) {
      if (!plan.walkable[r][c]) continue;
      b.fillStyle = plan.raised[r][c] ? '#6d6fa8' : '#464a55';
      b.fillRect(c * PX, r * PX, PX - 1, PX - 1);
    }
  }
  const dot = (cell: { r: number; c: number }, color: string, radius: number) => {
    b.fillStyle = color;
    b.beginPath();
    b.arc((cell.c + 0.5) * PX, (cell.r + 0.5) * PX, radius, 0, Math.PI * 2);
    b.fill();
  };
  plan.doors.forEach((d) => dot(d, '#d08a3c', 3.5));
  plan.torches.forEach((t) => dot(t, '#ffb347', 2));
  plan.pillars.forEach((p) => dot(p, '#c9c9c9', 2.5));
  for (const s of plan.stairs) {
    for (const cell of [s.bottom, s.top]) {
      b.fillStyle = '#9ec1ff';
      b.fillRect(cell.c * PX + 1, cell.r * PX + 1, PX - 3, PX - 3);
    }
  }
  const tbl = tableLayout(plan);
  {
    const [tx, tz] = toMap(tbl.x, tbl.z);
    b.strokeStyle = '#7fe8ff';
    b.beginPath();
    b.arc(tx, tz, (3 / plan.cell) * PX, 0, Math.PI * 2);
    b.stroke();
    b.fillStyle = '#7fe8ff';
    b.font = '8px sans-serif';
    for (const seat of tbl.seats) {
      const [sx, sz] = toMap(seat.x, seat.z);
      b.fillRect(sx - 1.5, sz - 1.5, 3, 3);
      b.fillText(String(seat.n), sx + 3, sz - 2);
    }
  }
  // path
  const pts = journey.polyline(400);
  b.strokeStyle = '#ffe14d';
  b.lineWidth = 1.2;
  b.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = toMap(p.x, p.z);
    if (i === 0) b.moveTo(x, y);
    else b.lineTo(x, y);
  });
  b.stroke();
  plan.waypoints.forEach((w, i) => {
    const [x, z] = cellXZ(plan, w);
    const [mx, mz] = toMap(x, z);
    b.fillStyle = '#ffe14d';
    b.fillRect(mx - 1.5, mz - 1.5, 3, 3);
    b.fillStyle = '#fff6b0';
    b.font = '7px sans-serif';
    b.fillText(`P${i + 1}`, mx + 3, mz + 8);
  });
  // stops: anchor (red ring) joined to its position on the path
  journey.stops.forEach((s) => {
    const [ax, az] = toMap(s.anchor[0], s.anchor[2]);
    b.strokeStyle = '#ff5d5d';
    b.lineWidth = 1.2;
    b.beginPath();
    b.arc(ax, az, 4, 0, Math.PI * 2);
    b.stroke();
    b.fillStyle = '#ff9a9a';
    b.font = '8px sans-serif';
    b.fillText(s.chapterId.replace('project-', 'p'), ax + 5, az + 3);
  });

  const drawMap = () => {
    g.clearRect(0, 0, map.width, map.height);
    g.drawImage(base, 0, 0);
    const [cx, cz] = toMap(camera.position.x, camera.position.z);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const ang = Math.atan2(dir.x, dir.z); // 0 = facing +Z (down the map)
    g.save();
    g.translate(cx, cz);
    g.rotate(-ang);
    g.fillStyle = flying ? '#58ff9a' : '#ffffff';
    g.beginPath();
    g.moveTo(0, 6);
    g.lineTo(-4, -4);
    g.lineTo(4, -4);
    g.closePath();
    g.fill();
    g.restore();
  };

  // ---- free-fly camera --------------------------------------------------------------------------
  let flying = true;
  let yaw = 0;
  let pitch = 0;
  let ceilingHidden = false;
  let printed = '';
  const keys = new Set<string>();
  let dragging = false;
  let raf = 0;
  let last = 0;

  const syncAnglesFromCamera = () => {
    const d = camera.getWorldDirection(new THREE.Vector3());
    yaw = Math.atan2(-d.x, -d.z); // yaw 0 faces -Z, the same as an unrotated camera
    pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  };
  const applyAngles = () => {
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, yaw, 0);
  };

  const hudText = () =>
    `${flying ? 'FREE-FLY' : 'PATH'}  (F toggles)\n` +
    `WASD move  Q/E down/up  Shift fast\n` +
    `drag = look   R = print position   C = ceiling\n` +
    `progress ${ctx.getProgress().toFixed(3)}\n` +
    `pos ${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}\n` +
    printed;

  const tick = (now: number) => {
    raf = 0;
    if (!flying) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const speed = (keys.has('shift') ? 36 : 12) * dt;
    const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    if (keys.has('w')) camera.position.addScaledVector(fwd, speed);
    if (keys.has('s')) camera.position.addScaledVector(fwd, -speed);
    if (keys.has('d')) camera.position.addScaledVector(right, speed);
    if (keys.has('a')) camera.position.addScaledVector(right, -speed);
    if (keys.has('e')) camera.position.y += speed;
    if (keys.has('q')) camera.position.y -= speed;
    applyAngles();
    ctx.redraw();
    if (keys.size > 0 || dragging) raf = requestAnimationFrame(tick);
  };
  const kick = () => {
    if (!raf && flying) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  const onKeyDown = (e: KeyboardEvent) => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'f') {
      flying = !flying;
      ctx.setFlying(flying);
      if (flying) syncAnglesFromCamera();
      ctx.redraw();
      return;
    }
    if (k === 'r') {
      const p = camera.position;
      printed = `printed: [${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}]  yaw ${yaw.toFixed(2)} pitch ${pitch.toFixed(2)}`;
      console.log('[debug] camera', { position: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3) });
      ctx.redraw();
      return;
    }
    if (k === 'c') {
      ceilingHidden = !ceilingHidden;
      setCeiling(!ceilingHidden);
      ctx.redraw();
      return;
    }
    if ('wasdqe'.includes(k) && k.length === 1) {
      keys.add(k);
      kick();
    }
    if (k === 'shift') keys.add('shift');
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.key.toLowerCase());
  };
  const onDown = (e: MouseEvent) => {
    if (e.button !== 0 || !flying || typing(e.target)) return;
    dragging = true;
    document.body.style.userSelect = 'none';
    kick();
  };
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    yaw -= e.movementX * 0.003;
    pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.003, -1.5, 1.5);
    applyAngles();
    ctx.redraw();
  };
  const onUp = () => {
    dragging = false;
    document.body.style.userSelect = '';
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  // Ceiling = the flipped floor instances. Hiding them individually would need the matrices, so scale them to zero.
  const ceilMeshes = ctx.kitGroup.children.filter((o) => o.name.startsWith(`kit:${plan.kit.floor}@`)) as THREE.InstancedMesh[];
  const ceilOriginal = new Map<THREE.InstancedMesh, THREE.Matrix4[]>();
  for (const mesh of ceilMeshes) {
    const list: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      list.push(m.clone());
    }
    ceilOriginal.set(mesh, list);
  }
  const setCeiling = (visible: boolean) => {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    ceilOriginal.forEach((list, mesh) => {
      list.forEach((m, i) => {
        const isCeiling = Math.abs(m.elements[13] - 4.05) < 0.01;
        mesh.setMatrixAt(i, isCeiling && !visible ? zero : m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  };

  // Start in fly mode from wherever the path camera currently is.
  syncAnglesFromCamera();
  ctx.setFlying(true);

  return {
    onDraw() {
      drawMap();
      hud.textContent = hudText();
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      wrap.remove();
    },
  };
}
