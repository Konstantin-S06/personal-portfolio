import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { pinLengthVh, type Chapter } from '../chapters';
import type { Project } from '../lib/projects';
import type { World } from '../scene/world'; // type only: the three.js code is loaded via import() below
import type { BannerLabel } from '../scene/signs'; // type only
import { activeIndex, chapterLanding, chapterOpacity, clamp } from '../lib/progress';
import { layoutRanges } from '../lib/stops';
import { cancelScrollTween, tweenScrollTo } from '../lib/navigator';
import { ChapterContent } from './ChapterContent';

const SCRUB_SECONDS = 0.8; // exponential time constant: camera trails the scrollbar by about this much
const DEBUG_HUD = new URLSearchParams(window.location.search).get('debug') === '1';

export type NavHandler = (id: string) => void;

interface StageProps {
  navRef: MutableRefObject<NavHandler | null>;
  chapters: Chapter[];
  projects: Project[];
}

/** Text for the decorative in-world banners. Only project stops get labels so home/about/tech/connect are not duplicated. */
function bannerLabels(chapters: Chapter[], projects: Project[]): BannerLabel[] {
  let k = 0;
  return chapters
    .filter((c) => c.kind === 'project')
    .map((c) => ({
      stopId: `project-${++k}`,
      title: c.title,
      context: c.projectId !== undefined ? projects.find((p) => p.id === c.projectId)?.context ?? undefined : undefined,
    }));
}

