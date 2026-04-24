/** @file Engine constants and shared enums used across renderer + tooling. */

/** Panel dimension in cells. */
export const PANEL = 48

/** @enum {string} Terrain type identifiers */
export const T = Object.freeze({
  OCEAN: 'OCEAN',
  LAND: 'LAND',
  LAKE: 'LAKE',
  ROAD: 'ROAD',
  FOREST: 'FOREST',
  WATERROAD: 'WATERROAD',
  CLIFF: 'CLIFF',
  CLIFF_DOUBLE: 'CLIFF_DOUBLE',
  CLIFF_DOUBLE_PART2: 'CLIFF_DOUBLE_PART2',
  GRASS: 'GRASS',
})

/** @enum {number} Biome indices (panelData[key].biome) */
export const BIOME = Object.freeze({
  LUSH: 0,
  HIGHLAND: 1,
  ENCHANTED: 2,
  AUTUMN: 3,
  TROPICAL: 4,
  VOLCANIC: 5,
})

export const BIOME_NAMES = Object.freeze([
  'Lush',
  'Highland',
  'Enchanted',
  'Autumn',
  'Tropical',
  'Volcanic',
])

/** @type {Object} Color palette configuration (RGB arrays) — aligned with UI token / terrain art direction */
export const PALETTE = {
  [T.OCEAN]: [27, 58, 82], // #1B3A52 — desaturated vs legacy electric blue
  [T.LAKE]: [90, 158, 194], // #5A9EC2 — sits with earthy tones
  [T.ROAD]: [160, 120, 80], // #A07850 — warmer, worn
  [T.WATERROAD]: [122, 110, 138], // #7A6E8A — muted slate-purple (replaces debug magenta)
  [T.FOREST]: [22, 36, 24], // #162418
  [T.CLIFF]: [92, 64, 48],          // #5C4030 — standard cliff face
  [T.CLIFF_DOUBLE]: [72, 44, 28],   // #482C1C — darker double cliff face
  [T.CLIFF_DOUBLE_PART2]: [52, 28, 16], // #341C10 — deepest double cliff base
  [T.GRASS]: [138, 154, 56], // #8A9A38 — cooler, natural
  /** Elevation-based land levels (Index 1-6) */
  LAND_LEVELS: [
    null,
    [74, 122, 80], // 1 #4A7A50
    [94, 143, 98], // 2 #5E8F62
    [122, 168, 122], // 3 #7AA87A
    [157, 196, 154], // 4 #9DC49A
    [196, 216, 191], // 5 #C4D8BF
    [234, 230, 221], // 6 #EAE6DD
  ],
}

const clonePalette = (p) => ({
  [T.OCEAN]: [...p[T.OCEAN]],
  [T.LAKE]: [...p[T.LAKE]],
  [T.ROAD]: [...p[T.ROAD]],
  [T.WATERROAD]: [...p[T.WATERROAD]],
  [T.FOREST]: [...p[T.FOREST]],
  [T.CLIFF]: [...p[T.CLIFF]],
  [T.CLIFF_DOUBLE]: [...p[T.CLIFF_DOUBLE]],
  [T.CLIFF_DOUBLE_PART2]: [...p[T.CLIFF_DOUBLE_PART2]],
  [T.GRASS]: [...p[T.GRASS]],
  LAND_LEVELS: p.LAND_LEVELS.map(v => (v ? [...v] : v)),
})

