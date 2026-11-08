import type { Project } from './lib/projects';
import { projectSeatCount } from './lib/stops';

export type ChapterKind = 'hero' | 'about' | 'project' | 'tech' | 'cta';

export interface Chapter {
  id: string;
  title: string;
  kind: ChapterKind;
  /** Set only when kind === 'project'. */
  projectId?: number;
}

const HOME: Chapter = { id: 'home', title: 'Home', kind: 'hero' };
const ABOUT: Chapter = { id: 'about', title: 'About Me', kind: 'about' };
const TECH: Chapter = { id: 'tech', title: 'Tech Stack', kind: 'tech' };
const CONNECT: Chapter = { id: 'connect', title: "Let's Connect", kind: 'cta' };

/** [home, about, ...featured projects by sort_order, tech, connect]. Overlay panels, flat sections, nav and announcer all derive from this. */
export function buildChapters(projects: Project[]): Chapter[] {
  const featured = projects
    .filter((p) => p.featured === 1)
    .sort((a, b) => a.sort_order - b.sort_order || b.id - a.id)
    .slice(0, projectSeatCount) // one chapter per seat at the table; extra featured projects go to "More projects"
    .map<Chapter>((p) => ({ id: `project-${p.id}`, title: p.title, kind: 'project', projectId: p.id }));
  return [HOME, ABOUT, ...featured, TECH, CONNECT];
}

/** Pinned scroll length in vh: max(600, chapters * 100). */
export const pinLengthVh = (chapterCount: number): number => Math.max(600, chapterCount * 100);