export function Stage({ navRef, chapters, projects }: StageProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const worldRef = useRef<World | null>(null);
  const redrawRef = useRef<(() => void) | null>(null);
  const [announce, setAnnounce] = useState(chapters[0].title);
  const [loadPct, setLoadPct] = useState(0);
  const [loading, setLoading] = useState(true);
  const labelsRef = useRef<BannerLabel[]>([]);
  labelsRef.current = bannerLabels(chapters, projects);

  // The three.js scene is a separate chunk, fetched only here (pinned mode). Flat-mode users never load it
  // (and never download nature GLBs). The canvas is created per effect run so StrictMode remounts get a fresh
  // WebGL context; dispose() releases it and the canvas is removed.
  useEffect(() => {
    let cancelled = false;
    const canvas = document.createElement('canvas');
    canvas.className = 'stage-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvasHostRef.current!.appendChild(canvas);
    setLoading(true);
    setLoadPct(0);

    import('../scene/index').then(({ createBestWorld }) => {
      if (cancelled) return;
      return createBestWorld(canvas, () => cancelled, (loaded, total) => {
        if (cancelled || total <= 0) return;
        setLoadPct(Math.round((loaded / total) * 100));
      });
    }).then((world) => {
      if (!world) {
        if (!cancelled) setLoading(false);
        return;
      }
      if (cancelled) {
        world.dispose();
        return;
      }
      worldRef.current = world;
      world.setLabels?.(labelsRef.current);
      world.resize();
      setLoadPct(100);
      setLoading(false);
      redrawRef.current?.();
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      worldRef.current?.dispose();
      worldRef.current = null;
      canvas.remove();
    };
  }, []);

  // Chapter titles can change when API data arrives: repaint the banner text (the scene is not rebuilt).
  useEffect(() => {
    worldRef.current?.setLabels?.(labelsRef.current);
    redrawRef.current?.();
  }, [chapters, projects]);

  // Scroll/progress logic. Re-runs if the chapter list changes (API data arrives) without touching the scene.
  useEffect(() => {
    const track = trackRef.current!;
    const pin = pinRef.current!;
    // Chapters are centred on the stops baked from the 3D path; equal ranges if they do not line up.
    const { centers, ranges } = layoutRanges(chapters);

    let start = 0;
    let span = 1;
    let raw = 0;
    let smoothed = 0;
    let active = -1;
    let rafId = 0;
    let last = 0;

    // Per-panel caches: the DOM is only touched when a value actually changed.
    const lastOpacity: number[] = [];
    const isLive: boolean[] = [];
    const isActive: boolean[] = [];
    const opacities: number[] = new Array(chapters.length).fill(0);
    let complete: boolean | null = null;
    let walking: boolean | null = null;

    // ?debug=1: progress, active chapter and every panel's computed opacity.
    let hud: HTMLPreElement | null = null;
    let hudText = '';
    if (DEBUG_HUD) {
      hud = document.createElement('pre');
      hud.setAttribute('aria-hidden', 'true');
      hud.className = 'stage-hud';
      pin.appendChild(hud);
    }

    const measure = () => {
      start = track.getBoundingClientRect().top + window.scrollY;
      span = Math.max(track.offsetHeight - window.innerHeight, 1);
      raw = clamp((window.scrollY - start) / span);
    };

    const apply = (p: number) => {
      worldRef.current?.render(p);
      for (let i = 0; i < ranges.length; i++) {
        const o = Math.round(chapterOpacity(ranges[i], p) * 1000) / 1000;
        opacities[i] = o;
        if (o === lastOpacity[i]) continue;
        lastOpacity[i] = o;
        const el = panelRefs.current[i];
        if (!el) continue;
        // Per frame only opacity and transform are written. Visibility / pointer-events are CSS, keyed off two
        // classes that flip only when the panel crosses a threshold.
        el.style.opacity = String(o);
        el.style.transform = `translateY(${((1 - o) * 28).toFixed(1)}px)`;
        const live = o >= 0.01;
        if (live !== isLive[i]) {
          isLive[i] = live;
          el.classList.toggle('live', live);
        }
        const act = o > 0.5;
        if (act !== isActive[i]) {
          isActive[i] = act;
          el.classList.toggle('active', act);
        }
      }
      const done = p > 0.999;
      if (done !== complete) {
        complete = done;
        pin.dataset.complete = done ? 'true' : 'false';
      }
      const walk = p > 0.03;
      if (walk !== walking) {
        walking = walk;
        pin.dataset.walk = walk ? '1' : '0';
      }
      const idx = activeIndex(ranges, p);
      if (idx !== active) {
        active = idx;
        pin.dataset.chapter = chapters[idx].id;
        setAnnounce(chapters[idx].title);
        window.dispatchEvent(new CustomEvent('chapterchange', { detail: chapters[idx].id }));
      }
      if (hud) {
        const text =
          `progress ${p.toFixed(4)}   active ${chapters[idx].id}\n` +
          chapters.map((c, i) => `${c.id.padEnd(11)} ${opacities[i].toFixed(2)}`).join('\n');
        if (text !== hudText) {
          hudText = text;
          hud.textContent = text;
        }
      }
    };

    // Render on demand: the loop only runs while smoothed progress is catching up to the scroll.
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      smoothed += (raw - smoothed) * (1 - Math.exp(-dt / SCRUB_SECONDS));
      if (Math.abs(raw - smoothed) < 0.0005) smoothed = raw;
      apply(smoothed);
      rafId = smoothed === raw ? 0 : requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!rafId) {
        last = performance.now();
        rafId = requestAnimationFrame(frame);
      }
    };

    const onScroll = () => {
      raw = clamp((window.scrollY - start) / span);
      kick();
    };
    const onResize = () => {
      measure();
      worldRef.current?.resize();
      smoothed = raw;
      apply(smoothed);
    };

    navRef.current = (id) => {
      const i = chapters.findIndex((c) => c.id === id);
      if (i < 0) return;
      measure();
      // With stop-centred ranges, land on the stop itself (camera parked there, panel fully opaque).
      tweenScrollTo(start + span * (centers ? centers[i] : chapterLanding(ranges[i])), span);
    };

    measure();
    smoothed = raw;
    apply(smoothed);
    redrawRef.current = () => apply(smoothed);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      navRef.current = null;
      redrawRef.current = null;
      cancelScrollTween();
      cancelAnimationFrame(rafId);
      hud?.remove();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [navRef, chapters]);

  const firstProjectId = chapters.find((c) => c.kind === 'project')?.id;
  const contactId = chapters.find((c) => c.kind === 'cta')?.id ?? 'connect';
  const projectTotal = chapters.filter((c) => c.kind === 'project').length;
  let projectNo = 0;
  return (
    <div className="stage-track" ref={trackRef} style={{ height: `${pinLengthVh(chapters.length)}vh` }}>
      <div className="stage-pin" ref={pinRef}>
        <div ref={canvasHostRef} style={{ display: 'contents' }} />
        {loading && (
          <div className="stage-loading" role="status" aria-live="polite">
            <div className="stage-loading-card">
              <p>Loading forest…</p>
              <div className="stage-loading-bar" aria-hidden="true">
                <span style={{ width: `${loadPct}%` }} />
              </div>
              <p className="stage-loading-pct">{loadPct}%</p>
            </div>
          </div>
        )}
        <div className="stage-overlay">
          {chapters.map((c, i) => {
            const projectIndex = c.kind === 'project' ? ++projectNo : undefined;
            return (
              <div
                className={`panel${c.kind === 'project' ? ' panel-project' : ''}`}
                id={c.id}
                key={c.id}
                ref={(el) => { panelRefs.current[i] = el; }}
              >
                <ChapterContent
                  kind={c.kind}
                  title={c.title}
                  project={c.projectId !== undefined ? projects.find((p) => p.id === c.projectId) : undefined}
                  actions={{
                    pinned: true,
                    firstProjectId,
                    contactId,
                    projectIndex,
                    projectTotal,
                    onNavigate: (id) => navRef.current?.(id),
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="sr-only" aria-live="polite">{announce}</div>
      </div>
    </div>
  );
}
