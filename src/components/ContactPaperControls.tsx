import { useEffect, useRef, useState, type FormEvent } from 'react';
import { API_BASE_URL } from '../config';
import { quadMatrix } from '../lib/quad';
import { BIRD_GRAB_SECONDS, BIRD_IN_SECONDS, CONTACT_SHEET_H, CONTACT_SHEET_W } from '../scene/look';
import { ContactLinks } from './ChapterContent';

const NAME_MAX = 100;
const EMAIL_MAX = 100;
const MESSAGE_MAX = 1000;

/** Must match CONTACT_PAPER_ID and CONTACT_FIELDS in scene/lectern.ts (copied here so this file does not pull three.js into the main bundle). */
const PAPER_ID = 'contact-paper';
const FIELDS = {
  name: { x: 44, y: 118, w: 712, h: 52 },
  email: { x: 44, y: 208, w: 712, h: 52 },
  message: { x: 44, y: 298, w: 712, h: 196 },
  send: { x: 536, y: 530, w: 220, h: 54 },
};
/** Free paper left of the Send button: shows the waiting, error and success text. */
const STATUS = { x: 44, y: 504, w: 472, h: 120 };

type Phase = 'idle' | 'loading' | 'success' | 'error';
type ErrorKind = 'network' | 'validation' | 'server';

const ERROR_TEXT: Record<ErrorKind, string> = {
  network: 'Network error: the message never reached the server. Check your connection and try again.',
  validation:
    'Validation error: name and email must be 100 characters or fewer, the message 1000 or fewer, and the email must include @.',
  server: 'Server error: the message could not be saved. Please try again later.',
};

function clientError(name: string, email: string, message: string): string | null {
  if (!name || !email || !message) return ERROR_TEXT.validation;
  if (name.length > NAME_MAX || email.length > EMAIL_MAX || message.length > MESSAGE_MAX) return ERROR_TEXT.validation;
  if (!email.includes('@')) return ERROR_TEXT.validation;
  return null;
}

interface ScreenDetail {
  id: string;
  visible: boolean;
  quad: number[];
}

const box = (r: { x: number; y: number; w: number; h: number }) => ({ left: r.x, top: r.y, width: r.w, height: r.h });

/**
 * The real DOM on the lectern's paper. The scene publishes the paper's screen corners ("board-screen", id "contact-paper");
 * this sheet is warped onto them. Inputs sit over the painted fields and show the typed text in ink.
 * `onSent(done)` fires once after an HTTP 201 so the caller can start the bird animation; the caller must call
 * `done()` when the bird has finished (or immediately if there is no flight), which resets the form.
 */
