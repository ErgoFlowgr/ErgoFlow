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
import LockedFeature from './components/LockedFeature'

interface SubscriptionInfo {
  status: string
  daysLeft: number
  trialEnd: string
  tier: string              // 'basic' | 'pro' | 'pro_plus'
  vapiMinutesUsed: number
  vapiPhoneNumber: string | null
}

// Subscription context — consumed by pages that need to gate features
export interface SubscriptionCtx {
  tier: string
  status: string
  vapiMinutesUsed: number
  vapiPhoneNumber: string | null
  isPro: boolean
  isProPlus: boolean
}

export const SubscriptionContext = createContext<SubscriptionCtx>({
  tier: 'basic',
  status: 'trial',
  vapiMinutesUsed: 0,
  vapiPhoneNumber: null,
  isPro: false,
  isProPlus: false,
})

export default function App() {
  const { i18n } = useTranslation()
  const [ready, setReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [onboarded, setOnboarded] = useState(false)
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [, setSyncKey] = useState(0)
  const [updateReady, setUpdateReady] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const checkSubscription = async () => {
    try {
      if (!isElectron) {
        // Mobile: subscription gating not implemented yet — allow full access
        setSubscription({ status: 'active', daysLeft: 999, trialEnd: '', tier: 'pro_plus', vapiMinutesUsed: 0, vapiPhoneNumber: null })
        return
      }
      const sub = await ipc.subscriptionCheck()
      setSubscription(sub)
    } catch {
      setSubscription({ status: 'trial', daysLeft: 30, trialEnd: '', tier: 'basic', vapiMinutesUsed: 0, vapiPhoneNumber: null })
    }
  }

  useEffect(() => {
    const init = async () => {
      try {
        const token = await platform.getToken()
        if (token) {
          const userId = token.includes('.') ? extractUserIdFromJwt(token) : token
          if (userId) await db.switch(userId)
        }
        const s = await getSettings()
        if (s?.language) { i18n.changeLanguage(s.language); document.documentElement.lang = s.language }
        if (token) {
          setOnboarded(true)
          setAuthenticated(true)
          await checkSubscription()
          if (isElectron) setTimeout(() => ipc.syncNow(), 1000)
          else setTimeout(() => syncNow(), 2000)
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

    if (!isElectron) {
      const onSync = () => setSyncKey(k => k + 1)
      window.addEventListener('sync:complete', onSync)
      return () => window.removeEventListener('sync:complete', onSync)
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
    setAuthenticated(false)
    setOnboarded(false)
  }

  if (!authenticated) {
    // isNewAccount=true → show onboarding, false → skip straight to app
    return <Auth onAuth={async (isNewAccount: boolean) => {
      setAuthenticated(true)
      if (!isNewAccount) setOnboarded(true)
      await checkSubscription()
      // Fire sync after pages have mounted — delay gives Android WebView time to stabilize
      if (!isElectron) setTimeout(() => syncNow(), 2000)
    }} />
  }

  if (!onboarded) {
    return <Onboarding onComplete={() => setOnboarded(true)} />
  }

  // Block access if subscription is expired or cancelled
  if (subscription && (subscription.status === 'expired' || subscription.status === 'cancelled')) {
    return <Paywall onRefresh={async () => { await checkSubscription() }} />
  }

  // Trial banner data — passed to Layout so it can show the warning
  const trialDaysLeft = subscription?.status === 'trial' ? subscription.daysLeft : null

  const subCtx: SubscriptionCtx = {
    tier:            subscription?.tier ?? 'basic',
    status:          subscription?.status ?? 'trial',
    vapiMinutesUsed: subscription?.vapiMinutesUsed ?? 0,
    vapiPhoneNumber: subscription?.vapiPhoneNumber ?? null,
    isPro:           ['pro', 'pro_plus'].includes(subscription?.tier ?? ''),
    isProPlus:       subscription?.tier === 'pro_plus',
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
      <Layout onSignOut={handleSignOut} trialDaysLeft={trialDaysLeft}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/jobs"      element={<Jobs />} />
          <Route path="/offers"    element={<Offers />} />
          <Route path="/invoices"  element={<Invoices />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/calls"     element={<LockedFeature requiredTier="pro_plus"><Calls /></LockedFeature>} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerProfile />} />
          <Route path="/chat"      element={<LockedFeature requiredTier="pro"><Chat /></LockedFeature>} />
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
