import { useEffect, useState } from 'react'
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
import Inventory from './pages/Inventory/Inventory'

export default function App() {
  const { i18n } = useTranslation()
  const [ready, setReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [onboarded, setOnboarded] = useState(false)
  useEffect(() => {
    // Check if already authenticated (token in keychain)
    ipc.keychain.get('supabase_access_token').then(token => {
      if (token) setAuthenticated(true)
    })

    getSettings().then(s => {
      if (s?.language) i18n.changeLanguage(s.language)
      setOnboarded(!!s?.onboarding_complete)
      setReady(true)
    })

    return () => {}
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
  }

  if (!authenticated) {
    return <Auth onAuth={() => setAuthenticated(true)} />
  }

  if (!onboarded) {
    return <Onboarding onComplete={() => setOnboarded(true)} />
  }

  return (
    <>
      <Layout onSignOut={handleSignOut}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/jobs"      element={<Jobs />} />
          <Route path="/offers"    element={<Offers />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/calls"     element={<Calls />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerProfile />} />
          <Route path="/chat"      element={<Chat />} />
          <Route path="/settings"  element={<Settings />} />
        </Routes>
      </Layout>

    </>
  )
}
