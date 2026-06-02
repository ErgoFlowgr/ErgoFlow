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

const PUSH_INTERVAL_MS  =  60_000 // push pending changes every 60s (only if queue has items)
const PULL_INTERVAL_MS  = 300_000 // full pull every 5 minutes
const FETCH_TIMEOUT_MS  =   5_000 // abort individual sync fetch calls after 5s

// Settings fields that exist only on this device, are derived from subscription
// state, or contain secrets / large local payloads. Pushing these to Supabase
// caused PGRST204 schema errors when the cloud table lagged behind the local
// SQLite schema, and would also leak machine-local preferences between devices.
const SETTINGS_PUSH_EXCLUDE_COLUMNS = new Set([
  'sync_enabled',
  'minimize_to_tray',
  'company_logo',
  'bratnet_username',
  'bratnet_api_key',
  'ai_trial_start',
  'ai_trial_used',
])

let consecutivePushFailures = 0
let pushBackoffUntil = 0
let syncWorkerRunning = false

export function isSyncWorkerRunning() { return syncWorkerRunning }

function isSyncEnabled(): boolean {
  try {
    const row = getDb().prepare("SELECT sync_enabled FROM settings WHERE id = 'main'").get() as { sync_enabled?: number } | undefined
    return (row?.sync_enabled ?? 0) === 1
  } catch { return false }
}

function emitSyncError(win: BrowserWindow | null, reason: string) {
  slog('[SYNC] Error: ' + reason)
  win?.webContents.send('sync:error', { message: reason, reason })
}

export function setupSyncWorker(win: BrowserWindow | null) {
  if (syncWorkerRunning) return
  syncWorkerRunning = true

  void sync(win) // run immediately on startup
  backfillVapiCalls(win) // pull VAPI call history on startup

  // .unref() so intervals don't keep the process alive after the window closes
  setInterval(() => pushOnly(win), PUSH_INTERVAL_MS).unref()
  setInterval(() => pullOnly(win), PULL_INTERVAL_MS).unref()
}

// Called from main.ts when the window regains focus
export function triggerPull(win: BrowserWindow | null) {
  void pullOnly(win)
}

export function triggerSync(win: BrowserWindow | null): Promise<boolean> {
  return sync(win)
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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

async function sync(win: BrowserWindow | null): Promise<boolean> {
  if (!isSyncEnabled()) {
    emitSyncError(win, 'sync disabled')
    return false
  }
  if (syncInProgress) {
    emitSyncError(win, 'sync already running')
    return false
  }
  syncInProgress = true
  try { return await doSync(win) } finally { syncInProgress = false }
}

async function pushOnly(win: BrowserWindow | null) {
  if (!isSyncEnabled()) return
  if (syncInProgress) return
  // Back off if Supabase keeps failing
  if (Date.now() < pushBackoffUntil) {
    slog(`[SYNC] Push skipped — backing off until ${new Date(pushBackoffUntil).toISOString()}`)
    return
  }
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
    const pushed = await pushLocalChanges(url, key, token, ownerId, db)
    if (pushed) {
      consecutivePushFailures = 0
      win?.webContents.send('sync:complete', { timestamp: new Date().toISOString() })
    } else {
      consecutivePushFailures++
      // After 3 consecutive all-fail cycles, back off for 10 minutes
      if (consecutivePushFailures >= 3) {
        pushBackoffUntil = Date.now() + 10 * 60_000
        slog(`[SYNC] ${consecutivePushFailures} consecutive failures — backing off 10 min`)
      }
    }
    slog('[SYNC] Push-only done')
  } catch (err) {
    consecutivePushFailures++
    slog('[SYNC] Push-only error: ' + String(err))
  } finally {
    syncInProgress = false
  }
}

async function pullOnly(win: BrowserWindow | null) {
  if (!isSyncEnabled()) return
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
    const remoteWon = await pullRemoteChanges(url, key, token, db)
    for (const entry of remoteWon) {
      const sep = entry.indexOf(':')
      db.prepare("DELETE FROM sync_queue WHERE table_name = ? AND record_id = ? AND operation != 'delete'").run(entry.slice(0, sep), entry.slice(sep + 1))
    }
    win?.webContents.send('sync:complete', { timestamp: new Date().toISOString() })
    slog('[SYNC] Pull-only done')
  } catch (err) {
    slog('[SYNC] Pull-only error: ' + String(err))
  } finally {
    syncInProgress = false
  }
}

