import { useEffect, useRef, useState } from 'react';
import { BOARD_H_PX, BOARD_W_PX, quadMatrix } from '../lib/quad';
import type { AboutContent } from '../scene/aboutSign'; // type only

interface ScreenDetail {
  id: string;
  visible: boolean;
  quad: number[];
}

/** DOM behind the painted About notice: no controls, only the full text for screen readers, warped onto the paper's corners. */
export function AboutSignControls({ content }: { content: AboutContent }) {
  const rootRef = useRef<HTMLElement>(null);
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
    };
    window.addEventListener('board-screen', onScreen);
    window.dispatchEvent(new Event('board-request'));
    return () => window.removeEventListener('board-screen', onScreen);
  }, [stopId]);

  return (
    <section className={`sign-ui${onBoard ? ' on-sign' : ''}`} ref={rootRef} aria-label={content.title}>
      <div className="sr-only">
        <h2>{content.title}</h2>
        {content.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    </section>
  );
}