import { app, BrowserWindow, shell } from 'electron'
import { join, resolve } from 'node:path'
import { checkForUpdates, initAutoUpdater } from './updater'

const PROTOCOL = 'financas'

let mainWindow: BrowserWindow | null = null
let pendingOAuthUrl: string | null = null

function sendOAuthCallback(url: string): void {
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('oauth-callback', url)
  } else {
    pendingOAuthUrl = url
  }
}

function extractProtocolUrl(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOAuthUrl) {
      mainWindow?.webContents.send('oauth-callback', pendingOAuthUrl)
      pendingOAuthUrl = null
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    const url = extractProtocolUrl(commandLine)
    if (url) sendOAuthCallback(url)
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    sendOAuthCallback(url)
  })

  app.whenReady().then(() => {
    initAutoUpdater()
    createWindow()
    checkForUpdates()

    const startupUrl = extractProtocolUrl(process.argv)
    if (startupUrl) sendOAuthCallback(startupUrl)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
