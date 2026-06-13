import { app, BrowserWindow, ipcMain, Notification, shell, net, Menu, Tray, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { initDatabase, switchDatabase, getDb, cleanupOldPendingJobs } from './db'
import { storeSecret, getSecret, deleteSecret } from './keychain'
import { setupSyncWorker, triggerSync, triggerPull, isSyncWorkerRunning } from './sync'
import { setSessionToken, getSessionToken, setRefreshToken, getRefreshToken } from './session'

const DEV = process.env['NODE_ENV'] === 'development'
const DEV_SERVER = `http://127.0.0.1:${process.env['VITE_DEV_PORT'] ?? '5173'}`

// Supabase public credentials — safe to embed (anon key, not service role)
// VITE_ vars are Vite-only and are NOT available in the Electron main process at runtime
const SUPA_URL = 'https://ftorwjwcxcgbwwonbcwq.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0b3J3andjeGNnYnd3b25iY3dxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NDAwNDgsImV4cCI6MjA4OTQxNjA0OH0.3PhQcZYnisEmANFKEJPfbcg4_FIhqhQnH2Mz-hVx7U8'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isInstallingUpdate = false
let isQuitting = false

// In-memory state — updated via IPC when user toggles the setting
let minimizeToTray = false

function getRuntimeIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'icon.ico')
  }
  return path.join(__dirname, '../assets/icon.ico')
}

function destroyTray() {
  try { tray?.destroy() } catch { /* ignore */ }
  tray = null
}

function readMinimizeToTraySetting(): boolean {
  try {
    const row = getDb().prepare("SELECT minimize_to_tray FROM settings WHERE id = 'main'").get() as { minimize_to_tray?: number } | undefined
    return row?.minimize_to_tray === 1
  } catch { return false }
}

function createTray() {
  if (tray) return  // guard against double creation (hot reload in dev)
  try {
    tray = new Tray(getRuntimeIconPath())
  } catch (err) {
    console.error('Tray icon unavailable:', err instanceof Error ? err.message : err)
    return
  }
  tray.setToolTip('Ergoflow')
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Άνοιγμα',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Έξοδος',
      click: () => {
        isQuitting = true
        destroyTray()
        app.quit()
      },
    },
  ])
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: getRuntimeIconPath(),
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

function extractUserIdFromToken(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) as { sub?: string }
    return payload.sub ?? null
  } catch { return null }
}

function normalizeSqlParam(value: unknown): number | string | bigint | Buffer | null {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === undefined || value === null) return null
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value
  if (Buffer.isBuffer(value)) return value
  return String(value)
}

function normalizeSqlParams(params: unknown[] = []): Array<number | string | bigint | Buffer | null> {
  return params.map(normalizeSqlParam)
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.ergoflow.crm')
  await initDatabase()

  // If a user was previously logged in, switch to their DB immediately
  try {
    const token = await getSecret('supabase_access_token')
    if (token) {
      const userId = extractUserIdFromToken(token)
      if (userId) switchDatabase(userId)
    }
  } catch { /* no stored token — user will log in */ }

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
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "img-src 'self' data: https:; " +
            // VAPI calls (api.vapi.ai) are made directly from the renderer via fetch.
            // There are no VAPI IPC handlers in main.ts — tier gating for VAPI features
            // happens entirely at the React layer via LockedFeature / license tier checks.
            "connect-src 'self' https://*.supabase.co https://api.vapi.ai https://api.anthropic.com; " +
            "font-src 'self' data: https://fonts.gstatic.com;"
          ],
        },
      })
    })
  }

  createWindow()

  // Read minimize_to_tray setting and wire up the close handler
  minimizeToTray = readMinimizeToTraySetting()
  createTray()
  mainWindow?.on('close', (event) => {
    if (minimizeToTray && !isQuitting && !isInstallingUpdate) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // Only start sync worker if user has opted in
  try {
    const syncRow = getDb().prepare("SELECT sync_enabled FROM settings WHERE id = 'main'").get() as { sync_enabled?: number } | undefined
    if (syncRow?.sync_enabled === 1) setupSyncWorker(mainWindow)
  } catch { /* DB not ready yet — sync will start via sync:enable IPC if needed */ }

  mainWindow?.on('focus', () => triggerPull(mainWindow))

  // Auto-updater — only in production builds
  if (!DEV) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('update:ready')
    })
    autoUpdater.on('error', (err) => {
      console.error('Auto-updater error:', err.message)
      mainWindow?.webContents.send('update:error', err.message)
    })
    setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 3000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