/** Biome palettes. For now, all biomes copy the Default/Temperate `PALETTE`. */
export const BIOME_PALETTES = Object.freeze({
  [BIOME.LUSH]: (() => {
    const p = clonePalette(PALETTE)
    p[T.GRASS] = [34, 100, 44]  // #226428 — Dark scrub grass
    p[T.FOREST] = [22, 88, 72]  // #165848 — Deep green-teal canopy
    p[T.ROAD] = [100, 68, 40]   // #644428 — dark brown
    p[T.CLIFF] = [110, 84, 44]           // #6E542C — sandstone cliff
    p[T.CLIFF_DOUBLE] = [86, 64, 30]     // #56401E
    p[T.CLIFF_DOUBLE_PART2] = [62, 44, 18] // #3E2C12
    p.LAND_LEVELS = [
      null,
      [140, 200, 170], // 1 #8CC8AA — Deep mint
      [158, 212, 184], // 2 #9ED4B8 — Mid mint
      [176, 222, 198], // 3 #B0DEC6 — Bright mint
      [194, 232, 212], // 4 #C2E8D4 — Pale mint
      [210, 240, 224], // 5 #D2F0E0 — Soft mint
      [226, 248, 236], // 6 #E2F8EC — Pastel peak
    ]
    return Object.freeze(p)
  })(),
  [BIOME.HIGHLAND]: (() => {
    const p = clonePalette(PALETTE)
    p[T.GRASS] = [110, 125, 100] // #6E7D64
    p[T.FOREST] = [240, 244, 247] // #F0F4F7
    p[T.ROAD] = [100, 68, 40]   // #644428 — dark brown
    p[T.CLIFF] = [100, 108, 108]          // #646C6C — slate grey cliff
    p[T.CLIFF_DOUBLE] = [76, 84, 84]      // #4C5454
    p[T.CLIFF_DOUBLE_PART2] = [54, 60, 60] // #363C3C
    p.LAND_LEVELS = [
      null,
      [74, 107, 80], // 1 #4A6B50
      [96, 122, 98], // 2 #607A62
      [128, 150, 128], // 3 #809680
      [155, 173, 173], // 4 #9BADAD
      [184, 194, 194], // 5 #B8C2C2
      [209, 217, 217], // 6 #D1D9D9
    ]
    return Object.freeze(p)
  })(),
  [BIOME.ENCHANTED]: (() => {
    const p = clonePalette(PALETTE)
    p[T.FOREST] = [224, 158, 182] // #E09EB6 — Pastel sakura pink
    p[T.GRASS] = [115, 100, 145] // #736491 — Lavender fields
    p[T.ROAD] = [100, 68, 40]   // #644428 — dark brown
    p[T.CLIFF] = [72, 52, 96]           // #483460 — deep violet cliff
    p[T.CLIFF_DOUBLE] = [54, 36, 76]    // #36244C
    p[T.CLIFF_DOUBLE_PART2] = [38, 24, 56] // #261838
    p.LAND_LEVELS = [
      null,
      [69, 58, 96], // 1 #453A60 — Dark indigo base
      [93, 82, 122], // 2 #5D527A — Purple-hued hills
      [123, 112, 150], // 3 #7B7096 — Misty violet
      [157, 146, 181], // 4 #9D92B5 — Ethereal slopes
      [191, 183, 212], // 5 #BFB7D4 — Glowing plateau
      [222, 218, 235], // 6 #DEDAEB — Pure magic mist
    ]
    return Object.freeze(p)
  })(),
  [BIOME.AUTUMN]: (() => {
    const p = clonePalette(PALETTE)
    p[T.FOREST] = [220, 130, 50] // #DC8232 — Saturated orange canopy
    p[T.GRASS] = [172, 108, 80] // #AC6C50 — reddish light brown
    p[T.ROAD] = [100, 68, 40]   // #644428 — dark brown
    p[T.CLIFF] = [108, 68, 36]           // #6C4424 — warm ochre cliff
    p[T.CLIFF_DOUBLE] = [84, 50, 24]     // #543218
    p[T.CLIFF_DOUBLE_PART2] = [60, 34, 14] // #3C220E
    p.LAND_LEVELS = [
      null,
      [180, 148, 100], // 1 #B49464 — Light ochre
      [196, 164, 116], // 2 #C4A474
      [210, 180, 132], // 3 #D2B484
      [222, 196, 152], // 4 #DEC498
      [234, 212, 172], // 5 #EAD4AC
      [244, 228, 196], // 6 #F4E4C4
    ]
    return Object.freeze(p)
  })(),
  [BIOME.TROPICAL]: (() => {
    const p = clonePalette(PALETTE)
    p[T.ROAD] = [100, 68, 40]   // #644428 — dark brown
    p.LAND_LEVELS = [
      null,
      [190, 164, 100], // 1 #BEA464 — Dry sand
      [204, 180, 118], // 2 #CCB476 — Warm sand
      [216, 194, 136], // 3 #D8C288 — Light sand
      [226, 208, 156], // 4 #E2D09C — Pale sand
      [236, 220, 174], // 5 #ECDCAE — Bleached sand
      [244, 232, 196], // 6 #F4E8C4 — Dusty peak
    ]
    return Object.freeze(p)
  })(),
  [BIOME.VOLCANIC]: (() => {
    const p = clonePalette(PALETTE)
    p[T.GRASS] = [75, 75, 80] // #4B4B50 — Cold ash
    p[T.FOREST] = [30, 28, 30] // #1E1C1E — Near black
    p[T.ROAD] = [100, 68, 40]   // #644428 — dark brown
    p[T.CLIFF] = [90, 86, 82]             // #5A5652 — dark grey cliff
    p[T.CLIFF_DOUBLE] = [68, 64, 60]      // #44403C
    p[T.CLIFF_DOUBLE_PART2] = [48, 44, 40] // #302C28
    p.LAND_LEVELS = [
      null,
      [56, 56, 56], // 1 #383838 — Basalt
      [77, 77, 77], // 2 #4D4D4D
      [102, 102, 102], // 3 #666666
      [133, 133, 133], // 4 #858585
      [168, 168, 168], // 5 #A8A8A8
      [204, 204, 204], // 6 #CCCCCC — Dense smoke/ash
    ]
    return Object.freeze(p)
  })(),
})

// Geographic thresholds
/** Continuous elevation at/below this is water; raising shrinks land, lowering expands it. */
export const SEA_LEVEL = 0.15

/** Default world size in panels (Layout Generator UI). */
export const DEFAULT_MAP_WIDTH = 16
export const DEFAULT_MAP_HEIGHT = 16

/** Allowed inclusive range for world width/height in panels. */
const MAP_PANELS_MIN = 1
const MAP_PANELS_MAX = 128

/**
 * @param {unknown} n
 * @param {number} fallback
 * @returns {number}
 */
export function clampMapPanels(n, fallback = DEFAULT_MAP_WIDTH) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(MAP_PANELS_MIN, Math.min(MAP_PANELS_MAX, Math.round(v)))
}

