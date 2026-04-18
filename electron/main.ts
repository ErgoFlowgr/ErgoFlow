import { app, BrowserWindow, ipcMain, Notification, shell, net, Menu, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { initDatabase, switchDatabase, getDb, cleanupOldPendingJobs } from './db'
import { storeSecret, getSecret, deleteSecret } from './keychain'
import { setupSyncWorker, triggerSync, triggerPull } from './sync'
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

function extractUserIdFromToken(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) as { sub?: string }
    return payload.sub ?? null
  } catch { return null }
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
  mainWindow?.on('focus', () => triggerPull(mainWindow))

  // Auto-updater — only in production builds
  if (!DEV) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('update:ready')
    })
    autoUpdater.on('error', (err) => {
      console.error('Auto-updater error:', err.message)
    })
    setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 3000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

ipcMain.handle('update:install', () => { autoUpdater.quitAndInstall() })

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
  return db.prepare(sql).get(...params)
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

ipcMain.handle('sync:now', () => { triggerSync(mainWindow) })

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

// ── IPC: myDATA / ΑΑΔΕ invoice submission ────────────────────────────────
// Dev endpoint: https://mydataapidev.aade.gr/SendInvoices
// Production:   https://mydataapi.aade.gr/SendInvoices  (switch when going live)
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
    const { invoice, lineItems, companyVat, customerVat, mydataUserId, mydataApiKey } = params
    // 1.1 = Τιμολόγιο Παροχής Υπηρεσιών, 11.2 = Απόδειξη Παροχής Υπηρεσιών
    const isReceipt = invoice.document_type === 'receipt'
    const invoiceType = isReceipt ? '11.2' : '1.1'
    // Classification differs by type: invoices use goods (1_1/E3_561_001), receipts use services (1_3/E3_561_007)
    const clsCategory = isReceipt ? 'category1_3' : 'category1_1'
    const clsType     = isReceipt ? 'E3_561_007'  : 'E3_561_001'

    // series = leading letters, aa = trailing digits (must be a plain integer for GR issuers)
    const seriesMatch = invoice.number.match(/^([A-Za-z]+)/)
    const aaMatch     = invoice.number.match(/(\d+)$/)
    const series = seriesMatch ? seriesMatch[1] : 'A'
    const aa     = aaMatch    ? String(parseInt(aaMatch[1], 10)) : '1'

    const issueDate = invoice.issue_date ?? new Date().toISOString().slice(0, 10)

    // Build invoiceDetails lines.
    // Net values are post-discount (proportional) so sum of line gross == totalGrossValue.
    // afterDiscount = total - tax_amount. discountFactor scales each line's net.
    const afterDiscount = invoice.total - invoice.tax_amount
    const discountFactor = invoice.subtotal > 0 ? afterDiscount / invoice.subtotal : 1
    const taxRate = afterDiscount > 0 ? invoice.tax_amount / afterDiscount : 0
    let netAccum = 0
    let vatAccum = 0
    const detailLines = lineItems.map((item, idx) => {
      let netValue: number
      let vatAmount: number
      if (idx === lineItems.length - 1) {
        // Last line absorbs rounding remainder
        netValue = Math.round((afterDiscount - netAccum) * 100) / 100
        vatAmount = Math.round((invoice.tax_amount - vatAccum) * 100) / 100
      } else {
        netValue = Math.round(item.total * discountFactor * 100) / 100
        vatAmount = Math.round(netValue * taxRate * 100) / 100
        netAccum += netValue
        vatAccum += vatAmount
      }
      return `
    <invoiceDetails>
      <lineNumber>${idx + 1}</lineNumber>
      <netValue>${netValue.toFixed(2)}</netValue>
      <vatCategory>1</vatCategory>
      <vatAmount>${vatAmount.toFixed(2)}</vatAmount>
      <incomeClassification>
        <icls:classificationType>${clsType}</icls:classificationType>
        <icls:classificationCategory>${clsCategory}</icls:classificationCategory>
        <icls:amount>${netValue.toFixed(2)}</icls:amount>
      </incomeClassification>
    </invoiceDetails>`
    }).join('')

    // counterpart required for invoices (1.1), not for receipts (11.2)
    const counterpartBlock = (!isReceipt && customerVat) ? `
    <counterpart>
      <vatNumber>${customerVat}</vatNumber>
      <country>GR</country>
      <branch>0</branch>
    </counterpart>` : ''

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<InvoicesDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xmlns:icls="https://www.aade.gr/myDATA/incomeClassificaton/v1.0"
             xmlns:ecls="https://www.aade.gr/myDATA/expensesClassificaton/v1.0">
  <invoice>
    <issuer>
      <vatNumber>${companyVat}</vatNumber>
      <country>GR</country>
      <branch>0</branch>
    </issuer>${counterpartBlock}
    <invoiceHeader>
      <series>${series}</series>
      <aa>${aa}</aa>
      <issueDate>${issueDate}</issueDate>
      <invoiceType>${invoiceType}</invoiceType>
      <currency>EUR</currency>
    </invoiceHeader>
    <paymentMethods>
      <paymentMethodDetails>
        <type>3</type>
        <amount>${invoice.total.toFixed(2)}</amount>
      </paymentMethodDetails>
    </paymentMethods>${detailLines}
    <invoiceSummary>
      <totalNetValue>${afterDiscount.toFixed(2)}</totalNetValue>
      <totalVatAmount>${invoice.tax_amount.toFixed(2)}</totalVatAmount>
      <totalWithheldAmount>0.00</totalWithheldAmount>
      <totalFeesAmount>0.00</totalFeesAmount>
      <totalStampDutyAmount>0.00</totalStampDutyAmount>
      <totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>
      <totalDeductionsAmount>0.00</totalDeductionsAmount>
      <totalGrossValue>${invoice.total.toFixed(2)}</totalGrossValue>
      <incomeClassification>
        <icls:classificationType>${clsType}</icls:classificationType>
        <icls:classificationCategory>${clsCategory}</icls:classificationCategory>
        <icls:amount>${afterDiscount.toFixed(2)}</icls:amount>
      </incomeClassification>
    </invoiceSummary>
  </invoice>
