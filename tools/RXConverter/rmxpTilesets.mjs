/**
 * Patch RPG Maker XP `Tilesets.rxdata` (Marshal Array: index 0 null, 1+ = RPG::Tileset).
 */
import fs from 'node:fs'
import { dump, load, RubyObject } from '@hyrious/marshal'
import { patchRmxpTable1DRange } from './rmxpTable.mjs'

const sym = (s) => Symbol.for(s)

/** First tile id in the static B/C region (matches Grasswhistle atlas). */
export const RM_STATIC_TILE_ID_BASE = 384

/** RPG Maker XP `RPG::Tileset#passages` int16 — fully open floor (no block bits). */
export const RM_PASSAGE_OPEN = 0
/** All four cardinal passage bits set — cannot walk onto the tile (water, cliffs, tree trunk/body). */
export const RM_PASSAGE_SOLID = 15
/** Star flag — drawn above character; passability is determined by lower layers. */
export const RM_PASSAGE_STAR = 0x10
/**
 * Bush flag — same bit as the Database “Bush flag” (player/event feet transparent in grass or shallow water).
 * In `RPG::Tileset#passages` int16 it is **0x40**, combined with directional passage bits.
 */
export const RM_PASSAGE_BUSH = 0x40

/** RPG Maker XP `RPG::Tileset#priorities` int16 — 0 below player, 1 same, 2 above. */
export const RM_PRIORITY_BELOW = 0
export const RM_PRIORITY_NORMAL = 1
export const RM_PRIORITY_ABOVE = 2

/**
 * Pokémon Essentials `TerrainTag` (script section TerrainTag) — only tags the RM XP editor shows (0–7) are set here.
 * Grass (2): pairs with **Bush flag** on passage; water (7): surf / MovingWater. See Essentials wiki / TerrainTag.
 */
export const PE_TERRAIN_NONE = 0
export const PE_TERRAIN_GRASS = 2
export const PE_TERRAIN_WATER = 7

function utf8(s) {
  return new TextEncoder().encode(String(s))
}

function pickDonorIndex(arr, slotId) {
  const o = arr[slotId]
  if (o != null && typeof o === 'object') return slotId
  for (let i = 1; i < arr.length; i++) {
    const x = arr[i]
    if (x != null && typeof x === 'object') return i
  }
  return -1
}

function patchStaticTileTables(tilesetObj, fromIdx, toIdx) {
  const keys = [sym('@passages'), sym('@priorities'), sym('@terrain_tags')]
  for (const k of keys) {
    const tbl = tilesetObj[k]
    if (tbl && tbl.userDefined instanceof Uint8Array) {
      // Tables may be either:
      // - A full tile-id indexed strip (0..len-1, includes A region), or
      // - A static-only strip (len=384) indexed by (tileId - 384).
      // We don't assume; we map based on the table length.
      const bytes = tbl.userDefined
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const length = dv.getInt32(16, true) | 0
      const mapIdx = (tileId) => {
        const id = tileId | 0
        if (id >= 0 && id < length) return id
        const off = id - RM_STATIC_TILE_ID_BASE
        if (off >= 0 && off < length) return off
        return null
      }
      const lo = mapIdx(fromIdx)
      const hi = mapIdx(toIdx)
      if (lo == null || hi == null) continue
      patchRmxpTable1DRange(bytes, lo, hi, 0)
    }
  }
}

/**
 * After the static region is zeroed, set **`@passages`** int16 per global tile id (384–511).
 * @param {object} tilesetObj — `RPG::Tileset` Marshal object
 * @param {Array<{ rmTileId: number, passage: number }>} patches
 */
function applyPassagePatches(tilesetObj, patches) {
  const tbl = tilesetObj[sym('@passages')]
  if (!tbl || !(tbl.userDefined instanceof Uint8Array)) return
  const bytes = tbl.userDefined
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = dv.getInt32(16, true) | 0
  const mapIdx = (tileId) => {
    const id = tileId | 0
    if (id >= 0 && id < length) return id
    const off = id - RM_STATIC_TILE_ID_BASE
    if (off >= 0 && off < length) return off
    return null
  }
  for (const raw of patches) {
    if (!raw || typeof raw !== 'object') continue
    const id = raw.rmTileId | 0
    const idx = mapIdx(id)
    if (idx == null) continue
    const v = raw.passage | 0
    patchRmxpTable1DRange(bytes, idx, idx, v)
  }
}

/**
 * Set **`@terrain_tags`** int16 per global tile id (same `Table` layout as `@passages`).
 * @param {object} tilesetObj — `RPG::Tileset` Marshal object
 * @param {Array<{ rmTileId: number, terrainTag: number }>} patches
 */
function applyTerrainTagPatches(tilesetObj, patches) {
  const tbl = tilesetObj[sym('@terrain_tags')]
  if (!tbl || !(tbl.userDefined instanceof Uint8Array)) return
  const bytes = tbl.userDefined
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = dv.getInt32(16, true) | 0
  const mapIdx = (tileId) => {
    const id = tileId | 0
    if (id >= 0 && id < length) return id
    const off = id - RM_STATIC_TILE_ID_BASE
    if (off >= 0 && off < length) return off
    return null
  }
  for (const raw of patches) {
    if (!raw || typeof raw !== 'object') continue
    const id = raw.rmTileId | 0
    const idx = mapIdx(id)
    if (idx == null) continue
    const v = raw.terrainTag | 0
    patchRmxpTable1DRange(bytes, idx, idx, v)
  }
}

/**
 * Set **`@priorities`** int16 per global tile id (same `Table` layout as `@passages`).
 * @param {object} tilesetObj — `RPG::Tileset` Marshal object
 * @param {Array<{ rmTileId: number, priority: number }>} patches
 */
function applyPriorityPatches(tilesetObj, patches) {
  const tbl = tilesetObj[sym('@priorities')]
  if (!tbl || !(tbl.userDefined instanceof Uint8Array)) return
  const bytes = tbl.userDefined
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = dv.getInt32(16, true) | 0
  const mapIdx = (tileId) => {
    const id = tileId | 0
    if (id >= 0 && id < length) return id
    const off = id - RM_STATIC_TILE_ID_BASE
    if (off >= 0 && off < length) return off
    return null
  }
  for (const raw of patches) {
    if (!raw || typeof raw !== 'object') continue
    const id = raw.rmTileId | 0
    const idx = mapIdx(id)
    if (idx == null) continue
    const v = raw.priority | 0
    patchRmxpTable1DRange(bytes, idx, idx, v)
  }
}

function cloneMarshalValue(v) {
  return load(Buffer.from(dump(v)), { string: 'binary' })
}

function makeTable1D(length) {
  const bytes = new Uint8Array(20 + length * 2)
  const dv = new DataView(bytes.buffer)
  dv.setInt32(0, 1, true)   // dim
  dv.setInt32(4, length, true) // xsize
  dv.setInt32(8, 1, true)   // ysize
  dv.setInt32(12, 1, true)  // zsize
  dv.setInt32(16, length, true) // length
  return bytes
}

/** Vanilla RMXP uses tile ids 0–511 (autotile + B/C); keep at least this many int16 slots. */
const RMXP_MIN_TILEMETA_TABLE_LEN = 512

function maxReferencedRmTileId(opts) {
  let m = 0
  const bump = (id) => {
    const n = Number(id)
    if (!Number.isFinite(n)) return
    const v = n | 0
    if (v > m) m = v
  }
  if (Array.isArray(opts?.tilePassages)) {
    for (const r of opts.tilePassages) bump(r?.rmTileId)
  }
  if (Array.isArray(opts?.tileTerrainTags)) {
    for (const r of opts.tileTerrainTags) bump(r?.rmTileId)
  }
  if (Array.isArray(opts?.tilePriorities)) {
    for (const r of opts.tilePriorities) bump(r?.rmTileId)
  }
  if (Array.isArray(opts?.blockedPassageTileIds)) {
    for (const id of opts.blockedPassageTileIds) bump(id)
  }
  return m
}

/**
 * Minimum `@passages` / `@priorities` / `@terrain_tags` length so `mapIdx(tileId)` can use
 * direct index `tileId` (see `patchStaticTileTables` / `applyPassagePatches`).
 */
function requiredTileMetaTableLength(opts) {
  let maxId = maxReferencedRmTileId(opts)
  if (opts?.patchStaticRegion !== false) {
    const fromIdx = opts.staticFrom != null ? opts.staticFrom | 0 : RM_STATIC_TILE_ID_BASE
    const toIdx = opts.staticTo != null ? opts.staticTo | 0 : RM_STATIC_TILE_ID_BASE + 383
    maxId = Math.max(maxId, fromIdx | 0, toIdx | 0)
  }
  const need = maxId + 1
  return Math.max(RMXP_MIN_TILEMETA_TABLE_LEN, need)
}

