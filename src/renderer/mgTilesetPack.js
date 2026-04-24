/**
 * Pack mapping assets into an RPG Maker–style atlas and assign static tile IDs (XP: ≥384).
 * Export pipelines must finish packing (canvas + `tiles[]` + lookup) before resolving map `rmTileId`s from this lookup.
 * Wang `isTileset` strips and composite cliff bakes use a fixed 5×3 export grid where possible (`mgWangExportCellForPack`, see `docs/wang_tile_layouts.md` + `docs/HANDBOOK.md` §9–10).
 * Dedupes identical (assetId + pack key) so FOREST vs FOREST_BODY same PNG shares rects.
 *
 * Forest tree sheet: **6 variants** on a 3×3 macro grid (`cw = width/3`, `ch = height/3`).
 * Each of the **3 horizontal bands** is one visual row: **wide tree** = left **2** macro columns (**2×3** map tiles at 32px),
 * **narrow tree** = right **1** macro column (**1×3** map tiles). Per tree, **top 2 sheet rows** → `FOREST_TOP` (layer3),
 * **bottom sheet row** (global rows 2,5,8) → `FOREST_BODY` trunk (layer2). Indices `ft` 0–5 = wide/narrow per band.
 */
import { T } from './engine/constants.js'
import {
  MG_WANG_COLS,
  MG_WANG_ROWS,
  MG_WANG_EXPORT_BLOCK_H_PX,
  MG_WANG_EXPORT_BLOCK_W_PX,
  mgWangExportCellForPack,
  LAYER_TYPE_FOREST_BODY,
  LAYER_TYPE_FOREST_TOP,
  LAYER_TYPE_FOREST_TRUNK,
  MG_CLIFF_DOUBLE_CD_MAP,
  MG_CLIFF_DOUBLE_COLS,
  MG_CLIFF_DOUBLE_ROWS,
} from './mgLayers.js'

/** Total semantic Wang indices (0–12); distinct from MG_WANG_COLS which is the asset grid width. */
const MG_WANG_SEMANTIC_COUNT = 13

export const RM_STATIC_TILE_ID_BASE = 384

/** Asset ID for the placeholder tile loaded from `assets/placeholder/placeholder.png`. */
export const MG_PLACEHOLDER_ASSET_ID = '__placeholder__placeholder'

/**
 * Defensive copy of a finished `packMgTileset` lookup so export-time resolution
 * cannot mutate the atlas key→id map (tileset is finalized first, then ids).
 * @param {Map<string, number>} lookup
 * @returns {Map<string, number>}
 */
export function freezeRmTileLookupForExport(lookup) {
  return new Map(lookup)
}

/**
 * Serializable semantic-key → `rmTileId` rows for `render.json` (JSON layers → packed atlas).
 * Keys match `rmTileIdForDerivedLayer` / RM export lookup (`GROUND:biome:ti`, `CLIFF:hi:lo:ti`, …).
 * @param {Map<string, number>} lookup
 * @returns {Array<{ semKey: string, rmTileId: number }>}
 */
export function serializedConversionTableFromLookup(lookup) {
  const out = []
  for (const [semKey, rmTileId] of lookup.entries()) {
    if (typeof semKey !== 'string' || !Number.isFinite(rmTileId)) continue
    out.push({ semKey, rmTileId: rmTileId | 0 })
  }
  out.sort((a, b) => (a.semKey < b.semKey ? -1 : a.semKey > b.semKey ? 1 : 0))
  return out
}
/** RPG Maker XP `RPG::Tileset#passages` int16 — keep in sync with `tools/RXConverter/rmxpTilesets.mjs`. */
const RM_PASSAGE_OPEN = 0
const RM_PASSAGE_SOLID = 15
/** Star (0x10): drawn above character; passability comes from below. */
const RM_PASSAGE_STAR = 0x10
/** Bush (0x40): RPG Maker XP Database “Bush flag” on `passages` (feet transparent in grass/shallow water). */
const RM_PASSAGE_BUSH = 0x40
/** RPG Maker XP `RPG::Tileset#priorities` — keep in sync with `tools/RXConverter/rmxpTilesets.mjs`. */
const RM_PRIORITY_BELOW = 0
const RM_PRIORITY_NORMAL = 1
/** Pokémon Essentials `TerrainTag` — keep in sync with `tools/RXConverter/rmxpTilesets.mjs` `PE_TERRAIN_*`. */
const PE_TERRAIN_NONE = 0
const PE_TERRAIN_GRASS = 2
const PE_TERRAIN_WATER = 7
const TILE_PX = 32
/** Max atlas width (8 × 32px); wide trees (64px) still fit two per row. */
const ATLAS_MAX_WIDTH_PX = 256
/** Forest `|f32|` sidecar beside each 5×3 Wang block: 3×3 map tiles = 96px wide (fills 8 cols with Wang). */
const TREE_EXPORT_SLOT_PX = TILE_PX * 3
/** Cliff-double inner-corner sidecar beside each 3×4 cdcomp block: 2×4 = 64px (cols 3–4). */
const CD_INNER_SLOT_PX = TILE_PX * 2

/**
 * Atlas 3×3 beside Wang: row = top/body/trunk; cols 0–1 = wide L/R, col 2 = skinny (see `docs/HANDBOOK.md` §9).
 * @param {'t'|'m'|'b'} layer
 * @param {number} ni — 0 = wide (2 cols), 1 = narrow (1 col)
 * @param {number} tx — horizontal tile index within that tree half
 * @returns {{ col: number, row: number }}
 */
function f32SidecarCellForExport(layer, ni, tx) {
  const row = layer === 't' ? 0 : layer === 'm' ? 1 : 2
  if ((ni | 0) === 1) return { col: 2, row }
  const c = tx | 0
  return { col: c <= 1 ? c : 1, row }
}

/**
 * @param {string} physKey — `${assetId}|f32|…`
 * @returns {string|null} `${assetId}|${v}` for one horizontal band of the tree sheet
 */
function parseF32SidecarGroupKey(physKey) {
  const marker = '|f32|'
  const i = physKey.indexOf(marker)
  if (i < 0) return null
  const assetId = physKey.slice(0, i)
  const rest = physKey.slice(i + marker.length)
  const parts = rest.split('|')
  if (parts.length < 5) return null
  const v = Number(parts[1])
  if (!Number.isFinite(v)) return null
  return `${assetId}|${v | 0}`
}

/** Forest PNG: 3 sheet rows × (one 2×3-tile wide + one 1×3-tile narrow) = 6 trees — see `drawMgForestPart`. */
const FOREST_SHEET_MAPPING_KEYS = new Set(['FOREST', 'FOREST_TRUNK', 'FOREST_BODY', 'FOREST_TOP'])

/**
 * Scale image into TILE_P×TILE_P without stretching (letterbox; transparent edges).
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} img
 * @param {number} dx
 * @param {number} dy
 */
function drawImageContain32(ctx, img, dx, dy) {
  const sw = img.width
  const sh = img.height
  if (sw < 1 || sh < 1) return
  const scale = Math.min(TILE_PX / sw, TILE_PX / sh)
  const dw = Math.round(sw * scale)
  const dh = Math.round(sh * scale)
  const ox = dx + (TILE_PX - dw) / 2
  const oy = dy + (TILE_PX - dh) / 2
  ctx.clearRect(dx, dy, TILE_PX, TILE_PX)
  ctx.drawImage(img, 0, 0, sw, sh, ox, oy, dw, dh)
}

/**
 * Wang tileset rects that share `wangExportPack` are laid out in a fixed
 * 5×3 grid inside one `MG_WANG_EXPORT_BLOCK_W_PX` × `MG_WANG_EXPORT_BLOCK_H_PX` block per group (export-friendly remapping).
 * After each Wang block, the next nine `|f32|` forest tiles (when available) fill a 3×3 slot to the right (8 cols total).
 * **Row rules:** each Wang block starts on a **new row** (left edge), even if that leaves unused space on the row above.
 * Multi-tile (non‑32²) shelf rects start a new row when needed.
 * Orphan forest `|f32|` (more tree bands than Wang sidecars) are **not** packed in scan order: each 3×3 uses the same **virtual** 160px + 96px slot as a Wang+sidecar row (tree aligned to the right half), advancing `x` by the full slot width.
 *
 * @param {Array<{ destW: number, destH: number, wangExportPack?: { groupId: string, col: number, row: number }, physKey?: string }>} uniqueOrder
 */
