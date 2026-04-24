import JSZip from 'jszip'
import { BIOME_NAMES, PANEL, T } from '../engine/constants.js'
import { dir12 } from '../engine/tiling.js'
import { mgCanvasColors } from '../render/regionRender.js'
import {
  drawMgCellLayers,
  drawMgForestPart,
  LAYER_TYPE_FOREST_BODY,
  LAYER_TYPE_FOREST_TOP,
  LAYER_TYPE_FOREST_TRUNK,
  collectForestTreeAnchors,
} from '../mgLayers.js'
import {
  packMgTileset,
  rmTileIdForDerivedLayer,
  serializedConversionTableFromLookup,
  RM_STATIC_TILE_ID_BASE,
  MG_PLACEHOLDER_ASSET_ID,
  getForestSheetMetrics,
  buildForestRmStampList,
} from '../mgTilesetPack.js'

/** Pixels per cell for on-screen stitched preview. */
export const MG_PREVIEW_CELL_PX = 4

/** Pixels per game cell for "Download full" (matches typical layout export scale). */
export const MG_FULL_EXPORT_CELL_PX = 32

/** Max canvas width/height for a single on-screen preview (browser/GPU allocation limits). */
export const MG_CANVAS_SAFE_MAX_DIM = 16384

/** Full-export is split into tiles at most this many pixels wide/tall so each PNG encodes reliably. */
export const MG_EXPORT_CHUNK_PX = 8192

/**
 * Encode a canvas to PNG bytes. Prefer over `toDataURL` for large surfaces (avoids huge base64 strings).
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
function mgCanvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('PNG encode failed — canvas may be too large for this GPU/browser.'))
          return
        }
        resolve(blob)
      },
      'image/png'
    )
  })
}

/**
 * Trigger a single file download from a `Blob` (e.g. ZIP or PNG).
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<void>}
 */
function mgDownloadBlob(blob, filename) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => {
      URL.revokeObjectURL(url)
      resolve()
    }, 500)
  })
}

/**
 * Download a canvas as PNG via `Blob` + object URL.
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 * @returns {Promise<void>}
 */
function mgDownloadCanvasPng(canvas, filename) {
  return mgCanvasToPngBlob(canvas).then((blob) => mgDownloadBlob(blob, filename))
}

/**
 * Cell at global world coordinates (integer cell index), using `panelMap` for cross-panel Wang continuity.
 * @param {Map<string, Array>} panelMap keys `"px,py"` → grid
 * @param {number} wx world X in cells
 * @param {number} wy world Y in cells
 */
function mgWorldCell(panelMap, wx, wy) {
  const px = Math.floor(wx / PANEL)
  const py = Math.floor(wy / PANEL)
  const cx = wx - px * PANEL
  const cy = wy - py * PANEL
  if (cx < 0 || cy < 0 || cx >= PANEL || cy >= PANEL) return null
  const g = panelMap.get(`${px},${py}`)
  if (!g) return null
  return g[cy * PANEL + cx]
}



/**
 * @param {'land'|'road'|'water'|'grass'} layer
 * @param {string|undefined} t cell.type
 */
function mgLayerBit(layer, t) {
  if (!t) return false
  if (layer === 'land') {
    return t === T.LAND || t === T.FOREST || t === T.ROAD || t === T.CLIFF || t === T.CLIFF_DOUBLE || t === T.CLIFF_DOUBLE_PART2 || t === T.GRASS
  }
  if (layer === 'road') return t === T.ROAD
  if (layer === 'water') return t === T.OCEAN || t === T.LAKE || t === T.WATERROAD
  if (layer === 'grass') return t === T.GRASS
  return false
}

/**
 * Builds a (PANEL+2)² bitmap with a 1-cell halo from adjacent panels so `dir12` matches world topology.
 */
function buildMgExtendedLayerBmp(px, py, panelMap, layer) {
  const ext = PANEL + 2
  const bmp = new Uint8Array(ext * ext)
  for (let ey = 0; ey < ext; ey++) {
    for (let ex = 0; ex < ext; ex++) {
      const wx = px * PANEL + ex - 1
      const wy = py * PANEL + ey - 1
      const cell = mgWorldCell(panelMap, wx, wy)
      bmp[ey * ext + ex] = mgLayerBit(layer, cell?.type) ? 1 : 0
    }
  }
  return bmp
}

