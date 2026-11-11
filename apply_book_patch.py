"""Run from the project root: python apply_book_patch.py
Camera: never stops (removes the dwell), lectern view ends close enough to read.
Book: throneRoom.ts projects the book's page corners to the screen each frame; world.ts calls it;
styles.css gets the book layout. ChatPanel.tsx is replaced separately (drop-in file).
Checks every anchor first and writes nothing on any mismatch."""
import sys, pathlib

def load(path):
    p = pathlib.Path(path)
    if not p.exists():
        sys.exit(f'MISSING FILE: {path}')
    raw = p.read_bytes().decode('utf-8')
    return p, ('\r\n' in raw), raw.replace('\r\n', '\n')

def apply(path, pairs):
    p, crlf, s = load(path)
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            sys.exit(f'ANCHOR FAILED ({n} matches) in {path}:\n{old[:120]}')
        s = s.replace(old, new)
    return p, (s.replace('\n', '\r\n') if crlf else s)

TR = 'src/scene/throneRoom.ts'
jobs = []

jobs.append(apply(TR, [
("""// Camera route pacing: hold at the contact card for the first part, then move at nearly constant speed.
const ROUTE_DWELL = 0.3;
const routeE = (t: number) => {
  const u = Math.min(1, Math.max(0, (t - ROUTE_DWELL) / (1 - ROUTE_DWELL)));
  return u * 0.65 + u * u * (3 - 2 * u) * 0.35;
};""",
"""// Camera route pacing: always moving. Speed never drops to zero, so every scroll step moves the camera.
const routeE = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * 0.8 + c * c * (3 - 2 * c) * 0.2;
};"""),
("const CAM_END_U = LECT_U - 3.8;", "const CAM_END_U = LECT_U - 1.4;"),
("const CAM_END_Y = BOOK_Y + 2.2;", "const CAM_END_Y = BOOK_Y + 1.5;"),
("const LIGHT_BASE = 50;",
 "const LIGHT_BASE = 50;\n// true: the words live in the DOM panel pinned onto the book; the 3D pages stay blank paper.\nconst BOOK_DOM = true;"),
("""export interface BookState {
  index: number;
  count: number;
  canPrev: boolean;
  canNext: boolean;
}""",
"""export interface BookState {
  index: number;
  count: number;
  canPrev: boolean;
  canNext: boolean;
  turning: boolean;
}"""),
("const detail: BookState = { index: cur, count: pages.length, canPrev: cur > 0, canNext: cur < pages.length - 1 };",
 "const detail: BookState = { index: cur, count: pages.length, canPrev: cur > 0, canNext: cur < pages.length - 1, turning: !!flipping };"),
("    leafF.visible = leafB.visible = true;\n", "    leafF.visible = leafB.visible = true;\n    emit();\n"),
("  if (p.kind === 'blank') return;", "  if (p.kind === 'blank' || BOOK_DOM) return;"),
("""    const lines = wrapText(text, role === 'user' ? FONT_USER : FONT_BODY, PAGE_W_PX - 2 * PAGE_MARGIN);
    const firstIdx = pages.length;
    for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
      pages.push({ kind: role, lines: lines.slice(i, i + LINES_PER_PAGE), first: i === 0, num: pages.length + 1 });
    }""",
"""    const firstIdx = pages.length;
    if (BOOK_DOM) {
      // one blank page per message so the leaf still turns; the DOM panel holds the words
      pages.push({ kind: role, lines: [], first: true, num: pages.length + 1 });
    } else {
      const lines = wrapText(text, role === 'user' ? FONT_USER : FONT_BODY, PAGE_W_PX - 2 * PAGE_MARGIN);
      for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
        pages.push({ kind: role, lines: lines.slice(i, i + LINES_PER_PAGE), first: i === 0, num: pages.length + 1 });
      }
    }"""),
("  update(clock: number, camera: THREE.Vector3): void;\n  dispose(): void;\n}",
 "  update(clock: number, camera: THREE.Vector3): void;\n  /** Project the open book's page corners to screen pixels and publish them as the window event \"book-screen\". */\n  projectBook(camera: THREE.Camera, width: number, height: number): void;\n  dispose(): void;\n}"),
("  const lastCam = new THREE.Vector3();\n",
 """  const lastCam = new THREE.Vector3();
  const bq = new THREE.Vector3();
  const BQX = [-0.72, 0.72, 0.72, -0.72];
  const BQZ = [-0.48, -0.48, 0.48, 0.48];
  const quadNow = [0, 0, 0, 0, 0, 0, 0, 0];
  const quadSent = [0, 0, 0, 0, 0, 0, 0, 0];
  let quadOk: boolean | null = null;
"""),
("    update(clock, camera) {\n      const dt",
 """    projectBook(camera, w, h) {
      B.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      let ok = true;
      for (let i = 0; i < 4; i++) {
        bq.set(BQX[i], 0.12, BQZ[i]);
        B.localToWorld(bq);
        bq.applyMatrix4(camera.matrixWorldInverse);
        if (bq.z > -0.2) ok = false; // behind or too close to the camera
        bq.applyMatrix4(camera.projectionMatrix);
        quadNow[i * 2] = (bq.x * 0.5 + 0.5) * w;
        quadNow[i * 2 + 1] = (-bq.y * 0.5 + 0.5) * h;
      }
      let changed = ok !== quadOk;
      for (let i = 0; i < 8 && !changed; i++) if (Math.abs(quadNow[i] - quadSent[i]) > 0.05) changed = true;
      if (!changed) return;
      quadOk = ok;
      for (let i = 0; i < 8; i++) quadSent[i] = quadNow[i];
      window.dispatchEvent(new CustomEvent('book-screen', { detail: { visible: ok, quad: quadNow.slice() } }));
    },
    update(clock, camera) {
      const dt"""),
]))