function layoutMgTilesetRects(uniqueOrder, maxWidth, treeIndices) {
  const n = uniqueOrder.length
  const positions = new Array(n)
  const nonTree = []
  const tree = []
  for (let i = 0; i < n; i++) {
    if (treeIndices.has(i)) tree.push(i)
    else nonTree.push(i)
  }

  /**
   * @param {number[]} indices — indices into `uniqueOrder`
   * @param {number} startY
   */
  function layoutBand(indices, startY) {
    const f32Indices = indices.filter((ii) => (uniqueOrder[ii].physKey ?? '').includes('|f32|'))
    /** One chunk per tree sheet band `(assetId|v)`: wide L/R + skinny top/body/trunk in a 3×3. */
    /** @type {Map<string, number[]>} */
    const f32ByGroup = new Map()
    /** @type {Map<string, number>} */
    const groupFirstIdx = new Map()
    for (const ii of f32Indices) {
      const key = parseF32SidecarGroupKey(uniqueOrder[ii].physKey ?? '')
      if (!key) continue
      if (!f32ByGroup.has(key)) {
        f32ByGroup.set(key, [])
        groupFirstIdx.set(key, ii)
      }
      f32ByGroup.get(key).push(ii)
    }
    const sortedGroupKeys = [...f32ByGroup.keys()].sort(
      (a, b) => (groupFirstIdx.get(a) ?? 0) - (groupFirstIdx.get(b) ?? 0),
    )
    const f32Chunks = sortedGroupKeys.map((k) => {
      const idxs = f32ByGroup.get(k) ?? []
      return [...idxs].sort((ia, ib) => {
        const ca = uniqueOrder[ia].f32SidecarCell
        const cb = uniqueOrder[ib].f32SidecarCell
        if (!ca || !cb) return ia - ib
        if (ca.row !== cb.row) return ca.row - cb.row
        return ca.col - cb.col
      })
    })

    let wangGroups = 0
    for (let ii = 0; ii < indices.length; ) {
      const p = uniqueOrder[indices[ii]]
      if (p.wangExportPack?.groupId) {
        wangGroups++
        const gid = p.wangExportPack.groupId
        let jj = ii
        while (jj < indices.length) {
          const q = uniqueOrder[indices[jj]].wangExportPack
          if (!q || q.groupId !== gid) break
          jj++
        }
        ii = jj
      } else if (p.cdExportBlock) {
        wangGroups++
        ii++
      } else if (p.cdInnerSidecar) {
        ii++ // placed by comp block, not counted as its own group
      } else {
        ii++
      }
    }

    const sidecarPairs = Math.min(wangGroups, f32Chunks.length)
    /** @type {Set<number>} f32 rects placed in the 3×3 beside a Wang block (not shelf-packed here) */
    const f32SidecarReserved = new Set()
    for (let k = 0; k < sidecarPairs; k++) {
      for (const idx of f32Chunks[k]) f32SidecarReserved.add(idx)
    }

    let x = 0
    let y = startY
    let rowH = 0
    let i = 0
    let treeChunkSlot = 0

    while (i < indices.length) {
      const idx = indices[i]
      const p = uniqueOrder[idx]
      if (f32SidecarReserved.has(idx)) {
        i++
        continue
      }
      // Inner-corner sidecar: placed by its comp block, not independently.
      if (p.cdInnerSidecar) {
        i++
        continue
      }
      // Orphan forest `|f32|` chunks (no Wang sidecar slot left): never shelf-pack tile-by-tile here — remainder uses the same virtual 160+96 slot as paired rows.
      if ((p.physKey ?? '').includes('|f32|')) {
        i++
        continue
      }
      const wp = p.wangExportPack
      if (wp?.groupId) {
        const gid = wp.groupId
        let j = i
        while (j < indices.length) {
          const jidx = indices[j]
          const q = uniqueOrder[jidx].wangExportPack
          if (!q || q.groupId !== gid) break
          j++
        }
        const bw = MG_WANG_EXPORT_BLOCK_W_PX
        const bh = MG_WANG_EXPORT_BLOCK_H_PX
        // Wang strip (+ optional 3×3 tree sidecar) always begins at the left margin on its own row.
        if (x > 0) {
          y += rowH
          x = 0
          rowH = 0
        }
        if (x + bw > maxWidth) {
          y += rowH
          x = 0
          rowH = 0
        }
        const bx = x
        const by = y
        for (let k = i; k < j; k++) {
          const midx = indices[k]
          const pk = uniqueOrder[midx].wangExportPack
          if (!pk) continue
          positions[midx] = {
            x: bx + pk.col * TILE_PX,
            y: by + pk.row * TILE_PX,
            destW: TILE_PX,
            destH: TILE_PX,
          }
        }
        let advance = bw
        const slot = treeChunkSlot
        if (slot < sidecarPairs && bx + bw + TREE_EXPORT_SLOT_PX <= maxWidth) {
          const chunk = f32Chunks[slot]
          treeChunkSlot++
          for (const midx of chunk) {
            const cell = uniqueOrder[midx].f32SidecarCell
            if (!cell) continue
            positions[midx] = {
              x: bx + bw + cell.col * TILE_PX,
              y: by + cell.row * TILE_PX,
              destW: TILE_PX,
              destH: TILE_PX,
            }
          }
          advance = bw + TREE_EXPORT_SLOT_PX
        } else if (slot < sidecarPairs) {
          for (const midx of f32Chunks[slot]) f32SidecarReserved.delete(midx)
          treeChunkSlot++
        }
        rowH = Math.max(rowH, bh)
        x = bx + advance
        i = j
      } else if (p.cdExportBlock) {
        // Cliff-double comp block (3×4, 96px): inner-corner sidecar at +96px, trees at +160px.
        const bw = p.destW  // 96 for cdcomp
        const bh = p.destH  // 128
        if (x > 0) { y += rowH; x = 0; rowH = 0 }
        const bx = x
        const by = y
        positions[idx] = { x: bx, y: by, destW: bw, destH: bh }
        let advance = bw

        // Place inner-corner sidecar (cdinner) immediately after comp block.
        const innerIdx = p.cdInnerSidecarIdx
        if (innerIdx !== undefined && innerIdx !== null) {
          positions[innerIdx] = { x: bx + bw, y: by, destW: CD_INNER_SLOT_PX, destH: bh }
          advance = bw + CD_INNER_SLOT_PX
        }

        const slot = treeChunkSlot
        if (slot < sidecarPairs && bx + advance + TREE_EXPORT_SLOT_PX <= maxWidth) {
          const chunk = f32Chunks[slot]
          treeChunkSlot++
          for (const midx of chunk) {
            const cell = uniqueOrder[midx].f32SidecarCell
            if (!cell) continue
            positions[midx] = {
              x: bx + advance + cell.col * TILE_PX,
              y: by + cell.row * TILE_PX,
              destW: TILE_PX,
              destH: TILE_PX,
            }
          }
          advance += TREE_EXPORT_SLOT_PX
        } else if (slot < sidecarPairs) {
          for (const midx of f32Chunks[slot]) f32SidecarReserved.delete(midx)
          treeChunkSlot++
        }
        rowH = Math.max(rowH, bh)
        x = bx + advance
        i++
      } else {
        const dw = p.destW
        const dh = p.destH
        // Wide/tall stamps (not single 32²): start on a fresh row so rows stay visually consistent.
        if (x > 0 && (dw > TILE_PX || dh > TILE_PX)) {
          y += rowH
          x = 0
          rowH = 0
        }
        if (x > 0 && x + dw > maxWidth) {
          y += rowH
          x = 0
          rowH = 0
        }
        positions[idx] = { x, y, destW: dw, destH: dh }
        rowH = Math.max(rowH, dh)
        x += dw
        i++
      }
    }

    /** Remaining rects (e.g. f32 chunks past sidecar count, or non-f32) still without positions */
    const unresolved = []
    for (const ii of indices) {
      if (positions[ii] === undefined) unresolved.push(ii)
    }
    let ur = 0
    while (ur < unresolved.length) {
      const ii = unresolved[ur]
      const p = uniqueOrder[ii]
      const pk = p.physKey ?? ''
      const gkey = pk.includes('|f32|') ? parseF32SidecarGroupKey(pk) : null
      if (gkey) {
        let u2 = ur
        while (u2 < unresolved.length) {
          const jj = unresolved[u2]
          const g2 = parseF32SidecarGroupKey(uniqueOrder[jj].physKey ?? '')
          if (g2 !== gkey) break
          u2++
        }
        const runLen = u2 - ur
        const wangW = MG_WANG_EXPORT_BLOCK_W_PX
        const sidecarW = TREE_EXPORT_SLOT_PX
        const slotW = wangW + sidecarW
        if (runLen >= 9) {
          const blockH = 3 * TILE_PX
          if (x > 0) {
            y += rowH
            x = 0
            rowH = 0
          }
          if (x + slotW > maxWidth) {
            y += rowH
            x = 0
            rowH = 0
          }
          const slotLeft = x
          const bx = slotLeft + wangW
          const by = y
          for (let t = 0; t < 9; t++) {
            const midx = unresolved[ur + t]
            const cell = uniqueOrder[midx].f32SidecarCell
            if (!cell) continue
            positions[midx] = {
              x: bx + cell.col * TILE_PX,
              y: by + cell.row * TILE_PX,
              destW: TILE_PX,
              destH: TILE_PX,
            }
          }
          rowH = Math.max(rowH, MG_WANG_EXPORT_BLOCK_H_PX, blockH)
          x = slotLeft + slotW
          ur += 9
          continue
        }
        if (runLen > 0) {
          if (x > 0) {
            y += rowH
            x = 0
            rowH = 0
          }
          if (x + slotW > maxWidth) {
            y += rowH
            x = 0
            rowH = 0
          }
          const slotLeft = x
          const bx = slotLeft + wangW
          const by = y
          for (let t = 0; t < runLen; t++) {
            const midx = unresolved[ur + t]
            const cell = uniqueOrder[midx].f32SidecarCell
            if (!cell) continue
            positions[midx] = {
              x: bx + cell.col * TILE_PX,
              y: by + cell.row * TILE_PX,
              destW: TILE_PX,
              destH: TILE_PX,
            }
          }
          rowH = Math.max(rowH, MG_WANG_EXPORT_BLOCK_H_PX)
          x = slotLeft + slotW
          ur += runLen
          continue
        }
      }
      const dw = p.destW
      const dh = p.destH
      if (x > 0 && (dw > TILE_PX || dh > TILE_PX)) {
        y += rowH
        x = 0
        rowH = 0
      }
      if (x > 0 && x + dw > maxWidth) {
        y += rowH
        x = 0
        rowH = 0
      }
      positions[ii] = { x, y, destW: dw, destH: dh }
      rowH = Math.max(rowH, dh)
      x += dw
      ur++
    }

    return y + rowH
  }

  let h = 0
  if (nonTree.length) h = layoutBand(nonTree, 0)
  if (tree.length) h = layoutBand(tree, h)
  return { positions, totalH: Math.max(TILE_PX, h) }
}

