import re, sys, pathlib

def edit(path, pairs):
    p = pathlib.Path(path)
    raw = p.read_bytes().decode('utf-8')
    crlf = '\r\n' in raw
    s = raw.replace('\r\n', '\n')
    for old, new in pairs:
        if s.count(old) != 1:
            sys.exit(f'ANCHOR FAILED in {path}:\n{old[:90]}')
        s = s.replace(old, new)
    return p, (s.replace('\n', '\r\n') if crlf else s)

jobs = []

jobs.append(edit('src/lib/timeline.ts', [
    ('export const WALK_END = 0.82;', 'export const WALK_END = 0.66;'),
    ('export const THRONE_END = 0.93;', 'export const THRONE_END = 0.93;'),
    ('export const CHAT_CENTER = 0.965;', 'export const CHAT_CENTER = 0.97;'),
]))

jobs.append(edit('src/chapters.ts', [
    ('export const pinLengthVh = (chapterCount: number): number => Math.max(600, chapterCount * 100);',
     '// x1.24 keeps the forest pace unchanged now that WALK_END is 0.66 instead of 0.82.\n'
     'export const pinLengthVh = (chapterCount: number): number => Math.round(Math.max(600, chapterCount * 100) * 1.24);'),
]))

OLD_ROUTE = """      toWorld(0, 0, y0),
      toWorld(2.6, 1.3, y0 - 0.1),
      toWorld(5.8, 3.5, 2.7),
      toWorld(9.5, 3.3, 2.35),
      toWorld(14, 1.4, 2.0),
      toWorld(18.5, 0.2, 1.8),
      toWorld(24, 0, 1.7),"""
NEW_ROUTE = """      toWorld(0, 0, y0),
      toWorld(3, 1.6, y0 - 0.3),
      toWorld(6.5, 4.4, 2.8),
      toWorld(11, 4.6, 2.5),
      toWorld(15.5, 2.8, 2.1),
      toWorld(19.5, 0.5, 1.8),
      toWorld(24, 0, 1.7),"""

OLD_CAM = """    cameraAt(t, out) {
      const e = t * t * (3 - 2 * t);
      return route.getPointAt(e, out);
    },"""
NEW_CAM = """    cameraAt(t, out) {
      route.getPointAt(routeE(t), out);
      lastCam.copy(out); // gaze() runs right after this, so it sees the current frame's camera
      return out;
    },"""

i0 = None
jobs.append(None)  # placeholder, filled below

p = pathlib.Path('src/scene/throneRoom.ts')
raw = p.read_bytes().decode('utf-8'); crlf = '\r\n' in raw
s = raw.replace('\r\n', '\n')
a = s.find('    gaze(t, fireAim, out) {')
b = s.find('    update(clock, camera) {')
if a < 0 or b < a: sys.exit('ANCHOR FAILED: gaze block')
NEW_GAZE = """    gaze(t, fireAim, out) {
      // Stage 1: fire -> straight ahead along the route. Stage 2: ahead -> book. Both turn yaw and pitch
      // (never lerp points: that drags the target through the camera and rolls the view).
      const e = routeE(t);
      route.getTangentAt(e, gzC);
      gzC.y = 0;
      if (gzC.lengthSq() < 1e-6) gzC.copy(f);
      gzC.normalize().multiplyScalar(12).add(lastCam);
      gzC.y = 2.0;
      blendAim(fireAim, gzC, smooth(0.38, 0.62, t), gzD);
      blendAim(gzD, bookWorld, smooth(0.7, 1.0, t), out);
    },
"""
s = s[:a] + NEW_GAZE + s[b:]
HELPERS = """  const gzC = new THREE.Vector3();
  const gzD = new THREE.Vector3();
  const blendAim = (A: THREE.Vector3, B: THREE.Vector3, s: number, out: THREE.Vector3) => {
    const a = gzA.subVectors(A, lastCam);
    const b = gzB.subVectors(B, lastCam);
    const ya = Math.atan2(a.x, a.z);
    let dy = Math.atan2(b.x, b.z) - ya;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const pa = Math.atan2(a.y, Math.hypot(a.x, a.z));
    const pb = Math.atan2(b.y, Math.hypot(b.x, b.z));
    const yaw = ya + dy * s;
    const pitch = pa + (pb - pa) * s;
    const dist = Math.max(1, a.length() + (b.length() - a.length()) * s);
    out.set(
      lastCam.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      lastCam.y + Math.sin(pitch) * dist,
      lastCam.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    );
  };
"""
s2 = s.replace('\n', '\r\n') if crlf else s
jobs[2] = (p, s2)  # temp; rebuild with remaining pairs below
# apply remaining anchored edits on s (LF form)
pairs = [
    ('const ARCH_U = 52.5;',
     'const ARCH_U = 52.5;\n\n// Camera route pacing: hold at the contact card for the first part, then move at nearly constant speed.\n'
     'const ROUTE_DWELL = 0.3;\n'
     'const routeE = (t: number) => {\n  const u = Math.min(1, Math.max(0, (t - ROUTE_DWELL) / (1 - ROUTE_DWELL)));\n  return u * 0.65 + u * u * (3 - 2 * u) * 0.35;\n};'),
    (OLD_ROUTE, NEW_ROUTE),
    (OLD_CAM, NEW_CAM),
    ('  const gzB = new THREE.Vector3();\n', '  const gzB = new THREE.Vector3();\n' + HELPERS),
]
for old, new in pairs:
    if s.count(old) != 1: sys.exit(f'ANCHOR FAILED in throneRoom.ts:\n{old[:90]}')
    s = s.replace(old, new)
jobs[2] = (p, s.replace('\n', '\r\n') if crlf else s)
jobs = [j for j in jobs if j]

for path, text in jobs:
    bak = path.with_suffix(path.suffix + '.pre-camera.bak')
    bak.write_bytes(path.read_bytes())
    path.write_bytes(text.encode('utf-8'))
    print('patched', path)