export function ContactPaperControls({ onSent }: { onSent?: (done: () => void) => void }) {
  const rootRef = useRef<HTMLElement>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const run = useRef(0); // bumped on success/unmount so a stale bird callback cannot reset a newer state
  const [onPaper, setOnPaper] = useState(false);
  const [flying, setFlying] = useState(false);
  const [lifted, setLifted] = useState(false); // true once the bird has taken the sheet
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      run.current += 1;
    };
  }, []);

  useEffect(() => {
    const onScreen = (e: Event) => {
      const d = (e as CustomEvent<ScreenDetail>).detail;
      const el = rootRef.current;
      if (!d || d.id !== PAPER_ID || !el) return;
      const m = d.visible && d.quad.length === 8 ? quadMatrix(CONTACT_SHEET_W, CONTACT_SHEET_H, d.quad) : '';
      if (m) {
        el.style.transform = m;
        setOnPaper(true);
      } else {
        setOnPaper(false);
      }
    };
    window.addEventListener('board-screen', onScreen);
    return () => window.removeEventListener('board-screen', onScreen);
  }, []);

  const wasFlying = useRef(false);
  useEffect(() => {
    if (!flying) {
      setLifted(false);
      if (wasFlying.current) {
        wasFlying.current = false;
        // The sheet is back: let the form ink in over it.
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          rootRef.current?.animate(
            [
              { opacity: 0, filter: 'blur(3px)' },
              { opacity: 1, filter: 'blur(0px)' },
            ],
            { duration: 900, easing: 'ease-out' },
          );
        }
      }
      return;
    }
    wasFlying.current = true;
    const id = window.setTimeout(() => setLifted(true), (BIRD_IN_SECONDS + BIRD_GRAB_SECONDS * 0.5 + 0.25) * 1000);
    return () => window.clearTimeout(id);
  }, [flying]);

  const invalid = phase === 'error' && status === ERROR_TEXT.validation;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy.current) return;
    const payload = { name: name.trim(), email: email.trim(), message: message.trim() };
    const problem = clientError(payload.name, payload.email, payload.message);
    if (problem) {
      setPhase('error');
      setStatus(problem);
      return;
    }

    busy.current = true;
    let handedOff = false; // true once the bird owns the form: busy stays set until done()
    setPhase('loading');
    setStatus('Sending your message… the server may take a few seconds to wake up.');
    try {
      const res = await fetch(`${API_BASE_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!alive.current) return;
      if (res.status === 400) {
        setPhase('error');
        setStatus(ERROR_TEXT.validation);
        return;
      }
      if (res.status !== 201) {
        setPhase('error');
        setStatus(ERROR_TEXT.server);
        return;
      }
      handedOff = true;
      const token = ++run.current;
      setPhase('success');
      setStatus('Message sent. Thanks for getting in touch.');
      setFlying(true);
      const finish = () => {
        if (!alive.current || token !== run.current) return;
        run.current += 1; // a second call is a no-op
        setName('');
        setEmail('');
        setMessage('');
        setFlying(false);
        busy.current = false;
      };
      if (onSent) onSent(finish);
      else finish();
    } catch {
      if (alive.current) {
        setPhase('error');
        setStatus(ERROR_TEXT.network);
      }
    } finally {
      if (!handedOff) busy.current = false;
    }
  };

  const loading = phase === 'loading';

  return (
    <section
      className={`contact-ui${onPaper ? ' on-paper' : ''}${flying ? ' is-flying' : ''}`}
      ref={rootRef}
      aria-label="Contact form"
      inert={!onPaper || flying}
      style={lifted ? { visibility: 'hidden' } : undefined}
    >
      <form className="paper-form" onSubmit={onSubmit} noValidate aria-busy={loading}>
        <label className="sr-only" htmlFor="paper-name">
          Name
        </label>
        <input
          id="paper-name"
          className="paper-field"
          name="name"
          type="text"
          autoComplete="name"
          required
          maxLength={NAME_MAX}
          value={name}
          readOnly={loading || flying}
          aria-invalid={invalid && !name.trim()}
          aria-describedby="paper-status"
          style={box(FIELDS.name)}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="sr-only" htmlFor="paper-email">
          Email
        </label>
        <input
          id="paper-email"
          className="paper-field"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={EMAIL_MAX}
          value={email}
          readOnly={loading || flying}
          aria-invalid={invalid && (!email.trim() || !email.includes('@'))}
          aria-describedby="paper-status"
          style={box(FIELDS.email)}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="sr-only" htmlFor="paper-message">
          Message
        </label>
        <textarea
          id="paper-message"
          className="paper-field paper-area"
          name="message"
          required
          maxLength={MESSAGE_MAX}
          value={message}
          readOnly={loading || flying}
          aria-invalid={invalid && !message.trim()}
          aria-describedby="paper-status"
          style={box(FIELDS.message)}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button type="submit" className="paper-send" disabled={loading || flying} style={box(FIELDS.send)}>
          {loading ? 'Sending…' : 'Send message'}
        </button>
        <p
          id="paper-status"
          className={`paper-status${phase === 'error' ? ' is-error' : ''}${phase === 'success' ? ' is-success' : ''}${loading ? ' is-loading' : ''}`}
          role="status"
          aria-live="polite"
          style={box(STATUS)}
        >
          {status}
        </p>
      </form>
      <ContactLinks className="paper-links" />
    </section>
  );
}