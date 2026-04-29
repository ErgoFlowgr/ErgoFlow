/**
 * Offline license verification — Spotify-style model.
 *
 * On every app start:
 *  - Always attempt online verification first (gets fresh tier/status)
 *  - If online succeeds → cache result, show fresh data
 *  - If offline/error → fall back to cache
 *    - Cache < 30 days old → allow access with cached data
 *    - Cache >= 30 days old or missing → block with 'verification_required'
 */

import { getSettings, saveSettings } from './db'
import { isElectron, ipc, getSupabaseConfig } from './electron'
import { platform } from './platform'

export interface LicenseStatus {
  status: 'trial' | 'active' | 'expired' | 'cancelled' | 'verification_required'
  daysLeft: number
  trialEnd: string
  tier: string
  vapiMinutesUsed: number
  vapiPhoneNumber: string | null
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

interface RawSubData {
  status: string
  daysLeft: number
  trialEnd: string
  tier: string
  vapiMinutesUsed: number
  vapiPhoneNumber: string | null
}

async function verifyOnline(): Promise<RawSubData | null> {
  try {
    const config = await getSupabaseConfig()
    if (!config) return null

    let token = await platform.getToken()
    if (!token) return null

    // If token is expired (or expiring within 60s), refresh it
    try {
      const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number }
      if ((payload.exp ?? 0) * 1000 < Date.now() + 60_000) {
        const refreshToken = isElectron ? await ipc.keychain.get('supabase_refresh_token') : null
        if (refreshToken) {
          const r = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: config.anonKey },
            body: JSON.stringify({ refresh_token: refreshToken }),
            signal: AbortSignal.timeout(5000),
          })
          if (r.ok) {
            const d = await r.json() as { access_token?: string; refresh_token?: string }
            if (d.access_token) {
              token = d.access_token
              await ipc.keychain.set('supabase_access_token', token)
              if (d.refresh_token) await ipc.keychain.set('supabase_refresh_token', d.refresh_token)
            }
          }
        }
      }
    } catch { /* use existing token */ }

    let userId: string | null = null
    try {
      const payload = JSON.parse(atob(token.split('.')[1])) as { sub?: string }
      userId = payload.sub ?? null
    } catch { return null }
    if (!userId) return null

    const headers = {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }

    const res = await fetch(
      `${config.url}/rest/v1/subscriptions?user_id=eq.${userId}&select=*&limit=1`,
      { headers, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return null

    type SubRow = { status: string; trial_end: string; tier: string; vapi_minutes_used: number; vapi_phone_number: string | null }
    const rows = await res.json() as SubRow[]
    let sub = rows[0] ?? null

    if (!sub) {
      // No row yet — first install. Create a trial row.
      const trialEnd = new Date(Date.now() + 30 * 86400_000).toISOString()
      const createRes = await fetch(`${config.url}/rest/v1/subscriptions`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ user_id: userId, status: 'trial', trial_end: trialEnd, tier: 'trial' }),
        signal: AbortSignal.timeout(8000),
      })
      if (!createRes.ok) return null
      const created = await createRes.json() as SubRow[]
      sub = created[0] ?? null
      if (!sub) return null
    }

    const trialEnd  = new Date(sub.trial_end)
    const now       = Date.now()
    const daysLeft  = Math.max(0, Math.ceil((trialEnd.getTime() - now) / 86400_000))
    const effectiveStatus = sub.status === 'trial' && trialEnd.getTime() < now ? 'expired' : sub.status

    return {
      status:          effectiveStatus,
      daysLeft,
      trialEnd:        sub.trial_end,
      tier:            sub.tier ?? 'basic',
      vapiMinutesUsed: sub.vapi_minutes_used ?? 0,
      vapiPhoneNumber: sub.vapi_phone_number ?? null,
    }
  } catch {
    return null
  }
}

export async function checkLicense(): Promise<LicenseStatus> {
  const s = await getSettings()
  const verifiedAt = s?.license_verified_at ? new Date(s.license_verified_at).getTime() : null

  // Always try online first — so tier changes (trial→pro) are reflected immediately
  const fresh = await verifyOnline()

  if (fresh) {
    await saveSettings({
      license_verified_at: new Date().toISOString(),
      license_tier:        fresh.tier,
      license_status:      fresh.status,
      license_trial_end:   fresh.trialEnd,
    } as Parameters<typeof saveSettings>[0])
    return { ...fresh, status: fresh.status as LicenseStatus['status'] }
  }

  // Online failed — fall back to cache
  if (verifiedAt !== null && s?.license_status) {
    const cacheAge = Date.now() - verifiedAt
    if (cacheAge < THIRTY_DAYS_MS) {
      // Within grace period — allow access with cached data
      const trialEnd = s.license_trial_end ? new Date(s.license_trial_end) : null
      const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400_000)) : 0
      return {
        status:          s.license_status as LicenseStatus['status'],
        daysLeft,
        trialEnd:        s.license_trial_end ?? '',
        tier:            s.license_tier ?? 'basic',
        vapiMinutesUsed: 0,
        vapiPhoneNumber: null,
      }
    }
    // Grace period expired — require reconnection
    return {
      status:          'verification_required',
      daysLeft:        0,
      trialEnd:        s.license_trial_end ?? '',
      tier:            s.license_tier ?? 'basic',
      vapiMinutesUsed: 0,
      vapiPhoneNumber: null,
    }
  }

  // First install — never verified, online failed — give trial access
  return {
    status:          'trial',
    daysLeft:        14,
    trialEnd:        new Date(Date.now() + 14 * 86400_000).toISOString(),
    tier:            'basic',
    vapiMinutesUsed: 0,
    vapiPhoneNumber: null,
  }
}