/**
 * Push 3×3-split forest sheet rects (`|f32|*`) for one tree PNG into the atlas `physical` list.
 * @param {string} assetId
 * @param {CanvasImageSource} img
 * @param {Array} physical
 */
function pushForest32PhysicalRects(assetId, img, physical) {
  if (!img || img.width % 3 !== 0 || img.height % 3 !== 0) return
  const cw = img.width / 3
  const ch = img.height / 3
  for (let v = 0; v < 3; v++) {
    for (let ni = 0; ni < 2; ni++) {
      const narrow = ni === 1
      const sx0 = narrow ? 2 * cw : 0
      const sy0 = v * ch
      const sw = narrow ? cw : 2 * cw
      const sh = ch
      const topH = sh / 3
      const bodyH = sh / 3
      const trunkH = sh / 3
      const cols = Math.ceil(sw / TILE_PX)
      const rowsTop = Math.ceil(topH / TILE_PX)
      const rowsBody = Math.ceil(bodyH / TILE_PX)
      const rowsTrunk = Math.ceil(trunkH / TILE_PX)
      for (let ty = 0; ty < rowsTop; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const srcX = sx0 + tx * TILE_PX
          const srcY = sy0 + ty * TILE_PX
          const physKey = `${assetId}|f32|t|${v}|${ni}|${tx}|${ty}`
          physical.push({
            physKey,
            assetId,
            isTileset: false,
            wangIndex: -1,
            destW: TILE_PX,
            destH: TILE_PX,
            f32SidecarCell: f32SidecarCellForExport('t', ni, tx),
            draw: (ctx, ax, ay) => {
              ctx.drawImage(img, srcX, srcY, TILE_PX, TILE_PX, ax, ay, TILE_PX, TILE_PX)
            },
          })
        }
      }
      for (let ty = 0; ty < rowsBody; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const srcX = sx0 + tx * TILE_PX
          const srcY = sy0 + topH + ty * TILE_PX
          const physKey = `${assetId}|f32|m|${v}|${ni}|${tx}|${ty}`
          physical.push({
            physKey,
            assetId,
            isTileset: false,
            wangIndex: -1,
            destW: TILE_PX,
            destH: TILE_PX,
            f32SidecarCell: f32SidecarCellForExport('m', ni, tx),
            draw: (ctx, ax, ay) => {
              ctx.drawImage(img, srcX, srcY, TILE_PX, TILE_PX, ax, ay, TILE_PX, TILE_PX)
            },
          })
        }
      }
      for (let ty = 0; ty < rowsTrunk; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const srcX = sx0 + tx * TILE_PX
          const srcY = sy0 + topH + bodyH + ty * TILE_PX
          const physKey = `${assetId}|f32|b|${v}|${ni}|${tx}|${ty}`
          physical.push({
            physKey,
            assetId,
            isTileset: false,
            wangIndex: -1,
            destW: TILE_PX,
            destH: TILE_PX,
            f32SidecarCell: f32SidecarCellForExport('b', ni, tx),
            draw: (ctx, ax, ay) => {
              ctx.drawImage(img, srcX, srcY, TILE_PX, TILE_PX, ax, ay, TILE_PX, TILE_PX)
            },
          })
        }
      }
    }
  }
}

/**
 * Register `FOREST_*:${biomeId}:${ft}:${sub}` lookup keys from packed phys keys (matches `pushForest32PhysicalRects`).
 */
function registerForest32LookupForBiome(assetId, img, biomeId, physToRm, lookup) {
  if (!img || img.width % 3 !== 0 || img.height % 3 !== 0) return
  const cw = img.width / 3
  const ch = img.height / 3
  const b = biomeId | 0
  for (let v = 0; v < 3; v++) {
    for (let ni = 0; ni < 2; ni++) {
      const ft = ni ? v * 2 + 1 : v * 2
      const sw = ni ? cw : 2 * cw
      const sh = ch
      const topH = sh / 3
      const bodyH = sh / 3
      const trunkH = sh / 3
      const cols = Math.ceil(sw / TILE_PX)
      const rowsTop = Math.ceil(topH / TILE_PX)
      const rowsBody = Math.ceil(bodyH / TILE_PX)
      const rowsTrunk = Math.ceil(trunkH / TILE_PX)
      let sub = 0
      for (let ty = 0; ty < rowsTop; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const rm = physToRm.get(`${assetId}|f32|t|${v}|${ni}|${tx}|${ty}`)
          if (rm !== undefined) lookup.set(`FOREST_TOP:${b}:${ft}:${sub++}`, rm)
        }
      }
      sub = 0
      for (let ty = 0; ty < rowsBody; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const rm = physToRm.get(`${assetId}|f32|m|${v}|${ni}|${tx}|${ty}`)
          if (rm !== undefined) lookup.set(`FOREST_BODY:${b}:${ft}:${sub++}`, rm)
        }
      }
      sub = 0
      for (let ty = 0; ty < rowsTrunk; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const rm = physToRm.get(`${assetId}|f32|b|${v}|${ni}|${tx}|${ty}`)
          if (rm !== undefined) lookup.set(`FOREST_TRUNK:${b}:${ft}:${sub++}`, rm)
        }
      }
    }
  }
  const fillerTop = physToRm.get(`${assetId}|f32|t|0|0|0|0`)
  const fillerBody = physToRm.get(`${assetId}|f32|m|0|0|0|0`)
  const fillerTrunk = physToRm.get(`${assetId}|f32|b|0|0|0|0`)
  for (let i = 6; i < MG_WANG_SEMANTIC_COUNT; i++) {
    if (fillerTop !== undefined) lookup.set(`FOREST_TOP:${b}:${i}`, fillerTop)
    if (fillerTrunk !== undefined) lookup.set(`FOREST_TRUNK:${b}:${i}`, fillerTrunk)
    if (fillerBody !== undefined) lookup.set(`FOREST_BODY:${b}:${i}`, fillerBody)
  }
}

/**
 * Slot used when packing / building RM lookup — mirrors `mgMappingSlotForLayerType` fallbacks.
 * @param {Object} mapping
 * @param {string} mappingKey — `MG_TILESET_MAPPING_KEYS` entry
 */
function slotForMappingKey(mapping, mappingKey) {
  const direct = mapping[mappingKey]
  if (
    FOREST_SHEET_MAPPING_KEYS.has(mappingKey) &&
    !direct?.assetId &&
    mapping?.TREE_BY_BIOME &&
    typeof mapping.TREE_BY_BIOME === 'object'
  ) {
    const id = mapping.TREE_BY_BIOME[0]
    if (id) return { assetId: id, isTileset: false }
  }
  if (
    mappingKey === 'GROUND' &&
    !direct?.assetId &&
    mapping?.GROUND_BY_BIOME &&
    typeof mapping.GROUND_BY_BIOME === 'object'
  ) {
    const id = mapping.GROUND_BY_BIOME[0]
    if (id) return { assetId: id, isTileset: false }
  }
  if (direct?.assetId) return direct
  if (
    (mappingKey === 'FOREST_TRUNK' || mappingKey === 'FOREST_BODY' || mappingKey === 'FOREST_TOP') &&
    mapping.FOREST?.assetId
  ) {
    return mapping.FOREST
  }
  return direct ?? null
}

/** Order matches Map Generator mapping keys. */
export const MG_TILESET_MAPPING_KEYS = [
  'GROUND',
  'ROAD',
  'GRASS',
  'WATER',
  'CLIFF',
  'FOREST',
  'FOREST_TRUNK',
  'FOREST_BODY',
  'FOREST_TOP',
]

/** Atlas pack order: land → grass → roads → water, then cliffs (composite + strips), then trees. */
export const MG_TILESET_PACK_ORDER_LAND_WATER = ['GROUND', 'GRASS', 'ROAD', 'WATER']

/** Wang index 12 is the solid fill tile — shared physKey deduplicates it across all water biomes. */
const WATER_FILL_WANG_INDEX = 12
const WATER_FILL_PHYS_KEY_SUFFIX = '|tsb|waterfill'
export const MG_TILESET_PACK_ORDER_FOREST = ['FOREST', 'FOREST_TRUNK', 'FOREST_BODY', 'FOREST_TOP']

/**
 * @param {string} layerType — `T.*` or `FOREST_BODY` / `FOREST_TOP`
 * @returns {string|null} mapping.json key
 */
export function mgLayerTypeToMappingKey(layerType) {
  if (layerType === T.LAND || layerType === 'GROUND') return 'GROUND'
  if (layerType === T.ROAD) return 'ROAD'
  if (layerType === T.GRASS) return 'GRASS'
  if (layerType === T.OCEAN || layerType === T.LAKE || layerType === T.WATERROAD) return 'WATER'
  if (layerType === T.CLIFF) return 'CLIFF'
  if (layerType === T.CLIFF_DOUBLE) return 'CLIFF_DOUBLE'
  if (layerType === T.CLIFF_DOUBLE_PART2) return 'CLIFF_DOUBLE_PART2'
  if (layerType === T.FOREST) return 'FOREST'
  if (layerType === LAYER_TYPE_FOREST_TRUNK) return 'FOREST_TRUNK'
  if (layerType === LAYER_TYPE_FOREST_BODY) return 'FOREST_BODY'
  if (layerType === LAYER_TYPE_FOREST_TOP) return 'FOREST_TOP'
  return null
}

