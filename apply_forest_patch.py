#!/usr/bin/env python3
"""Forest upgrade patch. Run from the repo root (the folder containing src/).

Edits src/scene/world.ts, dirtPath.ts and look.ts. All anchors are checked first; if any is missing or
ambiguous nothing is written. Preserves CRLF, writes *.pre-forest.bak backups, refuses to run twice.
Needs src/scene/forestKit.ts to be in place already.
"""
import os
import re
import sys

SCENE = os.path.join("src", "scene")


def load(name):
    path = os.path.join(SCENE, name)
    with open(path, "rb") as f:
        raw = f.read().decode("utf-8")
    return path, ("\r\n" in raw), raw.replace("\r\n", "\n")


def exact(text, old, new, label):
    n = text.count(old)
    if n != 1:
        sys.exit(f"ANCHOR PROBLEM ({label}): found {n} matches, expected 1. Nothing written.")
    return text.replace(old, new)


def block(text, pattern, new, label):
    ms = list(re.finditer(pattern, text, re.S))
    if len(ms) != 1:
        sys.exit(f"ANCHOR PROBLEM ({label}): found {len(ms)} matches, expected 1. Nothing written.")
    m = ms[0]
    return text[: m.start()] + new + text[m.end():]


# ------------------------------------------------------------------------------------------------ world.ts
wpath, wcrlf, w = load("world.ts")
if "forestKit" in w:
    sys.exit("world.ts already imports forestKit: patch already applied. Nothing written.")
if not os.path.exists(os.path.join(SCENE, "forestKit.ts")):
    sys.exit("src/scene/forestKit.ts is missing. Copy it in first. Nothing written.")

w = exact(
    w,
    "import { createDirtPath } from './dirtPath';\n",
    "import { createDirtPath } from './dirtPath';\nimport { buildProcGeometries, buildGround, type ForestKind } from './forestKit';\n",
    "import",
)

# sky: four hill layers plus a distant tree line
w = exact(
    w,
    "  hill(H * 0.5, H * 0.09, 0.006, 0.017, 1.3, 4.1, '#2a2960');\n"
    "  hill(H * 0.52, H * 0.06, 0.009, 0.025, 2.7, 0.6, '#212056');\n",
    """  hill(H * 0.44, H * 0.09, 0.004, 0.013, 0.4, 2.2, '#3b3b7c');
  hill(H * 0.47, H * 0.08, 0.005, 0.015, 5.1, 3.3, '#313170');
  hill(H * 0.5, H * 0.09, 0.006, 0.017, 1.3, 4.1, '#2a2960');
  hill(H * 0.52, H * 0.06, 0.009, 0.025, 2.7, 0.6, '#212056');
  // distant tree line along the nearest ridge
  g.globalAlpha = 0.75;
  g.fillStyle = '#18174a';
  for (let tx = 0; tx < W; tx += 4 + rnd() * 6) {
    const th = 10 + rnd() * 24;
    const tw = 3 + rnd() * 4;
    const by = H * 0.535;
    g.beginPath();
    g.moveTo(tx - tw, by);
    g.lineTo(tx, by - th);
    g.lineTo(tx + tw, by);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
""",
    "sky hills",
)

# kinds
w = block(
    w,
    r"type ProcKind =\n(?:  \| '[A-Za-z]+'\n)*  \| '[A-Za-z]+';\n",
    "type ProcKind = ForestKind;\n",
    "ProcKind union",
)

# trees through birch planting
TREES = """    // Every tree is one merged geometry (trunk + foliage) with baked vertex colours; the instance colour is
    // only a light per-tree tint.
    const tint = (amt = 0.14) => {
      const k = 1 - rand() * amt;
      return new THREE.Color(k * (0.95 + rand() * 0.1), k, k * (0.95 + rand() * 0.1));
    };
    const placePine = (x: number, z: number, s: number, ry: number) => {
      const k = 0.8 * s;
      push({ kind: 'pine', x, y: 0, z, sx: k, sy: k * (0.9 + rand() * 0.25), sz: k, ry, color: tint() });
    };
    const placeDeciduous = (x: number, z: number, s: number, ry: number) => {
      const k = 0.95 * s;
      push({ kind: 'decid', x, y: 0, z, sx: k, sy: k * (0.9 + rand() * 0.25), sz: k, ry, color: tint() });
    };
    const placeBirch = (x: number, z: number, s: number, ry: number) => {
      push({ kind: 'birch', x, y: 0, z, sx: s, sy: s * (0.9 + rand() * 0.25), sz: s, ry, color: tint(0.1) });
    };

    const plantTrees = (count: number, place: (x: number, z: number, s: number, ry: number) => void) => {
      let n = 0;
      let guard = 0;
      while (n < count && guard++ < count * 40) {
        const spot = scatterSpot(6, 45, 0.8, true);
        if (!spot) continue;
        claim(spot.x, spot.z, 1.1);
        place(spot.x, spot.z, varyScale(1, rand), rand() * Math.PI * 2);
        n++;
      }
    };
    plantTrees(L.COUNTS.pine, placePine);
    plantTrees(L.COUNTS.deciduous, placeDeciduous);
    plantTrees(L.COUNTS.birch, placeBirch);
"""
w = block(w, r"    const placePine = \(.*?    plantTrees\(L\.COUNTS\.birch, placeBirch\);\n", TREES, "trees")

