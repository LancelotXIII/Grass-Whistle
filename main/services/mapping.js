const path = require('path')
const fs = require('fs')

async function saveMapping({ projectPath, mapping }) {
  const mappingPath = path.join(projectPath, 'mapping.json')
  fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2))
  return { success: true }
}

module.exports = { saveMapping }

