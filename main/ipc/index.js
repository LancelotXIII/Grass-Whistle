const { ipcMain, dialog } = require('electron')

const { exportProject } = require('../services/projectExport')
const { loadProject } = require('../services/projectLoad')
const { saveMapping } = require('../services/mapping')
const { saveRenderProject } = require('../services/renderProject')
const { loadPanelData } = require('../services/panels')
const { getTestPanel, saveTestPanel } = require('../services/testPanel')
const { getDefaultAssets, getAssets, getAssetsFromFolder, getBundledGrasswhistleAssets } = require('../services/assets')
const { exportRmxpMaps } = require('../services/rmxpExport')
const path = require('path')

function registerIpcHandlers({ appRoot }) {
  // IPC Handlers
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('export-project', async (event, { basePath, projectName, data }) => {
    try {
      return await exportProject({ basePath, projectName, data })
    } catch (err) {
      console.error('Export failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('load-project', async (event, projectPath) => {
    try {
      return await loadProject(projectPath)
    } catch (err) {
      console.error('Load failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('save-mapping', async (event, { projectPath, mapping }) => {
    try {
      return await saveMapping({ projectPath, mapping })
    } catch (err) {
      console.error('Save mapping failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('save-render-project', async (event, { projectPath, json, tilesetPngBase64, biomeTilesetPngs, biomeCountsMarkdown }) => {
    try {
      return await saveRenderProject({ projectPath, json, tilesetPngBase64, biomeTilesetPngs, biomeCountsMarkdown })
    } catch (err) {
      console.error('Save render output failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('load-panel-data', async (event, { projectPath, x, y }) => {
    try {
      return await loadPanelData({ projectPath, x, y })
    } catch (err) {
      console.error('Panel load failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-test-panel', async () => {
    try {
      return await getTestPanel({ assetsRoot: appRoot })
    } catch (err) {
      console.error('Failed to load test_panel.json:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('save-test-panel', async (event, map) => {
    try {
      return await saveTestPanel({ assetsRoot: appRoot, map })
    } catch (err) {
      console.error('Failed to save test_panel.json:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-default-assets', async () => {
    try {
      return await getDefaultAssets({ appRoot })
    } catch (err) {
      console.error('Failed to load default assets:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-bundled-grasswhistle-assets', async () => {
    try {
      return await getBundledGrasswhistleAssets({ appRoot })
    } catch (err) {
      console.error('Failed to load bundled Grasswhistle assets:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-assets', async (event, projectPath) => {
    try {
      return await getAssets({ projectPath })
    } catch (err) {
      console.error('Failed to load assets:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-assets-from-folder', async (event, folderPath) => {
    try {
      return await getAssetsFromFolder({ folderPath })
    } catch (err) {
      console.error('Failed to load folder assets:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-default-ground-biome-folder', async () => {
    try {
      return { success: true, folderPath: path.join(appRoot, 'assets', 'ground') }
    } catch (err) {
      console.error('Failed to resolve default ground biome folder:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-default-tree-biome-folder', async () => {
    try {
      return { success: true, folderPath: path.join(appRoot, 'assets', 'trees') }
    } catch (err) {
      console.error('Failed to resolve default tree biome folder:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-default-road-biome-folder', async () => {
    try {
      return { success: true, folderPath: path.join(appRoot, 'assets', 'road') }
    } catch (err) {
      console.error('Failed to resolve default road biome folder:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-default-grass-biome-folder', async () => {
    try {
      return { success: true, folderPath: path.join(appRoot, 'assets', 'grass') }
    } catch (err) {
      console.error('Failed to resolve default grass biome folder:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-default-water-biome-folder', async () => {
    try {
      return { success: true, folderPath: path.join(appRoot, 'assets', 'water') }
    } catch (err) {
      console.error('Failed to resolve default water biome folder:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-default-cliff-biome-folder', async () => {
    try {
      return { success: true, folderPath: path.join(appRoot, 'assets', 'cliff') }
    } catch (err) {
      console.error('Failed to resolve default cliff biome folder:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('export-rmxp-maps', async (event, payload) => {
    try {
      return await exportRmxpMaps({ appRoot, ...payload })
    } catch (err) {
      console.error('export-rmxp-maps failed:', err)
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerIpcHandlers }

