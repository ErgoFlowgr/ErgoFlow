/**
 * Offline license verification — 30-day Spotify-style model.
 *
 * On every app start:
 *  - If last verified < 30 days ago → use cached result (works offline)
 *  - If >= 30 days or never verified → must connect to Supabase to re-verify
 *    - Success → cache result, allow access
 *    - Failure (offline) → block with 'verification_required'
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
  if (isElectron) {
    try {
      return await ipc.subscriptionCheck() as RawSubData
    } catch {
      return null
    }
  }

  // Android: call Supabase REST directly
  try {
    const config = await getSupabaseConfig()
    const token  = await platform.getToken()
    if (!config || !token) return null

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
      { headers, signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null

    type SubRow = { status: string; trial_end: string; tier: string; vapi_minutes_used: number; vapi_phone_number: string | null }
    const rows = await res.json() as SubRow[]
    const sub = rows[0]
    if (!sub) return null

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

  const verifiedAt  = s?.license_verified_at ? new Date(s.license_verified_at).getTime() : null
  const needsVerify = !verifiedAt || (Date.now() - verifiedAt) >= THIRTY_DAYS_MS

  if (!needsVerify && s?.license_status) {
    // Cache hit — compute daysLeft from cached trial_end
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

  // Needs online verification
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

  // Offline and verification overdue — block access
  return {
    status:          'verification_required',
    daysLeft:        0,
    trialEnd:        s?.license_trial_end ?? '',
    tier:            s?.license_tier ?? 'basic',
    vapiMinutesUsed: 0,
    vapiPhoneNumber: null,
  }
}
