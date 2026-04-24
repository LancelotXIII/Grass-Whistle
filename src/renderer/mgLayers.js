/**
 * Map Generator derived layers: `layer1` / `layer2` / `layer3` from `recomputeMapGeneratorTileIndices`.
 * Layout cells keep `type` / `tileIndex` from export; derived layers are in-memory only.
 * **`T.GRASS`** and **`T.CLIFF`** each draw on **`layer1`** only (ground baked into tile art).
 */
import { BIOME_PALETTES, T, PALETTE, PANEL } from './engine/constants.js'

/**
 * Wang tileset grid dimensions. Assets are stored as 5×3 grids (160×96px at 32px/tile).
 * Semantic indices (0–11 from `cliffTileIdx`, 0–12 for road/water) map to grid cells
 * via `wangSemanticToGridIndex` below.
 */
export const MG_WANG_COLS = 5
export const MG_WANG_ROWS = 3
export const MG_WANG_EXPORT_GRID_COLS = 5
export const MG_WANG_EXPORT_GRID_ROWS = 3
export const MG_WANG_EXPORT_BLOCK_W_PX = MG_WANG_EXPORT_GRID_COLS * 32
export const MG_WANG_EXPORT_BLOCK_H_PX = MG_WANG_EXPORT_GRID_ROWS * 32

/** 5×4 `cliff_double` sheet dimensions (see docs/wang_tile_layouts.md). */
export const MG_CLIFF_DOUBLE_COLS = 5
export const MG_CLIFF_DOUBLE_ROWS = 4

/**
 * Semantic index → [p1col, p1row, p2col, p2row] on the 5×4 cliff_double sheet.
 * @type {Readonly<Record<number, readonly [number, number, number|null, number|null]>>}
 */
export const MG_CLIFF_DOUBLE_CD_MAP = Object.freeze({
  0:  [1, 0, null, null],  // N
  1:  [2, 0, null, null],  // NE out
  2:  [2, 1, null, null],  // E
  3:  [2, 2, 2,    3   ],  // SE out
  4:  [1, 2, 1,    3   ],  // S
  5:  [0, 2, 0,    3   ],  // SW out
  6:  [0, 1, null, null],  // W
  7:  [0, 0, null, null],  // NW out
  8:  [4, 2, null, null],  // NW in
  9:  [3, 2, null, null],  // NE in
  10: [4, 0, 4,    1   ],  // SW in
  11: [3, 0, 3,    1   ],  // SE in
  12: [1, 1, null, null],  // Middle
})

/**
 * Semantic Wang index (cliffTileIdx output, 0–12) → grid index in the 5×3 asset.
 * Grid layout:
 *   [ 0:NW out | 1:N     | 2:NE out | 3:SE in  | 4:SW in  ]
 *   [ 5:W      | 6:Fill  | 7:E      | 8:NE in  | 9:NW in  ]
 *   [10:SW out |11:S     |12:SE out |13:unused |14:unused ]
 *
 * semantic → grid index (see docs/wang_tile_layouts.md):
 *   0(N)→1  1(NE out)→2  2(E)→7   3(SE out)→12  4(S)→11
 *   5(SW out)→10  6(W)→5  7(NW out)→0
 *   8(NW in)→9  9(NE in)→8  10(SW in)→4  11(SE in)→3
 *   12(Fill, road/water only)→6
 */
export const MG_WANG_SEMANTIC_TO_GRID = Object.freeze({
  0: 1, 1: 2, 2: 7, 3: 12, 4: 11,
  5: 10, 6: 5, 7: 0, 8: 9, 9: 8,
  10: 4, 11: 3, 12: 6,
})

/**
 * Converts a semantic Wang index to [col, row] in the 5×3 asset grid.
 * Returns null for unmapped indices (e.g. 13, 14 — unused cells).
 * @param {number} semanticIndex
 * @returns {readonly [number, number] | null}
 */
export function wangGridCell(semanticIndex) {
  const gridIdx = MG_WANG_SEMANTIC_TO_GRID[semanticIndex | 0]
  if (gridIdx == null) return null
  return [gridIdx % MG_WANG_COLS, (gridIdx / MG_WANG_COLS) | 0]
}

