const path = require('path')
const fs = require('fs')

/** `{root}/Export/Graphics/Tilesets` — RPG Maker XP mirror; creates all segments if missing. */
function ensureExportGraphicsTilesetsDir(root) {
  const dir = path.join(root, 'Export', 'Graphics', 'Tilesets')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** `{root}/Export/PBS` — Pokémon Essentials PBS mirror; creates all segments if missing. */
function ensureExportPbsDir(root) {
  const dir = path.join(root, 'Export', 'PBS')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function padMapId(id) {
  const n = Number(id) | 0
  return String(n).padStart(3, '0')
}

/**
 * Folder that contains `index.mjs` and `samples/*.rxdata` (RX Converter package).
 * Set **`GRASSWHISTLE_RXCONVERTER`** to an absolute path, or keep **`{appRoot}/tools/RXConverter`** on disk.
 * @param {string} appRoot Electron app root (`__dirname` of the app entry).
 * @returns {string|null}
 */
function resolveRxConverterRoot(appRoot) {
  const env = process.env.GRASSWHISTLE_RXCONVERTER
  if (typeof env === 'string' && env.trim()) {
    const p = path.resolve(env.trim())
    if (fs.existsSync(path.join(p, 'index.mjs'))) return p
  }
  const bundled = path.join(appRoot, 'tools', 'RXConverter')
  if (fs.existsSync(path.join(bundled, 'index.mjs'))) return bundled
  return null
}

/**
 * @param {string} appRoot
 * @returns {{ root: string, indexMjs: string, blankMap: string, mapInfosTemplate: string, tilesetsTemplate: string } | null}
 */
function getRxConverterPaths(appRoot) {
  const root = resolveRxConverterRoot(appRoot)
  if (!root) return null
  return {
    root,
    indexMjs: path.join(root, 'index.mjs'),
    blankMap: path.join(root, 'samples', 'BLANKMAP.rxdata'),
    mapInfosTemplate: path.join(root, 'samples', 'MapInfos.pokemon_essentials_v21_blank.rxdata'),
    tilesetsTemplate: path.join(root, 'samples', 'Tilesets.rxdata'),
  }
}

module.exports = {
  ensureExportGraphicsTilesetsDir,
  ensureExportPbsDir,
  padMapId,
  resolveRxConverterRoot,
  getRxConverterPaths,
}