ipcMain.handle('update:install', () => {
  // Disable tray-hide/tray lifetime so NSIS can replace the running executable.
  isInstallingUpdate = true
  isQuitting = true
  minimizeToTray = false
  destroyTray()
  autoUpdater.quitAndInstall(false, true)
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  // When minimize-to-tray is active the window is hidden, not closed — don't quit
  if (minimizeToTray) return
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
  if (key === 'supabase_access_token') setSessionToken(null)
  if (key === 'supabase_refresh_token') setRefreshToken(null)
})

// ── IPC: SQLite ───────────────────────────────────────────────────────────
ipcMain.handle('db:query', async (_e, sql: string, params: unknown[] = []) => {
  const db = getDb()
  return db.prepare(sql).all(...normalizeSqlParams(params))
})
ipcMain.handle('db:run', async (_e, sql: string, params: unknown[] = []) => {
  const db = getDb()
  return db.prepare(sql).run(...normalizeSqlParams(params))
})
ipcMain.handle('db:bulkDeleteCustomers', async (_e, ids: string[]) => {
  const db = getDb()
  if (!ids.length) return
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500))
  for (const chunk of chunks) {
    const ph = chunk.map(() => '?').join(',')
    db.prepare(`DELETE FROM customers WHERE id IN (${ph})`).run(chunk)
  }
  const syncStmt = db.prepare('INSERT OR IGNORE INTO sync_queue (table_name, record_id, operation) VALUES (?, ?, ?)')
  for (const id of ids) syncStmt.run('customers', id, 'delete')
})
ipcMain.handle('db:get', async (_e, sql: string, params: unknown[] = []) => {
  const db = getDb()
  return db.prepare(sql).get(...normalizeSqlParams(params))
})
ipcMain.handle('db:switch', (_e, tokenOrUserId: string) => {
  let userId: string | null = null
  if (tokenOrUserId.includes('.')) {
    // It's a JWT — decode the sub claim
    userId = extractUserIdFromToken(tokenOrUserId)
  } else {
    // It's already a plain UUID
    userId = tokenOrUserId
  }
  if (userId) {
    switchDatabase(userId)
  }
})

// ── IPC: Settings notifications ───────────────────────────────────────────
ipcMain.on('settings:minimizeToTray', (_e, value: boolean) => {
  minimizeToTray = value
})

ipcMain.handle('sync:now', () => triggerSync(mainWindow))
ipcMain.handle('sync:enable', () => {
  if (!isSyncWorkerRunning()) setupSyncWorker(mainWindow)
  return triggerSync(mainWindow)
})

// ── IPC: Notifications ────────────────────────────────────────────────────
ipcMain.handle('notify', (_e, title: string, body: string) => {
  new Notification({ title, body }).show()
})

// ── IPC: Shell ────────────────────────────────────────────────────────────
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  // Allow http/https and known messenger schemes
  const parsed = new URL(url)
  const allowed = ['https:', 'http:', 'whatsapp:', 'viber:']
  if (!allowed.includes(parsed.protocol)) {
    console.warn('openExternal blocked URL:', parsed.protocol)
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
ipcMain.handle('brave:search', async (_e, query: string, apiKey: string, lang = 'el') => {
  const locale = lang === 'en' ? '&country=us&search_lang=en&ui_lang=en-US' : '&country=gr&search_lang=el&ui_lang=el-GR'
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5${locale}`
  const res = await net.fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  })
  if (!res.ok) throw new Error(`Brave Search error: ${res.status}`)
  return await res.json()
})

// ── IPC: Ollama proxy (bypasses CORS from file:// renderer) ──────────────
ipcMain.handle('ollama:tags', async (_e, baseUrl: string) => {
  const res = await net.fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`)
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
  return await res.json()
})

ipcMain.handle('ollama:chat', async (_e, baseUrl: string, body: string) => {
  const res = await net.fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  if (!res.ok) throw new Error(`Ollama error: HTTP ${res.status}`)
  return await res.json()
})

