/**
 * Supabase pull sync for Android (Capacitor).
 * Mirrors the pull logic from electron/sync.ts but uses fetch() + Capacitor SQLite.
 */

import { db } from './db-driver'
import { platform } from './platform'
import { getSupabaseConfig } from './electron'

const PULL_TABLES = [
  'settings', 'customers', 'calls', 'categories',
  'offers', 'offer_items', 'jobs', 'invoices', 'invoice_items', 'inventory',
]

let syncInProgress = false

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
  // Respect sync_enabled setting — sync is opt-in
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
    try {
      await pull(token)
    } catch (e) {
      // Retry once — Android WebView first-request can fail on startup
      console.warn('[sync-mobile] pull failed, retrying in 1.5s:', e)
      await new Promise(r => setTimeout(r, 1500))
      try { await pull(token) } catch (e2) { console.error('[sync-mobile] pull retry failed:', e2) }
    }
    window.dispatchEvent(new CustomEvent('sync:complete'))
    try { await push(token) } catch (e) { console.error('[sync-mobile] push error:', e) }
    return true
  } catch (e) {
    console.error('[sync-mobile] error:', e)
    return false
  } finally {
    syncInProgress = false
  }
}

async function pull(token: string): Promise<void> {
  const config = await getSupabaseConfig()
  if (!config) return

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

  for (const table of PULL_TABLES) {
    try {
      const filter = lastPull ? `updated_at=gte.${lastPull}&select=*` : `select=*`
      const res = await fetch(`${config.url}/rest/v1/${table}?${filter}`, { headers })

      if (!res.ok) {
        // If incremental filter failed, retry as full pull
        if (res.status === 400 && lastPull) {
          const res2 = await fetch(`${config.url}/rest/v1/${table}?select=*`, { headers })
          if (!res2.ok) { anyFailed = true; continue }
          await upsertRows(table, await res2.json() as Record<string, unknown>[], SAFE_COL)
        } else {
          anyFailed = true
          continue
        }
      } else {
        await upsertRows(table, await res.json() as Record<string, unknown>[], SAFE_COL)
      }
    } catch (e) {
      console.error(`[sync-mobile] pull ${table}:`, e)
      anyFailed = true
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
}

async function upsertRows(table: string, rows: Record<string, unknown>[], SAFE_COL: RegExp): Promise<void> {
  if (!rows.length) return

  // Get columns that exist in the local table
  const tableInfo = await db.query(`PRAGMA table_info(${table})`) as Array<{ name: string }>
  const localCols = new Set(tableInfo.map(r => r.name))

  // Protect records with pending local changes — don't overwrite them with remote data
  const pendingRows = await db.query(
    `SELECT record_id FROM sync_queue WHERE table_name = ?`, [table]
  ) as Array<{ record_id: string }>
  const pendingIds = new Set(pendingRows.map(r => r.record_id))

  for (const row of rows) {
    if (row['id'] && pendingIds.has(String(row['id']))) continue

    const cols = Object.keys(row).filter(c => SAFE_COL.test(c) && c !== 'owner_id' && localCols.has(c))
    if (!cols.length) continue

    const placeholders = cols.map(() => '?').join(', ')
    const updates = cols.map(c => `${c} = excluded.${c}`).join(', ')
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
        res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ ...clean, owner_id: ownerId }) })
      }

      if (res.ok) {
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
