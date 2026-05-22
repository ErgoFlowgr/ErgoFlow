import { useEffect, useState, createContext, useContext } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getSettings, type Settings } from './lib/db'
import { ipc, isElectron } from './lib/electron'
import { platform } from './lib/platform'
import { db } from './lib/db-driver'
import { syncNow } from './lib/sync-mobile'

function extractUserIdFromJwt(token: string): string | null {
  try { return (JSON.parse(atob(token.split('.')[1])) as { sub?: string }).sub ?? null } catch { return null }
}

const STARTUP_TIMEOUT_MS = 12_000

async function withStartupTimeout<T>(stage: string, task: () => Promise<T>, timeoutMs = STARTUP_TIMEOUT_MS): Promise<T> {
  console.info(`[App] init stage: ${stage}`)
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task(),
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Startup timed out during ${stage}`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function hasLocalProfileSettings(settings: Settings | null | undefined): boolean {
  return !!(
    settings?.company_name ||
    settings?.owner_name ||
    settings?.owner_last_name ||
    settings?.phone ||
    settings?.phone2 ||
    settings?.address ||
    settings?.work_type
  )
}

async function ensureMobileCloudSettingsHydrated(settings: Settings | null | undefined): Promise<Settings | null | undefined> {
  if (isElectron || !platform.isMobile || settings?.sync_enabled || hasLocalProfileSettings(settings)) return settings

  try {
    // Fresh Android installs start with sync_enabled=0 because that flag is device-local.
    // Enable it locally before syncNow(), otherwise syncNow exits before it can pull the
    // user's existing company/profile settings from Supabase.
    await db.run(`UPDATE settings SET sync_enabled = 1 WHERE id = 'main'`)
    await db.run(`DELETE FROM sync_queue WHERE table_name = ? AND record_id = ?`, ['settings', 'main'])
    await syncNow(true)
    return await getSettings()
  } catch (e) {
    console.warn('[App] mobile settings hydration failed:', e)
    return settings
  }
}
import Layout from './components/Layout'
import Auth from './pages/Auth/Auth'
import Onboarding from './pages/Onboarding/Onboarding'
import Calls from './pages/Calls/Calls'
import Customers from './pages/Customers/Customers'
import CustomerProfile from './pages/Customers/CustomerProfile'
import Chat from './pages/Chat/Chat'
import Settings from './pages/Settings/Settings'
import Dashboard from './pages/Dashboard/Dashboard'
import Jobs from './pages/Jobs/Jobs'
import Offers from './pages/Offers/Offers'
import Invoices from './pages/Invoices/Invoices'
import Inventory from './pages/Inventory/Inventory'
import Paywall from './pages/Paywall/Paywall'
import VerificationRequired from './pages/Paywall/VerificationRequired'
import LockedFeature from './components/LockedFeature'
import { checkLicense } from './lib/license'

interface SubscriptionInfo {
  status: string
  tier: string              // 'free' | 'basic' | 'plus' | 'pro'
  vapiMinutesUsed: number
  vapiPhoneNumber: string | null
  aiTrialActive: boolean
  aiTrialUsed: boolean
}

// Subscription context — consumed by pages that need to gate features
export interface SubscriptionCtx {
  tier: string
  status: string
  vapiMinutesUsed: number
  vapiPhoneNumber: string | null
  isPlus: boolean
  isPro: boolean
  isFree: boolean
  aiTrialActive: boolean
  aiTrialUsed: boolean
  canUseAI: boolean
  refreshSubscription: () => Promise<void>
  requestUpgrade: () => void
}

export const SubscriptionContext = createContext<SubscriptionCtx>({
  tier: 'free',
  status: 'active',
  vapiMinutesUsed: 0,
  vapiPhoneNumber: null,
  isPlus: false,
  isPro: false,
  isFree: false,
  aiTrialActive: false,
  aiTrialUsed: false,
  canUseAI: false,
  refreshSubscription: async () => {},
  requestUpgrade: () => {},
})

export default function App() {
  const { i18n } = useTranslation()
  const [ready, setReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [onboarded, setOnboarded] = useState(false)
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string>('')
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  const checkSubscription = async () => {
    const sub = await checkLicense()
    setSubscription(sub)
  }

  useEffect(() => {
    const init = async () => {
      try {
        const token = await withStartupTimeout('load saved session', () => platform.getToken())
        if (token) {
          const userId = token.includes('.') ? extractUserIdFromJwt(token) : token
          if (userId) { await withStartupTimeout('open user database', () => db.switch(userId)); setUserId(userId) }
        }
        let s = await withStartupTimeout('load settings database', () => getSettings())
        s = await withStartupTimeout('hydrate mobile cloud settings', () => ensureMobileCloudSettingsHydrated(s), 20_000) ?? s
        if (s?.language) { i18n.changeLanguage(s.language); document.documentElement.lang = s.language }
        if (token) {
          setOnboarded(true)
          setAuthenticated(true)
          await withStartupTimeout('check subscription', () => checkSubscription(), 15_000)
          if (s?.sync_enabled) {
            if (isElectron) setTimeout(() => ipc.syncNow(), 1000)
            else setTimeout(() => syncNow(), 2000)
          }
        } else {
          setOnboarded(!!s?.onboarding_complete)
        }
      } catch (e) {
        console.error('[App] init failed:', e)
        setInitError(e instanceof Error ? e.message : String(e))
      } finally {
        setReady(true)
      }
    }
    init()

    if (isElectron) {
      ipc.update.onReady(() => setUpdateReady(true))
      ipc.update.onError((msg) => setUpdateError(msg))
    }

  }, [i18n])

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400 text-sm">Φόρτωση...</span>
        </div>
      </div>
    )
  }

  if (initError) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 p-6">
        <div className="bg-red-900/40 border border-red-500 rounded-xl p-6 max-w-sm w-full">
          <p className="text-red-300 font-semibold mb-2">Σφάλμα εκκίνησης</p>
          <p className="text-red-200 text-sm break-all">{initError}</p>
          <button
            className="mt-4 w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium"
            onClick={() => { setInitError(null); window.location.reload() }}
          >
            Επανεκκίνηση
          </button>
        </div>
      </div>
    )
  }

  const handleSignOut = async () => {
    await platform.clearToken().catch(() => {})
    await platform.removeKeychainValue('supabase_refresh_token').catch(() => {})
    await platform.removeKeychainValue('saved_email').catch(() => {})
    await platform.removeKeychainValue('saved_password').catch(() => {})
    setAuthenticated(false)
    setOnboarded(false)
  }

  if (!authenticated) {
    // isNewAccount=true → show onboarding, false → skip straight to app
    return <Auth onAuth={async (isNewAccount: boolean) => {
      const token = await platform.getToken()
      if (token) {
        const uid = token.includes('.') ? extractUserIdFromJwt(token) : token
        if (uid) { await db.switch(uid); setUserId(uid) }
      }
      setAuthenticated(true)
      if (!isNewAccount) setOnboarded(true)
      await checkSubscription()
      const freshSettings = await ensureMobileCloudSettingsHydrated(await getSettings())
      if (freshSettings?.sync_enabled && !isElectron) setTimeout(() => syncNow(), 2000)
    }} />
  }

  if (!onboarded) {
    return <Onboarding onComplete={() => setOnboarded(true)} />
  }

  if (subscription?.status === 'verification_required') {
    return <VerificationRequired onRetry={async () => { await checkSubscription() }} />
  }

  if (subscription && (subscription.status === 'expired' || subscription.status === 'cancelled')) {
    return <Paywall onRefresh={async () => { await checkSubscription() }} userId={userId} />
  }

  const tier           = subscription?.tier ?? 'free'
  const aiTrialActive  = subscription?.aiTrialActive ?? false
  const subCtx: SubscriptionCtx = {
    tier,
    status:          subscription?.status ?? 'active',
    vapiMinutesUsed: subscription?.vapiMinutesUsed ?? 0,
    vapiPhoneNumber: subscription?.vapiPhoneNumber ?? null,
    isPlus:          ['plus', 'pro'].includes(tier),
    isPro:           tier === 'pro',
    isFree:          tier === 'free',
    aiTrialActive,
    aiTrialUsed:     subscription?.aiTrialUsed ?? false,
    canUseAI:        ['plus', 'pro'].includes(tier) || aiTrialActive,
    refreshSubscription: checkSubscription,
    requestUpgrade: () => setShowUpgrade(true),
  }

  return (
    <SubscriptionContext.Provider value={subCtx}>
      {updateReady && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-brand-600 text-white text-sm px-4 py-3 rounded-xl shadow-lg">
          <span>Νέα έκδοση έτοιμη</span>
          <button
            onClick={() => ipc.update.install()}
            className="bg-white text-brand-700 font-medium px-3 py-1 rounded-lg hover:bg-brand-50 transition-colors"
          >
            Εγκατάσταση
          </button>
        </div>
      )}
      {updateError && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-red-600 text-white text-sm px-4 py-3 rounded-xl shadow-lg max-w-sm">
          <span className="truncate">Σφάλμα ενημέρωσης: {updateError}</span>
          <button onClick={() => setUpdateError(null)} className="shrink-0 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
      {showUpgrade && (
        <div className="fixed inset-0 z-50">
          <Paywall
            onRefresh={async () => { setShowUpgrade(false); await checkSubscription() }}
            userId={userId}
          />
        </div>
      )}
      <Layout onSignOut={handleSignOut} tier={subCtx.tier} subscriptionStatus={subCtx.status}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/jobs"      element={<Jobs />} />
          <Route path="/offers"    element={<Offers />} />
          <Route path="/invoices"  element={<Invoices />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/calls"     element={<LockedFeature requiredTier="pro"><Calls /></LockedFeature>} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerProfile />} />
          <Route path="/chat"      element={<LockedFeature requiredTier="plus"><Chat /></LockedFeature>} />
          <Route path="/settings"  element={<Settings />} />
        </Routes>
      </Layout>
    </SubscriptionContext.Provider>
  )
}

// Convenience hook for pages
export function useSubscription() {
  return useContext(SubscriptionContext)
}
