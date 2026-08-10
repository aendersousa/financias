import { contextBridge, ipcRenderer } from 'electron'

const api = {
  onOAuthCallback: (callback: (url: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string): void => callback(url)
    ipcRenderer.on('oauth-callback', listener)
    return () => ipcRenderer.removeListener('oauth-callback', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