async function doSync(win: BrowserWindow | null): Promise<boolean> {
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
    const missing = [
      !supabaseUrl ? 'Supabase URL' : '',
      !supabaseKey ? 'Supabase anon key' : '',
      !accessToken ? 'login token' : '',
    ].filter(Boolean).join(', ')
    emitSyncError(win, `missing credentials: ${missing}`)
    return false
  }

  const ownerId = getOwnerIdFromToken(accessToken)
  slog('[SYNC] Owner ID: ' + (ownerId ? 'OK' : 'MISSING'))
  if (!ownerId) {
    emitSyncError(win, 'token missing owner id')
    return false
  }

  try {
    const db = getDb()
    const queue = db.prepare('SELECT * FROM sync_queue').all()
    slog('[SYNC] Queue items: ' + queue.length)

    // 1. Pull first — remote wins only if its updated_at is newer than local
    const remoteWon = await pullRemoteChanges(supabaseUrl, supabaseKey, accessToken, db)

    // Drop sync_queue upsert entries for records remote just won —
    // no point pushing older local data back up
    for (const entry of remoteWon) {
      const sep = entry.indexOf(':')
      const tbl = entry.slice(0, sep)
      const id  = entry.slice(sep + 1)
      db.prepare("DELETE FROM sync_queue WHERE table_name = ? AND record_id = ? AND operation != 'delete'").run(tbl, id)
    }

    // Re-read token — pull may have refreshed it
    const freshToken = getSessionToken() ?? await getSecret('supabase_access_token') ?? accessToken
    const freshOwnerId = getOwnerIdFromToken(freshToken) ?? ownerId

    // 2. Push local changes that are genuinely newer, then propagate local deletes
    await pushLocalChanges(supabaseUrl, supabaseKey, freshToken, freshOwnerId, db)

    win?.webContents.send('sync:complete', { timestamp: new Date().toISOString() })
    slog('[SYNC] Done')
    return true
  } catch (err) {
    const reason = err instanceof Error && err.message ? err.message : String(err)
    console.error('Sync error:', err)
    emitSyncError(win, reason || 'sync failed')
    return false
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

async function pushLocalChanges(url: string, key: string, accessToken: string, ownerId: string, db: ReturnType<typeof getDb>, retried = false): Promise<boolean> {
  const queue = db.prepare('SELECT * FROM sync_queue ORDER BY id ASC LIMIT 50').all() as Array<{
    id: number
    table_name: string
    record_id: string
    operation: string
  }>

  if (queue.length === 0) return true

  let anySuccess = false
  let anyFailure = false

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
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'resolution=merge-duplicates',
      }

      let res: Response
      const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
      if (item.operation === 'delete') {
        res = await fetch(`${endpoint}?id=eq.${item.record_id}`, { method: 'DELETE', headers, signal })
      } else {
        const { synced: _s, ...clean } = record as Record<string, unknown>
        let bodyObj: Record<string, unknown>
        if (item.table_name === 'settings') {
          // Exclude device-local/secret/runtime fields and nulls so this device
          // cannot overwrite another device's data or push columns missing from
          // the cloud settings schema.
          bodyObj = Object.fromEntries(
            Object.entries(clean as Record<string, unknown>).filter(([k, v]) =>
              !SETTINGS_PUSH_EXCLUDE_COLUMNS.has(k) && v !== null && v !== undefined
            )
          )
          bodyObj['owner_id'] = ownerId
        } else {
          bodyObj = { ...clean, owner_id: ownerId }
        }
        res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(bodyObj), signal })
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        if (res.status === 401 && !retried) {
          slog('[SYNC] 401 — refreshing token and retrying push')
          const newToken = await refreshAccessToken()
          if (newToken) {
            const newOwnerId = getOwnerIdFromToken(newToken) ?? ownerId
            return pushLocalChanges(url, key, newToken, newOwnerId, db, true)
          }
          slog('[SYNC] Token refresh failed — aborting push')
          return false
        }
        // PGRST204 = column missing from Supabase schema — won't be fixed by retrying this payload.
        if (res.status === 400 && body.includes('PGRST204')) {
          slog(`[SYNC] Dropping ${item.table_name}/${item.record_id}: Supabase schema column missing; check excluded settings columns or run migration`)
          db.prepare('DELETE FROM sync_queue WHERE id = ?').run(item.id)
          continue
        }
        slog(`[SYNC] Push failed ${item.table_name}/${item.record_id}: ${res.status} ${body.slice(0, 200)}`)
        anyFailure = true
        continue
      }

      // For deletes: insert a tombstone so other devices learn about this deletion
      if (item.operation === 'delete') {
        try {
          await fetch(`${url}/rest/v1/deleted_records`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify({
              owner_id: ownerId,
              table_name: item.table_name,
              record_id: item.record_id,
              deleted_at: new Date().toISOString(),
            }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          })
        } catch { /* tombstone failure is non-fatal */ }
      }

      db.prepare('DELETE FROM sync_queue WHERE id = ?').run(item.id)
      db.prepare(`UPDATE ${item.table_name} SET synced = 1 WHERE id = ?`).run(item.record_id)
      anySuccess = true
    } catch (err) {
      slog(`[SYNC] Push error ${item.table_name}/${item.record_id}: ${String(err)}`)
      anyFailure = true
    }
  }

  // Return true only if we had no failures (or everything was already empty/cleaned)
  return anySuccess && !anyFailure
}

