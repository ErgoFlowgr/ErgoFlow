import { app, BrowserWindow, ipcMain, Notification, shell, net, Menu } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { initDatabase, getDb, cleanupOldPendingJobs } from './db'
import { storeSecret, getSecret, deleteSecret } from './keychain'
import { setupSyncWorker } from './sync'
import { setSessionToken, setRefreshToken } from './session'

const DEV = process.env['NODE_ENV'] === 'development'
const DEV_SERVER = `http://127.0.0.1:${process.env['VITE_DEV_PORT'] ?? '5173'}`

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, '../build/icon.png'),
    backgroundColor: '#0f1117',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f1117',
      symbolColor: '#ffffff',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (DEV) {
    mainWindow.loadURL(DEV_SERVER)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Right-click context menu with copy/paste/cut
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const menu = Menu.buildFromTemplate([
      { role: 'cut',       enabled: params.editFlags.canCut },
      { role: 'copy',      enabled: params.editFlags.canCopy },
      { role: 'paste',     enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    ])
    menu.popup()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    // Allow blob: URLs to open in a new Electron window (e.g. invoice printing)
    return { action: 'allow' }
  })
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.ergoflow.crm')
  await initDatabase()
  cleanupOldPendingJobs()

  // ── CSP (production only — dev server handles its own headers) ─────────
  if (!DEV) {
    const { session } = await import('electron')
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: https:; " +
            "connect-src 'self' https://*.supabase.co https://api.vapi.ai https://api.anthropic.com; " +
            "font-src 'self' data:;"
          ],
        },
      })
    })
  }

  createWindow()
  setupSyncWorker(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC: Keychain ─────────────────────────────────────────────────────────
ipcMain.handle('keychain:set', async (_e, key: string, value: string) => {
  await storeSecret(key, value)
  if (key === 'supabase_access_token') setSessionToken(value)
  if (key === 'supabase_refresh_token') setRefreshToken(value)
})
ipcMain.handle('keychain:get', async (_e, key: string) => {
  const value = await getSecret(key)
  if (key === 'supabase_access_token' && value) setSessionToken(value)
  if (key === 'supabase_refresh_token' && value) setRefreshToken(value)
  return value
})
ipcMain.handle('keychain:delete', async (_e, key: string) => {
  await deleteSecret(key)
})

// ── IPC: SQLite ───────────────────────────────────────────────────────────
ipcMain.handle('db:query', async (_e, sql: string, params: unknown[] = []) => {
  const db = getDb()
  return db.prepare(sql).all(...params)
})
ipcMain.handle('db:run', async (_e, sql: string, params: unknown[] = []) => {
  const db = getDb()
  return db.prepare(sql).run(...params)
})
ipcMain.handle('db:get', async (_e, sql: string, params: unknown[] = []) => {
  const db = getDb()
  return db.prepare(sql).get(...params)
})

// ── IPC: Notifications ────────────────────────────────────────────────────
ipcMain.handle('notify', (_e, title: string, body: string) => {
  new Notification({ title, body }).show()
})

// ── IPC: Shell ────────────────────────────────────────────────────────────
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  // Only allow http/https — blocks javascript:, file:, and other dangerous schemes
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    console.warn('openExternal blocked non-http URL:', parsed.protocol)
    return
  }
  shell.openExternal(url)
})

// ── IPC: App info ─────────────────────────────────────────────────────────
ipcMain.handle('app:getVersion', () => app.getVersion())
ipcMain.handle('app:getDataPath', () => app.getPath('userData'))

// ── IPC: PDF Download ─────────────────────────────────────────────────────
ipcMain.handle('pdf:download', async (_e, url: string) => {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  return buffer
})

// ── IPC: Brave Search (bypasses CORS) ─────────────────────────────────────
ipcMain.handle('brave:search', async (_e, query: string, apiKey: string) => {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`
  const res = await net.fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  })
  if (!res.ok) throw new Error(`Brave Search error: ${res.status}`)
  return await res.json()
})

// ── IPC: Fetch HTML (for web scraping, bypasses CORS) ─────────────────────
ipcMain.handle('web:fetchHtml', async (_e, url: string) => {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return await res.text()
})

// ── IPC: Print ────────────────────────────────────────────────────────────
ipcMain.handle('print:invoice', async (_e, html: string) => {
  const tmpFile = path.join(os.tmpdir(), `ergoflow-invoice-${Date.now()}.html`)
  fs.writeFileSync(tmpFile, html, 'utf-8')
  const printWin = new BrowserWindow({ width: 800, height: 900, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  await printWin.loadFile(tmpFile)
  printWin.focus()
  await new Promise(r => setTimeout(r, 300))
  await printWin.webContents.executeJavaScript('window.print()')
  printWin.on('closed', () => { try { fs.unlinkSync(tmpFile) } catch {} })
})