ipcMain.handle('ollama:embeddings', async (_e, baseUrl: string, body: string) => {
  const res = await net.fetch(`${baseUrl.replace(/\/$/, '')}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  if (!res.ok) throw new Error(`Ollama embeddings error: HTTP ${res.status}`)
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

ipcMain.handle('print:pdf', async (_e, html: string, defaultName: string) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Αποθήκευση PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return { ok: false }
  const tmpFile = path.join(os.tmpdir(), `ergoflow-pdf-${Date.now()}.html`)
  fs.writeFileSync(tmpFile, html, 'utf-8')
  const printWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  await printWin.loadFile(tmpFile)
  await new Promise(r => setTimeout(r, 400))
  const pdfData = await printWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  printWin.destroy()
  fs.writeFileSync(filePath, pdfData)
  try { fs.unlinkSync(tmpFile) } catch {}
  shell.showItemInFolder(filePath)
  return { ok: true, filePath }
})

// ── IPC: Save PDF directly to Desktop ────────────────────────────────────
ipcMain.handle('pdf:saveDesktop', async (_e, html: string, filename: string) => {
  const safeName = filename.replace(/[/\\?%*:|"<>]/g, '-') + '.pdf'
  const filePath = path.join(app.getPath('desktop'), safeName)
  const tmpHtml  = path.join(os.tmpdir(), `ergoflow-pdf-${Date.now()}.html`)
  fs.writeFileSync(tmpHtml, html, 'utf-8')
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  await win.loadFile(tmpHtml)
  await new Promise(r => setTimeout(r, 400))
  const pdfData = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  win.destroy()
  try { fs.unlinkSync(tmpHtml) } catch {}
  fs.writeFileSync(filePath, pdfData)
  return filePath
})

// ── IPC: Bratnet e-invoicing submission ───────────────────────────────────
// Sandbox:    https://einvoicing-dev-api.etimologiera.gr/v4  (current)
// Production: https://einvoicing-api.etimologiera.gr/v4     (switch when going live)
const BRATNET_BASE_URL = 'https://einvoicing-dev-api.etimologiera.gr/v4'

ipcMain.handle('mydata:submit', async (_e, params: {
  invoice: {
    number: string
    issue_date: string | null
    document_type: string
    subtotal: number
    tax_amount: number
    total: number
  }
  lineItems: Array<{
    description: string
    quantity: number
    unit_price: number
    total: number
  }>
  companyVat: string
  customerVat: string
  mydataUserId: string
  mydataApiKey: string
}) => {
  try {
    const { invoice, lineItems, companyVat, customerVat } = params

    // Read Bratnet credentials directly from settings DB — don't trust what renderer passes
    const settingsRow = getDb()
      .prepare("SELECT bratnet_username, bratnet_api_key FROM settings WHERE id = 'main'")
      .get() as { bratnet_username?: string | null; bratnet_api_key?: string | null } | undefined

    const bratnetUsername = settingsRow?.bratnet_username ?? ''
    const bratnetApiKey   = settingsRow?.bratnet_api_key   ?? ''

    if (!bratnetUsername || !bratnetApiKey) {
      return { success: false, error: 'Missing Bratnet credentials. Go to Settings → Ηλεκτρονική Τιμολόγηση.' }
    }

    const authHeader = 'Basic ' + Buffer.from(`${bratnetUsername}:${bratnetApiKey}`).toString('base64')

    // Parse invoice series and sequential number from invoice.number.
    // Expected format: "ΑΠΥ-2026-001" → series "ΑΠΥ", aa 1
    // Fallback: series "ΑΠΥ", aa 1
    const seriesMatch = invoice.number.match(/^([A-Za-zΑ-Ωα-ωΆ-Ώ]+)/)
    const aaMatch     = invoice.number.match(/(\d+)$/)
    const series = seriesMatch ? seriesMatch[1] : 'ΑΠΥ'
    const aa     = aaMatch    ? parseInt(aaMatch[1], 10) : 1

    const issueDate = invoice.issue_date ?? new Date().toISOString().slice(0, 10)
    const issueTime = '00:00:00'

    const netValue   = Math.round((invoice.total - invoice.tax_amount) * 100) / 100
    const vatAmount  = Math.round(invoice.tax_amount * 100) / 100
    const totalValue = Math.round(invoice.total * 100) / 100

    // ── Step 1: createSimSign ────────────────────────────────────────────
    const externalSystemId = invoice.number  // unique per invoice
    const createSignPayload = {
      externalSystemId,
      issuerVatNumber: companyVat,
      invoiceIssueDate: issueDate,
      invoiceIssueTime: issueTime,
      invoiceType: '1.1',
      invoiceSeries: series,
      netValue,
      vatAmount,
      totalValue,
      paymentAmount: totalValue,
      nspCode: '01',
      terminalId: 'EF-001',
    }

    const signRes = await net.fetch(`${BRATNET_BASE_URL}/createSimSign`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createSignPayload),
    })

    if (!signRes.ok) {
      const errText = await signRes.text()
      return { success: false, error: `Bratnet createSimSign error HTTP ${signRes.status}: ${errText}` }
    }

    const signData = await signRes.json() as { hSignature?: string; error?: string }
    const hSignature = signData.hSignature ?? ''
    if (!hSignature) {
      return { success: false, error: `Bratnet createSimSign: no hSignature in response: ${JSON.stringify(signData)}` }
    }

    // ── Step 2: sendSimInvoice ───────────────────────────────────────────
    // Build invoice details lines; last line absorbs rounding remainder
    const taxRate       = netValue > 0 ? vatAmount / netValue : 0
    const discountFactor = invoice.subtotal > 0 ? netValue / invoice.subtotal : 1
    const vatRatePercent = Math.round(taxRate * 100)
    // Map tax rate % to vatCategory: 24→1, 13→2, 6→3, 0→4
    const vatCategory = vatRatePercent >= 24 ? 1 : vatRatePercent >= 13 ? 2 : vatRatePercent >= 6 ? 3 : 4
    let netAccum = 0
    let vatAccum = 0
    const invoiceDetails = lineItems.map((item, idx) => {
      let lineNet: number
      let lineVat: number
      if (idx === lineItems.length - 1) {
        lineNet = Math.round((netValue - netAccum) * 100) / 100
        lineVat = Math.round((vatAmount - vatAccum) * 100) / 100
      } else {
        lineNet = Math.round(item.total * discountFactor * 100) / 100
        lineVat = Math.round(lineNet * taxRate * 100) / 100
        netAccum += lineNet
        vatAccum += lineVat
      }
      return {
        lineNumber: idx + 1,
        code: 'SRV',
        name: item.description || 'Υπηρεσία',
        quantity: item.quantity,
        price: Math.round(item.unit_price * discountFactor * 100) / 100,
        netValue: lineNet,
        vatCategory,
        vatPercent: vatRatePercent,
        vatAmount: lineVat,
        measurementUnitName: 'ΤΕΜ',
      }
    })

    const sendPayload = {
      invoice: [
        {
          issuer: {
            vatNumber: companyVat,
            country: 'GR',
            branch: 0,
          },
          counterpart: {
            vatNumber: customerVat || '000000000',
            country: 'GR',
            branch: 0,
            address: { postalCode: '00000', city: '' },
          },
          invoiceHeader: {
            series,
            aa,
            externalSystemId,
            issueDate,
            issueTime,
            invoiceType: '1.1',
            currency: 'EUR',
          },
          paymentMethods: [{ type: 3, amount: totalValue }],
          invoiceDetails,
          invoiceSummary: {
            totalNetValue: netValue,
            totalVatAmount: vatAmount,
            totalGrossValue: totalValue,
          },
          invoiceVatAnalysis: [
            { vatRate: vatRatePercent, netValue, vatAmount },
          ],
          extra: {
            signature: hSignature,
            transactionId: externalSystemId,
            tipAmount: 0,
            nspCode: '01',
          },
        },
      ],
    }

    const sendRes = await net.fetch(`${BRATNET_BASE_URL}/sendSimInvoice`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sendPayload),
    })

    if (!sendRes.ok) {
      const errText = await sendRes.text()
      return { success: false, error: `Bratnet sendSimInvoice error HTTP ${sendRes.status}: ${errText}` }
    }

    const sendData = await sendRes.json() as { responses?: Array<{ invoiceMark?: string | number }>; error?: string }
    const mark = String(sendData.responses?.[0]?.invoiceMark ?? '')
    if (!mark) {
      return { success: false, error: `Bratnet sendSimInvoice: no MARK in response: ${JSON.stringify(sendData)}` }
    }

    return { success: true, mark }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
})

// ── IPC: Subscription check ───────────────────────────────────────────────
// Checks/creates the user's subscription row in Supabase.
// Returns { status, tier, vapiMinutesUsed, vapiPhoneNumber }.
//
// TODO (Stripe webhook Edge Function):
//   1. Create a Supabase Edge Function at supabase/functions/stripe-webhook/index.ts
//   2. On 'customer.subscription.created' / 'invoice.paid' → SET status='active'
//   3. On 'customer.subscription.deleted' / 'invoice.payment_failed' → SET status='expired' or 'cancelled'
//   4. Register the webhook URL in the Stripe dashboard
ipcMain.handle('subscription:check', async () => {
  try {
    const supaUrl = process.env['VITE_SUPABASE_URL'] ?? await getSecret('supabase_url') ?? SUPA_URL
    const supaKey = process.env['VITE_SUPABASE_ANON_KEY'] ?? await getSecret('supabase_anon_key') ?? SUPA_KEY

    if (!supaUrl || !supaKey) throw new Error('missing supabase config')

    const refreshStoredToken = async (): Promise<string | null> => {
      const refreshToken = getRefreshToken() ?? await getSecret('supabase_refresh_token')
      if (!refreshToken) return null

      const refreshRes = await net.fetch(`${supaUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: supaKey },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(5000),
      })
      if (!refreshRes.ok) return null

      const refreshData = await refreshRes.json() as { access_token?: string; refresh_token?: string }
      if (!refreshData.access_token) return null

      setSessionToken(refreshData.access_token)
      await storeSecret('supabase_access_token', refreshData.access_token)
      if (refreshData.refresh_token) {
        setRefreshToken(refreshData.refresh_token)
        await storeSecret('supabase_refresh_token', refreshData.refresh_token)
      }
      return refreshData.access_token
    }

    // Get a fresh token — prefer in-memory (loaded at login), fall back to keychain
    let token = getSessionToken() ?? await getSecret('supabase_access_token')
    if (!token) throw new Error('not authenticated')

    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) as { exp?: number; sub?: string }
      if ((payload.exp ?? 0) * 1000 < Date.now() + 5 * 60_000) {
        token = await refreshStoredToken() ?? token
      }
    } catch { /* use existing token */ }

    // Extract user_id from JWT
    let userId: string | null = null
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) as { sub?: string }
      userId = payload.sub ?? null
    } catch { /* ignore */ }

    if (!userId) throw new Error('invalid token')

    const headers: Record<string, string> = {
      'apikey': supaKey,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }

    // Try to read existing subscription row
    let getRes = await net.fetch(
      `${supaUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=*&limit=1`,
      { headers, signal: AbortSignal.timeout(5000) }
    )

    if (getRes.status === 401) {
      const refreshed = await refreshStoredToken()
      if (refreshed) {
        token = refreshed
        headers.Authorization = `Bearer ${token}`
        try {
          const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) as { sub?: string }
          userId = payload.sub ?? userId
        } catch { /* keep previous user id */ }
        getRes = await net.fetch(
          `${supaUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=*&limit=1`,
          { headers, signal: AbortSignal.timeout(5000) }
        )
      }
    }

    type SubRow = {
      status: string
      trial_end: string
      tier: string
      vapi_minutes_used: number
      vapi_phone_number: string | null
    }
    if (!getRes.ok) {
      throw new Error(`subscriptions fetch failed: ${getRes.status}`)
    }

    const rows = await getRes.json() as Array<SubRow>
    let sub: SubRow | null = rows[0] ?? null

    if (!sub) {
      // Genuine first install — no row exists yet, create a free account row
      const createRes = await net.fetch(`${supaUrl}/rest/v1/subscriptions`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({ user_id: userId, status: 'active', tier: 'free' }),
        signal: AbortSignal.timeout(5000),
      })
      if (createRes.ok) {
        const created = await createRes.json() as Array<SubRow>
        sub = created[0] ?? { status: 'active', trial_end: '', tier: 'free', vapi_minutes_used: 0, vapi_phone_number: null }
      } else {
        throw new Error(`subscription create failed: ${createRes.status}`)
      }
    }

    return {
      status: sub.status,
      tier: sub.tier ?? 'free',
      vapiMinutesUsed: sub.vapi_minutes_used ?? 0,
      vapiPhoneNumber: sub.vapi_phone_number ?? null,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('subscription:check error:', message)
    throw err  // license.ts handles offline fallback
  }
})

ipcMain.handle('pdf:share', async (_e, html: string, defaultName: string) => {
  const tmpHtml = path.join(os.tmpdir(), `ergoflow-pdf-${Date.now()}.html`)
  const safeName = defaultName.replace(/[/\\?%*:|"<>]/g, '-')
  const tmpPdf  = path.join(os.tmpdir(), `ergoflow-${safeName}-${Date.now()}.pdf`)
  fs.writeFileSync(tmpHtml, html, 'utf-8')
  const printWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  await printWin.loadFile(tmpHtml)
  await new Promise(r => setTimeout(r, 400))
  const pdfData = await printWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  printWin.destroy()
  try { fs.unlinkSync(tmpHtml) } catch {}
  fs.writeFileSync(tmpPdf, pdfData)
  // Force Windows "Open with" dialog so user can choose the app
  const { spawn } = await import('child_process')
  spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', tmpPdf], { detached: true, stdio: 'ignore' }).unref()
})

