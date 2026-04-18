import { BrowserWindow, app } from 'electron'
import { getDb } from './db'
import { getSecret, storeSecret } from './keychain'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'
import { getSessionToken, setSessionToken, getRefreshToken, setRefreshToken } from './session'
import * as fs from 'fs'
import * as path from 'path'

function slog(msg: string) {
  console.log(msg)
  try {
    const logFile = path.join(app.getPath('userData'), 'sync-debug.log')
    // Trim log to last 100KB if it exceeds 200KB
    try {
      const stat = fs.statSync(logFile)
      if (stat.size > 200_000) {
        const content = fs.readFileSync(logFile, 'utf8')
        fs.writeFileSync(logFile, content.slice(-100_000))
      }
    } catch {}
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

const ALLOWED_SYNC_TABLES = new Set([
  'customers', 'calls', 'categories', 'settings',
  'documents', 'document_chunks', 'chat_messages', 'jobs',
  'invoices', 'invoice_items',
  'offers', 'offer_items',
  'inventory',
])

const PUSH_INTERVAL_MS  =  30_000 // push pending changes every 30s (only if queue has items)
const PULL_INTERVAL_MS  = 300_000 // full pull every 5 minutes

export function setupSyncWorker(win: BrowserWindow | null) {
  sync(win) // run immediately on startup
  backfillVapiCalls(win) // pull VAPI call history on startup

  // Push: frequent, but skipped when nothing is queued
  setInterval(() => pushOnly(win), PUSH_INTERVAL_MS)

  // Pull: every 5 minutes
  setInterval(() => pullOnly(win), PULL_INTERVAL_MS)
}

// Called from main.ts when the window regains focus
export function triggerPull(win: BrowserWindow | null) {
  pullOnly(win)
}

export function triggerSync(win: BrowserWindow | null) {
  sync(win)
}

function getOwnerIdFromToken(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) as { sub?: string }
    return payload.sub ?? null
  } catch {
    return null
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken() ?? await getSecret('supabase_refresh_token')
  if (!refreshToken) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) { slog('[SYNC] Token refresh failed: ' + res.status); return null }
    const data = await res.json() as { access_token?: string; refresh_token?: string }
    if (!data.access_token) return null
    setSessionToken(data.access_token)
    if (data.refresh_token) {
      setRefreshToken(data.refresh_token)
      await storeSecret('supabase_refresh_token', data.refresh_token)
    }
    await storeSecret('supabase_access_token', data.access_token)
    slog('[SYNC] Token refreshed OK')
    return data.access_token
  } catch (err) {
    slog('[SYNC] Token refresh error: ' + String(err))
    return null
  }
}

let syncInProgress = false

async function sync(win: BrowserWindow | null) {
  if (syncInProgress) return
  syncInProgress = true
  try { await doSync(win) } finally { syncInProgress = false }
}

async function pushOnly(win: BrowserWindow | null) {
  if (syncInProgress) return
  // Skip if nothing to push
  try {
    const db = getDb()
    const count = (db.prepare('SELECT COUNT(*) as n FROM sync_queue').get() as { n: number }).n
    if (count === 0) return
  } catch { return }
  syncInProgress = true
  try {
    const url = SUPABASE_URL
    const key = SUPABASE_ANON_KEY
    let token = getSessionToken() ?? await getSecret('supabase_access_token')
    if (!url || !key || !token) return
    if (!token) token = await refreshAccessToken()
    if (!token) return
    const ownerId = getOwnerIdFromToken(token)
    if (!ownerId) return
    const db = getDb()
    await pushLocalChanges(url, key, token, ownerId, db)
    win?.webContents.send('sync:complete', { timestamp: new Date().toISOString() })
    slog('[SYNC] Push-only done')
  } catch (err) {
    slog('[SYNC] Push-only error: ' + String(err))
  } finally {
    syncInProgress = false
  }
}

