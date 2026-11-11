"""Run from the project root AFTER apply_book_patch.py: python apply_book_patch2.py
1. Camera: the last turn onto the book no longer flicks (aims at a fixed final direction, not the live book position).
2. Book: one question + its answer share one spread, so one question = one page turn.
3. Book: words are painted on the page textures again, so they turn with the leaf. The DOM keeps only the input,
   page buttons, chips and links.
Checks every anchor first and writes nothing on any mismatch."""
import re, sys, pathlib

TR = pathlib.Path('src/scene/throneRoom.ts')
if not TR.exists():
    sys.exit('MISSING FILE: src/scene/throneRoom.ts')
raw = TR.read_bytes().decode('utf-8')
crlf = '\r\n' in raw
s = raw.replace('\r\n', '\n')

def once(old):
    n = s.count(old)
    if n != 1:
        sys.exit(f'ANCHOR FAILED ({n} matches) in throneRoom.ts:\n{old[:130]}')

def rep(old, new):
    global s
    once(old)
    s = s.replace(old, new)

def swap(start, end, new, consume_end=False):
    global s
    once(start)
    i = s.find(start)
    j = s.find(end, i)
    if j < 0:
        sys.exit(f'END MARKER NOT FOUND after: {start[:60]}')
    if consume_end:
        j += len(end)
    s = s[:i] + new + s[j:]

# ---- constants ------------------------------------------------------------------------------------------------
rep("const LIGHT_BASE = 50;\n// true: the words live in the DOM panel pinned onto the book; the 3D pages stay blank paper.\nconst BOOK_DOM = true;",
    "const LIGHT_BASE = 50;")
rep("const LINES_PER_PAGE = 16;", "const LINES_PER_PAGE = 11; // the foot of each page is left free for the input, buttons and chips")

# ---- page types -------------------------------------------------------------------------------------------------
swap("interface Page {", "const measureCtx", """interface Page {
  kind: 'blank' | 'title' | Role;
  lines: string[];
  first: boolean;
  num: number;
  /** Characters shown so far (Infinity = all). Drives the writing-in effect for answers. */
  reveal: number;
  /** Index of the exchange this page starts the answer for, else -1. */
  answer: number;
  /** Placeholder shown between sending a question and the answer arriving. */
  pending: boolean;
}
interface PageTex {
  ink: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
  ci: CanvasRenderingContext2D;
  cg: CanvasRenderingContext2D;
}

export interface BookState {
  /** Spread number: 0 is the title page, 1 the first question and answer, and so on. */
  index: number;
  count: number;
  canPrev: boolean;
  canNext: boolean;
  turning: boolean;
  /** Exchange whose answer starts on the right page of this spread, else -1. */
  answer: number;
}

""")

# ---- painting -----------------------------------------------------------------------------------------------------
swap("function paintPage(", "\n// ====", """function paintPage(g: CanvasRenderingContext2D, p: Page, glow: boolean) {
  const W = PAGE_W_PX;
  const H = PAGE_H_PX;
  g.clearRect(0, 0, W, H);
  if (!glow) {
    g.fillStyle = '#aeb4cb';
    g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10,12,30,0.35)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }
  if (p.kind === 'blank') return;
  const col = glow ? '#7ff5e4' : '#1c1f36';
  g.fillStyle = col;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  let budget = p.reveal;
  const write = (x: number, y0: number) => {
    p.lines.forEach((l, i) => {
      if (budget <= 0) return;
      g.fillText(budget >= l.length ? l : l.slice(0, Math.floor(budget)), x, y0 + i * LINE_H);
      budget -= l.length;
    });
  };
  if (p.kind === 'title') {
    g.font = 'bold 40px Georgia, "Times New Roman", serif';
    g.textAlign = 'center';
    g.fillText('Questions', W / 2, 104);
    g.fillRect(PAGE_MARGIN + 80, 128, W - 2 * PAGE_MARGIN - 160, 2);
    g.textAlign = 'left';
    g.font = FONT_BODY;
    write(PAGE_MARGIN, 200);
  } else {
    g.font = 'bold 20px system-ui, sans-serif';
    g.fillText((p.kind === 'user' ? 'YOU' : 'ANSWER') + (p.first ? '' : ' (CONTINUED)'), PAGE_MARGIN, 62);
    g.fillRect(PAGE_MARGIN, 76, W - 2 * PAGE_MARGIN, 2);
    g.font = p.kind === 'user' || p.pending ? FONT_USER : FONT_BODY;
    write(PAGE_MARGIN, TEXT_TOP + 22);
  }
}

function makePageTex(p: Page): PageTex {
  const mk = (glow: boolean) => {
    const c = document.createElement('canvas');
    c.width = PAGE_W_PX;
    c.height = PAGE_H_PX;
    const g = c.getContext('2d')!;
    paintPage(g, p, glow);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { t, g };
  };
  const a = mk(false);
  const b = mk(true);
  return { ink: a.t, glow: b.t, ci: a.g, cg: b.g };
}
""")

