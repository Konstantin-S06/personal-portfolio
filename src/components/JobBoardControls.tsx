import { useEffect, useRef, useState } from 'react';
import { JOB_H_PX, JOB_W_PX, quadMatrix } from '../lib/quad';
import { JOB_BOARD_ID, type BoardHit, type JobBoardContent } from '../lib/signContent';

interface ScreenDetail {
  id: string;
  visible: boolean;
  quad: number[];
  hits: BoardHit[];
}

/** Screen-reader text for the tech half of the job board. That half has no links, so nothing else is needed. */
export function JobTechText({ content }: { content: JobBoardContent }) {
  return (
    <section className="sr-only" aria-label={content.techTitle}>
      <h2>{content.techTitle}</h2>
      <ul>
        {content.tech.map((g) => (
          <li key={g.label}>
            {g.label}: {g.items.join(', ')}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The real DOM behind the painted notes. The scene publishes the board's screen corners ("board-screen"); this sheet is
 * warped onto them and holds the invisible link areas over the painted buttons plus the full note text for screen readers.
 */
export function JobNotesControls({ content }: { content: JobBoardContent }) {
  const rootRef = useRef<HTMLElement>(null);
  const hitsKey = useRef('');
  const [hits, setHits] = useState<BoardHit[]>([]);
  const [onBoard, setOnBoard] = useState(false);

  useEffect(() => {
    const onScreen = (e: Event) => {
      const d = (e as CustomEvent<ScreenDetail>).detail;
      const el = rootRef.current;
      if (!d || d.id !== JOB_BOARD_ID || !el) return;
      const m = d.visible && d.quad.length === 8 ? quadMatrix(JOB_W_PX, JOB_H_PX, d.quad) : '';
      if (m) {
        el.style.transform = m;
        setOnBoard(true);
      } else {
        setOnBoard(false);
      }
      const key = JSON.stringify(d.hits);
      if (key !== hitsKey.current) {
        hitsKey.current = key;
        setHits(d.hits);
      }
    };
    window.addEventListener('board-screen', onScreen);
    return () => window.removeEventListener('board-screen', onScreen);
  }, []);

  return (
    <section className={`sign-ui job-ui${onBoard ? ' on-sign' : ''}`} ref={rootRef} aria-label={content.notesTitle}>
      <div className="sr-only">
        <h2>{content.notesTitle}</h2>
        {content.notes.map((n) => (
          <article key={n.id}>
            <h3>{n.title}</h3>
            {(n.category || n.context || n.date) && <p>{[n.category, n.context ?? n.date].filter(Boolean).join(' · ')}</p>}
            <p>{n.summary}</p>
            {n.tech.length > 0 && <p>Technology: {n.tech.join(', ')}</p>}
            {/* Until the board has been placed on screen, keyboard users still reach the links here. */}
            {hits.length === 0 &&
              n.links.map((l) => (
                <a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer">
                  {n.title}: {l.label}
                </a>
              ))}
          </article>
        ))}
      </div>
      {hits.map((h) => (
        <a
          key={h.id}
          className="sign-hit"
          href={h.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${h.label} (opens in a new tab)`}
          style={{ left: h.x, top: h.y, width: h.w, height: h.h }}
        />
      ))}
    </section>
  );
}
