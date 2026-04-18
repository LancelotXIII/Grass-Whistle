const path = require('path')
const fs = require('fs')

async function loadPanelData({ projectPath, x, y }) {
  const name = `${x}_${y}`
  const jsonPath = path.join(projectPath, 'panels', `${name}.json`)
  const pngPath = path.join(projectPath, 'imagery', `${name}.png`)

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Panel data for ${name} not found.`)
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))

  let png = null
  if (fs.existsSync(pngPath)) {
    const buf = fs.readFileSync(pngPath)
    png = `data:image/png;base64,${buf.toString('base64')}`
  }

  return { success: true, data, png }
}

module.exports = { loadPanelData }

