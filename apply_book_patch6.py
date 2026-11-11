"""Run from the project root AFTER apply_book_patch5.py: python apply_book_patch6.py
1. The first spread's blank left page now gets its painted Page buttons (they vanished when you returned to page 1).
2. Painted Page buttons dim when they cannot be used (no previous page / no next page); the real buttons are never disabled.
3. More room for text: smaller type, smaller margins, 17 lines per page (was 11). A "continued" note is painted at the
   foot of any page whose answer runs on.
4. Camera finishes closer to the book.
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
if '/* ==== Chat book v3' not in cs:
    sys.exit('styles.css is missing the v3 block: run apply_book_patch5.py first')
if '/* ==== Chat book v4' in cs:
    sys.exit('styles.css already has the v4 block')

def rep(old, new):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit('ANCHOR FAILED (%d matches) in throneRoom.ts:\n%s' % (n, old[:140]))
    s = s.replace(old, new)

# ---- sizes ------------------------------------------------------------------------------------------------------
rep("const PAGE_MARGIN = 44;", "const PAGE_MARGIN = 28;")
rep("const LINE_H = 33;", "const LINE_H = 27;")
rep("const TEXT_TOP = 118;", "const TEXT_TOP = 60;")
rep("const LINES_PER_PAGE = 11;", "const LINES_PER_PAGE = 17;")
rep("""const FONT_BODY = '26px Georgia, "Times New Roman", serif';""", """const FONT_BODY = '21px Georgia, "Times New Roman", serif';""")
rep("""const FONT_USER = 'italic 26px Georgia, "Times New Roman", serif';""", """const FONT_USER = 'italic 21px Georgia, "Times New Roman", serif';""")
rep("""const FONT_LEAD = 'bold 26px Georgia, "Times New Roman", serif';""", """const FONT_LEAD = 'bold 21px Georgia, "Times New Roman", serif';""")
rep("const FONT_META = '20px system-ui, sans-serif';", "const FONT_META = '16px system-ui, sans-serif';")
rep("const BULLET_IN = 26;", "const BULLET_IN = 20;")
rep("""    g.font = 'bold 20px system-ui, sans-serif';
    g.fillText((p.kind === 'user' ? 'YOU' : 'ANSWER') + (p.first ? '' : ' (CONTINUED)'), PAGE_MARGIN, 62);
    g.fillRect(PAGE_MARGIN, 76, W - 2 * PAGE_MARGIN, 2);""",
"""    g.font = 'bold 16px system-ui, sans-serif';
    g.fillText((p.kind === 'user' ? 'YOU' : 'ANSWER') + (p.first ? '' : ' (CONTINUED)'), PAGE_MARGIN, 42);
    g.fillRect(PAGE_MARGIN, 52, W - 2 * PAGE_MARGIN, 1.5);""")

# ---- page type: "this answer continues" -------------------------------------------------------------------------------
rep("""  /** Placeholder shown between sending a question and the answer arriving. */
  pending: boolean;
}""", """  /** Placeholder shown between sending a question and the answer arriving. */
  pending: boolean;
  /** The answer carries on onto the next page: a note is painted at the foot. */
  more: boolean;
}""")
rep("answer: -1, pending: false, ...o });", "answer: -1, pending: false, more: false, ...o });")
rep("    for (const k of [...cache.keys()]) if (k > idx) dropTex(k);\n    dropTex(idx);",
    "    for (let k = idx; k < pages.length - 1; k++) pages[k].more = true;\n    for (const k of [...cache.keys()]) if (k > idx) dropTex(k);\n    dropTex(idx);")

# ---- footer ------------------------------------------------------------------------------------------------------------------
a = s.find("/** Footer of every page: left pages carry the two page buttons")
b = s.find("function paintPage(g: CanvasRenderingContext2D, p: Page, glow: boolean) {")
if s.count("/** Footer of every page:") != 1 or a < 0 or b < a:
    sys.exit('ANCHOR FAILED: footer block')
NEWFOOT = r"""const FOOT_M = 28;
/** Which Page buttons can be used on the spread on screen; unusable ones are painted dimmed. */
const navState = { prev: false, next: false };