# ---- book state: spreads, one turn per exchange ------------------------------------------------------------------------
swap("  // ---- chat book state", "  window.addEventListener('book-nav', onNav);\n  refresh();\n  emit();\n", """  // ---- chat book state: a spread shows pages[cur] on the right and pages[cur - 1] on the left; cur is always even.
  // One question and its answer share a spread (question left, answer right), so one question is one page turn.
  const mkPage = (o: Partial<Page>): Page => ({ kind: 'blank', lines: [], first: true, num: 0, reveal: Infinity, answer: -1, pending: false, ...o });
  const blankTex = makePageTex(mkPage({}));
  const pages: Page[] = [
    mkPage({
      kind: 'title',
      num: 1,
      lines: ['Ask about the projects, the', 'stack or the background.', '', 'Write your question below.', 'Each answer is written here.'],
    }),
  ];
  const cache = new Map<number, PageTex>();
  let cur = 0;
  let target = 0;
  let exchanges = 0;
  let pendingIdx = -1;
  let revealing = -1;
  let leftShown = -2;
  let rightShown = -2;
  let flipping: { dir: 1 | -1; t: number; dur: number } | null = null;
  let mirrored: THREE.CanvasTexture | null = null;

  const lastCur = () => ((pages.length - 1) % 2 === 0 ? pages.length - 1 : pages.length);
  const texFor = (i: number): PageTex => {
    if (i < 0 || i >= pages.length) return blankTex;
    let t = cache.get(i);
    if (!t) {
      t = makePageTex(pages[i]);
      cache.set(i, t);
    }
    return t;
  };
  const setMap = (m: THREE.MeshBasicMaterial, t: THREE.Texture | null) => {
    if (m.map !== t) {
      m.map = t;
      m.needsUpdate = true;
    }
  };
  const setLeft = (i: number) => {
    leftShown = i;
    const t = texFor(i);
    setMap(leftInk, t.ink);
    setMap(leftGlow, t.glow);
  };
  const setRight = (i: number) => {
    rightShown = i;
    const t = texFor(i);
    setMap(rightInk, t.ink);
    setMap(rightGlow, t.glow);
  };
  const dropTex = (i: number) => {
    const t = cache.get(i);
    if (t) {
      t.ink.dispose();
      t.glow.dispose();
      cache.delete(i);
    }
  };
  const prune = () => {
    for (const k of [...cache.keys()]) if (k < cur - 5 || k > cur + 5) dropTex(k);
  };
  const repaint = (i: number) => {
    const t = cache.get(i);
    if (!t) return;
    paintPage(t.ci, pages[i], false);
    paintPage(t.cg, pages[i], true);
    t.ink.needsUpdate = true;
    t.glow.needsUpdate = true;
  };
  const emit = () => {
    const last = lastCur();
    const detail: BookState = {
      index: cur / 2,
      count: last / 2 + 1,
      canPrev: cur > 0,
      canNext: cur < last,
      turning: !!flipping,
      answer: pages[cur]?.answer ?? -1,
    };
    window.dispatchEvent(new CustomEvent('book-state', { detail }));
  };
  const refresh = () => {
    setLeft(cur - 1);
    setRight(cur);
  };
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const mirrorOf = (t: THREE.CanvasTexture) => {
    const c = t.clone();
    c.wrapS = THREE.RepeatWrapping;
    c.repeat.x = -1;
    c.offset.x = 1;
    c.colorSpace = THREE.SRGBColorSpace;
    c.needsUpdate = true;
    return c;
  };

  const pump = () => {
    if (flipping || cur === target) return;
    const dir: 1 | -1 = target > cur ? 1 : -1;
    if (reduceMotion()) {
      cur += dir * 2;
      refresh();
      prune();
      emit();
      pump();
      return;
    }
    const dur = Math.abs(target - cur) > 2 ? 0.45 : 1.2;
    // forward: the leaf carries the right page over to the left; its back is the new left page; the new right page waits underneath.
    // backward: the leaf carries the left page over to the right; its front is the new right page; the new left page waits underneath.
    const front = dir > 0 ? texFor(cur) : texFor(cur - 2);
    const back = dir > 0 ? texFor(cur + 1) : texFor(cur - 1);
    setMap(frontMat, front.ink);
    if (mirrored) mirrored.dispose();
    mirrored = mirrorOf(back.ink);
    setMap(backMat, mirrored);
    if (dir > 0) setRight(cur + 2);
    else setLeft(cur - 3);
    flipping = { dir, t: 0, dur };
    poseFlip(dir > 0 ? 0 : Math.PI);
    leafF.visible = leafB.visible = true;
    emit();
  };
  const endFlip = () => {
    if (!flipping) return;
    cur += flipping.dir * 2;
    flipping = null;
    leafF.visible = leafB.visible = false;
    refresh();
    if (mirrored) {
      mirrored.dispose();
      mirrored = null;
    }
    prune();
    emit();
    pump();
  };
  const goTo = (i: number) => {
    let t = Math.max(0, Math.min(lastCur(), i));
    if (t % 2) t -= 1;
    target = t;
    pump();
  };

  const tickReveal = (dt: number) => {
    if (revealing < 0) return;
    const p = pages[revealing];
    if (!p || !Number.isFinite(p.reveal)) {
      revealing = -1;
      return;
    }
    const total = p.lines.reduce((n, l) => n + l.length, 0);
    const before = Math.floor(p.reveal / 3);
    p.reveal += dt * 100;
    if (p.reveal >= total) {
      p.reveal = Infinity;
      repaint(revealing);
      revealing = -1;
    } else if (Math.floor(p.reveal / 3) !== before) {
      repaint(revealing);
    }
  };

  const onMessage = (e: Event) => {
    const d = (e as CustomEvent<{ role?: string; text?: string }>).detail;
    const text = d && typeof d.text === 'string' ? cleanText(d.text) : '';
    if (!text) return;
    const W = PAGE_W_PX - 2 * PAGE_MARGIN;
    if (d.role === 'user') {
      if (pages.length % 2 === 0) pages.push(mkPage({ num: pages.length + 1 })); // keep every question on a left page
      pages.push(mkPage({ kind: 'user', num: pages.length + 1, lines: wrapText(text, FONT_USER, W).slice(0, LINES_PER_PAGE) }));
      pendingIdx = pages.length;
      pages.push(mkPage({ kind: 'assistant', num: pages.length + 1, lines: ['Thinking...'], pending: true, answer: exchanges }));
      exchanges++;
      emit();
      goTo(pendingIdx);
      return;
    }
    if (pendingIdx < 0) return;
    const idx = pendingIdx;
    pendingIdx = -1;
    const lines = wrapText(text, FONT_BODY, W);
    const head = pages[idx];
    head.pending = false;
    head.lines = lines.slice(0, LINES_PER_PAGE);
    head.reveal = reduceMotion() ? Infinity : 0;
    for (let i = LINES_PER_PAGE; i < lines.length; i += LINES_PER_PAGE) {
      pages.push(mkPage({ kind: 'assistant', num: pages.length + 1, lines: lines.slice(i, i + LINES_PER_PAGE), first: false }));
    }
    dropTex(idx);
    if (rightShown === idx) setRight(idx);
    if (leftShown === idx) setLeft(idx);
    revealing = Number.isFinite(head.reveal) ? idx : -1;
    emit();
  };
  const onReset = () => {
    pages.length = 1;
    cur = 0;
    target = 0;
    exchanges = 0;
    pendingIdx = -1;
    revealing = -1;
    flipping = null;
    leafF.visible = leafB.visible = false;
    for (const k of [...cache.keys()]) dropTex(k);
    if (mirrored) {
      mirrored.dispose();
      mirrored = null;
    }
    refresh();
    emit();
  };
  const onNav = (e: Event) => {
    const d = (e as CustomEvent<string>).detail;
    if (d === 'prev') goTo(target - 2);
    else if (d === 'next') goTo(target + 2);
    else if (d === 'first') goTo(0);
    else if (d === 'last') goTo(lastCur());
    else if (d === 'query') emit();
  };
  window.addEventListener('chat-message', onMessage);
  window.addEventListener('chat-reset', onReset);
  window.addEventListener('book-nav', onNav);
  refresh();
  emit();
""", consume_end=True)

