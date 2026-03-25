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

const SYNC_INTERVAL_MS = 60_000 // every 60 seconds

export function setupSyncWorker(win: BrowserWindow | null) {
  sync(win) // run immediately on startup
  backfillVapiCalls(win) // pull VAPI call history on startup
  setInterval(() => sync(win), SYNC_INTERVAL_MS)
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

async function sync(win: BrowserWindow | null) {
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

    // 2. Pull remote changes (e.g. calls from VAPI webhook)
    await pullRemoteChanges(supabaseUrl, supabaseKey, accessToken, db)

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

async function pullRemoteChanges(url: string, key: string, accessToken: string, db: ReturnType<typeof getDb>) {
  const tables = ['customers', 'calls', 'categories']
  const headers = {
    apikey: key,
    Authorization: `Bearer ${accessToken}`,
  }

  for (const table of tables) {
    try {
      // Pull only records updated in last 2 minutes to avoid full scans
      const since = new Date(Date.now() - 2 * 60_000).toISOString()
      const res = await fetch(
        `${url}/rest/v1/${table}?updated_at=gte.${since}&select=*`,
        { headers }
      )
      if (!res.ok) continue
      const rows = (await res.json()) as Record<string, unknown>[]

      const SAFE_COL = /^[a-z_][a-z0-9_]*$/i
      for (const row of rows) {
        const cols = Object.keys(row).filter(c => SAFE_COL.test(c))
        if (cols.length === 0) continue
        const placeholders = cols.map(() => '?').join(', ')
        const updates = cols.map(c => `${c} = excluded.${c}`).join(', ')
        db.prepare(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
           ON CONFLICT(id) DO UPDATE SET ${updates}, synced = 1`
        ).run(...cols.map(c => row[c]))
      }
    } catch (err) {
      console.error(`Failed to pull ${table}:`, err)
    }
  }
}
