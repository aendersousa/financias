import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

export function initAutoUpdater(): void {
  autoUpdater.autoDownload = false

  autoUpdater.on('update-available', (info) => {
    const window = BrowserWindow.getAllWindows()[0] ?? null
    dialog
      .showMessageBox(window, {
        type: 'info',
        title: 'Atualização disponível',
        message: `Uma nova versão (${info.version}) está disponível. Deseja baixar agora?`,
        buttons: ['Baixar', 'Depois'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.downloadUpdate()
      })
  })

  autoUpdater.on('update-downloaded', () => {
    const window = BrowserWindow.getAllWindows()[0] ?? null
    dialog
      .showMessageBox(window, {
        type: 'info',
        title: 'Atualização pronta',
        message: 'A atualização foi baixada. Reinicie o aplicativo para aplicá-la agora?',
        buttons: ['Reiniciar agora', 'Depois'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall()
      })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err)
  })
}

export function checkForUpdates(): void {
  if (!app.isPackaged) return
  autoUpdater.checkForUpdates().catch((err) => console.error('checkForUpdates failed:', err))
}