function assignDerivedMapGeneratorLayers(
  grid,
  i,
  roadBmp,
  landBmp,
  waterBmp,
  grassBmp,
  lx,
  ly,
  w,
  forestRmByCell,
  panelMap,
  worldX0,
  worldY0
) {
  const c = grid[i]
  const t = c.type
  const roadTi = t === T.ROAD ? dir12(roadBmp, lx, ly, w) : undefined
  const landTi =
    t === T.LAND || t === T.FOREST ? dir12(landBmp, lx, ly, w) : undefined
  const waterTi =
    t === T.OCEAN || t === T.LAKE || t === T.WATERROAD ? dir12(waterBmp, lx, ly, w) : undefined
  const grassTi = t === T.GRASS ? dir12(grassBmp, lx, ly, w) : undefined

  delete c.layer1
  delete c.layer2
  delete c.layer3

  if (t === T.ROAD) {
    c.layer1 = { type: T.ROAD, tileIndex: roadTi, biome: c.biome ?? 0 }
    c.tileIndex = roadTi
  } else if (t === T.OCEAN || t === T.LAKE || t === T.WATERROAD) {
    c.layer1 = { type: t, tileIndex: waterTi, biome: c.biome ?? 0 }
    c.tileIndex = waterTi
  } else if (t === T.LAND) {
    c.layer1 = { type: T.LAND, tileIndex: landTi, biome: c.biome ?? 0 }
    c.tileIndex = landTi
  } else if (t === T.GRASS) {
    c.layer1 = { type: T.GRASS, tileIndex: grassTi, biome: c.biome ?? 0 }
    c.tileIndex = grassTi
  } else if (t === T.FOREST) {
    const ft = forestRmByCell?.get(i)
    const forestBiome = c.biome ?? 0
    if (ft !== undefined) {
      c.layer1 = { type: LAYER_TYPE_FOREST_TRUNK, tileIndex: ft, biome: forestBiome }
      c.layer2 = { type: LAYER_TYPE_FOREST_BODY, tileIndex: ft, biome: forestBiome }
      c.layer3 = { type: LAYER_TYPE_FOREST_TOP, tileIndex: ft, biome: forestBiome }
    } else {
      c.layer1 = { type: T.LAND, tileIndex: landTi, biome: c.biome ?? 0 }
      delete c.layer2
      delete c.layer3
    }
    c.tileIndex = landTi
  } else if (t === T.CLIFF || t === T.CLIFF_DOUBLE || t === T.CLIFF_DOUBLE_PART2) {
    const biomeHigh = c.biome ?? 0
    let biomeLow = c.biome ?? 0
    if (panelMap && worldX0 != null && worldY0 != null) {
      const wx = worldX0 + (i % PANEL)
      const wy = worldY0 + ((i / PANEL) | 0)
      let lowestElev = Infinity
      for (const [ddx, ddy] of [[0,1],[1,0],[-1,0],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const nb = mgWorldCell(panelMap, wx + ddx, wy + ddy)
        if (!nb || nb.biome == null) continue
        const nbT = nb.type
        if (nbT === T.CLIFF || nbT === T.CLIFF_DOUBLE || nbT === T.CLIFF_DOUBLE_PART2) continue
        const elev = nb.elevation ?? 0
        if (elev < lowestElev) { lowestElev = elev; biomeLow = nb.biome }
      }
    }
    c.layer1 = { type: t, tileIndex: c.tileIndex, biomeHigh, biomeLow }
  } else {
    c.tileIndex = 15
  }
}

/**
 * Recomputes `tileIndex` for every cell in a Map Generator panel grid.
 */
export function recomputeMapGeneratorTileIndices(grid, context) {
  const sz = PANEL * PANEL
  const panelPx = context?.px ?? 0
  const panelPy = context?.py ?? 0
  const forestRmByCell = new Map()
  for (const a of collectForestTreeAnchors(grid, panelPx, panelPy)) {
    const ti = a.wide === 2 ? a.variant * 2 : a.variant * 2 + 1
    forestRmByCell.set(a.cy * PANEL + a.cx, ti)
  }

  if (!context?.panelMap || context.px === undefined || context.py === undefined) {
    const landBmp = new Uint8Array(sz)
    const roadBmp = new Uint8Array(sz)
    const waterBmp = new Uint8Array(sz)
    const grassBmp = new Uint8Array(sz)
    for (let i = 0; i < sz; i++) {
      const t = grid[i]?.type
      if (t === 'LAND' || t === 'FOREST' || t === 'ROAD' || t === 'CLIFF' || t === 'CLIFF_DOUBLE' || t === 'CLIFF_DOUBLE_PART2' || t === 'GRASS') landBmp[i] = 1
      if (t === 'ROAD') roadBmp[i] = 1
      if (t === 'OCEAN' || t === 'LAKE' || t === 'WATERROAD') waterBmp[i] = 1
      if (t === 'GRASS') grassBmp[i] = 1
    }
    for (let i = 0; i < sz; i++) {
      const cx = i % PANEL
      const cy = Math.floor(i / PANEL)
      assignDerivedMapGeneratorLayers(
        grid,
        i,
        roadBmp,
        landBmp,
        waterBmp,
        grassBmp,
        cx,
        cy,
        PANEL,
        forestRmByCell,
        null,
        null,
        null
      )
    }
    return
  }

  const { px, py, panelMap } = context
  const map = new Map(panelMap)
  map.set(`${px},${py}`, grid)

  const ext = PANEL + 2
  const landExt = buildMgExtendedLayerBmp(px, py, map, 'land')
  const roadExt = buildMgExtendedLayerBmp(px, py, map, 'road')
  const waterExt = buildMgExtendedLayerBmp(px, py, map, 'water')
  const grassExt = buildMgExtendedLayerBmp(px, py, map, 'grass')

  for (let i = 0; i < sz; i++) {
    const cx = i % PANEL
    const cy = Math.floor(i / PANEL)
    const lx = cx + 1
    const ly = cy + 1
    assignDerivedMapGeneratorLayers(
      grid,
      i,
      roadExt,
      landExt,
      waterExt,
      grassExt,
      lx,
      ly,
      ext,
      forestRmByCell,
      map,
      px * PANEL,
      py * PANEL
    )
  }
}

/** @param {string} src data URL or image URL */
function loadImageUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = src
  })
}

