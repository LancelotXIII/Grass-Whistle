/**
 * Map Generator derived layers: `layer1` / `layer2` / `layer3` from `recomputeMapGeneratorTileIndices`.
 * Layout cells keep `type` / `tileIndex` from export; derived layers are in-memory only.
 * **`T.GRASS`** and **`T.CLIFF`** each draw on **`layer1`** only (ground baked into tile art).
 */
import { BIOME_PALETTES, T, PALETTE, PANEL } from './engine/constants.js'

/** Wang strip columns (must match Map Generator overlay / App.jsx). */
export const MG_WANG_COLS = 13

/**
 * Export-only: packed tileset atlas places each Wang strip in a **5×3** grid of 32×32 cells (160×96 px per strip).
 * Unused bottom rows of a full 5×5 are omitted to save atlas space. Indices 0–11 use fixed cells; index 12 uses (1,1) on non-cliff strips. Cliff strips omit 12.
 * See `docs/FILE_FORMATS.md` (Render bundle → Wang export grid).
 */
export const MG_WANG_EXPORT_GRID_COLS = 5
export const MG_WANG_EXPORT_GRID_ROWS = 3
export const MG_WANG_EXPORT_BLOCK_W_PX = MG_WANG_EXPORT_GRID_COLS * 32
export const MG_WANG_EXPORT_BLOCK_H_PX = MG_WANG_EXPORT_GRID_ROWS * 32

/**
 * Strip index → [col, row] in the 5×3 export grid (see `docs/FILE_FORMATS.md` ASCII diagram).
 * Index 12 is not listed here; it is always `(1,1)` for non-cliff strips via `mgWangExportCellForPack`.
 */
export const MG_WANG_EXPORT_INDEX_TO_CELL = Object.freeze({
  0: [1, 0],
  1: [2, 0],
  2: [2, 1],
  3: [2, 2],
  4: [1, 2],
  5: [0, 2],
  6: [0, 1],
  7: [0, 0],
  8: [4, 1],
  9: [3, 1],
  10: [4, 0],
  11: [3, 0],
})

/**
 * @param {number} wangIndex
 * @param {string} mappingKey — `GROUND` | `ROAD` | `GRASS` | `WATER` | `CLIFF`
 * @returns {readonly [number, number] | null} `[col, row]` within the export grid, or `null` if not packed (cliff + index 12)
 */
export function mgWangExportCellForPack(wangIndex, mappingKey) {
  const i = wangIndex | 0
  if (mappingKey === 'CLIFF' && i === 12) return null
  if (i === 12) return [1, 1]
  const c = MG_WANG_EXPORT_INDEX_TO_CELL[i]
  return c ?? null
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

  // Composite cliffs in preview (match export-time compositing).
  // Draw uphill (top-side) biome ground first, then draw CLIFF overlay tile on top.
  if (layer.type === T.CLIFF) {
    const tiRaw = layer.tileIndex ?? 0
    const ti = Number.isFinite(tiRaw) ? (tiRaw | 0) : 0
    const hi = Number.isFinite(layer?.biomeHigh) ? (layer.biomeHigh | 0) : ((cell?.biome ?? 0) | 0)
    const lo = Number.isFinite(layer?.biomeLow) ? (layer.biomeLow | 0) : ((cell?.biome ?? 0) | 0)
    const gb = mapping?.GROUND_BY_BIOME ?? null
    const groundId = (gb && typeof gb === 'object') ? (gb[hi] ?? gb[0]) : null
    const groundImg = groundId ? imgs.get(groundId) : null

    const cliffSlot = mgMappingSlotForLayerType(T.CLIFF, mapping)
    // Overlay strip should match the downhill biome (cliff face lives in the lower area).
    const cb = mapping?.CLIFF_BY_BIOME ?? null
    const cliffId =
      (cb && typeof cb === 'object' ? (cb[lo] ?? cb[0]) : null) ||
      cliffSlot?.assetId ||
      null
    const cliffImg = cliffId ? imgs.get(cliffId) : null

    if (groundImg && cliffImg && cliffSlot?.isTileset) {
      // Underlay (downhill ground biome)
      ctx.drawImage(groundImg, 0, 0, groundImg.width, groundImg.height, dx, dy, cs, cs)

      // Overlay (cliff strip tile)
      const cols = MG_WANG_COLS
      const rows = 1
      const tw = cliffImg.width / cols
      const th = cliffImg.height / rows
      const tiClamped = Math.min(Math.max(0, ti), cols * rows - 1)
      const sx = (tiClamped % cols) * tw
      const sy = Math.floor(tiClamped / cols) * th
      ctx.drawImage(cliffImg, sx, sy, tw, th, dx, dy, cs, cs)
      return
    }
    // Fallback: continue with normal CLIFF rendering below (biome strip / solid fill).
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
    const cols = MG_WANG_COLS
    const rows = 1
    const tw = img.width / cols
    const th = img.height / rows
    const ti = Math.min(Math.max(0, layer.tileIndex | 0), cols * rows - 1)
    const sx = (ti % cols) * tw
    const sy = Math.floor(ti / cols) * th
    ctx.drawImage(img, sx, sy, tw, th, dx, dy, cs, cs)
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
