import { useEffect, useRef, useState, type FormEvent } from 'react';
import { API_BASE_URL as API_BASE } from '../config';

const MAX_LEN = 300;
// Keep in sync with STATIC_SUGGESTIONS in backend/chat_intents.py (a backend test checks the three are answered).
const SUGGESTIONS = ['How many projects use Python?', 'Which projects are featured?', 'What did you build with Flask?'];
const MAX_ITEMS = 12;

type Kind = 'list' | 'count' | 'text' | 'refusal';

interface ChatItem {
  title: string;
  tech: string[];
  category: string | null;
  summary: string | null;
  role: string | null;
  date: string | null;
  github: string | null;
  demo: string | null;
}

interface UserMsg {
  role: 'user';
  text: string;
}
interface BotMsg {
  role: 'bot';
  kind: Kind;
  text: string;
  items: ChatItem[];
  suggestions: string[];
}
type Msg = UserMsg | BotMsg;

function setSpeaking(on: boolean) {
  window.dispatchEvent(new CustomEvent('chat-speaking', { detail: on }));
}

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
      summary: str(r.summary),
      role: str(r.role),
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
  return { role: 'bot', kind, text, items: parseItems(data.items), suggestions };
}

function Links({ item }: { item: ChatItem }) {
  if (!item.github && !item.demo) return null;
  return (
    <span className="chat-links">
      {item.github && (
        <a href={item.github} target="_blank" rel="noopener noreferrer">
          Code
        </a>
      )}
      {item.demo && (
        <a href={item.demo} target="_blank" rel="noopener noreferrer">
          Demo
        </a>
      )}
    </span>
  );
}

function Rows({ items, compact }: { items: ChatItem[]; compact?: boolean }) {
  return (
    <ul className={`chat-rows${compact ? ' compact' : ''}`}>
      {items.map((it, i) => {
        const meta = [it.category, it.date].filter(Boolean).join(' · ');
        return (
          <li key={`${it.title}-${i}`}>
            <span className="chat-row-title">{it.title}</span>
            {meta && <span className="chat-row-meta">{meta}</span>}
            <Links item={it} />
            {!compact && it.tech.length > 0 && <span className="chat-row-tech">{it.tech.join(' · ')}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function ChatPanel({ title }: { title: string }) {
  const [log, setLog] = useState<Msg[]>([]);
  const [shown, setShown] = useState(0); // characters of the newest plain-text answer revealed so far
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const timer = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      window.clearInterval(timer.current);
      setSpeaking(false);
    },
    [],
  );

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, shown]);

  const finish = () => {
    window.clearInterval(timer.current);
    setBusy(false);
    setSpeaking(false);
  };

  // The typewriter is for plain text only. Lists, counts and refusals appear at once.
  const reveal = (msg: BotMsg) => {
    setLog((l) => [...l, msg]);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (msg.kind !== 'text' || reduce) {
      setShown(msg.text.length);
      finish();
      return;
    }
    let n = 0;
    setShown(0);
    timer.current = window.setInterval(() => {
      n += 2;
      setShown(n);
      if (n >= msg.text.length) finish();
    }, 20);
  };

  const ask = async (raw: string) => {
    const question = raw.trim().slice(0, MAX_LEN);
    if (!question || busy) return;
    setInput('');
    setLog((l) => [...l, { role: 'user', text: question }]);
    setBusy(true);
    setSpeaking(true);
    const ctl = new AbortController();
    const to = window.setTimeout(() => ctl.abort(), 25000);
    let msg: BotMsg = {
      role: 'bot',
      kind: 'text',
      text: "I couldn't reach the server just now. Try again in a moment.",
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
    reveal(msg);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  const last = log.length - 1;
  const waiting = busy && last >= 0 && log[last].role === 'user';

  const renderBot = (m: BotMsg, i: number) => {
    const typing = i === last && m.kind === 'text';
    const done = !typing || shown >= m.text.length;
    if (m.kind === 'text') {
      return (
        <div className="chat-a" key={i}>
          <p className="chat-text">{typing ? m.text.slice(0, shown) : m.text}</p>
          {done && m.items.length > 0 && <Rows items={m.items} compact />}
          {done && m.suggestions.length > 0 && <Chips list={m.suggestions} />}
        </div>
      );
    }
    if (m.kind === 'count') {
      return (
        <div className="chat-a chat-count" key={i}>
          <p className="chat-big">{m.text}</p>
          {m.items.length > 0 && <Rows items={m.items} compact />}
        </div>
      );
    }
    if (m.kind === 'list') {
      return (
        <div className="chat-a chat-list" key={i}>
          <p className="chat-lead">{m.text}</p>
          <Rows items={m.items} />
        </div>
      );
    }
    return (
      <div className="chat-a chat-refusal" key={i}>
        <p className="chat-text">{m.text}</p>
        <Chips list={m.suggestions.length ? m.suggestions : SUGGESTIONS} />
      </div>
    );
  };

  function Chips({ list }: { list: string[] }) {
    return (
      <div className="chat-chips inline">
        {list.map((s) => (
          <button type="button" className="chat-chip" key={s} onClick={() => void ask(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="container">
      <section className="chat-card" aria-label={title}>
        <div className="chat-inner">
          <header className="chat-head">
            <h2>{title}</h2>
            <span className={`chat-status${busy ? ' on' : ''}`} aria-hidden="true" />
          </header>
          <div className="chat-log" ref={logRef} aria-live="polite">
            {log.length === 0 && <p className="chat-hint">Ask about my projects, the tech I use, or my experience.</p>}
            {log.map((m, i) =>
              m.role === 'user' ? (
                <p className="chat-q" key={i}>
                  {m.text}
                </p>
              ) : (
                renderBot(m, i)
              ),
            )}
            {waiting && <p className="chat-a chat-wait">Thinking…</p>}
          </div>
          {log.length === 0 && (
            <div className="chat-chips">
              {SUGGESTIONS.map((s) => (
                <button type="button" className="chat-chip" key={s} onClick={() => void ask(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <form className="chat-form" onSubmit={onSubmit}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={MAX_LEN}
              placeholder="Type a question"
              aria-label="Your question"
              disabled={busy}
            />
            <button type="submit" className="chat-send" disabled={busy || !input.trim()}>
              Ask
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
