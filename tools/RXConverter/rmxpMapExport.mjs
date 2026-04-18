/**
 * Shared logic: Grasswhistle render bundle → RPG Maker XP `MapNNN.rxdata` files.
 * Panels are grouped by trimmed `mapName` (fallback `"x,y"`). Groups are ordered **Settlement → Route →
 * Bonus Area → Halo → other**, then by cluster number and reading-order anchor. Each group emits a 1×1
 * blank parent map plus one child map per panel named `{Name} A`, `{Name} B`, … in top-left → bottom-right order.
 * Used by Electron main (dynamic import) and can be reused by CLI later.
 */
import fs from 'node:fs'
import path from 'node:path'
import { dump, load } from '@hyrious/marshal'
import { encodeRmxpTable } from './rmxpTable.mjs'

const sym = (s) => Symbol.for(s)

function layerRmId(cell, which) {
  const v = cell?.[which]?.rmTileId
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n | 0 : 0
}

/**
 * Build `semKey` → `rmTileId` map from `render.json` `conversionTable` for this map’s atlas.
 * @param {Array<{ semKey?: string, rmTileId?: number }>|null|undefined} table
 * @returns {Map<string, number>}
 */
export function conversionTableToRmMap(table) {
  const m = new Map()
  if (!Array.isArray(table)) return m
  for (const row of table) {
    if (!row || typeof row.semKey !== 'string') continue
    const id = Number(row.rmTileId)
    if (!Number.isFinite(id)) continue
    m.set(row.semKey, id | 0)
  }
  return m
}

/**
 * @param {Array<unknown>} cells
 * @param {number} w
 * @param {Array<{ cells: Array<unknown>, offX: number, offY: number }>} [stampSources]
 * @param {Map<string, number>|null} [stampRemap] — this map’s tileset (`conversionTable`); used so forest
 *   stamps borrowed from neighbors are re-keyed from `semKey` instead of copying their `rmTileId`
 *   (neighbor ids refer to a different atlas when biome groups differ).
 * @returns {(x: number, y: number, z: number) => number}
 */
export function buildRmxpLayerGet(cells, w, stampSources = null, stampRemap = null) {
  const n = w * w
  const buf = new Int32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const cell = cells[i]
    const o = i * 3
    buf[o] = layerRmId(cell, 'layer1')
    buf[o + 1] = layerRmId(cell, 'layer2')
    buf[o + 2] = layerRmId(cell, 'layer3')
  }
  const sources = Array.isArray(stampSources) && stampSources.length
    ? stampSources
    : [{ cells, offX: 0, offY: 0 }]

  // Apply forest stamps after base layers. We optionally pull stamps from neighboring panels
  // so parts that cross map edges are written into the adjacent map instead of being clipped.
  for (const src of sources) {
    const srcCells = src?.cells
    if (!Array.isArray(srcCells) || srcCells.length < n) continue
    const offX = Number(src.offX) | 0
    const offY = Number(src.offY) | 0
    for (let i = 0; i < n; i++) {
      const st = srcCells[i]?.forestRmStamp
      if (!Array.isArray(st) || st.length === 0) continue
      const cx = (i % w) + offX
      const cy = Math.floor(i / w) + offY
      for (const s of st) {
        const nx = cx + (s.dx | 0)
        const ny = cy + (s.dy | 0)
        if (nx < 0 || ny < 0 || nx >= w || ny >= w) continue
        const lz = s.layer === 3 ? 2 : s.layer === 2 ? 1 : s.layer === 1 ? 0 : 0
        const j = (ny * w + nx) * 3 + lz
        let tid = Number(s.rmTileId) | 0
        const sk = s.semKey
        if (typeof sk === 'string' && sk.length > 0 && stampRemap) {
          const mapped = stampRemap.get(sk)
          if (Number.isFinite(mapped)) tid = mapped | 0
        }
        buf[j] = tid
      }
    }
  }
  return (x, y, z) => buf[(y * w + x) * 3 + z]
}

