import { createNoise2D } from 'simplex-noise';

import {
  PANEL,
  T,
  PALETTE,
  SEA_LEVEL,
  DEFAULT_MAP_WIDTH,
  DEFAULT_MAP_HEIGHT,
  clampMapPanels,
} from './engine/constants.js'

import { dir12, cliffTileIdx } from './engine/tiling.js'

// Back-compat exports (other modules still import these from `layoutGen.js`).
export {
  PANEL,
  T,
  PALETTE,
  SEA_LEVEL,
  DEFAULT_MAP_WIDTH,
  DEFAULT_MAP_HEIGHT,
  clampMapPanels,
  dir12,
  cliffTileIdx,
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation Tuning Constants
//
// All values that affect generation output live here. Centralising them means
// tuning a parameter does not require hunting through the pipeline, and any
// change is easy to spot in a diff. Changing any of these will alter the map
// produced for a given seed — there is no backwards-compat guarantee.
// ─────────────────────────────────────────────────────────────────────────────

// --- Terrain shape ---

/** Octave blend weights for the 6-octave FBM elevation pass (must sum to ~1.0). */
const FBM_WEIGHTS = [0.38, 0.26, 0.16, 0.10, 0.06, 0.04]

/** Domain-warp scale as a fraction of the shorter map dimension. */
const WARP_SCALE_FACTOR = 0.35

/** Minimum peak separation as a fraction of map width. */
const PEAK_MIN_SEP_FACTOR = 0.22

// --- Islands ---

/** Minimum number of panels a stamped island must cover before growth stops. */
const MIN_ISLAND_PANELS = 50

// --- Settlement viability ---

/** A panel must have at least this fraction of land tiles to host a settlement. */
const SETTLEMENT_VIABILITY_LAND = 0.75

/** At least this fraction of a panel's land tiles must share the dominant elevation. */
// PANEL is larger (e.g. 48×48), so requiring very high uniformity makes settlement panels rare.
const SETTLEMENT_VIABILITY_UNIFORMITY = 0.5

/** Minimum panel distance (Chebyshev) between any two settlement clusters. */
const SETTLEMENT_SPACING_RADIUS = 2

/** Hard cap: a settlement may occupy at most this many panels. */
const SETTLEMENT_MAX_PANELS = 2

// --- Forest ---

/** Simplex noise threshold above which a land cell becomes a forest blob cell (~8% coverage). */
const FOREST_BLOB_THRESHOLD = 0.68

/** Minimum inward depth (in pixels) of the forest border stamp around settlements. */
const FOREST_BORDER_DEPTH_MIN = 2

/** Maximum inward depth (in pixels) of the forest border stamp around settlements. */
const FOREST_BORDER_DEPTH_MAX = 6

// --- Grass ---

/** Simplex noise threshold above which a land cell becomes grass. */
const GRASS_BLOB_THRESHOLD = 0.55

/** Grass blobs smaller than this (in cells) are reverted to their prior terrain type. */
const GRASS_BLOB_MIN_SIZE = 32

/** Grass blobs larger than this (in cells) are trimmed back toward their centroid. */
const GRASS_BLOB_MAX_SIZE = 36

// --- A* panel-level routing costs ---

/** Movement cost for crossing a panel that is entirely water (ocean/lake dominant). */
const ASTAR_PANEL_WATER_DOMINANT_COST = 15.0

/** Movement cost for crossing a panel that contains some water but is not dominant. */
const ASTAR_PANEL_WATER_COST = 5.0

/**
 * Panel highway meander: Simplex noise scales move cost on land / existing route cells.
 * 0 = geometric shortest paths; ~0.45 yields visible winding without breaking connectivity.
 */
const PANEL_ROUTE_MEANDER_WEIGHT = 0.45

/** Noise frequency in panel space for {@link PANEL_ROUTE_MEANDER_WEIGHT} (lower = broader swells). */
const PANEL_ROUTE_MEANDER_SCALE = 0.34

// --- A* tile-level routing costs ---

/** Base cost for crossing a cliff tile that is part of a passable corridor. */
const ASTAR_TILE_CLIFF_PASSABLE_COST = 500

/** Cliff proximity penalties for waypoint cost functions (getStableEdgePoint etc.).
 *  Applied per Chebyshev distance to the nearest cliff: [dist1, dist2, dist3, dist4, dist5+]. */
const ASTAR_TILE_CLIFF_WAYPOINT_PENALTIES = [50000, 10000, 2000, 500, 0]

/** Cliff proximity penalties inside makeTileCost (road-stamp A*).
 *  Applied per Chebyshev distance to the nearest cliff: [dist1, dist2, dist3, dist4, dist5+]. */
const ASTAR_TILE_CLIFF_STAMP_PENALTIES = [200, 50, 10, 2, 0]

// --- Organic terrain blobs ---

/** Organic terrain blob regions smaller than this cell count are skipped. */
const ORGANIC_BLOB_MIN_REGION = 30

/**
 * Binary min-heap used as the priority queue in both panel-level and tile-level A*.
 *
 * Supports O(log n) push and pop. Does not support decrease-key — A* callers use
 * lazy-deletion instead (skip stale nodes where `g > dist[key]`).
 *
 * @property {Array<{f: number}>} h Internal heap array; items must have an `f` field (priority).
 */
class MinHeap {
  constructor() { this.h = [] }
  push(item) {
    this.h.push(item)
    let i = this.h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.h[p].f <= this.h[i].f) break
        ;[this.h[p], this.h[i]] = [this.h[i], this.h[p]]; i = p
    }
  }
  pop() {
    const top = this.h[0]
    const last = this.h.pop()
    if (this.h.length > 0) {
      this.h[0] = last
      let i = 0
      while (true) {
        let s = i, l = 2 * i + 1, r = 2 * i + 2
        if (l < this.h.length && this.h[l].f < this.h[s].f) s = l
        if (r < this.h.length && this.h[r].f < this.h[s].f) s = r
        if (s === i) break
          ;[this.h[i], this.h[s]] = [this.h[s], this.h[i]]; i = s
      }
    }
    return top
  }
  get size() { return this.h.length }
}

/**
 * Computes the directional 12-tile Wang index for a cell in a flat bitmap.
 *
 * A cell is an "edge" (true) when its neighbour in that direction does NOT share
 * the same terrain layer (i.e. the neighbour bit is 0). The decision tree maps
 * the 8-neighbour edge configuration to a strip column index used by tilesets.
 *
 * Strip layout (columns 0–12):
 *   0=N  1=NE(outer)  2=E  3=SE(outer)  4=S  5=SW(outer)  6=W  7=NW(outer)
 *   8=NW(inner)  9=NE(inner)  10=SW(inner)  11=SE(inner)  12=fill(interior)
 *
 * Works for any bitmap width — pass `stride=W` for world-scale bitmaps and
 * `stride=PANEL` for single-panel bitmaps.
 *
 * @param {Uint8Array} bmp   Flat row-major bitmap (1 = same layer, 0 = other layer).
 * @param {number}     cx    X coordinate of the cell within the bitmap.
 * @param {number}     cy    Y coordinate of the cell within the bitmap.
 * @param {number}     stride Row width of the bitmap (used for bounds checking).
 * @returns {number} Tile strip index 0–12.
 */
// `dir12` moved to `engine/tiling.js` and is imported + re-exported above.

/**
 * Selects the correct 12-tile strip column for a cliff cell given which
 * cardinal and diagonal neighbours are at lower elevation (or outside the blob).
 *
 * All eight direction parameters are booleans — `true` means that neighbour is
 * "lower" (i.e. the cliff drops in that direction). The decision tree prioritises
 * straight edges, then outer corners, then inner corners, then single-cardinal fallbacks.
 *
 * Strip layout (columns 0–11):
 *   0=N  1=NE(outer)  2=E  3=SE(outer)  4=S  5=SW(outer)  6=W  7=NW(outer)
 *   8=NW(inner)  9=NE(inner)  10=SW(inner)  11=SE(inner)
 *
 * @param {boolean} N  - North neighbour is lower.
 * @param {boolean} S  - South neighbour is lower.
 * @param {boolean} E  - East neighbour is lower.
 * @param {boolean} Ww - West neighbour is lower.
 * @param {boolean} NE - NE diagonal is lower.
 * @param {boolean} SE - SE diagonal is lower.
 * @param {boolean} SW - SW diagonal is lower.
 * @param {boolean} NW - NW diagonal is lower.
 * @returns {number} Cliff tile strip index 0–11.
 */
// `cliffTileIdx` moved to `engine/tiling.js` and is imported + re-exported above.

/**
 * Mulberry32 PRNG — fast, high-quality 32-bit seeded pseudo-random number generator.
 *
 * All generation passes use this instead of `Math.random()` to guarantee identical
 * output for a given seed across platforms. Each call to the returned function advances
 * the seed state by one step.
 *
 * @param {number} seed - 32-bit integer seed.
 * @returns {function(): number} PRNG function returning floats uniformly in [0, 1).
 * @example
 * const rand = mulberry32(42)
 * rand() // → some deterministic float in [0, 1)
 */
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/**
 * Generates a flat array of Simplex noise values mapped to [0, 1].
 *
 * Used throughout the pipeline to produce terrain elevation, warp fields,
 * blob thresholds, and forest/grass density.
 *
 * @param {function} rand  PRNG instance (advances state on each call).
 * @param {number}   W     Bitmap width in pixels.
 * @param {number}   H     Bitmap height in pixels.
 * @param {number}   scale Noise frequency scale (larger = coarser features).
 * @returns {Float32Array} Row-major noise values in [0, 1], length W*H.
 */
function valueNoise(rand, W, H, scale) {
  const noise2D = createNoise2D(rand)
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = noise2D(x / scale, y / scale)
      out[y * W + x] = (v + 1) / 2
    }
  }
  return out
}

/**
 * Pipeline Step 1 — Generates the world elevation map.
 *
 * Combines domain warping, 6-octave FBM, mountain peaks with starburst ridge
 * noise, outward peninsula anchors, valley carving, and plateau quantization
 * to produce a continuous elevation field. Ocean margins are enforced around
 * the perimeter. The result is NOT yet quantized to tile elevations — that
 * happens in `generateTerrainWithRand` after blurring.
 *
 * @param {function}    rand PRNG instance (advances state throughout).
 * @param {number}      W    World width in pixels (`width * PANEL`).
 * @param {number}      H    World height in pixels (`height * PANEL`).
 * @returns {Float32Array}   Row-major elevation values in [0, 1], length W*H.
 */
function generateLandMass(rand, W, H) {
  const lerp = (a, b, t) => a + (b - a) * t

  // Domain warp coastal distortion
  const warpScale = Math.min(W, H) * WARP_SCALE_FACTOR
  const warpA = valueNoise(rand, W, H, warpScale)
  const warpB = valueNoise(rand, W, H, warpScale)

  // Island boundary — ellipse semi-axes as fraction of map size (larger ⇒ more land, thinner ocean ring)
  const borderFrac = 0.40 + rand() * 0.08
  const islandCx = W / 2, islandCy = H / 2
  const islandRx = W * borderFrac, islandRy = H * borderFrac

  // Outward peninsula anchors
  const numPeninsula = 7 + Math.floor(rand() * 5)
  const peninsulas = []
  for (let k = 0; k < numPeninsula; k++) {
    const angle = rand() * Math.PI * 2
    peninsulas.push({
      ax: W / 2 + Math.cos(angle) * islandRx * 0.78,
      ay: H / 2 + Math.sin(angle) * islandRy * 0.78,
      dx: Math.cos(angle),
      dy: Math.sin(angle),
      r: W * (0.14 + rand() * 0.14),
      str: 0.16 + rand() * 0.12,
    })
  }

  // Stage 1.1: FBM Layers (6 octaves)
  const scales = [W * 0.6, W * 0.35, W * 0.18, W * 0.09, W * 0.045, W * 0.022]
  const weights = FBM_WEIGHTS
  const octaves = scales.map(s => valueNoise(rand, W, H, s))

  // Feature specific noise
  const valleyNoise = valueNoise(rand, W, H, W * 0.28)
  const plateauNoise = valueNoise(rand, W, H, W * 0.20)

  // Stage 1.2: Mountain Peaks
  const numPeaks = 2
  const peaks = []
  const minSep = W * PEAK_MIN_SEP_FACTOR
  const peakCaps = [1.0, SEA_LEVEL + (4 / 6) * (1 - SEA_LEVEL)]
  for (let attempt = 0; attempt < 200 && peaks.length < numPeaks; attempt++) {
    const px = W * 0.20 + rand() * W * 0.60
    const py = H * 0.20 + rand() * H * 0.60
    const tooClose = peaks.some(p => Math.hypot(p.x - px, p.y - py) < minSep)
    if (!tooClose) {
      // Angular ridge distortion (starburst lines)
      const numRidgeSamples = 64
      const ridgeNoise = new Float32Array(numRidgeSamples)
      for (let k = 0; k < numRidgeSamples; k++) ridgeNoise[k] = rand()
      const ridgeSmoothed = new Float32Array(numRidgeSamples)
      const rBlur = 5
      for (let k = 0; k < numRidgeSamples; k++) {
        let sum = 0
        for (let b = -rBlur; b <= rBlur; b++)
          sum += ridgeNoise[(k + b + numRidgeSamples) % numRidgeSamples]
        ridgeSmoothed[k] = sum / (rBlur * 2 + 1)
      }
      peaks.push({ x: px, y: py, r: W * (PEAK_MIN_SEP_FACTOR + rand() * 0.10), cap: peakCaps[peaks.length], ridgeNoise: ridgeSmoothed, numRidgeSamples })
    }
  }

  const elev = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x

      // Domain-warp for organic coastline
      let wx = (warpA[i] * 2 - 1) * W * 0.14
      let wy = (warpB[i] * 2 - 1) * H * 0.14

      // Peninsula push — each anchor pulls nearby pixels outward, stretching the coast
      for (const p of peninsulas) {
        const pdx = x - p.ax, pdy = y - p.ay
        const pd = Math.sqrt(pdx * pdx + pdy * pdy)
        if (pd < p.r) {
          const falloff = Math.pow(1.0 - pd / p.r, 2)
          wx -= p.dx * p.str * W * falloff
          wy -= p.dy * p.str * H * falloff
        }
      }

      const sx = x + wx, sy = y + wy

      // Island boundary — skip ocean
      const bndx = (sx - islandCx) / islandRx
      const bndy = (sy - islandCy) / islandRy
      const bnd = Math.sqrt(bndx * bndx + bndy * bndy)
      if (bnd >= 1.0) continue

      // Island base: gentle coastal slope, higher toward interior
      const islandBase = Math.pow(1.0 - bnd, 0.6) * 0.45

      // Per-peak starburst — cone modulated by angular ridge noise
      let peakContrib = 0
      for (const p of peaks) {
        const dx = (x - p.x) / p.r, dy = (y - p.y) / p.r
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d >= 1.0) continue
        // Sample ridge noise by angle
        const angle = Math.atan2(dy, dx)  // -π..π
        const t = (angle / (Math.PI * 2) + 1) % 1  // 0..1
        const ri = t * p.numRidgeSamples
        const ri0 = Math.floor(ri) % p.numRidgeSamples
        const ri1 = (ri0 + 1) % p.numRidgeSamples
        const rf = ri - Math.floor(ri)
        const ridgeSample = p.ridgeNoise[ri0] * (1 - rf) + p.ridgeNoise[ri1] * rf  // 0..1
        // Ridge modulation: stronger at base, fades toward peak
        const ridgeMod = (ridgeSample - 0.5) * 1.4 * d
        const cone = Math.pow(1.0 - d, 1.4)
        peakContrib = Math.max(peakContrib, Math.max(0, cone + ridgeMod) * p.cap)
      }

      // FBM noise for broad shape + texture
      let fbm = 0
      for (let o = 0; o < octaves.length; o++) fbm += octaves[o][i] * weights[o]
      // Shift FBM to [-0.5, 0.5] and apply with more weight
      const fbmContrib = (fbm - 0.5) * 0.38

      // Valley carving — low valley noise digs basins into mid-elevation areas
      // Only carves where there is no strong peak influence
      const valleyDepth = Math.max(0, 0.28 - valleyNoise[i]) * (1.0 - peakContrib * 2.0)
      const valleyCarve = valleyDepth * 0.55

      // Plateau shaping — compress the elevation curve in mid-range to create flat shelves
      // Apply a soft quantization: nudge values toward nearest 1/3 shelf
      const rawElev = Math.max(0, islandBase + peakContrib + fbmContrib - valleyCarve)
      const pn = plateauNoise[i]  // 0..1
      // Shelf bands at ~0.30, ~0.55, ~0.80 of land range — strength varies with plateau noise
      const plateauStrength = pn > 0.55 ? (pn - 0.55) * 1.8 : 0  // only where pn is high
      const shelf = Math.round(rawElev * 3) / 3  // snap to thirds
      elev[i] = lerp(rawElev, shelf, plateauStrength * 0.45)
    }
  }

  return elev
}



/**
 * Separable 2-pass box blur that approximates Gaussian smoothing.
 *
 * Used for elevation normalization and shoreline blending. Runs in O(W×H)
 * via a sliding-window accumulator — complexity does not grow with radius.
 *
 * @param {Float32Array} src    Source buffer (row-major, length W*H).
 * @param {number}       W      Buffer width.
 * @param {number}       H      Buffer height.
 * @param {number}       radius Blur radius in pixels (larger = smoother).
 * @returns {Float32Array} Blurred output of the same dimensions.
 */
function boxBlur(src, W, H, radius) {
  const dst = new Float32Array(W * H)
  const tmp = new Float32Array(W * H)
  // Horizontal pass
  for (let y = 0; y < H; y++) {
    let sum = 0
    for (let x = 0; x < radius; x++) sum += src[y * W + x]
    for (let x = 0; x < W; x++) {
      if (x + radius < W) sum += src[y * W + x + radius]
      if (x - radius - 1 >= 0) sum -= src[y * W + x - radius - 1]
      tmp[y * W + x] = sum / (Math.min(x + radius + 1, W) - Math.max(x - radius, 0))
    }
  }
  // Vertical pass
  for (let x = 0; x < W; x++) {
    let sum = 0
    for (let y = 0; y < radius; y++) sum += tmp[y * W + x]
    for (let y = 0; y < H; y++) {
      if (y + radius < H) sum += tmp[(y + radius) * W + x]
      if (y - radius - 1 >= 0) sum -= tmp[(y - radius - 1) * W + x]
      dst[y * W + x] = sum / (Math.min(y + radius + 1, H) - Math.max(y - radius, 0))
    }
  }
  return dst
}

/** Returns a blank 32x32 panel of ocean. */
/**
 * Allocates a fresh 32×32 grid of default ocean cells for a single panel.
 *
 * Each cell starts as `{ type: T.OCEAN, elevation: 0 }`. Used when
 * initialising `panelData` entries in `generateTerrainWithRand`.
 *
 * @returns {Array<{type: string, elevation: number}>} Array of PANEL*PANEL cell objects.
 */
function makeGrid() {
  return Array.from({ length: PANEL * PANEL }, () => ({ type: T.OCEAN, elevation: 0 }))
}

/**
 * Pipeline Steps 1–5 — Generates terrain only (land mass, islands, lakes, smoothing).
 *
 * Constructs a fresh PRNG from `seed`, then delegates to `generateTerrainWithRand`.
 * Returns the PRNG state so callers can optionally continue the sequence.
 * Used by the retry loop in `generateRegion` when checking island/lake counts.
 *
 * @param {number} seed - Integer seed. Defaults to `Date.now()` if falsy.
 * @param {number} [width] - World width in panels (default {@link DEFAULT_MAP_WIDTH}).
 * @param {number} [height] - World height in panels (default {@link DEFAULT_MAP_HEIGHT}).
 * @returns {{ panelData: Object, islandSeeds: Array, width: number, height: number, seed: number }}
 */
function generateTerrain(seed, width, height) {
  const w = clampMapPanels(width, DEFAULT_MAP_WIDTH)
  const h = clampMapPanels(height, DEFAULT_MAP_HEIGHT)
  const W = w * PANEL, H = h * PANEL
  const rand = mulberry32(seed || Date.now())
  return { ...generateTerrainWithRand(rand, w, h, W, H), width: w, height: h, seed }
}

/**
 * Pipeline Steps 1–5 — Runs all terrain-generation passes using an existing PRNG.
 *
 * Separating PRNG creation from terrain logic allows the retry loop in `generateRegion`
 * to attempt terrain repeatedly with different seeds without rebuilding the full call stack.
 * After this function returns, `rand` is in a deterministic state ready for Step 6+.
 *
 * Steps performed:
 *   1. Land mass: domain warp + FBM + peaks + plateaus
 *   2. Small island injection (organic stamp + growth loop)
 *   3. Land bridge widening between mainland and islands
 *   3.5. Blocky elevation refinement (4×4 grid quantisation + relaxation)
 *   4. Box blur + elevation quantisation to 6 levels
 *   5. Inland lake conversion via BFS + CA smoothing
 *
 * @param {function} rand   Active PRNG instance (state is advanced in place).
 * @param {number}   width  Map width in panels.
 * @param {number}   height Map height in panels.
 * @param {number}   W      Map width in pixels (width * PANEL).
 * @param {number}   H      Map height in pixels (height * PANEL).
 * @returns {{ panelData: Object, islandSeeds: Array<{cx:number,cy:number}> }}
 */
