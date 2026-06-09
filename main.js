"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const db_1 = require("./db");
const keychain_1 = require("./keychain");
const sync_1 = require("./sync");
const session_1 = require("./session");
const DEV = process.env['NODE_ENV'] === 'development';
const DEV_SERVER = `http://127.0.0.1:${process.env['VITE_DEV_PORT'] ?? '5173'}`;
// Supabase public credentials — safe to embed (anon key, not service role)
// VITE_ vars are Vite-only and are NOT available in the Electron main process at runtime
const SUPA_URL = 'https://ftorwjwcxcgbwwonbcwq.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0b3J3andjeGNnYnd3b25iY3dxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NDAwNDgsImV4cCI6MjA4OTQxNjA0OH0.3PhQcZYnisEmANFKEJPfbcg4_FIhqhQnH2Mz-hVx7U8';
let mainWindow = null;
let tray = null;
let isInstallingUpdate = false;
let isQuitting = false;
// In-memory state — updated via IPC when user toggles the setting
let minimizeToTray = false;
function getRuntimeIconPath() {
    if (electron_1.app.isPackaged) {
        return path_1.default.join(process.resourcesPath, 'assets', 'icon.ico');
    }
    return path_1.default.join(__dirname, '../assets/icon.ico');
}
function destroyTray() {
    try {
        tray?.destroy();
    }
    catch { /* ignore */ }
    tray = null;
}
function readMinimizeToTraySetting() {
    try {
        const row = (0, db_1.getDb)().prepare("SELECT minimize_to_tray FROM settings WHERE id = 'main'").get();
        return row?.minimize_to_tray === 1;
    }
    catch {
        return false;
    }
}
function createTray() {
    if (tray)
        return; // guard against double creation (hot reload in dev)
    try {
        tray = new electron_1.Tray(getRuntimeIconPath());
    }
    catch (err) {
        console.error('Tray icon unavailable:', err instanceof Error ? err.message : err);
        return;
    }
    tray.setToolTip('Ergoflow');
    const contextMenu = electron_1.Menu.buildFromTemplate([
        {
            label: 'Άνοιγμα',
            click: () => {
                mainWindow?.show();
                mainWindow?.focus();
            },
        },
        { type: 'separator' },
        {
            label: 'Έξοδος',
            click: () => {
                isQuitting = true;
                destroyTray();
                electron_1.app.quit();
            },
        },
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
        mainWindow?.show();
        mainWindow?.focus();
    });
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    if (DEV) {
        mainWindow.loadURL(DEV_SERVER);
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../dist/index.html'));
    }
    // Right-click context menu with copy/paste/cut
    mainWindow.webContents.on('context-menu', (_e, params) => {
        const menu = electron_1.Menu.buildFromTemplate([
            { role: 'cut', enabled: params.editFlags.canCut },
            { role: 'copy', enabled: params.editFlags.canCopy },
            { role: 'paste', enabled: params.editFlags.canPaste },
            { type: 'separator' },
            { role: 'selectAll', enabled: params.editFlags.canSelectAll },
        ]);
        menu.popup();
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            electron_1.shell.openExternal(url);
            return { action: 'deny' };
        }
        // Allow blob: URLs to open in a new Electron window (e.g. invoice printing)
        return { action: 'allow' };
    });
}
function extractUserIdFromToken(token) {
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return payload.sub ?? null;
    }
    catch {
        return null;
    }
}
function normalizeSqlParam(value) {
    if (typeof value === 'boolean')
        return value ? 1 : 0;
    if (value === undefined || value === null)
        return null;
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint')
        return value;
    if (Buffer.isBuffer(value))
        return value;
    return String(value);
}
function normalizeSqlParams(params = []) {
    return params.map(normalizeSqlParam);
}
electron_1.app.whenReady().then(async () => {
    electron_1.app.setAppUserModelId('com.ergoflow.crm');
    await (0, db_1.initDatabase)();
    // If a user was previously logged in, switch to their DB immediately
    try {
        const token = await (0, keychain_1.getSecret)('supabase_access_token');
        if (token) {
            const userId = extractUserIdFromToken(token);
            if (userId)
                (0, db_1.switchDatabase)(userId);
        }
    }
    catch { /* no stored token — user will log in */ }
    (0, db_1.cleanupOldPendingJobs)();
    // ── CSP (production only — dev server handles its own headers) ─────────
    if (!DEV) {
        const { session } = await Promise.resolve().then(() => __importStar(require('electron')));
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
            });
        });
    }
    createWindow();
    // Read minimize_to_tray setting and wire up the close handler
    minimizeToTray = readMinimizeToTraySetting();
    createTray();
    mainWindow?.on('close', (event) => {
        if (minimizeToTray && !isQuitting && !isInstallingUpdate) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });
    // Only start sync worker if user has opted in
    try {
        const syncRow = (0, db_1.getDb)().prepare("SELECT sync_enabled FROM settings WHERE id = 'main'").get();
        if (syncRow?.sync_enabled === 1)
            (0, sync_1.setupSyncWorker)(mainWindow);
    }
    catch { /* DB not ready yet — sync will start via sync:enable IPC if needed */ }
    mainWindow?.on('focus', () => (0, sync_1.triggerPull)(mainWindow));
    // Auto-updater — only in production builds
    if (!DEV) {
        electron_updater_1.autoUpdater.autoDownload = true;
        electron_updater_1.autoUpdater.autoInstallOnAppQuit = false;
        electron_updater_1.autoUpdater.on('update-downloaded', () => {
            mainWindow?.webContents.send('update:ready');
        });
        electron_updater_1.autoUpdater.on('error', (err) => {
            console.error('Auto-updater error:', err.message);
            mainWindow?.webContents.send('update:error', err.message);
        });
        setTimeout(() => { electron_updater_1.autoUpdater.checkForUpdates().catch(() => { }); }, 3000);
    }
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.ipcMain.handle('update:install', () => {
    // Disable tray-hide/tray lifetime so NSIS can replace the running executable.
    isInstallingUpdate = true;
    isQuitting = true;
    minimizeToTray = false;
    destroyTray();
    electron_updater_1.autoUpdater.quitAndInstall(false, true);
});
electron_1.app.on('before-quit', () => {
    isQuitting = true;
});
electron_1.app.on('window-all-closed', () => {
    // When minimize-to-tray is active the window is hidden, not closed — don't quit
    if (minimizeToTray)
        return;
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
// ── IPC: Keychain ─────────────────────────────────────────────────────────
electron_1.ipcMain.handle('keychain:set', async (_e, key, value) => {
    await (0, keychain_1.storeSecret)(key, value);
    if (key === 'supabase_access_token')
        (0, session_1.setSessionToken)(value);
    if (key === 'supabase_refresh_token')
        (0, session_1.setRefreshToken)(value);
});
electron_1.ipcMain.handle('keychain:get', async (_e, key) => {
    const value = await (0, keychain_1.getSecret)(key);
    if (key === 'supabase_access_token' && value)
        (0, session_1.setSessionToken)(value);
    if (key === 'supabase_refresh_token' && value)
        (0, session_1.setRefreshToken)(value);
    return value;
});
electron_1.ipcMain.handle('keychain:delete', async (_e, key) => {
    await (0, keychain_1.deleteSecret)(key);
});
// ── IPC: SQLite ───────────────────────────────────────────────────────────
electron_1.ipcMain.handle('db:query', async (_e, sql, params = []) => {
    const db = (0, db_1.getDb)();
    return db.prepare(sql).all(...normalizeSqlParams(params));
});
electron_1.ipcMain.handle('db:run', async (_e, sql, params = []) => {
    const db = (0, db_1.getDb)();
    return db.prepare(sql).run(...normalizeSqlParams(params));
});
electron_1.ipcMain.handle('db:bulkDeleteCustomers', async (_e, ids) => {
    const db = (0, db_1.getDb)();
    if (!ids.length)
        return;
    const chunks = [];
    for (let i = 0; i < ids.length; i += 500)
        chunks.push(ids.slice(i, i + 500));
    for (const chunk of chunks) {
        const ph = chunk.map(() => '?').join(',');
        db.prepare(`DELETE FROM customers WHERE id IN (${ph})`).run(chunk);
    }
    const syncStmt = db.prepare('INSERT OR IGNORE INTO sync_queue (table_name, record_id, operation) VALUES (?, ?, ?)');
    for (const id of ids)
        syncStmt.run('customers', id, 'delete');
});
electron_1.ipcMain.handle('db:get', async (_e, sql, params = []) => {
    const db = (0, db_1.getDb)();
    return db.prepare(sql).get(...normalizeSqlParams(params));
});
electron_1.ipcMain.handle('db:switch', (_e, tokenOrUserId) => {
    let userId = null;
    if (tokenOrUserId.includes('.')) {
        // It's a JWT — decode the sub claim
        userId = extractUserIdFromToken(tokenOrUserId);
    }
    else {
        // It's already a plain UUID
        userId = tokenOrUserId;
    }
    if (userId) {
        (0, db_1.switchDatabase)(userId);
    }
});
// ── IPC: Settings notifications ───────────────────────────────────────────
electron_1.ipcMain.on('settings:minimizeToTray', (_e, value) => {
    minimizeToTray = value;
});
electron_1.ipcMain.handle('sync:now', () => (0, sync_1.triggerSync)(mainWindow));
electron_1.ipcMain.handle('sync:enable', () => {
    if (!(0, sync_1.isSyncWorkerRunning)())
        (0, sync_1.setupSyncWorker)(mainWindow);
    return (0, sync_1.triggerSync)(mainWindow);
});
// ── IPC: Notifications ────────────────────────────────────────────────────
electron_1.ipcMain.handle('notify', (_e, title, body) => {
    new electron_1.Notification({ title, body }).show();
});
// ── IPC: Shell ────────────────────────────────────────────────────────────
electron_1.ipcMain.handle('shell:openExternal', (_e, url) => {
    // Allow http/https and known messenger schemes
    const parsed = new URL(url);
    const allowed = ['https:', 'http:', 'whatsapp:', 'viber:'];
    if (!allowed.includes(parsed.protocol)) {
        console.warn('openExternal blocked URL:', parsed.protocol);
        return;
    }
    electron_1.shell.openExternal(url);
});
// ── IPC: App info ─────────────────────────────────────────────────────────
electron_1.ipcMain.handle('app:getVersion', () => electron_1.app.getVersion());
electron_1.ipcMain.handle('app:getDataPath', () => electron_1.app.getPath('userData'));
// ── IPC: PDF Download ─────────────────────────────────────────────────────
electron_1.ipcMain.handle('pdf:download', async (_e, url) => {
    const res = await electron_1.net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok)
        throw new Error(`HTTP ${res.status} downloading ${url}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer;
});
// ── IPC: Brave Search (bypasses CORS) ─────────────────────────────────────
electron_1.ipcMain.handle('brave:search', async (_e, query, apiKey, lang = 'el') => {
    const locale = lang === 'en' ? '&country=us&search_lang=en&ui_lang=en-US' : '&country=gr&search_lang=el&ui_lang=el-GR';
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5${locale}`;
    const res = await electron_1.net.fetch(url, {
        headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': apiKey,
        },
    });
    if (!res.ok)
        throw new Error(`Brave Search error: ${res.status}`);
    return await res.json();
});
// ── IPC: Ollama proxy (bypasses CORS from file:// renderer) ──────────────
electron_1.ipcMain.handle('ollama:tags', async (_e, baseUrl) => {
    const res = await electron_1.net.fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`);
    if (!res.ok)
        throw new Error(`Ollama error: ${res.status}`);
    return await res.json();
});
electron_1.ipcMain.handle('ollama:chat', async (_e, baseUrl, body) => {
    const res = await electron_1.net.fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
    });
    if (!res.ok)
        throw new Error(`Ollama error: HTTP ${res.status}`);
    return await res.json();
});
electron_1.ipcMain.handle('ollama:embeddings', async (_e, baseUrl, body) => {
    const res = await electron_1.net.fetch(`${baseUrl.replace(/\/$/, '')}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
    });
    if (!res.ok)
        throw new Error(`Ollama embeddings error: HTTP ${res.status}`);
    return await res.json();
});
// ── IPC: Fetch HTML (for web scraping, bypasses CORS) ─────────────────────
electron_1.ipcMain.handle('web:fetchHtml', async (_e, url) => {
    const res = await electron_1.net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    if (!res.ok)
        throw new Error(`HTTP ${res.status} fetching ${url}`);
    return await res.text();
});
// ── IPC: Print ────────────────────────────────────────────────────────────
electron_1.ipcMain.handle('print:invoice', async (_e, html) => {
    const tmpFile = path_1.default.join(os_1.default.tmpdir(), `ergoflow-invoice-${Date.now()}.html`);
    fs_1.default.writeFileSync(tmpFile, html, 'utf-8');
    const printWin = new electron_1.BrowserWindow({ width: 800, height: 900, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    await printWin.loadFile(tmpFile);
    printWin.focus();
    await new Promise(r => setTimeout(r, 300));
    await printWin.webContents.executeJavaScript('window.print()');
    printWin.on('closed', () => { try {
        fs_1.default.unlinkSync(tmpFile);
    }
    catch { } });
});
electron_1.ipcMain.handle('print:pdf', async (_e, html, defaultName) => {
    const { filePath, canceled } = await electron_1.dialog.showSaveDialog({
        title: 'Αποθήκευση PDF',
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath)
        return { ok: false };
    const tmpFile = path_1.default.join(os_1.default.tmpdir(), `ergoflow-pdf-${Date.now()}.html`);
    fs_1.default.writeFileSync(tmpFile, html, 'utf-8');
    const printWin = new electron_1.BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    await printWin.loadFile(tmpFile);
    await new Promise(r => setTimeout(r, 400));
    const pdfData = await printWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    printWin.destroy();
    fs_1.default.writeFileSync(filePath, pdfData);
    try {
        fs_1.default.unlinkSync(tmpFile);
    }
    catch { }
    electron_1.shell.showItemInFolder(filePath);
    return { ok: true, filePath };
});
// ── IPC: Save PDF directly to Desktop ────────────────────────────────────
electron_1.ipcMain.handle('pdf:saveDesktop', async (_e, html, filename) => {
    const safeName = filename.replace(/[/\\?%*:|"<>]/g, '-') + '.pdf';
    const filePath = path_1.default.join(electron_1.app.getPath('desktop'), safeName);
    const tmpHtml = path_1.default.join(os_1.default.tmpdir(), `ergoflow-pdf-${Date.now()}.html`);
    fs_1.default.writeFileSync(tmpHtml, html, 'utf-8');
    const win = new electron_1.BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    await win.loadFile(tmpHtml);
    await new Promise(r => setTimeout(r, 400));
    const pdfData = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    win.destroy();
    try {
        fs_1.default.unlinkSync(tmpHtml);
    }
    catch { }
    fs_1.default.writeFileSync(filePath, pdfData);
    return filePath;
});
// ── IPC: Bratnet e-invoicing submission ───────────────────────────────────
// Sandbox:    https://einvoicing-dev-api.etimologiera.gr/v4  (current)
// Production: https://einvoicing-api.etimologiera.gr/v4     (switch when going live)
const BRATNET_BASE_URL = 'https://einvoicing-dev-api.etimologiera.gr/v4';
electron_1.ipcMain.handle('mydata:submit', async (_e, params) => {
    try {
        const { invoice, lineItems, companyVat, customerVat } = params;
        // Read Bratnet credentials directly from settings DB — don't trust what renderer passes
        const settingsRow = (0, db_1.getDb)()
            .prepare("SELECT bratnet_username, bratnet_api_key FROM settings WHERE id = 'main'")
            .get();
        const bratnetUsername = settingsRow?.bratnet_username ?? '';
        const bratnetApiKey = settingsRow?.bratnet_api_key ?? '';
        if (!bratnetUsername || !bratnetApiKey) {
            return { success: false, error: 'Missing Bratnet credentials. Go to Settings → Ηλεκτρονική Τιμολόγηση.' };
        }
        const authHeader = 'Basic ' + Buffer.from(`${bratnetUsername}:${bratnetApiKey}`).toString('base64');
        // Parse invoice series and sequential number from invoice.number.
        // Expected format: "ΑΠΥ-2026-001" → series "ΑΠΥ", aa 1
        // Fallback: series "ΑΠΥ", aa 1
        const seriesMatch = invoice.number.match(/^([A-Za-zΑ-Ωα-ωΆ-Ώ]+)/);
        const aaMatch = invoice.number.match(/(\d+)$/);
        const series = seriesMatch ? seriesMatch[1] : 'ΑΠΥ';
        const aa = aaMatch ? parseInt(aaMatch[1], 10) : 1;
        const issueDate = invoice.issue_date ?? new Date().toISOString().slice(0, 10);
        const issueTime = '00:00:00';
        const netValue = Math.round((invoice.total - invoice.tax_amount) * 100) / 100;
        const vatAmount = Math.round(invoice.tax_amount * 100) / 100;
        const totalValue = Math.round(invoice.total * 100) / 100;
        // ── Step 1: createSimSign ────────────────────────────────────────────
        const externalSystemId = invoice.number; // unique per invoice
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
        };
        const signRes = await electron_1.net.fetch(`${BRATNET_BASE_URL}/createSimSign`, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(createSignPayload),
        });
        if (!signRes.ok) {
            const errText = await signRes.text();
            return { success: false, error: `Bratnet createSimSign error HTTP ${signRes.status}: ${errText}` };
        }
        const signData = await signRes.json();
        const hSignature = signData.hSignature ?? '';
        if (!hSignature) {
            return { success: false, error: `Bratnet createSimSign: no hSignature in response: ${JSON.stringify(signData)}` };
        }
        // ── Step 2: sendSimInvoice ───────────────────────────────────────────
        // Build invoice details lines; last line absorbs rounding remainder
        const taxRate = netValue > 0 ? vatAmount / netValue : 0;
        const discountFactor = invoice.subtotal > 0 ? netValue / invoice.subtotal : 1;
        const vatRatePercent = Math.round(taxRate * 100);
        // Map tax rate % to vatCategory: 24→1, 13→2, 6→3, 0→4
        const vatCategory = vatRatePercent >= 24 ? 1 : vatRatePercent >= 13 ? 2 : vatRatePercent >= 6 ? 3 : 4;
        let netAccum = 0;
        let vatAccum = 0;
        const invoiceDetails = lineItems.map((item, idx) => {
            let lineNet;
            let lineVat;
            if (idx === lineItems.length - 1) {
                lineNet = Math.round((netValue - netAccum) * 100) / 100;
                lineVat = Math.round((vatAmount - vatAccum) * 100) / 100;
            }
            else {
                lineNet = Math.round(item.total * discountFactor * 100) / 100;
                lineVat = Math.round(lineNet * taxRate * 100) / 100;
                netAccum += lineNet;
                vatAccum += lineVat;
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
            };
        });
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
        };
        const sendRes = await electron_1.net.fetch(`${BRATNET_BASE_URL}/sendSimInvoice`, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(sendPayload),
        });
        if (!sendRes.ok) {
            const errText = await sendRes.text();
            return { success: false, error: `Bratnet sendSimInvoice error HTTP ${sendRes.status}: ${errText}` };
        }
        const sendData = await sendRes.json();
        const mark = String(sendData.responses?.[0]?.invoiceMark ?? '');
        if (!mark) {
            return { success: false, error: `Bratnet sendSimInvoice: no MARK in response: ${JSON.stringify(sendData)}` };
        }
        return { success: true, mark };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
});
// ── IPC: Subscription check ───────────────────────────────────────────────
// Checks/creates the user's subscription row in Supabase.
// Returns { status, tier, vapiMinutesUsed, vapiPhoneNumber }.
//
// TODO (Stripe webhook Edge Function):
//   1. Create a Supabase Edge Function at supabase/functions/stripe-webhook/index.ts
//   2. On 'customer.subscription.created' / 'invoice.paid' → SET status='active'
//   3. On 'customer.subscription.deleted' / 'invoice.payment_failed' → SET status='expired' or 'cancelled'
//   4. Register the webhook URL in the Stripe dashboard
electron_1.ipcMain.handle('subscription:check', async () => {
    try {
        const supaUrl = process.env['VITE_SUPABASE_URL'] ?? await (0, keychain_1.getSecret)('supabase_url') ?? SUPA_URL;
        const supaKey = process.env['VITE_SUPABASE_ANON_KEY'] ?? await (0, keychain_1.getSecret)('supabase_anon_key') ?? SUPA_KEY;
        if (!supaUrl || !supaKey)
            throw new Error('missing supabase config');
        // Get a fresh token — prefer in-memory (loaded at login), fall back to keychain
        let token = (0, session_1.getSessionToken)() ?? await (0, keychain_1.getSecret)('supabase_access_token');
        if (!token)
            throw new Error('not authenticated');
        try {
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            if ((payload.exp ?? 0) * 1000 < Date.now() + 5 * 60_000) {
                const refreshToken = (0, session_1.getRefreshToken)() ?? await (0, keychain_1.getSecret)('supabase_refresh_token');
                if (refreshToken) {
                    const refreshRes = await electron_1.net.fetch(`${supaUrl}/auth/v1/token?grant_type=refresh_token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', apikey: supaKey },
                        body: JSON.stringify({ refresh_token: refreshToken }),
                        signal: AbortSignal.timeout(5000),
                    });
                    if (refreshRes.ok) {
                        const refreshData = await refreshRes.json();
                        if (refreshData.access_token) {
                            token = refreshData.access_token;
                            await (0, keychain_1.storeSecret)('supabase_access_token', token);
                            if (refreshData.refresh_token)
                                await (0, keychain_1.storeSecret)('supabase_refresh_token', refreshData.refresh_token);
                        }
                    }
                }
            }
        }
        catch { /* use existing token */ }
        // Extract user_id from JWT
        let userId = null;
        try {
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            userId = payload.sub ?? null;
        }
        catch { /* ignore */ }
        if (!userId)
            throw new Error('invalid token');
        const headers = {
            'apikey': supaKey,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        };
        // Try to read existing subscription row
        const getRes = await electron_1.net.fetch(`${supaUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=*&limit=1`, { headers, signal: AbortSignal.timeout(5000) });
        if (!getRes.ok) {
            throw new Error(`subscriptions fetch failed: ${getRes.status}`);
        }
        const rows = await getRes.json();
        let sub = rows[0] ?? null;
        if (!sub) {
            // Genuine first install — no row exists yet, create a free account row
            const createRes = await electron_1.net.fetch(`${supaUrl}/rest/v1/subscriptions`, {
                method: 'POST',
                headers: { ...headers, 'Prefer': 'return=representation' },
                body: JSON.stringify({ user_id: userId, status: 'active', tier: 'free' }),
                signal: AbortSignal.timeout(5000),
            });
            if (createRes.ok) {
                const created = await createRes.json();
                sub = created[0] ?? { status: 'active', trial_end: '', tier: 'free', vapi_minutes_used: 0, vapi_phone_number: null };
            }
            else {
                throw new Error(`subscription create failed: ${createRes.status}`);
            }
        }
        return {
            status: sub.status,
            tier: sub.tier ?? 'free',
            vapiMinutesUsed: sub.vapi_minutes_used ?? 0,
            vapiPhoneNumber: sub.vapi_phone_number ?? null,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('subscription:check error:', message);
        throw err; // license.ts handles offline fallback
    }
});
electron_1.ipcMain.handle('pdf:share', async (_e, html, defaultName) => {
    const tmpHtml = path_1.default.join(os_1.default.tmpdir(), `ergoflow-pdf-${Date.now()}.html`);
    const safeName = defaultName.replace(/[/\\?%*:|"<>]/g, '-');
    const tmpPdf = path_1.default.join(os_1.default.tmpdir(), `ergoflow-${safeName}-${Date.now()}.pdf`);
    fs_1.default.writeFileSync(tmpHtml, html, 'utf-8');
    const printWin = new electron_1.BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    await printWin.loadFile(tmpHtml);
    await new Promise(r => setTimeout(r, 400));
    const pdfData = await printWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    printWin.destroy();
    try {
        fs_1.default.unlinkSync(tmpHtml);
    }
    catch { }
    fs_1.default.writeFileSync(tmpPdf, pdfData);
    // Force Windows "Open with" dialog so user can choose the app
    const { spawn } = await Promise.resolve().then(() => __importStar(require('child_process')));
    spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', tmpPdf], { detached: true, stdio: 'ignore' }).unref();
});
