// Every tunable number of the visual detail pass lives here. Nothing in the other scene files hard-codes a
// look value; if the scene is too heavy, scale the COUNTS in sections 2, 4, 5 and 6 down first.
// Colours are 0xRRGGBB (sRGB). Distances are world units (1 unit is roughly 1 metre; a plan cell is 4 units).

/** Seed for every deterministic scatter (props, banners, mist, dust). */
export const SEED = 20260;

// ---- 0. Outdoor world (world.ts) ----------------------------------------------------------------------
// Budgets: <=120 draw calls, <=4 dynamic lights, no shadow maps, DPR capped at 1.5.
// Nature-kit path uses GLB instances; procedural primitives are the fallback if loading fails.
// Scale these COUNTS down first if the scene is too heavy.
export const DPR_CAP = 1.5;
export const MAX_DYNAMIC_LIGHTS = 4;
export const MAX_DRAW_CALLS = 120;
/** No shadow maps (renderer.shadowMap.enabled stays false). */
export const SHADOW_MAPS = false;

export const WORLD_SEED = 7;
export const PATH_CLEARANCE = 1.7; // nothing sits closer than this to the camera path
export const PATH_EXTEND = 60; // scatter continues this far past the curve end
export const TREE_SCALE_VAR = 0.2; // +-20% for kit models
export const TREE_COLOR_VAR = 0.1; // +-10% (procedural only)
export const PROP_SCALE_VAR = 0.2;

/** Instance counts for the outdoor world (kit roles + procedural fallback kinds). */
export const COUNTS = {
  // Kit scatter (used when nature GLBs load)
  kitConifer: 55,
  kitRound: 50,
  kitBirch: 35,
  kitBush: 90,
  kitPlant: 110,
  kitGrass: 160,
  kitRock: 85,
  kitLog: 18,
  // Procedural fallback
  pine: 140,
  deciduous: 100,
  birch: 70,
  rocks: 70,
  bushes: 180,
  grass: 350,
  ferns: 140,
  flowers: 20, // small stemmed flowers near the path
  mushrooms: 0,
  stumps: 28,
  logs: 22,
  boulderClusters: 10, // each cluster places 3–5 boulders
  fireflies: 220,
  mistPlanes: 14,
  lightShafts: 0,
};

/** Spatial chunks are ~CHUNK_SIZE × CHUNK_SIZE on the ground plane. */
export const CHUNK_SIZE = 30;
export const CHUNK_LENGTH = 30; // kept for procedural Z-slicing fallback
export const CHUNK_VISIBLE_DIST = 70;       // was 85 (keep equal to WORLD_FOG_FAR)
export const WORLD_FOG_COLOR = 0x343262;    // was 0xbcd6ea (dusk violet)
export const WORLD_FOG_NEAR = 6;            // was 10
export const WORLD_FOG_FAR = 70;            // was 85 (thicker fog hides weak distant detail)

export const GROUND_MARGIN = 55; // ground extends this far past the outermost prop

export const FIREFLY_SIZE = 0.1;
export const FIREFLY_OPACITY = 0.95;
export const FIREFLY_DRIFT = 0.35;
export const FIREFLY_PULSE = 0.6;

export const MIST_OPACITY_OUTDOOR = 0.12;
export const MIST_LIFT_OUTDOOR = 0.35;
export const MIST_SCROLL_OUTDOOR = 0.004;
export const MIST_SIZE_OUTDOOR: [number, number] = [18, 28];
export const MIST_COLOR_OUTDOOR = 0x6f7fb8;

export const SHAFT_COLOR_OUTDOOR = 0xffe6b0;
export const SHAFT_STRENGTH_OUTDOOR = 0.35;
export const SHAFT_RADIUS_OUTDOOR = 1.6;

export const CAMPFIRE_CLEARING = 11; // keep trees/rocks out of the Contact clearing
export const CAMPFIRE_LIGHT_INTENSITY = 3.2;
export const CAMPFIRE_LIGHT_DISTANCE = 26;
export const CAMPFIRE_LIGHT_COLOR = 0xff9a4a;
export const CAMPFIRE_FLAME_COLOR = 0xffa040;

export const TREE_COLORS = {
  pineTrunk: 0x3a2a24,
  pineNeedle: 0x24504f,
  deciduousTrunk: 0x4a3a30,
  deciduousLeaf: 0x3b6b63,
  birchTrunk: 0xc9c6d6,
  birchLeaf: 0x5f8f7e,
};
export const PROP_COLORS_OUTDOOR = {
  rock: [0x5a5f78, 0x4c5068, 0x686b82],
  bush: [0x2f5f58, 0x3a6e63, 0x28524d],
  grass: [0x3f7a5a, 0x4a8a64, 0x357055],
  fern: [0x2f6a5a, 0x3b7a66],
  flower: [0xff8fa3, 0xffd27a, 0xb69cff],
  mushroomStem: 0xd8d0e0,
  mushroomCap: [0xd9607a, 0xc9b6e8, 0x8b5a8c],
  stump: 0x4a3a30,
  log: 0x3a2c26,
};