function generateTerrainWithRand(rand, width, height, W, H) {

  // --- Step 1: Land Mass Generation ---
  const elev = generateLandMass(rand, W, H)

  // Normalize land elevations so the highest point reaches 1.0
  let maxElev = 0
  for (let i = 0; i < elev.length; i++) if (elev[i] > maxElev) maxElev = elev[i]
  if (maxElev > SEA_LEVEL) {
    const scale = (1 - SEA_LEVEL) / (maxElev - SEA_LEVEL)
    for (let i = 0; i < elev.length; i++) {
      if (elev[i] > SEA_LEVEL) elev[i] = SEA_LEVEL + (elev[i] - SEA_LEVEL) * scale
    }
  }

  // --- Step 2: Small Island Injection ---
  // Scans for 6x6 ocean blocks to place secondary islands.
  const MIN_SQ = 6
  const islandSeeds = []
  const usedPanels = new Set()

  const BORDER = 2  // panels to keep clear at map edge
  for (let py = BORDER; py <= height - MIN_SQ - BORDER; py++) {
    for (let px = BORDER; px <= width - MIN_SQ - BORDER; px++) {
      if (usedPanels.has(`${px},${py}`)) continue
      let allOcean = true
      for (let dy = 0; dy < MIN_SQ && allOcean; dy++) {
        for (let dx = 0; dx < MIN_SQ && allOcean; dx++) {
          const wx = (px + dx) * PANEL + PANEL / 2
          const wy = (py + dy) * PANEL + PANEL / 2
          if (elev[wy * W + wx] > SEA_LEVEL) allOcean = false
        }
      }
      if (!allOcean) continue

      const cx = (px + MIN_SQ / 2) * PANEL
      const cy = (py + MIN_SQ / 2) * PANEL
      islandSeeds.push({ cx, cy, r: PANEL * (1.5 + rand() * 1.0) })

      for (let dy = 0; dy < MIN_SQ; dy++)
        for (let dx = 0; dx < MIN_SQ; dx++)
          usedPanels.add(`${px + dx},${py + dy}`)
    }
  }

  // Stamp each island with organic shape (warp + FBM), grow until ≥ MIN_ISLAND_PANELS
  const edgePx = BORDER * PANEL

  const stampIslandOrganic = (cx, cy, r) => {
    // Local noise at island scale
    const iW = Math.ceil(r * 2.6), iH = Math.ceil(r * 2.6)
    const wA = valueNoise(rand, iW, iH, r * 0.7)
    const wB = valueNoise(rand, iW, iH, r * 0.7)
    const fbmScales = [r * 0.9, r * 0.5, r * 0.25, r * 0.12]
    const fbmWeights = [0.45, 0.28, 0.17, 0.10]
    const fbmLayers = fbmScales.map(s => valueNoise(rand, iW, iH, s))

    // Peninsula anchors local to this island
    const numP = 1 + Math.floor(rand() * 3)
    const pens = []
    for (let k = 0; k < numP; k++) {
      const angle = rand() * Math.PI * 2
      pens.push({
        ax: iW / 2 + Math.cos(angle) * r * 0.7,
        ay: iH / 2 + Math.sin(angle) * r * 0.7,
        dx: Math.cos(angle), dy: Math.sin(angle),
        pr: r * (0.3 + rand() * 0.25),
        str: 0.08 + rand() * 0.08,
      })
    }

    const bx0 = Math.max(edgePx, Math.floor(cx - r * 1.3))
    const bx1 = Math.min(W - 1 - edgePx, Math.ceil(cx + r * 1.3))
    const by0 = Math.max(edgePx, Math.floor(cy - r * 1.3))
    const by1 = Math.min(H - 1 - edgePx, Math.ceil(cy + r * 1.3))

    for (let wy = by0; wy <= by1; wy++) {
      for (let wx = bx0; wx <= bx1; wx++) {
        // Map world pixel → local island grid coords
        const lx = Math.floor((wx - cx) + iW / 2)
        const ly = Math.floor((wy - cy) + iH / 2)
        if (lx < 0 || ly < 0 || lx >= iW || ly >= iH) continue
        const li = ly * iW + lx

        // Domain warp
        let dwx = (wA[li] * 2 - 1) * r * 0.18
        let dwy = (wB[li] * 2 - 1) * r * 0.18
        for (const p of pens) {
          const pdx = lx - p.ax, pdy = ly - p.ay
          const pd = Math.sqrt(pdx * pdx + pdy * pdy)
          if (pd < p.pr) {
            const falloff = Math.pow(1.0 - pd / p.pr, 2)
            dwx -= p.dx * p.str * r * falloff
            dwy -= p.dy * p.str * r * falloff
          }
        }

        // Warped distance from island center
        const sx = (wx - cx) + dwx, sy = (wy - cy) + dwy
        const d = Math.sqrt(sx * sx + sy * sy) / r
        if (d >= 1.0) continue

        // Base + FBM
        const base = Math.pow(1.0 - d, 0.7) * 0.40
        let fbm = 0
        for (let o = 0; o < fbmLayers.length; o++) fbm += fbmLayers[o][li] * fbmWeights[o]
        const contrib = Math.max(0, base + (fbm - 0.5) * 0.20)
        elev[wy * W + wx] = Math.max(elev[wy * W + wx], SEA_LEVEL + contrib * (1 - SEA_LEVEL))
      }
    }
  }

  const countIslandPanels = (cx, cy, r) => {
    let count = 0
    const pr = Math.ceil(r / PANEL) + 2
    const pcx = Math.round(cx / PANEL), pcy = Math.round(cy / PANEL)
    for (let py2 = Math.max(0, pcy - pr); py2 < Math.min(height, pcy + pr); py2++) {
      for (let px2 = Math.max(0, pcx - pr); px2 < Math.min(width, pcx + pr); px2++) {
        const wx = px2 * PANEL + PANEL / 2
        const wy = py2 * PANEL + PANEL / 2
        if (elev[wy * W + wx] > SEA_LEVEL) count++
      }
    }
    return count
  }

  for (const isle of islandSeeds) {
    let r = isle.r
    stampIslandOrganic(isle.cx, isle.cy, r)
    // PERF-NOTE: Re-stamps the entire island from scratch each growth iteration rather
    // than incrementally growing only the new ring. Incremental growth is not safe here
    // because stampIslandOrganic calls valueNoise (which consumes PRNG state), so any
    // change to the sequence of noise calls would alter the island shape and break
    // seed determinism. The iteration count is bounded (typically 2–4 per island) so
    // the total cost is modest.
    while (countIslandPanels(isle.cx, isle.cy, r) < MIN_ISLAND_PANELS) {
      r += PANEL * 0.5
      stampIslandOrganic(isle.cx, isle.cy, r)
    }
  }

  // --- Step 3: Land Bridge Widening ---
  // Fills 2-panel wide corridors between adjacent land masses.
  const isLand = (px, py) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return false
    const wx = px * PANEL + PANEL / 2, wy = py * PANEL + PANEL / 2
    return elev[wy * W + wx] > SEA_LEVEL
  }
  const fillBridge = (ax, ay, bx, by) => {
    // Fill a 2-panel-wide land corridor from panel (ax,ay) to (bx,by) in world pixels
    const x0 = ax * PANEL + PANEL / 2, y0 = ay * PANEL + PANEL / 2
    const x1 = bx * PANEL + PANEL / 2, y1 = by * PANEL + PANEL / 2
    const len = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2)
    if (len === 0) return
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len  // perpendicular
    const halfW = PANEL  // 1 panel each side = 2 panels wide
    const steps = Math.ceil(len)
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const mx = x0 + (x1 - x0) * t, my = y0 + (y1 - y0) * t
      for (let side = -halfW; side <= halfW; side++) {
        const px = Math.round(mx + nx * side)
        const py = Math.round(my + ny * side)
        if (px < edgePx || py < edgePx || px >= W - edgePx || py >= H - edgePx) continue
        const landVal = SEA_LEVEL + 0.15 * (1 - SEA_LEVEL)
        elev[py * W + px] = Math.max(elev[py * W + px], landVal)
      }
    }
  }

  // snapshot of pre-island mainland: any land pixel that isn't inside an island bounding box
  for (const isle of islandSeeds) {
    const pr = Math.ceil(isle.r / PANEL) + 3
    const pcx = Math.round(isle.cx / PANEL), pcy = Math.round(isle.cy / PANEL)
    for (let py2 = Math.max(0, pcy - pr); py2 <= Math.min(height - 1, pcy + pr); py2++) {
      for (let px2 = Math.max(0, pcx - pr); px2 <= Math.min(width - 1, pcx + pr); px2++) {
        if (!isLand(px2, py2)) continue
        // Check all 4 neighbours — if any neighbour is land but far from island center it's mainland
        for (const [nx2, ny2] of [[px2 + 1, py2], [px2 - 1, py2], [px2, py2 + 1], [px2, py2 - 1]]) {
          if (!isLand(nx2, ny2)) continue
          const dx2 = nx2 - pcx, dy2 = ny2 - pcy
          const distToIsle = Math.sqrt(dx2 * dx2 + dy2 * dy2)
          const dx3 = px2 - pcx, dy3 = py2 - pcy
          const distSelf = Math.sqrt(dx3 * dx3 + dy3 * dy3)
          // One panel is close to island, neighbour is far → connection point
          if (distSelf <= pr * 0.6 && distToIsle > pr * 0.7) {
            fillBridge(px2, py2, nx2, ny2)
          }
        }
      }
    }
  }

  // --- Step 3.25: Offshore Island in Large Water Pocket ---
  // Find an isolated 2×2 panel all-ocean pocket (with a 1-panel ocean moat), then stamp
  // a small island there that will remain unconnected to the mainland (no bridge widening).
  ; (() => {
    const isOceanPanel = (px, py) => {
      if (px < 0 || py < 0 || px >= width || py >= height) return false
      const wx = px * PANEL + PANEL / 2
      const wy = py * PANEL + PANEL / 2
      return elev[wy * W + wx] <= SEA_LEVEL
    }

    /** Candidate top-left keys for 2×2 ocean pockets with ocean moat. */
    const candidates = []
    const BORDER2 = BORDER + 1 // keep moat + map edge clear
    for (let py = BORDER2; py <= height - 2 - BORDER2; py++) {
      for (let px = BORDER2; px <= width - 2 - BORDER2; px++) {
        // 2×2 must be ocean
        if (
          !isOceanPanel(px, py) ||
          !isOceanPanel(px + 1, py) ||
          !isOceanPanel(px, py + 1) ||
          !isOceanPanel(px + 1, py + 1)
        ) continue

        // 1-panel moat around it (4×4 ring) must also be ocean
        let ok = true
        for (let dy = -1; dy <= 2 && ok; dy++) {
          for (let dx = -1; dx <= 2 && ok; dx++) {
            if (!isOceanPanel(px + dx, py + dy)) ok = false
          }
        }
        if (!ok) continue

        candidates.push([px, py])
      }
    }

    if (candidates.length === 0) return

    // Deterministic pick driven by PRNG state.
    const [px, py] = candidates[Math.floor(rand() * candidates.length)]

    // Center of the 2×2 block in world pixels
    const cx = (px + 1) * PANEL
    const cy = (py + 1) * PANEL
    const r = PANEL * (0.85 + rand() * 0.25) // keep it comfortably inside the 2×2 pocket

    stampIslandOrganic(cx, cy, r)
    islandSeeds.push({ cx, cy, r, offshore: true })
  })()

  // Final organic detail pass before blur
  const detailCoarse = valueNoise(rand, W, H, W * 0.12)
  const detailFine = valueNoise(rand, W, H, W * 0.06)
  const landRange = 1 - SEA_LEVEL
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] <= SEA_LEVEL) continue
    const detail = detailCoarse[i] * 0.65 + detailFine[i] * 0.35
    const landFrac = (elev[i] - SEA_LEVEL) / landRange
    if (landFrac < 0.50) {
      const strength = (1 - landFrac / 0.50) * 2.0
      elev[i] += (detail - 0.5) * strength * landRange
    }
  }

  // Smooth elevation to eliminate sharp level boundaries (2× box blur ≈ Gaussian)
  const blurred1 = boxBlur(elev, W, H, 6)
  const blurred = boxBlur(blurred1, W, H, 6)
  for (let i = 0; i < elev.length; i++) elev[i] = blurred[i]

  // --- Step 3.5: Blocky Elevation Refinement & Spacing ---
  // Enforces:
  // 1. Blocky "game-like" axis-aligned boundaries (using 4x4 blocks).
  // 2. Single-level increments/decrements (no jumps).
  // 3. Spacing: 1 block (4 tiles) minimum width per level.
  const BLOCK = 4
  const BW = W / BLOCK, BH = H / BLOCK
  const blockLevels = new Int8Array(BW * BH)

  // A. Local Average & initial Quantize to the 4x4 block grid
  for (let by = 0; by < BH; by++) {
    for (let bx = 0; bx < BW; bx++) {
      let sum = 0, count = 0
      for (let dy = 0; dy < BLOCK; dy++) {
        for (let dx = 0; dx < BLOCK; dx++) {
          sum += elev[(by * BLOCK + dy) * W + (bx * BLOCK + dx)]
          count++
        }
      }
      const avg = sum / count
      if (avg > SEA_LEVEL) {
        blockLevels[by * BW + bx] = Math.max(1, Math.min(6, Math.ceil((avg - SEA_LEVEL) / landRange * 6)))
      }
    }
  }

  // B. Relax on the block grid to ensure single-step transitions and no pinches.
  // 8 iterations ensures rules propagate through steep clusters.
  for (let iter = 0; iter < 8; iter++) {
    const nextLevels = new Int8Array(blockLevels)
    for (let y = 0; y < BH; y++) {
      for (let x = 0; x < BW; x++) {
        const i = y * BW + x
        let l = blockLevels[i]
        if (l <= 0) continue

        // 1. Single-Step Enforcement (8 neighbors)
        // No block can be > 1 level different from any neighbor (cardinal or diagonal).
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx, ny = y + dy
            if (nx < 0 || ny < 0 || nx >= BW || ny >= BH) {
              if (l > 1) l = 1 // Border counts as Level 0, so max Level 1 here
              continue
            }
            const nl = blockLevels[ny * BW + nx]
            if (l > nl + 1) l = nl + 1
          }
        }

        // 2. Diagonal Pinch Resolution
        // Detect checkerboard patterns [a b] / [c d] where a=d, b=c, a!=b
        if (x > 0 && y > 0) {
          const vA = nextLevels[(y - 1) * BW + (x - 1)]
          const vB = nextLevels[(y - 1) * BW + x]
          const vC = nextLevels[y * BW + (x - 1)]
          const vD = l
          if (vA === vD && vB === vC && vA !== vB) {
            // Resolution: Uplift the lower diagonal to unify the 2x2 block
            l = Math.max(vA, vB)
          }
        }

        nextLevels[i] = l
      }
    }
    blockLevels.set(nextLevels)
  }

  // Build panel grids by upscaling the block levels
  const panelData = {}
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const grid = makeGrid()
      for (let cy = 0; cy < PANEL; cy++) {
        for (let cx = 0; cx < PANEL; cx++) {
          const bx = Math.floor((px * PANEL + cx) / BLOCK)
          const by = Math.floor((py * PANEL + cy) / BLOCK)
          const l = blockLevels[by * BW + bx]
          const cell = grid[cy * PANEL + cx]
          if (l > 0) {
            cell.type = T.LAND
            cell.elevation = l
          }
        }
      }
      panelData[`${px},${py}`] = { grid }
    }
  }

  // --- Step 4: Inland Lake Conversion ---
  // BFS from map borders using panelData cell types (already block-snapped by Step 3.5)
  // rather than the raw elev float array. This ensures lake shapes are blocky and
  // axis-aligned, matching the surrounding terrain.
  //
  // Border-reachable T.OCEAN cells = open sea (stay as ocean).
  // Landlocked T.OCEAN cells = inland water → convert to T.LAKE (or T.LAND if tiny).
  const getCellType = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return null
    return panelData[`${(x / PANEL) | 0},${(y / PANEL) | 0}`]?.grid[(y % PANEL) * PANEL + (x % PANEL)] ?? null
  }

  const visitedOcean = new Uint8Array(W * H)
  const borderQ = []
  // Seed: all T.OCEAN cells on the map border
  for (let x = 0; x < W; x++) {
    for (const y of [0, H - 1]) {
      const c = getCellType(x, y)
      if (c && c.type === T.OCEAN && !visitedOcean[y * W + x]) {
        visitedOcean[y * W + x] = 1; borderQ.push(y * W + x)
      }
    }
  }
  for (let y = 1; y < H - 1; y++) {
    for (const x of [0, W - 1]) {
      const c = getCellType(x, y)
      if (c && c.type === T.OCEAN && !visitedOcean[y * W + x]) {
        visitedOcean[y * W + x] = 1; borderQ.push(y * W + x)
      }
    }
  }
  let bqi = 0
  while (bqi < borderQ.length) {
    const i = borderQ[bqi++]
    const x = i % W, y = (i / W) | 0
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const ni = ny * W + nx
      if (visitedOcean[ni]) continue
      const nc = getCellType(nx, ny)
      if (!nc || nc.type !== T.OCEAN) continue
      visitedOcean[ni] = 1
      borderQ.push(ni)
    }
  }
  // Collect landlocked T.OCEAN regions and convert
  const visitedRegion = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (visitedOcean[i] || visitedRegion[i]) continue
      const c = getCellType(x, y)
      if (!c || c.type !== T.OCEAN) continue
      // BFS to collect full landlocked region
      const region = []
      const q = [i]; let qi = 0
      visitedRegion[i] = 1
      while (qi < q.length) {
        const ci = q[qi++]
        region.push(ci)
        const cx2 = ci % W, cy2 = (ci / W) | 0
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = cx2 + dx, ny = cy2 + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const ni = ny * W + nx
          if (visitedRegion[ni]) continue
          const nc = getCellType(nx, ny)
          if (!nc || nc.type !== T.OCEAN) continue
          visitedRegion[ni] = 1
          q.push(ni)
        }
      }
      // Tiny blobs (< 1 panel) → level-1 land; larger → lake
      const tinyBlob = region.length < PANEL * PANEL
      for (const pi of region) {
        const px2 = pi % W, py2 = (pi / W) | 0
        const cell = getCellType(px2, py2)
        if (!cell || cell.type !== T.OCEAN) continue
        if (tinyBlob) {
          cell.type = T.LAND
          cell.elevation = 1
        } else {
          cell.type = T.LAKE
          cell.elevation = 0
        }
      }
    }
  }

  // --- Step 5: Enclosed Basin Smoothing ---
  // Converts unvisited level-1 pockets (not touching ocean) to lakes.
  // getCellPx returns cell at world pixel coords.
  const getCellPx = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return null
    const pd = panelData[`${(x / PANEL) | 0},${(y / PANEL) | 0}`]
    return pd ? pd.grid[(y % PANEL) * PANEL + (x % PANEL)] : null
  }

  const visitedL1 = new Uint8Array(W * H)
  const l1BorderQ = []
  const isLevel1 = i => { const c = getCellPx(i % W, (i / W) | 0); return c && c.type === T.LAND && c.elevation === 1 }
  const isOceanOrLake = i => { const c = getCellPx(i % W, (i / W) | 0); return !c || c.type === T.OCEAN || c.type === T.LAKE }
  // Seed: level-1 cells that have at least one ocean/lake neighbour
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (!isLevel1(i) || visitedL1[i]) continue
      let touchesOcean = false
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { touchesOcean = true; break }
        if (isOceanOrLake(ny * W + nx)) { touchesOcean = true; break }
      }
      if (touchesOcean) { visitedL1[i] = 1; l1BorderQ.push(i) }
    }
  }
  let l1qi = 0
  while (l1qi < l1BorderQ.length) {
    const i = l1BorderQ[l1qi++]
    const x = i % W, y = Math.floor(i / W)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const ni = ny * W + nx
      if (visitedL1[ni] || !isLevel1(ni)) continue
      visitedL1[ni] = 1
      l1BorderQ.push(ni)
    }
  }
  // Collect unvisited level-1 pockets and convert to lake
  const visitedL1Region = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (visitedL1[i] || visitedL1Region[i] || !isLevel1(i)) continue
      const region = []
      const q = [i]; let qi = 0
      visitedL1Region[i] = 1
      while (qi < q.length) {
        const ci = q[qi++]
        region.push(ci)
        const cx2 = ci % W, cy2 = (ci / W) | 0
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = cx2 + dx, ny = cy2 + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const ni = ny * W + nx
          if (visitedL1Region[ni] || !isLevel1(ni)) continue
          visitedL1Region[ni] = 1
          q.push(ni)
        }
      }
      // Tiny level-1 pockets (< 1 panel) → level-2 land; larger → lake
      const tinyL1 = region.length < PANEL * PANEL
      for (const pi of region) {
        const px2 = pi % W, py2 = Math.floor(pi / W)
        const key = `${Math.floor(px2 / PANEL)},${Math.floor(py2 / PANEL)}`
        if (!panelData[key]) continue
        const cell = panelData[key].grid[(py2 % PANEL) * PANEL + (px2 % PANEL)]
        if (tinyL1) {
          cell.type = T.LAND
          cell.elevation = 2
        } else {
          cell.type = T.LAKE
          cell.elevation = 0
        }
      }
    }
  }

  // ── Lake edge smoothing (2 CA passes) ─────────────────────────────────────
  for (let pass = 0; pass < 2; pass++) {
    // Snapshot current lake state
    const isLakeSnap = new Uint8Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = getCellPx(x, y)
        if (c && c.type === T.LAKE) isLakeSnap[y * W + x] = 1
      }
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const c = getCellPx(x, y)
        if (!c || c.type === T.OCEAN) continue
        let lakeCount = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (dx !== 0 || dy !== 0) lakeCount += isLakeSnap[(y + dy) * W + (x + dx)]
        if (c.type === T.LAND && lakeCount >= 6) { c.type = T.LAKE; c.elevation = 0 }
        else if (c.type === T.LAKE && lakeCount <= 2) { c.type = T.LAND; c.elevation = 1 }
      }
    }
  }

  // --- Step 5.1: Lake islets (one per lake blob) ---
  // For each connected T.LAKE component, place a tiny land islet in its interior.
  // We pick the lake cell with maximum distance to the lake shoreline (cardinal adjacency),
  // then stamp a small disc that fits fully inside the lake.
  ; (() => {
    const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H
    const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]

    const isLake = (x, y) => {
      const c = getCellPx(x, y)
      return !!c && c.type === T.LAKE
    }

    const visited = new Uint8Array(W * H)
    const dist = new Int16Array(W * H)

    for (let sy = 0; sy < H; sy++) {
      for (let sx = 0; sx < W; sx++) {
        const si = sy * W + sx
        if (visited[si] || !isLake(sx, sy)) continue

        // Collect this lake blob (4-neighbor).
        const blob = []
        const q = [si]
        visited[si] = 1
        for (let qi = 0; qi < q.length; qi++) {
          const i = q[qi]
          blob.push(i)
          const x = i % W, y = (i / W) | 0
          for (const [dx, dy] of dirs4) {
            const nx = x + dx, ny = y + dy
            if (!inBounds(nx, ny)) continue
            const ni = ny * W + nx
            if (visited[ni] || !isLake(nx, ny)) continue
            visited[ni] = 1
            q.push(ni)
          }
        }

        // Ignore tiny lakes (no room for an interior islet).
        if (blob.length < 24) continue

        // Distance-to-shore (multi-source BFS from shoreline lake cells).
        // Shoreline: any lake cell with a non-lake cardinal neighbor.
        const dq = []
        for (const i of blob) dist[i] = -1
        for (const i of blob) {
          const x = i % W, y = (i / W) | 0
          let shore = false
          for (const [dx, dy] of dirs4) {
            const nx = x + dx, ny = y + dy
            if (!inBounds(nx, ny) || !isLake(nx, ny)) { shore = true; break }
          }
          if (shore) { dist[i] = 0; dq.push(i) }
        }

        for (let qi = 0; qi < dq.length; qi++) {
          const i = dq[qi]
          const x = i % W, y = (i / W) | 0
          const d0 = dist[i]
          for (const [dx, dy] of dirs4) {
            const nx = x + dx, ny = y + dy
            if (!inBounds(nx, ny) || !isLake(nx, ny)) continue
            const ni = ny * W + nx
            if (dist[ni] !== -1) continue
            dist[ni] = d0 + 1
            dq.push(ni)
          }
        }

        // Determine an "interior" island footprint that covers at least ~1/6 of the lake cells
        // while staying fully inside the lake (exclude shoreline by requiring dist>=1).
        let maxD = 0
        for (const i of blob) maxD = Math.max(maxD, dist[i] | 0)
        if (maxD <= 1) continue

        // Histogram distances so we can choose a cutoff that yields >= target cells.
        const hist = new Int32Array(maxD + 1)
        for (const i of blob) {
          const d = dist[i] | 0
          if (d >= 0 && d < hist.length) hist[d]++
        }

        const target = Math.ceil(blob.length / 6)
        let cutoff = 1
        let cum = 0
        for (let d = maxD; d >= 1; d--) {
          cum += hist[d]
          if (cum >= target) { cutoff = d; break }
        }

        // Build initial mask: deepest interior cells.
        // Then "chunk" into 4×4 blocks and round edges with a couple CA passes.
        const mask = new Uint8Array(W * H) // reused per blob implicitly (we only touch blob indices)
        const tmp = new Uint8Array(W * H)
        for (const i of blob) {
          mask[i] = ((dist[i] | 0) >= cutoff) ? 1 : 0
          tmp[i] = 0
        }

        const BLOCK = 4
        const BW2 = (W / BLOCK) | 0
        const BH2 = (H / BLOCK) | 0
        const blockTotal = new Int16Array(BW2 * BH2)
        const blockOn = new Int16Array(BW2 * BH2)
        const blockMinDist = new Int16Array(BW2 * BH2)
        for (let bi = 0; bi < blockMinDist.length; bi++) blockMinDist[bi] = 0x3fff

        // Blockify: fill blocks where the island already dominates, but only if the whole block is interior lake.
        for (const i of blob) {
          const d = dist[i] | 0
          if (d < 1) continue // keep 1-tile lake moat from shoreline
          const x = i % W, y = (i / W) | 0
          const bx = (x / BLOCK) | 0, by = (y / BLOCK) | 0
          const bi = by * BW2 + bx
          blockTotal[bi]++
          if (mask[i]) blockOn[bi]++
          if (d < blockMinDist[bi]) blockMinDist[bi] = d
        }

        const blockFill = new Uint8Array(BW2 * BH2)
        for (let bi = 0; bi < blockFill.length; bi++) {
          const tot = blockTotal[bi]
          if (tot <= 0) continue
          if (blockMinDist[bi] < 1) continue
          // Require the island to be the majority within this interior block.
          if (blockOn[bi] >= Math.ceil(tot * 0.55)) blockFill[bi] = 1
        }

        for (const i of blob) {
          const d = dist[i] | 0
          if (d < 1) { mask[i] = 0; continue }
          const x = i % W, y = (i / W) | 0
          const bi = ((y / BLOCK) | 0) * BW2 + ((x / BLOCK) | 0)
          mask[i] = blockFill[bi] ? 1 : 0
        }

        // CA rounding passes on the chunked mask (still constrained to interior lake).
        const dirs8 = [
          [1, 0], [-1, 0], [0, 1], [0, -1],
          [1, 1], [1, -1], [-1, 1], [-1, -1],
        ]
        const caPasses = 2
        for (let pass = 0; pass < caPasses; pass++) {
          for (const i of blob) {
            const d = dist[i] | 0
            if (d < 1) { tmp[i] = 0; continue }
            const x = i % W, y = (i / W) | 0
            let n = 0
            for (const [dx, dy] of dirs8) {
              const nx = x + dx, ny = y + dy
              if (!inBounds(nx, ny) || !isLake(nx, ny)) continue
              const ni = ny * W + nx
              n += mask[ni] ? 1 : 0
            }
            const on = mask[i] === 1
            if (on) tmp[i] = (n <= 2) ? 0 : 1
            else tmp[i] = (n >= 6) ? 1 : 0
          }
          for (const i of blob) {
            mask[i] = tmp[i]
            tmp[i] = 0
          }
        }

        // Enforce 4-connectivity: keep only the largest cardinal-connected component.
        // This removes "pinch" shapes where two land masses meet only at a diagonal corner.
        let bestComp = null
        let bestSize = 0
        for (const si of blob) {
          if (!mask[si]) continue
          const comp = []
          const cq = [si]
          tmp[si] = 1
          for (let cqi = 0; cqi < cq.length; cqi++) {
            const i = cq[cqi]
            comp.push(i)
            const x = i % W, y = (i / W) | 0
            for (const [dx, dy] of dirs4) {
              const nx = x + dx, ny = y + dy
              if (!inBounds(nx, ny) || !isLake(nx, ny)) continue
              const ni = ny * W + nx
              if (!mask[ni] || tmp[ni]) continue
              tmp[ni] = 1
              cq.push(ni)
            }
          }
          for (const i of comp) tmp[i] = 0
          if (comp.length > bestSize) {
            bestSize = comp.length
            bestComp = comp
          }
        }
        for (const i of blob) mask[i] = 0
        if (bestComp && bestSize > 0) {
          for (const i of bestComp) mask[i] = 1
        }

        // NOTE: chunking + rounding is allowed to shrink the island below `target`.

        // Stamp: convert masked interior lake cells to land (elev 1).
        for (const i of blob) {
          if (!mask[i]) continue
          const x = i % W, y = (i / W) | 0
          const c = getCellPx(x, y)
          if (!c || c.type !== T.LAKE) continue
          c.type = T.LAND
          c.elevation = 1
        }

        // Cleanup: clear mask entries we touched so the next blob starts clean.
        for (const i of blob) mask[i] = 0
      }
    }
  })()

  // ── Tiny land blob cleanup ────────────────────────────────────────────────
  // Any land blob < half a panel of pixels gets set to the most common elevation
  // among its direct neighbours, blending it into surroundings.
  const visitedBlob = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (visitedBlob[i]) continue
      const c = getCellPx(x, y)
      if (!c || c.type !== T.LAND) continue
      const elev0 = c.elevation
      // BFS collect contiguous same-elevation land blob
      const blob = []
      const bq = [i]; let bqi = 0
      visitedBlob[i] = 1
      while (bqi < bq.length) {
        const ci = bq[bqi++]
        blob.push(ci)
        const bx = ci % W, by = (ci / W) | 0
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = bx + dx, ny = by + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const ni = ny * W + nx
          if (visitedBlob[ni]) continue
          const nc = getCellPx(nx, ny)
          if (!nc || nc.type !== T.LAND || nc.elevation !== elev0) continue
          visitedBlob[ni] = 1
          bq.push(ni)
        }
      }
      if (blob.length >= PANEL * PANEL / 2) continue  // large enough, skip
      // Tally neighbour elevations around the blob perimeter
      const tally = new Array(8).fill(0)
      for (const ci of blob) {
        const bx = ci % W, by = Math.floor(ci / W)
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nc = getCellPx(bx + dx, by + dy)
          if (nc && nc.type === T.LAND && nc.elevation !== elev0) tally[nc.elevation]++
        }
      }
      let bestElev = elev0, bestCount = 0
      for (let e = 1; e <= 6; e++) if (tally[e] > bestCount) { bestCount = tally[e]; bestElev = e }
      if (bestElev === elev0) continue
      for (const ci of blob) {
        const bx = ci % W, by = Math.floor(ci / W)
        const bc = getCellPx(bx, by)
        if (bc) bc.elevation = bestElev
      }
    }
  }

  return { panelData, islandSeeds }
}

/**
 * Deep-clones the terrain-relevant subset of `panelData` (type + elevation only).
 *
 * Used before running Steps 6–20 so the original terrain snapshot is preserved
 * for `regenerateFromTerrain` calls. Only `type` and `elevation` are copied —
 * derived fields (tileIndex, settlement, isRoute, etc.) are intentionally omitted
 * because they will be recomputed from scratch.
 *
 * @param {Object} panelData Source panelData map (`"x,y"` → `{ grid }`).
 * @returns {Object} Cloned panelData with fresh cell objects.
 */
function cloneTerrainPanelData(panelData) {
  const clone = {}
  for (const key of Object.keys(panelData)) {
    clone[key] = { grid: panelData[key].grid.map(c => ({ type: c.type, elevation: c.elevation })) }
  }
  return clone
}