jobs.append(apply('src/scene/world.ts', [
("    camera.position.copy(pos);\n    camera.lookAt(look);\n",
 "    camera.position.copy(pos);\n    camera.lookAt(look);\n"
 "    if (tThrone > 0) room.projectBook(camera, canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);\n"),
]))

CSS = r"""
/* ==== Chat on the book (apply_book_patch.py) ==== */
.panel-chat { transform: none !important; transition: opacity 450ms ease-out; align-items: center; padding: 24px; overflow: hidden; }
.book-ui {
  --ink: #e9f4f2; --ink-soft: rgba(233, 244, 242, 0.7); --rule: rgba(127, 245, 230, 0.35);
  --accent: #7ff5e6; --accent-ink: #04201c;
  position: relative; width: min(860px, 100%); margin: 0 auto; padding: 18px; text-align: left; text-shadow: none;
  display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: minmax(0, 1fr); gap: 22px;
  background: linear-gradient(180deg, rgba(8, 14, 24, 0.9), rgba(10, 16, 28, 0.95));
  border: 1px solid rgba(127, 245, 230, 0.5); border-radius: 6px;
}
/* pinned onto the 3D book: a 780x520 sheet that the Stage code warps onto the page corners */
.book-ui.on-book {
  position: absolute; left: 0; top: 0; margin: 0; width: 780px; height: 520px; padding: 0; gap: 22px;
  grid-template-columns: 379px 379px; background: none; border: 0; border-radius: 0; transform-origin: 0 0;
  --ink: #1c1f36; --ink-soft: #3b3f5e; --rule: rgba(28, 31, 54, 0.3); --accent: #1d7f76; --accent-ink: #fff;
}
.book-page { position: relative; display: flex; flex-direction: column; min-height: 0; padding: 30px 28px 22px; color: var(--ink); font-family: Georgia, 'Times New Roman', serif; }
.book-ui:not(.on-book) .book-page { height: min(460px, 64vh); padding: 6px 8px; }
.book-content { flex: 1; min-height: 0; overflow-y: auto; transition: opacity 220ms ease; scrollbar-width: thin; }
.book-content.hidden { opacity: 0; }
.book-ui h2 { margin: 0 0 0.6rem; font-size: 1.35rem; text-align: center; color: var(--ink); }
.book-tag { margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid var(--rule); font: 700 11px/1 system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-soft); }
.book-ui .chat-q { margin: 0; font-style: italic; font-size: 15.5px; line-height: 1.5; color: var(--ink); }
.book-ui .chat-text, .book-ui .chat-lead { margin: 0; font-size: 15.5px; line-height: 1.5; white-space: pre-line; color: var(--ink); }
.book-ui .chat-big { margin: 0 0 6px; font-size: 1.1rem; line-height: 1.4; color: var(--ink); }
.book-ui .chat-hint, .book-ui .chat-wait { margin: 0; font-size: 15px; line-height: 1.5; color: var(--ink-soft); }
.book-ui .chat-wait { font-style: italic; }
.book-ui .chat-rows { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.book-ui .chat-rows li { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }
.book-ui .chat-rows li:last-child { border-bottom: 0; }
.book-ui .chat-row-title { font-size: 14px; font-weight: 700; color: var(--ink); }
.book-ui .chat-row-meta, .book-ui .chat-row-tech { font: 12px/1.4 system-ui, sans-serif; color: var(--ink-soft); }
.book-ui .chat-row-tech { flex-basis: 100%; }
.book-ui .chat-links a { margin-right: 10px; font: 12px system-ui, sans-serif; color: var(--accent); }
.book-ui .chat-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.book-ui .chat-chip { font: 13px system-ui, sans-serif; color: var(--ink); background: transparent; border: 1px solid var(--accent); border-radius: 3px; padding: 5px 9px; cursor: pointer; }
.book-ui .chat-chip:hover:not(:disabled) { background: rgba(127, 245, 230, 0.15); }
.book-ui .chat-chip:disabled, .book-ui .chat-send:disabled, .book-nav button:disabled { opacity: 0.4; cursor: default; }
.book-form { display: flex; align-items: flex-end; gap: 10px; margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--rule); }
.book-form input { flex: 1; min-width: 0; font: 15px system-ui, sans-serif; color: var(--ink); background: transparent; border: 0; border-bottom: 1px solid var(--ink-soft); padding: 6px 2px; }
.book-form input::placeholder { color: var(--ink-soft); }
.book-ui .chat-send { font: 600 13px system-ui, sans-serif; color: var(--accent-ink); background: var(--accent); border: 0; border-radius: 3px; padding: 7px 14px; cursor: pointer; }
.book-nav { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--rule); font: 12px system-ui, sans-serif; color: var(--ink-soft); }
.book-nav button { font: 12px system-ui, sans-serif; color: var(--ink); background: transparent; border: 1px solid var(--rule); border-radius: 3px; padding: 4px 8px; cursor: pointer; }
.book-ui button:focus-visible, .book-ui input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 700px) {
  .book-ui:not(.on-book) { grid-template-columns: 1fr; }
  .book-ui:not(.on-book) .book-left .book-content { display: none; }
  .book-ui:not(.on-book) .book-left { height: auto; }
}
@media (prefers-reduced-motion: reduce) { .book-content, .panel-chat { transition: none; } }
"""

found = sorted(pathlib.Path('src').rglob('styles.css'))
if len(found) != 1:
    sys.exit(f'Expected exactly one styles.css under src, found {len(found)}')
p, crlf, s = load(str(found[0]))
if '/* ==== Chat on the book' in s:
    sys.exit('styles.css already patched')
s = s.rstrip('\n') + '\n' + CSS
jobs.append((p, s.replace('\n', '\r\n') if crlf else s))

for path, text in jobs:
    path.with_suffix(path.suffix + '.pre-book.bak').write_bytes(path.read_bytes())
    path.write_bytes(text.encode('utf-8'))
    print('patched', path)
print('Now replace src/components/ChatPanel.tsx with the ChatPanel.tsx file.')