</InvoicesDoc>`

    const res = await net.fetch('https://mydataapidev.aade.gr/SendInvoices', {
      method: 'POST',
      headers: {
        'aade-user-id': mydataUserId,
        'Ocp-Apim-Subscription-Key': mydataApiKey,
        'Content-Type': 'application/xml',
      },
      body: xml,
    })

    const responseText = await res.text()

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${responseText}` }
    }

    // Extract ΜΑΡΚ from response XML: <invoiceMark>...</invoiceMark>
    const markMatch = responseText.match(/<invoiceMark>(\d+)<\/invoiceMark>/)
    const mark = markMatch ? markMatch[1] : null

    if (!mark) {
      return { success: false, error: `No ΜΑΡΚ in response: ${responseText}` }
    }

    return { success: true, mark }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
})

// ── IPC: Subscription check ───────────────────────────────────────────────
// Checks/creates the user's subscription row in Supabase.
// Returns { status, daysLeft, trialEnd }.
//
// TODO (Stripe webhook Edge Function):
//   1. Create a Supabase Edge Function at supabase/functions/stripe-webhook/index.ts
//   2. On 'customer.subscription.created' / 'invoice.paid' → SET status='active'
//   3. On 'customer.subscription.deleted' / 'invoice.payment_failed' → SET status='expired' or 'cancelled'
//   4. Register the webhook URL in the Stripe dashboard
ipcMain.handle('subscription:check', async () => {
  try {
    const envUrl  = process.env['VITE_SUPABASE_URL']
    const envKey  = process.env['VITE_SUPABASE_ANON_KEY']
    const supaUrl = envUrl  ?? await getSecret('supabase_url')  ?? ''
    const supaKey = envKey  ?? await getSecret('supabase_anon_key') ?? ''
    const token   = await getSecret('supabase_access_token')

    if (!supaUrl || !supaKey || !token) {
      return { status: 'trial', daysLeft: 30, trialEnd: new Date(Date.now() + 30 * 86400_000).toISOString() }
    }

    // Extract user_id from JWT
    let userId: string | null = null
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) as { sub?: string }
      userId = payload.sub ?? null
    } catch { /* ignore */ }

    if (!userId) {
      return { status: 'trial', daysLeft: 30, trialEnd: new Date(Date.now() + 30 * 86400_000).toISOString() }
    }

    const headers: Record<string, string> = {
      'apikey': supaKey,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }

    // Try to read existing subscription row
    const getRes = await net.fetch(
      `${supaUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=*&limit=1`,
      { headers }
    )

    type SubRow = {
      status: string
      trial_end: string
      tier: string
      vapi_minutes_used: number
      vapi_phone_number: string | null
    }
    let sub: SubRow | null = null

    if (getRes.ok) {
      const rows = await getRes.json() as Array<SubRow>
      sub = rows[0] ?? null
    }

    if (!sub) {
      // First install — create a trial row (basic tier, 30-day trial)
      const trialEnd = new Date(Date.now() + 30 * 86400_000).toISOString()
      const createRes = await net.fetch(`${supaUrl}/rest/v1/subscriptions`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({ user_id: userId, status: 'trial', trial_end: trialEnd, tier: 'pro_plus' }), // trial gets full access
      })
      if (createRes.ok) {
        const created = await createRes.json() as Array<SubRow>
        sub = created[0] ?? { status: 'trial', trial_end: trialEnd, tier: 'pro_plus', vapi_minutes_used: 0, vapi_phone_number: null }
      } else {
        sub = { status: 'trial', trial_end: trialEnd, tier: 'pro_plus', vapi_minutes_used: 0, vapi_phone_number: null }
      }
    }

    const trialEnd = new Date(sub.trial_end)
    const now = Date.now()
    const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - now) / 86400_000))

    // If still marked as trial but trial has expired, treat as expired
    const effectiveStatus =
      sub.status === 'trial' && trialEnd.getTime() < now ? 'expired' : sub.status

    return {
      status: effectiveStatus,
      daysLeft,
      trialEnd: sub.trial_end,
      tier: sub.tier ?? 'basic',
      vapiMinutesUsed: sub.vapi_minutes_used ?? 0,
      vapiPhoneNumber: sub.vapi_phone_number ?? null,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('subscription:check error:', message)
    // On error, default to trial with full access so the app doesn't block
    return { status: 'trial', daysLeft: 30, trialEnd: new Date(Date.now() + 30 * 86400_000).toISOString(), tier: 'pro_plus', vapiMinutesUsed: 0, vapiPhoneNumber: null }
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

