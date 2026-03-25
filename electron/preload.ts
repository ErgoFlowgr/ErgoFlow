import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  // Keychain
  keychain: {
    set:    (key: string, value: string) => ipcRenderer.invoke('keychain:set', key, value),
    get:    (key: string)                => ipcRenderer.invoke('keychain:get', key),
    delete: (key: string)               => ipcRenderer.invoke('keychain:delete', key),
  },

  // SQLite (via main process — keeps DB off renderer)
  db: {
    query: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
    run:   (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:run',   sql, params),
    get:   (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:get',   sql, params),
  },

  // Print
  printInvoice: (html: string) => ipcRenderer.invoke('print:invoice', html),

  // PDF download + web search + scraping (bypasses CORS via main process)
  downloadPdf:  (url: string)                        => ipcRenderer.invoke('pdf:download', url),
  braveSearch:  (query: string, apiKey: string)      => ipcRenderer.invoke('brave:search', query, apiKey),
  fetchHtml:    (url: string)                        => ipcRenderer.invoke('web:fetchHtml', url),

  // System
  notify:          (title: string, body: string) => ipcRenderer.invoke('notify', title, body),
  openExternal:    (url: string)                 => ipcRenderer.invoke('shell:openExternal', url),
  getVersion:      ()                            => ipcRenderer.invoke('app:getVersion'),
  getDataPath:     ()                            => ipcRenderer.invoke('app:getDataPath'),

  // Push events from main → renderer
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback)
  },
})
