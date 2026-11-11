"""Run from the project root: python apply_book_patch4.py
Restores room.projectBook(), which apply_book_patch3.py removed by accident (world.ts calls it every frame).
Checks every anchor, writes nothing on a mismatch."""
import sys, pathlib

TR = pathlib.Path('src/scene/throneRoom.ts')
if not TR.exists():
    sys.exit('MISSING FILE: ' + str(TR))
raw = TR.read_bytes().decode('utf-8')
crlf = '\r\n' in raw
s = raw.replace('\r\n', '\n')

if 'projectBook(camera, width, height) {' in s:
    sys.exit('projectBook is already implemented: nothing to do')
for need in ['const BQX = ', 'const quadSent = ', 'let quadOk: boolean | null']:
    if s.count(need) != 1:
        sys.exit('ANCHOR FAILED (helpers missing): ' + need)
ANCHOR = '    update(clock, camera) {'
if s.count(ANCHOR) != 1:
    sys.exit('ANCHOR FAILED: update method')

NEW = """    projectBook(camera, width, height) {
      // Page corners (top-left, top-right, bottom-right, bottom-left) in screen pixels, for the DOM controls.
      let ok = body.visible;
      if (ok) {
        camera.updateMatrixWorld();
        B.updateWorldMatrix(true, false);
        for (let i = 0; i < 4; i++) {
          bq.set(BQX[i], 0.12, BQZ[i]).applyMatrix4(B.matrixWorld).project(camera);
          if (bq.z < -1 || bq.z > 1) ok = false;
          quadNow[i * 2] = (bq.x * 0.5 + 0.5) * width;
          quadNow[i * 2 + 1] = (0.5 - bq.y * 0.5) * height;
        }
      }
      let changed = ok !== quadOk;
      if (ok) for (let i = 0; i < 8; i++) if (Math.abs(quadNow[i] - quadSent[i]) > 0.05) changed = true;
      if (!changed) return;
      quadOk = ok;
      if (ok) for (let i = 0; i < 8; i++) quadSent[i] = quadNow[i];
      window.dispatchEvent(new CustomEvent('book-screen', { detail: { visible: ok, quad: quadSent.slice() } }));
    },
"""
s = s.replace(ANCHOR, NEW + ANCHOR)
TR.with_suffix('.ts.pre-book4.bak').write_bytes(raw.encode('utf-8'))
TR.write_bytes((s.replace('\n', '\r\n') if crlf else s).encode('utf-8'))
print('patched', TR, '(delete the *.pre-book4.bak before committing)')
