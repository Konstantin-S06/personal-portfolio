"""Run from the project root AFTER apply_book_patch4.py: python apply_book_patch5.py
1. Page footer (rule, Page buttons, input field with typed text and caret, Ask button) is painted on the page textures.
2. Answers are laid out: bold lead line, bullets, small grey detail lines.
3. The words no longer glow while the bot speaks (unreadable), and the glow sprite over the book is dimmed.
Checks every anchor first and writes nothing on any mismatch."""
import sys, pathlib

def load(p):
    p = pathlib.Path(p)
    if not p.exists():
        sys.exit('MISSING FILE: ' + str(p))
    raw = p.read_bytes().decode('utf-8')
    return p, raw, '\r\n' in raw, raw.replace('\r\n', '\n')

TR, trraw, trcrlf, s = load('src/scene/throneRoom.ts')
css = sorted(pathlib.Path('src').rglob('styles.css'))
if len(css) != 1:
    sys.exit('Expected exactly one styles.css under src, found %d' % len(css))
CP, craw, ccrlf, cs = load(css[0])
if '/* ==== Chat book v3' in cs:
    sys.exit('styles.css already has the v3 block')

def rep(old, new):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit('ANCHOR FAILED (%d matches) in throneRoom.ts:\n%s' % (n, old[:140]))
    s = s.replace(old, new)

# ---- fonts ------------------------------------------------------------------------------------------------------
rep(r"""const FONT_USER = 'italic 26px Georgia, "Times New Roman", serif';""",
r"""const FONT_USER = 'italic 26px Georgia, "Times New Roman", serif';
const FONT_LEAD = 'bold 26px Georgia, "Times New Roman", serif';
const FONT_META = '20px system-ui, sans-serif';
const BULLET_IN = 26; // bullet text is indented this far
// Line prefixes (control characters) mark a line's style: 1 lead, 2 bullet start, 3 bullet continuation, 4 detail.""")

# ---- footer + paintPage -----------------------------------------------------------------------------------------
rep(r"""function paintPage(g: CanvasRenderingContext2D, p: Page, glow: boolean) {""",
r"""/** What is typed in the question field. Painted on the right-hand page; the real input is an invisible hit area. */
const inputState = { text: '', focus: false };

/** Footer of every page: left pages carry the two page buttons, right pages the question field and Ask button. */
function drawFooter(g: CanvasRenderingContext2D, p: Page) {
  const W = PAGE_W_PX;
  const M = PAGE_MARGIN;
  const ink = '#1c1f36';
  const rightPage = (p.num - 1) % 2 === 0;
  g.save();
  g.textBaseline = 'alphabetic';
  g.globalAlpha = 0.35;
  g.fillStyle = ink;
  g.fillRect(M, 618, W - 2 * M, 1.5);
  g.globalAlpha = 1;
  if (!rightPage) {
    for (const [x, label] of [[M, '\u2039 Page'], [W - M - 84, 'Page \u203a']] as [number, string][]) {
      g.strokeStyle = 'rgba(28,31,54,0.5)';
      g.lineWidth = 2;
      g.strokeRect(x, 640, 84, 40);
      g.fillStyle = ink;
      g.font = '20px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(label, x + 42, 667);
    }
  } else {
    g.font = '22px system-ui, sans-serif';
    g.textAlign = 'left';
    let shown = inputState.text;
    while (shown && g.measureText(shown).width > 288) shown = shown.slice(1);
    if (shown) {
      g.fillStyle = ink;
      g.fillText(shown, M + 4, 668);
    } else {
      g.fillStyle = 'rgba(28,31,54,0.5)';
      g.fillText('Type a question', M + 4, 668);
    }
    if (inputState.focus) {
      g.fillStyle = ink;
      g.fillRect(M + 4 + (shown ? g.measureText(shown).width + 2 : 0), 646, 2, 26);
    }
    g.fillStyle = 'rgba(28,31,54,0.55)';
    g.fillRect(M, 678, 316, 1.5);
    g.fillStyle = '#2f7f78';
    g.fillRect(W - M - 90, 640, 90, 40);
    g.fillStyle = '#ffffff';
    g.font = 'bold 22px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('Ask', W - M - 45, 667);
  }
  g.restore();
}

function paintPage(g: CanvasRenderingContext2D, p: Page, glow: boolean) {""")

rep("  if (p.kind === 'blank') return;\n",
"  if (p.kind === 'blank') {\n    if (!glow && p.num > 0) drawFooter(g, p);\n    return;\n  }\n")

rep(r"""  let budget = p.reveal;
  const write = (x: number, y0: number) => {
    p.lines.forEach((l, i) => {
      if (budget <= 0) return;
      g.fillText(budget >= l.length ? l : l.slice(0, Math.floor(budget)), x, y0 + i * LINE_H);
      budget -= l.length;
    });
  };
""",
r"""  let budget = p.reveal;
  const write = (x0: number, y0: number) => {
    const baseFont = g.font;
    p.lines.forEach((l, i) => {
      if (budget <= 0) return;
      const k = l.charCodeAt(0);
      const styled = k >= 1 && k <= 4;
      const body = styled ? l.slice(1) : l;
      const n = budget >= l.length ? body.length : Math.max(0, Math.floor(budget) - (styled ? 1 : 0));
      budget -= l.length;
      if (n <= 0) return;
      const y = y0 + i * LINE_H;
      const text = body.slice(0, n);
      if (k === 1) {
        g.font = FONT_LEAD;
        g.fillText(text, x0, y);
      } else if (k === 2 || k === 3) {
        if (k === 2) g.fillText('\u2022', x0 + 4, y);
        g.fillText(text, x0 + BULLET_IN, y);
      } else if (k === 4) {
        g.font = FONT_META;
        g.fillStyle = glow ? col : '#4b5070';
        g.fillText(text, x0 + BULLET_IN, y - 4);
        g.fillStyle = col;
      } else {
        g.fillText(text, x0, y);
      }
      g.font = baseFont;
    });
  };
""")

rep("    write(PAGE_MARGIN, TEXT_TOP + 22);\n  }\n}\n",
    "    write(PAGE_MARGIN, TEXT_TOP + 22);\n  }\n  if (!glow) drawFooter(g, p);\n}\n")

# ---- answer layout ------------------------------------------------------------------------------------------------------
rep("const cleanText = (t: string) =>",
r"""/** Answer text -> styled lines. First paragraph is the lead when bullets follow; "- " is a bullet; "~ " is a detail line. */
function layoutAnswer(text: string, W: number): string[] {
  const out: string[] = [];
  const paras = text.split('\n');
  const lead = paras.some((q) => q.startsWith('- '));
  let first = true;
  for (const para of paras) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    if (para.startsWith('- ')) {
      wrapText(para.slice(2), FONT_BODY, W - BULLET_IN).forEach((l, i) => out.push((i ? '\x03' : '\x02') + l));
    } else if (para.startsWith('~ ')) {
      wrapText(para.slice(2), FONT_META, W - BULLET_IN).forEach((l) => out.push('\x04' + l));
    } else if (first && lead) {
      wrapText(para, FONT_LEAD, W).forEach((l) => out.push('\x01' + l));
    } else {
      out.push(...wrapText(para, FONT_BODY, W));
    }
    first = false;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

const cleanText = (t: string) =>""")

rep("    const lines = wrapText(text, FONT_BODY, W);\n    const head = pages[idx];",
    "    const lines = layoutAnswer(text, W);\n    const head = pages[idx];")

# ---- cache hygiene + right-hand blank pages keep their footer -------------------------------------------------------------
rep("    if (i < 0 || i >= pages.length) return blankTex;",
    "    if (i < 0 || (i >= pages.length && i % 2 !== 0)) return blankTex;")
rep("      t = makePageTex(pages[i]);",
    "      t = makePageTex(i < pages.length ? pages[i] : mkPage({ num: i + 1 }));")
rep("      if (pages.length % 2 === 0) pages.push(mkPage({ num: pages.length + 1 })); // keep every question on a left page",
    "      for (const k of [...cache.keys()]) if (k >= pages.length) dropTex(k);\n      if (pages.length % 2 === 0) pages.push(mkPage({ num: pages.length + 1 })); // keep every question on a left page")
rep("    dropTex(idx);\n    if (rightShown === idx) setRight(idx);",
    "    for (const k of [...cache.keys()]) if (k > idx) dropTex(k);\n    dropTex(idx);\n    if (rightShown === idx) setRight(idx);")

# ---- typed text on the page ------------------------------------------------------------------------------------------------------
rep("""  const refresh = () => {
    setLeft(cur - 1);
    setRight(cur);
  };""",
"""  const repaintInput = () => {
    if (cache.has(cur)) repaint(cur);
  };
  const refresh = () => {
    setLeft(cur - 1);
    setRight(cur);
    repaintInput();
  };""")
