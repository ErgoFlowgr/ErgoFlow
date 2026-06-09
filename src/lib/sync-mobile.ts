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

const PARENT_FK_BY_TABLE: Record<string, Array<{ column: string; parentTable: string }>> = {
  calls: [{ column: 'customer_id', parentTable: 'customers' }],
  jobs: [{ column: 'customer_id', parentTable: 'customers' }],
  invoices: [{ column: 'customer_id', parentTable: 'customers' }],
  offers: [{ column: 'customer_id', parentTable: 'customers' }],
  invoice_items: [{ column: 'invoice_id', parentTable: 'invoices' }],
  offer_items: [{ column: 'offer_id', parentTable: 'offers' }],
}

let syncInProgress = false

function emitSyncError(reason: string): void {
  window.dispatchEvent(new CustomEvent('sync:error', { detail: { reason } }))
}

function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string' && e) return e
  return 'unknown error'
}

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
  if (syncInProgress) { emitSyncError('sync already running'); return false }
  try {
    const row = await db.get(`SELECT sync_enabled FROM settings WHERE id = ?`, ['main']) as { sync_enabled?: number } | undefined
    if (!row?.sync_enabled) { emitSyncError('sync disabled'); return false }
  } catch { emitSyncError('settings unavailable'); return false }
  syncInProgress = true
  try {
    const token = await ensureFreshToken()
    if (!token) { console.warn('[sync-mobile] no valid token, skipping sync'); emitSyncError('no valid token'); return false }
    if (force) {
      try { await db.run(`DELETE FROM sync_meta WHERE key = 'last_pull_at'`, []) } catch { /* ignore */ }
    }

    // 1. Pull first — remote wins only if newer
    let remoteWon = new Set<string>()
    let syncFailed = false
    let syncErrorReason = ''
    try {
      const pulled = await pull(token)
      remoteWon = pulled.remoteWon
      syncFailed = syncFailed || !pulled.ok
      if (!pulled.ok) syncErrorReason = pulled.reason || syncErrorReason
    } catch (e) {
      // Retry once — Android WebView first-request can fail on startup
      console.warn('[sync-mobile] pull failed, retrying in 1.5s:', e)
      await new Promise(r => setTimeout(r, 1500))
      try {
        const pulled = await pull(token)
        remoteWon = pulled.remoteWon
        syncFailed = syncFailed || !pulled.ok
        if (!pulled.ok) syncErrorReason = pulled.reason || syncErrorReason
      } catch (e2) {
        console.error('[sync-mobile] pull retry failed:', e2)
        syncFailed = true
        syncErrorReason = `pull failed: ${errorText(e2)}`
      }
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
    try {
      const pushed = await push(token)
      syncFailed = syncFailed || !pushed.ok
      if (!pushed.ok) syncErrorReason = pushed.reason || syncErrorReason
    } catch (e) {
      console.error('[sync-mobile] push error:', e)
      syncFailed = true
      syncErrorReason = `push failed: ${errorText(e)}`
    }

    if (syncFailed) {
      emitSyncError(syncErrorReason || 'sync completed with errors')
      return false
    }

    window.dispatchEvent(new CustomEvent('sync:complete'))
    return true
  } catch (e) {
    console.error('[sync-mobile] error:', e)
    emitSyncError(e instanceof Error ? e.message : 'sync failed')
    return false
  } finally {
    syncInProgress = false
  }
}