function expandTilesetMetaTablesToAtLeast(tilesetObj, minLength) {
  if (!Number.isInteger(minLength) || minLength < 1) return
  const keys = [sym('@passages'), sym('@priorities'), sym('@terrain_tags')]
  for (const k of keys) {
    const tbl = tilesetObj[k]
    if (!tbl?.userDefined || !(tbl.userDefined instanceof Uint8Array)) continue
    const old = tbl.userDefined
    const dv = new DataView(old.buffer, old.byteOffset, old.byteLength)
    if (old.byteLength < 20) continue
    const oldLen = dv.getInt32(16, true) | 0
    if (oldLen >= minLength) continue
    const neu = makeTable1D(minLength)
    const nDv = new DataView(neu.buffer, neu.byteOffset, neu.byteLength)
    const copyCount = Math.min(oldLen, minLength)
    for (let i = 0; i < copyCount; i++) {
      const v = dv.getInt16(20 + i * 2, true)
      nDv.setInt16(20 + i * 2, v, true)
    }
    tbl.userDefined = neu
  }
}

function _buildBlankTilesetObj(slotId, imageBaseName, displayName, tableLength = 768) {
  const sid = slotId | 0
  const baseName = String(imageBaseName || 'tileset').trim() || 'tileset'
  const nameStr = String(displayName || 'Grasswhistle').trim() || 'Grasswhistle'
  const enc = new TextEncoder()
  const obj = new RubyObject(Symbol.for('RPG::Tileset'))
  obj[sym('@id')] = sid
  obj[sym('@name')] = enc.encode(nameStr)
  obj[sym('@tileset_name')] = enc.encode(baseName)
  obj[sym('@panorama_name')] = enc.encode('')
  obj[sym('@panorama_hue')] = 0
  obj[sym('@fog_name')] = enc.encode('')
  obj[sym('@fog_hue')] = 0
  obj[sym('@fog_opacity')] = 64
  obj[sym('@fog_blend_type')] = 0
  obj[sym('@fog_zoom')] = 100
  obj[sym('@fog_sx')] = 0
  obj[sym('@fog_sy')] = 0
  obj[sym('@battleback_name')] = enc.encode('')
  obj[sym('@autotile_names')] = [
    enc.encode(''), enc.encode(''), enc.encode(''), enc.encode(''),
    enc.encode(''), enc.encode(''), enc.encode(''),
  ]
  obj[sym('@passages')] = { userDefined: makeTable1D(tableLength) }
  obj[sym('@priorities')] = { userDefined: makeTable1D(tableLength) }
  obj[sym('@terrain_tags')] = { userDefined: makeTable1D(tableLength) }
  return obj
}

/**
 * Build a complete Tilesets.rxdata from a template, filling multiple slots at once.
 * Clones the **entire** template array first (Marshal round-trip) so database slots you do not
 * export—especially **slot 1**—stay intact; then replaces only the requested `slotId` entries.
 * Each filled slot is cloned from the donor, static region zeroed, and per-slot patches applied.
 *
 * @param {string} templatePath
 * @param {Array<{ slotId: number, imageBaseName: string, displayName: string, tilePassages?: Array<{rmTileId,passage}>, tileTerrainTags?: Array<{rmTileId,terrainTag}>, tilePriorities?: Array<{rmTileId,priority}> }>} slots
 * @param {{ staticFrom?: number, staticTo?: number }} [opts]
 * @returns {{ ok: true, buffer: Buffer } | { ok: false, error: string }}
 */