/**
 * Pipeline Steps 6–20 — Places all gameplay features on top of an existing terrain.
 *
 * Operates on a pre-built (and pre-cloned) `panelData` so terrain can be regenerated
 * without repeating Steps 1–5. Mutates `panelData` in place, then returns the fully
 * populated region object. **Comment labels follow execution order** (Step 20 biome runs last).
 *
 * Steps performed:
 *   6.  Panel statistics + settlement viability scoring
 *   6.1 Locked (user-placed) settlement clusters
 *   6.2 Peak POI placement (elevation-6 cells)
 *   6.3 Coastal hub placement
 *   6.4 Island hub placement
 *   6.5 Central hub placement
 *   6.6 Furthest-point spreading for remaining cities/towns
 *   6.7 Filler void pass (8×8 stride)
 *   6.8 Isolated POI pass
 *   7.  Panel-level A* road routing (grand highway network)
 *   8.  Forest border stamp (inward from settlement edges)
 *   9.  Forest blob placement (noise threshold)
 *   10. Forest connectivity cleanup (BFS from settlements)
 *   11. Cliff detection + direction encoding (12-tile `cliffTileIdx`)
 *   12. Tile-level road stamping (per-panel A* + 3-tile wide stamp; sub-passes 12.4–12.6)
 *   13. Grass blob placement (noise threshold)
 *   14. Grass blob size enforcement (min/max cull)
 *   15. Thin-strip cleanup
 *   16. Orphan LAND cleanup
 *   17. Tile index calculation (Wang 2-corner bitmap pass)
 *   18. Organic terrain blobs (LAND/GRASS patches with cliff rings)
 *   19. Forest halo + secret halo (playable edge + optional pockets)
 *   20. Biome zoning (single-panel seeds + round-robin propagation)
 *
 * @param {Object}   params
 * @param {Object}   params.panelData          Pre-cloned terrain panelData to mutate.
 * @param {number}   params.width              Map width in panels.
 * @param {number}   params.height             Map height in panels.
 * @param {Array}    params.islandSeeds        Island centre coordinates from Step 2.
 * @param {function} params.rand               PRNG instance positioned after Step 5.
 * @param {number}   [params.seed=0]           Original seed (stored for `regenerateFromTerrain`).
 * @param {number}   params.settlements        Target settlement cluster count (all settlements; size varies).
 * @param {Array}    [params.lockedSettlements=[]] Pre-placed settlement descriptors.
 * @param {boolean}  [params.secretHalo=true]    Enclosed halo pockets, secret biome treatment, and halo access roads.
 * @returns {{ panelData, width, height, islandSeeds, roadPaths, roadWaypoints, panelStats, assignedPanels, pocketIdGrid?: Uint32Array|null, pocketCellsById?: Array<Int32Array>|null }}
 */

/**
 * Assigns a human-readable `mapName` to each entry in `panelData` in-place.
 * Mirrors the export-time logic in mgCore.js but runs at layout generation time
 * so the name is available for UI display before export.
 */
function assignPanelMapNames(panelData) {
  const isBonusArea = (pd) => pd.isForestHaloEnclosed || pd.isSecretHaloPocket
  const isRealRoute = (pd) => pd.isRoute && !pd.isForestHalo && !pd.settlement && !isBonusArea(pd)

  for (const pd of Object.values(panelData)) {
    if (pd.settlement) pd.mapName = `Settlement ${pd.settlement.id + 1}`
  }

  const ROUTE_CLUSTER_MAX = 4
  let routeN = 0
  const routeSeen = new Set()
  for (const [key, pd] of Object.entries(panelData)) {
    if (!isRealRoute(pd) || routeSeen.has(key)) continue
    // BFS: collect up to ROUTE_CLUSTER_MAX panels, then stop expanding.
    const cluster = []
    const q = [key]
    const inQueue = new Set([key])
    while (q.length && cluster.length < ROUTE_CLUSTER_MAX) {
      const k = q.shift()
      cluster.push(k)
      const [x, y] = k.split(',').map(Number)
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = `${x+dx},${y+dy}`
        if (inQueue.has(nk) || routeSeen.has(nk)) continue
        const nb = panelData[nk]
        if (!nb || !isRealRoute(nb)) continue
        inQueue.add(nk)
        q.push(nk)
      }
    }
    routeN++
    const name = `Route ${routeN}`
    for (const k of cluster) {
      routeSeen.add(k)
      panelData[k].mapName = name
    }
  }

  let bonusN = 0
  const bonusSeen = new Set()
  for (const [key, pd] of Object.entries(panelData)) {
    if (!isBonusArea(pd) || pd.settlement || bonusSeen.has(key)) continue
    bonusN++
    const name = `Bonus Area ${bonusN}`
    const q = [key]
    bonusSeen.add(key)
    while (q.length) {
      const k = q.shift()
      panelData[k].mapName = name
      const [x, y] = k.split(',').map(Number)
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = `${x+dx},${y+dy}`
        if (bonusSeen.has(nk)) continue
        const nb = panelData[nk]
        if (!nb || !isBonusArea(nb) || nb.settlement) continue
        bonusSeen.add(nk)
        q.push(nk)
      }
    }
  }

  for (const pd of Object.values(panelData)) {
    if (!pd.mapName && pd.isForestHalo) pd.mapName = 'Halo'
  }
}

