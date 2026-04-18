const path = require('path')
const fs = require('fs')

async function exportProject({ basePath, projectName, data }) {
  const projectDir = path.join(basePath, projectName)
  const panelsDir = path.join(projectDir, 'panels')
  const imageryDir = path.join(projectDir, 'imagery')

  // Create directories
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true })
  if (!fs.existsSync(panelsDir)) fs.mkdirSync(panelsDir)
  if (!fs.existsSync(imageryDir)) fs.mkdirSync(imageryDir)

  // Save project.json
  fs.writeFileSync(
    path.join(projectDir, 'project.json'),
    JSON.stringify(data.metadata, null, 2)
  )

  // Save world.png
  if (data.worldPNG) {
    const base64Data = data.worldPNG.replace(/^data:image\/png;base64,/, '')
    fs.writeFileSync(path.join(projectDir, 'world.png'), base64Data, 'base64')
  }

  // Save panels & imagery
  for (const p of data.panels || []) {
    const name = `${p.x}_${p.y}`

    fs.writeFileSync(
      path.join(panelsDir, `${name}.json`),
      JSON.stringify(p.data, null, 2)
    )

    if (p.png) {
      const base64PNG = p.png.replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(path.join(imageryDir, `${name}.png`), base64PNG, 'base64')
    }
  }

  return { success: true, path: projectDir }
}

module.exports = { exportProject }

