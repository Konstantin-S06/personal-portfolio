/**
 * Scroll timeline shared by stops.ts (chapter ranges) and world.ts (camera).
 * Overall progress 0..1 splits into: the forest walk (0..WALK_END), the walk past the fire and into the
 * throne room (WALK_END..THRONE_END), and a hold at the throne (THRONE_END..1).
 */
export const WALK_END = 0.66;
export const THRONE_END = 0.93;
/** Progress at which the chat chapter is centred (camera parked at the throne). */
export const CHAT_CENTER = 0.97;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Progress along the original forest curve (0..1) for an overall progress value. */
export const walkProgress = (p: number): number => clamp01(p / WALK_END);

/** 0 until the walk ends, 1 once the camera sits at the throne. */
export const throneProgress = (p: number): number => clamp01((p - WALK_END) / (THRONE_END - WALK_END));