async function preloadMgAssetImages(mapping, assets, defaultAssets) {
  const merged = { ...defaultAssets, ...assets }
  const ids = new Set()
  // Load per-biome ground variants (required) + other mapping slots.
  if (mapping?.GROUND_BY_BIOME && typeof mapping.GROUND_BY_BIOME === 'object') {
    for (const id of Object.values(mapping.GROUND_BY_BIOME)) {
      if (id && merged[id]) ids.add(id)
    }
  }
  // Load per-biome tree variants (used by forest overlay parts).
  if (mapping?.TREE_BY_BIOME && typeof mapping.TREE_BY_BIOME === 'object') {
    for (const id of Object.values(mapping.TREE_BY_BIOME)) {
      if (id && merged[id]) ids.add(id)
    }
  }
  // Load per-biome road variants (wang strips).
  if (mapping?.ROAD_BY_BIOME && typeof mapping.ROAD_BY_BIOME === 'object') {
    for (const id of Object.values(mapping.ROAD_BY_BIOME)) {
      if (id && merged[id]) ids.add(id)
    }
  }
  // Load per-biome grass variants (wang strips).
  if (mapping?.GRASS_BY_BIOME && typeof mapping.GRASS_BY_BIOME === 'object') {
    for (const id of Object.values(mapping.GRASS_BY_BIOME)) {
      if (id && merged[id]) ids.add(id)
    }
  }
  // Load per-biome water variants (wang strips).
  if (mapping?.WATER_BY_BIOME && typeof mapping.WATER_BY_BIOME === 'object') {
    for (const id of Object.values(mapping.WATER_BY_BIOME)) {
      if (id && merged[id]) ids.add(id)
    }
  }
  // Load per-biome cliff variants (wang strips).
  if (mapping?.CLIFF_BY_BIOME && typeof mapping.CLIFF_BY_BIOME === 'object') {
    for (const id of Object.values(mapping.CLIFF_BY_BIOME)) {
      if (id && merged[id]) ids.add(id)
    }
  }
  if (mapping?.CLIFF_DOUBLE_BY_BIOME && typeof mapping.CLIFF_DOUBLE_BY_BIOME === 'object') {
    for (const id of Object.values(mapping.CLIFF_DOUBLE_BY_BIOME)) {
      if (id && merged[id]) ids.add(id)
    }
  }
  for (const key of ['ROAD', 'FOREST', 'FOREST_BODY', 'FOREST_TOP', 'GRASS', 'WATER', 'CLIFF']) {
    const id = mapping[key]?.assetId
    if (id && merged[id]) ids.add(id)
  }
  const map = new Map()
  await Promise.all(
    [...ids].map(async (id) => {
      map.set(id, await loadImageUrl(merged[id]))
    })
  )
  const placeholderUrl = merged[MG_PLACEHOLDER_ASSET_ID]
  if (placeholderUrl) {
    try {
      map.set(MG_PLACEHOLDER_ASSET_ID, await loadImageUrl(placeholderUrl))
    } catch {
      /* optional placeholder missing or invalid */
    }
  }
  return map
}

function drawMgMappedCell(ctx, cell, mapping, imgs, dx, dy, cs) {
  drawMgCellLayers(ctx, cell, mapping, imgs, dx, dy, cs)
}

async function mgPrepareMosaicData({ project, mapping, assets, defaultAssets, cellPx: requestedCellPx, onProgress }) {
  const metaW = project.metadata.width
  const metaH = project.metadata.height
  let gw = metaW
  let gh = metaH
  for (const p of project.panels) {
    gw = Math.max(gw, p.x + 1)
    gh = Math.max(gh, p.y + 1)
  }
  const cellPx = Math.max(1, Math.min(MG_FULL_EXPORT_CELL_PX, requestedCellPx | 0))

  const imgs = await preloadMgAssetImages(mapping, assets, defaultAssets)
  const list = [...project.panels].sort((a, b) => a.y - b.y || a.x - b.x)
  const panelMap = new Map()

  let i = 0
  for (const p of list) {
    onProgress?.(i, list.length)
    const res = await window.electronAPI.loadPanelData(project.path, p.x, p.y)
    i++
    if (!res.success) continue
    panelMap.set(`${p.x},${p.y}`, res.data.grid)
    await new Promise((r) => requestAnimationFrame(r))
  }

  onProgress?.(list.length, list.length)

  for (const p of list) {
    const grid = panelMap.get(`${p.x},${p.y}`)
    if (!grid) continue
    recomputeMapGeneratorTileIndices(grid, { px: p.x, py: p.y, panelMap })
  }

  return { panelMap, list, gw, gh, cellPx, imgs }
}

function mgRenderMosaicWorldRect(panelMap, list, mapping, imgs, cellPx, sx, sy, cw, ch) {
  const CTP = mgCanvasColors()
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create canvas context.')
  ctx.imageSmoothingEnabled = false
  ctx.save()
  ctx.translate(-sx, -sy)
  ctx.beginPath()
  ctx.rect(sx, sy, cw, ch)
  ctx.clip()
  ctx.fillStyle = CTP.crust
  ctx.fillRect(sx, sy, cw, ch)

  for (const p of list) {
    const grid = panelMap.get(`${p.x},${p.y}`)
    if (!grid) continue
    const ox = p.x * PANEL * cellPx
    const oy = p.y * PANEL * cellPx
    for (let c = 0; c < PANEL * PANEL; c++) {
      const cx = c % PANEL
      const cy = Math.floor(c / PANEL)
      drawMgMappedCell(ctx, grid[c], mapping, imgs, ox + cx * cellPx, oy + cy * cellPx, cellPx)
    }
  }
  for (const p of list) {
    const grid = panelMap.get(`${p.x},${p.y}`)
    if (!grid) continue
    const ox = p.x * PANEL * cellPx
    const oy = p.y * PANEL * cellPx
    drawMgForestPart(ctx, grid, mapping, imgs, cellPx, ox, oy, p.x, p.y, 'trunk')
    drawMgForestPart(ctx, grid, mapping, imgs, cellPx, ox, oy, p.x, p.y, 'body')
  }
  for (const p of list) {
    const grid = panelMap.get(`${p.x},${p.y}`)
    if (!grid) continue
    const ox = p.x * PANEL * cellPx
    const oy = p.y * PANEL * cellPx
    drawMgForestPart(ctx, grid, mapping, imgs, cellPx, ox, oy, p.x, p.y, 'tops')
  }
  ctx.restore()
  return canvas
}