/**
 * @param {number} wangIndex — semantic index (cliffTileIdx output)
 * @param {string} mappingKey — `GROUND` | `ROAD` | `GRASS` | `WATER` | `CLIFF`
 * @returns {readonly [number, number] | null} `[col, row]` within the 5×3 grid, or `null` if not packed
 */
export function mgWangExportCellForPack(wangIndex, mappingKey) {
  const i = wangIndex | 0
  if (mappingKey === 'CLIFF' && i === 12) return null
  return wangGridCell(i)
}

/** Derived-only layer types for forest (not Layout `type`). */
export const LAYER_TYPE_FOREST_BODY = 'FOREST_BODY'
export const LAYER_TYPE_FOREST_TOP = 'FOREST_TOP'
export const LAYER_TYPE_FOREST_TRUNK = 'FOREST_TRUNK'

/**
 * @param {string} layerType — `T.*` or `LAYER_TYPE_*`
 * @param {Object} mapping
 * @returns {{ assetId?: string, isTileset?: boolean } | null}
 */
export function mgMappingSlotForLayerType(layerType, mapping) {
  if (layerType === T.LAND || layerType === 'GROUND') return mapping.GROUND
  if (layerType === T.ROAD) return mapping.ROAD
  if (layerType === T.GRASS) return mapping.GRASS
  if (layerType === T.OCEAN || layerType === T.LAKE || layerType === T.WATERROAD) return mapping.WATER
  if (layerType === T.CLIFF) return mapping.CLIFF?.assetId ? mapping.CLIFF : null
  if (layerType === LAYER_TYPE_FOREST_TRUNK) {
    if (mapping.FOREST_TRUNK?.assetId) return mapping.FOREST_TRUNK
    return mapping.FOREST || null
  }
  if (layerType === LAYER_TYPE_FOREST_BODY) {
    if (mapping.FOREST_BODY?.assetId) return mapping.FOREST_BODY
    return mapping.FOREST || null
  }
  if (layerType === LAYER_TYPE_FOREST_TOP) {
    if (mapping.FOREST_TOP?.assetId) return mapping.FOREST_TOP
    return mapping.FOREST || null
  }
  return null
}

/**
 * @param {{ type: string, elevation?: number }} cell — layout cell (for land elevation)
 * @param {string} layerType
 * @returns {[number, number, number]}
 */
export function mgLayerFallbackRgb(cell, layerType) {
  const pal = (cell && cell.biome !== undefined && BIOME_PALETTES[cell.biome]) ? BIOME_PALETTES[cell.biome] : PALETTE
  if (layerType === T.LAND) return pal.LAND_LEVELS[cell.elevation] || pal.LAND_LEVELS[1]
  if (
    layerType === T.FOREST ||
    layerType === LAYER_TYPE_FOREST_TRUNK ||
    layerType === LAYER_TYPE_FOREST_BODY ||
    layerType === LAYER_TYPE_FOREST_TOP
  ) {
    return pal[T.FOREST]
  }
  if (layerType === T.GRASS) return pal[T.GRASS]
  if (layerType === T.ROAD) return pal[T.ROAD]
  if (layerType === T.WATERROAD) return pal[T.WATERROAD]
  if (layerType === T.OCEAN) return pal[T.OCEAN]
  if (layerType === T.LAKE) return pal[T.LAKE]
  if (layerType === T.CLIFF) return pal[T.CLIFF]
  return [80, 80, 80]
}

/**
 * @param {number} px
 * @param {number} py
 * @param {number} cx
 * @param {number} cy
 * @param {number} salt
 */
export function mgStableHash(px, py, cx, cy, salt) {
  let x = px * 73856093 ^ py * 19349663 ^ cx * 83492791 ^ cy * 50331653 ^ salt * 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  return x >>> 0
}

/**
 * @param {Array<{ type?: string }>} grid
 * @param {number} panelPx
 * @param {number} panelPy
 * @returns {Array<{ cx: number, cy: number, wide: 1 | 2, variant: number }>}
 */
