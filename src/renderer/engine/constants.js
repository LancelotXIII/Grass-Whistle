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
  [T.CLIFF]: [92, 64, 48], // #5C4030 — reads on dark maps
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
  [T.GRASS]: [...p[T.GRASS]],
  LAND_LEVELS: p.LAND_LEVELS.map(v => (v ? [...v] : v)),
})

/** Biome palettes. For now, all biomes copy the Default/Temperate `PALETTE`. */
export const BIOME_PALETTES = Object.freeze({
  [BIOME.LUSH]: clonePalette(PALETTE),
  [BIOME.HIGHLAND]: (() => {
    const p = clonePalette(PALETTE)
    p[T.GRASS] = [110, 125, 100] // #6E7D64
    p[T.FOREST] = [240, 244, 247] // #F0F4F7
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
    p[T.FOREST] = [40, 25, 60] // #28193C — Deep plum woods
    p[T.GRASS] = [115, 100, 145] // #736491 — Lavender fields
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
    p[T.FOREST] = [200, 116, 42] // #C8742A
    p[T.GRASS] = [122, 92, 36] // #7A5C24
    p.LAND_LEVELS = [
      null,
      [122, 92, 56], // 1 #7A5C38
      [146, 108, 66], // 2 #926C42
      [170, 128, 80], // 3 #AA8050
      [196, 154, 106], // 4 #C49A6A
      [217, 191, 150], // 5 #D9BF96
      [237, 216, 188], // 6 #EDD8BC
    ]
    return Object.freeze(p)
  })(),
  [BIOME.TROPICAL]: (() => {
    const p = clonePalette(PALETTE)
    p[T.GRASS] = [38, 166, 91] // #26A65B
    p[T.FOREST] = [8, 46, 38] // #082E26
    p.LAND_LEVELS = [
      null,
      [14, 77, 49], // 1 #0E4D31
      [27, 107, 70], // 2 #1B6B46
      [45, 140, 97], // 3 #2D8C61
      [82, 179, 138], // 4 #52B38A
      [140, 217, 185], // 5 #8CD9B9
      [194, 240, 222], // 6 #C2F0DE
    ]
    return Object.freeze(p)
  })(),
  [BIOME.VOLCANIC]: (() => {
    const p = clonePalette(PALETTE)
    p[T.GRASS] = [75, 75, 80] // #4B4B50 — Cold ash
    p[T.FOREST] = [30, 28, 30] // #1E1C1E — Charred stalks
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