function generateFromTerrain({ panelData, width, height, islandSeeds, rand, seed = 0, settlements, lockedSettlements = [], secretHalo = true }) {
  const W = width * PANEL, H = height * PANEL
  /** World-cell pocket id grid (0 = none). Populated in Step 20. */
  let pocketIdGrid = null
  /** Lists of world-cell indices per pocket id (index == pocketId). Populated in Step 20. */
  let pocketCellsById = null

  // --- Step 6: Settlement Placement ---
  const panelStats = {}
  const validLandPanels = []
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const key = `${px},${py}`
      const pd = panelData[key]

      let landCount = 0, waterCount = 0, maxElev = 0
      const elevs = new Set()
      const elevCounts = new Map()

      for (const cell of pd.grid) {
        if (cell.type === T.LAND) {
          landCount++
          elevs.add(cell.elevation)
          if (cell.elevation > maxElev) maxElev = cell.elevation
          elevCounts.set(cell.elevation, (elevCounts.get(cell.elevation) ?? 0) + 1)
        } else if (cell.type === T.OCEAN || cell.type === T.LAKE) {
          waterCount++
        }
      }

      // Dominant elevation: the most common elevation among land tiles
      let dominantElevCount = 0
      for (const cnt of elevCounts.values()) if (cnt > dominantElevCount) dominantElevCount = cnt
      const elevUniformity = landCount > 0 ? dominantElevCount / landCount : 0

      // Viable for settlement: ≥75% land, and reasonably flat (dominant elevation share threshold).
      const isLand = landCount >= (PANEL * PANEL) * SETTLEMENT_VIABILITY_LAND && elevUniformity >= SETTLEMENT_VIABILITY_UNIFORMITY
      const isCoastal = isLand && waterCount > 0

      const hasWater = waterCount > 0
      const isWaterDominant = landCount < (PANEL * PANEL) / 2
      panelStats[key] = { px, py, isLand, isCoastal, maxElev, key, waterCount, hasWater, elevs, elevUniformity, elevCounts }
      panelData[key].hasWater = hasWater
      panelData[key].isWaterDominant = isWaterDominant
      if (isLand) validLandPanels.push(panelStats[key])
    }
  }

  const assignedPanels = new Set()
  const clusters = []

  const SETTLEMENT_LARGE_SHARE = 0.25
  const SETTLEMENT_MEDIUM_SHARE = 0.35

  const getDominantElev = (stat) => {
    let best = -1, bestCount = 0
    for (const [e, cnt] of stat.elevCounts ?? []) if (cnt > bestCount) { bestCount = cnt; best = e }
    return best
  }

  const isPanelClearOfOtherClusters = (px, py, currentClusterSet) => {
    const RADIUS = SETTLEMENT_SPACING_RADIUS
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const k = `${px + dx},${py + dy}`
        if (assignedPanels.has(k) && !currentClusterSet.has(k)) {
          return false
        }
      }
    }
    return true
  }

  /**
   * BFS cluster growth — marks contiguous same-elevation panels as one settlement.
   *
   * Starting from `rootStat`, expands outward via randomised BFS, absorbing
   * neighbours that share the dominant elevation and are not already assigned.
   * Enforces `SETTLEMENT_SPACING_RADIUS` separation from other clusters.
   * Mutates `panelData`, `assignedPanels`, and `clusters`.
   *
   * @param {Object} rootStat  Panel stats object for the seed panel.
   * @param {number} sizeGoal  Target number of panels in the cluster.
   * @param {'small'|'medium'|'large'} size      Settlement size bucket (controls cluster goal only).
   */
  const addCluster = (rootStat, sizeGoal, size, source = 'base') => {
    if (!rootStat) return
    const cappedGoal = Math.max(1, Math.min(SETTLEMENT_MAX_PANELS, sizeGoal | 0))
    const cluster = [rootStat.key]
    const activeCluster = new Set([rootStat.key])

    const clusterDomElev = getDominantElev(rootStat)
    const domTol = size === 'large' ? 1 : 0

    assignedPanels.add(rootStat.key)
    panelData[rootStat.key].settlement = { kind: 'settlement', size, id: clusters.length, source }

    const open = [rootStat.key]
    while (cluster.length < cappedGoal && open.length > 0) {
      const idx = Math.floor(rand() * open.length)
      const currentKey = open.splice(idx, 1)[0]
      const [cpx, cpy] = currentKey.split(',').map(Number)

      const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .sort(() => rand() - 0.5)
        .map(([dx, dy]) => `${cpx + dx},${cpy + dy}`)

      for (const nk of neighbors) {
        if (cluster.length >= cappedGoal) break
        const st = panelStats[nk]
        if (!st || !st.isLand || assignedPanels.has(nk)) continue
        const [nx, ny] = nk.split(',').map(Number)
        if (!isPanelClearOfOtherClusters(nx, ny, activeCluster)) continue

        // Absorb only if neighbour's dominant elevation is compatible with the cluster's.
        const neighbourDomElev = getDominantElev(st)
        if (Math.abs(neighbourDomElev - clusterDomElev) > domTol) continue

        assignedPanels.add(nk)
        activeCluster.add(nk)
        open.push(nk)
        cluster.push(nk)
        panelData[nk].settlement = { kind: 'settlement', size, id: clusters.length, source }
      }
    }
    clusters.push({ size, panels: cluster, source })
  }

  const targetSettlements = Math.max(0, settlements | 0)
  const largeCount = Math.min(targetSettlements, Math.max(0, Math.round(targetSettlements * SETTLEMENT_LARGE_SHARE)))
  const mediumCount = Math.min(targetSettlements - largeCount, Math.max(0, Math.round(targetSettlements * SETTLEMENT_MEDIUM_SHARE)))
  const smallCount = Math.max(0, targetSettlements - largeCount - mediumCount)

  /** @type {Array<'small'|'medium'|'large'>} */
  const sizePool = []
  for (let i = 0; i < largeCount; i++) sizePool.push('large')
  for (let i = 0; i < mediumCount; i++) sizePool.push('medium')
  for (let i = 0; i < smallCount; i++) sizePool.push('small')
  // Deterministic shuffle
  for (let i = sizePool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = sizePool[i]; sizePool[i] = sizePool[j]; sizePool[j] = tmp
  }

  const popSize = (preferLarge = true) => {
    if (sizePool.length === 0) return null
    if (preferLarge) {
      const idx = sizePool.indexOf('large')
      if (idx >= 0) return sizePool.splice(idx, 1)[0]
    }
    return sizePool.shift() || null
  }

  const goalForSize = (size) => {
    if (size === 'large') return Math.min(SETTLEMENT_MAX_PANELS, 3 + Math.floor(rand() * 3)) // 3–5
    if (size === 'medium') return Math.min(SETTLEMENT_MAX_PANELS, 2 + Math.floor(rand() * 2)) // 2–3
    return Math.min(SETTLEMENT_MAX_PANELS, 1 + Math.floor(rand() * 2)) // 1–2
  }

  const sizeFromLegacyType = (t) => (t === 'city' ? 'large' : t === 'town' ? 'medium' : 'small')

  // Step 6.0: Locked Settlement Placement — place manually anchored settlements first.
  // If the panel is valid land, place it; skip silently if the panel doesn't qualify.
  for (const { px: lpx, py: lpy, type: ltype } of lockedSettlements) {
    const lkey = `${lpx},${lpy}`
    const lstat = panelStats[lkey]
    if (!lstat || !lstat.isLand || assignedPanels.has(lkey)) continue
    const size = sizeFromLegacyType(ltype)
    // Consume one slot from the pool if present; otherwise still place it.
    const poolIdx = sizePool.indexOf(size)
    if (poolIdx >= 0) sizePool.splice(poolIdx, 1)
    addCluster(lstat, goalForSize(size), size)
  }

  const getUnassigned = () => validLandPanels.filter(p => !assignedPanels.has(p.key) && isPanelClearOfOtherClusters(p.px, p.py, new Set()))

  // Step 6.1: Peak Constraint (small settlement at level 6)
  const peakSeeds = Object.values(panelStats).filter(p => getDominantElev(p) === 6)
  if (peakSeeds.length > 0) {
    const sz = popSize(false) // don't burn a 'large' here
    if (sz) {
    // BFS from all level-6 seeds, absorbing neighbours that are also majority level 6
    const peakPanels = new Set(peakSeeds.map(p => p.key))
    const peakQueue = [...peakSeeds.map(p => p.key)]
    let pqi = 0
    while (pqi < peakQueue.length) {
      const cur = peakQueue[pqi++]
      const [cpx, cpy] = cur.split(',').map(Number)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = `${cpx + dx},${cpy + dy}`
        if (peakPanels.has(nk)) continue
        const st = panelStats[nk]
        if (!st) continue
        if (getDominantElev(st) === 6) {
          peakPanels.add(nk)
          peakQueue.push(nk)
        }
      }
    }
    const peakId = clusters.length
    const peakCluster = []
    // Cap peak settlement footprint deterministically.
    const peakList = Array.from(peakPanels).sort()
    for (const pk of peakList.slice(0, SETTLEMENT_MAX_PANELS)) {
      assignedPanels.add(pk)
      panelData[pk].settlement = { kind: 'settlement', size: sz, id: peakId }
      peakCluster.push(pk)
    }
    clusters.push({ size: sz, panels: peakCluster })
    }
  }

  // Step 6.2: Coastal Constraint
  const unassignedCoast = getUnassigned().filter(p => p.isCoastal)
  if (unassignedCoast.length > 0) {
    const coast = unassignedCoast[Math.floor(rand() * unassignedCoast.length)]
    const sz = popSize(true)
    if (sz) addCluster(coast, goalForSize(sz), sz)
  }

  // Step 6.3: Island Constraint
  for (const isle of islandSeeds) {
    const ipx = Math.round(isle.cx / PANEL)
    const ipy = Math.round(isle.cy / PANEL)
    const key = `${ipx},${ipy}`
    let targetP = null
    if (!assignedPanels.has(key) && panelStats[key]?.isLand) {
      targetP = panelStats[key]
    } else {
      const cands = getUnassigned()
      if (cands.length > 0) {
        let best = null, minDist = Infinity
        for (const p of cands) {
          const d = Math.max(Math.abs(p.px - ipx), Math.abs(p.py - ipy))
          if (d < minDist) { minDist = d; best = p }
        }
        if (best && minDist < 6) targetP = best
      }
    }

    if (targetP) {
      const sz = popSize(false)
      if (sz) addCluster(targetP, goalForSize(sz), sz)
    }
  }

  // Step 6.4: Central Landmass Constraint
  const centerCands = getUnassigned()
  if (centerCands.length > 0) {
    let sumX = 0, sumY = 0
    for (const p of validLandPanels) { sumX += p.px; sumY += p.py }
    const cx = sumX / validLandPanels.length
    const cy = sumY / validLandPanels.length
    // Force spawn 2 central settlements 
    for (let i = 0; i < 2; i++) {
      const uac = getUnassigned()
      if (uac.length === 0) break
      let best = null, minDist = Infinity
      for (const p of uac) {
        const d = Math.abs(p.px - cx) + Math.abs(p.py - cy)
        if (d < minDist) { minDist = d; best = p }
      }
      if (best) {
        const sz = popSize(true)
        if (sz) addCluster(best, goalForSize(sz), sz)
      }
    }
  }

  // Step 6.5: Furthest-Point Spreading (FPS)
  const distToClusters = (p) => {
    if (clusters.length === 0) return Infinity
    let md = Infinity
    for (const cl of clusters) {
      for (const ck of cl.panels) {
        const [cpx, cpy] = ck.split(',').map(Number)
        const d = Math.abs(cpx - p.px) + Math.abs(cpy - p.py)
        if (d < md) md = d
      }
    }
    return md
  }

  while (sizePool.length > 0) {
    const ua = getUnassigned()
    if (ua.length === 0) break
    let best = null, maxDist = -1
    for (const p of ua) {
      const d = distToClusters(p)
      if (d > maxDist) { maxDist = d; best = p }
    }
    if (best) {
      const sz = popSize(true)
      if (!sz) break
      addCluster(best, goalForSize(sz), sz)
    } else {
      break
    }
  }

  // Step 7: Filler Pass (8x8 Void Fill)
  for (let fy = 0; fy <= height - 8; fy += 4) {
    for (let fx = 0; fx <= width - 8; fx += 4) {
      let found = false
      for (let dy = 0; dy < 8; dy++) {
        for (let dx = 0; dx < 8; dx++) {
          if (assignedPanels.has(`${fx + dx},${fy + dy}`)) {
            found = true
            break
          }
        }
        if (found) break
      }

      if (!found) {
        // Find midpoint or first valid land panel in this empty 8x8 square
        const candidates = []
        for (let dy = 0; dy < 8; dy++) {
          for (let dx = 0; dx < 8; dx++) {
            const st = panelStats[`${fx + dx},${fy + dy}`]
            if (st && st.isLand && isPanelClearOfOtherClusters(st.px, st.py, new Set())) {
              candidates.push(st)
            }
          }
        }
        if (candidates.length > 0) {
          // Pick middle-most candidate 
          const midX = fx + 4, midY = fy + 4
          candidates.sort((a, b) => (Math.abs(a.px - midX) + Math.abs(a.py - midY)) - (Math.abs(b.px - midX) + Math.abs(b.py - midY)))
          const sz = popSize(false)
          if (sz) addCluster(candidates[0], goalForSize(sz), sz)
        }
      }
    }
  }

  // --- Step 7: Settlement Routing (A*) ---
  const panelRouteMeanderNoise = createNoise2D(rand)

  /**
   * Panel-level A* — finds the cheapest route from one settlement panel to any target.
   *
   * Builds the "Grand Highway" skeleton that `isRoute` flags panels along. Cost is
   * based on water dominance (heavy penalty), water presence (moderate), and whether a
   * panel is already routed (near-zero, encourages reuse). Land and reuse steps are
   * scaled by seeded Simplex noise so routes meander instead of hugging the geometric
   * shortest corridor. Uses lazy-deletion in the min-heap instead of decrease-key —
   * acceptable at 32×32 panel scale.
   *
   * @param {string}      startKey      Panel key `"x,y"` for the start settlement.
   * @param {Set<string>} targetKeysSet Set of panel keys that count as valid destinations.
   * @returns {string[]|null} Ordered list of panel keys forming the path, or null if unreachable.
   */
  const panelRouteAStar = (startKey, targetKeysSet) => {
    const [sx, sy] = startKey.split(',').map(Number)
    const dist = { [startKey]: 0 }
    const prev = {}
    const heap = new MinHeap()
    heap.push({ f: 0, x: sx, y: sy, key: startKey })

    while (heap.size > 0) {
      const { f: d, x, y, key } = heap.pop()
      if (d > (dist[key] ?? Infinity)) continue
      if (targetKeysSet.has(key)) {
        const path = []
        let curr = key
        while (curr) { path.push(curr); curr = prev[curr] }
        return path
      }

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const nkey = `${nx},${ny}`
        const npd = panelData[nkey]
        let moveCost = npd.isWaterDominant ? ASTAR_PANEL_WATER_DOMINANT_COST : npd.hasWater ? ASTAR_PANEL_WATER_COST : npd.isRoute ? 0.1 : 1.0
        if (PANEL_ROUTE_MEANDER_WEIGHT > 0 && moveCost <= 1) {
          const n = panelRouteMeanderNoise(nx * PANEL_ROUTE_MEANDER_SCALE, ny * PANEL_ROUTE_MEANDER_SCALE)
          moveCost *= 1 + PANEL_ROUTE_MEANDER_WEIGHT * n
        }
        const nd = d + moveCost
        if (nd < (dist[nkey] ?? Infinity)) {
          dist[nkey] = nd
          prev[nkey] = key
          heap.push({ f: nd, x: nx, y: ny, key: nkey })
        }
      }
    }
    return null
  }

  const allSetts = [...clusters]
  if (allSetts.length > 0) {
    const connectedPanels = new Set()
    const connectedIdxs = new Set()

    const startIdx = Math.floor(rand() * allSetts.length)
    connectedIdxs.add(startIdx)
    allSetts[startIdx].panels.forEach(p => {
      connectedPanels.add(p)
      panelData[p].isRoute = true
    })

    const markPath = (path) => {
      if (!path) return
      for (const k of path) {
        panelData[k].isRoute = true
        connectedPanels.add(k)
      }
    }

    const available = allSetts.map((_, i) => i).filter(i => i !== startIdx)
    const targetPreCount = Math.ceil(allSetts.length / 2)

    // Part 1: Connect to half the settlements
    while (connectedIdxs.size < targetPreCount && available.length > 0) {
      const idxInAvail = Math.floor(rand() * available.length)
      const sIdx = available.splice(idxInAvail, 1)[0]
      // Path from settlement sIdx to ANY connected panel
      const path = panelRouteAStar(allSetts[sIdx].panels[0], connectedPanels)
      if (path) {
        markPath(path)
        allSetts[sIdx].panels.forEach(p => {
          panelData[p].isRoute = true
          connectedPanels.add(p)
        })
        connectedIdxs.add(sIdx)
      }
    }

    // Part 2: Connect the rest
    const remaining = allSetts.map((_, i) => i).filter(i => !connectedIdxs.has(i))
    for (const sIdx of remaining) {
      const path = panelRouteAStar(allSetts[sIdx].panels[0], connectedPanels)
      if (path) {
        markPath(path)
        allSetts[sIdx].panels.forEach(p => {
          panelData[p].isRoute = true
          connectedPanels.add(p)
        })
        connectedIdxs.add(sIdx)
      }
    }
  }

  // --- Step 7.5: Route Run Breakers (forced settlements) ---
  // If a highway corridor runs too long without a settlement, force-place "stop"
  // settlements along the route graph (not just straight row/col runs). This breaks
  // up long snaking corridors.
  ; (() => {
    const ROUTE_RUN_MAX = 5
    const ROUTE_BREAKER_MAX_WATER_FRAC = 0.4

    const waterFrac = (k) => (panelStats[k]?.waterCount ?? 0) / (PANEL * PANEL)

    const isRouteOnly = (k) =>
      !!panelData[k]?.isRoute &&
      !panelData[k]?.settlement &&
      waterFrac(k) < ROUTE_BREAKER_MAX_WATER_FRAC

    const pickFlattestIn = (keys) => {
      let best = null
      let bestScore = -Infinity
      for (const k of keys) {
        const st = panelStats[k]
        if (!st) continue
        if (panelData[k]?.isWaterDominant) continue
        if (waterFrac(k) >= ROUTE_BREAKER_MAX_WATER_FRAC) continue
        if (assignedPanels.has(k)) continue
        if (!isPanelClearOfOtherClusters(st.px, st.py, new Set())) continue

        const score = (st.isLand ? 1000 : 0) + (st.elevUniformity ?? 0)
        if (score > bestScore) { bestScore = score; best = st }
      }
      return best
    }

    const neighbors4 = (k) => {
      const [x, y] = k.split(',').map(Number)
      const out = []
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const nk = `${nx},${ny}`
        if (isRouteOnly(nk)) out.push(nk)
      }
      return out
    }

    const bfsFarthest = (start) => {
      /** @type {Map<string, string|null>} */
      const prev = new Map()
      /** @type {Map<string, number>} */
      const dist = new Map()
      const q = [start]
      prev.set(start, null)
      dist.set(start, 0)
      let qi = 0
      let far = start
      while (qi < q.length) {
        const cur = q[qi++]
        const d = dist.get(cur) ?? 0
        if (d > (dist.get(far) ?? 0)) far = cur
        for (const nk of neighbors4(cur)) {
          if (dist.has(nk)) continue
          dist.set(nk, d + 1)
          prev.set(nk, cur)
          q.push(nk)
        }
      }
      return { far, dist, prev }
    }

    const buildPath = (prev, end) => {
      const path = []
      let cur = end
      while (cur != null) {
        path.push(cur)
        cur = prev.get(cur) ?? null
      }
      path.reverse()
      return path
    }

    const seen = new Set()
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const start = `${px},${py}`
        if (!isRouteOnly(start) || seen.has(start)) continue

        // Collect component
        const comp = []
        const q = [start]
        seen.add(start)
        let qi = 0
        while (qi < q.length) {
          const cur = q[qi++]
          comp.push(cur)
          for (const nk of neighbors4(cur)) {
            if (seen.has(nk)) continue
            seen.add(nk)
            q.push(nk)
          }
        }
        if (comp.length <= ROUTE_RUN_MAX) continue

        // Find a long simple-ish path via component diameter approximation (two BFS)
        const a = bfsFarthest(start).far
        const bRes = bfsFarthest(a)
        const b = bRes.far
        const diameterPath = buildPath(bRes.prev, b)

        // Place a small settlement roughly every ROUTE_RUN_MAX panels along that path
        const stride = ROUTE_RUN_MAX + 1
        for (let i = stride; i < diameterPath.length - 1; i += stride) {
          // Choose best candidate within a window around the target index
          const window = []
          for (let j = Math.max(0, i - 2); j <= Math.min(diameterPath.length - 1, i + 2); j++) {
            window.push(diameterPath[j])
          }
          const best = pickFlattestIn(window)
          if (best) addCluster(best, 1, 'small', 'route_breaker')
        }
      }
    }
  })()

  // --- Step 7.6: Scenic connectors (extra panel A* links) ---
  // Add a couple of short cross-links, preferring settlements spawned by the
  // route-breaker pass so these "stops" create new alternate corridors.
  ; (() => {
    const EXTRA_LINKS = 2
    const MAX_PANELS = 10
    const MAX_TRIES_PER_LINK = 80

    const routeBreakerSetts = clusters
      .filter(s => s?.source === 'route_breaker')
      .map(s => s.panels?.[0])
      .filter(Boolean)

    const baseSetts = clusters.map(s => s.panels?.[0]).filter(Boolean)
    const pool = routeBreakerSetts.length >= 2 ? routeBreakerSetts : baseSetts
    if (pool.length < 2) return

    const bordersExistingRoute = (key, startKey, goalKey) => {
      if (key === startKey || key === goalKey) return false
      const [x, y] = key.split(',').map(Number)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const nk = `${nx},${ny}`
        if (nk === startKey || nk === goalKey) continue
        if (panelData[nk]?.isRoute) return true
      }
      return false
    }

    const aStarNoReuse = (startKey, goalKey) => {
      const [sx, sy] = startKey.split(',').map(Number)
      const [gx, gy] = goalKey.split(',').map(Number)
      const dist = { [startKey]: 0 }
      const prev = {}
      const heap = new MinHeap()
      heap.push({ f: Math.abs(sx - gx) + Math.abs(sy - gy), g: 0, x: sx, y: sy, key: startKey })

      while (heap.size > 0) {
        const { g, x, y, key } = heap.pop()
        if (g > (dist[key] ?? Infinity)) continue
        if (key === goalKey) {
          const path = []
          let curr = key
          while (curr) { path.push(curr); curr = prev[curr] }
          return path.reverse()
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const nkey = `${nx},${ny}`
          const npd = panelData[nkey]
          if (!npd) continue

          // Avoid existing routes (except allow goal panel).
          if (npd.isRoute && nkey !== goalKey) continue
          // Also avoid bordering any existing route panel (except endpoints).
          if (bordersExistingRoute(nkey, startKey, goalKey)) continue

          // Keep the same water penalties as main routing.
          let moveCost = npd.isWaterDominant ? ASTAR_PANEL_WATER_DOMINANT_COST : npd.hasWater ? ASTAR_PANEL_WATER_COST : 1.0
          const ng = g + moveCost
          if (ng < (dist[nkey] ?? Infinity)) {
            dist[nkey] = ng
            prev[nkey] = key
            heap.push({ f: ng + Math.abs(nx - gx) + Math.abs(ny - gy), g: ng, x: nx, y: ny, key: nkey })
          }
        }
      }
      return null
    }

    const usedPairs = new Set()
    let placed = 0
    while (placed < EXTRA_LINKS) {
      let ok = false
      for (let tries = 0; tries < MAX_TRIES_PER_LINK; tries++) {
        const a = pool[(rand() * pool.length) | 0]
        let b = pool[(rand() * pool.length) | 0]
        if (a === b) continue
        const pk = a < b ? `${a}|${b}` : `${b}|${a}`
        if (usedPairs.has(pk)) continue

        const path = aStarNoReuse(a, b)
        if (!path) continue
        const steps = path.length - 1
        if (steps <= 0 || steps > MAX_PANELS) continue

        // Final validation: ensure no interior step borders the pre-existing route network.
        // (After stamping, this path becomes route too, but we only care about avoiding
        // the existing network, not avoiding itself.)
        let valid = true
        for (let i = 1; i < path.length - 1; i++) {
          if (bordersExistingRoute(path[i], a, b)) { valid = false; break }
        }
        if (!valid) continue

        for (const k of path) panelData[k].isRoute = true
        usedPairs.add(pk)
        placed++
        ok = true
        break
      }
      if (!ok) break
    }
  })()

  // --- Step 8: Forest Border Stamping ---
  // Transforms coastal pixels into forest based on proximity and noise depth.
  const forestNoise2D = createNoise2D(rand)
  const isVisitable = (pk) => {
    const pd2 = panelData[pk]
    return pd2 && (pd2.isRoute || pd2.settlement)
  }

  for (const key of Object.keys(panelData)) {
    if (!isVisitable(key)) continue
    const [px2, py2] = key.split(',').map(Number)

    const borderN = !isVisitable(`${px2},${py2 - 1}`)
    const borderS = !isVisitable(`${px2},${py2 + 1}`)
    const borderW = !isVisitable(`${px2 - 1},${py2}`)
    const borderE = !isVisitable(`${px2 + 1},${py2}`)

    if (!borderN && !borderS && !borderW && !borderE) continue

    const pd2 = panelData[key]
    for (let cy = 0; cy < PANEL; cy++) {
      for (let cx = 0; cx < PANEL; cx++) {
        const cell = pd2.grid[cy * PANEL + cx]
        if (cell.type !== T.LAND) continue

        const wx = px2 * PANEL + cx, wy = py2 * PANEL + cy
        const isSettlement = !!panelData[key].settlement
        const nn = (forestNoise2D(wx / (W * 0.08), wy / (W * 0.08)) + 1) / 2
        const depth = isSettlement
          ? (3 + Math.floor(nn * (6 - 3 + 1)))
          : (FOREST_BORDER_DEPTH_MIN + Math.floor(nn * (FOREST_BORDER_DEPTH_MAX - FOREST_BORDER_DEPTH_MIN)))

        const distN = cy, distS = PANEL - 1 - cy
        const distW = cx, distE = PANEL - 1 - cx

        const inForestZone =
          (borderN && distN < depth) ||
          (borderS && distS < depth) ||
          (borderW && distW < depth) ||
          (borderE && distE < depth)

        if (inForestZone) cell.type = T.FOREST
      }
    }
  }

  // --- Step 9: Forest Blob Placement ---
  // Mid-frequency noise blobs to break up landmasses.
  const blobNoise2D = createNoise2D(rand)
  const BLOB_THRESHOLD = FOREST_BLOB_THRESHOLD  // ~8% coverage at this threshold

  for (const key of Object.keys(panelData)) {
    if (!isVisitable(key)) continue
    if (panelData[key].settlement) continue  // settlements get a clean canvas — no blobs
    const [px2, py2] = key.split(',').map(Number)
    const pd2 = panelData[key]

    for (let cy = 0; cy < PANEL; cy++) {
      for (let cx = 0; cx < PANEL; cx++) {
        const cell = pd2.grid[cy * PANEL + cx]
        if (cell.type !== T.LAND) continue

        const wx = px2 * PANEL + cx, wy = py2 * PANEL + cy
        // Mid-frequency: blobs are a few tiles across
        const n = (blobNoise2D(wx / (W * 0.025), wy / (W * 0.025)) + 1) / 2
        if (n > BLOB_THRESHOLD) cell.type = T.FOREST
      }
    }
  }

  // --- Step 10: Forest Connectivity Cleanup ---
  // BFS reachability check to convert landlocked pockets to forest.
  const forestReachable = new Uint8Array(W * H)
  const fq = []
  let fqi = 0
  for (const key of Object.keys(panelData)) {
    if (!isVisitable(key)) continue
    const [px2, py2] = key.split(',').map(Number)
    const sx = px2 * PANEL + (PANEL >> 1)
    const sy = py2 * PANEL + (PANEL >> 1)
    const si = sy * W + sx
    const sc = panelData[key].grid[(PANEL >> 1) * PANEL + (PANEL >> 1)]
    if (sc.type !== T.FOREST && !forestReachable[si]) {
      forestReachable[si] = 1
      fq.push(si)
    }
  }
  while (fqi < fq.length) {
    const ci = fq[fqi++]
    const cx2 = ci % W, cy2 = (ci / W) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx2 + dx, ny = cy2 + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const ni = ny * W + nx
      if (forestReachable[ni]) continue
      const npk = `${(nx / PANEL) | 0},${(ny / PANEL) | 0}`
      if (!isVisitable(npk)) continue
      const nc = panelData[npk]?.grid[(ny % PANEL) * PANEL + (nx % PANEL)]
      if (!nc || nc.type === T.FOREST) continue
      forestReachable[ni] = 1
      fq.push(ni)
    }
  }
  // Convert unreachable LAND tiles to FOREST
  for (const key of Object.keys(panelData)) {
    if (!isVisitable(key)) continue
    const [px2, py2] = key.split(',').map(Number)
    const pd2 = panelData[key]
    for (let cy = 0; cy < PANEL; cy++) {
      for (let cx = 0; cx < PANEL; cx++) {
        const cell = pd2.grid[cy * PANEL + cx]
        if (cell.type !== T.LAND) continue
        const gi = (py2 * PANEL + cy) * W + (px2 * PANEL + cx)
        if (!forestReachable[gi]) cell.type = T.FOREST
      }
    }
  }

  // --- Step 11: Cliff Detection + Direction Encoding ---
  // A solid cell (LAND/FOREST/ROAD) becomes T.CLIFF if any solid neighbour is at a lower elevation.
  // The cell "owns" the edge — it is the high side, and tileIndex encodes which direction it drops toward.
  //
  // 12-tile strip layout:
  //   0=N   1=NE(outer)  2=E   3=SE(outer)  4=S   5=SW(outer)  6=W   7=NW(outer)
  //   8=NW(inner)  9=NE(inner)  10=SW(inner)  11=SE(inner)
  //
  // Tile selection logic:
  //   Single cardinal drop only      → straight edge (0,2,4,6)
  //   Two cardinals + matching diag  → outer corner, exposed tip (1,3,5,7)
  //   Two cardinals, no matching diag → inner corner, concave notch (8–11)
  //   Diagonal drop only              → inner corner (8–11)
  //   Fallback: single remaining cardinal
  ; (() => {
    const getCell = (wx, wy) => {
      if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
      return panelData[`${(wx / PANEL) | 0},${(wy / PANEL) | 0}`]?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
    }
    const isSolid = t => t === T.LAND || t === T.FOREST || t === T.ROAD

    for (let wy = 0; wy < H; wy++) {
      for (let wx = 0; wx < W; wx++) {
        const pk = `${(wx / PANEL) | 0},${(wy / PANEL) | 0}`
        const pd = panelData[pk]
        const cell = getCell(wx, wy)
        if (!cell || !isSolid(cell.type) || cell.elevation <= 1) continue

        // isLower: true if the neighbour is solid and sits at a lower elevation than this cell
        const isLower = (dx, dy) => {
          const nb = getCell(wx + dx, wy + dy)
          return nb && nb.elevation < cell.elevation
        }
        const N = isLower(0, -1), S = isLower(0, 1), E = isLower(1, 0), W = isLower(-1, 0)
        const NE = isLower(1, -1), SE = isLower(1, 1), SW = isLower(-1, 1), NW = isLower(-1, -1)

        if (!N && !S && !E && !W && !NE && !SE && !SW && !NW) continue

        cell.type = T.CLIFF
        if (cell.biome == null && pd?.biome != null) cell.biome = pd.biome
        cell.tileIndex = cliffTileIdx(N, S, E, W, NE, SE, SW, NW)
      }
    }
  })()

  // --- Step 12: Tile-Level Road Stamping ---
  // Per-panel A* routing. Runs after Step 11; cliffs already have `tileIndex` from `cliffTileIdx`.
  // Each visitable panel routes between all its entry edge points, constrained to its own tiles.
  // Roads: stamp ONLY the A* centerline (no widening, no rebuild, no cleanup).
  /**
   * Minimum tile distance from each panel side that has an active edge (road to a neighbor)
   * for the interior merge waypoint. Pulls the center away from entry seams so paths can snake.
   */
  const INTERIOR_MIN_FROM_ACTIVE_EDGE = 6

  /**
   * Local [lx,ly] bounds: at least `INTERIOR_MIN_FROM_ACTIVE_EDGE` tiles inside the panel
   * from each edge that has a visitable neighbor (the edge waypoint axis for that side).
   */
  const activeEdgeInteriorInsetBounds = (activeEdges) => {
    if (!activeEdges || activeEdges.length === 0) return null
    let minLx = 0, maxLx = PANEL - 1, minLy = 0, maxLy = PANEL - 1
    const m = INTERIOR_MIN_FROM_ACTIVE_EDGE
    for (const e of activeEdges) {
      if (e.dx === -1) minLx = Math.max(minLx, m)
      if (e.dx === 1) maxLx = Math.min(maxLx, PANEL - 1 - m)
      if (e.dy === -1) minLy = Math.max(minLy, m)
      if (e.dy === 1) maxLy = Math.min(maxLy, PANEL - 1 - m)
    }
    if (minLx > maxLx || minLy > maxLy) return null
    return { minLx, maxLx, minLy, maxLy }
  }

  /**
   * Intersects the usual 25–75% interior band with edge-inset bounds; falls back to the band only
   * if the intersection is empty.
   */
  const interiorWaypointScanRect = (insetBounds) => {
    const lo = PANEL >> 2
    const hi = PANEL - lo - 1
    if (!insetBounds) return { x0: lo, x1: hi, y0: lo, y1: hi }
    let x0 = Math.max(lo, insetBounds.minLx)
    let x1 = Math.min(hi, insetBounds.maxLx)
    let y0 = Math.max(lo, insetBounds.minLy)
    let y1 = Math.min(hi, insetBounds.maxLy)
    if (x0 > x1 || y0 > y1) return { x0: lo, x1: hi, y0: lo, y1: hi }
    return { x0, x1, y0, y1 }
  }

  /**
   * Scans a panel for cliff tiles that form a valid 3-tile-wide crossing corridor.
   *
   * Only straight-edge cliffs (tileIndex 0=N, 2=E, 4=S, 6=W) can be crossed by
   * roads. A cliff tile is passable if its two adjacent same-axis cliff neighbours
   * are also straight-edge cliffs (the corridor is 3 tiles wide at that point).
   *
   * @param {number} px Panel X coordinate.
   * @param {number} py Panel Y coordinate.
   * @returns {Set<number>} Set of flat local indices (ly*PANEL+lx) of passable cliff tiles.
   */
  const getPassableCliffTiles = (px, py) => {
    const passable = new Set()
    const grid = panelData[`${px},${py}`]?.grid
    if (!grid) return passable
    for (let ly = 0; ly < PANEL; ly++) {
      for (let lx = 0; lx < PANEL; lx++) {
        const c = grid[ly * PANEL + lx]
        if (c?.type !== T.CLIFF) continue
        const ti = c.tileIndex
        if (ti !== 0 && ti !== 2 && ti !== 4 && ti !== 6) continue
        if (ti === 0 || ti === 4) {
          // horizontal face — check left and right neighbors
          if (lx >= 1 && lx < PANEL - 1) {
            const l = grid[ly * PANEL + (lx - 1)]
            const r = grid[ly * PANEL + (lx + 1)]
            if (l?.type === T.CLIFF && (l.tileIndex === 0 || l.tileIndex === 4) &&
              r?.type === T.CLIFF && (r.tileIndex === 0 || r.tileIndex === 4))
              passable.add(ly * PANEL + lx)
          }
        } else {
          // vertical face — check above and below neighbors
          if (ly >= 1 && ly < PANEL - 1) {
            const u = grid[(ly - 1) * PANEL + lx]
            const d = grid[(ly + 1) * PANEL + lx]
            if (u?.type === T.CLIFF && (u.tileIndex === 2 || u.tileIndex === 6) &&
              d?.type === T.CLIFF && (d.tileIndex === 2 || d.tileIndex === 6))
              passable.add(ly * PANEL + lx)
          }
        }
      }
    }
    return passable
  }

  /**
   * Builds a per-panel distance-to-nearest-cliff map via BFS.
   *
   * Seeds from all cliff tiles in the panel, then BFS outward. Values are capped
   * at 4 — tiles further than 4 steps from any cliff incur no proximity penalty.
   * Used by `makeTileCost` to discourage road A* from hugging cliff edges.
   *
   * @param {number} px Panel X coordinate.
   * @param {number} py Panel Y coordinate.
   * @returns {Int8Array} Flat array of length PANEL*PANEL; value = distance to nearest cliff (max 4, or 127 = none).
   */
  const buildCliffDistMap = (px, py) => {
    const grid = panelData[`${px},${py}`]?.grid
    const distMap = new Int8Array(PANEL * PANEL).fill(127)
    if (!grid) return distMap
    const queue = []
    for (let i = 0; i < PANEL * PANEL; i++) {
      if (grid[i]?.type === T.CLIFF) { distMap[i] = 0; queue.push(i) }
    }
    let head = 0
    while (head < queue.length) {
      const idx = queue[head++]
      const lx = idx % PANEL, ly = (idx / PANEL) | 0
      const d = distMap[idx]
      if (d >= 4) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = lx + dx, ny = ly + dy
        if (nx < 0 || ny < 0 || nx >= PANEL || ny >= PANEL) continue
        const ni = ny * PANEL + nx
        if (distMap[ni] > d + 1) { distMap[ni] = d + 1; queue.push(ni) }
      }
    }
    return distMap
  }

  /**
   * Returns a tile cost function clamped to a single panel for use in `tileRoute`.
   *
   * Tiles outside the panel return Infinity. Cliff tiles are Infinity unless they
   * are in `passableCliffs` (valid 3-wide corridor), in which case they cost
   * `ASTAR_TILE_CLIFF_PASSABLE_COST`. All other tiles get a base terrain cost plus
   * a proximity penalty from `ASTAR_TILE_CLIFF_STAMP_PENALTIES` scaled by `cliffDist`.
   *
   * @param {number}     px             Panel X coordinate.
   * @param {number}     py             Panel Y coordinate.
   * @param {Set<number>} passableCliffs Flat local indices of cliff tiles that roads may cross.
   * @param {Int8Array}  cliffDist      Distance-to-cliff map from `buildCliffDistMap`.
   * @returns {function(x:number, y:number): number} Cost function for `tileRoute`.
   */
  const makeTileCost = (px, py, passableCliffs, cliffDist) => (x, y) => {
    if ((x / PANEL | 0) !== px || (y / PANEL | 0) !== py) return Infinity
    const lx = x % PANEL, ly = y % PANEL
    const c = panelData[`${px},${py}`]?.grid[ly * PANEL + lx]
    if (!c) return Infinity
    if (c.type === T.CLIFF) {
      return passableCliffs.has(ly * PANEL + lx) ? ASTAR_TILE_CLIFF_PASSABLE_COST : Infinity
    }
    if (c.type === T.ROAD || c.type === T.WATERROAD) return 0.1
    const d = cliffDist[ly * PANEL + lx]
    const penalty = d <= 1 ? ASTAR_TILE_CLIFF_STAMP_PENALTIES[0] : d <= 2 ? ASTAR_TILE_CLIFF_STAMP_PENALTIES[1] : d <= 3 ? ASTAR_TILE_CLIFF_STAMP_PENALTIES[2] : d <= 4 ? ASTAR_TILE_CLIFF_STAMP_PENALTIES[3] : ASTAR_TILE_CLIFF_STAMP_PENALTIES[4]
    // Water should be a last resort for panel routing.
    if (c.type === T.OCEAN || c.type === T.LAKE) return 60 + penalty
    if (c.type === T.FOREST) return 5 + penalty
    return 1 + penalty
  }

  /** Cardinal step dirs: 0=E, 1=W, 2=S, 3=N — opposites are (0,1) and (2,3). */
  const TILE_ROUTE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const TILE_ROUTE_DIR_NONE = 4
  /** Max direction changes along the path (90°/90° turns); start has no prior dir. */
  const TILE_ROUTE_MAX_TURNS = 3

  const tileRouteOpposite = (d) => (d === 0 ? 1 : d === 1 ? 0 : d === 2 ? 3 : 2)
  /** True if a and b are perpendicular cardinals (not parallel / not opposite). */
  const tileRouteDirsPerpendicular = (a, b) =>
    a !== TILE_ROUTE_DIR_NONE && b !== TILE_ROUTE_DIR_NONE &&
    a !== b && b !== tileRouteOpposite(a)

  const tileRouteStateKey = (x, y, lastDir, prevDir, turns, perpLen) =>
    `${x},${y},${lastDir},${prevDir},${turns},${perpLen}`

  /**
   * Tile-level A* between two world-pixel coordinates using an injected cost function.
   *
   * Cardinal moves only (no diagonals). `tileCost` is injected by `makeTileCost`
   * so this function is reusable across both the standard road stamp pass and the
   * cliff-side paving pass. Uses lazy-deletion in the MinHeap (acceptable at
   * PANEL×PANEL = max nodes per panel). Returns null if the target is unreachable.
   *
   * Search state includes incoming edge direction, previous edge direction, and turn count:
   * at most `TILE_ROUTE_MAX_TURNS` 90° turns; immediate 180° steps are forbidden; and
   * “skinny” U-turns are forbidden: a perpendicular stub of exactly **one** tile before
   * reversing against the prior leg (wider N→E→E→S style Us are still allowed).
   *
   * @param {number}   swx       Start world X pixel.
   * @param {number}   swy       Start world Y pixel.
   * @param {number}   twx       Target world X pixel.
   * @param {number}   twy       Target world Y pixel.
   * @param {function} tileCost  `(x, y) => number` — returns movement cost for a tile.
   * @returns {Array<[number,number]>|null} Ordered array of [wx, wy] world pixels, or null.
   */
  const tileRoute = (swx, swy, twx, twy, tileCost) => {
    const dist = new Map()
    const prev = new Map()
    const heap = new MinHeap()
    const h = (x, y) => Math.abs(x - twx) + Math.abs(y - twy)
    const ND = TILE_ROUTE_DIR_NONE

    const startKey = tileRouteStateKey(swx, swy, ND, ND, 0, 0)
    dist.set(startKey, 0)
    heap.push({ f: h(swx, swy), g: 0, x: swx, y: swy, lastDir: ND, prevDir: ND, turns: 0, perpLen: 0 })

    let bestGoalKey = null
    let bestGoalG = Infinity

    while (heap.size > 0) {
      const { g, x, y, lastDir, prevDir, turns, perpLen } = heap.pop()
      const k = tileRouteStateKey(x, y, lastDir, prevDir, turns, perpLen)
      if (g > (dist.get(k) ?? Infinity)) continue
      if (x === twx && y === twy) {
        if (g < bestGoalG) {
          bestGoalG = g
          bestGoalKey = k
        }
        continue
      }
      for (let idx = 0; idx < 4; idx++) {
        const [dx, dy] = TILE_ROUTE_DIRS[idx]
        const nx = x + dx, ny = y + dy
        const isGoal = nx === twx && ny === twy
        const stepCost = isGoal ? 1 : tileCost(nx, ny)
        if (stepCost === Infinity) continue

        if (prevDir !== ND && lastDir !== ND) {
          if (
            idx === tileRouteOpposite(prevDir) &&
            tileRouteDirsPerpendicular(lastDir, prevDir) &&
            perpLen <= 3
          ) {
            continue
          }
        }

        let nTurns = turns
        if (lastDir !== ND) {
          if (idx === tileRouteOpposite(lastDir)) continue
          if (idx !== lastDir) {
            nTurns = turns + 1
            if (nTurns > TILE_ROUTE_MAX_TURNS) continue
          }
        }

        let nPerp = 0
        if (lastDir === ND) {
          nPerp = 0
        } else if (idx === lastDir) {
          nPerp = (prevDir !== ND && tileRouteDirsPerpendicular(lastDir, prevDir)) ? perpLen + 1 : 0
        } else {
          nPerp = tileRouteDirsPerpendicular(idx, lastDir) ? 1 : 0
        }

        const ng = g + stepCost
        const nk = tileRouteStateKey(nx, ny, idx, lastDir, nTurns, nPerp)
        if (ng < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, ng)
          prev.set(nk, k)
          heap.push({
            f: ng + h(nx, ny), g: ng, x: nx, y: ny,
            lastDir: idx, prevDir: lastDir, turns: nTurns, perpLen: nPerp,
          })
        }
      }
    }
    if (bestGoalKey === null) return null
    const path = []
    let cur = bestGoalKey
    while (cur !== undefined) {
      const p = cur.split(',')
      path.push([+p[0], +p[1]])
      cur = prev.get(cur)
    }
    return path.reverse()
  }

  /**
   * Returns true if any tile in the 3×3 neighbourhood of a world pixel is a cliff.
   * Used by `stampCenter` and `stampSide` to prevent roads from being stamped on
   * or immediately adjacent to cliff tiles.
   *
   * @param {number} wx World X pixel.
   * @param {number} wy World Y pixel.
   * @returns {boolean}
   */
  const isNearCliff = (wx, wy) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = wx + dx, ny = wy + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const c = panelData[`${(nx / PANEL) | 0},${(ny / PANEL) | 0}`]?.grid[(ny % PANEL) * PANEL + (nx % PANEL)]
        if (c?.type === T.CLIFF) return true
      }
    }
    return false
  }

  /**
   * Stamps the centre tile of a road segment at world pixel (wx, wy).
   *
   * Can overwrite water cells (they become T.WATERROAD). Silently skips if the
   * position is out-of-bounds or adjacent to a cliff (guards against cliff corruption).
   *
   * @param {number} wx World X pixel.
   * @param {number} wy World Y pixel.
   */
  const stampCenter = (wx, wy) => {
    if (wx < 0 || wy < 0 || wx >= W || wy >= H) return
    const pk = `${(wx / PANEL) | 0},${(wy / PANEL) | 0}`
    const pd2 = panelData[pk]
    if (!pd2) return
    const cell = pd2.grid[(wy % PANEL) * PANEL + (wx % PANEL)]
    if (cell.type === T.CLIFF) return
    if (cell.type !== T.ROAD && cell.type !== T.WATERROAD)
      cell.type = (cell.type === T.OCEAN || cell.type === T.LAKE) ? T.WATERROAD : T.ROAD
  }

  /**
   * Stamps a perpendicular widening tile of a road segment at world pixel (wx, wy).
   *
   * Unlike `stampCenter`, does not overwrite water cells — roads only widen onto
   * land. Silently skips out-of-bounds positions and cliff neighbours.
   *
   * @param {number} wx World X pixel.
   * @param {number} wy World Y pixel.
   */
  const stampSide = (wx, wy) => {
    if (wx < 0 || wy < 0 || wx >= W || wy >= H) return
    const pk = `${(wx / PANEL) | 0},${(wy / PANEL) | 0}`
    const pd2 = panelData[pk]
    if (!pd2) return
    const cell = pd2.grid[(wy % PANEL) * PANEL + (wx % PANEL)]
    if (cell.type === T.CLIFF) return
    if (cell.type === T.OCEAN || cell.type === T.LAKE) return
    if (cell.type !== T.ROAD && cell.type !== T.WATERROAD) cell.type = T.ROAD
  }

  /**
   * Stamps road along a pixel path from `tileRoute`.
   *
   * IMPORTANT: Centerline only. No widening and no post cleanup.
   *
   * @param {Array<[number,number]>} path Ordered array of [wx, wy] world pixel coordinates.
   */
  const stampPath = (path) => {
    if (!path || path.length === 0) return
    for (let i = 0; i < path.length; i++) {
      const [wx, wy] = path[i]
      // Stamp a 3×3 block around each centerline tile.
      // Center uses `stampCenter` (can become WATERROAD); neighbors use `stampSide` (won't overwrite water).
      stampCenter(wx, wy)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          stampSide(wx + dx, wy + dy)
        }
      }
    }
  }

  /**
   * Selects a stable road entry/exit point on the shared edge between two adjacent panels.
   *
   * Uses a deterministic sub-PRNG seeded from `seed` and edge coordinates so the
   * same edge always resolves to the same point regardless of traversal order. Prefers
   * land tiles in the centre third of the edge; falls back to best-scoring candidate.
   * Scores account for terrain type, cliff presence, and distance to panel centre.
   *
   * @param {number} px Panel X coordinate.
   * @param {number} py Panel Y coordinate.
   * @param {number} dx Neighbour direction X (−1, 0, or 1).
   * @param {number} dy Neighbour direction Y (−1, 0, or 1).
   * @returns {[number, number]|null} World pixel [wx, wy] of the chosen edge point, or null.
   */
  const getStableEdgePoint = (px, py, dx, dy) => {
    const isVert = (dx !== 0)
    const wx0 = dx === 1 ? (px + 1) * PANEL : dx === -1 ? px * PANEL : px * PANEL
    const wy0 = dy === 1 ? (py + 1) * PANEL : dy === -1 ? py * PANEL : py * PANEL

    const edgeSeed = seed ^ (wx0 * 133.7 + wy0 * 777.7 + (isVert ? 123 : 456))
    const edgeRand = mulberry32(edgeSeed)

    const checkCost = (wx, wy) => {
      const cell = panelData[`${(wx / PANEL) | 0},${(wy / PANEL) | 0}`]?.grid[(wy % PANEL) * PANEL + (wx % PANEL)]
      if (!cell) return 9999999
      if (cell.type === T.CLIFF) return 1000000

      let minCliffDist = 5;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let dist = 1; dist <= 4; dist++) {
          const nx = wx + ax * dist, ny = wy + ay * dist
          const npk = `${(nx / PANEL) | 0},${(ny / PANEL) | 0}`
          const nlx = ((nx % PANEL) + PANEL) % PANEL
          const nly = ((ny % PANEL) + PANEL) % PANEL
          const nc = panelData[npk]?.grid[nly * PANEL + nlx]
          if (nc?.type === T.CLIFF) {
            if (dist < minCliffDist) minCliffDist = dist;
            break;
          }
        }
      }

      let cliffPenalty = 0;
      if (minCliffDist === 1) cliffPenalty = ASTAR_TILE_CLIFF_WAYPOINT_PENALTIES[0];
      else if (minCliffDist === 2) cliffPenalty = ASTAR_TILE_CLIFF_WAYPOINT_PENALTIES[1];
      else if (minCliffDist === 3) cliffPenalty = ASTAR_TILE_CLIFF_WAYPOINT_PENALTIES[2];
      else if (minCliffDist === 4) cliffPenalty = ASTAR_TILE_CLIFF_WAYPOINT_PENALTIES[3];

      // Avoid selecting edge waypoints on/near water unless unavoidable.
      if (cell.type === T.OCEAN || cell.type === T.LAKE) return 600 + cliffPenalty
      if (cell.type === T.FOREST) return 50 + cliffPenalty
      return 1 + cliffPenalty
    }

    const candidates = []
    for (let offset = 0; offset < PANEL; offset++) {
      const tx = isVert ? wx0 : px * PANEL + offset
      const ty = isVert ? py * PANEL + offset : wy0

      const c1x = isVert ? wx0 - 1 : tx
      const c1y = isVert ? ty : wy0 - 1
      const c2x = isVert ? wx0 : tx
      const c2y = isVert ? ty : wy0

      const cost = checkCost(c1x, c1y) + checkCost(c2x, c2y)
      candidates.push({ x: tx, y: ty, cost, offset, isMidThird: offset >= 11 && offset <= 20 })
    }

    const safeMid = candidates.filter(c => c.isMidThird && c.cost <= 2)
    if (safeMid.length > 0) return safeMid[(edgeRand() * safeMid.length) | 0]

    const safeFull = candidates.filter(c => c.cost <= 2)
    if (safeFull.length > 0) {
      safeFull.sort((a, b) => Math.abs(a.offset - 15.5) - Math.abs(b.offset - 15.5))
      const minDist = Math.abs(safeFull[0].offset - 15.5)
      const closest = safeFull.filter(c => Math.abs(c.offset - 15.5) <= minDist)
      return closest[(edgeRand() * closest.length) | 0]
    }

    let minCost = Infinity
    for (const c of candidates) if (c.cost < minCost) minCost = c.cost
    const best = candidates.filter(c => c.cost === minCost)
    best.sort((a, b) => Math.abs(a.offset - 15.5) - Math.abs(b.offset - 15.5))
    const minDist = Math.abs(best[0].offset - 15.5)
    const closest = best.filter(c => Math.abs(c.offset - 15.5) <= minDist)
    return closest[(edgeRand() * closest.length) | 0]
  }

  /**
   * Finds the cheapest road waypoint in the centre 50% of a panel's tile grid.
   *
   * Scans the inner 50% of the panel (tiles 25%–75% from each edge), optionally
   * intersected with `insetBounds` so the point stays a minimum distance from active
   * edge seams. Scores each candidate by terrain cost and cliff proximity.
   *
   * @param {number}    px        Panel X coordinate.
   * @param {number}    py        Panel Y coordinate.
   * @param {Int8Array} cliffDist Distance-to-cliff map from `buildCliffDistMap`.
   * @param {{minLx:number,maxLx:number,minLy:number,maxLy:number}|null} [insetBounds]
   * @returns {[number, number]|null} World pixel [wx, wy] of the best interior point, or null.
   */
  const getPanelInteriorPoint = (px, py, cliffDist, insetBounds, intent) => {
    const grid = panelData[`${px},${py}`]?.grid
    if (!grid) return null
    const { x0: xLo, x1: xHi, y0: yLo, y1: yHi } = interiorWaypointScanRect(insetBounds)
    const cx = (xLo + xHi) / 2, cy = (yLo + yHi) / 2
    const hasIntent = !!(intent && Number.isFinite(intent.ex) && Number.isFinite(intent.ey) && Number.isFinite(intent.vx) && Number.isFinite(intent.vy))
    const ivx = hasIntent ? intent.vx : 0
    const ivy = hasIntent ? intent.vy : 0
    const iex = hasIntent ? intent.ex : 0
    const iey = hasIntent ? intent.ey : 0
    let best = null, bestScore = Infinity
    for (let ly = yLo; ly <= yHi; ly++) {
      for (let lx = xLo; lx <= xHi; lx++) {
        const c = grid[ly * PANEL + lx]
        if (!c || c.type === T.CLIFF) continue

        let minCliffDist = 5;
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (let dist = 1; dist <= 4; dist++) {
            const nx = px * PANEL + lx + ax * dist, ny = py * PANEL + ly + ay * dist
            const npk = `${(nx / PANEL) | 0},${(ny / PANEL) | 0}`
            const nlx = ((nx % PANEL) + PANEL) % PANEL
            const nly = ((ny % PANEL) + PANEL) % PANEL
            const nc = panelData[npk]?.grid[nly * PANEL + nlx]
            if (nc?.type === T.CLIFF) {
              if (dist < minCliffDist) minCliffDist = dist;
              break;
            }
          }
        }

        let cliffPenalty = 0;
        if (minCliffDist === 1) cliffPenalty = 50000;
        else if (minCliffDist === 2) cliffPenalty = 10000;
        else if (minCliffDist === 3) cliffPenalty = 2000;
        else if (minCliffDist === 4) cliffPenalty = 500;

        const d = cliffDist[ly * PANEL + lx]
        const penalty = d <= 1 ? ASTAR_TILE_CLIFF_STAMP_PENALTIES[0] : d <= 2 ? ASTAR_TILE_CLIFF_STAMP_PENALTIES[1] : d <= 3 ? ASTAR_TILE_CLIFF_STAMP_PENALTIES[2] : d <= 4 ? ASTAR_TILE_CLIFF_STAMP_PENALTIES[3] : ASTAR_TILE_CLIFF_STAMP_PENALTIES[4]
        const terrainCost = c.type === T.OCEAN || c.type === T.LAKE ? 10
          : c.type === T.FOREST ? 5 : 1
        const distToCenter = Math.abs(lx - cx) + Math.abs(ly - cy)
        let intentPenalty = 0
        if (hasIntent) {
          const wx = px * PANEL + lx
          const wy = py * PANEL + ly
          const dx = wx - iex
          const dy = wy - iey
          const dot = dx * ivx + dy * ivy
          // Penalize points that require heading "backwards" from the incoming edge.
          // Keep this mild so terrain/cliff costs dominate.
          if (dot < 0) intentPenalty = (-dot) * 0.5
        }
        const score = terrainCost + penalty + cliffPenalty + distToCenter * 0.1 + intentPenalty
        if (score < bestScore) { bestScore = score; best = [px * PANEL + lx, py * PANEL + ly] }
      }
    }
    return best
  }

  /**
   * Picks a deterministic settlement waypoint within a panel.
   *
   * The waypoint is the centre (by Manhattan-to-panel-centre tie-break) of the
   * largest contiguous region of the panel's dominant elevation. This gives roads
   * a stable "goal" inside settlement panels so endpoints don't stop at borders.
   * When `insetBounds` is set, prefers cells at least `INTERIOR_MIN_FROM_ACTIVE_EDGE`
   * from active edge axes; falls back to the full component if none qualify.
   *
   * @param {number} px Panel X coordinate.
   * @param {number} py Panel Y coordinate.
   * @param {{minLx:number,maxLx:number,minLy:number,maxLy:number}|null} [insetBounds]
   * @returns {[number, number]|null} World pixel [wx, wy] of the settlement waypoint, or null.
   */
  const getSettlementWaypointInPanel = (px, py, insetBounds) => {
    const key = `${px},${py}`
    const grid = panelData[key]?.grid
    const stat = panelStats?.[key]
    if (!grid || !stat) return null

    const domElev = getDominantElev(stat)
    if (domElev < 0) return null

    const idx = (x, y) => y * PANEL + x
    const seen = new Uint8Array(PANEL * PANEL)

    const cx = (PANEL - 1) / 2
    const cy = (PANEL - 1) / 2

    let bestComponent = null
    let bestSize = 0

    for (let y = 0; y < PANEL; y++) {
      for (let x = 0; x < PANEL; x++) {
        const i = idx(x, y)
        if (seen[i]) continue
        const c = grid[i]
        if (!c || c.type === T.CLIFF || c.elevation !== domElev) { seen[i] = 1; continue }

        // Flood-fill this elevation component
        const qx = [x], qy = [y]
        seen[i] = 1
        let qi = 0
        let count = 0
        const cells = []
        while (qi < qx.length) {
          const px2 = qx[qi], py2 = qy[qi]; qi++
          count++
          cells.push([px2, py2])
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = px2 + dx, ny = py2 + dy
            if (nx < 0 || ny < 0 || nx >= PANEL || ny >= PANEL) continue
            const ni = idx(nx, ny)
            if (seen[ni]) continue
            const nc = grid[ni]
            if (!nc || nc.type === T.CLIFF || nc.elevation !== domElev) { seen[ni] = 1; continue }
            seen[ni] = 1
            qx.push(nx); qy.push(ny)
          }
        }

        if (count > bestSize) {
          bestSize = count
          bestComponent = cells
        }
      }
    }

    if (!bestComponent || bestComponent.length === 0) return null

    const { x0: rx0, x1: rx1, y0: ry0, y1: ry1 } = interiorWaypointScanRect(insetBounds)
    let candidates = bestComponent.filter(
      ([lx, ly]) => lx >= rx0 && lx <= rx1 && ly >= ry0 && ly <= ry1
    )
    if (candidates.length === 0) candidates = bestComponent

    let best = null
    let bestD = Infinity
    for (const [lx, ly] of candidates) {
      const d = Math.abs(lx - cx) + Math.abs(ly - cy)
      if (d < bestD) { bestD = d; best = [px * PANEL + lx, py * PANEL + ly] }
    }
    return best
  }

  /** World cell for waypoint checks (Step 12 only). */
  const worldWpCell = (wx, wy) => {
    if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
    return panelData[`${(wx / PANEL) | 0},${(wy / PANEL) | 0}`]?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
  }

  const isWaterOrCliffNeighbor = (t) =>
    t === T.CLIFF || t === T.OCEAN || t === T.LAKE || t === T.WATERROAD

  /** True iff none of the 8 neighbours of (wx,wy) is water or cliff. */
  const waypoint8NeighborsClear = (wx, wy) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const c = worldWpCell(wx + dx, wy + dy)
        if (!c || isWaterOrCliffNeighbor(c.type)) return false
      }
    }
    return true
  }

  const refineInteriorWaypoint = (px, py, wx, wy, insetBounds) => {
    if (waypoint8NeighborsClear(wx, wy)) return [wx, wy]
    const { x0, x1, y0, y1 } = interiorWaypointScanRect(insetBounds)
    const grid = panelData[`${px},${py}`]?.grid
    let best = null, bestD = Infinity
    for (let ly = y0; ly <= y1; ly++) {
      for (let lx = x0; lx <= x1; lx++) {
        const c = grid?.[ly * PANEL + lx]
        if (!c || c.type === T.CLIFF) continue
        const twx = px * PANEL + lx, twy = py * PANEL + ly
        if (!waypoint8NeighborsClear(twx, twy)) continue
        const d = Math.abs(twx - wx) + Math.abs(twy - wy)
        if (d < bestD) { bestD = d; best = [twx, twy] }
      }
    }
    return best || [wx, wy]
  }

  const refineSettlementWaypoint = (px, py, wx, wy, insetBounds) => {
    if (waypoint8NeighborsClear(wx, wy)) return [wx, wy]
    const key = `${px},${py}`
    const grid = panelData[key]?.grid
    const stat = panelStats?.[key]
    if (!grid || !stat) return [wx, wy]
    const domElev = getDominantElev(stat)
    if (domElev < 0) return [wx, wy]
    const { x0: sx0, x1: sx1, y0: sy0, y1: sy1 } = interiorWaypointScanRect(insetBounds)
    let xLo = Math.max(1, sx0), xHi = Math.min(PANEL - 2, sx1)
    let yLo = Math.max(1, sy0), yHi = Math.min(PANEL - 2, sy1)
    if (xLo > xHi || yLo > yHi) {
      xLo = 1; xHi = PANEL - 2
      yLo = 1; yHi = PANEL - 2
    }
    let best = null, bestD = Infinity
    for (let ly = yLo; ly <= yHi; ly++) {
      for (let lx = xLo; lx <= xHi; lx++) {
        const c = grid[ly * PANEL + lx]
        if (!c || c.type === T.CLIFF || c.elevation !== domElev) continue
        const twx = px * PANEL + lx, twy = py * PANEL + ly
        if (!waypoint8NeighborsClear(twx, twy)) continue
        const d = Math.abs(twx - wx) + Math.abs(twy - wy)
        if (d < bestD) { bestD = d; best = [twx, twy] }
      }
    }
    return best || [wx, wy]
  }

  const refineEdgeWaypoint = (px, py, ea) => {
    const { dx, dy, x: ox, y: oy } = ea
    const isVert = dx !== 0
    const wx0 = dx === 1 ? (px + 1) * PANEL : dx === -1 ? px * PANEL : px * PANEL
    const wy0 = dy === 1 ? (py + 1) * PANEL : dy === -1 ? py * PANEL : py * PANEL
    if (waypoint8NeighborsClear(ox, oy)) return [ox, oy]
    let best = null, bestD = Infinity
    for (let offset = 0; offset < PANEL; offset++) {
      const tx = isVert ? wx0 : px * PANEL + offset
      const ty = isVert ? py * PANEL + offset : wy0
      if (!waypoint8NeighborsClear(tx, ty)) continue
      const d = Math.abs(tx - ox) + Math.abs(ty - oy)
      if (d < bestD) { bestD = d; best = [tx, ty] }
    }
    return best || [ox, oy]
  }

  const roadPaths = []
  const roadWaypoints = []  // debug: [x, y] world-tile coords of each A* entry/exit point
  const roadWaypointKeys = new Set()
  const pushRoadWaypoint = (pt) => {
    if (!pt) return
    const k = `${pt[0]},${pt[1]}`
    if (roadWaypointKeys.has(k)) return
    roadWaypointKeys.add(k)
    roadWaypoints.push(pt)
  }
  const isVisitablePanel = k => { const p = panelData[k]; return p && (p.isRoute || p.settlement) }
  const routeAndStamp = (swx, swy, twx, twy, tileCost) => {
    const p = tileRoute(swx, swy, twx, twy, tileCost)
    stampPath(p)
    if (p) roadPaths.push(p)
    return p
  }
  const manhattan = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by)
  const normalizeVec = (vx, vy) => {
    const len = Math.hypot(vx, vy)
    if (!len) return { vx: 0, vy: 0 }
    return { vx: vx / len, vy: vy / len }
  }

  for (const key of Object.keys(panelData)) {
    if (!isVisitablePanel(key)) continue
    const [px2, py2] = key.split(',').map(Number)

    // Collect entry edge points from all visitable neighbors
    const activeEdges = []
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = `${px2 + dx},${py2 + dy}`
      if (!isVisitablePanel(nk)) continue
      const ep = getStableEdgePoint(px2, py2, dx, dy)
      if (!ep) continue
      const [rx, ry] = refineEdgeWaypoint(px2, py2, { dx, dy, x: ep.x, y: ep.y })
      activeEdges.push({ dx, dy, x: rx, y: ry })
    }
    // For non-settlement panels we only route through-panels (need >=2 edges).
    // Some panels can be endpoints, so with exactly 1 edge we still route the
    // edge into an interior waypoint (ensures connectivity for dead-ends).
    // - Settlements: always endpoints.
    // - Secret halo panels: after forest rounding, a panel can become effectively
    //   isolated unless we stamp a road into it.
    // - Secret halo entrance panels: forced endpoints for guaranteed access.
    const isSettlementPanel = !!panelData[key].settlement
    const isSecretHaloEntrancePanel = !!panelData[key].isSecretHaloEntrancePanel
    const isSecretHaloPanel = panelData[key].secretHaloGroupId !== undefined && panelData[key].secretHaloGroupId !== null
    const isWaterDominantPanel = !!panelData[key].isWaterDominant
    if (activeEdges.length < 2 && !((isSettlementPanel || isSecretHaloPanel || isSecretHaloEntrancePanel) && activeEdges.length === 1)) continue

    const passableCliffs = getPassableCliffTiles(px2, py2)
    const cliffDist = buildCliffDistMap(px2, py2)
    const tileCost = makeTileCost(px2, py2, passableCliffs, cliffDist)
    const edgeInsetBounds = activeEdgeInteriorInsetBounds(activeEdges)
    // Always record edge waypoints for debug.
    for (const e of activeEdges) pushRoadWaypoint([e.x, e.y])

    const panelCenterWx = px2 * PANEL + (PANEL >> 1)
    const panelCenterWy = py2 * PANEL + (PANEL >> 1)

    const routeEdgeToInterior = () => {
      if (isWaterDominantPanel) return
      const avgEdgeX = activeEdges.reduce((a, e) => a + e.x, 0) / activeEdges.length
      const avgEdgeY = activeEdges.reduce((a, e) => a + e.y, 0) / activeEdges.length
      const { vx, vy } = normalizeVec(panelCenterWx - avgEdgeX, panelCenterWy - avgEdgeY)
      const intent = { ex: avgEdgeX, ey: avgEdgeY, vx, vy }

      let interior = isSettlementPanel
        ? getSettlementWaypointInPanel(px2, py2, edgeInsetBounds)
        : getPanelInteriorPoint(px2, py2, cliffDist, edgeInsetBounds, intent)

      if (interior) {
        interior = isSettlementPanel
          ? refineSettlementWaypoint(px2, py2, interior[0], interior[1], edgeInsetBounds)
          : refineInteriorWaypoint(px2, py2, interior[0], interior[1], edgeInsetBounds)
      }
      if (!interior) return
      pushRoadWaypoint(interior)
      const [mx, my] = interior
      for (const ea of activeEdges) routeAndStamp(ea.x, ea.y, mx, my, tileCost)
    }

    // Endpoint panels (settlements and special halo endpoints) want a stable interior goal.
    if ((isSettlementPanel || isSecretHaloPanel || isSecretHaloEntrancePanel) && activeEdges.length >= 1) {
      routeEdgeToInterior()
      continue
    }

    // Simple corridor: route edgeA -> edgeB directly.
    if (activeEdges.length === 2) {
      const [a, b] = activeEdges
      routeAndStamp(a.x, a.y, b.x, b.y, tileCost)
      continue
    }

    // Junctions: build a shared spine between the most separated edges, then connect others to the spine.
    if (activeEdges.length >= 3) {
      const SPINE_SAMPLE_STRIDE = 6
      const sampleSpine = (path) => {
        const pts = []
        for (let i = 0; i < path.length; i += SPINE_SAMPLE_STRIDE) pts.push(path[i])
        if (pts.length === 0 || pts[0] !== path[0]) pts.unshift(path[0])
        const last = path[path.length - 1]
        const lastC = pts[pts.length - 1]
        if (!lastC || lastC[0] !== last[0] || lastC[1] !== last[1]) pts.push(last)
        return pts
      }

      // Pick the spine endpoints by minimizing total junction cost, not just separation.
      // For each edge-pair, build a candidate spine and score it by:
      // - spine length
      // - plus each remaining edge's nearest sampled distance-to-spine
      let bestPair = null
      let bestScore = Infinity
      let bestSpine = null
      let bestCandidates = null
      for (let i = 0; i < activeEdges.length; i++) {
        for (let j = i + 1; j < activeEdges.length; j++) {
          const ea = activeEdges[i], eb = activeEdges[j]
          const p = tileRoute(ea.x, ea.y, eb.x, eb.y, tileCost)
          if (!p || p.length === 0) continue
          const candidates = sampleSpine(p)
          let score = p.length
          for (let k = 0; k < activeEdges.length; k++) {
            if (k === i || k === j) continue
            const e = activeEdges[k]
            let bestD = Infinity
            for (let c = 0; c < candidates.length; c++) {
              const [tx, ty] = candidates[c]
              const d = manhattan(e.x, e.y, tx, ty)
              if (d < bestD) bestD = d
            }
            score += bestD
          }
          if (score < bestScore) {
            bestScore = score
            bestPair = [i, j]
            bestSpine = p
            bestCandidates = candidates
          }
        }
      }
      if (!bestPair || !bestSpine || bestSpine.length === 0) continue

      const iA = bestPair[0], iB = bestPair[1]
      const a = activeEdges[iA]
      const b = activeEdges[iB]

      pushRoadWaypoint([a.x, a.y])
      pushRoadWaypoint([b.x, b.y])
      // Stamp the chosen spine.
      stampPath(bestSpine)
      roadPaths.push(bestSpine)
      const spineCandidates = bestCandidates

      for (let i = 0; i < activeEdges.length; i++) {
        if (i === iA || i === iB) continue
        const e = activeEdges[i]

        // Choose the best join point by actually routing a few candidates and
        // picking the shortest connector path. This avoids “attach at a weird spot”
        // artifacts that can look like double-backs.
        const ordered = spineCandidates
          .map(p => ({ p, d: manhattan(e.x, e.y, p[0], p[1]) }))
          .sort((u, v) => u.d - v.d)

        let bestConn = null
        let bestJoin = null
        let bestLen = Infinity
        const tryCount = Math.min(12, ordered.length)
        for (let t = 0; t < tryCount; t++) {
          const [tx, ty] = ordered[t].p
          const conn = tileRoute(e.x, e.y, tx, ty, tileCost)
          if (!conn || conn.length === 0) continue
          const len = conn.length
          if (len < bestLen) { bestLen = len; bestConn = conn; bestJoin = [tx, ty] }
        }
        let joined = false
        if (bestConn && bestJoin) {
          stampPath(bestConn)
          roadPaths.push(bestConn)
          pushRoadWaypoint(bestJoin)
          joined = true
        }
        if (!joined) {
          // Fallback: route to a direction-aware interior to ensure connectivity.
          if (!isWaterDominantPanel) {
            const { vx, vy } = normalizeVec(panelCenterWx - e.x, panelCenterWy - e.y)
            const intent = { ex: e.x, ey: e.y, vx, vy }
            let interior = getPanelInteriorPoint(px2, py2, cliffDist, edgeInsetBounds, intent)
            if (interior) interior = refineInteriorWaypoint(px2, py2, interior[0], interior[1], edgeInsetBounds)
            if (interior) {
              pushRoadWaypoint(interior)
              routeAndStamp(e.x, e.y, interior[0], interior[1], tileCost)
            }
          }
        }
      }
    }
  }

  // --- Road post-processing removed ---
  // (Deliberately none. Roads are only stamped along the A* centerline.)

  // --- Step 13: Grass Blob Placement ---
  // Runs after cliff detection so T.CLIFF cells are already set and naturally excluded.
  // Replaces T.LAND and T.ROAD — grass can overgrow paths, breaking them up organically.
  // FOREST, WATERROAD, and CLIFF are excluded.
  ; (() => {
    const grassNoise2D = createNoise2D(rand)
    const GRASS_THRESHOLD = GRASS_BLOB_THRESHOLD
    for (const key of Object.keys(panelData)) {
      if (!isVisitable(key)) continue
      if (panelData[key].settlement) continue
      const [px3, py3] = key.split(',').map(Number)
      const pd3 = panelData[key]
      for (let cy = 0; cy < PANEL; cy++) {
        for (let cx = 0; cx < PANEL; cx++) {
          const cell = pd3.grid[cy * PANEL + cx]
          if (cell.type !== T.LAND) continue
          const wx = px3 * PANEL + cx, wy = py3 * PANEL + cy
          const n = (grassNoise2D(wx / (W * 0.02), wy / (W * 0.02)) + 1) / 2
          if (n > GRASS_THRESHOLD) {
            cell.preGrassType = cell.type  // remember original for potential revert
            cell.type = T.GRASS
          }
        }
      }
    }
  })()

  // --- Step 14: Grass Blob Size Enforcement ---
  // BFS over all GRASS cells. Regions smaller than GRASS_BLOB_MIN_SIZE are reverted to LAND.
  // Regions larger than GRASS_BLOB_MAX_SIZE are trimmed from the outside in (furthest cells reverted first).
  ; (() => {
      const getCell = (wx, wy) => {
        if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
        return panelData[`${(wx / PANEL) | 0},${(wy / PANEL) | 0}`]?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
      }
      const visited = new Uint8Array(W * H)
      for (let sy = 0; sy < H; sy++) {
        for (let sx = 0; sx < W; sx++) {
          if (visited[sy * W + sx]) continue
          const cell = getCell(sx, sy)
          if (!cell || cell.type !== T.GRASS) { visited[sy * W + sx] = 1; continue }
          // BFS to collect contiguous GRASS region, tracking a centroid for distance sort
          const region = []
          const queue = [[sx, sy]]
          visited[sy * W + sx] = 1
          let sumX = 0, sumY = 0
          while (queue.length > 0) {
            const [cx, cy] = queue.pop()
            region.push([cx, cy])
            sumX += cx; sumY += cy
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
              const nx = cx + dx, ny = cy + dy
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
              if (visited[ny * W + nx]) continue
              visited[ny * W + nx] = 1
              const nc = getCell(nx, ny)
              if (nc && nc.type === T.GRASS) queue.push([nx, ny])
            }
          }
          const revert = (rx, ry) => {
            const c = getCell(rx, ry)
            if (c) c.type = c.preGrassType || T.LAND
          }
          if (region.length < GRASS_BLOB_MIN_SIZE) {
            // Too small — revert all to original type
            for (const [rx, ry] of region) revert(rx, ry)
          } else if (region.length > GRASS_BLOB_MAX_SIZE) {
            // Too large — cut in half, revert the outer half (furthest from centroid)
            const cxAvg = sumX / region.length, cyAvg = sumY / region.length
            region.sort((a, b) =>
              (Math.sqrt((a[0] - cxAvg) ** 2 + (a[1] - cyAvg) ** 2)) -
              (Math.sqrt((b[0] - cxAvg) ** 2 + (b[1] - cyAvg) ** 2))
            )
            const half = Math.ceil(region.length / 2)
            for (let k = half; k < region.length; k++) revert(region[k][0], region[k][1])
          }
        }
      }
    })()

    // --- Step 15: Thin-Strip Cleanup ---
    // A cell is removed if it has fewer than 2 same-type cardinal neighbours.
    // This enforces minimum blob thickness — isolated cells and strip endpoints collapse.
    // 3 passes so strips created by earlier passes also resolve. Excludes CLIFF, OCEAN, LAKE, WATERROAD.
    ; (() => {
      const getCell = (wx, wy) => {
        if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
        return panelData[`${(wx / PANEL) | 0},${(wy / PANEL) | 0}`]?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
      }
      const SKIP = new Set([T.CLIFF, T.OCEAN, T.LAKE, T.WATERROAD, T.ROAD])

      for (let pass = 0; pass < 3; pass++)
        for (let wy = 0; wy < H; wy++) {
          for (let wx = 0; wx < W; wx++) {
            const cell = getCell(wx, wy)
            if (!cell || SKIP.has(cell.type)) continue

            const t = cell.type
            const neighbours = [
              getCell(wx, wy - 1)?.type,
              getCell(wx, wy + 1)?.type,
              getCell(wx + 1, wy)?.type,
              getCell(wx - 1, wy)?.type,
            ]
            const sameCount = neighbours.filter(n => n === t).length
            const hasV = neighbours[0] === t || neighbours[1] === t  // same-type N or S
            const hasH = neighbours[2] === t || neighbours[3] === t  // same-type E or W
            if (sameCount >= 2 && hasV && hasH) continue

            // Replace with most common cardinal neighbour type (excluding skipped types)
            const tally = {}
            for (const nt of neighbours) {
              if (nt && !SKIP.has(nt)) tally[nt] = (tally[nt] || 0) + 1
            }
            const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]
            if (best) cell.type = best[0]
          }
        }
    })()

    // --- Step 16: Orphan LAND Cleanup ---
    // Convert tiny isolated LAND specks to FOREST to avoid stray single tiles.
    ; (() => {
      const getCell = (wx, wy) => {
        if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
        return panelData[`${(wx / PANEL) | 0},${(wy / PANEL) | 0}`]?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
      }
      const inSettlementPanel = (wx, wy) => {
        const pk = `${(wx / PANEL) | 0},${(wy / PANEL) | 0}`
        return !!panelData[pk]?.settlement
      }

      for (let wy = 0; wy < H; wy++) {
        for (let wx = 0; wx < W; wx++) {
          const c = getCell(wx, wy)
          if (!c || c.type !== T.LAND) continue
          if (inSettlementPanel(wx, wy)) continue

          const n = getCell(wx, wy - 1)?.type
          const s = getCell(wx, wy + 1)?.type
          const e = getCell(wx + 1, wy)?.type
          const w = getCell(wx - 1, wy)?.type

          // Treat these as "land-like" neighbors for connectivity.
          const isLandish = (t) => t === T.LAND || t === T.FOREST || t === T.GRASS || t === T.ROAD
          const landishCount = [n, s, e, w].filter(isLandish).length
          if (landishCount === 0) c.type = T.FOREST
        }
      }
    })()

  /**
   * Pipeline Step 17 — Computes directional tile indices for all non-cliff cells.
   *
   * Builds four world-scale bitmaps (one per terrain layer), then calls the shared
   * `dir12()` function on each cell to determine which tileset strip column to use.
   * Cliff tiles skip this step — their tileIndex was set in Step 11.
   *
   * Layer definitions (bitmap membership rules):
   *   LAND bitmap  : LAND, FOREST, ROAD, WATERROAD, CLIFF, GRASS (all solid)
   *   ROAD bitmap  : ROAD, WATERROAD
   *   GRASS bitmap : GRASS only (so grass patch edges tile against themselves)
   *   WATER bitmap : OCEAN, LAKE
   */
  const calculateTileIndices = () => {
    const LAND_BMP = new Uint8Array(W * H)
    const ROAD_BMP = new Uint8Array(W * H)
    const WATER_BMP = new Uint8Array(W * H)
    const GRASS_BMP = new Uint8Array(W * H)

    // Build bitmaps in a single pass over all cells
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const pd2 = panelData[`${px},${py}`]
        for (let cy = 0; cy < PANEL; cy++) {
          for (let cx = 0; cx < PANEL; cx++) {
            const t = pd2.grid[cy * PANEL + cx].type
            const i = (py * PANEL + cy) * W + (px * PANEL + cx)
            if (t === T.LAND || t === T.FOREST || t === T.ROAD || t === T.WATERROAD || t === T.CLIFF || t === T.GRASS) LAND_BMP[i] = 1
            if (t === T.ROAD || t === T.WATERROAD) ROAD_BMP[i] = 1
            if (t === T.OCEAN || t === T.LAKE) WATER_BMP[i] = 1
            if (t === T.GRASS) GRASS_BMP[i] = 1
          }
        }
      }
    }

    // Write tileIndex back onto each cell using the appropriate bitmap
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const pd2 = panelData[`${px},${py}`]
        for (let cy = 0; cy < PANEL; cy++) {
          for (let cx = 0; cx < PANEL; cx++) {
            const cell = pd2.grid[cy * PANEL + cx]
            const wx = px * PANEL + cx, wy = py * PANEL + cy
            const t = cell.type
            if (t === T.ROAD || t === T.WATERROAD) {
              cell.tileIndex = dir12(ROAD_BMP, wx, wy, W)
            } else if (t === T.LAND || t === T.FOREST) {
              // FOREST shares LAND borders so edge tiles blend correctly.
              // The tileIndex is used when FOREST cells render the GROUND asset as their base layer.
              cell.tileIndex = dir12(LAND_BMP, wx, wy, W)
            } else if (t === T.GRASS) {
              cell.tileIndex = dir12(GRASS_BMP, wx, wy, W)
            } else if (t === T.OCEAN || t === T.LAKE) {
              cell.tileIndex = dir12(WATER_BMP, wx, wy, W)
            } else if (t !== T.CLIFF) {
              // T.CLIFF: tileIndex already set in Step 11 — do not overwrite
              cell.tileIndex = 15
            }
          }
        }
      }
    }
  }
  calculateTileIndices()

    // --- Step 18: Organic Terrain Blobs ---
    // Scans visitable panels for large contiguous T.LAND regions (≥30 cells).
    // For each region, places 1–4 organic blobs (Simplex noise + radial falloff).
    // Each blob interior → T.FOREST or T.GRASS; border cells → T.CLIFF with inline 12-tile tileIndex.
    // Protected cells (T.ROAD, T.CLIFF, T.WATERROAD, T.GRASS) are never overwritten.
    // calculateTileIndices() is called again after all blobs are placed.
    ; (() => {
      const getCell = (wx, wy) => {
        if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
        const pKey = `${(wx / PANEL) | 0},${(wy / PANEL) | 0}`
        return panelData[pKey]?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
      }
      const setCell = (wx, wy, type) => {
        if (wx < 0 || wy < 0 || wx >= W || wy >= H) return
        const pKey = `${(wx / PANEL) | 0},${(wy / PANEL) | 0}`
        if (panelData[pKey]) panelData[pKey].grid[(wy % PANEL) * PANEL + (wx % PANEL)].type = type
      }

      // Classify a cliff border cell using the shared cliffTileIdx helper.
      // Neighbours outside blobPixels are treated as "lower" (the cliff drops toward them).
      const cliffTileIndex = (wx, wy, blobPixels) => {
        const key = (x, y) => `${x},${y}`
        const N  = !blobPixels.has(key(wx,     wy - 1))
        const S  = !blobPixels.has(key(wx,     wy + 1))
        const E  = !blobPixels.has(key(wx + 1, wy    ))
        const Ww = !blobPixels.has(key(wx - 1, wy    ))
        const NE = !blobPixels.has(key(wx + 1, wy - 1))
        const SE = !blobPixels.has(key(wx + 1, wy + 1))
        const SW = !blobPixels.has(key(wx - 1, wy + 1))
        const NW = !blobPixels.has(key(wx - 1, wy - 1))
        return cliffTileIdx(N, S, E, Ww, NE, SE, SW, NW)
      }

      const PROTECTED = new Set([T.ROAD, T.CLIFF, T.WATERROAD, T.GRASS])
      const visited = new Uint8Array(W * H)
      const blobNoise = createNoise2D(rand)

      // BFS over all world cells to find contiguous T.LAND regions
      for (let sy = 0; sy < H; sy++) {
        for (let sx = 0; sx < W; sx++) {
          if (visited[sy * W + sx]) continue
          const cell = getCell(sx, sy)
          if (!cell || cell.type !== T.LAND) { visited[sy * W + sx] = 1; continue }
          // Check panel is visitable and not a settlement
          const pKey = `${(sx / PANEL) | 0},${(sy / PANEL) | 0}`
          if (!isVisitable(pKey) || panelData[pKey]?.settlement) { visited[sy * W + sx] = 1; continue }

          // BFS to collect region — stays within visitable, non-settlement panels
          const region = []
          const queue = [[sx, sy]]
          visited[sy * W + sx] = 1
          while (queue.length > 0) {
            const [cx, cy] = queue.pop()
            region.push([cx, cy])
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
              const nx = cx + dx, ny = cy + dy
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
              if (visited[ny * W + nx]) continue
              const nc = getCell(nx, ny)
              if (!nc || nc.type !== T.LAND) { visited[ny * W + nx] = 1; continue }
              const npKey = `${(nx / PANEL) | 0},${(ny / PANEL) | 0}`
              if (!isVisitable(npKey) || panelData[npKey]?.settlement) { visited[ny * W + nx] = 1; continue }
              visited[ny * W + nx] = 1
              queue.push([nx, ny])
            }
          }

          if (region.length < ORGANIC_BLOB_MIN_REGION) continue

          const blobCount = Math.min(4, Math.floor(region.length / 120) + 1)
          // Build a fast lookup for region membership so blobs stay in-region
          const regionSet = new Set(region.map(([rx, ry]) => `${rx},${ry}`))

          for (let b = 0; b < blobCount; b++) {
            // Pick a random cell from region as blob center
            const [cx, cy] = region[(rand() * region.length) | 0]
            const radius = 4 + (rand() * 3) | 0   // 4–6 tiles
            const blobType = rand() < 0.5 ? T.FOREST : T.GRASS
            // Low noise scale = broad, smooth variation (cycles every ~8 tiles)
            const noiseScale = 0.12 + rand() * 0.06

            // Phase 1: Collect blob shape — noise + hard radial cutoff.
            // Only cells inside the region and currently T.LAND are eligible.
            // Using a hard radius with mild noise warping keeps blobs solid with organic edges.
            const blobPixels = new Set()
            for (let dy = -(radius + 2); dy <= radius + 2; dy++) {
              for (let dx = -(radius + 2); dx <= radius + 2; dx++) {
                const wx = cx + dx, wy = cy + dy
                if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue
                const dist = Math.sqrt(dx * dx + dy * dy)
                if (dist > radius + 1.5) continue
                if (!regionSet.has(`${wx},${wy}`)) continue
                const target = getCell(wx, wy)
                if (!target || target.type !== T.LAND) continue
                // Noise warps the radius slightly for organic shape
                const n = (blobNoise(wx * noiseScale, wy * noiseScale) + 1) / 2  // 0–1
                const warpedRadius = radius * (0.75 + n * 0.5)  // radius × 0.75–1.25
                if (dist <= warpedRadius) {
                  blobPixels.add(`${wx},${wy}`)
                }
              }
            }

            // Require minimum blob size to avoid cliff-only slivers
            if (blobPixels.size < 9) continue

            // Guard: blobs must not touch — check a 1-cell buffer around the entire blob.
            // If any buffered cell is already non-LAND (painted by a prior blob), skip.
            let collides = false
            for (const coordKey of blobPixels) {
              if (collides) break
              const [bx, by] = coordKey.split(',').map(Number)
              for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = bx + dx, ny = by + dy
                if (blobPixels.has(`${nx},${ny}`)) continue  // inside blob — fine
                const nc = getCell(nx, ny)
                if (nc && nc.type !== T.LAND) { collides = true; break }
              }
            }
            if (collides) continue

            // Phase 2: Classify each blob cell.
            // Border = at least one cardinal neighbour is outside blobPixels.
            // Border → T.CLIFF; interior → blobType.
            // Only write cells still T.LAND (no double-write from overlapping blobs).
            for (const coordKey of blobPixels) {
              const [bx, by] = coordKey.split(',').map(Number)
              const target = getCell(bx, by)
              if (!target || PROTECTED.has(target.type)) continue
              if (target.type !== T.LAND) continue

              const isBorder = !blobPixels.has(`${bx},${by - 1}`) ||
                !blobPixels.has(`${bx},${by + 1}`) ||
                !blobPixels.has(`${bx + 1},${by}`) ||
                !blobPixels.has(`${bx - 1},${by}`)

              if (isBorder) {
                const pKey2 = `${(bx / PANEL) | 0},${(by / PANEL) | 0}`
                const cell2 = panelData[pKey2]?.grid[(by % PANEL) * PANEL + (bx % PANEL)]
                if (cell2) {
                  cell2.type = T.CLIFF
                  cell2.tileIndex = cliffTileIndex(bx, by, blobPixels)
                }
              } else {
                setCell(bx, by, blobType)
              }
            }
          }
        }
      }

      // Recompute tileIndices for all non-CLIFF cells after blob placement
      calculateTileIndices()
    })()

  // --- Step 19: Forest Halo ---
  // Every non-visitable panel that directly borders a visitable panel (isRoute or
  // settlement) is marked as a render-only halo and flooded with T.FOREST.
  // This prevents hard darkness cutoffs at the edges of the playable area in the
  // game engine. Halo panels are flagged with `isForestHalo=true` so downstream
  // tools can treat them as render-only (no gameplay logic, no settlement placement).
  ; (() => {
    const haloKeys = new Set()
    /** @type {string[][]} */
    const secretHaloGroups = []

    const panelHasLake = (pd) => {
      if (!pd?.grid) return false
      for (const cell of pd.grid) if (cell?.type === T.LAKE) return true
      return false
    }

    for (const key of Object.keys(panelData)) {
      const pd2 = panelData[key]
      if (!pd2.isRoute && !pd2.settlement) continue
      const [px2, py2] = key.split(',').map(Number)

      for (const [dx, dy] of [
        [-1, 0], [1, 0], [0, -1], [0, 1], // cardinal
        [-1, -1], [1, -1], [-1, 1], [1, 1], // diagonals
      ]) {
        const nkey = `${px2 + dx},${py2 + dy}`
        const npd = panelData[nkey]
        if (!npd || npd.isRoute || npd.settlement) continue
        haloKeys.add(nkey)
      }
    }

    // Lake continuity: ensure we don't "cut" a lake in half by only haloing one side.
    // If the halo touches a lake-containing non-visitable panel, include the entire
    // connected component (8-neighbor) of lake-containing non-visitable panels.
    ; (() => {
      const q = []
      const seen = new Set()
      for (const k of haloKeys) {
        const pd2 = panelData[k]
        if (pd2 && panelHasLake(pd2)) { q.push(k); seen.add(k) }
      }
      while (q.length > 0) {
        const cur = q.pop()
        const [x, y] = cur.split(',').map(Number)
        for (const [dx, dy] of [
          [-1, 0], [1, 0], [0, -1], [0, 1],
          [-1, -1], [1, -1], [-1, 1], [1, 1],
        ]) {
          const nk = `${x + dx},${y + dy}`
          if (seen.has(nk)) continue
          const npd = panelData[nk]
          if (!npd || npd.isRoute || npd.settlement) continue
          if (!panelHasLake(npd)) continue
          haloKeys.add(nk)
          seen.add(nk)
          q.push(nk)
        }
      }
    })()

    // Flood-fill: pull in any non-visitable panel whose all 8 neighbours are already
    // halo or visitable. Repeat until stable so deeply nested pockets are caught.
    let changed = true
    while (changed) {
      changed = false
      for (const key of Object.keys(panelData)) {
        if (haloKeys.has(key)) continue
        const pd2 = panelData[key]
        if (pd2.isRoute || pd2.settlement) continue
        const [px2, py2] = key.split(',').map(Number)
        let enclosed = true
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
          const nk = `${px2+dx},${py2+dy}`
          const npd2 = panelData[nk]
          if (!npd2 || (!npd2.isRoute && !npd2.settlement && !haloKeys.has(nk))) { enclosed = false; break }
        }
        if (enclosed) { haloKeys.add(key); changed = true }
      }
    }

    for (const key of haloKeys) {
      const npd = panelData[key]
      npd.isRoute = true
      npd.isForestHalo = true
      // Default halo treatment: flood-fill to forest (secret halo groups will be restored below).
      for (const cell of npd.grid) {
        if (cell.type === T.OCEAN || cell.type === T.LAKE || cell.type === T.CLIFF) continue
        cell.type = T.FOREST
        cell.elevation = cell.elevation || 1
      }
    }

    // Mark "enclosed" halo panels: all 8 neighbors exist and are either originally
    // visitable or also halo. Useful for debugging halo growth.
    for (const key of haloKeys) {
      const [px2, py2] = key.split(',').map(Number)
      let ok = true
      for (const [dx, dy] of [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [1, -1], [-1, 1], [1, 1],
      ]) {
        const nk = `${px2 + dx},${py2 + dy}`
        const npd2 = panelData[nk]
        if (!npd2) { ok = false; break }
        if (!(npd2.isRoute || npd2.settlement || npd2.isForestHalo)) { ok = false; break }
      }
      panelData[key].isForestHaloEnclosed = ok
    }

    if (secretHalo) {
    // Group enclosed halo panels into secret-halo clusters.
    // IMPORTANT: use 4-neighbor connectivity so clusters are edge-connected.
    // The internal halo stamping/link logic only connects panels across shared edges;
    // 8-neighbor (diagonal) grouping can create clusters whose waypoints cannot all
    // be connected without extra cross-panel routing.
    ; (() => {
      const enclosedKeys = [...haloKeys].filter(k => panelData[k]?.isForestHaloEnclosed)
      const seen = new Set()

      for (const start of enclosedKeys) {
        if (seen.has(start)) continue
        const group = []
        const q = [start]
        seen.add(start)

        while (q.length > 0) {
          const cur = q.pop()
          group.push(cur)
          const [x, y] = cur.split(',').map(Number)
          for (const [dx, dy] of [
            [-1, 0], [1, 0], [0, -1], [0, 1],
          ]) {
            const nk = `${x + dx},${y + dy}`
            if (seen.has(nk)) continue
            const npd = panelData[nk]
            if (!npd?.isForestHaloEnclosed) continue
            if (!npd?.isForestHalo) continue
            seen.add(nk)
            q.push(nk)
          }
        }

        const gid = secretHaloGroups.length
        for (const k of group) {
          panelData[k].secretHaloGroupId = gid
          panelData[k].secretHaloGroupSize = group.length
        }
        secretHaloGroups.push(group)
      }
    })()

    // Also include "pockets": non-visitable panels that become fully enclosed by the halo ring.
    // These are interior voids that the one-step halo growth doesn't mark as halo, but they
    // make for good "secret areas" when surrounded by halo panels.
    ; (() => {
      const isBlocked = (k) => {
        const pd = panelData[k]
        return !!pd && (pd.isRoute || pd.settlement || pd.isForestHalo)
      }

      const seen = new Set()
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const start = `${px},${py}`
          if (seen.has(start)) continue
          if (isBlocked(start)) continue

          const comp = []
          const q = [start]
          seen.add(start)
          let touchesBoundary = false
          while (q.length > 0) {
            const cur = q.pop()
            comp.push(cur)
            const [x, y] = cur.split(',').map(Number)
            if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBoundary = true
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx, ny = y + dy
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
              const nk = `${nx},${ny}`
              if (seen.has(nk)) continue
              if (isBlocked(nk)) continue
              seen.add(nk)
              q.push(nk)
            }
          }

          if (touchesBoundary) continue

          const compSet = new Set(comp)
          let boundaryOk = true
          let hasHaloBoundary = false
          for (const k of comp) {
            const [x, y] = k.split(',').map(Number)
            for (const [dx, dy] of [
              [-1, 0], [1, 0], [0, -1], [0, 1],
              [-1, -1], [1, -1], [-1, 1], [1, 1],
            ]) {
              const nx = x + dx, ny = y + dy
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
              const nk = `${nx},${ny}`
              if (compSet.has(nk)) continue
              const npd = panelData[nk]
              if (!npd || (!npd.isForestHalo && !npd.isRoute && !npd.settlement)) { boundaryOk = false; break }
              if (npd.isForestHalo) hasHaloBoundary = true
            }
            if (!boundaryOk) break
          }
          if (!boundaryOk || !hasHaloBoundary) continue

          const gid = secretHaloGroups.length
          for (const k of comp) {
            const pd = panelData[k]
            if (!pd) continue
            pd.isRoute = true
            pd.isSecretHaloPocket = true
            pd.secretHaloGroupId = gid
            pd.secretHaloGroupSize = comp.length
          }
          secretHaloGroups.push(comp)
        }
      }
    })()

    // Restore secret halo groups as LAND interior with a 4-tile forest border,
    // similar to settlement border treatment.
    ; (() => {
      const BORDER_MIN = 4
      const BORDER_MAX = 16
      const secretBorderNoise2D = createNoise2D(rand)
      const secretBlobNoise2D = createNoise2D(rand)
      const secretGrassNoise2D = createNoise2D(rand)
      for (const group of secretHaloGroups) {
        const groupSet = new Set(group)
        for (const key of group) {
          const [px2, py2] = key.split(',').map(Number)
          const pd2 = panelData[key]
          if (!pd2) continue

          // First restore the whole panel to plain LAND (preserve water/cliff).
          for (const cell of pd2.grid) {
            if (cell.type === T.OCEAN || cell.type === T.LAKE || cell.type === T.CLIFF) continue
            cell.type = T.LAND
            cell.elevation = cell.elevation || 1
          }

          // Which panel edges are on the group's exterior?
          const outN = !groupSet.has(`${px2},${py2 - 1}`)
          const outS = !groupSet.has(`${px2},${py2 + 1}`)
          const outW = !groupSet.has(`${px2 - 1},${py2}`)
          const outE = !groupSet.has(`${px2 + 1},${py2}`)

          if (!outN && !outS && !outW && !outE) continue

          // Stamp forest border inward from any exterior edge.
          for (let cy = 0; cy < PANEL; cy++) {
            for (let cx = 0; cx < PANEL; cx++) {
              const cell = pd2.grid[cy * PANEL + cx]
              if (!cell || cell.type === T.OCEAN || cell.type === T.LAKE || cell.type === T.CLIFF) continue

              // Use the same style as the visitable forest border stamp: per-cell
              // noise picks a depth, then we check proximity to any exterior edge.
              const wx = px2 * PANEL + cx
              const wy = py2 * PANEL + cy
              // Border depth: always at least BORDER_MIN, with noise bulges up to BORDER_MAX.
              // The first BORDER_MIN tiles from any exterior edge are always forest (no gaps).
              const n = (secretBorderNoise2D(wx / (W * 0.14), wy / (W * 0.14)) + 1) / 2
              const nn = n * n // bias toward shallower areas with occasional deep bulges
              const depth = BORDER_MIN + Math.floor(nn * (BORDER_MAX - BORDER_MIN))

              const distN = cy
              const distS = PANEL - 1 - cy
              const distW = cx
              const distE = PANEL - 1 - cx

              const inBaseBorder =
                (outN && distN < BORDER_MIN) ||
                (outS && distS < BORDER_MIN) ||
                (outW && distW < BORDER_MIN) ||
                (outE && distE < BORDER_MIN)

              const inNoisyBorder =
                (outN && distN < depth) ||
                (outS && distS < depth) ||
                (outW && distW < depth) ||
                (outE && distE < depth)

              if (inBaseBorder || inNoisyBorder) cell.type = T.FOREST
            }
          }

          // Forest detail blobs inside the secret halo, same style as Step 9.
          // (We intentionally do not run the reachability cleanup here; secret halos
          // are meant to stay "secret areas" rather than being auto-forested.)
          for (let cy = 0; cy < PANEL; cy++) {
            for (let cx = 0; cx < PANEL; cx++) {
              const cell = pd2.grid[cy * PANEL + cx]
              if (!cell || cell.type !== T.LAND) continue
              const wx = px2 * PANEL + cx
              const wy = py2 * PANEL + cy
              const n = (secretBlobNoise2D(wx / (W * 0.025), wy / (W * 0.025)) + 1) / 2
              if (n > FOREST_BLOB_THRESHOLD) cell.type = T.FOREST
            }
          }

          // Grass blobs inside the secret halo, same basic threshold style as Step 13 (grass blobs).
          // We keep it simple here: LAND-only promotion based on noise; later passes
          // (tile indices, cleanup) still run globally after Step 19.
          for (let cy = 0; cy < PANEL; cy++) {
            for (let cx = 0; cx < PANEL; cx++) {
              const cell = pd2.grid[cy * PANEL + cx]
              if (!cell || cell.type !== T.LAND) continue
              const wx = px2 * PANEL + cx
              const wy = py2 * PANEL + cy
              const n = (secretGrassNoise2D(wx / (W * 0.03), wy / (W * 0.03)) + 1) / 2
              if (n > GRASS_BLOB_THRESHOLD) cell.type = T.GRASS
            }
          }
        }
      }
    })()

    } // secretHalo: enclosed groups, pockets, LAND/forest/grass restore

    // Round/smooth forest shapes before carving secret-halo entrances.
    // Preference: overwhelmingly add forest (fill concavities), but keep roads readable
    // and avoid changing core features (roads, water, cliffs).
    ; (() => {
      const get = (x, y) => panelData[`${(x / PANEL) | 0},${(y / PANEL) | 0}`]?.grid[(y % PANEL) * PANEL + (x % PANEL)]
      const isProtected = (t) => t === T.ROAD || t === T.WATERROAD || t === T.CLIFF || t === T.OCEAN || t === T.LAKE

      const nearRoad = (x, y) => {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nb = get(x + dx, y + dy)
          if (nb && (nb.type === T.ROAD || nb.type === T.WATERROAD)) return true
        }
        return false
      }

      const countForest8 = (x, y) => {
        let n = 0
        for (const [dx, dy] of [
          [-1, 0], [1, 0], [0, -1], [0, 1],
          [-1, -1], [1, -1], [-1, 1], [1, 1],
        ]) {
          const nb = get(x + dx, y + dy)
          if (nb && nb.type === T.FOREST) n++
        }
        return n
      }

      const ADD_ITER = 4
      for (let it = 0; it < ADD_ITER; it++) {
        const toForest = []
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const c = get(x, y)
            if (!c || c.type === T.FOREST || isProtected(c.type)) continue
            if (nearRoad(x, y)) continue
            if (countForest8(x, y) >= 5) toForest.push([x, y])
          }
        }
        for (const [x, y] of toForest) {
          const c = get(x, y)
          if (c && !isProtected(c.type) && c.type !== T.FOREST) c.type = T.FOREST
        }
      }

      const toLand = []
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const c = get(x, y)
          if (!c || c.type !== T.FOREST) continue
          if (isProtected(c.type)) continue
          if (nearRoad(x, y)) continue
          if (countForest8(x, y) === 0) toLand.push([x, y])
        }
      }
      for (const [x, y] of toLand) {
        const c = get(x, y)
        if (c && c.type === T.FOREST) c.type = T.LAND
      }
    })()

    // Add a stable interior waypoint for each panel in each secret halo cluster (debug + future access logic).
    // This does NOT carve roads into the halo; it only records a good interior anchor per panel.
    if (secretHaloGroups.length > 0) {
      for (const group of secretHaloGroups) {
        const groupSet = new Set(group)
        for (const pk of group) {
          const [px, py] = pk.split(',').map(Number)
          if (panelData[pk]?.isWaterDominant) continue
          const cd = buildCliffDistMap(px, py)
          const pt = getPanelInteriorPoint(px, py, cd, null, null)
          if (!pt) continue
          const rpt = refineInteriorWaypoint(px, py, pt[0], pt[1], null)
          if (rpt) pushRoadWaypoint(rpt)

          // Also record stable edge waypoints for connections within the halo cluster.
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = `${px + dx},${py + dy}`
            if (!groupSet.has(nk)) continue
            const ep = getStableEdgePoint(px, py, dx, dy)
            if (!ep) continue
            const [rx, ry] = refineEdgeWaypoint(px, py, { dx, dy, x: ep.x, y: ep.y })
            pushRoadWaypoint([rx, ry])
          }
        }
      }
    }

    // Secret halo internal road stamping:
    // For each halo cluster, pick a deterministic start panel and stamp a connected
    // internal road network (spanning tree) using the same per-panel road stamping logic
    // as Step 12 (tile roads), but restricted to links within the cluster.
    if (secretHaloGroups.length > 0) {
      const buildClusterLinks = (group) => {
        const groupSet = new Set(group)
        const links = new Map() // pk -> Array<{dx,dy,nk}>
        for (const pk of group) links.set(pk, [])

        // Deterministic start: closest to centroid, tie by key.
        let sx = 0, sy = 0
        for (const pk of group) { const [px, py] = pk.split(',').map(Number); sx += px; sy += py }
        const cx = sx / group.length, cy = sy / group.length
        const keys = [...group].sort()
        let start = keys[0]
        let bestD = Infinity
        for (const pk of keys) {
          const [px, py] = pk.split(',').map(Number)
          const d = Math.abs(px - cx) + Math.abs(py - cy)
          if (d < bestD) { bestD = d; start = pk }
        }

        // BFS spanning tree (deterministic neighbor order).
        const seen = new Set([start])
        const q = [start]
        let qi = 0
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        while (qi < q.length) {
          const cur = q[qi++]
          const [px, py] = cur.split(',').map(Number)
          const neigh = []
          for (const [dx, dy] of dirs) {
            const nk = `${px + dx},${py + dy}`
            if (!groupSet.has(nk) || seen.has(nk)) continue
            neigh.push({ dx, dy, nk })
          }
          neigh.sort((a, b) => a.nk.localeCompare(b.nk))
          for (const n of neigh) {
            seen.add(n.nk)
            q.push(n.nk)
            links.get(cur).push({ dx: n.dx, dy: n.dy, nk: n.nk })
            links.get(n.nk).push({ dx: -n.dx, dy: -n.dy, nk: cur })
          }
        }
        return { links, groupSet }
      }

      const stampHaloGroundPath = (path) => {
        if (!path || path.length === 0) return
        for (let i = 0; i < path.length; i++) {
          const [wx, wy] = path[i]
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x = wx + dx, y = wy + dy
              if (x < 0 || y < 0 || x >= W || y >= H) continue
              const pk = `${(x / PANEL) | 0},${(y / PANEL) | 0}`
              const pd = panelData[pk]
              if (!pd) continue
              const cell = pd.grid[(y % PANEL) * PANEL + (x % PANEL)]
              if (!cell) continue
              // Bulldoze everything except water + cliffs.
              // Grass is passable and should be preserved.
              if (cell.type === T.CLIFF || cell.type === T.OCEAN || cell.type === T.LAKE || cell.type === T.WATERROAD || cell.type === T.GRASS) continue
              cell.type = T.LAND
              cell.elevation = cell.elevation || 1
            }
          }
        }
      }

      const routeAndBulldoze = (swx, swy, twx, twy, tileCost) => {
        const p = tileRoute(swx, swy, twx, twy, tileCost)
        stampHaloGroundPath(p)
        if (p) roadPaths.push(p)
        return p
      }

      const stampPanelInternalLinks = (px2, py2, linkedDirs) => {
        const activeEdges = []
        for (const { dx, dy } of linkedDirs) {
          const ep = getStableEdgePoint(px2, py2, dx, dy)
          if (!ep) continue
          const [rx, ry] = refineEdgeWaypoint(px2, py2, { dx, dy, x: ep.x, y: ep.y })
          activeEdges.push({ dx, dy, x: rx, y: ry })
        }
        if (activeEdges.length === 0) return

        // Cost functions for this panel.
        const passableCliffs = getPassableCliffTiles(px2, py2)
        const cliffDist = buildCliffDistMap(px2, py2)
        const tileCost = makeTileCost(px2, py2, passableCliffs, cliffDist)
        const edgeInsetBounds = activeEdgeInteriorInsetBounds(activeEdges)

        const isEndpoint = activeEdges.length === 1
        if (isEndpoint) {
          const ea = activeEdges[0]
          const panelCenterWx = px2 * PANEL + (PANEL >> 1)
          const panelCenterWy = py2 * PANEL + (PANEL >> 1)
          const { vx, vy } = normalizeVec(panelCenterWx - ea.x, panelCenterWy - ea.y)
          const intent = { ex: ea.x, ey: ea.y, vx, vy }
          let interior = getPanelInteriorPoint(px2, py2, cliffDist, edgeInsetBounds, intent)
          if (interior) interior = refineInteriorWaypoint(px2, py2, interior[0], interior[1], edgeInsetBounds)
          if (interior) {
            pushRoadWaypoint(interior)
            routeAndBulldoze(ea.x, ea.y, interior[0], interior[1], tileCost)
          }
          return
        }

        if (activeEdges.length === 2) {
          const [a, b] = activeEdges
          routeAndBulldoze(a.x, a.y, b.x, b.y, tileCost)
          return
        }

        // 3–4 edges: spine-first within the panel.
        const SPINE_SAMPLE_STRIDE = 6
        const sampleSpine = (path) => {
          const pts = []
          for (let i = 0; i < path.length; i += SPINE_SAMPLE_STRIDE) pts.push(path[i])
          if (pts.length === 0 || pts[0] !== path[0]) pts.unshift(path[0])
          const last = path[path.length - 1]
          const lastC = pts[pts.length - 1]
          if (!lastC || lastC[0] !== last[0] || lastC[1] !== last[1]) pts.push(last)
          return pts
        }

        let bestPair = null
        let bestScore = Infinity
        let bestSpine = null
        let bestCandidates = null
        for (let i = 0; i < activeEdges.length; i++) {
          for (let j = i + 1; j < activeEdges.length; j++) {
            const ea = activeEdges[i], eb = activeEdges[j]
            const p = tileRoute(ea.x, ea.y, eb.x, eb.y, tileCost)
            if (!p || p.length === 0) continue
            const candidates = sampleSpine(p)
            let score = p.length
            for (let k = 0; k < activeEdges.length; k++) {
              if (k === i || k === j) continue
              const e = activeEdges[k]
              let bestD = Infinity
              for (let c = 0; c < candidates.length; c++) {
                const [tx, ty] = candidates[c]
                const d = manhattan(e.x, e.y, tx, ty)
                if (d < bestD) bestD = d
              }
              score += bestD
            }
            if (score < bestScore) {
              bestScore = score
              bestPair = [i, j]
              bestSpine = p
              bestCandidates = candidates
            }
          }
        }
        if (!bestPair || !bestSpine || bestSpine.length === 0) return
        stampHaloGroundPath(bestSpine)
        roadPaths.push(bestSpine)

        const iA = bestPair[0], iB = bestPair[1]
        const spineCandidates = bestCandidates
        for (let i = 0; i < activeEdges.length; i++) {
          if (i === iA || i === iB) continue
          const e = activeEdges[i]
          const ordered = spineCandidates
            .map(p => ({ p, d: manhattan(e.x, e.y, p[0], p[1]) }))
            .sort((u, v) => u.d - v.d)
          let bestConn = null
          let bestJoin = null
          let bestLen = Infinity
          const tryCount = Math.min(12, ordered.length)
          for (let t = 0; t < tryCount; t++) {
            const [tx, ty] = ordered[t].p
            const conn = tileRoute(e.x, e.y, tx, ty, tileCost)
            if (!conn || conn.length === 0) continue
            const len = conn.length
            if (len < bestLen) { bestLen = len; bestConn = conn; bestJoin = [tx, ty] }
          }
          if (bestConn && bestJoin) {
            stampHaloGroundPath(bestConn)
            roadPaths.push(bestConn)
            pushRoadWaypoint(bestJoin)
          }
        }
      }

      for (const group of secretHaloGroups) {
        const { links } = buildClusterLinks(group)
        for (const pk of group) {
          const linkedDirs = (links.get(pk) ?? []).map(l => ({ dx: l.dx, dy: l.dy }))
          if (linkedDirs.length === 0) continue
          const [px, py] = pk.split(',').map(Number)
          stampPanelInternalLinks(px, py, linkedDirs)
        }
      }
    }

    // Secret halo water-access check (dumb version):
    // Mark a halo cluster as water-accessible if it borders a continuous body of water
    // that also borders any main (non-halo) visitable tile.
    if (secretHaloGroups.length > 0) {
      const isWater = (t) => (t === T.OCEAN || t === T.LAKE || t === T.WATERROAD)
      const isMainVisitablePanel = (pd) => !!pd && !pd.isForestHalo && (pd.settlement || pd.isRoute)
      const isPassableLand = (t) => (t === T.LAND || t === T.GRASS || t === T.ROAD)

      const worldCell = (wx, wy) => {
        if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
        return panelData[`${(wx / PANEL) | 0},${(wy / PANEL) | 0}`]?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
      }

      // Label connected water components (4-neighbor).
      const compId = new Int32Array(W * H).fill(-1)
      const enc = (x, y) => y * W + x
      let nextId = 0
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = enc(x, y)
          if (compId[i] !== -1) continue
          const c = worldCell(x, y)
          if (!c || !isWater(c.type)) continue
          const id = nextId++
          compId[i] = id
          const q = [[x, y]]
          let qi = 0
          while (qi < q.length) {
            const [cx, cy] = q[qi++]
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = cx + dx, ny = cy + dy
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
              const ni = enc(nx, ny)
              if (compId[ni] !== -1) continue
              const nc = worldCell(nx, ny)
              if (!nc || !isWater(nc.type)) continue
              compId[ni] = id
              q.push([nx, ny])
            }
          }
        }
      }

      // Water components that touch any main visitable land tile (via 4-neighbor adjacency).
      const mainTouchingWater = new Set()
      for (const key of Object.keys(panelData)) {
        const pd = panelData[key]
        if (!isMainVisitablePanel(pd)) continue
        const [px, py] = key.split(',').map(Number)
        const baseX = px * PANEL, baseY = py * PANEL
        for (let cy = 0; cy < PANEL; cy++) {
          for (let cx = 0; cx < PANEL; cx++) {
            const c = pd.grid[cy * PANEL + cx]
            if (!c || !isPassableLand(c.type)) continue
            const wx = baseX + cx, wy = baseY + cy
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = wx + dx, ny = wy + dy
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
              const id = compId[enc(nx, ny)]
              if (id !== -1) mainTouchingWater.add(id)
            }
          }
        }
      }

      for (const group of secretHaloGroups) {
        let waterAccess = false
        for (const pk of group) {
          const [px, py] = pk.split(',').map(Number)
          const pd = panelData[pk]
          if (!pd) continue
          const baseX = px * PANEL, baseY = py * PANEL
          for (let cy = 0; cy < PANEL; cy++) {
            for (let cx = 0; cx < PANEL; cx++) {
              const c = pd.grid[cy * PANEL + cx]
              if (!c || (c.type !== T.LAND && c.type !== T.GRASS)) continue
              const wx = baseX + cx, wy = baseY + cy
              for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = wx + dx, ny = wy + dy
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
                const id = compId[enc(nx, ny)]
                if (id !== -1 && mainTouchingWater.has(id)) { waterAccess = true; break }
              }
              if (waterAccess) break
            }
            if (waterAccess) break
          }
          if (waterAccess) break
        }

        for (const pk of group) {
          const pd = panelData[pk]
          if (!pd) continue
          pd.isSecretHaloWaterAccess = waterAccess
          pd.isSecretHaloLandLocked = !waterAccess
        }
      }
    }

    // NOTE: secret halo access roads are temporarily disabled. We still generate
    // secret halo groups/pockets, but do not carve guaranteed road entrances into them.
    // New access behavior will be implemented in a future change.

    // Recompute tile indices so halo forest cells get correct Wang borders
    calculateTileIndices()
  })()

  // --- Step 20: Biome Zoning ---
  // Six **single-panel** seeds on main visitable panels (`isRoute|settlement` and **not** `isForestHalo`),
  // then round-robin expansion. Runs **after** Step 19 so halo panels are excluded from seeds.
  {
    const seedVisitable = (k) => {
      const pd = panelData[k]
      return !!(pd && !pd.isForestHalo && (pd.isRoute || pd.settlement))
    }
    const mainVisitableKeys = Object.keys(panelData).filter(seedVisitable)
    if (mainVisitableKeys.length > 0) {
      const allKeys = Object.keys(panelData)

      const getWorldCell = (wx, wy) => {
        if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
        const pd = panelData[`${(wx / PANEL) | 0},${(wy / PANEL) | 0}`]
        return pd?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
      }

      const Wp = width
      const Hp = height

      const hasLandElev = (c) => !!c && (c.type === T.LAND || c.type === T.GRASS || c.type === T.FOREST || c.type === T.ROAD || c.type === T.WATERROAD) && c.elevation >= 1

      /** @type {Set<string>} */
      const occupiedPanels = new Set()
      const markOccupied = (keys) => { for (const k of keys) occupiedPanels.add(k) }

      /** @type {(string[] | null)[]} */
      const blocks = Array.from({ length: 6 }, () => null)

      const pickFirstVisitable = () => {
        for (let py = 0; py < Hp; py++) {
          for (let px = 0; px < Wp; px++) {
            const pk = `${px},${py}`
            if (!seedVisitable(pk)) continue
            if (occupiedPanels.has(pk)) continue
            return pk
          }
        }
        return null
      }

      const bestVisitablePanelByMaxElev = () => {
        let bestK = null
        let bestE = -1
        for (let py = 0; py < Hp; py++) {
          for (let px = 0; px < Wp; px++) {
            const pk = `${px},${py}`
            if (!seedVisitable(pk) || occupiedPanels.has(pk)) continue
            const e = panelStats[pk]?.maxElev ?? 0
            if (e > bestE || (e === bestE && bestK !== null && pk.localeCompare(bestK) < 0)) {
              bestE = e
              bestK = pk
            }
          }
        }
        return bestK
      }

      const bestVisitablePanelByMinElev = () => {
        let bestK = null
        let bestE = 999
        for (let py = 0; py < Hp; py++) {
          for (let px = 0; px < Wp; px++) {
            const pk = `${px},${py}`
            if (!seedVisitable(pk) || occupiedPanels.has(pk)) continue
            const e = panelStats[pk]?.maxElev ?? 99
            if (e < bestE || (e === bestE && bestK !== null && pk.localeCompare(bestK) < 0)) {
              bestE = e
              bestK = pk
            }
          }
        }
        return bestK
      }

      if (Wp >= 1 && Hp >= 1) {
        const lushPx = Math.max(0, Math.min(Wp - 1, Math.floor(Wp / 2)))
        const lushPy = Math.max(0, Math.min(Hp - 1, Math.floor(Hp / 2)))
        let lushPk = `${lushPx},${lushPy}`
        if (!seedVisitable(lushPk) || occupiedPanels.has(lushPk)) {
          const p = pickFirstVisitable()
          if (p) lushPk = p
        }
        if (seedVisitable(lushPk) && !occupiedPanels.has(lushPk)) {
          blocks[0] = [lushPk]
          markOccupied(blocks[0])
        }

        let maxE = -1
        let minE = 999
        let maxE2 = -1
        for (let wy = 0; wy < H; wy++) {
          for (let wx = 0; wx < W; wx++) {
            const c = getWorldCell(wx, wy)
            if (!hasLandElev(c)) continue
            const e = c.elevation
            if (e > maxE) maxE = e
            if (e < minE) minE = e
          }
        }
        for (let wy = 0; wy < H; wy++) {
          for (let wx = 0; wx < W; wx++) {
            const c = getWorldCell(wx, wy)
            if (!hasLandElev(c)) continue
            const e = c.elevation
            if (e < maxE && e > maxE2) maxE2 = e
          }
        }

        let p1wx = -1, p1wy = -1
        outer1: for (let wy = 0; wy < H; wy++) {
          for (let wx = 0; wx < W; wx++) {
            const c = getWorldCell(wx, wy)
            if (hasLandElev(c) && c.elevation === maxE) { p1wx = wx; p1wy = wy; break outer1 }
          }
        }
        if (p1wx >= 0) {
          let pk = `${(p1wx / PANEL) | 0},${(p1wy / PANEL) | 0}`
          if (!seedVisitable(pk) || occupiedPanels.has(pk)) {
            pk = bestVisitablePanelByMaxElev()
          }
          if (pk && seedVisitable(pk) && !occupiedPanels.has(pk)) {
            blocks[1] = [pk]
            markOccupied(blocks[1])
          }
        }

        let p2wx = -1, p2wy = -1
        if (maxE2 >= 1) {
          outer2: for (let wy = 0; wy < H; wy++) {
            for (let wx = 0; wx < W; wx++) {
              const c = getWorldCell(wx, wy)
              if (hasLandElev(c) && c.elevation === maxE2) { p2wx = wx; p2wy = wy; break outer2 }
            }
          }
        }
        if (p2wx < 0) {
          outer3: for (let wy = 0; wy < H; wy++) {
            for (let wx = 0; wx < W; wx++) {
              const c = getWorldCell(wx, wy)
              if (hasLandElev(c) && c.elevation === maxE && (wx !== p1wx || wy !== p1wy)) {
                p2wx = wx; p2wy = wy; break outer3
              }
            }
          }
        }
        if (p2wx >= 0) {
          let pk = `${(p2wx / PANEL) | 0},${(p2wy / PANEL) | 0}`
          if (!seedVisitable(pk) || occupiedPanels.has(pk)) {
            const b0 = blocks[0]?.[0]
            const b1 = blocks[1]?.[0]
            let bestK = null
            let bestEv = -1
            for (let py = 0; py < Hp; py++) {
              for (let px = 0; px < Wp; px++) {
                const k2 = `${px},${py}`
                if (!seedVisitable(k2) || occupiedPanels.has(k2)) continue
                if (k2 === b0 || k2 === b1) continue
                const ev = panelStats[k2]?.maxElev ?? 0
                if (ev > bestEv || (ev === bestEv && bestK !== null && k2.localeCompare(bestK) < 0)) {
                  bestEv = ev
                  bestK = k2
                }
              }
            }
            pk = bestK
          }
          if (pk && seedVisitable(pk) && !occupiedPanels.has(pk)) {
            blocks[5] = [pk]
            markOccupied(blocks[5])
          }
        }

        const tryMinCells = []
        for (let wy = 0; wy < H; wy++) {
          for (let wx = 0; wx < W; wx++) {
            const c = getWorldCell(wx, wy)
            if (hasLandElev(c) && c.elevation === minE) tryMinCells.push([wx, wy])
          }
        }
        let tropPk = null
        for (const [mwx, mwy] of tryMinCells) {
          const pk = `${(mwx / PANEL) | 0},${(mwy / PANEL) | 0}`
          if (seedVisitable(pk) && !occupiedPanels.has(pk)) { tropPk = pk; break }
        }
        if (!tropPk && tryMinCells.length > 0) {
          tropPk = bestVisitablePanelByMinElev()
        }
        if (tropPk && seedVisitable(tropPk) && !occupiedPanels.has(tropPk)) {
          blocks[4] = [tropPk]
          markOccupied(blocks[4])
        }

        const emptyScorePanel = (pk) => {
          const pd = panelData[pk]
          if (!pd) return -1e9
          let s = 0
          if (pd.settlement) s -= 5000
          for (const cell of pd.grid) {
            if (!cell) continue
            if (cell.type === T.LAND || cell.type === T.GRASS) s += 2
            else if (cell.type === T.ROAD || cell.type === T.WATERROAD) s += 1
            else if (cell.type === T.FOREST) s -= 1
            else if (cell.type === T.OCEAN || cell.type === T.LAKE) s -= 4
          }
          return s
        }

        const placeEmptyBiome = (biomeIdx) => {
          let best = null
          let bestS = -Infinity
          for (let py = 0; py < Hp; py++) {
            for (let px = 0; px < Wp; px++) {
              const pk = `${px},${py}`
              if (occupiedPanels.has(pk)) continue
              if (!seedVisitable(pk)) continue
              const sc = emptyScorePanel(pk)
              const better = sc > bestS || (sc === bestS && best !== null && pk.localeCompare(best) < 0)
              if (better) {
                bestS = sc
                best = pk
              }
            }
          }
          if (best) {
            blocks[biomeIdx] = [best]
            markOccupied([best])
          }
        }

        placeEmptyBiome(2)
        placeEmptyBiome(3)
      }

      /** @type {Map<string, number>} panel key → biome, -1 unassigned */
      const panelOwner = new Map()
      for (const key of allKeys) panelOwner.set(key, -1)
      for (let b = 0; b < 6; b++) {
        const keys = blocks[b]
        if (!keys) continue
        for (const pk of keys) {
          if (panelOwner.has(pk)) panelOwner.set(pk, b)
        }
      }

      const area = PANEL * PANEL
      const landFracOf = (pk) => {
        const st = panelStats?.[pk]
        if (st) return Math.max(0, Math.min(1, 1 - (st.waterCount ?? 0) / area))
        const pd = panelData[pk]
        if (!pd) return 0
        let land = 0
        for (const c of pd.grid) {
          if (!c) continue
          if (c.type === T.OCEAN || c.type === T.LAKE) continue
          land++
        }
        return land / area
      }

      const scorePanelForBiome = (pk, b) => {
        const pd = panelData[pk]
        if (!pd) return -1e12
        const st = panelStats?.[pk]
        const maxE = st?.maxElev ?? 1
        const waterDom = !!pd.isWaterDominant
        let s = landFracOf(pk) * 1000
        if (waterDom) s -= 9000
        if (b === 1 || b === 5) s += maxE * 60
        else if (b === 4) s += (7 - maxE) * 60
        return s
      }

      const neighborPanelKeys = (pk) => {
        const [px, py] = pk.split(',').map(Number)
        const out = []
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx, ny = py + dy
          if (nx < 0 || ny < 0 || nx >= Wp || ny >= Hp) continue
          const nk = `${nx},${ny}`
          if (panelOwner.has(nk)) out.push(nk)
        }
        return out
      }

      const countUnassigned = () => {
        let n = 0
        for (const k of allKeys) if (panelOwner.get(k) < 0) n++
        return n
      }

      let guard = 0
      const maxGuard = allKeys.length * 12 + 64
      while (countUnassigned() > 0 && guard < maxGuard) {
        guard++
        let progressed = false
        for (let b = 0; b < 6; b++) {
          /** @type {string[]} */
          const cands = []
          for (const pk of allKeys) {
            if (panelOwner.get(pk) >= 0) continue
            for (const nk of neighborPanelKeys(pk)) {
              if (panelOwner.get(nk) === b) {
                cands.push(pk)
                break
              }
            }
          }
          if (cands.length === 0) continue
          let bestK = null
          let bestS = -Infinity
          for (const pk of cands) {
            const sc = scorePanelForBiome(pk, b)
            if (sc > bestS || (sc === bestS && bestK !== null && pk.localeCompare(bestK) < 0)) {
              bestS = sc
              bestK = pk
            }
          }
          if (bestK !== null) {
            panelOwner.set(bestK, b)
            progressed = true
          }
        }
        if (!progressed) break
      }

      if (countUnassigned() > 0) {
        for (const pk of allKeys) {
          if (panelOwner.get(pk) >= 0) continue
          const [px, py] = pk.split(',').map(Number)
          const adjBiomes = new Set()
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = `${px + dx},${py + dy}`
            const ob = panelOwner.get(nk)
            if (ob !== undefined && ob >= 0) adjBiomes.add(ob)
          }
          let bestB = 0
          let bestS = -Infinity
          for (const bb of adjBiomes) {
            const sc = scorePanelForBiome(pk, bb)
            if (sc > bestS || (sc === bestS && bb < bestB)) {
              bestS = sc
              bestB = bb
            }
          }
          panelOwner.set(pk, bestB)
        }
      }

      for (const key of allKeys) {
        const b = panelOwner.get(key) ?? 0
        const pd = panelData[key]
        pd.biome = b
        for (const cell of pd.grid) {
          if (cell) cell.biome = b
        }
      }

      // Biome blending on biome-change thresholds:
      // For each 4-neighbor panel boundary where biomes differ, compare panel average elevation.
      // The lower-average panel's biome takes the lowest elevation zone present across the pair;
      // the higher-average panel's biome takes all higher elevation zones.
      ; (() => {
        const isLandish = (c) =>
          !!c &&
          c.elevation >= 1 &&
          c.type !== T.OCEAN &&
          c.type !== T.LAKE

        const statCache = new Map()
        const panelElevStats = (k) => {
          const cached = statCache.get(k)
          if (cached) return cached
          const pd = panelData[k]
          if (!pd?.grid) { statCache.set(k, null); return null }
          let sum = 0
          let n = 0
          let minE = 999
          for (const c of pd.grid) {
            if (!isLandish(c)) continue
            sum += c.elevation
            n++
            if (c.elevation < minE) minE = c.elevation
          }
          const out = n > 0 ? { avg: sum / n, min: minE } : null
          statCache.set(k, out)
          return out
        }

        const applyZones = (k, lowBiome, highBiome, minElev) => {
          const pd = panelData[k]
          if (!pd?.grid) return
          for (const c of pd.grid) {
            if (!isLandish(c)) continue
            c.biome = (c.elevation === minElev) ? lowBiome : highBiome
          }
        }

        for (let py = 0; py < Hp; py++) {
          for (let px = 0; px < Wp; px++) {
            const aKey = `${px},${py}`
            const aPd = panelData[aKey]
            if (!aPd) continue
            const aB = aPd.biome ?? 0
            for (const [dx, dy] of [[1, 0], [0, 1]]) { // only once per edge
              const bx = px + dx, by = py + dy
              if (bx < 0 || by < 0 || bx >= Wp || by >= Hp) continue
              const bKey = `${bx},${by}`
              const bPd = panelData[bKey]
              if (!bPd) continue
              const bB = bPd.biome ?? 0
              if (aB === bB) continue

              const as = panelElevStats(aKey)
              const bs = panelElevStats(bKey)
              if (!as || !bs) continue

              const lowBiome = as.avg <= bs.avg ? aB : bB
              const highBiome = as.avg <= bs.avg ? bB : aB
              const minElev = Math.min(as.min, bs.min)

              applyZones(aKey, lowBiome, highBiome, minElev)
              applyZones(bKey, lowBiome, highBiome, minElev)
            }
          }
        }
      })()

      // Pocket cleanup pass:
      // After zone blending, flood-fill contiguous landish zones (land/forest/road/grass),
      // choose the dominant biome within each zone, then fill the whole zone.
      ; (() => {
        // Persist zone identity so the renderer can highlight zones on hover.
        // 0 means "not in any zone" (ocean/lake/cliff/non-visitable/etc).
        pocketIdGrid = new Uint32Array(W * H)
        pocketCellsById = [null] // pocket ids start at 1
        let nextPocketId = 1

        const getPanelKey = (wx, wy) => `${(wx / PANEL) | 0},${(wy / PANEL) | 0}`
        const isMainVisitablePanelKey = (k) => {
          const pd = panelData[k]
          if (!pd) return false
          // Include halo panels in pocket/forest-zone blending + hover highlighting.
          // Halo panels are typically flagged `isRoute=true` for rendering consistency.
          return !!(pd.isRoute || pd.settlement)
        }

        const getCell = (wx, wy) => {
          if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
          const pd = panelData[getPanelKey(wx, wy)]
          return pd?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
        }

        const isZoneCellAt = (wx, wy, c) =>
          isMainVisitablePanelKey(getPanelKey(wx, wy)) &&
          !!c &&
          c.elevation >= 1 &&
          (c.type === T.LAND || c.type === T.FOREST || c.type === T.ROAD || c.type === T.GRASS)

        const seen = new Uint8Array(W * H)
        const qx = new Int32Array(W * H)
        const qy = new Int32Array(W * H)
        const pocketCells = new Int32Array(W * H)

        for (let wy = 0; wy < H; wy++) {
          for (let wx = 0; wx < W; wx++) {
            const idx = wy * W + wx
            if (seen[idx]) continue
            const sc = getCell(wx, wy)
            if (!isZoneCellAt(wx, wy, sc)) { seen[idx] = 1; continue }

            // BFS to collect the pocket
            let qs = 0, qe = 0
            qx[qe] = wx; qy[qe] = wy; qe++
            seen[idx] = 1

            // biome histogram for this pocket (0..5)
            const counts = [0, 0, 0, 0, 0, 0]
            let pocketN = 0

            while (qs < qe) {
              const cx = qx[qs]
              const cy = qy[qs]
              qs++

              const c = getCell(cx, cy)
              if (!isZoneCellAt(cx, cy, c)) continue

              pocketCells[pocketN++] = cy * W + cx
              const b = c.biome ?? 0
              if (b >= 0 && b < counts.length) counts[b]++

              for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + dx, ny = cy + dy
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
                const ni = ny * W + nx
                if (seen[ni]) continue
                seen[ni] = 1
                const nc = getCell(nx, ny)
                if (!isZoneCellAt(nx, ny, nc)) continue
                qx[qe] = nx; qy[qe] = ny; qe++
              }
            }

            if (pocketN <= 0) continue

            // pick dominant biome (deterministic: lowest biome id wins ties)
            let domB = 0
            let best = -1
            for (let b = 0; b < counts.length; b++) {
              const v = counts[b]
              if (v > best) { best = v; domB = b }
            }

            const pocketId = nextPocketId++
            const pocketMembers = new Int32Array(pocketN)
            pocketMembers.set(pocketCells.subarray(0, pocketN))
            pocketCellsById[pocketId] = pocketMembers

            // fill zone to dominant + stamp zone id
            for (let i2 = 0; i2 < pocketN; i2++) {
              const wi = pocketCells[i2]
              pocketIdGrid[wi] = pocketId
              const cx = wi % W
              const cy = (wi / W) | 0
              const c = getCell(cx, cy)
              if (c) c.biome = domB
            }
          }
        }
      })()

      // Water biome pass: assign each water tile a biome from its adjacent uphill land.
      applyWaterBiomePass(panelData, W, H)

      // Cliff biome pass:
      // Cliffs are derived from solid tiles earlier (Step 11) and are excluded from zone flood-fill.
      // A cliff belongs to the biome of its **lowest-elevation neighbor** (the bottom-side ground).
      ; (() => {
        const getPanelKey = (wx, wy) => `${(wx / PANEL) | 0},${(wy / PANEL) | 0}`
        const getCell = (wx, wy) => {
          if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
          const pd = panelData[getPanelKey(wx, wy)]
          return pd?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
        }
        const isPlateauish = (c) =>
          !!c &&
          c.elevation >= 1 &&
          (c.type === T.LAND || c.type === T.FOREST || c.type === T.ROAD || c.type === T.GRASS)

        for (let wy = 0; wy < H; wy++) {
          for (let wx = 0; wx < W; wx++) {
            const c = getCell(wx, wy)
            if (!c || c.type !== T.CLIFF) continue

            let bestElev = 999
            let bestBiome = null

            for (const [dx, dy] of [
              [1, 0], [-1, 0], [0, 1], [0, -1],
              [1, 1], [1, -1], [-1, 1], [-1, -1],
            ]) {
              const nb = getCell(wx + dx, wy + dy)
              if (!isPlateauish(nb)) continue
              const e = nb.elevation | 0
              const b = (nb.biome ?? 0) | 0
              if (e < bestElev) {
                bestElev = e
                bestBiome = b
              } else if (e === bestElev && bestBiome != null && b < bestBiome) {
                bestBiome = b
              }
            }

            if (bestBiome != null) {
              c.biome = bestBiome
              continue
            }

            const pd = panelData[getPanelKey(wx, wy)]
            if (c.biome == null && pd?.biome != null) c.biome = pd.biome
          }
        }
      })()
    }
  }

  assignPanelMapNames(panelData)
  return { panelData, width, height, islandSeeds, roadPaths, roadWaypoints, panelStats, assignedPanels, pocketIdGrid, pocketCellsById }
}