export async function buildMgMosaicCanvas({ project, mapping, assets, defaultAssets, cellPx: requestedCellPx, onProgress }) {
  const prepared = await mgPrepareMosaicData({ project, mapping, assets, defaultAssets, cellPx: requestedCellPx, onProgress })
  const { panelMap, list, gw, gh, cellPx, imgs } = prepared
  const W = gw * PANEL * cellPx
  const H = gh * PANEL * cellPx
  if (W > MG_CANVAS_SAFE_MAX_DIM || H > MG_CANVAS_SAFE_MAX_DIM) {
    throw new Error(
      `Preview would be ${W}×${H}px (safe max ${MG_CANVAS_SAFE_MAX_DIM}px per side). Use Download PNG for tiled export.`
    )
  }
  const canvas = mgRenderMosaicWorldRect(panelMap, list, mapping, imgs, cellPx, 0, 0, W, H)
  return { canvas, cellPx, gw, gh, panelCount: list.length }
}

export async function mgExportFullMosaicChunked({ project, mapping, assets, defaultAssets, onProgress }) {
  const cellPx = MG_FULL_EXPORT_CELL_PX
  const prepared = await mgPrepareMosaicData({
    project,
    mapping,
    assets,
    defaultAssets,
    cellPx,
    onProgress: (cur, total) => onProgress?.({ phase: 'load', cur, total }),
  })
  const { panelMap, list, gw, gh, imgs } = prepared

  const W = gw * PANEL * cellPx
  const H = gh * PANEL * cellPx
  const chunksX = Math.ceil(W / MG_EXPORT_CHUNK_PX)
  const chunksY = Math.ceil(H / MG_EXPORT_CHUNK_PX)
  const totalTiles = chunksX * chunksY
  const base = `${project.metadata?.title || 'world'}_assets_mosaic_${cellPx}px`

  if (totalTiles === 1) {
    onProgress?.({ phase: 'tiles', cur: 0, total: 1 })
    const canvas = mgRenderMosaicWorldRect(panelMap, list, mapping, imgs, cellPx, 0, 0, W, H)
    await mgDownloadCanvasPng(canvas, `${base}.png`)
    return { tileCount: 1, gw, gh, cellPx, W, H, zipped: false, downloadName: `${base}.png` }
  }

  const zip = new JSZip()
  let idx = 0
  for (let yi = 0; yi < chunksY; yi++) {
    for (let xi = 0; xi < chunksX; xi++) {
      const sx = xi * MG_EXPORT_CHUNK_PX
      const sy = yi * MG_EXPORT_CHUNK_PX
      const cw = Math.min(MG_EXPORT_CHUNK_PX, W - sx)
      const ch = Math.min(MG_EXPORT_CHUNK_PX, H - sy)
      onProgress?.({ phase: 'tiles', cur: idx, total: totalTiles })
      const canvas = mgRenderMosaicWorldRect(panelMap, list, mapping, imgs, cellPx, sx, sy, cw, ch)
      const filename = `${base}_x${sx}_y${sy}.png`
      const blob = await mgCanvasToPngBlob(canvas)
      zip.file(filename, blob)
      idx++
    }
  }

  const zipName = `${base}_mosaic_tiles.zip`
  onProgress?.({ phase: 'zip', cur: 0, total: 1 })
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  await mgDownloadBlob(zipBlob, zipName)

  return { tileCount: totalTiles, gw, gh, cellPx, W, H, zipped: true, downloadName: zipName }
}

/**
 * @param {Map<string, number>} rmLookup — frozen key→id map from {@link packMgTileset} for this panel's atlas.
 */
function serializeMgRenderCell(cell, rmLookup, forestMetrics) {
  const enrich = (layer) => {
    if (!layer) return null
    const rmTileId = rmTileIdForDerivedLayer(layer, rmLookup)
    return { ...layer, rmTileId }
  }
  const ftRaw = cell.layer2?.tileIndex
  const ft =
    typeof ftRaw === 'number' && Number.isFinite(ftRaw)
      ? ftRaw | 0
      : ftRaw != null && String(ftRaw).trim() !== '' && Number.isFinite(Number(ftRaw))
        ? Number(ftRaw) | 0
        : NaN
  const isForestAnchor =
    forestMetrics &&
    cell.layer1?.type === LAYER_TYPE_FOREST_TRUNK &&
    cell.layer2?.type === LAYER_TYPE_FOREST_BODY &&
    cell.layer3?.type === LAYER_TYPE_FOREST_TOP &&
    Number.isFinite(ft)

  if (isForestAnchor) {
    const treeBiome =
      (Number.isFinite(cell.biome) ? cell.biome : null) ??
      (Number.isFinite(cell.layer2?.biome) ? cell.layer2.biome : null) ??
      0
    const forestRmStamp = buildForestRmStampList(ft, rmLookup, forestMetrics.cw, forestMetrics.ch, treeBiome | 0)
    return {
      type: cell.type,
      elevation: cell.elevation,
      tileIndex: cell.tileIndex,
      layer1: cell.layer1 ? { ...cell.layer1, rmTileId: null } : null,
      layer2: cell.layer2 ? { ...cell.layer2, rmTileId: null } : null,
      layer3: cell.layer3 ? { ...cell.layer3, rmTileId: null } : null,
      forestRmStamp,
    }
  }

  return {
    type: cell.type,
    elevation: cell.elevation,
    tileIndex: cell.tileIndex,
    layer1: enrich(cell.layer1),
    layer2: enrich(cell.layer2),
    layer3: enrich(cell.layer3),
  }
}

/**
 * Scans recomputed panel grids for terrain/biome pairs so the tileset atlas can omit unused `*_BY_BIOME` rows.
 * @param {Map<string, Array>} panelMap — `${px},${py}` → cell grid
 * @param {Set<string>|null} [cliffCombos] — `hi:lo:ti` keys (composite export may pass a full 0–11 `ti` set per pair); adds uphill `hi` to ground (composite underlay).
 * @returns {{ ground: Set<number>, road: Set<number>, grass: Set<number>, water: Set<number>, trees: Set<number>, cliffStrip: Set<number> }}
 */