/**
 * @param {{ type: string, tileIndex?: number }} layer
 * @param {Map<string, number>} lookup — `${mappingKey}:${wangIndex}` → rmTileId
 * @returns {number|null}
 */
function wangIndexFromLayer(layer) {
  const raw = layer?.tileIndex
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw | 0
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n)) return n | 0
  }
  return 0
}

export function rmTileIdForDerivedLayer(layer, lookup) {
  if (!layer?.type) return null
  const mk = mgLayerTypeToMappingKey(layer.type)
  if (!mk) return null
  const ti = wangIndexFromLayer(layer)

  // 3×3 forest sheet: biome-aware `FOREST_*:${biome}:${ft}:${sub}`, then legacy `FOREST_*:${ft}:${sub}`.
  if (mk === 'FOREST_TRUNK' || mk === 'FOREST_BODY' || mk === 'FOREST_TOP') {
    const bi = layer?.biome
    if (Number.isFinite(bi)) {
      const a = lookup.get(`${mk}:${bi | 0}:${ti}:0`)
      if (a != null) return a
      const bush = lookup.get(`${mk}:${bi | 0}:${ti}`)
      if (bush != null) return bush
    }
    const a = lookup.get(`${mk}:${ti}:0`)
    if (a != null) return a
    const b = lookup.get(`${mk}:${ti}`)
    if (b != null) return b
    const c = lookup.get(`${mk}:0:0`)
    if (c != null) return c
    return lookup.get(`${mk}:0`) ?? null
  }

  // Cliff double: keyed by hi + lo biome pair + tileIndex.
  if (mk === 'CLIFF_DOUBLE' || mk === 'CLIFF_DOUBLE_PART2') {
    const hi = Number.isFinite(layer?.biomeHigh) ? (layer.biomeHigh | 0) : (layer?.biome ?? 0) | 0
    const lo = Number.isFinite(layer?.biomeLow) ? (layer.biomeLow | 0) : hi
    const v = lookup.get(`${mk}:${hi}:${lo}:${ti | 0}`)
    if (v != null) return v
    return lookup.get(`${mk}:0:0:${ti | 0}`) ?? null
  }

  // Biome-aware GROUND/ROAD/GRASS/WATER/CLIFF: prefer exact biome+index, then biome+0.
  if (mk === 'GROUND' || mk === 'ROAD' || mk === 'GRASS' || mk === 'WATER' || mk === 'CLIFF') {
    // Composite cliffs: prefer up+down biome pair key when present.
    if (mk === 'CLIFF') {
      const hi = layer?.biomeHigh
      const lo = layer?.biomeLow
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const v = lookup.get(`${mk}:${hi | 0}:${lo | 0}:${ti | 0}`)
        if (v != null) return v
      }
    }
    const bi = layer?.biome
    if (Number.isFinite(bi)) {
      const v = lookup.get(`${mk}:${bi | 0}:${ti}`)
      if (v != null) return v
      const v0 = lookup.get(`${mk}:${bi | 0}:0`)
      if (v0 != null) return v0
    }
  }

  // Wang strips (GROUND, ROAD, …): prefer exact index, then column 0 (fit/single-tile maps all indices to same id).
  return lookup.get(`${mk}:${ti}`) ?? lookup.get(`${mk}:0`) ?? null
}

/**
 * @param {{ ground?: Set<number>, road?: Set<number>, grass?: Set<number>, water?: Set<number>, trees?: Set<number>, cliffStrip?: Set<number> } | null | undefined} usedBiomes
 * @param {'ground'|'road'|'grass'|'water'|'trees'|'cliffStrip'} category
 * @param {number} biomeId
 */
function usedBiomeAllowsPack(usedBiomes, category, biomeId) {
  if (!usedBiomes || usedBiomes[category] === undefined) return true
  const s = usedBiomes[category]
  return s instanceof Set && s.has(biomeId | 0)
}

/**
 * @param {Object} mapping
 * @param {Map<string, HTMLImageElement>} imgs
 * @param {{ compositeCliffs?: boolean, cliffCombos?: Iterable<string>, usedBiomes?: { ground?: Set<number>, road?: Set<number>, grass?: Set<number>, water?: Set<number>, trees?: Set<number>, cliffStrip?: Set<number> } }} [opts]
 * @returns {{ canvas: HTMLCanvasElement, lookup: Map<string, number>, tiles: Array<Record<string, unknown>> }}
 */
