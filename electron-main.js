const { app, BrowserWindow } = require('electron')

const { createMainWindow } = require('./main/window')
const { registerIpcHandlers } = require('./main/ipc')

app.whenReady().then(() => {
  createMainWindow()
  registerIpcHandlers({ appRoot: __dirname })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow() })