function normalizeBiomeTilesetIndex(panel) {
  const v = panel?.biomeTilesetIndex
  if (v == null) return null
  if (typeof v === 'string' && /^\d+$/.test(String(v).trim())) return parseInt(String(v).trim(), 10) | 0
  if (typeof v === 'number' && Number.isFinite(v)) return v | 0
  return null
}

function sortPanelsReadingOrder(panels) {
  if (!Array.isArray(panels)) return []
  return [...panels].sort((a, b) => {
    const dy = (a.y | 0) - (b.y | 0)
    if (dy !== 0) return dy
    return (a.x | 0) - (b.x | 0)
  })
}

/** Stable group key: trimmed `mapName`, or `"x,y"` so unnamed panels never merge. */
function normalizePanelGroupKey(panel) {
  const raw = panel?.mapName
  if (raw != null && String(raw).trim()) return String(raw).trim()
  return `${panel.x | 0},${panel.y | 0}`
}

/**
 * @returns {Array<{ name: string, panels: typeof panels }>}
 */
function groupPanelsByName(sortedPanels) {
  const order = []
  const byKey = new Map()
  for (const p of sortedPanels) {
    if (!p) continue
    const k = normalizePanelGroupKey(p)
    if (!byKey.has(k)) {
      byKey.set(k, [])
      order.push(k)
    }
    byKey.get(k).push(p)
  }
  return order.map((name) => ({ name, panels: byKey.get(name) }))
}

/**
 * Export order for map groups (matches `assignMapNames` in mgCore): Settlement → Route → Bonus Area → Halo → other.
 * Within a tier, sort by numeric suffix (`Settlement 2` before `Settlement 10`), then top-left anchor of the group.
 */
const GROUP_EXPORT_TIER = {
  SETTLEMENT: 0,
  ROUTE: 1,
  BONUS: 2,
  HALO: 3,
  OTHER: 4,
}

function mapNameGroupTier(name) {
  const s = String(name).trim()
  if (/^settlement\s+\d+/i.test(s)) return GROUP_EXPORT_TIER.SETTLEMENT
  if (/^route\s+\d+/i.test(s)) return GROUP_EXPORT_TIER.ROUTE
  if (/^bonus\s+area\s+\d+/i.test(s)) return GROUP_EXPORT_TIER.BONUS
  if (s.toLowerCase() === 'halo') return GROUP_EXPORT_TIER.HALO
  return GROUP_EXPORT_TIER.OTHER
}

function clusterOrdinalForTier(name, tier) {
  const s = String(name).trim()
  let m
  if (tier === GROUP_EXPORT_TIER.SETTLEMENT) m = s.match(/^settlement\s+(\d+)/i)
  else if (tier === GROUP_EXPORT_TIER.ROUTE) m = s.match(/^route\s+(\d+)/i)
  else if (tier === GROUP_EXPORT_TIER.BONUS) m = s.match(/^bonus\s+area\s+(\d+)/i)
  else return 0
  return m ? parseInt(m[1], 10) : 9999
}

function groupReadingAnchor(group) {
  let minY = Infinity
  let minX = Infinity
  for (const p of group.panels || []) {
    const y = p.y | 0
    const x = p.x | 0
    if (y < minY || (y === minY && x < minX)) {
      minY = y
      minX = x
    }
  }
  if (minY === Infinity) return [0, 0]
  return [minY, minX]
}

function sortMapGroupsForExport(groups) {
  return [...groups].sort((a, b) => {
    const ta = mapNameGroupTier(a.name)
    const tb = mapNameGroupTier(b.name)
    if (ta !== tb) return ta - tb
    const oa = clusterOrdinalForTier(a.name, ta)
    const ob = clusterOrdinalForTier(b.name, tb)
    if (oa !== ob) return oa - ob
    const [ay, ax] = groupReadingAnchor(a)
    const [by, bx] = groupReadingAnchor(b)
    if (ay !== by) return ay - by
    if (ax !== bx) return ax - by
    return String(a.name).localeCompare(String(b.name))
  })
}

