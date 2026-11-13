import { useEffect, useState } from 'react';

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const webgl = typeof document !== 'undefined' && hasWebGL();

const reducedQuery = '(prefers-reduced-motion: reduce)';
const narrowQuery = '(max-width: 767px)';

const compute = () =>
  webgl && !matchMedia(reducedQuery).matches && !matchMedia(narrowQuery).matches;

/** true => pinned 3D journey; false => plain document sections, no canvas. */
export function usePinnedMode(): boolean {
  const [pinned, setPinned] = useState(compute);
  useEffect(() => {
    const qs = [matchMedia(reducedQuery), matchMedia(narrowQuery)];
    const update = () => setPinned(compute());
    qs.forEach((q) => q.addEventListener('change', update));
    return () => qs.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return pinned;
}
