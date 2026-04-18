/**
 * RPG Maker XP `MapInfos.rxdata` (Marshal Hash of `RPG::MapInfo` keyed by **map id**).
 *
 * RGSS expects **Fixnum keys**. A plain JS object always stringifies keys on `dump`, which Ruby
 * reads as String keys — the editor map list appears **empty**. Use **`Map<number, …>`** when dumping.
 */
import fs from 'node:fs'
import { RubyObject, dump, load } from '@hyrious/marshal'

const sym = (s) => Symbol.for(s)
const MAPINFO_CLASS = sym('RPG::MapInfo')

function utf8Name(s) {
  return new TextEncoder().encode(String(s))
}

function numericValue(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v != null && typeof v.valueOf === 'function') {
    const n = v.valueOf()
    if (typeof n === 'number' && Number.isFinite(n)) return n
  }
  return 0
}

function maxMapOrder(entries) {
  let m = 0
  const iter = entries instanceof Map ? entries.values() : Object.values(entries)
  for (const o of iter) {
    if (!o || typeof o !== 'object') continue
    const ord = numericValue(o[sym('@order')])
    if (ord > m) m = ord
  }
  return m
}

/** Normalize loaded MapInfos (plain object from `load`) to `Map` with **numeric** ids for correct `dump`. */
function mapInfosLoadedToNumericMap(root) {
  const out = new Map()
  if (root instanceof Map) {
    for (const [k, v] of root) {
      const id = typeof k === 'number' && Number.isFinite(k) ? k | 0 : Number.parseInt(String(k), 10)
      if (Number.isFinite(id)) out.set(id, v)
    }
    return out
  }
  for (const k of Object.keys(root)) {
    const id = Number.parseInt(k, 10)
    if (Number.isFinite(id)) out.set(id, root[k])
  }
  return out
}

function makeMapInfoEntry(_title, w, order) {
  const mi = new RubyObject(MAPINFO_CLASS)
  mi[sym('@scroll_x')] = 320
  mi[sym('@scroll_y')] = 240
  const display =
    w.mapName != null && String(w.mapName).length
      ? String(w.mapName)
      : Number.isFinite(w.x) && Number.isFinite(w.y)
        ? `${w.x},${w.y}`
        : 'Map'
  mi[sym('@name')] = utf8Name(display)
  const isParent = w.rmxpRole === 'group_parent'
  mi[sym('@expanded')] = !!isParent
  mi[sym('@order')] = order
  const pid = Number(w.parentMapId) | 0
  mi[sym('@parent_id')] = pid > 0 ? pid : 0
  return mi
}

function cloneMarshalValue(v) {
  return load(Buffer.from(dump(v)), { string: 'binary' })
}

/**
 * Load a reference `MapInfos.rxdata` and clone **all** `RPG::MapInfo` rows into a numeric-key `Map`.
 * Used to preserve editor hierarchy (e.g. Pokémon Essentials Intro → Start → nested maps).
 * @param {string} templatePath
 * @returns {Map<number, object>|null}
 */
function seedMapInfosRootFromTemplate(templatePath) {
  try {
    if (!templatePath || !fs.existsSync(templatePath)) return null
    const loaded = load(fs.readFileSync(templatePath), { string: 'binary' })
    if (!loaded || typeof loaded !== 'object' || (Array.isArray(loaded) && !(loaded instanceof Map))) {
      return null
    }
    const m = mapInfosLoadedToNumericMap(loaded)
    if (m.size === 0) return null
    const root = new Map()
    for (const [id, v] of m) {
      const k = id | 0
      if (!Number.isFinite(k) || k < 1) continue
      if (!v || typeof v !== 'object') continue
      root.set(k, cloneMarshalValue(v))
    }
    return root.size > 0 ? root : null
  } catch {
    return null
  }
}

/** Minimal Map001 row if bundled template has no id 1. */
function makeFallbackMap001MapInfo() {
  const mi = new RubyObject(MAPINFO_CLASS)
  mi[sym('@scroll_x')] = 320
  mi[sym('@scroll_y')] = 240
  mi[sym('@name')] = utf8Name('MAP001')
  mi[sym('@expanded')] = false
  mi[sym('@order')] = 1
  mi[sym('@parent_id')] = 0
  return mi
}

/**
 * Load **`RPG::MapInfo` for map id 1** from a reference `MapInfos.rxdata` (e.g. repo sample).
 *
 * @param {string} templatePath
 * @returns {{ ok: true, entry: object } | { ok: false, error: string }}
 */