/** 0 → A, 25 → Z, 26 → AA, … (reading-order suffix within a name group). */
function indexToLetterSuffix(index) {
  let i = index | 0
  let out = ''
  do {
    out = String.fromCharCode(65 + (i % 26)) + out
    i = Math.floor(i / 26) - 1
  } while (i >= 0)
  return out
}

function mapFileBaseName(mapId) {
  const w = Math.max(3, String(mapId).length)
  return `Map${String(mapId).padStart(w, '0')}`
}

/** 1×1 empty map — editor “folder” parent for grouped panel maps. */
function writeBlankGroupParentRxdata(templateBuf, dataDir, mapId, tilesetId) {
  const map = load(templateBuf, { string: 'binary' })
  const iv = map?.wrapped ?? map
  const dataObj = iv[sym('@data')]
  if (!dataObj) {
    throw new Error('Template map missing @data (RPG::Table).')
  }
  const layerGet = () => 0
  const tableBytes = encodeRmxpTable({ xsize: 1, ysize: 1, zsize: 3, get: layerGet })
  iv[sym('@width')] = 1
  iv[sym('@height')] = 1
  iv[sym('@tileset_id')] = tilesetId | 0
  dataObj.userDefined = tableBytes
  const base = mapFileBaseName(mapId)
  fs.writeFileSync(path.join(dataDir, `${base}.rxdata`), Buffer.from(dump(map)))
  return `${base}.rxdata`
}

function writeFilledPanelMapRxdata({
  templateBuf,
  dataDir,
  mapId,
  panel,
  panelSize,
  panelByCoord,
  bundle,
  tilesetId,
  hasBiomeTilesets,
}) {
  const cells = panel?.cells
  if (!Array.isArray(cells) || cells.length !== panelSize * panelSize) {
    throw new Error(
      `Panel (${panel?.x},${panel?.y}): expected ${panelSize * panelSize} cells, got ${cells?.length ?? 0}.`,
    )
  }

  const map = load(templateBuf, { string: 'binary' })
  const iv = map?.wrapped ?? map
  const dataObj = iv[sym('@data')]
  if (!dataObj) {
    throw new Error('Template map missing @data (RPG::Table).')
  }

  const px = panel.x | 0
  const py = panel.y | 0
  const sources = []
  const addSource = (sx, sy) => {
    const sp = panelByCoord.get(`${sx},${sy}`)
    if (!sp) return
    sources.push({
      cells: sp.cells,
      offX: (sx - px) * panelSize,
      offY: (sy - py) * panelSize,
    })
  }
  addSource(px, py)
  addSource(px, py + 1)
  addSource(px - 1, py)
  addSource(px - 1, py + 1)

  const bti = normalizeBiomeTilesetIndex(panel)
  const biomeList = Array.isArray(bundle.biomeTilesets) ? bundle.biomeTilesets : []
  const conv =
    bti != null && bti >= 0 && bti < biomeList.length ? biomeList[bti]?.conversionTable : null
  const stampRemap = conversionTableToRmMap(conv)
  const layerGet = buildRmxpLayerGet(cells, panelSize, sources, stampRemap)
  const tableBytes = encodeRmxpTable({
    xsize: panelSize,
    ysize: panelSize,
    zsize: 3,
    get: layerGet,
  })

  iv[sym('@width')] = panelSize
  iv[sym('@height')] = panelSize
  const panelTs =
    hasBiomeTilesets && bti != null && bti >= 0 ? (tilesetId | 0) + bti : tilesetId
  iv[sym('@tileset_id')] = panelTs
  dataObj.userDefined = tableBytes

  const base = mapFileBaseName(mapId)
  fs.writeFileSync(path.join(dataDir, `${base}.rxdata`), Buffer.from(dump(map)))
  return `${base}.rxdata`
}