// ---------------------------------------------------------------------------
// Default ASCII map for the test panel (32×32).
// Characters:
//   . = OCEAN      L = LAND elev 1    H = LAND elev 2 (high plateau, produces cliffs)
//   R = ROAD       W = WATER (OCEAN carved into LAND background)
//   F = FOREST     G = GRASS
// Cliff detection runs automatically on H cells — no need to place cliffs manually.
// ---------------------------------------------------------------------------
export const DEFAULT_TEST_MAP = [
  `................................`, // row  0
  `................................`, // row  1
  `.HHHHHHHHHHHH...FFFFFF..........`, // row  2  — cliff block left, forest block right
  `.HHHHHHHHHHHH...FFFFFF..........`, // row  3
  `.HHHHHHHHHHHH...FFFFFF..........`, // row  4
  `.HHH....HHHH....FFFFFF..........`, // row  5
  `.HHH....HHHH....FFFFFF..........`, // row  6
  `.HHH....HHHH....FFFFFF..........`, // row  7
  `.HHHHHHHHHHHH...............F...`, // row  8  — isolated single F (trunk-only test)
  `.HHHHHHHHHHHH................`, // row  9
  `.HHHHHHHHHHHH................`, // row 10
  `.HHHHHHHHHHHH................`, // row 11
  `.HHHHHHHHHHHH................`, // row 12
  `.HHHHHHHHHHHH................`, // row 13
  `................................`, // row 14
  `................................`, // row 15
  `LLLLLLLLLLLLLLLL................`, // row 16
  `LLLLLLLLLLLLLLLL................`, // row 17
  `LLLL............................`, // row 18
  `LLLL............................`, // row 19
  `LL..............................`, // row 20
  `LL..............................`, // row 21
  `LL..............................`, // row 22
  `LL..............................`, // row 23
  `LLL.............................`, // row 24
  `LLL.............................`, // row 25
  `LLLLLLLLLLLLLLLL................`, // row 26
  `LLLLLLLLLLLLLLLL................`, // row 27
  `LLLLLLLLLLLLLLLL................`, // row 28
  `LLLLLLLLLLLLLLLL................`, // row 29
  `LLLLLLLLLLLLLLLL................`, // row 30
  `LLLLLLLLLLLLLLLL................`, // row 31
].join('\n')