export function collectMgWorldUsedBiomes(panelMap, cliffCombos, panelKeyFilter = null) {
  const ground = new Set()
  const road = new Set()
  const grass = new Set()
  const water = new Set()
  const trees = new Set()
  const cliffStrip = new Set()

  const entries =
    panelKeyFilter && panelKeyFilter.size > 0
      ? [...panelKeyFilter].map((k) => [k, panelMap.get(k)])
      : [...panelMap.entries()]

  for (const [, grid] of entries) {
    if (!Array.isArray(grid)) continue
    for (const cell of grid) {
      const b = cell?.biome
      const bi = Number.isFinite(b) ? (b | 0) : 0
      const t = cell?.type
      if (t === T.LAND) ground.add(bi)
      else if (t === T.ROAD) road.add(bi)
      else if (t === T.GRASS) grass.add(bi)
      else if (t === T.OCEAN || t === T.LAKE || t === T.WATERROAD) water.add(bi)
      else if (t === T.FOREST) {
        trees.add(bi)
        ground.add(bi)
      } else if (t === T.CLIFF && cell.layer1) {
        const l1 = cell.layer1
        if (Number.isFinite(l1.biomeLow)) cliffStrip.add(l1.biomeLow | 0)
        if (Number.isFinite(l1.biomeHigh)) cliffStrip.add(l1.biomeHigh | 0)
        cliffStrip.add(bi)
      }
    }
  }

  if (cliffCombos && typeof cliffCombos[Symbol.iterator] === 'function') {
    for (const key of cliffCombos) {
      const parts = String(key).split(':')
      if (parts.length !== 3) continue
      const hi = Number(parts[0])
      if (Number.isFinite(hi)) ground.add(hi | 0)
    }
  }

  return { ground, road, grass, water, trees, cliffStrip }
}

function normBiomeIdForPack(x) {
  if (!Number.isFinite(x)) return 0
  const n = x | 0
  return n >= 0 && n < 6 ? n : 0
}

/**
 * Biome ids (0–5) that influence atlas packing for one panel — same cell rules as
 * {@link collectMgWorldUsedBiomes} (including cliff `biomeLow` / `biomeHigh`).
 * Used to group panels by **composition** (which biomes appear), not count alone.
 * @param {Array<unknown>|null|undefined} grid
 * @returns {Set<number>}
 */
export function collectBiomeIdsUsedOnPanelForPacking(grid) {
  const ids = new Set()
  if (!Array.isArray(grid)) {
    ids.add(0)
    return ids
  }
  for (const cell of grid) {
    const bi = normBiomeIdForPack(cell?.biome)
    const t = cell?.type
    if (t === T.LAND) ids.add(bi)
    else if (t === T.ROAD) ids.add(bi)
    else if (t === T.GRASS) ids.add(bi)
    else if (t === T.OCEAN || t === T.LAKE || t === T.WATERROAD) ids.add(bi)
    else if (t === T.FOREST) {
      ids.add(bi)
    } else if (t === T.CLIFF && cell.layer1) {
      const l1 = cell.layer1
      if (Number.isFinite(l1.biomeLow)) ids.add(normBiomeIdForPack(l1.biomeLow))
      if (Number.isFinite(l1.biomeHigh)) ids.add(normBiomeIdForPack(l1.biomeHigh))
      ids.add(bi)
    }
  }
  if (ids.size < 1) ids.add(0)
  return ids
}

/**
 * Stable string key for panel biome **composition** (sorted ids, `_`-separated), e.g. `0_3_5`.
 * Different mixes (e.g. 0+3+5 vs 0+3+4) → different keys → different packed tilesets.
 * @param {Array<unknown>|null|undefined} grid
 * @returns {string}
 */
export function computePanelBiomeCompositionKey(grid) {
  return [...collectBiomeIdsUsedOnPanelForPacking(grid)].sort((a, b) => a - b).join('_')
}

/**
 * How many distinct biome ids (0–5) influence packing on this panel (cliff hi/lo included).
 * @param {Array<unknown>|null|undefined} grid
 * @returns {number} in **1…6**
 */
export function computePanelDistinctBiomeCount(grid) {
  const n = collectBiomeIdsUsedOnPanelForPacking(grid).size
  if (n < 1) return 1
  return Math.min(6, n)
}

/**
 * Cliff combo keys (`hi:lo:ti` for ti 0..11) only for panels whose keys are in `panelKeys`.
 * @param {Map<string, Array>} panelMap
 * @param {Set<string>} panelKeys — `"px,py"`
 * @returns {Set<string>}
 */
export function buildCliffCombosForPanelKeys(panelMap, panelKeys) {
  const cliffCombosFromMap = new Set()
  for (const key of panelKeys) {
    const grid = panelMap.get(key)
    if (!grid || !Array.isArray(grid)) continue
    for (let i = 0; i < grid.length; i++) {
      const c = grid[i]
      if (!c?.layer1 || c.layer1.type !== T.CLIFF) continue
      const ti = c.layer1.tileIndex ?? c.tileIndex ?? 0
      const hi = Number.isFinite(c.layer1.biomeHigh) ? (c.layer1.biomeHigh | 0) : ((c.biome ?? 0) | 0)
      const lo = Number.isFinite(c.layer1.biomeLow) ? (c.layer1.biomeLow | 0) : hi
      cliffCombosFromMap.add(`${hi}:${lo}:${ti | 0}`)
    }
  }
  const cliffPairs = new Set()
  for (const key of cliffCombosFromMap) {
    const parts = String(key).split(':')
    if (parts.length >= 2) cliffPairs.add(`${parts[0] | 0}:${parts[1] | 0}`)
  }
  const cliffCombos = new Set()
  for (const pr of cliffPairs) {
    for (let ti = 0; ti < 12; ti++) {
      cliffCombos.add(`${pr}:${ti}`)
    }
  }
  return cliffCombos
}

/**
 * Cliff double combo keys (`hi:ti` for ti 0..12) only for panels whose keys are in `panelKeys`.
 * @param {Map<string, Array>} panelMap
 * @param {Set<string>} panelKeys — `"px,py"`
 * @returns {Set<string>}
 */
