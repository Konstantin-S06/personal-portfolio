import { useEffect, useRef, useState } from 'react';
import { BOARD_H_PX, BOARD_W_PX, quadMatrix } from '../lib/quad';
import type { BoardHit, SignContent } from '../lib/signContent';

interface ScreenDetail {
  id: string;
  visible: boolean;
  quad: number[];
  hits: BoardHit[];
}

/**
 * The real DOM behind a painted project signpost. The scene paints the words on the board and publishes its screen
 * corners ("board-screen"); this sheet is warped onto them and holds only what needs to be real: the links, as
 * invisible hit areas over the painted buttons, plus the full text for screen readers.
 */
export function SignControls({ stopId, content }: { stopId: string; content: SignContent }) {
  const rootRef = useRef<HTMLElement>(null);
  const hitsKey = useRef('');
  const [hits, setHits] = useState<BoardHit[]>([]);
  const [onBoard, setOnBoard] = useState(false);

  useEffect(() => {
    const onScreen = (e: Event) => {
      const d = (e as CustomEvent<ScreenDetail>).detail;
      const el = rootRef.current;
      if (!d || d.id !== stopId || !el) return;
      const m = d.visible && d.quad.length === 8 ? quadMatrix(BOARD_W_PX, BOARD_H_PX, d.quad) : '';
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
  }, [stopId]);

  const meta = [content.date, content.category, content.context].filter(Boolean).join(' · ');
  return (
    <section className={`sign-ui${onBoard ? ' on-sign' : ''}`} ref={rootRef} aria-label={content.title}>
      <div className="sr-only">
        <h2>{content.title}</h2>
        <p>
          Project {content.index} of {content.total}
          {meta ? `. ${meta}` : ''}
        </p>
        <p>{content.summary}</p>
        {content.role && <p>Role: {content.role}</p>}
        {content.highlights.length > 0 && (
          <ul>
            {content.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
        {content.tech.length > 0 && <p>Technology: {content.tech.join(', ')}</p>}
        {/* Until the board has been placed on screen, keyboard users still reach the links here. */}
        {hits.length === 0 &&
          content.links.map((l) => (
            <a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer">
              {content.title}: {l.label}
            </a>
          ))}
      </div>
      {hits.map((h) => (
        <a
          key={h.id}
          className="sign-hit"
          href={h.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${content.title}: ${h.label} (opens in a new tab)`}
          style={{ left: h.x, top: h.y, width: h.w, height: h.h }}
        />
      ))}
    </section>
  );
}
