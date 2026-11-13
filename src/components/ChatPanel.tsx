import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { API_BASE_URL as API_BASE } from '../config';

const MAX_LEN = 300;
// Keep in sync with STATIC_SUGGESTIONS in backend/chat_intents.py (a backend test checks the three are answered).
const SUGGESTIONS = ['How many projects use Python?', 'Which projects are featured?', 'What did you build with Flask?'];
const MAX_ITEMS = 12;
// Logical size of the two-page sheet. The scene projects the book's page corners; this sheet is warped onto them.
const BOOK_W = 780;
const BOOK_H = 520;

type Kind = 'list' | 'count' | 'text' | 'refusal';

interface ChatItem {
  title: string;
  tech: string[];
  category: string | null;
  date: string | null;
  github: string | null;
  demo: string | null;
}

interface BotMsg {
  kind: Kind;
  text: string;
  /** Short model-written paragraph shown under the lead line; null when the server sent none. */
  prose: string | null;
  items: ChatItem[];
  suggestions: string[];
}

/** Mirrors the scene's "book-state" event. */
interface BookState {
  index: number;
  count: number;
  canPrev: boolean;
  canNext: boolean;
  turning: boolean;
  answer: number;
}

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const setSpeaking = (on: boolean) => emit('chat-speaking', on);

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const safeUrl = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https?:\/\/\S+$/i.test(s) ? s : null;
};

function parseItems(v: unknown): ChatItem[] {
  if (!Array.isArray(v)) return [];
  const out: ChatItem[] = [];
  for (const raw of v.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const title = str(r.title);
    if (!title) continue;
    out.push({
      title,
      tech: Array.isArray(r.tech_stack) ? r.tech_stack.filter((t): t is string => typeof t === 'string').slice(0, 8) : [],
      category: str(r.category),
      date: str(r.date),
      github: safeUrl(r.github_url),
      demo: safeUrl(r.demo_url),
    });
  }
  return out;
}

/** Turns whatever the server sent into a BotMsg. Old servers (answer only) become plain text. */
function parseReply(data: Record<string, unknown>, fallbackText: string): BotMsg {
  const kinds: Kind[] = ['list', 'count', 'text', 'refusal'];
  const kind = kinds.includes(data.kind as Kind) ? (data.kind as Kind) : 'text';
  const text = str(data.answer) ?? str(data.error) ?? fallbackText;
  const suggestions = Array.isArray(data.suggestions)
    ? data.suggestions.filter((s): s is string => typeof s === 'string' && s.length <= MAX_LEN).slice(0, 3)
    : [];
  return { kind, text, prose: str(data.prose)?.slice(0, 600) ?? null, items: parseItems(data.items), suggestions };
}

/** What the book page shows for an answer: the text, then one line per project. */
const pageText = (m: BotMsg) => {
  // The scene lays this out: "^ " is a bold heading line, "- " starts a bullet, "~ " is a small detail line.
  // With a paragraph: paragraph first, then a heading, then the project list (a single project card is not repeated).
  const lines = m.text.split('\n');
  const out: string[] = [];
  if (m.prose) {
    if (m.items.length > 1) out.push(m.prose, '', `^ ${lines[0]}`, ...lines.slice(1));
    else out.push(`^ ${lines[0]}`, m.prose, '', ...lines.slice(1));
  } else {
    out.push(m.text);
  }
  const listed = m.prose && m.items.length === 1 ? [] : m.items;
  if (listed.length) {
    if (!m.prose) out.push('');
    for (const it of listed) {
      out.push(`- ${it.title}`);
      const meta = [it.category, it.date].filter(Boolean).join(' \u00b7 ');
      if (meta) out.push(`~ ${meta}`);
    }
  }
  return out.join('\n');
};

/** The same text without the layout markers, for the screen-reader log. */
const readable = (m: BotMsg) => pageText(m).replace(/^[\^~-] /gm, '');