# rocks, bushes, grass, flowers (up to the stump loop), plus ferns and mushrooms
GROUND_PROPS = """    const rockColor = () => varyColor(L.PROP_COLORS_OUTDOOR.rock[(rand() * L.PROP_COLORS_OUTDOOR.rock.length) | 0], rand);
    let rocks = 0;
    while (rocks < L.COUNTS.rocks) {
      const spot = scatterSpot(3.2, 22, 0.45);
      if (!spot) break;
      claim(spot.x, spot.z, 0.55);
      const s = varyScale(0.6, rand, L.PROP_SCALE_VAR);
      push({
        kind: rand() < 0.55 ? 'rockA' : 'rockB',
        x: spot.x,
        y: -0.04 * s,
        z: spot.z,
        sx: s * (0.8 + rand() * 0.6),
        sy: s * (0.6 + rand() * 0.6),
        sz: s * (0.8 + rand() * 0.6),
        ry: rand() * Math.PI * 2,
        color: rockColor(),
      });
      rocks++;
    }

    // Boulder clusters: three to five larger rocks together.
    for (let i = 0; i < L.COUNTS.boulderClusters; i++) {
      const spot = scatterSpot(6, 28, 1.6);
      if (!spot) continue;
      claim(spot.x, spot.z, 1.8);
      const n = 3 + ((rand() * 3) | 0);
      for (let j = 0; j < n; j++) {
        const a = rand() * Math.PI * 2;
        const rr = rand() * 1.0;
        const s = 0.8 + rand() * 0.7;
        push({
          kind: rand() < 0.7 ? 'rockA' : 'rockB',
          x: spot.x + Math.cos(a) * rr,
          y: -0.05 * s,
          z: spot.z + Math.sin(a) * rr,
          sx: s,
          sy: s * (0.7 + rand() * 0.5),
          sz: s * (0.8 + rand() * 0.4),
          ry: rand() * Math.PI * 2,
          color: rockColor(),
        });
      }
    }

    for (let i = 0; i < L.COUNTS.bushes; i++) {
      const spot = scatterSpot(3.2, 18, 0.4);
      if (!spot) continue;
      claim(spot.x, spot.z, 0.5);
      const s = varyScale(0.65, rand, L.PROP_SCALE_VAR);
      push({
        kind: 'bush',
        x: spot.x,
        y: 0.3 * s,
        z: spot.z,
        sx: s * 1.1,
        sy: s * 0.7,
        sz: s * 1.1,
        ry: rand() * Math.PI * 2,
        color: varyColor(L.PROP_COLORS_OUTDOOR.bush[(rand() * L.PROP_COLORS_OUTDOOR.bush.length) | 0], rand),
      });
    }

    for (let i = 0; i < L.COUNTS.grass; i++) {
      const spot = scatterSpot(3.05, 12, 0.12);
      if (!spot) continue;
      const s = varyScale(0.55, rand, 0.35);
      push({
        kind: 'grass',
        x: spot.x,
        y: 0,
        z: spot.z,
        sx: s,
        sy: s,
        sz: s,
        ry: rand() * Math.PI * 2,
        color: varyColor(L.PROP_COLORS_OUTDOOR.grass[(rand() * L.PROP_COLORS_OUTDOOR.grass.length) | 0], rand),
      });
    }

    for (let i = 0; i < L.COUNTS.ferns; i++) {
      const spot = scatterSpot(3.1, 16, 0.3);
      if (!spot) continue;
      const s = varyScale(0.7, rand, 0.3);
      push({
        kind: 'fern',
        x: spot.x,
        y: 0,
        z: spot.z,
        sx: s,
        sy: s,
        sz: s,
        ry: rand() * Math.PI * 2,
        color: varyColor(L.PROP_COLORS_OUTDOOR.fern[(rand() * L.PROP_COLORS_OUTDOOR.fern.length) | 0], rand),
      });
    }

    for (let i = 0; i < L.COUNTS.mushrooms; i++) {
      const spot = scatterSpot(3.6, 20, 0.2);
      if (!spot) continue;
      const s = varyScale(0.9, rand, 0.35);
      push({
        kind: 'mushroom',
        x: spot.x,
        y: 0,
        z: spot.z,
        sx: s,
        sy: s,
        sz: s,
        ry: rand() * Math.PI * 2,
        color: varyColor(0xffffff, rand, 0.08),
      });
    }

    for (let i = 0; i < L.COUNTS.flowers; i++) {
      const spot = scatterSpot(3.1, 14, 0.1);
      if (!spot) continue;
      const s = varyScale(0.8, rand, 0.3);
      push({
        kind: 'flower',
        x: spot.x,
        y: 0,
        z: spot.z,
        sx: s,
        sy: s,
        sz: s,
        ry: rand() * Math.PI * 2,
        color: varyColor(L.PROP_COLORS_OUTDOOR.flower[(rand() * 3) | 0], rand),
      });
    }

"""
w = block(w, r"    let rocks = 0;\n.*?(?=    for \(let i = 0; i < L\.COUNTS\.stumps; i\+\+\) \{\n)", GROUND_PROPS, "rocks..flowers")

