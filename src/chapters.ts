import type { Project } from './lib/projects';
import { projectSeatCount } from './lib/stops';

export type ChapterKind = 'hero' | 'about' | 'project' | 'tech' | 'more' | 'cta' | 'chat';

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
const MORE: Chapter = { id: 'more-projects', title: 'More Projects', kind: 'more' };
const CONNECT: Chapter = { id: 'connect', title: "Let's Connect", kind: 'cta' };
const CHAT: Chapter = { id: 'chat', title: 'Ask About My Work', kind: 'chat' };

function pickFeatured(projects: Project[]): Project[] {
  return projects
    .filter((p) => p.featured === 1)
    .sort((a, b) => a.sort_order - b.sort_order || b.id - a.id)
    .slice(0, projectSeatCount); // one chapter per seat at the table; extra featured projects go to "More projects"
}

/**
 * [home, about, ...featured projects by sort_order, tech, more projects (only if any are left over), connect].
 * Overlay panels, flat sections, nav and announcer all derive from this.
 */
export function buildChapters(projects: Project[]): Chapter[] {
  const featured = pickFeatured(projects);
  const ids = new Set(featured.map((p) => p.id));
  const hasMore = projects.some((p) => !ids.has(p.id));
  const stops = featured.map<Chapter>((p) => ({ id: `project-${p.id}`, title: p.title, kind: 'project', projectId: p.id }));
  return [HOME, ABOUT, ...stops, TECH, ...(hasMore ? [MORE] : []), CONNECT, CHAT];
}

/** Projects that have no chapter of their own, in the order the list already has. */
export function remainingProjects(chapters: Chapter[], projects: Project[]): Project[] {
  const shown = new Set(chapters.flatMap((c) => (c.projectId !== undefined ? [c.projectId] : [])));
  return projects.filter((p) => !shown.has(p.id));
}

/** Pinned scroll length in vh: max(600, chapters * 100). */
// x1.24 keeps the forest pace unchanged now that WALK_END is 0.66 instead of 0.82.
export const pinLengthVh = (chapterCount: number): number => Math.round(Math.max(600, chapterCount * 100) * 1.24);
