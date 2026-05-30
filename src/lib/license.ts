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
import { getSupabaseConfig } from './electron'
import { platform } from './platform'

export interface LicenseStatus {
  status: 'active' | 'expired' | 'cancelled' | 'verification_required'
  tier: string
  vapiMinutesUsed: number
  vapiPhoneNumber: string | null
  aiTrialActive: boolean
  aiTrialUsed: boolean
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const SEVEN_DAYS_MS  = 7  * 24 * 60 * 60 * 1000
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000

// Tiers that should NOT be trusted from stale cache for long.
// A paying tier shown to a user who lost access on the server is a worse
// outcome than briefly downgrading a real paying user who is offline.
const PAID_TIERS = new Set(['pro', 'plus', 'business', 'enterprise'])

// Last verifyOnline() failure reason — surfaced for debugging.
// Read from DevTools: (await import('./src/lib/license')).getLastVerifyError()
let lastVerifyError: string | null = null
export function getLastVerifyError(): string | null { return lastVerifyError }

function logLicense(msg: string): void {
  // eslint-disable-next-line no-console
  console.warn('[LICENSE]', msg)
}

interface RawSubData {
  status: string
  tier: string
  vapiMinutesUsed: number
  vapiPhoneNumber: string | null
  aiTrialStart: string | null
  aiTrialActive: boolean
  aiTrialUsed: boolean
}

async function verifyOnline(): Promise<RawSubData | null> {
  try {
    const config = await getSupabaseConfig()
    if (!config) { lastVerifyError = 'no_supabase_config'; logLicense('verify skipped: no config'); return null }

    let token = await platform.getToken()
    if (!token) { lastVerifyError = 'no_token'; logLicense('verify skipped: no token'); return null }

    // If token is expired (or expiring within 60s), refresh it
    try {
      const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number }
      if ((payload.exp ?? 0) * 1000 < Date.now() + 60_000) {
        const refreshToken = await platform.getKeychainValue('supabase_refresh_token')
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
              await platform.setToken(token)
              if (d.refresh_token) await platform.setKeychainValue('supabase_refresh_token', d.refresh_token)
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
    if (!res.ok) {
      lastVerifyError = `subscriptions_http_${res.status}`
      logLicense(`verify failed: HTTP ${res.status} on /subscriptions`)
      return null
    }

    type SubRow = { status: string; trial_end: string; tier: string; vapi_minutes_used: number; vapi_phone_number: string | null; ai_trial_start: string | null; ai_trial_used: boolean }
    const rows = await res.json() as SubRow[]
    let sub = rows[0] ?? null

    if (!sub) {
      // No row yet — first install. Create a free account row.
      const createRes = await fetch(`${config.url}/rest/v1/subscriptions`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ user_id: userId, status: 'active', tier: 'free' }),
        signal: AbortSignal.timeout(8000),
      })
      if (!createRes.ok) return null
      const created = await createRes.json() as SubRow[]
      sub = created[0] ?? null
      if (!sub) return null
    }

    const aiTrialUsed = sub.ai_trial_used === true
    const aiTrialStart = sub.ai_trial_start ?? null
    const aiTrialActive =
      aiTrialUsed &&
      aiTrialStart !== null &&
      Date.now() - new Date(aiTrialStart).getTime() < FOURTEEN_DAYS_MS

