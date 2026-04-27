import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { ipc, isElectron } from '../lib/electron'
import { getSettings } from '../lib/db'

const SignOutIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>

const HomeIcon      = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
const JobsIcon      = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
const PhoneIcon     = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 8V5z" /></svg>
const UsersIcon     = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
const ChatIcon      = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
const OffersIcon    = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
const InvoiceIcon   = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
const InventoryIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
const SettingsIcon  = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>

function AppVersion() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    if (isElectron) ipc.getVersion().then(setVersion).catch(() => {})
  }, [])
  if (!version) return null
  return <p className="text-xs text-gray-600 px-2">v{version}</p>
}

interface LayoutProps {
  children: React.ReactNode
  onSignOut?: () => void
  trialDaysLeft?: number | null
  tier?: string
  subscriptionStatus?: string
}

export default function Layout({ children, onSignOut, trialDaysLeft, tier = 'basic', subscriptionStatus = 'trial' }: LayoutProps) {
  const { t } = useTranslation()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncPulse, setSyncPulse] = useState(false)
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([])
  const [updateReady, setUpdateReady] = useState(false)
  const [syncEnabled, setSyncEnabled] = useState(false)

  const loadHiddenTabs = () => {
    getSettings().then(s => {
      try { setHiddenTabs(JSON.parse(s?.hidden_tabs ?? '[]')) } catch { setHiddenTabs([]) }
      setSyncEnabled(!!s?.sync_enabled)
    })
  }

  useEffect(() => {
    if (isElectron) ipc.update.onReady(() => setUpdateReady(true))
    loadHiddenTabs()

    const onOnline  = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('settings:changed', loadHiddenTabs)

    const onSync = () => { setSyncPulse(true); setTimeout(() => setSyncPulse(false), 1000) }
    if (isElectron) ipc.on('sync:complete', onSync)

    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('settings:changed', loadHiddenTabs)
      if (isElectron) ipc.off('sync:complete', onSync)
    }
  }, [])

  const navItem = (to: string, icon: React.ReactNode, label: string) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
          isActive
            ? 'bg-brand-500/20 text-brand-500'
            : 'text-gray-400 hover:text-white hover:bg-surface-700'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-surface-800 border-r border-surface-600 flex flex-col shrink-0">
        <div className="h-8 bg-surface-900 flex items-center px-4 gap-2" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase select-none">Ergoflow</span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItem('/dashboard', <HomeIcon />,      t('nav.dashboard'))}
          {!hiddenTabs.includes('jobs')      && navItem('/jobs',      <JobsIcon />,      t('nav.jobs'))}
          {!hiddenTabs.includes('calls')     && navItem('/calls',     <PhoneIcon />,     t('nav.calls'))}
          {!hiddenTabs.includes('customers') && navItem('/customers', <UsersIcon />,     t('nav.customers'))}
          {!hiddenTabs.includes('offers')    && navItem('/offers',    <OffersIcon />,    t('nav.offers'))}
          {!hiddenTabs.includes('invoices')  && navItem('/invoices',  <InvoiceIcon />,   t('nav.invoices'))}
          {!hiddenTabs.includes('inventory') && navItem('/inventory', <InventoryIcon />, t('nav.inventory'))}
          {!hiddenTabs.includes('chat')      && navItem('/chat',      <ChatIcon />,      t('nav.chat'))}
          {navItem('/settings',  <SettingsIcon />, t('nav.settings'))}
        </nav>

        <div className="p-3 border-t border-surface-600 space-y-2">
          {/* Subscription tier + trial countdown */}
          {(tier === 'pro' || tier === 'plus') ? (
            <div className="px-1">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                tier === 'pro' ? 'bg-purple-500/20 text-purple-400' : 'bg-brand-500/20 text-brand-400'
              }`}>
                {tier === 'pro' ? 'Pro' : 'Plus'}
              </span>
            </div>
          ) : subscriptionStatus === 'trial' && trialDaysLeft !== null && trialDaysLeft !== undefined ? (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-2.5 py-2 text-xs text-yellow-400">
              <span className="font-medium">Trial</span> · {trialDaysLeft} {trialDaysLeft === 1 ? 'μέρα απομένει' : 'μέρες απομένουν'}
            </div>
          ) : (
            <div className="px-1">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-600 text-gray-400">Basic</span>
            </div>
          )}

          {/* Connectivity — internet up/down */}
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? (syncPulse ? 'bg-accent-green animate-pulse' : 'bg-accent-green') : 'bg-red-500'}`} />
            <span className={isOnline ? '' : 'text-red-400'}>{isOnline ? t('common.online') : t('common.offline')}</span>
          </div>

          {/* Cloud backup — independent of connectivity */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full shrink-0 ${syncEnabled ? 'bg-brand-500/70' : 'bg-gray-600'}`} />
            <span className={syncEnabled ? 'text-gray-500' : 'text-gray-600'}>
              {syncEnabled ? 'Cloud backup ενεργό' : 'Cloud backup ανενεργό'}
            </span>
          </div>

          <AppVersion />
          {onSignOut && (
            <button
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-gray-500 hover:text-white hover:bg-surface-700 rounded-md transition-colors"
              onClick={onSignOut}
            >
              <SignOutIcon />
              Sign out
            </button>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden bg-surface-900">
        <div className="h-8 shrink-0 bg-surface-900" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>

      {updateReady && (
        <div className="fixed bottom-4 right-4 z-50 bg-brand-500 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3">
          <span className="text-sm font-medium">Νέα έκδοση έτοιμη</span>
          <button
            onClick={() => ipc.update.install()}
            className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-sm font-semibold transition-colors"
          >
            Επανεκκίνηση
          </button>
        </div>
      )}
    </div>
  )
}