export function packMgTileset(mapping, imgs, opts = {}) {
  const lookup = new Map()
  const tiles = []
  /** One 32×32 forest sheet pass per `assetId` (FOREST / BODY / TOP share the same PNG). */
  const forest32Packed = new Set()

  /**
   * @type {Array<{ physKey: string, assetId: string, isTileset: boolean, wangIndex: number, destW: number, destH: number, mappingKey?: string, wangExportPack?: { groupId: string, col: number, row: number }, f32SidecarCell?: { col: number, row: number }, draw: (ctx: CanvasRenderingContext2D, ax: number, ay: number) => void }>}
   */
  const physical = []
  const tbForest = mapping?.TREE_BY_BIOME && typeof mapping.TREE_BY_BIOME === 'object' ? mapping.TREE_BY_BIOME : null
  const useTreeByBiomeForest = !!(
    tbForest && Object.values(tbForest).some((id) => id && String(id).trim() !== '')
  )
  const usedBiomes = opts?.usedBiomes ?? null

  /** @param {{ physKey: string, mappingKey?: string }} p */
  const passageForPhysical = (p) => {
    if (p.physKey.includes('|f32|m|') || p.physKey.includes('|f32|b|')) return RM_PASSAGE_SOLID
    if (p.physKey.includes('|f32|t|')) return RM_PASSAGE_STAR
    if (p.mappingKey === 'CLIFF' || p.mappingKey === 'CLIFF_DOUBLE' || p.mappingKey === 'CLIFF_DOUBLE_PART2') return RM_PASSAGE_SOLID
    if (p.physKey.includes('|ts|') || p.physKey.includes('|tsb|') || p.physKey.includes('|fitb|')) {
      const mk = p.mappingKey
      if (mk === 'GRASS') return RM_PASSAGE_BUSH
      if (mk === 'WATER') return RM_PASSAGE_SOLID
      return RM_PASSAGE_OPEN
    }
    return RM_PASSAGE_OPEN
  }

  /** @param {{ physKey: string, mappingKey?: string }} p */
  const priorityForPhysical = (p) => {
    if (p.physKey.includes('|f32|t|')) return RM_PRIORITY_NORMAL
    if (p.physKey.includes('|f32|m|') || p.physKey.includes('|f32|b|')) return RM_PRIORITY_BELOW
    if (p.mappingKey === 'CLIFF' || p.mappingKey === 'CLIFF_DOUBLE' || p.mappingKey === 'CLIFF_DOUBLE_PART2') return RM_PRIORITY_BELOW
    if (p.physKey.includes('|ts|') || p.physKey.includes('|tsb|')) return RM_PRIORITY_BELOW
    return RM_PRIORITY_BELOW
  }

  /** Essentials: tag **2** (Grass) expects Bush flag on passage; tag **7** (Water) = surf / MovingWater. */
  const terrainTagForPhysical = (p) => {
    if (p.physKey.includes('|ts|') || p.physKey.includes('|tsb|') || p.physKey.includes('|fitb|')) {
      const mk = p.mappingKey
      if (mk === 'GRASS') return PE_TERRAIN_GRASS
      if (mk === 'WATER') return PE_TERRAIN_WATER
    }
    return PE_TERRAIN_NONE
  }

  const compositeCliffs = !!opts?.compositeCliffs
  const cliffCombos =
    opts?.cliffCombos && typeof opts.cliffCombos[Symbol.iterator] === 'function' ? opts.cliffCombos : null
  const cliffDoubleCombos =
    opts?.cliffDoubleCombos && typeof opts.cliffDoubleCombos[Symbol.iterator] === 'function'
      ? opts.cliffDoubleCombos
      : null

  /**
   * One mapping key’s rects; order is driven by callers (ground/grass/road/water first, then cliff strip, then forest keys).
   * @param {string} mappingKey
   */
  function appendPhysicalForMappingKey(mappingKey) {
    if (useTreeByBiomeForest && FOREST_SHEET_MAPPING_KEYS.has(mappingKey)) return
    if (compositeCliffs && mappingKey === 'CLIFF') return
    // Special case: biome-aware GROUND/ROAD/GRASS/WATER/CLIFF wang strips.
    if (
      (mappingKey === 'GROUND' ||
        mappingKey === 'ROAD' ||
        mappingKey === 'GRASS' ||
        mappingKey === 'WATER' ||
        (mappingKey === 'CLIFF' && !compositeCliffs)) &&
      mapping?.[`${mappingKey}_BY_BIOME`] &&
      typeof mapping[`${mappingKey}_BY_BIOME`] === 'object'
    ) {
      const byBiome = mapping[`${mappingKey}_BY_BIOME`]
      const baseSlot = slotForMappingKey(mapping, mappingKey)
      const isTileset = !!baseSlot?.isTileset
      for (const [biomeKey, id] of Object.entries(byBiome)) {
        if (!id) continue
        const assetId = String(id)
        const img = imgs.get(assetId)
        if (!img || img.width < 1) continue
        const biomeId = Number(biomeKey)
        if (!Number.isFinite(biomeId)) continue
        const usedCat =
          mappingKey === 'GROUND'
            ? 'ground'
            : mappingKey === 'ROAD'
              ? 'road'
              : mappingKey === 'GRASS'
                ? 'grass'
                : mappingKey === 'WATER'
                  ? 'water'
                  : 'cliffStrip'
        if (!usedBiomeAllowsPack(usedBiomes, usedCat, biomeId)) continue

        if (isTileset) {
          const tw = img.width / MG_WANG_COLS
          const th = img.height / MG_WANG_ROWS
          const groupId = `${assetId}|tsb|${biomeId}|${mappingKey}`
          for (let i = 0; i < MG_WANG_SEMANTIC_COUNT; i++) {
            const cell = mgWangExportCellForPack(i, mappingKey)
            if (!cell) continue
            const [col, row] = cell
            // WATER fill (index 12) shares a single physKey across all biomes — dedup handles the rest.
            const physKey = (mappingKey === 'WATER' && i === WATER_FILL_WANG_INDEX)
              ? `${mappingKey}${WATER_FILL_PHYS_KEY_SUFFIX}`
              : `${assetId}|tsb|${biomeId}|${i}`
            const sx = col * tw
            const sy = row * th
            physical.push({
              physKey,
              assetId,
              isTileset: true,
              wangIndex: i,
              destW: TILE_PX,
              destH: TILE_PX,
              mappingKey,
              biomeId,
              wangExportPack: { groupId, col, row },
              draw: (ctx, ax, ay) => {
                ctx.drawImage(img, sx, sy, tw, th, ax, ay, TILE_PX, TILE_PX)
              },
            })
          }
        } else {
          const physKey = `${assetId}|fitb|${biomeId}`
          physical.push({
            physKey,
            assetId,
            isTileset: false,
            wangIndex: 0,
            destW: TILE_PX,
            destH: TILE_PX,
            mappingKey,
            biomeId,
            draw: (ctx, ax, ay) => {
              drawImageContain32(ctx, img, ax, ay)
            },
          })
        }
      }
      return
    }

    const slot = slotForMappingKey(mapping, mappingKey)
    const assetId = slot?.assetId
    if (!assetId) return
    const img = imgs.get(assetId)
    if (!img || img.width < 1) return

    if (slot.isTileset) {
      const tw = img.width / MG_WANG_COLS
      const th = img.height / MG_WANG_ROWS
      const groupId = `${assetId}|ts|${mappingKey}`
      for (let i = 0; i < MG_WANG_SEMANTIC_COUNT; i++) {
        const cell = mgWangExportCellForPack(i, mappingKey)
        if (!cell) continue
        const [col, row] = cell
        const physKey = `${assetId}|ts|${i}`
        const sx = col * tw
        const sy = row * th
        physical.push({
          physKey,
          assetId,
          isTileset: true,
          wangIndex: i,
          destW: TILE_PX,
          destH: TILE_PX,
          mappingKey,
          wangExportPack: { groupId, col, row },
          draw: (ctx, ax, ay) => {
            ctx.drawImage(img, sx, sy, tw, th, ax, ay, TILE_PX, TILE_PX)
          },
        })
      }
    } else if (
      FOREST_SHEET_MAPPING_KEYS.has(mappingKey) &&
      img.width % 3 === 0 &&
      img.height % 3 === 0
    ) {
      if (forest32Packed.has(assetId)) {
        /* chunks already queued for this tree sheet */
      } else {
        forest32Packed.add(assetId)
        pushForest32PhysicalRects(assetId, img, physical)
      }
    } else {
      const physKey = `${assetId}|fit|0`
      physical.push({
        physKey,
        assetId,
        isTileset: false,
        wangIndex: 0,
        destW: TILE_PX,
        destH: TILE_PX,
        mappingKey,
        draw: (ctx, ax, ay) => {
          drawImageContain32(ctx, img, ax, ay)
        },
      })
    }
  }

  for (const mappingKey of MG_TILESET_PACK_ORDER_LAND_WATER) {
    appendPhysicalForMappingKey(mappingKey)
  }

  // Composite cliffs (export-only): build exact (upBiome, downBiome, tileIndex) tiles.
  if (compositeCliffs && cliffCombos) {
    const gb = mapping?.GROUND_BY_BIOME ?? null
    const cb = mapping?.CLIFF_BY_BIOME ?? null

    /** @type {Map<string, { img: HTMLImageElement, tw: number, th: number }>} */
    const cliffCache = new Map()
    const getCliff = (biomeHigh) => {
      const pick =
        (cb && typeof cb === 'object' ? (cb[biomeHigh | 0] ?? cb[0]) : null) ||
        slotForMappingKey(mapping, 'CLIFF')?.assetId ||
        null
      const cliffId = pick ? String(pick) : ''
      if (!cliffId) return null
      const cached = cliffCache.get(cliffId)
      if (cached) return { cliffId, ...cached }
      const img = imgs.get(cliffId)
      if (!img || img.width < 1 || img.height < 1) return null
      const tw = img.width / MG_WANG_COLS
      const th = img.height / MG_WANG_ROWS
      if (!(tw > 0 && th > 0)) return null
      cliffCache.set(cliffId, { img, tw, th })
      return { cliffId, img, tw, th }
    }

    if (gb && typeof gb === 'object') {
      const any = getCliff(0)
      if (!any) {
        throw new Error(
          'Composite cliffs require a CLIFF overlay strip from the biome folders. ' +
          'Set the Cliff biome folder so `mapping.CLIFF_BY_BIOME[0]` (or `mapping.CLIFF.assetId`) points to an image in `assets/cliff/`.'
        )
      }
    }

    if (gb && typeof gb === 'object') {
      /** Sort so each `(cliffId, hi, lo)` group is contiguous for `wangExportPack` shelf layout. */
      const parsedCombos = []
      for (const key of cliffCombos) {
        const parts = String(key).split(':')
        if (parts.length !== 3) continue
        const hi = Number(parts[0])
        const lo = Number(parts[1])
        const ti = Number(parts[2])
        if (!Number.isFinite(hi) || !Number.isFinite(lo) || !Number.isFinite(ti)) continue
        parsedCombos.push({ hi: hi | 0, lo: lo | 0, ti: ti | 0 })
      }
      parsedCombos.sort((a, b) => {
        if (a.lo !== b.lo) return a.lo - b.lo
        if (a.hi !== b.hi) return a.hi - b.hi
        return a.ti - b.ti
      })

      for (const { hi, lo, ti } of parsedCombos) {
        const cliff = getCliff(hi)
        if (!cliff) throw new Error(`Missing cliff overlay for biome ${hi} (CLIFF_BY_BIOME).`)

        const cell = mgWangExportCellForPack(ti, 'CLIFF')
        if (!cell) continue

        const [col, row] = cell
        const sx = col * cliff.tw
        const sy = row * cliff.th

        // Inner corners (ti 8–11, cols 3–4) are opaque cliff-face — ground never shows through.
        // Key by (cliffId, hi, ti) only so they're shared across all lo biomes.
        const isInner = ti >= 8 && ti <= 11
        const physKey = isInner
          ? `${cliff.cliffId}|cliffinner|${hi}|${ti}`
          : `${cliff.cliffId}|cliffcomp|${hi}|${lo}|${ti}`
        const groupId = isInner
          ? `${cliff.cliffId}|cliffinnergrid|${hi}`
          : `${cliff.cliffId}|cliffcompgrid|${hi}|${lo}`

        const groundId = !isInner ? (gb[lo] ?? gb[0]) : null
        const groundImg = groundId ? imgs.get(groundId) : null
        if (!isInner && !groundImg) continue
        physical.push({
          physKey,
          assetId: cliff.cliffId,
          isTileset: false,
          wangIndex: ti,
          destW: TILE_PX,
          destH: TILE_PX,
          mappingKey: 'CLIFF',
          wangExportPack: { groupId, col, row },
          draw: (ctx, ax, ay) => {
            if (groundImg) ctx.drawImage(groundImg, 0, 0, groundImg.width, groundImg.height, ax, ay, TILE_PX, TILE_PX)
            ctx.drawImage(cliff.img, sx, sy, cliff.tw, cliff.th, ax, ay, TILE_PX, TILE_PX)
          },
        })
      }
    }
  }

  appendPhysicalForMappingKey('CLIFF')

  // Cliff double tiles (export-only): split into two atlas blocks per biome.
  //
  // cdcomp — 3×4 block (cols 0–2, 96×128 px) per (hi, lo) pair: composite outer/edge tiles with ground underlay.
  //   physKey = `${cdId}|cdcomp|${hi}|${lo}`
  //
  // cdinner — 2×4 block (cols 3–4, 64×128 px) per hi biome: inner corners only, no ground, shared across all lo.
  //   physKey = `${cdId}|cdinner|${hi}`
  //   Packed col offset: sheet col 3 → block col 0, sheet col 4 → block col 1.
  if (cliffDoubleCombos) {
    const cdb = mapping?.CLIFF_DOUBLE_BY_BIOME ?? null
    const gb = mapping?.GROUND_BY_BIOME ?? null
    const seenCompBlocks = new Set()
    const seenInnerBlocks = new Set()
    const hiLoSet = new Set()
    for (const key of cliffDoubleCombos) {
      const parts = String(key).split(':')
      if (parts.length < 2) continue
      const hi = Number(parts[0])
      const lo = Number(parts[1])
      if (Number.isFinite(hi) && Number.isFinite(lo)) hiLoSet.add(`${hi | 0}:${lo | 0}`)
    }
    for (const pair of [...hiLoSet].sort()) {
      const [hiS, loS] = pair.split(':')
      const hi = Number(hiS)
      const lo = Number(loS)
      const cdRaw = (cdb && typeof cdb === 'object' ? (cdb[hi] ?? cdb[0]) : null)
      const cdId = cdRaw ? String(cdRaw) : ''
      if (!cdId) continue
      const cdImg = imgs.get(cdId)
      if (!cdImg || cdImg.width < 1 || cdImg.height < 1) continue
      const tw = cdImg.width / MG_CLIFF_DOUBLE_COLS
      const th = cdImg.height / MG_CLIFF_DOUBLE_ROWS

      // --- 3×4 composite block (outer corners + edges, cols 0–2) ---
      const compKey = `${cdId}|cdcomp|${hi}|${lo}`
      if (!seenCompBlocks.has(compKey)) {
        seenCompBlocks.add(compKey)
        const groundRaw = (gb && typeof gb === 'object' ? (gb[lo] ?? gb[0]) : null)
        const groundImg = groundRaw ? imgs.get(String(groundRaw)) : null
        const compW = 3 * TILE_PX  // 96
        const compH = MG_CLIFF_DOUBLE_ROWS * TILE_PX  // 128
        const compOccupied = []
        const compOccupiedSeen = new Set()
        for (let ti = 0; ti < 12; ti++) {
          const e = MG_CLIFF_DOUBLE_CD_MAP[ti]
          if (!e) continue
          const [p1col, p1row, p2col, p2row] = e
          if (p1col <= 2) {
            const k1 = `${p1col},${p1row}`
            if (!compOccupiedSeen.has(k1)) { compOccupiedSeen.add(k1); compOccupied.push([p1col, p1row]) }
          }
          if (p2col != null && p2col <= 2) {
            const k2 = `${p2col},${p2row}`
            if (!compOccupiedSeen.has(k2)) { compOccupiedSeen.add(k2); compOccupied.push([p2col, p2row]) }
          }
        }
        const innerKey = `${cdId}|cdinner|${hi}`
        const compEntry = {
          physKey: compKey,
          assetId: cdId,
          isTileset: false,
          wangIndex: 0,
          destW: compW,
          destH: compH,
          mappingKey: 'CLIFF_DOUBLE',
          occupiedOffsets: compOccupied,
          cdExportBlock: true,
          cdInnerSidecarPhysKey: innerKey,
          cdInnerSidecarIdx: null, // resolved after dedup
          draw: (ctx, ax, ay) => {
            for (let ti = 0; ti < 12; ti++) {
              const e = MG_CLIFF_DOUBLE_CD_MAP[ti]
              if (!e) continue
              const [p1col, p1row, p2col, p2row] = e
              if (p1col <= 2) {
                const dx1 = ax + p1col * TILE_PX
                const dy1 = ay + p1row * TILE_PX
                if (groundImg) ctx.drawImage(groundImg, 0, 0, groundImg.width, groundImg.height, dx1, dy1, TILE_PX, TILE_PX)
                ctx.drawImage(cdImg, p1col * tw, p1row * th, tw, th, dx1, dy1, TILE_PX, TILE_PX)
              }
              if (p2col != null && p2col <= 2) {
                const dx2 = ax + p2col * TILE_PX
                const dy2 = ay + p2row * TILE_PX
                if (groundImg) ctx.drawImage(groundImg, 0, 0, groundImg.width, groundImg.height, dx2, dy2, TILE_PX, TILE_PX)
                ctx.drawImage(cdImg, p2col * tw, p2row * th, tw, th, dx2, dy2, TILE_PX, TILE_PX)
              }
            }
          },
        }
        physical.push(compEntry)

        // --- 2×4 inner-corner sidecar (cols 3–4, no ground) — one per hi biome, placed right of comp ---
        if (!seenInnerBlocks.has(innerKey)) {
          seenInnerBlocks.add(innerKey)
          const innerW = 2 * TILE_PX  // 64
          const innerH = MG_CLIFF_DOUBLE_ROWS * TILE_PX  // 128
          const innerOccupied = []
          const innerOccupiedSeen = new Set()
          for (let ti = 0; ti < 12; ti++) {
            const e = MG_CLIFF_DOUBLE_CD_MAP[ti]
            if (!e) continue
            const [p1col, p1row, p2col, p2row] = e
            if (p1col >= 3) {
              const bc = p1col - 3
              const k1 = `${bc},${p1row}`
              if (!innerOccupiedSeen.has(k1)) { innerOccupiedSeen.add(k1); innerOccupied.push([bc, p1row]) }
            }
            if (p2col != null && p2col >= 3) {
              const bc = p2col - 3
              const k2 = `${bc},${p2row}`
              if (!innerOccupiedSeen.has(k2)) { innerOccupiedSeen.add(k2); innerOccupied.push([bc, p2row]) }
            }
          }
          physical.push({
            physKey: innerKey,
            assetId: cdId,
            isTileset: false,
            wangIndex: 0,
            destW: innerW,
            destH: innerH,
            mappingKey: 'CLIFF_DOUBLE',
            occupiedOffsets: innerOccupied,
            cdInnerSidecar: true, // placed by comp block layout, not independently
            draw: (ctx, ax, ay) => {
              for (let ti = 0; ti < 12; ti++) {
                const e = MG_CLIFF_DOUBLE_CD_MAP[ti]
                if (!e) continue
                const [p1col, p1row, p2col, p2row] = e
                if (p1col >= 3) {
                  const dx1 = ax + (p1col - 3) * TILE_PX
                  const dy1 = ay + p1row * TILE_PX
                  ctx.drawImage(cdImg, p1col * tw, p1row * th, tw, th, dx1, dy1, TILE_PX, TILE_PX)
                }
                if (p2col != null && p2col >= 3) {
                  const dx2 = ax + (p2col - 3) * TILE_PX
                  const dy2 = ay + p2row * TILE_PX
                  ctx.drawImage(cdImg, p2col * tw, p2row * th, tw, th, dx2, dy2, TILE_PX, TILE_PX)
                }
              }
            },
          })
        }
      }
    }
  }

  if (useTreeByBiomeForest && tbForest) {
    const seenAsset = new Set()
    for (const [biomeKey, id] of Object.entries(tbForest)) {
      if (!id || String(id).trim() === '') continue
      const biomeId = Number(biomeKey)
      if (!Number.isFinite(biomeId)) continue
      if (!usedBiomeAllowsPack(usedBiomes, 'trees', biomeId)) continue
      const assetId = String(id)
      if (seenAsset.has(assetId)) continue
      seenAsset.add(assetId)
      const img = imgs.get(assetId)
      if (!img) continue
      pushForest32PhysicalRects(assetId, img, physical)
      forest32Packed.add(assetId)
    }
  }

  for (const mappingKey of MG_TILESET_PACK_ORDER_FOREST) {
    appendPhysicalForMappingKey(mappingKey)
  }

  const seen = new Map()
  const uniqueOrder = []
  for (const p of physical) {
    if (seen.has(p.physKey)) continue
    seen.set(p.physKey, true)
    uniqueOrder.push(p)
  }

  // Resolve cdInnerSidecarPhysKey → uniqueOrder index now that dedup is done.
  const physKeyToUniqueIdx = new Map()
  uniqueOrder.forEach((p, idx) => physKeyToUniqueIdx.set(p.physKey, idx))
  for (const p of uniqueOrder) {
    if (p.cdInnerSidecarPhysKey) {
      p.cdInnerSidecarIdx = physKeyToUniqueIdx.get(p.cdInnerSidecarPhysKey) ?? null
    }
  }

  const treeIndices = new Set()
  uniqueOrder.forEach((p, idx) => {
    if (p.physKey.includes('|tree|') && !p.physKey.includes('|f32|')) treeIndices.add(idx)
  })
  const { positions, totalH: rawTotalH } = layoutMgTilesetRects(uniqueOrder, ATLAS_MAX_WIDTH_PX, treeIndices)

  // Post-process: per-column compaction starting from row 2 (rows 0-1 are fixed).
  // Repeatedly scans each column for runs of ≥2 consecutive empty cells and shifts
  // everything below upward by that run length. Repeats until no more shifts occur.
  // Single empty cells (e.g. cliff middle placeholder) are left alone.
  ;(function compactColumns() {
    const SKIP_ROWS = 2
    const tileCols = ATLAS_MAX_WIDTH_PX / TILE_PX  // 8

    const buildOccupied = () => {
      const occ = new Set()
      for (let idx = 0; idx < uniqueOrder.length; idx++) {
        const pos = positions[idx]
        if (!pos) continue
        const cx0 = pos.x / TILE_PX
        const cy0 = pos.y / TILE_PX
        const cw = Math.round(pos.destW / TILE_PX)
        const ch = Math.round(pos.destH / TILE_PX)
        for (let dr = 0; dr < ch; dr++)
          for (let dc = 0; dc < cw; dc++)
            occ.add(`${cx0 + dc},${cy0 + dr}`)
      }
      return occ
    }

    let anyShifted = true
    while (anyShifted) {
      anyShifted = false
      const totalRows = Math.ceil(positions.reduce((m, p) => p ? Math.max(m, p.y + p.destH) : m, TILE_PX) / TILE_PX)
      const occupied = buildOccupied()

      /** @type {Array<{start: number, len: number} | null>} */
      const colGap = Array(tileCols).fill(null)
      for (let col = 0; col < tileCols; col++) {
        let runStart = -1, runLen = 0
        for (let row = SKIP_ROWS; row < totalRows; row++) {
          if (!occupied.has(`${col},${row}`)) {
            if (runStart === -1) { runStart = row; runLen = 0 }
            runLen++
          } else {
            if (runLen >= 2) { colGap[col] = { start: runStart, len: runLen }; break }
            runStart = -1; runLen = 0
          }
        }
      }

      for (let idx = 0; idx < uniqueOrder.length; idx++) {
        const pos = positions[idx]
        if (!pos) continue
        const cy0 = pos.y / TILE_PX
        if (cy0 < SKIP_ROWS) continue

        const cx0 = pos.x / TILE_PX
        const cw = Math.round(pos.destW / TILE_PX)
        const ch = Math.round(pos.destH / TILE_PX)
        let minShift = Infinity

        outer: for (let dr = 0; dr < ch; dr++) {
          for (let dc = 0; dc < cw; dc++) {
            const col = cx0 + dc
            const row = cy0 + dr
            if (col >= tileCols) continue
            const gap = colGap[col]
            if (!gap || gap.start >= row) { minShift = 0; break outer }
            minShift = Math.min(minShift, gap.len)
          }
        }

        if (minShift > 0 && minShift !== Infinity) {
          pos.y -= minShift * TILE_PX
          anyShifted = true
        }
      }
    }
  })()

  const totalH = positions.reduce((max, pos) => pos ? Math.max(max, pos.y + pos.destH) : max, TILE_PX)

  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_MAX_WIDTH_PX
  canvas.height = totalH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create tileset canvas context.')
  ctx.imageSmoothingEnabled = false

  const tilesWide = ATLAS_MAX_WIDTH_PX / 32
  /** Track which 32×32 cells are occupied by a real tile. */
  const occupiedCells = new Set()
  const physToRm = new Map()
  for (let idx = 0; idx < uniqueOrder.length; idx++) {
    const p = uniqueOrder[idx]
    const pos = positions[idx]
    const rmTileId = RM_STATIC_TILE_ID_BASE + (pos.y / 32) * tilesWide + (pos.x / 32)
    p.draw(ctx, pos.x, pos.y)
    const cellX0 = pos.x / TILE_PX
    const cellY0 = pos.y / TILE_PX
    if (p.occupiedOffsets) {
      for (const [oc, or_] of p.occupiedOffsets) {
        occupiedCells.add(`${cellX0 + oc},${cellY0 + or_}`)
      }
    } else {
      const cellCols = Math.ceil(pos.destW / TILE_PX)
      const cellRows = Math.ceil(pos.destH / TILE_PX)
      for (let cy = 0; cy < cellRows; cy++) {
        for (let cx = 0; cx < cellCols; cx++) {
          occupiedCells.add(`${cellX0 + cx},${cellY0 + cy}`)
        }
      }
    }
    physToRm.set(p.physKey, rmTileId)
    // Cliff-double blocks: push a solid passage entry for every sub-tile in the 5×4 grid.
    if (p.cdExportBlock && p.occupiedOffsets) {
      for (const [oc, or_] of p.occupiedOffsets) {
        const subId = RM_STATIC_TILE_ID_BASE + ((pos.y / 32) + or_) * tilesWide + ((pos.x / 32) + oc)
        tiles.push({ rmTileId: subId, passage: RM_PASSAGE_SOLID, priority: RM_PRIORITY_BELOW, terrainTag: PE_TERRAIN_NONE, mappingKey: 'CLIFF_DOUBLE', packKind: 'other' })
      }
    }
    tiles.push({
      rmTileId,
      atlasIndex: idx,
      atlasX: pos.x,
      atlasY: pos.y,
      width: pos.destW,
      height: pos.destH,
      assetId: p.assetId,
      wangIndex: p.wangIndex,
      isTileset: p.isTileset,
      /** `GROUND` / `ROAD` / `CLIFF` / … when known — ties manifest rows to `rmTileIdForDerivedLayer` keys. */
      mappingKey: p.mappingKey ?? null,
      /** RPG Maker XP `@passages` int16 for this atlas cell (see `rmxpTilesets.mjs`). */
      passage: passageForPhysical(p),
      /** RPG Maker XP `@priorities` int16 (0 below / 1 same / 2 above player). */
      priority: priorityForPhysical(p),
      /** Pokémon Essentials-style `@terrain_tags` when targeting Essentials (0 = none). */
      terrainTag: terrainTagForPhysical(p),
      packKind: p.physKey.includes('|f32|')
        ? 'forest32'
        : p.physKey.includes('|tree|w|')
          ? 'treeWide'
          : p.physKey.includes('|tree|n|')
            ? 'treeNarrow'
            : p.physKey.includes('|fitb|') || p.physKey.includes('|fit|')
              ? 'contain'
              : p.physKey.includes('|tsb|') || p.physKey.includes('|ts|')
                ? 'wang'
                : 'other',
    })
  }

  const placeholderImg = imgs.get(MG_PLACEHOLDER_ASSET_ID)
  if (placeholderImg && placeholderImg.width > 0 && placeholderImg.height > 0) {
    const totalCellsX = ATLAS_MAX_WIDTH_PX / TILE_PX
    const totalCellsY = Math.ceil(totalH / TILE_PX)
    for (let cy = 0; cy < totalCellsY; cy++) {
      for (let cx = 0; cx < totalCellsX; cx++) {
        if (!occupiedCells.has(`${cx},${cy}`)) {
          ctx.drawImage(placeholderImg, 0, 0, placeholderImg.width, placeholderImg.height, cx * TILE_PX, cy * TILE_PX, TILE_PX, TILE_PX)
        }
      }
    }
  }

  lookup.clear()
  if (useTreeByBiomeForest && tbForest) {
    for (const [biomeKey, id] of Object.entries(tbForest)) {
      if (!id) continue
      const biomeId = Number(biomeKey)
      if (!Number.isFinite(biomeId)) continue
      if (!usedBiomeAllowsPack(usedBiomes, 'trees', biomeId)) continue
      const assetId = String(id)
      const img = imgs.get(assetId)
      if (!img || img.width % 3 !== 0 || img.height % 3 !== 0) continue
      registerForest32LookupForBiome(assetId, img, biomeId, physToRm, lookup)
    }
  }
  for (const mappingKey of MG_TILESET_MAPPING_KEYS) {
    if (useTreeByBiomeForest && FOREST_SHEET_MAPPING_KEYS.has(mappingKey)) continue
    if (compositeCliffs && mappingKey === 'CLIFF') continue
    if (
      (mappingKey === 'GROUND' ||
        mappingKey === 'ROAD' ||
        mappingKey === 'GRASS' ||
        mappingKey === 'WATER' ||
        (mappingKey === 'CLIFF' && !compositeCliffs)) &&
      mapping?.[`${mappingKey}_BY_BIOME`] &&
      typeof mapping[`${mappingKey}_BY_BIOME`] === 'object'
    ) {
      const byBiome = mapping[`${mappingKey}_BY_BIOME`]
      const baseSlot = slotForMappingKey(mapping, mappingKey)
      const isTileset = !!baseSlot?.isTileset
      /** Biome IDs that used water tileset (for wiring shared fill after loop). */
      const waterBiomeIds = []
      for (const [biomeKey, id] of Object.entries(byBiome)) {
        if (!id) continue
        const assetId = String(id)
        const img = imgs.get(assetId)
        if (!img) continue
        const biomeId = Number(biomeKey)
        if (!Number.isFinite(biomeId)) continue
        const usedCat =
          mappingKey === 'GROUND'
            ? 'ground'
            : mappingKey === 'ROAD'
              ? 'road'
              : mappingKey === 'GRASS'
                ? 'grass'
                : mappingKey === 'WATER'
                  ? 'water'
                  : 'cliffStrip'
        if (!usedBiomeAllowsPack(usedBiomes, usedCat, biomeId)) continue
        if (mappingKey === 'WATER' && isTileset) waterBiomeIds.push(biomeId)
        if (isTileset) {
          for (let i = 0; i < MG_WANG_SEMANTIC_COUNT; i++) {
            // WATER fill index 12 uses a shared physKey — wired to all biomes after the loop.
            if (mappingKey === 'WATER' && i === WATER_FILL_WANG_INDEX) continue
            const physKey = `${assetId}|tsb|${biomeId}|${i}`
            const rm = physToRm.get(physKey)
            if (rm !== undefined) lookup.set(`${mappingKey}:${biomeId | 0}:${i}`, rm)
          }
        } else {
          const physKey = `${assetId}|fitb|${biomeId}`
          const rm = physToRm.get(physKey)
          if (rm !== undefined) {
            for (let i = 0; i < MG_WANG_SEMANTIC_COUNT; i++) lookup.set(`${mappingKey}:${biomeId | 0}:${i}`, rm)
          }
        }
      }
      // Wire shared WATER fill (index 12) to all participating biomes.
      if (mappingKey === 'WATER' && isTileset && waterBiomeIds.length) {
        const fillRm = physToRm.get(`WATER${WATER_FILL_PHYS_KEY_SUFFIX}`)
        if (fillRm !== undefined) {
          for (const bid of waterBiomeIds) {
            lookup.set(`WATER:${bid}:${WATER_FILL_WANG_INDEX}`, fillRm)
          }
        }
      }
      // Also populate fallback `${mappingKey}:*` from mapping slot assetId if present.
      const slot = slotForMappingKey(mapping, mappingKey)
      const fallbackId = slot?.assetId
      const img = fallbackId ? imgs.get(fallbackId) : null
      if (slot?.isTileset && fallbackId && img) {
        for (let i = 0; i < MG_WANG_SEMANTIC_COUNT; i++) {
          const physKey = `${fallbackId}|ts|${i}`
          const rm = physToRm.get(physKey)
          if (rm !== undefined) lookup.set(`${mappingKey}:${i}`, rm)
        }
      }
      continue
    }
    const slot = slotForMappingKey(mapping, mappingKey)
    const assetId = slot?.assetId
    if (!assetId) continue
    const img = imgs.get(assetId)
    if (!img) continue
    if (slot.isTileset) {
      for (let i = 0; i < MG_WANG_SEMANTIC_COUNT; i++) {
        const physKey = `${assetId}|ts|${i}`
        const rm = physToRm.get(physKey)
        if (rm !== undefined) lookup.set(`${mappingKey}:${i}`, rm)
      }
    } else if (FOREST_SHEET_MAPPING_KEYS.has(mappingKey) && img.width % 3 === 0 && img.height % 3 === 0) {
      const cw = img.width / 3
      const ch = img.height / 3
      for (let v = 0; v < 3; v++) {
        for (let ni = 0; ni < 2; ni++) {
          const ft = ni ? v * 2 + 1 : v * 2
          const sw = ni ? cw : 2 * cw
          const sh = ch
          const topH = sh / 3
          const bodyH = sh / 3
          const trunkH = sh / 3
          const cols = Math.ceil(sw / TILE_PX)
          const rowsTop = Math.ceil(topH / TILE_PX)
          const rowsBody = Math.ceil(bodyH / TILE_PX)
          const rowsTrunk = Math.ceil(trunkH / TILE_PX)
          let sub = 0
          for (let ty = 0; ty < rowsTop; ty++) {
            for (let tx = 0; tx < cols; tx++) {
              const rm = physToRm.get(`${assetId}|f32|t|${v}|${ni}|${tx}|${ty}`)
              if (rm !== undefined) lookup.set(`FOREST_TOP:${ft}:${sub++}`, rm)
            }
          }
          sub = 0
          for (let ty = 0; ty < rowsBody; ty++) {
            for (let tx = 0; tx < cols; tx++) {
              const rm = physToRm.get(`${assetId}|f32|m|${v}|${ni}|${tx}|${ty}`)
              if (rm !== undefined) lookup.set(`FOREST_BODY:${ft}:${sub++}`, rm)
            }
          }
          sub = 0
          for (let ty = 0; ty < rowsTrunk; ty++) {
            for (let tx = 0; tx < cols; tx++) {
              const rm = physToRm.get(`${assetId}|f32|b|${v}|${ni}|${tx}|${ty}`)
              if (rm !== undefined) lookup.set(`FOREST_TRUNK:${ft}:${sub++}`, rm)
            }
          }
        }
      }
      const fillerTop = physToRm.get(`${assetId}|f32|t|0|0|0|0`)
      const fillerBody = physToRm.get(`${assetId}|f32|m|0|0|0|0`)
      const fillerTrunk = physToRm.get(`${assetId}|f32|b|0|0|0|0`)
      for (let i = 6; i < MG_WANG_SEMANTIC_COUNT; i++) {
        if (mappingKey === 'FOREST_TOP' && fillerTop !== undefined) {
          lookup.set(`${mappingKey}:${i}`, fillerTop)
        } else if (mappingKey === 'FOREST_TRUNK' && fillerTrunk !== undefined) {
          lookup.set(`${mappingKey}:${i}`, fillerTrunk)
        } else if (fillerBody !== undefined) {
          lookup.set(`${mappingKey}:${i}`, fillerBody)
        }
      }
    } else {
      const physKey = `${assetId}|fit|0`
      const rm = physToRm.get(physKey)
      if (rm !== undefined) {
        for (let i = 0; i < MG_WANG_SEMANTIC_COUNT; i++) {
          lookup.set(`${mappingKey}:${i}`, rm)
        }
      }
    }
  }

  // Lookup entries for composite cliffs.
  if (compositeCliffs && cliffCombos) {
    const cb = mapping?.CLIFF_BY_BIOME ?? null
    const fallbackCliffId = slotForMappingKey(mapping, 'CLIFF')?.assetId || ''
    for (const key of cliffCombos) {
      const parts = String(key).split(':')
      if (parts.length !== 3) continue
      const hi = Number(parts[0])
      const lo = Number(parts[1])
      const ti = Number(parts[2])
      if (!Number.isFinite(hi) || !Number.isFinite(lo) || !Number.isFinite(ti)) continue

      const pick =
        (cb && typeof cb === 'object' ? (cb[hi | 0] ?? cb[0]) : null) ||
        fallbackCliffId ||
        null
      const cliffId = pick ? String(pick) : ''
      if (!cliffId) continue

      const tiN = ti | 0
      const isInner = tiN >= 8 && tiN <= 11
      const physKey = isInner
        ? `${cliffId}|cliffinner|${hi | 0}|${tiN}`
        : `${cliffId}|cliffcomp|${hi | 0}|${lo | 0}|${tiN}`
      const rm = physToRm.get(physKey)
      if (rm !== undefined) lookup.set(`CLIFF:${hi | 0}:${lo | 0}:${tiN}`, rm)
    }
  }

  // Lookup entries for cliff double tiles — keyed as CLIFF_DOUBLE:hi:lo:ti (matches rmTileIdForDerivedLayer).
  // Composite tiles (ti 0–7, cols 0–2) come from cdcomp block; inner corners (ti 8–11, cols 3–4) from cdinner block.
  if (cliffDoubleCombos) {
    const cdb = mapping?.CLIFF_DOUBLE_BY_BIOME ?? null
    const hiLoSet = new Set()
    for (const key of cliffDoubleCombos) {
      const parts = String(key).split(':')
      if (parts.length < 2) continue
      const hi = Number(parts[0])
      const lo = Number(parts[1])
      if (Number.isFinite(hi) && Number.isFinite(lo)) hiLoSet.add(`${hi | 0}:${lo | 0}`)
    }
    for (const pair of hiLoSet) {
      const [hiS, loS] = pair.split(':')
      const hi = Number(hiS)
      const lo = Number(loS)
      const cdRaw = (cdb && typeof cdb === 'object' ? (cdb[hi] ?? cdb[0]) : null)
      const cdId = cdRaw ? String(cdRaw) : ''
      if (!cdId) continue
      const compBase = physToRm.get(`${cdId}|cdcomp|${hi}|${lo}`)
      const innerBase = physToRm.get(`${cdId}|cdinner|${hi}`)
      for (let ti = 0; ti < 12; ti++) {
        const entry = MG_CLIFF_DOUBLE_CD_MAP[ti]
        if (!entry) continue
        const [p1col, p1row, p2col, p2row] = entry
        const isInner = p1col >= 3
        if (isInner) {
          // Inner corner: col remapped to 0-based within the 2-wide inner block.
          if (innerBase !== undefined) {
            lookup.set(`CLIFF_DOUBLE:${hi}:${lo}:${ti}`, innerBase + p1row * tilesWide + (p1col - 3))
            if (p2col != null && p2row != null) {
              lookup.set(`CLIFF_DOUBLE_PART2:${hi}:${lo}:${ti}`, innerBase + p2row * tilesWide + (p2col - 3))
            }
          }
        } else {
          if (compBase !== undefined) {
            lookup.set(`CLIFF_DOUBLE:${hi}:${lo}:${ti}`, compBase + p1row * tilesWide + p1col)
            if (p2col != null && p2row != null) {
              lookup.set(`CLIFF_DOUBLE_PART2:${hi}:${lo}:${ti}`, compBase + p2row * tilesWide + p2col)
            }
          }
        }
      }
    }
  }

  return { canvas, lookup: freezeRmTileLookupForExport(lookup), tiles }
}

