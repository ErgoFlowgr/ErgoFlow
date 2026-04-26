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
    query:  (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query',  sql, params),
    run:    (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:run',    sql, params),
    get:    (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:get',    sql, params),
    switch: (userId: string)                  => ipcRenderer.invoke('db:switch', userId),
    bulkDeleteCustomers: (ids: string[])      => ipcRenderer.invoke('db:bulkDeleteCustomers', ids),
  },

  // Sync
  syncNow:    () => ipcRenderer.invoke('sync:now'),
  syncEnable: () => ipcRenderer.invoke('sync:enable'),

  // Print
  printInvoice: (html: string) => ipcRenderer.invoke('print:invoice', html),
  savePdf:      (html: string, defaultName: string) => ipcRenderer.invoke('print:pdf', html, defaultName),
  sharePdf:        (html: string, defaultName: string) => ipcRenderer.invoke('pdf:share', html, defaultName),
  saveDesktopPdf:  (html: string, filename: string)   => ipcRenderer.invoke('pdf:saveDesktop', html, filename),

  // PDF download + web search + scraping (bypasses CORS via main process)
  downloadPdf:  (url: string)                        => ipcRenderer.invoke('pdf:download', url),
  braveSearch:  (query: string, apiKey: string, lang?: string) => ipcRenderer.invoke('brave:search', query, apiKey, lang),
  fetchHtml:    (url: string)                        => ipcRenderer.invoke('web:fetchHtml', url),

  // myDATA / ΑΑΔΕ invoice submission (bypasses CORS via main process)
  mydataSubmit: (params: { invoice: unknown, lineItems: unknown[], companyVat: string, mydataUserId: string, mydataApiKey: string }) =>
    ipcRenderer.invoke('mydata:submit', params),

  // Ollama proxy (bypasses CORS from file:// renderer)
  ollama: {
    tags:       (baseUrl: string)                    => ipcRenderer.invoke('ollama:tags', baseUrl),
    chat:       (baseUrl: string, body: string)      => ipcRenderer.invoke('ollama:chat', baseUrl, body),
    embeddings: (baseUrl: string, body: string)      => ipcRenderer.invoke('ollama:embeddings', baseUrl, body),
  },

  // System
  notify:          (title: string, body: string) => ipcRenderer.invoke('notify', title, body),
  openExternal:    (url: string)                 => ipcRenderer.invoke('shell:openExternal', url),
  getVersion:      ()                            => ipcRenderer.invoke('app:getVersion'),
  getDataPath:     ()                            => ipcRenderer.invoke('app:getDataPath'),

  // Subscription / license check
  subscriptionCheck: () => ipcRenderer.invoke('subscription:check'),

  // Auto-updater
  update: {
    onReady: (cb: () => void) => ipcRenderer.on('update:ready', () => cb()),
    onError: (cb: (msg: string) => void) => ipcRenderer.on('update:error', (_e, msg) => cb(msg)),
    install:  () => ipcRenderer.invoke('update:install'),
  },

  // Push events from main → renderer
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback)
  },
})
