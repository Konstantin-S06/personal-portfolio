// Procedural round table with a faint rune ring and six chairs. No external models.
// Each chair is a THREE.Group named seat-1..seat-6; those are the project stops.
import * as THREE from 'three';
import { TABLE_RADIUS, type TableLayout } from './plan';

export const TABLE_HEIGHT = 1.1;

function runeTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const mid = size / 2;
  const outer = 2.5; // world radius that maps to the canvas edge (matches the ring geometry)
  const px = (r: number) => (r / outer) * mid;
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineWidth = 3;
  for (const r of [1.95, 2.45]) {
    g.beginPath();
    g.arc(mid, mid, px(r), 0, Math.PI * 2);
    g.stroke();
  }
  // 24 pseudo-runes: a stem with a couple of deterministic branches.
  g.lineWidth = 4;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const nx = -dy;
    const ny = dx;
    const at = (r: number, off: number) => [mid + dx * px(r) + nx * px(off), mid + dy * px(r) + ny * px(off)] as const;
    const stem0 = at(2.03, 0);
    const stem1 = at(2.37, 0);
    g.beginPath();
    g.moveTo(...stem0);
    g.lineTo(...stem1);
    const k = (i * 7) % 5;
    if (k !== 0) { g.moveTo(...at(2.1, 0)); g.lineTo(...at(2.25, 0.09)); }
    if (k > 1) { g.moveTo(...at(2.2, 0)); g.lineTo(...at(2.33, -0.09)); }
    if (k === 4) { g.moveTo(...at(2.3, 0.08)); g.lineTo(...at(2.37, 0.0)); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface TableBuild {
  group: THREE.Group;
  dispose(): void;
}

export function buildTable(layout: TableLayout, floorY = 0): TableBuild {
  const group = new THREE.Group();
  group.name = 'table';
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const track = <T extends THREE.BufferGeometry | THREE.Material>(o: T): T => {
    if ((o as THREE.BufferGeometry).isBufferGeometry) geos.push(o as THREE.BufferGeometry);
    else mats.push(o as THREE.Material);
    return o;
  };

  const wood = track(new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 }));
  const top = new THREE.Mesh(track(new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, TABLE_HEIGHT, 48)), wood);
  top.position.set(layout.x, floorY + TABLE_HEIGHT / 2, layout.z);
  top.castShadow = true;
  top.receiveShadow = true;
  top.name = 'table-top';
  group.add(top);

  const tex = runeTexture();
  const runeMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0x7fe8ff,
      emissiveMap: tex,
      emissiveIntensity: 0.55,
      alphaMap: tex,
      transparent: true,
      depthWrite: false,
    }),
  );
  const ring = new THREE.Mesh(track(new THREE.RingGeometry(1.9, 2.5, 96)), runeMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(layout.x, floorY + TABLE_HEIGHT + 0.01, layout.z);
  ring.name = 'rune-ring';
  group.add(ring);

  const chairMat = track(new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.95 }));
  const seatGeo = track(new THREE.BoxGeometry(1.2, 0.14, 1.2));
  const backGeo = track(new THREE.BoxGeometry(1.2, 1.1, 0.14));
  const postGeo = track(new THREE.BoxGeometry(0.24, 0.5, 0.24));
  for (const seat of layout.seats) {
    const chair = new THREE.Group();
    chair.name = `seat-${seat.n}`;
    const s = new THREE.Mesh(seatGeo, chairMat);
    s.position.y = 0.57;
    const b = new THREE.Mesh(backGeo, chairMat);
    b.position.set(0, 1.19, -0.53);
    const p = new THREE.Mesh(postGeo, chairMat);
    p.position.y = 0.25;
    for (const m of [s, b, p]) {
      m.castShadow = true;
      m.receiveShadow = true;
      chair.add(m);
    }
    chair.position.set(seat.x, floorY, seat.z);
    chair.rotation.y = -seat.angle; // local +Z (the seat front) faces the table
    group.add(chair);
  }

  return {
    group,
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      tex.dispose();
    },
  };
}