/**
 * @param {CanvasImageSource} img
 * @returns {{ cw: number, ch: number } | null}
 */
export function getForestSheetMetrics(img) {
  if (!img || img.width % 3 !== 0 || img.height % 3 !== 0) return null
  return { cw: img.width / 3, ch: img.height / 3 }
}

/**
 * Map one tree anchor to several 32×32 RM cells: layer3 = upper 2/3 of tree art, layer2 = bottom 1/3 (trunk), matching `drawMgForestPart`.
 *
 * @param {number} ft — 0..5: even = wide (2×3 tiles), odd = narrow (1×3); row = floor(ft/2) (`layer2.tileIndex` on anchor)
 * @param {Map<string, number>} rmLookup — `FOREST_TOP:${biome}:${ft}:${sub}` (or legacy `FOREST_TOP:${ft}:${sub}`)
 * @param {number} [biomeId] — panel cell biome for `TREE_BY_BIOME` tree sheets
 */
export function buildForestRmStampList(ft, rmLookup, cw, ch, biomeId) {
  const sw = (ft & 1) === 1 ? cw : 2 * cw
  const sh = ch
  const bandH = sh / 3
  const cols = Math.ceil(sw / TILE_PX)
  const rows = Math.ceil(bandH / TILE_PX)

  /** @returns {{ rm: number, semKey: string } | null} */
  const resolve = (mk, sub) => {
    if (Number.isFinite(biomeId)) {
      const k1 = `${mk}:${biomeId | 0}:${ft}:${sub}`
      const r1 = rmLookup.get(k1)
      if (r1 != null) return { rm: r1, semKey: k1 }
    }
    const k2 = `${mk}:${ft}:${sub}`
    const r2 = rmLookup.get(k2)
    if (r2 == null) return null
    return { rm: r2, semKey: k2 }
  }

  const stamps = []
  let sub = 0
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const hit = resolve('FOREST_TOP', sub++)
      if (!hit) continue
      stamps.push({ dx: tx, dy: -2 + ty, layer: 3, rmTileId: hit.rm, semKey: hit.semKey })
    }
  }
  sub = 0
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const hit = resolve('FOREST_BODY', sub++)
      if (!hit) continue
      stamps.push({ dx: tx, dy: -1 + ty, layer: 2, rmTileId: hit.rm, semKey: hit.semKey })
    }
  }
  sub = 0
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const hit = resolve('FOREST_TRUNK', sub++)
      if (!hit) continue
      stamps.push({ dx: tx, dy: 0 + ty, layer: 1, rmTileId: hit.rm, semKey: hit.semKey })
    }
  }
  return stamps
}