# geometries
w = block(
    w,
    r"    const geos: Record<ProcKind, THREE\.BufferGeometry> = \{\n.*?\n    \};\n",
    "    const geos = buildProcGeometries();\n",
    "geos",
)

# material: vertex colours
w = exact(
    w,
    "new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true })",
    "new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true, vertexColors: true })",
    "lit material",
)

# ground
w = block(
    w,
    r"  const groundW = maxX - minX;\n.*?  disposables\.push\(ground\.geometry, ground\.material as THREE\.Material\);\n",
    """  const ground = new THREE.Mesh(
    buildGround(minX, maxX, minZ, maxZ, distToPath, occupied),
    new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
  );
  scene.add(ground);
  disposables.push(ground.geometry, ground.material as THREE.Material);
""",
    "ground",
)

# ------------------------------------------------------------------------------------------------ dirtPath.ts
dpath, dcrlf, d = load("dirtPath.ts")
if "ragged" in d.lower():
    sys.exit("dirtPath.ts already patched. Nothing written.")
d = exact(d, "  const S = 128;\n", "  const S = 256;\n", "dirt S")
d = exact(
    d,
    "      const edge = kind === 'strip' ? Math.abs(nx) : Math.hypot(nx, ny);\n"
    "      const alpha = 1 - smooth(0.6, 1, edge);\n",
    """      // Ragged, noise-bitten edge (integer frequencies keep the strip tileable) with a short soft fade.
      const wob =
        kind === 'strip'
          ? 0.07 * Math.sin((Math.PI * 2 * 5 * y) / S + 1.3) + 0.05 * Math.sin((Math.PI * 2 * 11 * y) / S + 0.4)
          : 0.06 * Math.sin(Math.atan2(ny, nx) * 7 + 0.5) + 0.04 * Math.sin(Math.atan2(ny, nx) * 13);
      const edge = (kind === 'strip' ? Math.abs(nx) : Math.hypot(nx, ny)) + wob + (rnd() - 0.5) * 0.06;
      const alpha = 1 - smooth(0.74, 0.96, edge);
""",
    "dirt edge",
)
d = exact(
    d,
    "      const v = (0.76 + 0.24 * rnd()) * blot;\n",
    "      const v = (0.76 + 0.24 * rnd()) * blot * (1 - 0.22 * smooth(0.5, 0.9, edge));\n",
    "dirt shade",
)

# ------------------------------------------------------------------------------------------------ look.ts
lpath, lcrlf, lk = load("look.ts")
lk = exact(lk, "  mistPlanes: 8,\n", "  mistPlanes: 14,\n", "mist count")
lk = exact(lk, "export const MIST_OPACITY_OUTDOOR = 0.10;", "export const MIST_OPACITY_OUTDOOR = 0.12;", "mist opacity")
lk = block(lk, r"  flowers: 0,[^\n]*\n", "  flowers: 60, // small stemmed flowers near the path\n", "flowers")

# ------------------------------------------------------------------------------------------------ write
for path, crlf, text in ((wpath, wcrlf, w), (dpath, dcrlf, d), (lpath, lcrlf, lk)):
    with open(path, "rb") as f:
        orig = f.read()
    with open(path + ".pre-forest.bak", "wb") as f:
        f.write(orig)
    out = text.replace("\n", "\r\n") if crlf else text
    with open(path, "wb") as f:
        f.write(out.encode("utf-8"))
    print("patched", path)

print("Done. Delete the *.pre-forest.bak files before committing.")
