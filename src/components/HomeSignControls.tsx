import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { BOARD_H_PX, BOARD_W_PX, quadMatrix } from '../lib/quad';
import type { HomeContent, HomeHit } from '../scene/homeSign'; // type only

interface ScreenDetail {
  id: string;
  visible: boolean;
  quad: number[];
  hits: HomeHit[];
}

/**
 * The real DOM behind the painted Home signpost. The scene paints the words and publishes the board's screen corners
 * ("board-screen"); this sheet is warped onto them and holds only what needs to be real: the two buttons as invisible
 * anchors over the painted ones, plus the full text for screen readers.
 */
export function HomeSignControls({ content, onNavigate }: { content: HomeContent; onNavigate: (id: string) => void }) {
  const rootRef = useRef<HTMLElement>(null);
  const hitsKey = useRef('');
  const [hits, setHits] = useState<HomeHit[]>([]);
  const [onBoard, setOnBoard] = useState(false);
  const stopId = content.stopId;

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

  const go = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    onNavigate(id);
  };

  return (
    <section className={`sign-ui${onBoard ? ' on-sign' : ''}`} ref={rootRef} aria-label={content.title}>
      <div className="sr-only">
        <p>{content.kicker}</p>
        <h1>{content.title}</h1>
        {content.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        {/* Until the board has been placed on screen, keyboard users still reach the buttons here. */}
        {hits.length === 0 &&
          content.actions.map((a) => (
            <a key={a.id} href={`#${a.id}`} onClick={(e) => go(e, a.id)}>
              {a.label}
            </a>
          ))}
      </div>
      {hits.map((h) => (
        <a
          key={h.id}
          className="sign-hit"
          href={`#${h.id}`}
          onClick={(e) => go(e, h.id)}
          aria-label={h.label}
          style={{ left: h.x, top: h.y, width: h.w, height: h.h }}
        />
      ))}
    </section>
  );
}
