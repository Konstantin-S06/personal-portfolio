// Inspects every .glb/.gltf under public/models/kit and writes docs/kit-inventory.json.
// Per file: bounding box (world space, after node transforms), size, pivot
// (model origin) relative to the box, and triangle count.
import { NodeIO } from '@gltf-transform/core';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kitDir = path.join(root, 'public', 'models', 'kit');
const outFile = path.join(root, 'docs', 'kit-inventory.json');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(glb|gltf)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

// Column-major 4x4 multiply: returns a * b.
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

const round = (n) => Math.round(n * 10000) / 10000;
const round3 = (v) => v.map(round);

// Pivot position as a fraction of the box on each axis: 0 = min face, 0.5 = middle, 1 = max face.
function anchorLabel(t) {
  const near = (v, target) => Math.abs(v - target) < 0.01;
  const pick = (v) => (near(v, 0) ? 'min' : near(v, 1) ? 'max' : near(v, 0.5) ? 'mid' : 'off');
  return { x: pick(t[0]), y: pick(t[1]), z: pick(t[2]) };
}

function describeAnchor(a) {
  const horiz = [a.x, a.z];
  const edgeCount = horiz.filter((v) => v === 'min' || v === 'max').length;
  const midCount = horiz.filter((v) => v === 'mid').length;
  let kind;
  if (horiz.includes('off')) kind = 'off-center';
  else if (edgeCount === 2) kind = 'corner';
  else if (edgeCount === 1) kind = 'edge';
  else if (midCount === 2) kind = 'center';
  else kind = 'off-center';
  return kind;
}

async function inspect(file) {
  const io = new NodeIO();
  const doc = await io.read(file);
  const root3 = doc.getRoot();

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  const meshCount = root3.listMeshes().length;

  const visit = (node, parentMatrix) => {
    const world = mul(parentMatrix, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (pos) {
          const arr = pos.getArray();
          for (let i = 0; i < arr.length; i += 3) {
            const p = transformPoint(world, arr[i], arr[i + 1], arr[i + 2]);
            for (let k = 0; k < 3; k++) {
              if (p[k] < min[k]) min[k] = p[k];
              if (p[k] > max[k]) max[k] = p[k];
            }
          }
        }
        const mode = prim.getMode();
        const count = prim.getIndices() ? prim.getIndices().getCount() : pos ? pos.getCount() : 0;
        if (mode === 4) triangles += count / 3; // TRIANGLES
        else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2); // STRIP / FAN
      }
    }
    for (const child of node.listChildren()) visit(child, world);
  };

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scenes = root3.listScenes();
  for (const scene of scenes) for (const node of scene.listChildren()) visit(node, identity);
  // Some files have meshes not attached to any scene; include them with identity transforms.
  if (!Number.isFinite(min[0])) {
    for (const node of root3.listNodes()) if (!node.getParentNode()) visit(node, identity);
  }

  if (!Number.isFinite(min[0])) {
    return { error: 'no geometry found', meshCount };
  }

  const size = max.map((v, i) => v - min[i]);
  // Pivot = model origin (0,0,0) expressed relative to the box.
  const pivotOffsetFromMin = [0 - min[0], 0 - min[1], 0 - min[2]];
  const pivotNormalized = pivotOffsetFromMin.map((v, i) => (size[i] ? v / size[i] : 0));
  const anchor = anchorLabel(pivotNormalized);

  return {
    meshCount,
    triangles: Math.round(triangles),
    boundsMin: round3(min),
    boundsMax: round3(max),
    size: round3(size),
    pivotWorld: [0, 0, 0],
    pivotOffsetFromBoxMin: round3(pivotOffsetFromMin),
    pivotNormalized: round3(pivotNormalized),
    pivotAnchor: { ...anchor, kind: describeAnchor(anchor) },
  };
}

const files = (await walk(kitDir)).sort();
const hashes = new Map();
const entries = [];

for (const file of files) {
  const buf = await readFile(file);
  const hash = createHash('sha256').update(buf).digest('hex');
  const rel = path.relative(kitDir, file).split(path.sep).join('/');
  const entry = { file: path.basename(file), path: rel, bytes: buf.length, sha256: hash };
  if (hashes.has(hash)) entry.duplicateOf = hashes.get(hash);
  else hashes.set(hash, rel);
  try {
    Object.assign(entry, await inspect(file));
  } catch (err) {
    entry.error = String(err.message || err);
  }
  entries.push(entry);
  console.log(`${rel}: ${entry.error ? 'ERROR ' + entry.error : `size ${entry.size?.join(' x ')}, tris ${entry.triangles}`}`);
}

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(
  outFile,
  JSON.stringify({ generatedAt: new Date().toISOString(), source: 'public/models/kit', count: entries.length, files: entries }, null, 2) + '\n',
);
console.log(`\nWrote ${entries.length} entries to ${path.relative(root, outFile)}`);
