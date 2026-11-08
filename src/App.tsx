import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { buildChapters } from './chapters';
import { usePinnedMode } from './lib/useMode';
import { useProjects } from './lib/projects';
import { layoutRanges } from './lib/stops';
import { Stage, type NavHandler } from './components/Stage';
import { FlatSections } from './components/FlatSections';
import { MoreProjects } from './components/ProjectPanel';

export default function App() {
  const pinned = usePinnedMode();
  const projects = useProjects();
  const chapters = useMemo(() => buildChapters(projects), [projects]);
  const navRef = useRef<NavHandler | null>(null);

  // Projects that already have a chapter; everything else lands in the "More projects" grid.
  const shown = useMemo(
    () => new Set(chapters.flatMap((c) => (c.projectId !== undefined ? [c.projectId] : []))),
    [chapters],
  );

  // Dev only: print the chapter list with its progress ranges, and flag an unexpected featured count.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const { ranges } = layoutRanges(chapters);
    console.table(
      chapters.map((c, i) => ({
        id: c.id,
        kind: c.kind,
        range: `${ranges[i].start.toFixed(4)} - ${ranges[i].end.toFixed(4)}`,
      })),
    );
    const featured = projects.filter((p) => p.featured === 1).length;
    if (featured !== 6) console.warn(`[chapters] expected 6 featured projects, found ${featured}`);
  }, [chapters, projects]);

  const onChapterClick = (e: MouseEvent, id: string) => {
    if (!pinned || !navRef.current) return; // flat mode: native anchor scrolling
    e.preventDefault();
    navRef.current(id);
  };

  // The first project chapter is the first project stop (pinned) or its section (flat).
  const firstProject = chapters.find((c) => c.kind === 'project');
  const contact = chapters.find((c) => c.kind === 'cta');
  const nav = [
    { id: 'home', label: 'Home' },
    { id: 'about', label: 'About' },
    { id: firstProject?.id ?? 'more-projects', label: 'Projects' },
    { id: 'tech', label: 'Tech' },
    { id: 'more-projects', label: 'More projects' },
    { id: contact?.id ?? 'connect', label: 'Contact' },
  ];

  return (
    <>
      <nav className="navbar">
        <div className="container">
          <div className="nav-brand"><a href="#home" onClick={(e) => onChapterClick(e, 'home')}>Portfolio</a></div>
          <ul className="nav-links">
            {nav.map((item) => (
              <li key={item.label}>
                <a
                  href={`#${item.id}`}
                  onClick={(e) => {
                    // "More projects" sits after the pin, so the browser scrolls to that section.
                    if (item.id === 'more-projects') return;
                    onChapterClick(e, item.id);
                  }}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <main>
        {pinned ? (
          <Stage navRef={navRef} chapters={chapters} projects={projects} />
        ) : (
          <FlatSections chapters={chapters} projects={projects} />
        )}
        <MoreProjects projects={projects} shown={shown} />
      </main>

      <footer>
        <div className="container">
          <p>&copy; 2026 Konstantin Shtop. Built with React, TypeScript and Three.js. Backend powered by Flask.</p>
        </div>
      </footer>
    </>
  );
}