async function pullOnly(win: BrowserWindow | null) {
  if (syncInProgress) return
  syncInProgress = true
  try {
    const url = SUPABASE_URL
    const key = SUPABASE_ANON_KEY
    let token = getSessionToken() ?? await getSecret('supabase_access_token')
    if (!url || !key) return
    if (!token) token = await refreshAccessToken()
    if (!token) return
    const db = getDb()
    await pullRemoteChanges(url, key, token, db)
    win?.webContents.send('sync:complete', { timestamp: new Date().toISOString() })
    slog('[SYNC] Pull-only done')
  } catch (err) {
    slog('[SYNC] Pull-only error: ' + String(err))
  } finally {
    syncInProgress = false
  }
}

async function doSync(win: BrowserWindow | null) {
  const supabaseUrl = SUPABASE_URL
  const supabaseKey = SUPABASE_ANON_KEY
  // Try in-memory session first, fall back to keychain
  let accessToken = getSessionToken() ?? await getSecret('supabase_access_token')

  slog('[SYNC] Running sync...')
  slog('[SYNC] URL: ' + (supabaseUrl ? 'OK' : 'MISSING'))
  slog('[SYNC] Key: ' + (supabaseKey ? 'OK' : 'MISSING'))
  slog('[SYNC] Token: ' + (accessToken ? 'OK' : 'MISSING'))

  // If no token, try to refresh
  if (!accessToken) {
    slog('[SYNC] No token — attempting refresh')
    accessToken = await refreshAccessToken()
  }

  // Need user's session token to pass RLS
  if (!supabaseUrl || !supabaseKey || !accessToken) {
    slog('[SYNC] Bailing — missing credentials')
    return
  }

  const ownerId = getOwnerIdFromToken(accessToken)
  slog('[SYNC] Owner ID: ' + (ownerId ? 'OK' : 'MISSING'))
  if (!ownerId) return

  try {
    const db = getDb()
    const queue = db.prepare('SELECT * FROM sync_queue').all()
    slog('[SYNC] Queue items: ' + queue.length)

    // 1. Push unsynced local changes to Supabase
    await pushLocalChanges(supabaseUrl, supabaseKey, accessToken, ownerId, db)

    // Re-read token — push may have refreshed it
    const freshToken = getSessionToken() ?? await getSecret('supabase_access_token') ?? accessToken

    // 2. Pull remote changes (e.g. calls from VAPI webhook)
    await pullRemoteChanges(supabaseUrl, supabaseKey, freshToken, db)

    win?.webContents.send('sync:complete', { timestamp: new Date().toISOString() })
    slog('[SYNC] Done')
  } catch (err) {
    console.error('Sync error:', err)
    win?.webContents.send('sync:error', { message: String(err) })
  }
}

