const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { getRxConverterPaths } = require('./paths')

/**
 * Scan a game's Data/ folder to derive additive export parameters.
 * Returns the max map id in use (our maps start at max+1) and the first
 * free tileset slot index (first null / missing index ≥ 2).
 *
 * @param {{ gameDir: string, appRoot: string }} opts
 * @returns {Promise<{ ok: true, gameDir: string, maxMapId: number, firstFreeTilesetSlot: number } | { ok: false, error: string }>}
 */
async function scanGameFolder({ gameDir, appRoot }) {
  if (!gameDir || !fs.existsSync(gameDir)) {
    return { ok: false, error: 'Game folder not found.' }
  }

  const dataDir = path.join(gameDir, 'Data')
  if (!fs.existsSync(dataDir)) {
    return { ok: false, error: `No Data/ folder found in:\n${gameDir}` }
  }

  const rxPaths = getRxConverterPaths(appRoot)
  if (!rxPaths) {
    return { ok: false, error: 'RX Converter not found.' }
  }

  const { load } = await import('@hyrious/marshal')

  // --- Max map id from MapInfos.rxdata ---
  let maxMapId = 1
  const mapInfosPath = path.join(dataDir, 'MapInfos.rxdata')
  if (fs.existsSync(mapInfosPath)) {
    try {
      const raw = load(fs.readFileSync(mapInfosPath), { string: 'binary' })
      const entries = raw instanceof Map ? raw : null
      if (entries) {
        for (const k of entries.keys()) {
          const id = typeof k === 'number' ? k | 0 : Number.parseInt(String(k), 10)
          if (Number.isFinite(id) && id > maxMapId) maxMapId = id
        }
      } else if (raw && typeof raw === 'object') {
        for (const k of Object.keys(raw)) {
          const id = Number.parseInt(k, 10)
          if (Number.isFinite(id) && id > maxMapId) maxMapId = id
        }
      }
    } catch {
      // leave maxMapId = 1
    }
  }

  // --- MapInfos: total map count ---
  let mapCount = 0
  try {
    const raw = load(fs.readFileSync(mapInfosPath), { string: 'binary' })
    const entries = raw instanceof Map ? raw : null
    if (entries) mapCount = entries.size
    else if (raw && typeof raw === 'object') mapCount = Object.keys(raw).length
  } catch {}

  // --- Tilesets.rxdata: first free slot + filled count ---
  let firstFreeTilesetSlot = 2
  let tilesetCount = 0
  const tilesetsPath = path.join(dataDir, 'Tilesets.rxdata')
  if (fs.existsSync(tilesetsPath)) {
    try {
      const arr = load(fs.readFileSync(tilesetsPath), { string: 'binary' })
      if (Array.isArray(arr)) {
        let foundFree = false
        for (let i = 2; i < arr.length + 1; i++) {
          if (arr[i] == null) {
            if (!foundFree) { firstFreeTilesetSlot = i; foundFree = true }
          } else {
            tilesetCount++
          }
        }
      }
    } catch {
      // leave defaults
    }
  }

  // --- Game title from System.rxdata ---
  let gameTitle = null
  const systemPath = path.join(dataDir, 'System.rxdata')
  if (fs.existsSync(systemPath)) {
    try {
      const sys = load(fs.readFileSync(systemPath), { string: 'binary' })
      const titleVal = sys?.[Symbol.for('@game_title')]
      if (titleVal instanceof Uint8Array) gameTitle = new TextDecoder().decode(titleVal)
      else if (typeof titleVal === 'string') gameTitle = titleVal
    } catch {}
  }

  return { ok: true, gameDir, maxMapId, mapCount, firstFreeTilesetSlot, tilesetCount, gameTitle }
}

module.exports = { scanGameFolder }