/**
 * Generates a single-panel grid from a 32-character-per-row ASCII map string.
 *
 * Used by the MapGenerator tool's "Load Test Panel" feature to provide a
 * deterministic panel for validating tileset and cliff rendering without
 * needing a full region generation pass.
 *
 * ASCII characters:
 *   `.` = OCEAN, `L` = LAND (elev 1), `H` = LAND (elev 2, produces cliffs),
 *   `R` = ROAD (elev 1), `F` = FOREST (elev 1), `G` = GRASS (elev 1), `W` = OCEAN
 *
 * @param {string} [asciiMap=DEFAULT_TEST_MAP] 32×32 newline-separated ASCII grid.
 * @returns {{ grid: Array, biomeName: string, waterDominance: number, isRoute: boolean, settlement: null }}
 */
export function generateTestPanel(asciiMap = DEFAULT_TEST_MAP) {
  const SZ = PANEL // 32
  const grid = Array.from({ length: SZ * SZ }, () => ({
    type: T.OCEAN, elevation: 0, tileIndex: 15
  }))
  const idx = (cx, cy) => cy * SZ + cx
  const set = (cx, cy, type, elevation = 1) => {
    if (cx < 0 || cy < 0 || cx >= SZ || cy >= SZ) return
    grid[idx(cx, cy)].type = type
    grid[idx(cx, cy)].elevation = elevation
  }
  const get = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= SZ || cy >= SZ) return null
    return grid[idx(cx, cy)]
  }

  // Parse ASCII map — must be exactly SZ*SZ characters (whitespace ignored)
  const chars = asciiMap.replace(/\s/g, '')
  for (let i = 0; i < SZ * SZ; i++) {
    const cx = i % SZ, cy = Math.floor(i / SZ)
    switch (chars[i]) {
      case 'L': set(cx, cy, T.LAND, 1); break
      case 'H': set(cx, cy, T.LAND, 2); break
      case 'R': set(cx, cy, T.ROAD, 1); break
      case 'F': set(cx, cy, T.FOREST, 1); break
      case 'G': set(cx, cy, T.GRASS, 1); break
      case 'W': set(cx, cy, T.OCEAN, 0); break
      // '.' and anything else = OCEAN (default)
    }
  }

  // -------------------------------------------------------------------------
  // Cliff detection — H cells (elev=2) facing a lower solid neighbour become CLIFF
  // -------------------------------------------------------------------------
  for (let cy = 0; cy < SZ; cy++) {
    for (let cx = 0; cx < SZ; cx++) {
      const cell = get(cx, cy)
      if (!cell || cell.type !== T.LAND || cell.elevation !== 2) continue
      const e = cell.elevation
      const isSolid = c => c && (c.type === T.LAND || c.type === T.CLIFF)
      const lower = (dx, dy) => { const nb = get(cx + dx, cy + dy); return isSolid(nb) && nb.elevation < e }
      const N = lower(0, -1), S = lower(0, 1), E = lower(1, 0), W = lower(-1, 0)
      const NE = lower(1, -1), SE = lower(1, 1), SW = lower(-1, 1), NW = lower(-1, -1)
      if (!N && !S && !E && !W && !NE && !SE && !SW && !NW) continue
      cell.type = T.CLIFF
      cell.tileIndex = cliffTileIdx(N, S, E, W, NE, SE, SW, NW)
    }
  }

  // -------------------------------------------------------------------------
  // Compute directional 12-tile index for all non-cliff cells
  // -------------------------------------------------------------------------
  const bmpLand = new Uint8Array(SZ * SZ)
  const bmpRoad = new Uint8Array(SZ * SZ)
  const bmpWater = new Uint8Array(SZ * SZ)
  const bmpGrass = new Uint8Array(SZ * SZ)
  for (let i = 0; i < SZ * SZ; i++) {
    const t = grid[i].type
    if (t === T.LAND || t === T.FOREST || t === T.ROAD || t === T.CLIFF || t === T.GRASS) bmpLand[i] = 1
    if (t === T.ROAD) bmpRoad[i] = 1
    if (t === T.OCEAN || t === T.LAKE) bmpWater[i] = 1
    if (t === T.GRASS) bmpGrass[i] = 1
  }
  for (let cy = 0; cy < SZ; cy++) {
    for (let cx = 0; cx < SZ; cx++) {
      const c = grid[idx(cx, cy)]
      if (c.type === T.CLIFF) continue  // tileIndex set during cliff pass above
      if (c.type === T.ROAD) { c.tileIndex = dir12(bmpRoad, cx, cy, SZ); continue }
      if (c.type === T.LAND || c.type === T.FOREST) { c.tileIndex = dir12(bmpLand, cx, cy, SZ); continue }
      if (c.type === T.GRASS) { c.tileIndex = dir12(bmpGrass, cx, cy, SZ); continue }
      if (c.type === T.OCEAN || c.type === T.LAKE) { c.tileIndex = dir12(bmpWater, cx, cy, SZ); continue }
      c.tileIndex = 15
    }
  }

  return {
    grid,
    biomeName: 'Test Panel',
    waterDominance: 0,
    isRoute: false,
    settlement: null,
  }
}