async function backfillVapiCalls(win: BrowserWindow | null) {
  const vapiKey = await getSecret('vapi_api_key')
  if (!vapiKey) return

  try {
    const res = await fetch('https://api.vapi.ai/call?limit=100&sortOrder=desc', {
      headers: { Authorization: `Bearer ${vapiKey}` },
    })
    if (!res.ok) return

    const data = await res.json() as { results?: Array<Record<string, unknown>> }
    const calls = data.results ?? []
    const db = getDb()

    for (const call of calls) {
      const vapiId = String(call.id ?? '')
      if (!vapiId) continue

      // Skip if already exists
      const existing = db.prepare('SELECT id FROM calls WHERE vapi_call_id = ?').get(vapiId)
      if (existing) continue

      const customerPhone = extractPhone(call)
      const id = crypto.randomUUID()

      db.prepare(`
        INSERT OR IGNORE INTO calls
          (id, vapi_call_id, customer_phone, customer_name, direction, status,
           duration_seconds, transcript, summary, recording_url, started_at, ended_at)
        VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, vapiId, customerPhone, customerPhone,
        normalizeStatus(String(call.status ?? '')),
        typeof call.duration === 'number' ? call.duration : null,
        extractTranscript(call),
        extractSummary(call),
        String((call.recordingUrl ?? call.recording_url) ?? '') || null,
        call.startedAt ?? call.started_at ?? null,
        call.endedAt   ?? call.ended_at   ?? null
      )
    }

    win?.webContents.send('sync:complete', { timestamp: new Date().toISOString(), backfill: true })
  } catch (err) {
    console.error('VAPI backfill error:', err)
  }
}

function extractPhone(call: Record<string, unknown>): string | null {
  const customer = call.customer as Record<string, unknown> | undefined
  return String(customer?.number ?? customer?.phone ?? call.phoneNumber ?? '') || null
}

function normalizeStatus(status: string): string {
  if (status === 'ended')       return 'completed'
  if (status === 'no-answer')   return 'missed'
  if (status === 'in-progress') return 'in-progress'
  return 'completed'
}

function extractTranscript(call: Record<string, unknown>): string | null {
  const messages = call.messages as Array<Record<string, unknown>> | undefined
  if (!messages?.length) return null
  return messages.map(m => `${m.role}: ${m.message ?? m.content}`).join('\n')
}

function extractSummary(call: Record<string, unknown>): string | null {
  const analysis = call.analysis as Record<string, unknown> | undefined
  return String(analysis?.summary ?? call.summary ?? '') || null
}

async function pushLocalChanges(url: string, key: string, accessToken: string, ownerId: string, db: ReturnType<typeof getDb>, retried = false) {
  const queue = db.prepare('SELECT * FROM sync_queue ORDER BY id ASC LIMIT 100').all() as Array<{
    id: number
    table_name: string
    record_id: string
    operation: string
  }>

  for (const item of queue) {
    if (!ALLOWED_SYNC_TABLES.has(item.table_name)) {
      slog(`[SYNC] Rejected unknown table in queue: ${item.table_name}`)
      db.prepare('DELETE FROM sync_queue WHERE id = ?').run(item.id)
      continue
    }
    try {
      const record = db.prepare(`SELECT * FROM ${item.table_name} WHERE id = ?`).get(item.record_id)
      if (!record && item.operation !== 'delete') {
        db.prepare('DELETE FROM sync_queue WHERE id = ?').run(item.id)
        continue
      }

      const endpoint = `${url}/rest/v1/${item.table_name}`
      const headers = {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${accessToken}`,  // user's session token — satisfies RLS
        Prefer: 'resolution=merge-duplicates',
      }

      let res: Response
      if (item.operation === 'delete') {
        res = await fetch(`${endpoint}?id=eq.${item.record_id}`, { method: 'DELETE', headers })
      } else {
        // Strip local-only fields, inject owner_id for RLS
        const { synced: _s, ...clean } = record as Record<string, unknown>
        const enriched = { ...clean, owner_id: ownerId }
        res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(enriched) })
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        // On 401, refresh the token and retry the entire batch once
        if (res.status === 401 && !retried) {
          slog('[SYNC] 401 — refreshing token and retrying push')
          const newToken = await refreshAccessToken()
          if (newToken) {
            const newOwnerId = getOwnerIdFromToken(newToken) ?? ownerId
            return pushLocalChanges(url, key, newToken, newOwnerId, db, true)
          }
          // Refresh failed — abort the whole batch, will retry next cycle
          slog('[SYNC] Token refresh failed — aborting push, will retry next cycle')
          return
        }
        slog(`[SYNC] Push failed ${item.table_name}/${item.record_id}: ${res.status} ${body.slice(0, 200)}`)
        continue  // leave in queue, retry next cycle
      }

      db.prepare('DELETE FROM sync_queue WHERE id = ?').run(item.id)
      db.prepare(`UPDATE ${item.table_name} SET synced = 1 WHERE id = ?`).run(item.record_id)
    } catch (err) {
      console.error(`Failed to push ${item.table_name}/${item.record_id}:`, err)
    }
  }
}

