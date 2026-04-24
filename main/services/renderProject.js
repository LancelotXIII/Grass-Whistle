const path = require('path')
const fs = require('fs')
const { ensureExportGraphicsTilesetsDir } = require('./paths')

/** Map Generator: `render.json` + packed tileset(s) under `Export/Graphics/Tilesets/` (RM XP layout). */
async function saveRenderProject({ projectPath, json, tilesetPngBase64, biomeTilesetPngs, biomeCountsMarkdown }) {
  if (!projectPath || typeof json !== 'string') {
    throw new Error('Invalid render payload.')
  }
  const renderPath = path.join(projectPath, 'render.json')
  fs.writeFileSync(renderPath, json, 'utf8')

  const tilesetDir = ensureExportGraphicsTilesetsDir(projectPath)
  let tilesetPath = null
  if (tilesetPngBase64 && typeof tilesetPngBase64 === 'string') {
    tilesetPath = path.join(tilesetDir, 'tileset.png')
    const buf = Buffer.from(tilesetPngBase64, 'base64')
    fs.writeFileSync(tilesetPath, buf)
  }

  const extraPaths = []
  if (Array.isArray(biomeTilesetPngs)) {
    for (const item of biomeTilesetPngs) {
      if (!item || typeof item.filename !== 'string' || typeof item.base64 !== 'string') continue
      const safeName = path.basename(item.filename)
      if (!safeName || !safeName.endsWith('.png')) continue
      const out = path.join(tilesetDir, safeName)
      fs.writeFileSync(out, Buffer.from(item.base64, 'base64'))
      extraPaths.push(out)
    }
  }

  let biomeCountsPath = null
  if (biomeCountsMarkdown && typeof biomeCountsMarkdown === 'string') {
    const exportDir = path.join(projectPath, 'Export')
    fs.mkdirSync(exportDir, { recursive: true })
    biomeCountsPath = path.join(exportDir, 'biome_panel_counts.md')
    fs.writeFileSync(biomeCountsPath, biomeCountsMarkdown, 'utf8')
  }

  return {
    success: true,
    path: renderPath,
    paths: { render: renderPath, tileset: tilesetPath, biomeTilesets: extraPaths, biomeCounts: biomeCountsPath },
  }
}

module.exports = { saveRenderProject }