async function pull(token: string): Promise<{ remoteWon: Set<string>; ok: boolean; reason?: string }> {
  const remoteWon = new Set<string>()
  const config = await getSupabaseConfig()
  if (!config) return { remoteWon, ok: false, reason: 'missing Supabase config' }

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
  let firstFailure = ''

  const fetchParent = async (parentTable: string, parentId: string): Promise<Record<string, unknown> | null> => {
    if (!ALLOWED_SYNC_TABLES.has(parentTable)) return null
    const res = await fetch(`${config.url}/rest/v1/${parentTable}?id=eq.${encodeURIComponent(parentId)}&select=*`, { headers })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn(`[sync-mobile] parent fetch ${parentTable}/${parentId} failed: HTTP ${res.status}${body ? ` ${body.slice(0, 160)}` : ''}`)
      return null
    }
    const rows = await res.json() as Record<string, unknown>[]
    return rows[0] ?? null
  }

  for (const table of SYNC_TABLES) {
    try {
      const filter = lastPull ? `updated_at=gte.${lastPull}&select=*` : `select=*`
      let res = await fetch(`${config.url}/rest/v1/${table}?${filter}`, { headers })

      if (!res.ok) {
        if (res.status === 400 && lastPull) {
          res = await fetch(`${config.url}/rest/v1/${table}?select=*`, { headers })
          if (!res.ok) {
            const body = await res.text().catch(() => '')
            anyFailed = true
            if (!firstFailure) firstFailure = `pull ${table} failed: HTTP ${res.status}${body ? ` ${body.slice(0, 160)}` : ''}`
            continue
          }
        } else {
          const body = await res.text().catch(() => '')
          anyFailed = true
          if (!firstFailure) firstFailure = `pull ${table} failed: HTTP ${res.status}${body ? ` ${body.slice(0, 160)}` : ''}`
          continue
        }
      }

      const rows = await res.json() as Record<string, unknown>[]
      const won = await upsertRows(table, rows, SAFE_COL, fetchParent)
      for (const id of won) remoteWon.add(`${table}:${id}`)
    } catch (e) {
      console.error(`[sync-mobile] pull ${table}:`, e)
      anyFailed = true
      if (!firstFailure) firstFailure = `pull ${table} failed: ${errorText(e)}`
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

  return { remoteWon, ok: !anyFailed, reason: firstFailure }
}

// Returns set of record IDs (not table:id) where remote was newer and won.
async function hasMissingParent(
  table: string,
  row: Record<string, unknown>,
  localCols: Set<string>,
  SAFE_COL: RegExp,
  fetchParent?: (parentTable: string, parentId: string) => Promise<Record<string, unknown> | null>,
): Promise<boolean> {
  const parentRefs = PARENT_FK_BY_TABLE[table]
  if (!parentRefs?.length) return false

  for (const ref of parentRefs) {
    if (!localCols.has(ref.column)) continue
    const parentId = row[ref.column]
    if (parentId === null || parentId === undefined || parentId === '') continue
    const parentIdText = String(parentId)
    let parentRow = await db.get(`SELECT id FROM ${ref.parentTable} WHERE id = ?`, [parentIdText]) as { id: string } | undefined

    if (!parentRow && fetchParent) {
      const remoteParent = await fetchParent(ref.parentTable, parentIdText)
      if (remoteParent) {
        await upsertRows(ref.parentTable, [remoteParent], SAFE_COL, fetchParent)
        parentRow = await db.get(`SELECT id FROM ${ref.parentTable} WHERE id = ?`, [parentIdText]) as { id: string } | undefined
        if (parentRow) {
          console.log(`[sync-mobile] recovered missing parent ${ref.parentTable}/${parentIdText} for ${table}/${String(row['id'] ?? 'unknown')}`)
        }
      } else if (ref.parentTable === 'customers') {
        const now = new Date().toISOString()
        const fallbackName = typeof row['customer_name'] === 'string' && row['customer_name'].trim()
          ? row['customer_name'].trim()
          : 'Recovered customer'
        await upsertRows(ref.parentTable, [{
          id: parentIdText,
          name: fallbackName,
          phone: typeof row['customer_phone'] === 'string' ? row['customer_phone'] : null,
          address: typeof row['customer_address'] === 'string' ? row['customer_address'] : null,
          notes: `Recovered locally during sync because ${table}/${String(row['id'] ?? 'unknown')} referenced this missing customer.`,
          created_at: typeof row['created_at'] === 'string' ? row['created_at'] : now,
          updated_at: typeof row['updated_at'] === 'string' ? row['updated_at'] : now,
          synced: 1,
        }], SAFE_COL, fetchParent)
        parentRow = await db.get(`SELECT id FROM ${ref.parentTable} WHERE id = ?`, [parentIdText]) as { id: string } | undefined
        if (parentRow) {
          console.warn(`[sync-mobile] created local fallback parent ${ref.parentTable}/${parentIdText} for orphaned ${table}/${String(row['id'] ?? 'unknown')}`)
        }
      }
    }

    if (!parentRow) {
      console.warn(`[sync-mobile] skip ${table}/${String(row['id'] ?? 'unknown')}: missing parent ${ref.parentTable}/${parentIdText}`)
      return true
    }
  }

  return false
}

async function upsertRows(
  table: string,
  rows: Record<string, unknown>[],
  SAFE_COL: RegExp,
  fetchParent?: (parentTable: string, parentId: string) => Promise<Record<string, unknown> | null>,
): Promise<Set<string>> {
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

    let localRow: { updated_at: string } | undefined
    // Timestamp-based conflict resolution for non-settings tables
    if (table !== 'settings' && rowId && row['updated_at'] && localCols.has('updated_at')) {
      localRow = await db.get(
        `SELECT updated_at FROM ${table} WHERE id = ?`, [rowId]
      ) as { updated_at: string } | undefined
      if (localRow?.updated_at && localRow.updated_at >= (row['updated_at'] as string)) {
        continue // Local is same or newer — keep local, discard remote
      }
    }

    if (await hasMissingParent(table, row, localCols, SAFE_COL, fetchParent)) continue

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
      if (localRow && rowId) remoteWon.add(rowId)
    } catch (e) {
      console.error(`[sync-mobile] upsert ${table}:`, e)
    }
  }

  return remoteWon
}

async function push(token: string): Promise<{ ok: boolean; reason?: string }> {
  const queue = await db.query(
    `SELECT * FROM sync_queue ORDER BY id ASC LIMIT 50`
  ) as Array<{ id: number; table_name: string; record_id: string; operation: string }>

  if (!queue.length) return { ok: true }

  const config = await getSupabaseConfig()
  if (!config) return { ok: false, reason: 'missing Supabase config' }

  function getOwnerIdFromToken(t: string): string | null {
    try { return (JSON.parse(atob(t.split('.')[1])) as { sub?: string }).sub ?? null } catch { return null }
  }
  const ownerId = getOwnerIdFromToken(token)
  if (!ownerId) return { ok: false, reason: 'token missing owner id' }

  const headers = {
    'Content-Type': 'application/json',
    apikey: config.anonKey,
    Authorization: `Bearer ${token}`,
    Prefer: 'resolution=merge-duplicates',
  }
  let firstFailure = ''

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
      } else {
        const body = await res.text().catch(() => '')
        if (!firstFailure) firstFailure = `push ${item.table_name}/${item.record_id} failed: HTTP ${res.status}${body ? ` ${body.slice(0, 160)}` : ''}`
      }
    } catch (e) {
      console.error(`[sync-mobile] push ${item.table_name}/${item.record_id}:`, e)
      if (!firstFailure) firstFailure = `push ${item.table_name}/${item.record_id} failed: ${errorText(e)}`
    }
  }

  return { ok: !firstFailure, reason: firstFailure }
}

export async function syncOnFocus(): Promise<void> {
  await syncNow()
}