export function buildTilesetsFromScratchAndDump(templatePath, slots, opts = {}) {
  try {
    if (!templatePath || !fs.existsSync(templatePath)) {
      return { ok: false, error: 'Tilesets template file not found.' }
    }
    if (!Array.isArray(slots) || slots.length === 0) {
      return { ok: false, error: 'No tileset slots provided.' }
    }
    const srcArr = load(fs.readFileSync(templatePath), { string: 'binary' })
    if (!Array.isArray(srcArr)) {
      return { ok: false, error: 'Tilesets template root is not a Marshal Array.' }
    }
    // Prefer slot 2: bundled `samples/Tilesets.rxdata` has slot 1 with shorter passage
    // Tables (392) and slot 2 with Essentials-sized Tables (464). Cloning slot 1 makes
    // rmTileId ≥392 patch into wrong indices / OOB reads in-game.
    const donorIdx = pickDonorIndex(srcArr, 2)
    if (donorIdx < 0) {
      return { ok: false, error: 'No donor tileset found in template.' }
    }
    const donor = srcArr[donorIdx]
    const maxFromSlots = slots.reduce((m, s) => Math.max(m, s.slotId | 0), 0)
    // Clone the whole template array so untouched database slots (especially 1) stay valid
    // RPG::Tileset entries. Building `new Array(...).fill(null)` left slot 1 nil and broke
    // “save database” in RMXP for some projects.
    const outArr = cloneMarshalValue(srcArr)
    if (!Array.isArray(outArr)) {
      return { ok: false, error: 'Tilesets template clone did not yield an Array.' }
    }
    outArr[0] = null
    const needLen = Math.max(outArr.length, maxFromSlots + 1)
    while (outArr.length < needLen) outArr.push(null)

    for (const s of slots) {
      const sid = s.slotId | 0
      if (sid < 1) continue
      const clone = buildFilledTilesetFromDonor(donor, sid, s.imageBaseName, s.displayName, {
        staticFrom: opts.staticFrom,
        staticTo: opts.staticTo,
        tilePassages: s.tilePassages,
        tileTerrainTags: s.tileTerrainTags,
        tilePriorities: s.tilePriorities,
      })
      outArr[sid] = clone
    }
    return { ok: true, buffer: Buffer.from(dump(outArr)) }
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}

function buildFilledTilesetFromDonor(donor, slotId, imageBaseName, displayName, opts = {}) {
  const sid = slotId | 0
  const baseName = String(imageBaseName || 'tileset').trim() || 'tileset'
  const nameStr = String(displayName || 'Grasswhistle').trim() || 'Grasswhistle'

  const clone = cloneMarshalValue(donor)
  expandTilesetMetaTablesToAtLeast(clone, requiredTileMetaTableLength(opts))
  clone[sym('@id')] = sid
  clone[sym('@name')] = utf8(nameStr)
  clone[sym('@tileset_name')] = utf8(baseName)

  const patchStatic = opts.patchStaticRegion !== false
  if (patchStatic) {
    const fromIdx = opts.staticFrom != null ? opts.staticFrom | 0 : RM_STATIC_TILE_ID_BASE
    // RMXP static tiles span 384 entries (tile ids 384..767).
    // Default to patching the full strip so every packed atlas tile gets a defined passage/tag.
    const toIdx = opts.staticTo != null ? opts.staticTo | 0 : RM_STATIC_TILE_ID_BASE + 383
    patchStaticTileTables(clone, fromIdx, toIdx)

    // When patching static region, apply passage/terrain patches after zeroing.
    // (Fall through to shared patch application below.)
  }

  // Always apply patches if provided, even when `patchStaticRegion` is false.
  // That allows using a rich template (like a real Essentials project) while only overriding
  // the specific atlas tile ids we generate.
  const perTile = opts.tilePassages
  if (Array.isArray(perTile) && perTile.length > 0) {
    applyPassagePatches(clone, perTile)
  } else {
    const blocked = opts.blockedPassageTileIds
    if (Array.isArray(blocked) && blocked.length > 0) {
      applyPassagePatches(
        clone,
        blocked.map((rmTileId) => ({ rmTileId: rmTileId | 0, passage: RM_PASSAGE_SOLID })),
      )
    }
  }

  const terrain = opts.tileTerrainTags
  if (Array.isArray(terrain) && terrain.length > 0) {
    applyTerrainTagPatches(clone, terrain)
  }

  const priorities = opts.tilePriorities
  if (Array.isArray(priorities) && priorities.length > 0) {
    applyPriorityPatches(clone, priorities)
  }
  return clone
}

/**
 * Load `Tilesets.rxdata`, clone a donor `RPG::Tileset`, assign `slotId`, point graphics at
 * `imageBaseName` (filename without `.png`), optionally reset passage/priority/terrain for
 * static tile ids (default 384–511), dump Marshal.
 *
 * @param {string} sourcePath - Game `Data/Tilesets.rxdata`
 * @param {number} slotId - Database tileset index (≥ 1)
 * @param {string} imageBaseName - e.g. `tileset` for `Graphics/Tilesets/tileset.png`
 * @param {string} displayName - `@name` in the editor list
 * @param {{ staticFrom?: number, staticTo?: number, patchStaticRegion?: boolean, blockedPassageTileIds?: number[], tilePassages?: Array<{ rmTileId: number, passage: number }>, tileTerrainTags?: Array<{ rmTileId: number, terrainTag: number }>, tilePriorities?: Array<{ rmTileId: number, priority: number }> }} [opts]
 * @returns {{ ok: true, buffer: Buffer } | { ok: false, error: string }}
 */
export function mergeTilesetSlotAndDump(
  sourcePath,
  slotId,
  imageBaseName,
  displayName,
  opts = {},
) {
  try {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: 'Tilesets source file not found.' }
    }
    const sid = slotId | 0
    if (!Number.isInteger(sid) || sid < 1) {
      return { ok: false, error: 'Tileset slot id must be an integer ≥ 1.' }
    }

    const arr = load(fs.readFileSync(sourcePath), { string: 'binary' })
    if (!Array.isArray(arr)) {
      return { ok: false, error: 'Tilesets root is not a Marshal Array.' }
    }

    const donorIdx = pickDonorIndex(arr, sid)
    if (donorIdx < 0) {
      return {
        ok: false,
        error: 'No donor tileset found (need at least one entry in Tilesets.rxdata).',
      }
    }

    while (arr.length <= sid) {
      arr.push(null)
    }

    const donor = arr[donorIdx]
    const clone = buildFilledTilesetFromDonor(donor, sid, imageBaseName, displayName, opts)

    arr[sid] = clone

    const outBuf = dump(arr)
    return { ok: true, buffer: Buffer.from(outBuf) }
  } catch (e) {
    const msg = e && typeof e.message === 'string' ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/**
 * Build a "blank" `Tilesets.rxdata` from a bundled template:
 * - Keep array index 0 = null
 * - Set every other index to null
 * - Fill only the requested `slotId` with a cloned donor tileset (from the template)
 *
 * This is intended as a safe-ish export template that doesn't depend on the user's game file.
 *
 * @param {string} templatePath - Bundled `samples/Tilesets.rxdata`
 * @param {number} slotId - Database tileset index (≥ 1)
 * @param {string} imageBaseName - e.g. `tileset` for `Graphics/Tilesets/tileset.png`
 * @param {string} displayName - `@name` in the editor list
 * @param {{ staticFrom?: number, staticTo?: number, patchStaticRegion?: boolean, blockedPassageTileIds?: number[], tilePassages?: Array<{ rmTileId: number, passage: number }>, tileTerrainTags?: Array<{ rmTileId: number, terrainTag: number }>, tilePriorities?: Array<{ rmTileId: number, priority: number }> }} [opts]
 * @returns {{ ok: true, buffer: Buffer } | { ok: false, error: string }}
 */
export function buildBlankTilesetsTemplateAndFillSlotAndDump(
  templatePath,
  slotId,
  imageBaseName,
  displayName,
  opts = {},
) {
  try {
    if (!templatePath || !fs.existsSync(templatePath)) {
      return { ok: false, error: 'Tilesets template file not found.' }
    }
    const sid = slotId | 0
    if (!Number.isInteger(sid) || sid < 1) {
      return { ok: false, error: 'Tileset slot id must be an integer ≥ 1.' }
    }

    const srcArr = load(fs.readFileSync(templatePath), { string: 'binary' })
    if (!Array.isArray(srcArr)) {
      return { ok: false, error: 'Tilesets template root is not a Marshal Array.' }
    }

    const donorIdx = pickDonorIndex(srcArr, sid)
    if (donorIdx < 0) {
      return {
        ok: false,
        error: 'No donor tileset found in template (need at least one entry).',
      }
    }
    const donor = srcArr[donorIdx]
    const filled = buildFilledTilesetFromDonor(donor, sid, imageBaseName, displayName, opts)

    // Keep the bundled template entries so the result matches a "normal" RMXP project
    // (some editors/tools assume common slots exist), but ensure index 0 is nil and
    // overwrite only the requested slot.
    const outLen = Math.max(srcArr.length, sid + 1)
    const outArr = srcArr.slice(0, outLen)
    while (outArr.length < outLen) outArr.push(null)
    outArr[0] = null
    outArr[sid] = filled

    const outBuf = dump(outArr)
    return { ok: true, buffer: Buffer.from(outBuf) }
  } catch (e) {
    const msg = e && typeof e.message === 'string' ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
