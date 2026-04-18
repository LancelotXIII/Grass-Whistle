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

/** Blank `RPG::Map` template for RMXP export (32×32, no events). */
const RMXP_BLANK_MAP_TEMPLATE = path.join(
  __dirname,
  '..',
  '..',
  'tools',
  'RXConverter',
  'samples',
  'BLANKMAP.rxdata',
)

/**
 * `MapInfos.rxdata` seed for RMXP export — Pokémon Essentials v21.1 blank project map list
 * (Intro, Start, Nested hierarchy). Full hash is merged; exported panel ids overlay by map id.
 */
const RMXP_MAPINFOS_TEMPLATE = path.join(
  __dirname,
  '..',
  '..',
  'tools',
  'RXConverter',
  'samples',
  'MapInfos.pokemon_essentials_v21_blank.rxdata',
)

module.exports = {
  ensureExportGraphicsTilesetsDir,
  ensureExportPbsDir,
  padMapId,
  RMXP_BLANK_MAP_TEMPLATE,
  RMXP_MAPINFOS_TEMPLATE,
}

