// Scene entry. Kit dungeon world stays behind USE_KIT_WORLD.
// Outdoor world loads curated nature GLBs (with progress); falls back to procedural primitives.
import type { World } from './world';

/** When false, never fetch or import the dungeon kit. Outdoor nature GLBs still load in pinned mode. */
export const USE_KIT_WORLD = false;

export type WorldLoadProgress = (loaded: number, total: number) => void;

/** Resolves to null when `isCancelled()` turns true while loading (nothing is left allocated in that case). */
export async function createBestWorld(
  canvas: HTMLCanvasElement,
  isCancelled: () => boolean,
  onProgress?: WorldLoadProgress,
): Promise<World | null> {
  // At most one world (one WebGL context) at a time: a stale one is disposed before a new one is created.
  current?.dispose();
  const world = await create(canvas, isCancelled, onProgress);
  if (!world) return null;
  const dispose = world.dispose.bind(world);
  const owned: World = {
    resize: world.resize,
    render: world.render,
    setLabels: world.setLabels?.bind(world),
    setProjectSigns: world.setProjectSigns?.bind(world),
    setJobBoard: world.setJobBoard?.bind(world),
    playContactBird: world.playContactBird?.bind(world),
    resetContactBird: world.resetContactBird?.bind(world),
    dispose() {
      if (current === owned) current = null;
      dispose();
    },
  };
  current = owned;
  return owned;
}

let current: World | null = null;

async function create(
  canvas: HTMLCanvasElement,
  isCancelled: () => boolean,
  onProgress?: WorldLoadProgress,
): Promise<World | null> {
  if (!USE_KIT_WORLD) {
    if (isCancelled()) return null;
    const { createWorld } = await import('./world');
    const world = await createWorld(canvas, { onProgress });
    return isCancelled() ? (world.dispose(), null) : world;
  }

  try {
    const { parsePlan } = await import('./plan');
    const { loadKit } = await import('./kit');
    const plan = parsePlan();
    const pieces = await loadKit(plan);
    if (isCancelled()) {
      pieces.dispose();
      return null;
    }
    const { createKitWorld } = await import('./kitWorld');
    if (isCancelled()) {
      pieces.dispose();
      return null;
    }
    return createKitWorld(canvas, plan, pieces);
  } catch (err) {
    console.warn('[scene] kit world unavailable, using the procedural fallback:', err);
    if (isCancelled()) return null;
    const { createWorld } = await import('./world');
    const world = await createWorld(canvas, { onProgress });
    return isCancelled() ? (world.dispose(), null) : world;
  }
}