// ---- 1. Zones ------------------------------------------------------------------------------------------
// Zones are split by the door cells of the plan, walking from the start of the path: corridor | door |
// chamber | door | final hall. The camera's z blends between the two neighbouring looks across ZONE_BLEND.
export const ZONE_BLEND = 5;

export interface ZoneLook {
  fog: number;
  hemiSky: number;
  hemiGround: number;
  torch: number;
  /** Multiplies kit instance colours inside the zone. */
  tint: [number, number, number];
  dust: number;
  /** Hemisphere light intensity (the chamber is a big room, so it gets more fill). */
  hemiIntensity: number;
}

export const ZONE_LOOKS: ZoneLook[] = [
  // corridor: cold blue-grey
  { fog: 0x0a1018, hemiSky: 0x7f95bd, hemiGround: 0x18202c, torch: 0xffc79c, tint: [0.9, 0.98, 1.12], dust: 0x9fb4d8, hemiIntensity: 1.0 },
  // chamber: warm amber
  { fog: 0x2a1608, hemiSky: 0xd8a064, hemiGround: 0x2e1a0a, torch: 0xff9a3c, tint: [1.14, 1.0, 0.84], dust: 0xffc890, hemiIntensity: 2.2 },
  // final hall: gold and deep violet
  { fog: 0x130824, hemiSky: 0x8a5cd0, hemiGround: 0x7a5a16, torch: 0xffd36a, tint: [1.1, 0.97, 1.1], dust: 0xe0b8ff, hemiIntensity: 1.6 },
];

export const TORCH_INTENSITY = 40;
export const TORCH_DISTANCE = 22;
export const TORCH_DECAY = 2;

// ---- 2. Kit instance colour variation -------------------------------------------------------------------
export const KIT_BRIGHTNESS_VARIATION = 0.08; // +-8%

// ---- 3. Post stack (pmndrs postprocessing) -------------------------------------------------------------
// The scene renders in HDR; emissive things are scaled far above 1 so a high threshold isolates them from lit
// walls (a wall right next to a torch peaks around 5).
export const BLOOM_THRESHOLD = 6;
export const BLOOM_SMOOTHING = 3;
export const BLOOM_INTENSITY = 0.85;
export const BLOOM_RADIUS = 0.75;
export const BLOOM_LEVELS = 5; // mip levels of the blur chain; each costs about two draw calls
export const BLOOM_RESOLUTION_SCALE = 0.5; // half resolution
export const POST_MSAA = 4;
export const VIGNETTE_OFFSET = 0.3;
export const VIGNETTE_DARKNESS = 0.55;
export const GRAIN_OPACITY = 0.09;

/** Emissive colours are multiplied by this: HDR when post is on, a mild boost when it is off. */
export const GLOW_LDR_SCALE = 1.5;

// ---- 4. Ambient animation ------------------------------------------------------------------------------
// The world used to render only on scroll. Flicker, drifting dust and camera sway need a clock, so an extra
// low-rate loop redraws while the canvas is on screen and the tab is visible. 0 disables it (the scene then
// animates only while scrolling).
export const AMBIENT_FPS = 30;

// Flames (torches, braziers, chandelier, candles) share one flicker uniform.
export const FLAME_COLOR = 0xffa850; // overridden per zone by the torch colour
export const FLAME_HDR_SCALE = 22;
export const FLICKER_AMPLITUDE = 0.28;
export const FLAME_STRETCH = 0.5; // how much the flicker stretches a flame vertically
export const FLAME_BRIGHTNESS_SWING = 0.35;
export const TORCH_FLICKER_AMOUNT = 0.18; // fraction of light intensity that follows the flicker

// ---- 5. Dust, light shafts, ground mist --------------------------------------------------------------------
export const DUST_COUNT = 400;
export const DUST_BOX: [number, number, number] = [14, 6, 16];
export const DUST_SIZE = 0.045;
export const DUST_OPACITY = 0.55;
export const DUST_DRIFT = 0.05;

export const SHAFT_COUNT = 4;
export const SHAFT_RADIUS = 1.25;
export const SHAFT_COLOR = 0xffc27a;
export const SHAFT_STRENGTH = 0.55;

