const path = require('path')
const fs = require('fs')

async function getTestPanel({ assetsRoot }) {
  const jsonPath = path.join(assetsRoot, 'assets', 'test_panel.json')
  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  return { success: true, map: rows.join('\n') }
}

async function saveTestPanel({ assetsRoot, map }) {
  const jsonPath = path.join(assetsRoot, 'assets', 'test_panel.json')
  const rows = map.split('\n')
  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2))
  return { success: true }
}

module.exports = { getTestPanel, saveTestPanel }