export function buildCliffDoubleCombosForPanelKeys(panelMap, panelKeys) {
  const hiLoSet = new Set()
  for (const key of panelKeys) {
    const grid = panelMap.get(key)
    if (!grid || !Array.isArray(grid)) continue
    for (let i = 0; i < grid.length; i++) {
      const c = grid[i]
      if (!c?.layer1) continue
      const t = c.layer1.type
      if (t !== T.CLIFF_DOUBLE && t !== T.CLIFF_DOUBLE_PART2) continue
      const hi = Number.isFinite(c.layer1.biomeHigh) ? (c.layer1.biomeHigh | 0) : ((c.biome ?? 0) | 0)
      const lo = Number.isFinite(c.layer1.biomeLow) ? (c.layer1.biomeLow | 0) : hi
      hiLoSet.add(`${hi}:${lo}`)
    }
  }
  // Expand each (hi, lo) pair to ti 0–11 (index 12 = Middle fill, not packed for cliff_double).
  const combos = new Set()
  for (const pair of hiLoSet) {
    for (let ti = 0; ti < 12; ti++) {
      combos.add(`${pair}:${ti}`)
    }
  }
  return combos
}

/**
 * Markdown report: per-panel counts of cells per biome id (0–5).
 * @param {Map<string, Array>} panelMap
 * @param {Array<{ x: number, y: number }>} list — panel order (same as render bundle)
 * @param {number} panelSize — cells per panel edge (`PANEL`)
 */
export function buildPanelBiomeCountsMarkdown(panelMap, list, panelSize) {
  const lines = []
  lines.push('# Panel biome cell counts')
  lines.push('')
  lines.push(
    'Each table counts `cell.biome` per map cell in that panel. Biome ids **0–5** match **Lush, Highland, Enchanted, Autumn, Tropical, Volcanic**.',
  )
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')
  const expected = panelSize * panelSize
  for (const p of list) {
    const grid = panelMap.get(`${p.x},${p.y}`)
    lines.push(`## Panel (${p.x}, ${p.y})`)
    lines.push('')
    if (!grid || !Array.isArray(grid)) {
      lines.push('*No grid data.*')
      lines.push('')
      continue
    }
    const counts = new Array(6).fill(0)
    for (let i = 0; i < grid.length; i++) {
      const b = grid[i]?.biome
      const bi = Number.isFinite(b) ? (b | 0) : 0
      if (bi >= 0 && bi < 6) counts[bi]++
      else counts[0]++
    }
    lines.push('| Biome | Id | Cells |')
    lines.push('| --- | ---: | ---: |')
    for (let bi = 0; bi < 6; bi++) {
      lines.push(`| ${BIOME_NAMES[bi]} | ${bi} | ${counts[bi]} |`)
    }
    lines.push('')
    lines.push(`**Cells in panel:** ${grid.length} (full panel = ${expected})`)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Assigns a human-readable `mapName` to each panel in-place.
 *
 * Rules (in priority order):
 *   Settlement N  — panel.settlement truthy; N = settlement.id + 1 (1-based)
 *   Route N       — panel.isRoute; BFS clusters of 4-adjacent route panels, numbered 1…N
 *   Bonus Area N  — panel.isForestHaloEnclosed; BFS clusters (4-adjacent), numbered 1…N
 *   Halo          — panel.isForestHalo && !isForestHaloEnclosed
 *   {x},{y}       — fallback (ocean, outer edges, etc.)
 */
function assignMapNames(panels) {
  const byKey = new Map(panels.map((p) => [`${p.x},${p.y}`, p]))

  // Settlement: each cluster shares an id; display id is 1-based.
  for (const p of panels) {
    if (p.settlement) {
      p.mapName = `Settlement ${p.settlement.id + 1}`
    }
  }

  // Route clusters — BFS over 4-adjacent isRoute panels that are NOT halo, capped at 4 panels.
  const ROUTE_CLUSTER_MAX = 4
  const isBonusArea = (p) => p.isForestHaloEnclosed || p.isSecretHaloPocket
  const isRealRoute = (p) => p.isRoute && !p.isForestHalo && !p.settlement && !isBonusArea(p)
  let routeN = 0
  const routeSeen = new Set()
  for (const p of panels) {
    if (!isRealRoute(p) || routeSeen.has(`${p.x},${p.y}`)) continue
    const cluster = []
    const q = [p]
    const inQueue = new Set([`${p.x},${p.y}`])
    while (q.length && cluster.length < ROUTE_CLUSTER_MAX) {
      const cur = q.shift()
      cluster.push(cur)
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = `${cur.x + dx},${cur.y + dy}`
        if (inQueue.has(nk) || routeSeen.has(nk)) continue
        const nb = byKey.get(nk)
        if (!nb || !isRealRoute(nb)) continue
        inQueue.add(nk)
        q.push(nb)
      }
    }
    routeN++
    const name = `Route ${routeN}`
    for (const cur of cluster) {
      routeSeen.add(`${cur.x},${cur.y}`)
      cur.mapName = name
    }
  }

  // Bonus Area clusters — BFS over 4-adjacent isForestHaloEnclosed or isSecretHaloPocket panels.
  let bonusN = 0
  const bonusSeen = new Set()
  for (const p of panels) {
    if (!isBonusArea(p) || p.settlement || bonusSeen.has(`${p.x},${p.y}`)) continue
    bonusN++
    const name = `Bonus Area ${bonusN}`
    const q = [p]
    bonusSeen.add(`${p.x},${p.y}`)
    while (q.length) {
      const cur = q.shift()
      cur.mapName = name
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = `${cur.x + dx},${cur.y + dy}`
        if (bonusSeen.has(nk)) continue
        const nb = byKey.get(nk)
        if (!nb || !isBonusArea(nb) || nb.settlement) continue
        bonusSeen.add(nk)
        q.push(nb)
      }
    }
  }

  // Halo (non-enclosed forest border).
  for (const p of panels) {
    if (!p.mapName && p.isForestHalo) p.mapName = 'Halo'
  }

  // Fallback.
}

