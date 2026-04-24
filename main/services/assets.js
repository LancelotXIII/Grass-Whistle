const path = require('path')
const fs = require('fs')

async function getDefaultAssets({ appRoot }) {
  const assetsDir = path.join(appRoot, 'assets')
  const assets = {}
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir)
    for (const f of files) {
      if (f.toLowerCase().endsWith('.png')) {
        const name = path.basename(f, path.extname(f))
        const buf = fs.readFileSync(path.join(assetsDir, f))
        assets[name] = `data:image/png;base64,${buf.toString('base64')}`
      }
    }
  }
  return { success: true, assets }
}

async function getAssets({ projectPath }) {
  const assetsDir = path.join(projectPath, 'assets')
  if (!fs.existsSync(assetsDir)) return { success: true, assets: {} }
  const assets = {}
  for (const { folder, prefix } of BUNDLED_BIOME_SUBFOLDERS) {
    const dir = path.join(assetsDir, folder)
    const fr = await getAssetsFromFolder({ folderPath: dir })
    if (!fr.success) continue
    for (const [k, v] of Object.entries(fr.assets || {})) {
      assets[`${prefix}${k}`] = v
    }
  }
  return { success: true, assets }
}

async function getAssetsFromFolder({ folderPath }) {
  const assets = {}
  if (!folderPath || typeof folderPath !== 'string') return { success: false, error: 'Invalid folderPath' }
  if (!fs.existsSync(folderPath)) return { success: false, error: 'Folder does not exist' }
  const files = fs.readdirSync(folderPath)
  for (const f of files) {
    if (f.toLowerCase().endsWith('.png')) {
      const name = path.basename(f, path.extname(f))
      const buf = fs.readFileSync(path.join(folderPath, f))
      assets[name] = `data:image/png;base64,${buf.toString('base64')}`
    }
  }
  return { success: true, assets }
}

/** Biome subfolders under `assets/` only (no loose `assets/*.png`; layout is category folders). */
const BUNDLED_BIOME_SUBFOLDERS = [
  { folder: 'ground', prefix: '__groundBiome__' },
  { folder: 'trees', prefix: '__treeBiome__' },
  { folder: 'road', prefix: '__roadBiome__' },
  { folder: 'grass', prefix: '__grassBiome__' },
  { folder: 'water', prefix: '__waterBiome__' },
  { folder: 'cliff', prefix: '__cliffBiome__' },
  { folder: 'cliff_double', prefix: '__cliffDoubleBiome__' },
  { folder: 'placeholder', prefix: '__placeholder__' },
]

async function getBundledGrasswhistleAssets({ appRoot }) {
  const assets = {}
  for (const { folder, prefix } of BUNDLED_BIOME_SUBFOLDERS) {
    const dir = path.join(appRoot, 'assets', folder)
    const fr = await getAssetsFromFolder({ folderPath: dir })
    if (!fr.success) continue
    for (const [k, v] of Object.entries(fr.assets || {})) {
      assets[`${prefix}${k}`] = v
    }
  }
  return { success: true, assets }
}

module.exports = { getDefaultAssets, getAssets, getAssetsFromFolder, getBundledGrasswhistleAssets }