    lastVerifyError = null
    return {
      status:          sub.status,
      tier:            sub.tier ?? 'free',
      vapiMinutesUsed: sub.vapi_minutes_used ?? 0,
      vapiPhoneNumber: sub.vapi_phone_number ?? null,
      aiTrialStart,
      aiTrialUsed,
      aiTrialActive,
    }
  } catch (e) {
    lastVerifyError = e instanceof Error ? `${e.name}:${e.message}` : String(e)
    logLicense(`verify threw: ${lastVerifyError}`)
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
      ai_trial_start:      fresh.aiTrialStart ?? null,
      ai_trial_used:       fresh.aiTrialUsed ? true : false,
    } as Parameters<typeof saveSettings>[0])
    return {
      status:          fresh.status as LicenseStatus['status'],
      tier:            fresh.tier,
      vapiMinutesUsed: fresh.vapiMinutesUsed,
      vapiPhoneNumber: fresh.vapiPhoneNumber,
      aiTrialActive:   fresh.aiTrialActive,
      aiTrialUsed:     fresh.aiTrialUsed,
    }
  }

  // Online failed — fall back to cache
  if (verifiedAt !== null && s?.license_status) {
    const cacheAge = Date.now() - verifiedAt
    // Recompute aiTrialActive from cached values
    const cachedTrialStart = s.ai_trial_start ?? null
    const cachedTrialUsed  = !!s.ai_trial_used
    const cachedTrialActive =
      cachedTrialUsed &&
      cachedTrialStart !== null &&
      Date.now() - new Date(cachedTrialStart).getTime() < FOURTEEN_DAYS_MS

    if (cacheAge < THIRTY_DAYS_MS) {
      const cachedTier = (s.license_tier ?? 'free') as string
      const isPaid = PAID_TIERS.has(cachedTier)

      // Tighter trust window for paid tiers: avoid serving "Plus/Pro" from
      // weeks-old cache when the server-side row may have been downgraded.
      if (isPaid && cacheAge >= SEVEN_DAYS_MS) {
        logLicense(`paid cache stale (${Math.round(cacheAge / 86400000)}d) — degrading to free until re-verified`)
        return {
          status:          'verification_required',
          tier:            'free',
          vapiMinutesUsed: 0,
          vapiPhoneNumber: null,
          aiTrialActive:   false,
          aiTrialUsed:     cachedTrialUsed,
        }
      }

      // Within grace period — allow access with cached data
      return {
        status:          s.license_status as LicenseStatus['status'],
        tier:            cachedTier,
        vapiMinutesUsed: 0,
        vapiPhoneNumber: null,
        aiTrialActive:   cachedTrialActive,
        aiTrialUsed:     cachedTrialUsed,
      }
    }
    // Grace period expired — require reconnection
    return {
      status:          'verification_required',
      tier:            s.license_tier ?? 'free',
      vapiMinutesUsed: 0,
      vapiPhoneNumber: null,
      aiTrialActive:   false,
      aiTrialUsed:     cachedTrialUsed,
    }
  }

  // First install — never verified, online failed — give free access
  return {
    status:          'active',
    tier:            'free',
    vapiMinutesUsed: 0,
    vapiPhoneNumber: null,
    aiTrialActive:   false,
    aiTrialUsed:     false,
  }
}

/**
 * Force a fresh online verification, ignoring local cache.
 * Use this from Settings ("Re-check license") or DevTools to recover from
 * a stale cache showing the wrong tier:
 *   import('./src/lib/license').then(m => m.forceVerifyLicense()).then(console.log)
 */
export async function forceVerifyLicense(): Promise<LicenseStatus & { verified: boolean; error: string | null }> {
  const fresh = await verifyOnline()
  if (fresh) {
    await saveSettings({
      license_verified_at: new Date().toISOString(),
      license_tier:        fresh.tier,
      license_status:      fresh.status,
      ai_trial_start:      fresh.aiTrialStart ?? null,
      ai_trial_used:       fresh.aiTrialUsed ? true : false,
    } as Parameters<typeof saveSettings>[0])
    return {
      status:          fresh.status as LicenseStatus['status'],
      tier:            fresh.tier,
      vapiMinutesUsed: fresh.vapiMinutesUsed,
      vapiPhoneNumber: fresh.vapiPhoneNumber,
      aiTrialActive:   fresh.aiTrialActive,
      aiTrialUsed:     fresh.aiTrialUsed,
      verified:        true,
      error:           null,
    }
  }
  return {
    status:          'verification_required',
    tier:            'free',
    vapiMinutesUsed: 0,
    vapiPhoneNumber: null,
    aiTrialActive:   false,
    aiTrialUsed:     false,
    verified:        false,
    error:           lastVerifyError,
  }
}

export async function activateAITrial(): Promise<{ ok: boolean; error?: string }> {
  try {
    const config = await getSupabaseConfig()
    if (!config) return { ok: false, error: 'No Supabase config' }

    const token = await platform.getToken()
    if (!token) return { ok: false, error: 'Not authenticated' }

    let userId: string | null = null
    try {
      const payload = JSON.parse(atob(token.split('.')[1])) as { sub?: string }
      userId = payload.sub ?? null
    } catch { return { ok: false, error: 'Invalid token' } }
    if (!userId) return { ok: false, error: 'Invalid token' }

    const headers = {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }

    const res = await fetch(
      `${config.url}/rest/v1/subscriptions?user_id=eq.${userId}&ai_trial_used=eq.false`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ ai_trial_start: new Date().toISOString(), ai_trial_used: true }),
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Supabase error: ${res.status} ${text}` }
    }

    // Update local SQLite cache
    const now = new Date().toISOString()
    await saveSettings({
      ai_trial_start: now,
      ai_trial_used:  true,
    } as Parameters<typeof saveSettings>[0])

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
