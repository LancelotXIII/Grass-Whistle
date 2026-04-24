const path = require('path')
const fs = require('fs')

async function loadProject(projectPath) {
  const projectJsonPath = path.join(projectPath, 'project.json')
  const worldPngPath = path.join(projectPath, 'world.png')
  const mappingJsonPath = path.join(projectPath, 'mapping.json')
  const panelsDir = path.join(projectPath, 'panels')

  if (!fs.existsSync(projectJsonPath)) {
    throw new Error('project.json not found in selected directory.')
  }

  const metadata = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'))

  // Load mapping or default
  let mapping = {
    GROUND: { assetId: '', mode: 'simple' },
    ROAD: { assetId: '', mode: 'simple' },
  }
  if (fs.existsSync(mappingJsonPath)) {
    mapping = JSON.parse(fs.readFileSync(mappingJsonPath, 'utf8'))
  }

  // World preview as base64
  let worldPNG = null
  if (fs.existsSync(worldPngPath)) {
    const buf = fs.readFileSync(worldPngPath)
    worldPNG = `data:image/png;base64,${buf.toString('base64')}`
  }

  // Index panels
  const panels = []
  if (fs.existsSync(panelsDir)) {
    const files = fs.readdirSync(panelsDir)
    for (const f of files) {
      if (f.endsWith('.json')) {
        const [x, y] = f.replace('.json', '').split('_').map(Number)
        panels.push({ x, y, filename: f })
      }
    }
  }

  return {
    success: true,
    data: { metadata, worldPNG, panels, mapping, path: projectPath },
  }
}

module.exports = { loadProject }