export function collectForestTreeAnchors(grid, panelPx, panelPy) {
  const list = []
  const covered = new Set()
  const isForest = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= PANEL || cy >= PANEL) return false
    return grid[cy * PANEL + cx]?.type === T.FOREST
  }

  for (let cy = 0; cy < PANEL; cy++) {
    for (let cx = 0; cx < PANEL; cx++) {
      const idx = cy * PANEL + cx
      if (!isForest(cx, cy) || covered.has(idx)) continue
      const hPair = mgStableHash(panelPx, panelPy, cx, cy, 1)
      const pair = isForest(cx + 1, cy) && hPair % 1000 < 700
      if (pair) covered.add(cy * PANEL + (cx + 1))
      const variant = mgStableHash(panelPx, panelPy, cx, cy, 2) % 3
      list.push({ cx, cy, wide: pair ? 2 : 1, variant })
    }
  }
  return list
}

/**
 * Forest is split into 3 stacked 32px bands per tree:
 * - **Top** (sheet row 0) → layer3 (`FOREST_TOP`)
 * - **Body** (sheet row 1) → layer2 (`FOREST_BODY`)
 * - **Trunk** (sheet row 2; global rows 2,5,8) → layer1 (`FOREST_TRUNK`)
 *
 * @param {'trunk'|'body'|'tops'} part
 */
export function drawMgForestPart(ctx, grid, mapping, imgs, cellPx, ox, oy, panelPx, panelPy, part) {
  const anchors = collectForestTreeAnchors(grid, panelPx, panelPy)

  for (const { cx, cy, wide, variant } of anchors) {
    const bi = (grid?.[cy * PANEL + cx]?.biome ?? 0) | 0
    const tb = mapping?.TREE_BY_BIOME ?? null
    const pick = (tb && typeof tb === 'object') ? (tb[bi] ?? tb[0]) : null
    const treeImg = pick ? imgs.get(pick) : null
    if (!treeImg || treeImg.width < 3 || treeImg.height < 3) continue

    const cw = treeImg.width / 3
    const ch = treeImg.height / 3
    const pair = wide === 2
    const sx = pair ? 0 : 2 * cw
    const sy = variant * ch
    const sw = pair ? 2 * cw : cw
    const sh = ch
    const dw = wide === 2 ? 2 * cellPx : cellPx
    const dx = ox + cx * cellPx
    const dy = oy + (cy - 2) * cellPx

    const bandH = sh / 3
    if (part === 'tops') {
      // top band → row cy-2
      ctx.drawImage(treeImg, sx, sy, sw, bandH, dx, dy, dw, cellPx)
    } else if (part === 'body') {
      // middle band → row cy-1
      ctx.drawImage(treeImg, sx, sy + bandH, sw, bandH, dx, dy + cellPx, dw, cellPx)
    } else {
      // trunk band → row cy
      ctx.drawImage(treeImg, sx, sy + 2 * bandH, sw, bandH, dx, dy + 2 * cellPx, dw, cellPx)
    }
  }
}

/**
 * @param {string} layerType
 * @returns {boolean}
 */
export function isForestOverlayLayerType(layerType) {
  return (
    layerType === LAYER_TYPE_FOREST_TRUNK ||
    layerType === LAYER_TYPE_FOREST_BODY ||
    layerType === LAYER_TYPE_FOREST_TOP
  )
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ type: string, tileIndex?: number }} layer
 * @param {{ type: string, elevation?: number }} cell
 * @param {Object} mapping
 * @param {Map<string, HTMLImageElement>} imgs
 * @param {number} dx
 * @param {number} dy
 * @param {number} cs
 */