async function pullRemoteChanges(url: string, key: string, initialToken: string, db: ReturnType<typeof getDb>) {
  // Order matters: parent tables before child tables (foreign key constraints)
  const tables = ['settings', 'customers', 'calls', 'categories', 'offers', 'offer_items', 'jobs', 'invoices', 'invoice_items', 'inventory']
  let accessToken = initialToken
  const getHeaders = () => ({ apikey: key, Authorization: `Bearer ${accessToken}` })

  // Disable foreign keys during pull to avoid ordering issues
  try { db.pragma('foreign_keys = OFF') } catch { /* ignore */ }

  // Get last pull timestamp — if never synced, pull everything
  let lastPull: string | null = null
  try {
    const meta = db.prepare("SELECT value FROM sync_meta WHERE key = 'last_pull_at'").get() as { value: string } | undefined
    lastPull = meta?.value ?? null
  } catch { /* sync_meta table may not exist yet */ }

  let anyFailed = false

  for (const table of tables) {
    try {
      const filter = lastPull
        ? `updated_at=gte.${lastPull}&select=*`
        : `select=*`
      let res = await fetch(`${url}/rest/v1/${table}?${filter}`, { headers: getHeaders() })

      // On 401, refresh token and retry once
      if (res.status === 401) {
        slog('[SYNC] Pull got 401 — refreshing token and retrying')
        const newToken = await refreshAccessToken()
        if (newToken) {
          accessToken = newToken
          res = await fetch(`${url}/rest/v1/${table}?${filter}`, { headers: getHeaders() })
        }
      }

      // On 400 with an incremental filter, the table likely lacks updated_at — retry as full pull
      if (res.status === 400 && lastPull) {
        slog(`[SYNC] Pull ${table} got 400 on incremental filter — retrying as full pull`)
        res = await fetch(`${url}/rest/v1/${table}?select=*`, { headers: getHeaders() })
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        slog(`[SYNC] Pull failed ${table}: ${res.status} ${body.slice(0, 200)}`)
        anyFailed = true
        continue
      }
      const rows = (await res.json()) as Record<string, unknown>[]
      if (rows.length === 0) { slog(`[SYNC] Pull ${table}: 0 rows`); continue }

      // Get columns that actually exist in local SQLite table — skip unknown columns
      // (if we include a column Supabase has but local doesn't, the entire INSERT fails silently)
      const SAFE_COL = /^[a-z_][a-z0-9_]*$/i
      const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      const localCols = new Set(tableInfo.map(r => r.name))

      // Build set of record IDs that have pending local changes (not yet pushed)
      // — these must not be overwritten by a pull
      const pendingIds = new Set(
        (db.prepare('SELECT record_id FROM sync_queue WHERE table_name = ?').all(table) as Array<{ record_id: string }>)
          .map(r => r.record_id)
      )

      for (const row of rows) {
        // Skip records with pending local changes — local wins
        if (row['id'] && pendingIds.has(String(row['id']))) continue

        const cols = Object.keys(row).filter(c => SAFE_COL.test(c) && c !== 'owner_id' && localCols.has(c))
        if (cols.length === 0) continue
        const placeholders = cols.map(() => '?').join(', ')
        const updates = cols.map(c => `${c} = excluded.${c}`).join(', ')
        // Convert booleans to 0/1 — SQLite doesn't accept JS booleans
        const vals = cols.map(c => {
          const v = row[c]
          return typeof v === 'boolean' ? (v ? 1 : 0) : v
        })
        try {
          db.prepare(
            `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
             ON CONFLICT(id) DO UPDATE SET ${updates}`
          ).run(...vals)
        } catch (e) {
          slog(`[SYNC] Row insert failed ${table}: ${String(e).slice(0, 200)}`)
        }
      }
      slog(`[SYNC] Pulled ${rows.length} rows from ${table}`)
    } catch (err) {
      console.error(`Failed to pull ${table}:`, err)
    }
  }

  // Re-enable foreign keys
  try { db.pragma('foreign_keys = ON') } catch { /* ignore */ }

  // Only update last_pull_at if all tables succeeded — otherwise retry full pull next cycle
  if (!anyFailed) {
    try {
      db.prepare("CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT)").run()
      db.prepare("INSERT INTO sync_meta (key, value) VALUES ('last_pull_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(new Date().toISOString())
    } catch { /* ignore */ }
  } else {
    // Clear last_pull_at so next sync does a full pull
    try {
      db.prepare("DELETE FROM sync_meta WHERE key = 'last_pull_at'").run()
    } catch { /* ignore */ }
  }
}
