const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  exportProject: (basePath, projectName, data) => ipcRenderer.invoke('export-project', { basePath, projectName, data }),
  loadProject: (path) => ipcRenderer.invoke('load-project', path),
  loadPanelData: (projectPath, x, y) => ipcRenderer.invoke('load-panel-data', { projectPath, x, y }),
  saveMapping: (projectPath, mapping) => ipcRenderer.invoke('save-mapping', { projectPath, mapping }),
  saveRenderProject: (projectPath, json, tilesetPngBase64, biomeTilesetPngs, biomeCountsMarkdown) =>
    ipcRenderer.invoke('save-render-project', { projectPath, json, tilesetPngBase64, biomeTilesetPngs, biomeCountsMarkdown }),
  exportRmxpMaps: (payload) => ipcRenderer.invoke('export-rmxp-maps', payload),
  getAssets: (projectPath) => ipcRenderer.invoke('get-assets', projectPath),
  getAssetsFromFolder: (folderPath) => ipcRenderer.invoke('get-assets-from-folder', folderPath),
  getDefaultGroundBiomeFolder: () => ipcRenderer.invoke('get-default-ground-biome-folder'),
  getDefaultTreeBiomeFolder: () => ipcRenderer.invoke('get-default-tree-biome-folder'),
  getDefaultRoadBiomeFolder: () => ipcRenderer.invoke('get-default-road-biome-folder'),
  getDefaultGrassBiomeFolder: () => ipcRenderer.invoke('get-default-grass-biome-folder'),
  getDefaultWaterBiomeFolder: () => ipcRenderer.invoke('get-default-water-biome-folder'),
  getDefaultCliffBiomeFolder: () => ipcRenderer.invoke('get-default-cliff-biome-folder'),
  getDefaultAssets: () => ipcRenderer.invoke('get-default-assets'),
  getBundledGrasswhistleAssets: () => ipcRenderer.invoke('get-bundled-grasswhistle-assets'),
  getTestPanel: () => ipcRenderer.invoke('get-test-panel'),
  saveTestPanel: (map) => ipcRenderer.invoke('save-test-panel', map)
});