export function drawMgOneLayer(ctx, layer, cell, mapping, imgs, dx, dy, cs) {
  if (isForestOverlayLayerType(layer.type)) return

  const isGround = layer.type === T.LAND || layer.type === 'GROUND'
  const slot = isGround ? null : mgMappingSlotForLayerType(layer.type, mapping)
  let assetId = slot?.assetId

  // Composite cliff: low-biome ground underlay, high-biome cliff overlay.
  if (layer.type === T.CLIFF) {
    const tiRaw = layer.tileIndex ?? 0
    const ti = Number.isFinite(tiRaw) ? (tiRaw | 0) : 0
    const hi = Number.isFinite(layer?.biomeHigh) ? (layer.biomeHigh | 0) : ((cell?.biome ?? 0) | 0)
    const lo = Number.isFinite(layer?.biomeLow) ? (layer.biomeLow | 0) : ((cell?.biome ?? 0) | 0)
    const gb = mapping?.GROUND_BY_BIOME ?? null
    const groundId = (gb && typeof gb === 'object') ? (gb[lo] ?? gb[0]) : null
    const groundImg = groundId ? imgs.get(groundId) : null

    const cliffSlot = mgMappingSlotForLayerType(T.CLIFF, mapping)
    const cb = mapping?.CLIFF_BY_BIOME ?? null
    const cliffId =
      (cb && typeof cb === 'object' ? (cb[hi] ?? cb[0]) : null) ||
      cliffSlot?.assetId ||
      null
    const cliffImg = cliffId ? imgs.get(cliffId) : null

    if (groundImg && cliffImg && cliffSlot?.isTileset) {
      // Underlay (downhill ground biome)
      ctx.drawImage(groundImg, 0, 0, groundImg.width, groundImg.height, dx, dy, cs, cs)
      const tw = cliffImg.width / MG_WANG_COLS
      const th = cliffImg.height / MG_WANG_ROWS
      const cell = wangGridCell(ti)
      if (cell) {
        const [col, row] = cell
        ctx.drawImage(cliffImg, col * tw, row * th, tw, th, dx, dy, cs, cs)
      }
      return
    }
    // Fallback: continue with normal CLIFF rendering below (biome strip / solid fill).
  }

  // CLIFF_DOUBLE: 5×4 sheet — semantic→grid mapping; see docs/wang_tile_layouts.md and MG_CLIFF_DOUBLE_CD_MAP.
  // Row 0–2 = top tiles (P1), row 3 col 0-2 = SW/S/SE out P2, row 1 col 3-4 = NW/NE in P2.
  if (layer.type === T.CLIFF_DOUBLE || layer.type === T.CLIFF_DOUBLE_PART2) {
    const tiRaw = layer.tileIndex ?? 0
    const ti = Number.isFinite(tiRaw) ? (tiRaw | 0) : 0
    const lo = Number.isFinite(layer?.biomeLow) ? (layer.biomeLow | 0) : ((cell?.biome ?? 0) | 0)
    const hi = Number.isFinite(layer?.biomeHigh) ? (layer.biomeHigh | 0) : ((cell?.biome ?? 0) | 0)

    const gb = mapping?.GROUND_BY_BIOME ?? null
    const groundId = (gb && typeof gb === 'object') ? (gb[lo] ?? gb[0]) : null
    const groundImg = groundId ? imgs.get(groundId) : null

    const cdb = mapping?.CLIFF_DOUBLE_BY_BIOME ?? null
    const cdId = (cdb && typeof cdb === 'object') ? (cdb[hi] ?? cdb[0]) : null
    const cdImg = cdId ? imgs.get(cdId) : null

    if (groundImg) ctx.drawImage(groundImg, 0, 0, groundImg.width, groundImg.height, dx, dy, cs, cs)

    if (cdImg) {
      const tw = cdImg.width / MG_CLIFF_DOUBLE_COLS
      const th = cdImg.height / MG_CLIFF_DOUBLE_ROWS
      const entry = MG_CLIFF_DOUBLE_CD_MAP[ti]
      if (entry) {
        if (layer.type === T.CLIFF_DOUBLE) {
          const [col, row] = entry
          ctx.drawImage(cdImg, col * tw, row * th, tw, th, dx, dy, cs, cs)
        } else {
          const [, , p2col, p2row] = entry
          if (p2col != null) ctx.drawImage(cdImg, p2col * tw, p2row * th, tw, th, dx, dy, cs, cs)
        }
      }
    } else {
      const [r, g, b] = mgLayerFallbackRgb(cell, T.CLIFF)
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(dx, dy, cs, cs)
    }
    return
  }

  // Biome-specific road wang strips (preferred over global ROAD mapping).
  if (layer.type === T.ROAD) {
    const bi = (cell?.biome ?? 0) | 0
    const rb = mapping?.ROAD_BY_BIOME ?? null
    const pick = (rb && typeof rb === 'object') ? (rb[bi] ?? rb[0]) : null
    if (pick) assetId = pick
  }
  // Biome-specific grass wang strips.
  if (layer.type === T.GRASS) {
    const bi = (cell?.biome ?? 0) | 0
    const gb = mapping?.GRASS_BY_BIOME ?? null
    const pick = (gb && typeof gb === 'object') ? (gb[bi] ?? gb[0]) : null
    if (pick) assetId = pick
  }
  // Biome-specific water wang strips.
  if (layer.type === T.OCEAN || layer.type === T.LAKE || layer.type === T.WATERROAD) {
    const bi = (cell?.biome ?? 0) | 0
    const wb = mapping?.WATER_BY_BIOME ?? null
    const pick = (wb && typeof wb === 'object') ? (wb[bi] ?? wb[0]) : null
    if (pick) assetId = pick
  }
  // Biome-specific cliff wang strips.
  if (layer.type === T.CLIFF) {
    const bi = (cell?.biome ?? 0) | 0
    const cb = mapping?.CLIFF_BY_BIOME ?? null
    const pick = (cb && typeof cb === 'object') ? (cb[bi] ?? cb[0]) : null
    if (pick) assetId = pick
  }
  const img = assetId ? imgs.get(assetId) : null
  const useTileset = slot?.isTileset && layer.tileIndex !== undefined
  const [r, g, b] = mgLayerFallbackRgb(cell, layer.type)

  if (isGround) {
    const bi = (cell?.biome ?? 0) | 0
    const gb = mapping?.GROUND_BY_BIOME ?? null
    const pick = (gb && typeof gb === 'object') ? (gb[bi] ?? gb[0]) : null
    const groundImg = pick ? imgs.get(pick) : null
    if (!groundImg) {
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(dx, dy, cs, cs)
      return
    }
    ctx.drawImage(groundImg, 0, 0, groundImg.width, groundImg.height, dx, dy, cs, cs)
    return
  }

  if (!img) {
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(dx, dy, cs, cs)
    return
  }

  if (useTileset) {
    const tw = img.width / MG_WANG_COLS
    const th = img.height / MG_WANG_ROWS
    const cell = wangGridCell(layer.tileIndex | 0)
    if (cell) {
      const [col, row] = cell
      ctx.drawImage(img, col * tw, row * th, tw, th, dx, dy, cs, cs)
    }
  } else {
    ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, cs, cs)
  }
}

/**
 * Draws derived Map Generator layers (ground/road/water/grass/cliff on `layer1`; forest body/top on `layer2`/`layer3` for anchors). Forest body/tops are also drawn in a panel pass.
 * Falls back to legacy single-pass drawing when `layer1` is absent (e.g. before recompute).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} cell
 * @param {Object} mapping
 * @param {Map<string, HTMLImageElement>} imgs
 * @param {number} dx
 * @param {number} dy
 * @param {number} cs
 */
export function drawMgCellLayers(ctx, cell, mapping, imgs, dx, dy, cs) {
  if (cell.layer1) {
    drawMgOneLayer(ctx, cell.layer1, cell, mapping, imgs, dx, dy, cs)
    if (cell.layer2) drawMgOneLayer(ctx, cell.layer2, cell, mapping, imgs, dx, dy, cs)
    if (cell.layer3) drawMgOneLayer(ctx, cell.layer3, cell, mapping, imgs, dx, dy, cs)
    return
  }

  const t = cell.type
  const legacyLayer = { type: t, tileIndex: cell.tileIndex }
  if (t === T.FOREST) {
    drawMgOneLayer(ctx, { type: T.LAND, tileIndex: cell.tileIndex }, cell, mapping, imgs, dx, dy, cs)
    return
  }
  drawMgOneLayer(ctx, legacyLayer, cell, mapping, imgs, dx, dy, cs)
}
