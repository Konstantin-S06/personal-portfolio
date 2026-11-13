import type { Project } from './projects';

/** Plain data for one painted board. No three.js here, so the DOM side can import it freely. */
export interface SignContent {
  /** Stop id from stops.generated.json (`project-1` .. `project-n`). */
  stopId: string;
  index: number;
  total: number;
  title: string;
  date?: string;
  category?: string;
  context?: string;
  summary: string;
  role?: string;
  highlights: string[];
  tech: string[];
  links: { id: string; label: string; href: string }[];
}

/** A clickable rectangle on the painted board, in the board sheet's logical pixels (see BOARD_W_PX). */
export interface BoardHit {
  id: string;
  label: string;
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const url = (v: unknown): string | undefined => {
  const s = str(v);
  return s && /^https?:\/\/\S+$/i.test(s) ? s : undefined;
};
/** Accepts a string[] or a comma-separated string (the bundled JSON and the API differ). */
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    : typeof v === 'string'
      ? v.split(',').map((x) => x.trim()).filter(Boolean)
      : [];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CATEGORIES: Record<string, string> = { ai_ml: 'AI / ML', web: 'Web', game: 'Game', research: 'Research', tooling: 'Tooling', systems: 'Systems' };

function dateLabel(v: unknown): string | undefined {
  const m = /^(\d{4})-(\d{2})/.exec(str(v) ?? '');
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${MONTHS[+m[2] - 1]} ${m[1]}` : undefined;
}

function categoryLabel(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  return CATEGORIES[s] ?? s.replace(/_/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase());
}

export function signContent(p: Project, index: number, total: number, stopId: string): SignContent {
  const r = p as unknown as Record<string, unknown>;
  const links: SignContent['links'] = [];
  const gh = url(r.github_url);
  const demo = url(r.demo_url);
  if (gh) links.push({ id: 'github', label: 'GitHub', href: gh });
  if (demo) links.push({ id: 'demo', label: 'Live demo', href: demo });
  return {
    stopId,
    index,
    total,
    title: str(r.title) ?? 'Project',
    date: dateLabel(r.project_date ?? r.date),
    category: categoryLabel(r.category),
    context: str(r.context),
    summary: str(r.summary) ?? '',
    role: str(r.role),
    highlights: list(r.highlights).slice(0, 3),
    tech: list(r.tech_stack),
    links,
  };
}

// ---- job board (Tech Stack ledger + pinned notes for the non-featured projects) ---------------------------

export const JOB_BOARD_ID = 'job-board';
/** The notes half has room for six pinned notes; further projects are dropped from the board (the flat fallback lists them all). */
export const JOB_MAX_NOTES = 6;

export interface TechGroup {
  label: string;
  items: string[];
}

export interface NoteContent {
  /** `note-1` .. `note-n`; hit ids are `${id}-github` / `${id}-demo`. */
  id: string;
  title: string;
  category?: string;
  context?: string;
  date?: string;
  summary: string;
  tech: string[];
  links: { id: string; label: string; href: string }[];
}

export interface JobBoardContent {
  stopId: string;
  techTitle: string;
  notesTitle: string;
  tech: TechGroup[];
  notes: NoteContent[];
}

export function jobBoardContent(
  groups: readonly { label: string; items: readonly string[] }[],
  projects: Project[],
  techTitle: string,
  notesTitle: string,
): JobBoardContent {
  const shown = projects.slice(0, JOB_MAX_NOTES);
  return {
    stopId: JOB_BOARD_ID,
    techTitle,
    notesTitle,
    tech: groups.map((g) => ({ label: g.label, items: [...g.items] })).filter((g) => g.items.length > 0),
    notes: shown.map((p, i) => {
      const c = signContent(p, i + 1, shown.length, JOB_BOARD_ID);
      return { id: `note-${i + 1}`, title: c.title, category: c.category, context: c.context, date: c.date, summary: c.summary, tech: c.tech, links: c.links };
    }),
  };
}