/**
 * Assigns each ocean/lake cell a biome based on its highest-elevation uphill land neighbor.
 * Orthogonal neighbors are checked first; diagonals are used only as a fallback for corner-only
 * adjacency. Through cliffs, the cliff's uphill land tile is used instead of the cliff itself.
 *
 * Call this after any operation that changes land cell biomes (e.g. zone biome reassignment)
 * so that adjacent water tiles always match the correct uphill biome for transitions.
 *
 * @param {Object} panelData - Map of `"px,py"` → `{ grid: Cell[] }`
 * @param {number} W - World width in tiles
 * @param {number} H - World height in tiles
 */
export function applyWaterBiomePass(panelData, W, H) {
  const getPanelKey = (wx, wy) => `${(wx / PANEL) | 0},${(wy / PANEL) | 0}`
  const getCell = (wx, wy) => {
    if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
    const pd = panelData[getPanelKey(wx, wy)]
    return pd?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
  }
  const isLandishNoCliff = (c) =>
    !!c &&
    c.elevation >= 1 &&
    (c.type === T.LAND || c.type === T.FOREST || c.type === T.ROAD || c.type === T.GRASS)
  const isCliff = (c) => !!c && c.type === T.CLIFF

  const cliffDownhillOffset = (ti, waterRelDx, waterRelDy) => {
    const t = (typeof ti === 'number' && Number.isFinite(ti)) ? (ti | 0) : 0
    if (t === 0) return [0, -1]
    if (t === 2) return [1, 0]
    if (t === 4) return [0, 1]
    if (t === 6) return [-1, 0]
    if (t === 1) return [1, -1]
    if (t === 3) return [1, 1]
    if (t === 5) return [-1, 1]
    if (t === 7) return [-1, -1]
    const rx = (waterRelDx | 0), ry = (waterRelDy | 0)
    const matches = (dx, dy) => rx === dx && ry === dy
    if (t === 8)  { if (matches(0, -1)) return [0, -1]; if (matches(-1, 0)) return [-1, 0]; if (matches(-1, -1)) return [-1, -1]; return [-1, -1] }
    if (t === 9)  { if (matches(0, -1)) return [0, -1]; if (matches(1, 0)) return [1, 0]; if (matches(1, -1)) return [1, -1]; return [1, -1] }
    if (t === 10) { if (matches(0, 1)) return [0, 1]; if (matches(-1, 0)) return [-1, 0]; if (matches(-1, 1)) return [-1, 1]; return [-1, 1] }
    if (t === 11) { if (matches(0, 1)) return [0, 1]; if (matches(1, 0)) return [1, 0]; if (matches(1, 1)) return [1, 1]; return [1, 1] }
    return [0, 1]
  }

  const uphillBiome = (wx, wy, dx, dy) => {
    const nx = wx + dx, ny = wy + dy
    const nb = getCell(nx, ny)
    if (isLandishNoCliff(nb)) return nb.biome ?? 0
    if (isCliff(nb)) {
      const [cdx, cdy] = cliffDownhillOffset(nb.tileIndex, wx - nx, wy - ny)
      const up = getCell(nx - cdx, ny - cdy)
      if (isLandishNoCliff(up)) return up.biome ?? 0
      if (nb.biome != null) return nb.biome
    }
    return null
  }

  for (let wy = 0; wy < H; wy++) {
    for (let wx = 0; wx < W; wx++) {
      const c = getCell(wx, wy)
      if (!c || (c.type !== T.OCEAN && c.type !== T.LAKE)) continue

      let bestBiome = null
      let bestElev = -1
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = wx + dx, ny = wy + dy
        const nb = getCell(nx, ny)
        if (!nb) continue
        const elev = nb.elevation ?? 0
        if (elev <= bestElev) continue
        const b = uphillBiome(wx, wy, dx, dy)
        if (b != null) { bestBiome = b; bestElev = elev }
      }
      if (bestBiome == null) {
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nx = wx + dx, ny = wy + dy
          const nb = getCell(nx, ny)
          if (!nb) continue
          const elev = nb.elevation ?? 0
          if (elev <= bestElev) continue
          const b = uphillBiome(wx, wy, dx, dy)
          if (b != null) { bestBiome = b; bestElev = elev }
        }
      }

      if (bestBiome != null) { c.biome = bestBiome; continue }
      const pd = panelData[getPanelKey(wx, wy)]
      if (c.biome == null && pd?.biome != null) c.biome = pd.biome
    }
  }
}

