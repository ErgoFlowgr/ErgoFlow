import { useEffect, useState, createContext, useContext } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getSettings } from './lib/db'
import { ipc, isElectron } from './lib/electron'
import { platform } from './lib/platform'
import { db } from './lib/db-driver'
import { syncNow } from './lib/sync-mobile'

function extractUserIdFromJwt(token: string): string | null {
  try { return (JSON.parse(atob(token.split('.')[1])) as { sub?: string }).sub ?? null } catch { return null }
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

  const checkSubscription = async () => {
    const sub = await checkLicense()
    setSubscription(sub)
  }

  useEffect(() => {
    const init = async () => {
      try {
        const token = await platform.getToken()
        if (token) {
          const userId = token.includes('.') ? extractUserIdFromJwt(token) : token
          if (userId) { await db.switch(userId); setUserId(userId) }
        }
        const s = await getSettings()
        if (s?.language) { i18n.changeLanguage(s.language); document.documentElement.lang = s.language }
        if (token) {
          setOnboarded(true)
          setAuthenticated(true)
          await checkSubscription()
          if (s?.sync_enabled) {
            if (isElectron) setTimeout(() => ipc.syncNow(), 1000)
            else setTimeout(() => syncNow(), 2000)
          }
        } else {
          setOnboarded(!!s?.onboarding_complete)
        }
      } catch (e) {
        console.error('[App] init failed:', e)
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
      <div className="flex items-center justify-center h-screen bg-surface-900">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
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
      setAuthenticated(true)
      if (!isNewAccount) setOnboarded(true)
      await checkSubscription()
      const freshSettings = await getSettings()
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
