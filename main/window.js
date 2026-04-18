const path = require('path')
const { BrowserWindow, nativeImage } = require('electron')

function createMainWindow() {
  const windowIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'src', 'renderer', 'assets', 'grasswhistle-logo.png'))

  const win = new BrowserWindow({
    width: 1280,
    height: 1024,
    title: 'Grasswhistle',
    icon: windowIcon,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  const devURL = 'http://localhost:5176'
  if (process.env.NODE_ENV === 'development') {
    win.loadURL(devURL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  return win
}

module.exports = { createMainWindow }