rep("  window.addEventListener('book-nav', onNav);\n  refresh();",
"""  const onInput = (e: Event) => {
    const d = (e as CustomEvent<{ text?: string; focus?: boolean }>).detail;
    inputState.text = d && typeof d.text === 'string' ? d.text : '';
    inputState.focus = !!(d && d.focus);
    if (!flipping) repaintInput();
  };
  window.addEventListener('book-input', onInput);
  window.addEventListener('book-nav', onNav);
  refresh();""")
rep("      window.removeEventListener('book-nav', onNav);",
    "      window.removeEventListener('book-nav', onNav);\n      window.removeEventListener('book-input', onInput);")

# ---- glow ------------------------------------------------------------------------------------------------------------------------------------
rep("      const bp = 1 + 0.1 * Math.sin(clock * 3.2);\n      leftGlow.opacity = rightGlow.opacity = Math.min(1, 0.03 + 0.9 * bookLevel * bp);",
    "      leftGlow.opacity = rightGlow.opacity = 0; // lit words were unreadable on the pale paper; the book still glows around the edges")
rep("      bookGlowM.opacity = 0.55 * bookLevel;", "      bookGlowM.opacity = 0.1 * bookLevel;")

# ---- css ----------------------------------------------------------------------------------------------------------------------------------------
CSS = """
/* ==== Chat book v3: the controls are invisible hit areas over the footer painted on the pages (apply_book_patch5.py) ==== */
.book-ui .bk-row { display: flex; gap: 8px; align-items: flex-end; margin-top: 8px; }
.book-ui .bk-btn, .book-ui .bk-ask { cursor: pointer; font: inherit; padding: 6px 12px; }
.book-ui .bk-input { flex: 1; min-width: 0; font: inherit; padding: 6px; }
.book-ui.on-book .bk-row { display: contents; }
.book-ui.on-book .book-page { position: static; }
.book-ui.on-book .bk-btn, .book-ui.on-book .bk-ask, .book-ui.on-book .bk-input {
  position: absolute; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent;
  color: transparent; caret-color: transparent; opacity: 0; outline: none; box-sizing: border-box;
}
.book-ui.on-book .bk-btn:focus-visible, .book-ui.on-book .bk-ask:focus-visible { opacity: 1; background: rgba(47, 127, 120, 0.18); outline: 2px solid #2f7f78; }
.book-ui.on-book .bk-input:focus-visible { opacity: 0.001; }
.book-ui.on-book .bk-prev { left: 32.6px; top: 472.7px; width: 62.2px; height: 29.5px; }
.book-ui.on-book .bk-next { left: 284.2px; top: 472.7px; width: 62.2px; height: 29.5px; }
.book-ui.on-book .bk-input { left: 433.4px; top: 469px; width: 233.8px; height: 33px; }
.book-ui.on-book .bk-ask { left: 680.5px; top: 472.7px; width: 66.6px; height: 29.5px; }
.book-ui.on-book.turning .bk-btn, .book-ui.on-book.turning .bk-ask, .book-ui.on-book.turning .bk-input { pointer-events: none; }
.book-ui.on-book .book-extras { position: absolute; left: 433px; width: 314px; bottom: 70px; margin: 0; }
.book-ui.on-book .chat-chip {
  cursor: pointer; font: 13px/1.25 system-ui, sans-serif; padding: 4px 8px; color: #1c1f36;
  background: transparent; border: 1px solid rgba(28, 31, 54, 0.45); border-radius: 3px;
}
.book-ui.on-book .chat-chip:hover:not(:disabled) { background: rgba(28, 31, 54, 0.08); }
.book-ui.on-book .book-links { color: #1c1f36; }
.book-ui.on-book .book-links a { color: #2f7f78; }
"""
cs = cs.rstrip('\n') + '\n' + CSS

TR.with_suffix('.ts.pre-book5.bak').write_bytes(trraw.encode('utf-8'))
TR.write_bytes((s.replace('\n', '\r\n') if trcrlf else s).encode('utf-8'))
CP.with_suffix('.css.pre-book5.bak').write_bytes(craw.encode('utf-8'))
CP.write_bytes((cs.replace('\n', '\r\n') if ccrlf else cs).encode('utf-8'))
print('patched', TR, 'and', CP)
print('Now replace src/components/ChatPanel.tsx with the new ChatPanel.tsx. Delete the *.pre-book5.bak files before committing.')