async function pullRemoteChanges(url: string, key: string, initialToken: string, db: ReturnType<typeof getDb>): Promise<Set<string>> {
  // Order matters: parent tables before child tables (foreign key constraints)
  const tables = ['settings', 'customers', 'calls', 'categories', 'offers', 'offer_items', 'jobs', 'invoices', 'invoice_items', 'inventory']
  let accessToken = initialToken
  const getHeaders = () => ({ apikey: key, Authorization: `Bearer ${accessToken}` })

  // Records where remote data was newer and won — caller uses this to clean up sync_queue
  const remoteWon = new Set<string>()

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
      let res = await fetch(`${url}/rest/v1/${table}?${filter}`, { headers: getHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })

      // On 401, refresh token and retry once
      if (res.status === 401) {
        slog('[SYNC] Pull got 401 — refreshing token and retrying')
        const newToken = await refreshAccessToken()
        if (newToken) {
          accessToken = newToken
          res = await fetch(`${url}/rest/v1/${table}?${filter}`, { headers: getHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        }
      }

      // On 400 with an incremental filter, the table likely lacks updated_at — retry as full pull
      if (res.status === 400 && lastPull) {
        slog(`[SYNC] Pull ${table} got 400 on incremental filter — retrying as full pull`)
        res = await fetch(`${url}/rest/v1/${table}?select=*`, { headers: getHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        slog(`[SYNC] Pull failed ${table}: ${res.status} ${body.slice(0, 200)}`)
        anyFailed = true
        continue
      }
      const rows = (await res.json()) as Record<string, unknown>[]
      if (rows.length === 0) { slog(`[SYNC] Pull ${table}: 0 rows`); continue }

      const SAFE_COL = /^[a-z_][a-z0-9_]*$/i
      const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      const localCols = new Set(tableInfo.map(r => r.name))

      // Records with a pending local delete — never re-insert them from remote
      const pendingDeletes = new Set(
        (db.prepare("SELECT record_id FROM sync_queue WHERE table_name = ? AND operation = 'delete'").all(table) as Array<{ record_id: string }>)
          .map(r => r.record_id)
      )

      for (const row of rows) {
        const rowId = row['id'] ? String(row['id']) : null

        // Never re-insert a record the user has deleted locally
        if (rowId && pendingDeletes.has(rowId)) continue

        // For non-settings tables: timestamp-based conflict resolution.
        // Remote wins only when its updated_at is strictly newer than local.
        if (table !== 'settings' && rowId && row['updated_at']) {
          const localRow = db.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).get(rowId) as { updated_at: string } | undefined
          if (localRow?.updated_at && localRow.updated_at >= (row['updated_at'] as string)) {
            // Local is same or newer — keep local, discard remote
            continue
          }
          // Remote is newer — it will overwrite. Record this for sync_queue cleanup.
          if (localRow) remoteWon.add(`${table}:${rowId}`)
        }

        // sync_enabled is device-local — never let a remote value overwrite it
        const cols = Object.keys(row).filter(c => SAFE_COL.test(c) && c !== 'owner_id' && localCols.has(c) && !(table === 'settings' && c === 'sync_enabled'))
        if (cols.length === 0) continue
        const placeholders = cols.map(() => '?').join(', ')
        // For settings (single-row config), use COALESCE so a null from remote never
        // overwrites a non-null local value — prevents sync from wiping credentials.
        const updates = table === 'settings'
          ? cols.map(c => `${c} = COALESCE(excluded.${c}, ${c})`).join(', ')
          : cols.map(c => `${c} = excluded.${c}`).join(', ')
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

  // Apply remote deletions — only on incremental pulls (not first-ever sync)
  // On first sync lastPull is null; Supabase data is already the authoritative current state.
  if (lastPull) {
    try {
      const tombRes = await fetch(
        `${url}/rest/v1/deleted_records?deleted_at=gte.${lastPull}&select=table_name,record_id`,
        { headers: getHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
      )
      if (tombRes.ok) {
        const tombstones = (await tombRes.json()) as Array<{ table_name: string; record_id: string }>
        for (const tomb of tombstones) {
          if (!ALLOWED_SYNC_TABLES.has(tomb.table_name)) continue
          try {
            db.prepare(`DELETE FROM ${tomb.table_name} WHERE id = ?`).run(tomb.record_id)
            db.prepare('DELETE FROM sync_queue WHERE table_name = ? AND record_id = ?').run(tomb.table_name, tomb.record_id)
            remoteWon.delete(`${tomb.table_name}:${tomb.record_id}`)
            slog(`[SYNC] Applied remote delete: ${tomb.table_name}/${tomb.record_id}`)
          } catch (e) {
            slog(`[SYNC] Failed to apply remote delete: ${String(e).slice(0, 100)}`)
          }
        }
      }
    } catch (e) {
      slog('[SYNC] Tombstone fetch error: ' + String(e))
    }
  }

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

  return remoteWon
}
