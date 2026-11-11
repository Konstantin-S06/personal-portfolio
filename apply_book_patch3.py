"""Run from the project root AFTER apply_book_patch2.py: python apply_book_patch3.py
Fixes the flick at the end of the camera move: the gaze is now a pure function of how far along the court the
camera is (no wrap-around yaw maths while the fire is behind the camera). Checks every anchor, writes nothing on a mismatch."""
import re, sys, pathlib

def load(p):
    p = pathlib.Path(p)
    if not p.exists():
        sys.exit('MISSING FILE: ' + str(p))
    raw = p.read_bytes().decode('utf-8')
    return p, raw, '\r\n' in raw, raw.replace('\r\n', '\n')

TR, trraw, trcrlf, s = load('src/scene/throneRoom.ts')
WD, wdraw, wdcrlf, w = load('src/scene/world.ts')

IFACE = "  gaze(t: number, fireAim: THREE.Vector3, out: THREE.Vector3): void;"
if s.count(IFACE) != 1: sys.exit('ANCHOR FAILED: ThroneRoom.gaze interface line')
s = s.replace(IFACE, "  gaze(t: number, fireAim: THREE.Vector3, out: THREE.Vector3, pos: THREE.Vector3): void;")

a = s.find('    gaze(t, fireAim, out) {')
b = s.find('    update(clock, camera) {')
if s.count('    gaze(t, fireAim, out) {') != 1 or b < a: sys.exit('ANCHOR FAILED: gaze method')

# keep helpers from the earlier patches referenced, so a noUnusedLocals build does not fail
keep = [n for n in ['gzC', 'gzD', 'blendAim', 'aimYawPitch', 'endDirV', 'endYaw', 'endPitch'] if re.search(r'const ' + n + r'\b', s)]
voids = ''.join(f'      void {n};\n' for n in keep)

NEW = """    gaze(_t, fireAim, out, pos) {
      // Pure function of the camera's distance along the court. Stage 1 (u 5..16): turn from the fire to straight
      // down the court. Stage 2 (u 22..end): tilt down onto the book. Both ease out to zero speed, and the fire is
      // never used once it is behind the camera, so there is no wrap-around flip at the end.
""" + voids + """      const uCam = (pos.x - origin.x) * f.x + (pos.z - origin.z) * f.z;
      const a = gzA.subVectors(fireAim, pos);
      const ya = Math.atan2(a.x, a.z);
      const pa = Math.atan2(a.y, Math.hypot(a.x, a.z));
      let dy = Math.atan2(f.x, f.z) - ya;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const kTurn = smooth(5, 16, uCam);
      const kDrop = smooth(22, CAM_END_U, uCam);
      const pitchEnd = Math.atan2(BOOK_Y - CAM_END_Y, LECT_U - CAM_END_U);
      const yaw = ya + dy * kTurn;
      const p1 = pa + (-0.08 - pa) * kTurn;
      const pitch = p1 + (pitchEnd - p1) * kDrop;
      out.set(
        pos.x + Math.sin(yaw) * Math.cos(pitch) * 10,
        pos.y + Math.sin(pitch) * 10,
        pos.z + Math.cos(yaw) * Math.cos(pitch) * 10,
      );
    },
"""
s = s[:a] + NEW + s[b:]

CALL = "room.gaze(tThrone, gazeAim, look);"
if w.count(CALL) != 1: sys.exit('ANCHOR FAILED: room.gaze call in world.ts')
w = w.replace(CALL, "room.gaze(tThrone, gazeAim, look, pos);")

for p, raw, crlf, text in [(TR, trraw, trcrlf, s), (WD, wdraw, wdcrlf, w)]:
    p.with_suffix(p.suffix + '.pre-book3.bak').write_bytes(raw.encode('utf-8'))
    p.write_bytes((text.replace('\n', '\r\n') if crlf else text).encode('utf-8'))
    print('patched', p)
print('Now replace src/components/ChatPanel.tsx with the new ChatPanel.tsx. Delete the *.pre-book3.bak files before committing.')