export function cloneMapInfoOneFromTemplate(templatePath) {
  try {
    if (!templatePath || !fs.existsSync(templatePath)) {
      return { ok: false, error: 'MapInfos template file not found.' }
    }
    const loaded = load(fs.readFileSync(templatePath), { string: 'binary' })
    if (
      !loaded ||
      typeof loaded !== 'object' ||
      (Array.isArray(loaded) && !(loaded instanceof Map))
    ) {
      return { ok: false, error: 'MapInfos template root is not a Marshal hash/object.' }
    }
    const m = mapInfosLoadedToNumericMap(loaded)
    const raw = m.get(1)
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'MapInfos template has no entry for map id 1.' }
    }
    return { ok: true, entry: cloneMarshalValue(raw) }
  } catch (e) {
    const msg = e && typeof e.message === 'string' ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/**
 * Build `MapInfos.rxdata`: seed **all** rows from `meta.mapInfosTemplatePath` when present (clone),
 * then set/replace one `RPG::MapInfo` per exported panel id. Panel `@order` continues after the
 * max order in the template. If the template is missing or empty, only map id **1** is synthesized
 * (legacy behavior).
 * Used by Export RMXP.
 *
 * @param {Array<{ mapId: number, x?: number, y?: number, mapName?: string, parentMapId?: number, rmxpRole?: string }>} written - From `exportRenderBundleToRmxpDataDir`.
 * @param {{ title?: string, mapInfosTemplatePath?: string }} [meta]
 * @returns {{ ok: true, buffer: Buffer } | { ok: false, error: string }}
 */
export function buildMapInfosFromExportedMapsAndDump(written, meta = {}) {
  try {
    if (!Array.isArray(written) || written.length < 1) {
      return { ok: false, error: 'No maps to register in MapInfos.' }
    }
    const title = (meta.title && String(meta.title).trim()) || 'Grasswhistle'
    const tpl = meta.mapInfosTemplatePath

    let root = seedMapInfosRootFromTemplate(tpl)
    if (!root) {
      root = new Map()
      let map1 = null
      if (tpl) {
        const got = cloneMapInfoOneFromTemplate(tpl)
        if (got.ok) map1 = got.entry
      }
      if (!map1) map1 = makeFallbackMap001MapInfo()
      root.set(1, map1)
    } else if (!root.has(1)) {
      let map1 = null
      if (tpl) {
        const got = cloneMapInfoOneFromTemplate(tpl)
        if (got.ok) map1 = got.entry
      }
      if (!map1) map1 = makeFallbackMap001MapInfo()
      root.set(1, map1)
    }

    let nextOrder = maxMapOrder(root) + 1

    for (const w of written) {
      root.set(w.mapId | 0, makeMapInfoEntry(title, w, nextOrder++))
    }
    return { ok: true, buffer: Buffer.from(dump(root)) }
  } catch (e) {
    const msg = e && typeof e.message === 'string' ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/**
 * Load a game's `MapInfos.rxdata`, add/replace `RPG::MapInfo` for each exported map id, dump Marshal.
 *
 * @param {string} sourcePath - Existing `MapInfos.rxdata` from the target project (merge base).
 * @param {Array<{ mapId: number, x?: number, y?: number, mapName?: string, parentMapId?: number, rmxpRole?: string }>} written - From `exportRenderBundleToRmxpDataDir`.
 * @param {{ title?: string }} [meta] - Display name prefix (e.g. project title).
 * @returns {{ ok: true, buffer: Buffer } | { ok: false, error: string }}
 */
export function mergeMapInfosAndDump(sourcePath, written, meta = {}) {
  try {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: 'MapInfos source file not found.' }
    }
    if (!Array.isArray(written) || written.length < 1) {
      return { ok: false, error: 'No maps to register in MapInfos.' }
    }

    const loaded = load(fs.readFileSync(sourcePath), { string: 'binary' })
    if (
      !loaded ||
      typeof loaded !== 'object' ||
      (Array.isArray(loaded) && !(loaded instanceof Map))
    ) {
      return { ok: false, error: 'MapInfos root is not a Marshal hash/object.' }
    }

    const root = mapInfosLoadedToNumericMap(loaded)
    let nextOrder = maxMapOrder(root) + 1
    const title = (meta.title && String(meta.title).trim()) || 'Grasswhistle'

    for (const w of written) {
      root.set(w.mapId | 0, makeMapInfoEntry(title, w, nextOrder++))
    }

    const outBuf = dump(root)
    return { ok: true, buffer: Buffer.from(outBuf) }
  } catch (e) {
    const msg = e && typeof e.message === 'string' ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/**
 * @param {object} opts
 * @param {Array<{ mapId: number, file: string, x?: number, y?: number, mapName?: string, rmxpRole?: string }>} opts.written
 * @param {{ title?: string }} [opts.meta]
 * @param {string} [opts.tilesetId]
 * @param {string|null} [opts.mapInfosNote] - e.g. path written or "skipped"
 * @param {string|null} [opts.tilesetsNote] - Tilesets.rxdata merge note
 */
export function buildExportReadme(opts) {
  const lines = [
    'Grasswhistle — RPG Maker XP export',
    '================================',
    '',
    'Merge into your game project:',
    '  - Export/Data/*     → Data/',
    '  - Export/Graphics/* → Graphics/',
    '',
    `Maps written (${opts.written?.length ?? 0}):`,
  ]
  for (const w of opts.written || []) {
    if (w.rmxpRole === 'group_parent') {
      lines.push(`  - ${w.file}  (group "${w.mapName ?? ''}")  id=${w.mapId}`)
    } else {
      lines.push(`  - ${w.file}  (panel ${w.x},${w.y})  id=${w.mapId}`)
    }
  }
  lines.push('')
  if (opts.tilesetId != null) lines.push(`Tileset id on maps: ${opts.tilesetId}`)
  if (opts.mapInfosNote) lines.push(`MapInfos.rxdata: ${opts.mapInfosNote}`)
  if (opts.tilesetsNote) lines.push(`Tilesets.rxdata: ${opts.tilesetsNote}`)
  lines.push('')
  lines.push(
    'MapInfos: bundled template rows stay when ids do not overlap exports; each named panel group adds a blank parent map and letter-suffixed children (A,B,…) nested under it. Default export starts at Map003.',
  )
  lines.push('Back up your game Data/ before overwriting.')
  return lines.join('\r\n')
}