export const MIST_CHAMBER_COUNT = 4;
export const MIST_HALL_COUNT = 3;
export const MIST_SIZE: [number, number] = [14, 22];
export const MIST_LIFT = 0.22; // above the floor
export const MIST_OPACITY = 0.17;
export const MIST_SCROLL = 0.006; // texture offset per second
export const MIST_COLORS = [0xd9a56c, 0x9a74dc]; // chamber, hall

// ---- 6. Props ------------------------------------------------------------------------------------------
export const BRAZIER_OFFSET = 0.95; // from the pillar
export const BRAZIER_HEIGHT = 0.95;
export const BRAZIER_FLAME_SCALE = 1.7;

export const CHANDELIER_RADIUS = 1.5;
export const CHANDELIER_Y = 3.1;
export const CHANDELIER_CANDLES = 12;
export const CHANDELIER_FLAME_SCALE = 0.55;
export const CHANDELIER_CHAINS = 3;

export const TABLE_CANDLES = 6;
export const TABLE_BOOK_STACKS = 3;
export const TABLE_BOOKS_PER_STACK = 4;
export const TABLE_SCROLLS = 4;
export const TABLE_FLAME_SCALE = 0.3;

export const BARREL_COUNT = 12;
export const CRATE_COUNT = 10;
export const RUBBLE_PILES = 6;
export const RUBBLE_PER_PILE = 5;
export const BANNER_DECOR_COUNT = 14;
export const CHAIN_COUNT = 10;
export const CHAIN_LINKS = 8;
export const PROP_PATH_CLEARANCE = 1.15; // props keep this far from the camera path
export const PROP_WALL_MARGIN = 0.7;
export const PROP_SIGHT_CLEARANCE = 1.2; // props keep this far from the line between a stop's camera spot and its banner

export const PROP_COLORS = {
  wood: [0x5a3d26, 0x6b4a2f, 0x4d3422],
  crate: [0x7a5a36, 0x6a4c2d, 0x86653d],
  stone: [0x5f5a56, 0x6c6762, 0x514d4a],
  metal: [0x2a2724],
  cloth: [0x6e1f27, 0x1f3a5e, 0x6a5516, 0x3b2152],
  book: [0x7a2a2a, 0x2a4a6a, 0x3c5a34, 0x6a5a2a],
  parchment: [0xd8c8a0],
  candle: [0xe8dcc0],
};

// ---- 7. Floor rune lines along the camera path ---------------------------------------------------------
export const RUNE_COLOR = 0x6fe0ff;
export const RUNE_HDR_SCALE = 4.5;
export const RUNE_LINE_OFFSET = 0.95; // either side of the path
export const RUNE_LINE_WIDTH = 0.3;
export const RUNE_SPACING = 0.6; // arc length between ribbon samples
export const RUNE_TILE_LENGTH = 1.3; // one glyph repeat
export const RUNE_AHEAD_NEAR = 5; // fully visible this far ahead of the camera ...
export const RUNE_AHEAD_FAR = 22; // ... and gone beyond this
export const RUNE_BEHIND = 2.5;
export const RUNE_LIFT = 0.025;
export const RUNE_SCROLL = 0.25; // glyph slide along the path, repeats per second

// ---- 8. Banners, rune numerals, seat highlight ------------------------------------------------------
export const BANNER_TEX_W = 1024;
export const BANNER_TEX_H = 512;
export const BANNER_ATLAS_COLS = 2;
export const BANNER_W = 3.2;
export const BANNER_H = 1.6;
export const BANNER_Y = 2.25; // centre height above the floor
export const BANNER_WALL_GAP = 0.07;
export const BANNER_DIM = 0.28;
export const BANNER_BRIGHT = 1.5;
export const BANNER_NEAR = 6; // a banner is fully bright while the camera is within this of the stop's camera position
export const BANNER_FADE = 3;
export const BANNER_FACING_BONUS = 2; // distance credit for a wall the camera faces at the stop (0 = nearest only)
export const BANNER_FONT_FALLBACK = 'Georgia, "Times New Roman", serif';
export const BANNER_TITLE_PX = 104;
export const BANNER_CONTEXT_PX = 34;
export const BANNER_BG = ['#1b1426', '#0e0a16'];
export const BANNER_BORDER = '#c9a24a';
export const BANNER_TEXT = '#f3e2b3';
export const BANNER_CONTEXT_TEXT = '#bda878';

export const NUMERAL_SIZE = 0.75;
export const NUMERAL_Y = 2.55;
export const NUMERAL_BOB = 0.05;
export const NUMERAL_COLOR = 0x7fe8ff;
export const NUMERAL_HDR_SCALE = 14;
export const NUMERAL_DIM = 0.1;
export const NUMERAL_BRIGHT = 1.0;