rep("      if (flipping) {\n        flipping.t += dt;", "      tickReveal(dt);\n      if (flipping) {\n        flipping.t += dt;")

# ---- camera: no flick at the end ------------------------------------------------------------------------------------------
rep("      blendAim(gzD, bookWorld, smooth(0.7, 1.0, t), out);",
"""      // Stage 2 turns toward the direction the FINAL camera spot sees the book from. That direction is a constant, so the
      // turn rate follows the easing only. Aiming at the book from the live camera swings very fast in the last metre.
      aimYawPitch(gzD, endYaw, endPitch, smooth(0.4, 1.0, t), out);""")
rep("  const gzC = new THREE.Vector3();\n",
"""  const gzC = new THREE.Vector3();
  const endDirV = new THREE.Vector3().subVectors(bookWorld, toWorld(CAM_END_U, 0, CAM_END_Y));
  const endYaw = Math.atan2(endDirV.x, endDirV.z);
  const endPitch = Math.atan2(endDirV.y, Math.hypot(endDirV.x, endDirV.z));
  const aimYawPitch = (A: THREE.Vector3, yaw1: number, pitch1: number, k: number, out: THREE.Vector3) => {
    const a = gzA.subVectors(A, lastCam);
    const ya = Math.atan2(a.x, a.z);
    let dy = yaw1 - ya;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const pa = Math.atan2(a.y, Math.hypot(a.x, a.z));
    const yaw = ya + dy * k;
    const pitch = pa + (pitch1 - pa) * k;
    out.set(
      lastCam.x + Math.sin(yaw) * Math.cos(pitch) * 10,
      lastCam.y + Math.sin(pitch) * 10,
      lastCam.z + Math.cos(yaw) * Math.cos(pitch) * 10,
    );
  };
""")