export async function mgBuildRenderProjectBundle({ project, mapping, assets, defaultAssets, onProgress, breakdownByBiomes = true }) {
  const cellPx = MG_FULL_EXPORT_CELL_PX
  const prepared = await mgPrepareMosaicData({
    project,
    mapping,
    assets,
    defaultAssets,
    cellPx,
    onProgress: (cur, total) => onProgress?.({ phase: 'load', cur, total }),
  })
  const { panelMap, list, gw, gh, imgs } = prepared

  /*
   * Package-for-export pipeline (see docs):
   * 1) UI: Package for export → this bundle.
   * 2) Scan panels → groups by biome count + composition (`computePanelBiomeCompositionKey`).
   * 3) One complete packed tileset per group (`packMgTileset` + `usedBiomes` for that group).
   * 4) `conversionTable` in JSON: semantic keys → `rmTileId` for each group atlas (and master).
   * 5) Master reference atlas (whole-world `usedBiomes` + cliffs).
   * 6) Each panel: `rmTileId`s from that group's lookup; `biomeTilesetIndex` → RMXP `@tileset_id` offset.
   * 7–9) RMXP main: Map*.rxdata, PBS, copy graphics — after `saveRenderProject`.
   */

  // Cliff cells on the map (hi:lo:ti) — used to discover which (hi, lo) pairs exist.
  const cliffCombosFromMap = new Set()
  for (const p of list) {
    const grid = panelMap.get(`${p.x},${p.y}`)
    if (!grid) continue
    for (let i = 0; i < grid.length; i++) {
      const c = grid[i]
      if (!c?.layer1 || c.layer1.type !== T.CLIFF) continue
      const ti = c.layer1.tileIndex ?? c.tileIndex ?? 0
      const hi = Number.isFinite(c.layer1.biomeHigh) ? (c.layer1.biomeHigh | 0) : ((c.biome ?? 0) | 0)
      const lo = Number.isFinite(c.layer1.biomeLow) ? (c.layer1.biomeLow | 0) : hi
      cliffCombosFromMap.add(`${hi}:${lo}:${ti | 0}`)
    }
  }

  /** Every `ti` 0..11 for each `(hi, lo)` seen on the map (index 12 omitted; matches cliff strip export). */
  const cliffPairs = new Set()
  for (const key of cliffCombosFromMap) {
    const parts = String(key).split(':')
    if (parts.length >= 2) cliffPairs.add(`${parts[0] | 0}:${parts[1] | 0}`)
  }
  const fullCliffCombos = new Set()
  for (const pr of cliffPairs) {
    for (let ti = 0; ti < 12; ti++) {
      fullCliffCombos.add(`${pr}:${ti}`)
    }
  }

  /** @type {Map<string, Set<string>>} biome composition key (`0_3_5`) → panel keys `"px,py"` */
  const panelsByBiomeComposition = new Map()
  for (const p of list) {
    const key = `${p.x},${p.y}`
    const grid = panelMap.get(key)
    const compKey = computePanelBiomeCompositionKey(grid)
    if (!panelsByBiomeComposition.has(compKey)) panelsByBiomeComposition.set(compKey, new Set())
    panelsByBiomeComposition.get(compKey).add(key)
  }

  const compositionKeysSorted = [...panelsByBiomeComposition.keys()].sort((a, b) => {
    const aa = a.split('_').map(Number)
    const bb = b.split('_').map(Number)
    if (aa.length !== bb.length) return aa.length - bb.length
    for (let i = 0; i < aa.length; i++) {
      if (aa[i] !== bb[i]) return aa[i] - bb[i]
    }
    return 0
  })

  const packTotal = (breakdownByBiomes ? compositionKeysSorted.length : 0) + 1
  let packCur = 0
  onProgress?.({ phase: 'pack', cur: packCur, total: packTotal })

  /** @type {Array<{ biomeComposition: number[], distinctBiomeCount: number, biomeTilesetIndex: number, canvas: HTMLCanvasElement, lookup: Map<string, number>, tiles: Array<Record<string, unknown>>, imageFile: string, conversionTable: Array<{ semKey: string, rmTileId: number }> }>} */
  const biomeTilesets = []

  /** @type {Map<string, { lookup: Map<string, number>, biomeTilesetIndex: number }>} */
  const compositionToBiomePack = new Map()

  // Steps 2–4: one complete tileset per composition group + conversion table (semantic → rmTileId).
  // Skipped in master-only mode — all panels will use the master atlas lookup instead.
  if (breakdownByBiomes) {
    for (let si = 0; si < compositionKeysSorted.length; si++) {
      const compositionKey = compositionKeysSorted[si]
      const keys = panelsByBiomeComposition.get(compositionKey)
      const biomeComposition = compositionKey.split('_').map((n) => Number(n) | 0)
      const distinctBiomeCount = biomeComposition.length
      const usedBiomes = collectMgWorldUsedBiomes(panelMap, null, keys)
      const groupCliffCombos = buildCliffCombosForPanelKeys(panelMap, keys)
      const groupCliffDoubleCombos = buildCliffDoubleCombosForPanelKeys(panelMap, keys)
      const { canvas, lookup, tiles } = packMgTileset(mapping, imgs, {
        compositeCliffs: true,
        cliffCombos: groupCliffCombos,
        cliffDoubleCombos: groupCliffDoubleCombos.size > 0 ? groupCliffDoubleCombos : null,
        usedBiomes,
      })
      const conversionTable = serializedConversionTableFromLookup(lookup)
      const imageFile = `Export/Graphics/Tilesets/tileset_bm_${compositionKey}.png`
      biomeTilesets.push({
        biomeComposition,
        distinctBiomeCount,
        biomeTilesetIndex: si,
        canvas,
        lookup,
        tiles,
        imageFile,
        conversionTable,
      })
      compositionToBiomePack.set(compositionKey, { lookup, biomeTilesetIndex: si })
      packCur++
      onProgress?.({ phase: 'pack', cur: packCur, total: packTotal })
    }
  }

  // Cliff double combos for the world-wide master atlas.
  const allPanelKeys = new Set(list.map((p) => `${p.x},${p.y}`))
  const fullCliffDoubleCombos = buildCliffDoubleCombosForPanelKeys(panelMap, allPanelKeys)

  // Step 5: master reference atlas (all biomes / cliffs used world-wide).
  const usedBiomesMaster = collectMgWorldUsedBiomes(panelMap, fullCliffCombos)
  const { canvas: atlasCanvas, lookup: rmLookupMaster, tiles: tileManifestMaster } = packMgTileset(
    mapping,
    imgs,
    {
      compositeCliffs: true,
      cliffCombos: fullCliffCombos,
      cliffDoubleCombos: fullCliffDoubleCombos.size > 0 ? fullCliffDoubleCombos : null,
      usedBiomes: usedBiomesMaster,
    },
  )
  const masterConversionTable = serializedConversionTableFromLookup(rmLookupMaster)
  packCur++
  onProgress?.({ phase: 'pack', cur: packCur, total: packTotal })

  const treeSlot =
    mapping.FOREST?.assetId != null
      ? mapping.FOREST
      : mapping.FOREST_BODY?.assetId != null
        ? mapping.FOREST_BODY
        : mapping.FOREST_TOP
  const treeAssetId = treeSlot?.assetId
  const treeImg = treeAssetId ? imgs.get(treeAssetId) : null
  const forestMetrics = getForestSheetMetrics(treeImg)

  // Steps 6–7: panels → `rmTileId` from that group's atlas only (`biomeTilesetIndex` for RMXP slot offset).
  const panels = []
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    onProgress?.({ phase: 'serialize', cur: i, total: list.length })
    const grid = panelMap.get(`${p.x},${p.y}`)
    if (!grid) continue
    const compositionKey = computePanelBiomeCompositionKey(grid)
    const biomeComposition = compositionKey.split('_').map((n) => Number(n) | 0)
    const distinctBiomeCount = biomeComposition.length
    const biomePack = compositionToBiomePack.get(compositionKey)
    // Master-only mode: no per-biome packs — all panels use the master atlas at index 0.
    const rmLookup = biomePack ? biomePack.lookup : rmLookupMaster
    const biomeTilesetIndex = biomePack ? biomePack.biomeTilesetIndex : 0
    const res = await window.electronAPI.loadPanelData(project.path, p.x, p.y)
    const layoutPanel = res.success ? res.data : {}
    const { grid: _omit, ...panelRest } = layoutPanel
    panels.push({
      ...panelRest,
      x: p.x,
      y: p.y,
      biomeComposition,
      distinctBiomeCount,
      biomeTilesetIndex,
      cells: grid.map((c) => serializeMgRenderCell(c, rmLookup, forestMetrics)),
    })
    await new Promise((r) => requestAnimationFrame(r))
  }
  onProgress?.({ phase: 'serialize', cur: list.length, total: list.length })
  assignMapNames(panels)

  const pngBase64 = atlasCanvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')

  const biomeTilesetPngs = biomeTilesets.map((b) => ({
    filename: b.imageFile.replace(/^.*\//, ''),
    base64: b.canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
  }))

  const biomeCountsMarkdown = buildPanelBiomeCountsMarkdown(panelMap, list, PANEL)

  /** Step 2 audit trail: which panels share which composition group (`biomeTilesetIndex`). */
  const exportGroups = compositionKeysSorted.map((compositionKey, groupIndex) => ({
    groupIndex,
    biomeTilesetIndex: groupIndex,
    compositionKey,
    biomeComposition: compositionKey.split('_').map((n) => Number(n) | 0),
    distinctBiomeCount: compositionKey.split('_').length,
    panelKeys: [...panelsByBiomeComposition.get(compositionKey)].sort((a, b) => {
      const [ax, ay] = a.split(',').map(Number)
      const [bx, by] = b.split(',').map(Number)
      if (ay !== by) return ay - by
      return ax - bx
    }),
  }))

  const payload = {
    /** Bundle format id; Grasswhistle's current `render.json` shape (multi-atlas + `exportGroups`). */
    schemaVersion: 3,
    generator: 'Grasswhistle',
    kind: 'map_generator_render',
    generatedAt: new Date().toISOString(),
    cellPx,
    panelSize: PANEL,
    metadata: project.metadata ?? null,
    mapping,
    world: { panelsWide: gw, panelsHigh: gh },
    exportGroups,
    tileset: {
      kind: 'master',
      rmTileIdBase: RM_STATIC_TILE_ID_BASE,
      imageFile: 'Export/Graphics/Tilesets/tileset.png',
      width: atlasCanvas.width,
      height: atlasCanvas.height,
      tilePx: 32,
      tiles: tileManifestMaster,
      conversionTable: masterConversionTable,
    },
    biomeTilesets: biomeTilesets.map((b) => ({
      biomeComposition: b.biomeComposition,
      distinctBiomeCount: b.distinctBiomeCount,
      biomeTilesetIndex: b.biomeTilesetIndex,
      imageFile: b.imageFile,
      width: b.canvas.width,
      height: b.canvas.height,
      tilePx: 32,
      rmTileIdBase: RM_STATIC_TILE_ID_BASE,
      tiles: b.tiles,
      conversionTable: b.conversionTable,
    })),
    panels,
  }
  return { json: JSON.stringify(payload, null, 2), pngBase64, biomeTilesetPngs, biomeCountsMarkdown }
}

