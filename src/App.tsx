import { useEffect, useState, createContext, useContext } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getSettings } from './lib/db'
import { ipc } from './lib/electron'
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

  const checkSubscription = async () => {
    try {
      const sub = await ipc.subscriptionCheck()
      setSubscription(sub)
    } catch {
      // On error, allow access — don't block the app
      setSubscription({ status: 'trial', daysLeft: 30, trialEnd: '' })
    }
  }

  useEffect(() => {
    const init = async () => {
      const token = await ipc.keychain.get('supabase_access_token')
      if (token) await ipc.db.switch(token)   // switch DB BEFORE reading settings
      const s = await getSettings()
      if (s?.language) { i18n.changeLanguage(s.language); document.documentElement.lang = s.language }
      // If we have a stored token, this is an existing account — always skip onboarding
      // (local DB may be empty on a new machine; sync will populate it)
      if (token) {
        setOnboarded(true)
        setAuthenticated(true)
        // Trigger sync now — renderer is ready, so sync:complete will reach page listeners
        // (startup sync in main process fires before renderer loads, so its event is missed)
        setTimeout(() => ipc.syncNow(), 1000)
        // Check subscription status
        await checkSubscription()
      } else {
        setOnboarded(!!s?.onboarding_complete)
      }
      setReady(true)
    }
    init()
  }, [i18n])

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-900">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const handleSignOut = async () => {
    await ipc.keychain.delete('supabase_access_token').catch(() => {})
    await ipc.keychain.delete('supabase_refresh_token').catch(() => {})
    setAuthenticated(false)
    setOnboarded(false)
  }

  if (!authenticated) {
    // isNewAccount=true → show onboarding, false → skip straight to app
    return <Auth onAuth={async (isNewAccount: boolean) => {
      setAuthenticated(true)
      if (!isNewAccount) setOnboarded(true)
      await checkSubscription()
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