/** Footer of every page: left pages carry the two page buttons, right pages the question field and Ask button. */
function drawFooter(g: CanvasRenderingContext2D, p: Page) {
  const W = PAGE_W_PX;
  const M = FOOT_M;
  const ink = '#1c1f36';
  const rightPage = (p.num - 1) % 2 === 0;
  g.save();
  g.textBaseline = 'alphabetic';
  if (p.more && p.reveal === Infinity) {
    g.fillStyle = '#4b5070';
    g.font = 'italic 15px Georgia, "Times New Roman", serif';
    g.textAlign = 'right';
    g.fillText(rightPage ? 'continued on the next page \u203a' : 'continued on the facing page \u203a', W - M, 629);
  }
  g.globalAlpha = 0.35;
  g.fillStyle = ink;
  g.fillRect(M, 636, W - 2 * M, 1.5);
  g.globalAlpha = 1;
  if (!rightPage) {
    for (const [x, label, on] of [[M, '\u2039 Page', navState.prev], [W - M - 84, 'Page \u203a', navState.next]] as [number, string, boolean][]) {
      g.globalAlpha = on ? 1 : 0.3;
      g.strokeStyle = 'rgba(28,31,54,0.6)';
      g.lineWidth = 2;
      g.strokeRect(x, 650, 84, 38);
      g.fillStyle = ink;
      g.font = '19px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(label, x + 42, 675);
    }
    g.globalAlpha = 1;
  } else {
    g.font = '20px system-ui, sans-serif';
    g.textAlign = 'left';
    let shown = inputState.text;
    while (shown && g.measureText(shown).width > 330) shown = shown.slice(1);
    if (shown) {
      g.fillStyle = ink;
      g.fillText(shown, M + 4, 676);
    } else {
      g.fillStyle = 'rgba(28,31,54,0.5)';
      g.fillText('Type a question', M + 4, 676);
    }
    if (inputState.focus) {
      g.fillStyle = ink;
      g.fillRect(M + 4 + (shown ? g.measureText(shown).width + 2 : 0), 656, 2, 24);
    }
    g.fillStyle = 'rgba(28,31,54,0.55)';
    g.fillRect(M, 686, 346, 1.5);
    g.fillStyle = '#2f7f78';
    g.fillRect(W - M - 92, 650, 92, 38);
    g.fillStyle = '#ffffff';
    g.font = 'bold 20px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('Ask', W - M - 46, 675);
  }
  g.restore();
}

"""
s = s[:a] + NEWFOOT + s[b:]

# the blank left page of the first spread gets a footer too
rep("    if (!glow && p.num > 0) drawFooter(g, p);", "    if (!glow) drawFooter(g, p);")
rep("  const blankTex = makePageTex(mkPage({}));", "  const blankPage = mkPage({});\n  const blankTex = makePageTex(blankPage);")

# ---- keep the painted Page buttons in step with the book -----------------------------------------------------------------------------------
rep("""  const refresh = () => {
    setLeft(cur - 1);
    setRight(cur);
    repaintInput();
  };""",
"""  const repaintNav = () => {
    navState.prev = cur > 0;
    navState.next = cur < lastCur();
    if (cur - 1 < 0) {
      paintPage(blankTex.ci, blankPage, false);
      blankTex.ink.needsUpdate = true;
    } else {
      repaint(cur - 1);
    }
  };
  const refresh = () => {
    setLeft(cur - 1);
    setRight(cur);
    repaintInput();
    repaintNav();
  };""")
rep("    window.dispatchEvent(new CustomEvent('book-state', { detail }));\n  };",
    "    window.dispatchEvent(new CustomEvent('book-state', { detail }));\n    repaintNav();\n  };")

# ---- camera: closer to the book -------------------------------------------------------------------------------------------------------------------
rep("const CAM_END_U = LECT_U - 1.4;", "const CAM_END_U = LECT_U - 1.1;")
rep("const CAM_END_Y = BOOK_Y + 1.5;", "const CAM_END_Y = BOOK_Y + 1.25;")

# ---- css: hit areas follow the new footer ---------------------------------------------------------------------------------------------------------------
CSS = """
/* ==== Chat book v4: hit areas follow the new footer; Page buttons always clickable (apply_book_patch6.py) ==== */
.book-ui.on-book .bk-prev { left: 20.7px; top: 480.1px; width: 62.2px; height: 28.1px; }
.book-ui.on-book .bk-next { left: 296.2px; top: 480.1px; width: 62.2px; height: 28.1px; }
.book-ui.on-book .bk-input { left: 421.5px; top: 477px; width: 256.3px; height: 34px; }
.book-ui.on-book .bk-ask { left: 691.1px; top: 480.1px; width: 68.1px; height: 28.1px; }
.book-ui.on-book.turning .bk-btn { pointer-events: auto; }
.book-ui.on-book .book-extras { left: 421px; width: 337px; bottom: 68px; }
.book-ui.on-book .chat-chip { font-size: 12px; padding: 3px 7px; }
"""
cs = cs.rstrip('\n') + '\n' + CSS

TR.with_suffix('.ts.pre-book6.bak').write_bytes(trraw.encode('utf-8'))
TR.write_bytes((s.replace('\n', '\r\n') if trcrlf else s).encode('utf-8'))
CP.with_suffix('.css.pre-book6.bak').write_bytes(craw.encode('utf-8'))
CP.write_bytes((cs.replace('\n', '\r\n') if ccrlf else cs).encode('utf-8'))
print('patched', TR, 'and', CP)
print('Now replace src/components/ChatPanel.tsx with the new ChatPanel.tsx. Delete the *.pre-book6.bak files before committing.')
