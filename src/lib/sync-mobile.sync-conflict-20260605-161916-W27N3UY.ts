/**
 * Supabase sync for Android (Capacitor).
 * Mirrors the logic from electron/sync.ts:
 *   1. Pull first — remote wins only if updated_at is newer than local
 *   2. Clean sync_queue entries where remote won
 *   3. Push local changes that are genuinely newer
 *   4. Apply remote deletions via tombstones (deleted_records table)
 */

import { db } from './db-driver'
import { platform } from './platform'
import { getSupabaseConfig } from './electron'

const SYNC_TABLES = [
  'settings', 'customers', 'calls', 'categories',
  'offers', 'offer_items', 'jobs', 'invoices', 'invoice_items', 'inventory',
]

const ALLOWED_SYNC_TABLES = new Set(SYNC_TABLES)

let syncInProgress = false

const SETTINGS_PUSH_EXCLUDE_COLUMNS = new Set([
  'sync_enabled',
  'minimize_to_tray',
  'company_logo',
  'bratnet_api_key',
  'ai_trial_start',
  'ai_trial_used',
])

async function ensureFreshToken(): Promise<string | null> {
  const token = await platform.getToken()
  if (!token) return null

  // If JWT expires in more than 5 minutes, use it as-is
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number }
    if ((payload.exp ?? 0) * 1000 > Date.now() + 5 * 60 * 1000) return token
  } catch { return token }

  // Token expired or expiring soon — try refresh
  const config = await getSupabaseConfig()
  if (!config) return null
  const refreshToken = await platform.getKeychainValue('supabase_refresh_token')
  if (!refreshToken) return null

  try {
    const res = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.anonKey },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) { console.error('[sync-mobile] token refresh failed:', res.status); return null }
    const data = await res.json() as { access_token?: string; refresh_token?: string }
    if (data.access_token) {
      await platform.setToken(data.access_token)
      if (data.refresh_token) await platform.setKeychainValue('supabase_refresh_token', data.refresh_token)
      console.log('[sync-mobile] token refreshed')
      return data.access_token
    }
  } catch (e) {
    console.error('[sync-mobile] token refresh error:', e)
  }
  return null
}

export async function syncNow(force = false): Promise<boolean> {
  if (syncInProgress) return false
  try {
    const row = await db.get(`SELECT sync_enabled FROM settings WHERE id = ?`, ['main']) as { sync_enabled?: number } | undefined
    if (!row?.sync_enabled) return false
  } catch { return false }
  syncInProgress = true
  try {
    const token = await ensureFreshToken()
    if (!token) { console.warn('[sync-mobile] no valid token, skipping sync'); return false }
    if (force) {
      try { await db.run(`DELETE FROM sync_meta WHERE key = 'last_pull_at'`, []) } catch { /* ignore */ }
    }

    // 1. Pull first — remote wins only if newer
    let remoteWon = new Set<string>()
    try {
      remoteWon = await pull(token)
    } catch (e) {
      // Retry once — Android WebView first-request can fail on startup
      console.warn('[sync-mobile] pull failed, retrying in 1.5s:', e)
      await new Promise(r => setTimeout(r, 1500))
      try { remoteWon = await pull(token) } catch (e2) { console.error('[sync-mobile] pull retry failed:', e2) }
    }

    // 2. Drop sync_queue upsert entries for records remote just won
    for (const entry of remoteWon) {
      const sep = entry.indexOf(':')
      const tbl = entry.slice(0, sep)
      const id  = entry.slice(sep + 1)
      try {
        await db.run(
          `DELETE FROM sync_queue WHERE table_name = ? AND record_id = ? AND operation != 'delete'`,
          [tbl, id]
        )
      } catch { /* ignore */ }
    }

    // 3. Push local changes that are genuinely newer, then propagate deletes
    try { await push(token) } catch (e) { console.error('[sync-mobile] push error:', e) }

    window.dispatchEvent(new CustomEvent('sync:complete'))
    return true
  } catch (e) {
    console.error('[sync-mobile] error:', e)
    return false
  } finally {
    syncInProgress = false
  }
}