export const SEAT_RING_INNER = 1.0;
export const SEAT_RING_OUTER = 1.45;
export const SEAT_RING_DIM = 0.1;
export const SEAT_RING_BRIGHT = 1.0;
export const SEAT_RING_HDR_SCALE = 14;
export const SEAT_ARC_FULL = 2; // camera within this arc length of seat N's stop: seat N is fully reached ...
export const SEAT_ARC_FADE = 7; // ... fading to not reached at this arc distance
export const SEAT_EASE = 5; // per second
export const SEAT_LIGHT_COLOR = 0x9fe8ff;
export const SEAT_LIGHT_INTENSITY = 60;
export const SEAT_LIGHT_HEIGHT = 2.9;
export const SEAT_LIGHT_DISTANCE = 8;

// ---- 9. Camera feel ------------------------------------------------------------------------------------
export const SWAY_AMPLITUDE = 0.03; // hard cap on the offset length, world units
export const SWAY_SPEED = 0.8; // radians per second, base
export const ROLL_MAX_DEG = 1.5;
export const ROLL_DEG_PER_RAD = 3; // degrees of roll per radian of path heading change across ROLL_WINDOW
export const ROLL_WINDOW = 2.5; // arc length either side of the camera used to measure the turn

// ---- 10. World-space sky (sky.ts) ----------------------------------------------------------------------
export const SKY_TEX_W = 2048; // equirectangular width; height is half (dome) / SKY_RING_TEX_H (ring)
export const SKY_DOME_RADIUS = 160; // must stay inside the camera far plane (220)
export const SKY_STAR_COUNT = 420; // spread over the whole sphere
export const SKY_STAR_SIZE_PX: [number, number] = [1.0, 2.0]; // CSS pixels, min..max (most stars are near the min)
export const SKY_MOON_AZIMUTH_DEG = 25; // 0 = straight down the path (-z), positive = to the right
export const SKY_MOON_ELEV_DEG = 24;
export const SKY_MOON_RADIUS_DEG = 1.6;
export const SKY_RING_RADIUS = 120; // silhouette ring: hills and tree line, beyond the fog far plane
export const SKY_RING_HEIGHT = 26;
export const SKY_RING_SINK = 3; // ring extends this far below y = 0
export const SKY_RING_TEX_H = 256;
/** true: sky is tone-mapped like the fogged forest, so the horizon matches distant fog exactly. */
export const SKY_TONE_MAPPED = true;

// ---- 11. Wooden signposts (boards.ts) ------------------------------------------------------------------
export const SIGN_OFFSET = 3.0; // sign centre, sideways from the path (alternates left and right)
export const SIGN_CLAIM = 1.9; // ground reserved around each sign so scatter keeps clear
export const SIGN_BOARD_Y = 2.05; // height of the board centre
export const SIGN_YAW = 0.26; // radians the board turns toward visitors still approaching along the path
export const SIGN_DIST = 2.75; // camera distance from the board when parked (wider screens never go closer)
export const SIGN_EMISSIVE = 0.3; // lettering stays readable at dusk; lower = more in-world, higher = brighter
export const SIGN_HOLD = 0.06; // fraction of the gap to the neighbouring stop where the camera is fully parked
export const SIGN_BLEND = 0.5; // fraction of the gap over which the camera eases to and from the sign
export const SIGN_EASE = 0.5; // seconds: time constant of the camera's glide to and from a sign (bigger = slower)
export const SIGN_FRAME_BRIGHT = 1.7; // multiplies the frame's wood colours so posts and roof are not black at dusk

// ---- 12. Job board (jobBoard.ts): Tech Stack ledger on the left half, pinned notes on the right ----------------
export const JOB_SIDE = -1; // -1 = left of the path. On the left the board's +x runs along the walking direction, so the tech half is met first and the notes second
export const JOB_OFFSET = 3.4; // board centre, sideways from the path (the board is two signs wide, so it stands a little further out)
export const JOB_CLAIM = 1.9; // ground reserved around each third of the board so scatter keeps clear
export const JOB_SPLIT = 0.36; // share of the sheet's width given to the tech ledger; the rest holds the notes
export const JOB_DIST = 2.35; // camera distance from the board when parked (narrower screens never go closer than JOB_VIEW_K / aspect)
export const JOB_VIEW_K = 4.0;
export const JOB_EMISSIVE = SIGN_EMISSIVE;
export const JOB_HOLD = 0.06; // as SIGN_HOLD / SIGN_BLEND / SIGN_EASE, for the board as a whole
export const JOB_BLEND = 0.5;
export const JOB_EASE = 0.5; // seconds: time constant of the glide onto and off the board, and of the slide between its halves
export const JOB_SLIDE_HOLD = 0.12; // fraction of the tech-to-notes gap spent parked at each half before the camera slides across