/** CSS matrix3d that maps the rectangle (0,0)-(w,h) onto four screen points (TL, TR, BR, BL). '' if degenerate. */
function quadMatrix(w: number, h: number, q: number[]): string {
  const src = [0, 0, w, 0, w, h, 0, h];
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const x = src[2 * i];
    const y = src[2 * i + 1];
    const u = q[2 * i];
    const v = q[2 * i + 1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return '';
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 9; j++) A[r][j] -= k * A[c][j];
    }
  }
  const s = A.map((row, i) => row[8] / row[i]);
  if (s.some((n) => !Number.isFinite(n))) return '';
  const [a, b, c, d, e, f, g, h2] = s;
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${h2},0,0,1,0,${c},${f},0,1)`;
}

/**
 * The chat as an open book. The words are painted on the 3D page textures by the scene (so they turn with the leaf);
 * this component renders only the controls that need real DOM: the page buttons, the question field, the suggestion
 * chips and the project links. The scene publishes the page corners ("book-screen") and this sheet is warped onto
 * them. One question and its answer share one spread, so one question is one page turn. With no scene (flat mode)
 * the sheet is an ordinary two-column card and the words are only in the screen-reader log below.
 */
export function ChatPanel({ title }: { title: string }) {
  const [book, setBook] = useState<BookState>({ index: 0, count: 1, canPrev: false, canNext: false, turning: false, answer: -1 });
  const [replies, setReplies] = useState<(BotMsg | null)[]>([]); // one entry per exchange, null while waiting
  const [questions, setQuestions] = useState<string[]>([]);
  const [onBook, setOnBook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const timer = useRef(0);
  const focusRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);
  const rootRef = useRef<HTMLElement>(null);
  const quadRef = useRef<{ visible: boolean; quad: number[] } | null>(null);
  const onBookRef = useRef(false);
  const applyRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const apply = () => {
      const el = rootRef.current;
      const d = quadRef.current;
      if (!el || !d) return;
      const m = d.visible ? quadMatrix(BOOK_W, BOOK_H, d.quad) : '';
      if (m) {
        el.style.transform = m;
        el.style.opacity = '';
        el.style.pointerEvents = '';
      } else {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      }
    };
    applyRef.current = apply;
    const onScreen = (e: Event) => {
      const d = (e as CustomEvent<{ visible: boolean; quad: number[] }>).detail;
      if (!d || !Array.isArray(d.quad) || d.quad.length !== 8) return;
      quadRef.current = d;
      if (!onBookRef.current) {
        onBookRef.current = true;
        setOnBook(true); // the layout effect below applies the first transform
      } else {
        apply();
      }
    };
    const onState = (e: Event) => {
      const d = (e as CustomEvent<Partial<BookState>>).detail;
      if (!d) return;
      setBook((b) => ({ ...b, ...d }));
    };
    window.addEventListener('book-screen', onScreen);
    window.addEventListener('book-state', onState);
    emit('chat-reset'); // the scene may still hold pages from an earlier mount
    emit('book-input', { text: '', focus: false });
    emit('book-nav', 'query');
    return () => {
      window.removeEventListener('book-screen', onScreen);
      window.removeEventListener('book-state', onState);
      applyRef.current = null;
      window.clearTimeout(timer.current);
      setSpeaking(false);
    };
  }, []);

  useLayoutEffect(() => {
    if (onBook) applyRef.current?.();
  }, [onBook]);
  useEffect(() => {
    if (!busy && refocus.current) {
      refocus.current = false;
      inputRef.current?.focus();
    }
  }, [busy]);

  // The scene paints the field (typed text and caret) onto the page; the real input is an invisible hit area.
  const syncInput = (text: string) => {
    const el = inputRef.current;
    const caret = el && el.value === text && el.selectionStart !== null ? el.selectionStart : text.length;
    emit('book-input', { text, focus: focusRef.current, caret });
  };
  const syncCaret = () => {
    const el = inputRef.current;
    if (el) syncInput(el.value);
  };

  const finish = (ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setBusy(false);
      setSpeaking(false);
    }, ms);
  };

  const ask = async (raw: string) => {
    const question = raw.trim().slice(0, MAX_LEN);
    if (!question || busy) return;
    refocus.current = focusRef.current; // the field is disabled while waiting, which drops focus
    focusRef.current = false;
    setInput('');
    syncInput('');
    setQuestions((q) => [...q, question]);
    setReplies((r) => [...r, null]);
    const slot = replies.length;
    setBusy(true);
    setSpeaking(true);
    emit('chat-message', { role: 'user', text: question }); // the scene adds a spread with a "Thinking..." answer
    const ctl = new AbortController();
    const to = window.setTimeout(() => ctl.abort(), 25000);
    let msg: BotMsg = {
      kind: 'text',
      text: "I couldn't reach the server just now. Try again in a moment.",
      prose: null,
      items: [],
      suggestions: [],
    };
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: ctl.signal,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      msg = parseReply(data, res.ok ? msg.text : 'Something went wrong on my side. Try again in a moment.');
    } catch {
      /* keep the default message */
    } finally {
      window.clearTimeout(to);
    }
    setReplies((r) => r.map((x, i) => (i === slot ? msg : x)));
    const text = pageText(msg);
    emit('chat-message', { role: 'assistant', text }); // fills the same spread: no second page turn
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    finish(reduce ? 0 : Math.min(text.length * 10 + 300, 6000)); // the scene writes about 100 characters a second
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  // Extras for the spread on screen: chips and project links belong to the answer on the right page.
  const chipList = book.index === 0 ? SUGGESTIONS : []; // the three starter questions appear on the front page only
  const hide = book.turning ? ' hidden' : '';

  return (
    <section className={`book-ui${onBook ? ' on-book' : ''}${book.turning ? ' turning' : ''}`} ref={rootRef} aria-label={title}>
      <div className="book-page book-left">
        <div className="bk-row">
          <button type="button" className="bk-btn bk-prev" aria-label="Previous page" onClick={() => emit('book-nav', 'prev')} aria-disabled={!book.canPrev}>
            ‹ Page
          </button>
          <button type="button" className="bk-btn bk-next" aria-label="Next page" onClick={() => emit('book-nav', 'next')} aria-disabled={!book.canNext}>
            Page ›
          </button>
        </div>
      </div>
      <div className="book-page book-right">
        <div className={`book-extras${hide}`}>
          {chipList.length > 0 && (
            <div className="chat-chips">
              {chipList.map((s) => (
                <button type="button" className="chat-chip" key={s} onClick={() => void ask(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <form className="bk-row" onSubmit={onSubmit}>
          <input
            className="bk-input"
            ref={inputRef}
            onSelect={syncCaret}
            onKeyDown={() => window.requestAnimationFrame(syncCaret)}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              syncInput(e.target.value);
            }}
            onFocus={() => {
              focusRef.current = true;
              syncInput(input);
            }}
            onBlur={() => {
              focusRef.current = false;
              syncInput(input);
            }}
            maxLength={MAX_LEN}
            placeholder="Type a question"
            aria-label="Your question"
            disabled={busy}
          />
          <button type="submit" className="bk-ask" aria-label="Ask" disabled={busy || !input.trim()}>
            Ask
          </button>
        </form>
      </div>
      <div className="sr-only" role="log" aria-live="polite">
        {questions.map((q, i) => (
          <div key={i}>
            <p>You: {q}</p>
            <p>Reply: {replies[i] ? readable(replies[i]!) : 'Thinking…'}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