async function pull(token: string): Promise<Set<string>> {
  const remoteWon = new Set<string>()
  const config = await getSupabaseConfig()
  if (!config) return remoteWon

  const headers = {
    apikey: config.anonKey,
    Authorization: `Bearer ${token}`,
  }

  let lastPull: string | null = null
  try {
    const meta = await db.get(`SELECT value FROM sync_meta WHERE key = 'last_pull_at'`) as { value: string } | undefined
    lastPull = meta?.value ?? null
  } catch { /* sync_meta may not exist */ }

  const SAFE_COL = /^[a-z_][a-z0-9_]*$/i
  let anyFailed = false

  for (const table of SYNC_TABLES) {
    try {
      const filter = lastPull ? `updated_at=gte.${lastPull}&select=*` : `select=*`
      let res = await fetch(`${config.url}/rest/v1/${table}?${filter}`, { headers })

      if (!res.ok) {
        if (res.status === 400 && lastPull) {
          res = await fetch(`${config.url}/rest/v1/${table}?select=*`, { headers })
          if (!res.ok) { anyFailed = true; continue }
        } else {
          anyFailed = true
          continue
        }
      }

      const rows = await res.json() as Record<string, unknown>[]
      const won = await upsertRows(table, rows, SAFE_COL)
      for (const id of won) remoteWon.add(`${table}:${id}`)
    } catch (e) {
      console.error(`[sync-mobile] pull ${table}:`, e)
      anyFailed = true
    }
  }

  // Apply remote deletions — only on incremental pulls (not first-ever sync)
  if (lastPull) {
    try {
      const tombRes = await fetch(
        `${config.url}/rest/v1/deleted_records?deleted_at=gte.${lastPull}&select=table_name,record_id`,
        { headers }
      )
      if (tombRes.ok) {
        const tombstones = await tombRes.json() as Array<{ table_name: string; record_id: string }>
        for (const tomb of tombstones) {
          if (!ALLOWED_SYNC_TABLES.has(tomb.table_name)) continue
          try {
            await db.run(`DELETE FROM ${tomb.table_name} WHERE id = ?`, [tomb.record_id])
            await db.run(`DELETE FROM sync_queue WHERE table_name = ? AND record_id = ?`, [tomb.table_name, tomb.record_id])
            remoteWon.delete(`${tomb.table_name}:${tomb.record_id}`)
            console.log(`[sync-mobile] applied remote delete: ${tomb.table_name}/${tomb.record_id}`)
          } catch (e) {
            console.error(`[sync-mobile] failed to apply remote delete:`, e)
          }
        }
      }
    } catch (e) {
      console.error('[sync-mobile] tombstone fetch error:', e)
    }
  }

  if (!anyFailed) {
    try {
      await db.run(
        `INSERT INTO sync_meta (key, value) VALUES ('last_pull_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [new Date().toISOString()]
      )
    } catch { /* ignore */ }
  } else {
    try { await db.run(`DELETE FROM sync_meta WHERE key = 'last_pull_at'`) } catch { /* ignore */ }
  }

  return remoteWon
}

// Returns set of record IDs (not table:id) where remote was newer and won.
async function upsertRows(table: string, rows: Record<string, unknown>[], SAFE_COL: RegExp): Promise<Set<string>> {
  const remoteWon = new Set<string>()
  if (!rows.length) return remoteWon

  const tableInfo = await db.query(`PRAGMA table_info(${table})`) as Array<{ name: string }>
  const localCols = new Set(tableInfo.map(r => r.name))

  // Records with pending local deletes — never re-insert them from remote
  const pendingDeleteRows = await db.query(
    `SELECT record_id FROM sync_queue WHERE table_name = ? AND operation = 'delete'`, [table]
  ) as Array<{ record_id: string }>
  const pendingDeletes = new Set(pendingDeleteRows.map(r => r.record_id))

  for (const row of rows) {
    const rowId = row['id'] ? String(row['id']) : null

    // Never re-insert a record the user has deleted locally
    if (rowId && pendingDeletes.has(rowId)) continue

    // Timestamp-based conflict resolution for non-settings tables
    if (table !== 'settings' && rowId && row['updated_at']) {
      const localRow = await db.get(
        `SELECT updated_at FROM ${table} WHERE id = ?`, [rowId]
      ) as { updated_at: string } | undefined
      if (localRow?.updated_at && localRow.updated_at >= (row['updated_at'] as string)) {
        continue // Local is same or newer — keep local, discard remote
      }
      if (localRow) remoteWon.add(rowId)
    }

    // sync_enabled is device-local — never let remote overwrite it
    const cols = Object.keys(row).filter(c =>
      SAFE_COL.test(c) && c !== 'owner_id' && localCols.has(c) && !(table === 'settings' && c === 'sync_enabled')
    )
    if (!cols.length) continue

    const placeholders = cols.map(() => '?').join(', ')
    const updates = table === 'settings'
      ? cols.map(c => `${c} = COALESCE(excluded.${c}, ${c})`).join(', ')
      : cols.map(c => `${c} = excluded.${c}`).join(', ')
    const vals = cols.map(c => {
      const v = row[c]
      return typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? null)
    })

    try {
      await db.run(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
        vals
      )
    } catch (e) {
      console.error(`[sync-mobile] upsert ${table}:`, e)
    }
  }

  return remoteWon
}

async function push(token: string): Promise<void> {
  const queue = await db.query(
    `SELECT * FROM sync_queue ORDER BY id ASC LIMIT 50`
  ) as Array<{ id: number; table_name: string; record_id: string; operation: string }>

  if (!queue.length) return

  const config = await getSupabaseConfig()
  if (!config) return

  function getOwnerIdFromToken(t: string): string | null {
    try { return (JSON.parse(atob(t.split('.')[1])) as { sub?: string }).sub ?? null } catch { return null }
  }
  const ownerId = getOwnerIdFromToken(token)
  if (!ownerId) return

  const headers = {
    'Content-Type': 'application/json',
    apikey: config.anonKey,
    Authorization: `Bearer ${token}`,
    Prefer: 'resolution=merge-duplicates',
  }

  for (const item of queue) {
    try {
      const endpoint = `${config.url}/rest/v1/${item.table_name}`
      let res: Response

      if (item.operation === 'delete') {
        res = await fetch(`${endpoint}?id=eq.${item.record_id}`, { method: 'DELETE', headers })
      } else {
        const record = await db.get(`SELECT * FROM ${item.table_name} WHERE id = ?`, [item.record_id]) as Record<string, unknown> | undefined
        if (!record) { await db.run(`DELETE FROM sync_queue WHERE id = ?`, [item.id]); continue }
        const { synced: _s, ...clean } = record

        let bodyObj: Record<string, unknown>
        if (item.table_name === 'settings') {
          // sync_enabled and other runtime/secret fields are device-local — never push them.
          // Exclude null fields so this device can't overwrite another device's data with nulls.
          bodyObj = Object.fromEntries(
            Object.entries(clean as Record<string, unknown>).filter(([k, v]) =>
              !SETTINGS_PUSH_EXCLUDE_COLUMNS.has(k) && v !== null && v !== undefined
            )
          )
          bodyObj['owner_id'] = ownerId
        } else {
          bodyObj = { ...clean, owner_id: ownerId }
        }

        res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(bodyObj) })
      }

      if (res.ok) {
        // For deletes: insert a tombstone so other devices sync the deletion
        if (item.operation === 'delete') {
          try {
            await fetch(`${config.url}/rest/v1/deleted_records`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                owner_id: ownerId,
                table_name: item.table_name,
                record_id: item.record_id,
                deleted_at: new Date().toISOString(),
              }),
            })
          } catch { /* tombstone failure is non-fatal */ }
        }
        await db.run(`DELETE FROM sync_queue WHERE id = ?`, [item.id])
        await db.run(`UPDATE ${item.table_name} SET synced = 1 WHERE id = ?`, [item.record_id])
      }
    } catch (e) {
      console.error(`[sync-mobile] push ${item.table_name}/${item.record_id}:`, e)
    }
  }
}

export async function syncOnFocus(): Promise<void> {
  await syncNow()
}
