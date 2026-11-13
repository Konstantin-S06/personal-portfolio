import { useEffect, useState } from 'react';
import { API_BASE_URL, USE_BUNDLED_DATA } from '../config';
import seed from '../data/projects.json';

export type ProjectCategory = 'web' | 'ai_ml' | 'systems' | 'game' | 'research' | 'tooling';

export interface Project {
  id: number;
  title: string;
  description: string;
  tech_stack: string; // comma-separated; split client-side into tags
  github_url: string | null;
  project_date: string | null; // YYYY-MM-DD
  summary: string | null;
  role: string | null;
  context: string | null;
  highlights: string[];
  category: ProjectCategory | null;
  featured: 0 | 1;
  sort_order: number;
  demo_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const FETCH_TIMEOUT_MS = 6000;
const CATEGORIES: ProjectCategory[] = ['web', 'ai_ml', 'systems', 'game', 'research', 'tooling'];

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Coerce an API row or seed-file row into a fully populated Project. */
function normalize(raw: Record<string, unknown>, index: number): Project {
  const hl = raw.highlights;
  const cat = raw.category as ProjectCategory;
  return {
    id: typeof raw.id === 'number' ? raw.id : -(index + 1), // seed rows have no id; negative never collides
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    tech_stack: String(raw.tech_stack ?? ''),
    github_url: str(raw.github_url),
    project_date: str(raw.project_date),
    summary: str(raw.summary),
    role: str(raw.role),
    context: str(raw.context),
    highlights: Array.isArray(hl) ? hl.filter((h): h is string => typeof h === 'string') : [],
    category: CATEGORIES.includes(cat) ? cat : null,
    featured: Number(raw.featured) === 1 ? 1 : 0,
    sort_order: typeof raw.sort_order === 'number' ? raw.sort_order : 100,
    demo_url: str(raw.demo_url),
    created_at: str(raw.created_at),
    updated_at: str(raw.updated_at),
  };
}

// The seed file is either a bare array or `{ projects: [...] }` (the shape backend/projects.json now has).
const bundled = (): Project[] => {
  const rows = (Array.isArray(seed) ? seed : (seed as { projects: unknown[] }).projects) as Record<string, unknown>[];
  return rows.map(normalize);
};

/** An API response is accepted only if it is a non-empty array and EVERY item has the fields the UI depends on. */
function isValidApiList(list: unknown): list is Record<string, unknown>[] {
  return (
    Array.isArray(list) &&
    list.length > 0 &&
    list.every((r) => {
      if (typeof r !== 'object' || r === null) return false;
      const o = r as Record<string, unknown>;
      return (
        typeof o.title === 'string' &&
        typeof o.tech_stack === 'string' &&
        (o.featured === 0 || o.featured === 1) &&
        typeof o.sort_order === 'number' &&
        Array.isArray(o.highlights)
      );
    })
  );
}

/** Same ordering the API uses: featured first, sort_order ascending, newest project_date first. */
export function sortProjects(list: Project[]): Project[] {
  return [...list].sort(
    (a, b) =>
      b.featured - a.featured ||
      a.sort_order - b.sort_order ||
      (b.project_date ?? '').localeCompare(a.project_date ?? ''),
  );
}

let cache: Project[] | null = null;
let inflight: Promise<Project[]> | null = null;

/** API first (6s timeout); bundled seed on failure or empty result. Cached in memory. */
export function loadProjects(): Promise<Project[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;

  inflight = (async () => {
    if (USE_BUNDLED_DATA) {
      cache = sortProjects(bundled());
      console.info(`[projects] source: bundled (VITE_USE_BUNDLED_DATA=1, no fetch), ${cache.length} projects`);
      inflight = null;
      return cache;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      const list = Array.isArray(body) ? body : (body as { projects?: unknown } | null)?.projects;
      if (!isValidApiList(list)) throw new Error('response is not a non-empty array of well-formed projects');
      cache = sortProjects(list.map(normalize));
      console.info(`[projects] source: API (${API_BASE_URL}), ${cache.length} projects`);
    } catch (err) {
      cache = sortProjects(bundled());
      console.info(`[projects] source: bundled fallback (${err instanceof Error ? err.message : err}), ${cache.length} projects`);
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
    return cache;
  })();
  return inflight;
}

/** Bundled data immediately (no blank frame), replaced by API data when it arrives. */
export function useProjects(): Project[] {
  const [projects, setProjects] = useState<Project[]>(() => cache ?? sortProjects(bundled()));
  useEffect(() => {
    let alive = true;
    loadProjects().then((p) => alive && setProjects(p));
    return () => {
      alive = false;
    };
  }, []);
  return projects;
}

export const techTags = (stack: string): string[] =>
  stack.split(',').map((t) => t.trim()).filter(Boolean);
