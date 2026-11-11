"""Usage: python patch_chatpanel.py path\\to\\ChatPanel.tsx
Checks every anchor first and writes nothing if any is missing. Keeps CRLF line endings."""
import sys
p = sys.argv[1]
raw = open(p, 'rb').read().decode('utf-8')
crlf = '\r\n' in raw
s = raw.replace('\r\n', '\n')

edits = [
("import { API_BASE_URL as API_BASE } from '../config';\n",
 "import { API_BASE_URL as API_BASE } from '../config';\nimport { announceChatMessage, turnBook, type BookState } from '../scene/throneRoom'; // adjust path if needed\n"),

("function setSpeaking(on: boolean) {",
 """/** What gets written into the book: the answer plus one line per project row. */
function bookText(m: BotMsg): string {
  const rows = m.items.map((it) => '- ' + [it.title, [it.category, it.date].filter(Boolean).join(', ')].filter(Boolean).join(' (') + (it.category || it.date ? ')' : ''));
  return [m.text, ...rows].join('\\n');
}

function setSpeaking(on: boolean) {"""),

("  const logRef = useRef<HTMLDivElement>(null);\n",
 """  const logRef = useRef<HTMLDivElement>(null);
  const [book, setBook] = useState<BookState>({ index: 0, count: 1, canPrev: false, canNext: false });

  useEffect(() => {
    const on = (e: Event) => setBook((e as CustomEvent<BookState>).detail);
    window.addEventListener('book-state', on);
    window.dispatchEvent(new CustomEvent('book-nav', { detail: 'query' }));
    return () => window.removeEventListener('book-state', on);
  }, []);
"""),

("    setLog((l) => [...l, msg]);\n",
 "    setLog((l) => [...l, msg]);\n    announceChatMessage('assistant', bookText(msg));\n"),

("    setLog((l) => [...l, { role: 'user', text: question }]);\n",
 "    setLog((l) => [...l, { role: 'user', text: question }]);\n    announceChatMessage('user', question);\n"),

("""            <span className={`chat-status${busy ? ' on' : ''}`} aria-hidden="true" />\n""",
 """            <span className={`chat-status${busy ? ' on' : ''}`} aria-hidden="true" />
            <span className="chat-book-nav">
              <button type="button" className="chat-chip" onClick={() => turnBook('prev')} disabled={!book.canPrev} aria-label="Previous page of the book">
                ‹ Page
              </button>
              <button type="button" className="chat-chip" onClick={() => turnBook('next')} disabled={!book.canNext} aria-label="Next page of the book">
                Page ›
              </button>
            </span>
"""),
]
for old, new in edits:
    if s.count(old) != 1:
        sys.exit('ANCHOR MISMATCH, nothing written:\n' + old[:80])
for old, new in edits:
    s = s.replace(old, new)
if crlf:
    s = s.replace('\n', '\r\n')
open(p, 'wb').write(s.encode('utf-8'))
print('patched', p)