# ---- css ------------------------------------------------------------------------------------------------------------------------
CSS = """
/* ==== Chat book v2: text lives on the page textures; the DOM keeps only the controls (apply_book_patch2.py) ==== */
.book-ui.on-book .book-page { justify-content: flex-end; padding: 0 28px 22px; }
.book-extras { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; transition: opacity 200ms ease; }
.book-extras.hidden { opacity: 0; pointer-events: none; }
.book-extras .chat-chips { margin-top: 0; }
.book-links { display: flex; flex-wrap: wrap; gap: 4px 12px; font: 12px/1.3 system-ui, sans-serif; color: var(--ink-soft); }
.book-links a { color: var(--accent); border-bottom: 1px solid currentColor; text-decoration: none; }
"""
css_files = sorted(pathlib.Path('src').rglob('styles.css'))
if len(css_files) != 1:
    sys.exit(f'Expected exactly one styles.css under src, found {len(css_files)}')
cp = css_files[0]
craw = cp.read_bytes().decode('utf-8')
c_crlf = '\r\n' in craw
cs = craw.replace('\r\n', '\n')
if '/* ==== Chat book v2' in cs:
    sys.exit('styles.css already has the v2 block')
if '/* ==== Chat on the book' not in cs:
    sys.exit('styles.css is missing the first book block: run apply_book_patch.py first')
cs = cs.rstrip('\n') + '\n' + CSS

TR.with_suffix('.ts.pre-book2.bak').write_bytes(raw.encode('utf-8'))
TR.write_bytes((s.replace('\n', '\r\n') if crlf else s).encode('utf-8'))
cp.with_suffix('.css.pre-book2.bak').write_bytes(craw.encode('utf-8'))
cp.write_bytes((cs.replace('\n', '\r\n') if c_crlf else cs).encode('utf-8'))
print('patched', TR, 'and', cp)
print('Now replace src/components/ChatPanel.tsx with the new ChatPanel.tsx.')