/**
 * @param {object} opts
 * @param {object} opts.bundle - Parsed `render.json` (`kind: map_generator_render`)
 * @param {string} opts.dataDir - Target `Data/` folder (writes `MapNNN.rxdata` here)
 * @param {string} opts.templateMapPath - Blank (or any) `RPG::Map` template `.rxdata`
 * @param {number} opts.tilesetId - `@tileset_id` for every written map
 * @param {number} [opts.startMapId=2] - First map database id (default 2 → Map002; Map001 often reserved for setup)
 * @returns {{ ok: true, written: Array<{ mapId: number, file: string, x?: number, y?: number, mapName?: string, parentMapId?: number, rmxpRole?: string }> } | { ok: false, error: string }}
 */
export function exportRenderBundleToRmxpDataDir(opts) {
  try {
    const bundle = opts?.bundle
    const dataDir = opts?.dataDir
    const templateMapPath = opts?.templateMapPath
    const tilesetId = opts?.tilesetId
    const startMapId = Number.isInteger(opts?.startMapId) ? opts.startMapId : 2
    if (startMapId < 2) {
      return {
        ok: false,
        error: 'startMapId must be an integer ≥ 2 (Map001 is reserved for project setup).',
      }
    }

    if (!bundle || bundle.kind !== 'map_generator_render') {
      return { ok: false, error: 'Invalid render bundle (expected kind: map_generator_render).' }
    }
    if (!dataDir || typeof dataDir !== 'string') {
      return { ok: false, error: 'Missing dataDir.' }
    }
    if (!templateMapPath || !fs.existsSync(templateMapPath)) {
      return { ok: false, error: 'Template map file not found.' }
    }
    if (!Number.isInteger(tilesetId) || tilesetId < 1) {
      return { ok: false, error: 'tilesetId must be an integer ≥ 1.' }
    }

    const panelSize = bundle.panelSize | 0
    if (panelSize < 1) {
      return { ok: false, error: 'render.json missing valid panelSize.' }
    }

    const panels = sortPanelsReadingOrder(bundle.panels)
    if (panels.length < 1) {
      return { ok: false, error: 'No panels in render bundle.' }
    }

    const hasBiomeTilesets =
      Array.isArray(bundle.biomeTilesets) && bundle.biomeTilesets.length > 0 && (bundle.schemaVersion | 0) >= 3

    const panelByCoord = new Map()
    for (const p of panels) {
      if (!p) continue
      if (Array.isArray(p.cells) && p.cells.length === panelSize * panelSize) {
        panelByCoord.set(`${p.x | 0},${p.y | 0}`, p)
      }
    }

    const templateBuf = fs.readFileSync(templateMapPath)

    const groups = sortMapGroupsForExport(groupPanelsByName(panels))
    let nextMapId = startMapId
    const written = []

    for (const g of groups) {
      const parentId = nextMapId++
      const parentFile = writeBlankGroupParentRxdata(templateBuf, dataDir, parentId, tilesetId)
      written.push({
        mapId: parentId,
        file: parentFile,
        mapName: g.name,
        parentMapId: 0,
        rmxpRole: 'group_parent',
      })

      let letterIdx = 0
      for (const panel of g.panels) {
        const mapId = nextMapId++
        const displayName = `${g.name} ${indexToLetterSuffix(letterIdx++)}`
        const panelFile = writeFilledPanelMapRxdata({
          templateBuf,
          dataDir,
          mapId,
          panel,
          panelSize,
          panelByCoord,
          bundle,
          tilesetId,
          hasBiomeTilesets,
        })
        written.push({
          mapId,
          file: panelFile,
          x: panel.x | 0,
          y: panel.y | 0,
          mapName: displayName,
          parentMapId: parentId,
          rmxpRole: 'panel',
        })
      }
    }

    return { ok: true, written }
  } catch (e) {
    const msg = e && typeof e.message === 'string' ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