/**
 * Primary public entry point — generates a complete procedural region.
 *
 * Wraps `generateTerrain` + `generateFromTerrain` in a retry loop (up to 20
 * attempts) to ensure the result has at least `MIN_ISLANDS` (3) islands and
 * `MIN_LAKES` (1) lakes. Each attempt uses `seed + attempt` so the seed space
 * is fully deterministic. Falls back to the 20th attempt if the threshold is
 * never met.
 *
 * @param {Object}   params
 * @param {number}   params.settlements         Target settlement cluster count (size varies).
 * @param {number}   [params.seed]              Integer seed; defaults to `Date.now()`.
 * @param {number}   [params.width]             World width in panels (default {@link DEFAULT_MAP_WIDTH}).
 * @param {number}   [params.height]            World height in panels (default {@link DEFAULT_MAP_HEIGHT}).
 * @param {Array}    [params.lockedSettlements=[]] Pre-placed settlement descriptors.
 * @param {boolean}  [params.secretHalo=true]     Secret halo pockets & access (see Step 19 in `generateFromTerrain`).
 * @returns {{ panelData, width, height, roadPaths, roadWaypoints, panelStats, assignedPanels, terrain, secretHalo }}
 */
export function generateRegion({ settlements, seed, lockedSettlements = [], width, height, secretHalo = true }) {
  const baseSeed = seed || Date.now()
  const mapW = clampMapPanels(width, DEFAULT_MAP_WIDTH)
  const mapH = clampMapPanels(height, DEFAULT_MAP_HEIGHT)
  const MIN_ISLANDS = 3
  const MIN_LAKES = 1

  for (let attempt = 0; attempt < 20; attempt++) {
    const attemptSeed = baseSeed + attempt
    const terrain = generateTerrain(attemptSeed, mapW, mapH)
    const { islandSeeds } = terrain

    let lakeCount = 0
    for (const key in terrain.panelData) {
      if (terrain.panelData[key].grid.some(c => c.type === T.LAKE)) lakeCount++
    }

    if (islandSeeds.length >= MIN_ISLANDS && lakeCount >= MIN_LAKES) {
      const panelData = cloneTerrainPanelData(terrain.panelData)
      // Step 6+ rand: seed derived from terrain seed so it's stable across regenerates
      const rand6 = mulberry32(terrain.seed + 0x80000000)
      const result = generateFromTerrain({ panelData, width: terrain.width, height: terrain.height, islandSeeds, rand: rand6, seed: terrain.seed, settlements, lockedSettlements, secretHalo })
      delete result.islandSeeds
      return { ...result, terrain: { ...terrain, secretHalo }, secretHalo }
    }
  }

  // Fallback: return last attempt even if conditions not met
  const terrain = generateTerrain(baseSeed + 20, mapW, mapH)
  const panelData = cloneTerrainPanelData(terrain.panelData)
  const rand6 = mulberry32(terrain.seed + 0x80000000)
  const fallback = generateFromTerrain({ panelData, width: terrain.width, height: terrain.height, islandSeeds: terrain.islandSeeds, rand: rand6, seed: terrain.seed, settlements, lockedSettlements, secretHalo })
  delete fallback.islandSeeds
  return { ...fallback, terrain: { ...terrain, secretHalo }, secretHalo }
}

/**
 * Re-runs Steps 6–20 on the preserved terrain snapshot inside an existing region.
 *
 * Used after the user places a manual settlement — the terrain stays fixed but
 * settlements, roads, forests, grass, and tile indices are all recomputed from
 * scratch with the new locked list. The `terrain` object from `generateRegion`
 * is required as it stores the deterministic terrain state.
 *
 * @param {Object} params
 * @param {Object} params.terrain             Terrain snapshot (`region.terrain` from `generateRegion`).
 * @param {number} params.settlements         Target settlement cluster count (size varies).
 * @param {Array}  [params.lockedSettlements=[]] Settlement descriptors including the newly placed one.
 * @param {boolean} [params.secretHalo]           Defaults to `terrain.secretHalo` or true.
 * @returns {{ panelData, width, height, roadPaths, roadWaypoints, panelStats, assignedPanels, terrain, secretHalo }}
 */
export function regenerateFromTerrain({ terrain, settlements, lockedSettlements = [], secretHalo }) {
  const { panelData: terrainData, width, height, islandSeeds } = terrain
  const secretHaloOpt = secretHalo !== undefined ? secretHalo : (terrain.secretHalo !== undefined ? terrain.secretHalo : true)
  const panelData = cloneTerrainPanelData(terrainData)
  const rand6 = mulberry32(terrain.seed + 0x80000000)
  const result = generateFromTerrain({ panelData, width, height, islandSeeds, rand: rand6, seed: terrain.seed, settlements, lockedSettlements, secretHalo: secretHaloOpt })
  delete result.islandSeeds
  return { ...result, terrain: { ...terrain, secretHalo: secretHaloOpt }, secretHalo: secretHaloOpt }
}

/**
 * Places a single settlement cluster on an existing region without rerunning the full pipeline.
 *
 * Runs the same BFS cluster growth as `addCluster` in `generateFromTerrain`, but
 * operates directly on the live `region` object. Does NOT recompute roads, forest,
 * grass, or tile indices — call `regenerateFromTerrain` for a full refresh.
 * Uses panel coords as a deterministic sub-seed so placements are reproducible.
 *
 * @param {Object}               region  The region returned by `generateRegion` or `regenerateFromTerrain`.
 * @param {number}               px      Panel X coordinate of the target panel.
 * @param {number}               py      Panel Y coordinate of the target panel.
 * @param {'city'|'town'|'poi'}  type    Settlement label to place (maps to size).
 * @returns {Object} The same `region` object mutated in place (or unchanged if placement is invalid).
 */
export function placeManualSettlement(region, px, py, type) {
  const { panelData, panelStats, assignedPanels, width, height } = region
  const key = `${px},${py}`

  // Must be a valid, unassigned land panel
  const stat = panelStats?.[key]
  if (!stat || !stat.isLand || assignedPanels?.has(key)) return region

  const getDominantElev = (stat) => {
    let best = -1, bestCount = 0
    for (const [e, cnt] of stat.elevCounts ?? []) if (cnt > bestCount) { bestCount = cnt; best = e }
    return best
  }

  const isPanelClear = (px2, py2, currentClusterSet) => {
    const RADIUS = SETTLEMENT_SPACING_RADIUS
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const k = `${px2 + dx},${py2 + dy}`
        if (assignedPanels.has(k) && !currentClusterSet.has(k)) return false
      }
    }
    return true
  }

  // Simple seeded rand — use panel coords as seed for determinism
  const r = mulberry32((px * 1000 + py) ^ 0xdeadbeef)

  const size = type === 'city' ? 'large' : type === 'town' ? 'medium' : 'small'
  const rawGoal = size === 'large' ? 3 + Math.floor(r() * 3) : size === 'medium' ? 2 + Math.floor(r() * 2) : 1 + Math.floor(r() * 2)
  const sizeGoal = Math.max(1, Math.min(SETTLEMENT_MAX_PANELS, rawGoal | 0))
  const clusterDomElev = getDominantElev(stat)
  const clusterIndex = Object.values(panelData).filter(pd => pd.settlement).length

  const cluster = [key]
  const activeCluster = new Set([key])
  assignedPanels.add(key)
  panelData[key].settlement = { kind: 'settlement', size, id: clusterIndex }

  const open = [key]
  while (cluster.length < sizeGoal && open.length > 0) {
    const idx = Math.floor(r() * open.length)
    const currentKey = open.splice(idx, 1)[0]
    const [cpx, cpy] = currentKey.split(',').map(Number)

    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .sort(() => r() - 0.5)
      .map(([dx, dy]) => `${cpx + dx},${cpy + dy}`)

    for (const nk of neighbors) {
      if (cluster.length >= sizeGoal) break
      const st = panelStats[nk]
      if (!st || !st.isLand || assignedPanels.has(nk)) continue
      const [nx, ny] = nk.split(',').map(Number)
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      if (!isPanelClear(nx, ny, activeCluster)) continue
      if (getDominantElev(st) !== clusterDomElev) continue

      assignedPanels.add(nk)
      activeCluster.add(nk)
      open.push(nk)
      cluster.push(nk)
      panelData[nk].settlement = { kind: 'settlement', size, id: clusterIndex }
    }
  }

  return region
}

/**
 * Generates raw elevation data for debugging purposes (no terrain type assignment).
 *
 * Returns the raw `Float32Array` from `generateLandMass` plus map dimensions.
 * Used by development tooling to visualise the elevation field before quantisation.
 *
 * @param {Object} params
 * @param {number} [params.seed] Integer seed; defaults to `Date.now()`.
 * @param {number} [params.width] World width in panels (default {@link DEFAULT_MAP_WIDTH}).
 * @param {number} [params.height] World height in panels (default {@link DEFAULT_MAP_HEIGHT}).
 * @returns {{ elev: Float32Array, W: number, H: number, width: number, height: number }}
 */
export function generateElevDebug({ seed, width, height }) {
  const w = clampMapPanels(width, DEFAULT_MAP_WIDTH)
  const h = clampMapPanels(height, DEFAULT_MAP_HEIGHT)
  const W = w * PANEL, H = h * PANEL
  const rand = mulberry32(seed || Date.now())
  const elev = generateLandMass(rand, W, H)
  return { elev, W, H, width: w, height: h }
}
