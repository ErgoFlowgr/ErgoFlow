import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
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
    if (isElectron) {
      ipc.getVersion().then(setVersion).catch(() => {})
    } else {
      import('@capacitor/device').then(({ Device }) =>
        Device.getInfo().then(info => setVersion(info.appVersion ?? null)).catch(() => {})
      ).catch(() => {})
    }
  }, [])
  if (!version) return null
  return <p className="text-xs text-gray-600 px-2">v{version}</p>
}

// ── More menu icon ────────────────────────────────────────────────────────
const MoreIcon = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
    <circle cx="5"  cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
)

// ── Mobile bottom nav with "More" overflow popup ──────────────────────────
const MAX_VISIBLE = 4  // slots before the "More" button

interface MobileNavItem { to: string; icon: React.ReactNode; label: string; key: string }

function MobileLayout({ children, allMobileItems }: { children: React.ReactNode; allMobileItems: MobileNavItem[] }) {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  // Close the popup when navigating or tapping outside
  useEffect(() => { setMoreOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!moreOpen) return
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [moreOpen])

  const visibleItems = allMobileItems.slice(0, MAX_VISIBLE)
  const overflowItems = allMobileItems.slice(MAX_VISIBLE)
  const hasOverflow = overflowItems.length > 0

  // Is any overflow route currently active?
  const overflowActive = overflowItems.some(item => location.pathname.startsWith(item.to))

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-900">
      {/* Content area */}
      <main className="flex-1 overflow-auto" style={{ paddingBottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
        {children}
      </main>

      {/* Bottom navigation bar */}
      <nav className="shrink-0 bg-surface-800 border-t border-surface-600"
           style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex h-16">
          {/* Visible tabs */}
          {visibleItems.map(item => (
            <NavLink
              key={item.key}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 flex-1 px-1 transition-colors duration-150 ${
                  isActive ? 'text-brand-500' : 'text-gray-500'
                }`
              }
            >
              {item.icon}
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </NavLink>
          ))}

          {/* More button — only when there are overflow items */}
          {hasOverflow && (
            <div ref={moreRef} className="relative flex-1">
              <button
                onClick={() => setMoreOpen(v => !v)}
                className={`flex flex-col items-center justify-center gap-1 w-full h-full px-1 transition-colors duration-150 ${
                  moreOpen || overflowActive ? 'text-brand-500' : 'text-gray-500'
                }`}
              >
                <MoreIcon />
                <span className="text-[10px] font-medium leading-none">Περισσότερα</span>
              </button>

              {/* Popup menu — opens upward */}
              {moreOpen && (
                <div className="absolute bottom-full right-0 mb-1 bg-surface-700 border border-surface-600 rounded-xl shadow-xl overflow-hidden min-w-[160px]">
                  {overflowItems.map(item => {
                    const isActive = location.pathname.startsWith(item.to)
                    return (
                      <NavLink
                        key={item.key}
                        to={item.to}
                        className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors duration-150 ${
                          isActive
                            ? 'text-brand-500 bg-brand-500/10'
                            : 'text-gray-300 hover:bg-surface-600 active:bg-surface-600'
                        }`}
                      >
                        {item.icon}
                        {item.label}
                      </NavLink>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* When no overflow — render remaining items normally (5 or fewer total) */}
          {!hasOverflow && null}
        </div>
      </nav>
    </div>
  )
}

interface LayoutProps {
  children: React.ReactNode
  onSignOut?: () => void
  tier?: string
  subscriptionStatus?: string
}

export default function Layout({ children, onSignOut, tier = 'free', subscriptionStatus = 'active' }: LayoutProps) {
  const { t } = useTranslation()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncPulse, setSyncPulse] = useState(false)
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([])
  const [updateReady, setUpdateReady] = useState(false)
  const [syncEnabled, setSyncEnabled] = useState(false)
  const [offlineDaysLeft, setOfflineDaysLeft] = useState<number | null>(null)

  const loadHiddenTabs = () => {
    getSettings().then(s => {
      try { setHiddenTabs(JSON.parse(s?.hidden_tabs ?? '[]')) } catch { setHiddenTabs([]) }
      setSyncEnabled(!!s?.sync_enabled)
      if (s?.license_verified_at) {
        const verifiedAt = new Date(s.license_verified_at).getTime()
        const deadline = verifiedAt + 30 * 24 * 60 * 60 * 1000
        const daysLeft = Math.max(0, Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000)))
        setOfflineDaysLeft(daysLeft)
      } else {
        setOfflineDaysLeft(null)
      }
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

  // ── Desktop sidebar nav item ──────────────────────────────────────────────
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

  // ── Mobile layout ─────────────────────────────────────────────────────────
  if (!isElectron) {
    const allMobileItems = [
      { to: '/dashboard', icon: <HomeIcon />,      label: t('nav.dashboard'), key: 'dashboard' },
      ...(!hiddenTabs.includes('jobs')      ? [{ to: '/jobs',      icon: <JobsIcon />,      label: t('nav.jobs'),      key: 'jobs' }]      : []),
      ...(!hiddenTabs.includes('calls')     ? [{ to: '/calls',     icon: <PhoneIcon />,     label: t('nav.calls'),     key: 'calls' }]     : []),
      ...(!hiddenTabs.includes('customers') ? [{ to: '/customers', icon: <UsersIcon />,     label: t('nav.customers'), key: 'customers' }] : []),
      ...(!hiddenTabs.includes('offers')    ? [{ to: '/offers',    icon: <OffersIcon />,    label: t('nav.offers'),    key: 'offers' }]    : []),
      ...(!hiddenTabs.includes('invoices')  ? [{ to: '/invoices',  icon: <InvoiceIcon />,   label: t('nav.invoices'),  key: 'invoices' }]  : []),
      ...(!hiddenTabs.includes('inventory') ? [{ to: '/inventory', icon: <InventoryIcon />, label: t('nav.inventory'), key: 'inventory' }] : []),
      ...(!hiddenTabs.includes('chat')      ? [{ to: '/chat',      icon: <ChatIcon />,      label: t('nav.chat'),      key: 'chat' }]      : []),
      { to: '/settings', icon: <SettingsIcon />, label: t('nav.settings'), key: 'settings' },
    ]

    return <MobileLayout allMobileItems={allMobileItems}>{children}</MobileLayout>
  }

  // ── Desktop layout ────────────────────────────────────────────────────────
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
          {/* Subscription tier badge */}
          {(tier === 'pro' || tier === 'plus') ? (
            <div className="px-1">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                tier === 'pro' ? 'bg-purple-500/20 text-purple-400' : 'bg-brand-500/20 text-brand-400'
              }`}>
                {tier === 'pro' ? 'Pro' : 'Plus'}
              </span>
            </div>
          ) : (
            <div className="px-1">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-600 text-gray-400">
                {tier === 'free' ? 'Free' : 'Basic'}
              </span>
            </div>
          )}

          {/* Connectivity — internet up/down */}
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? (syncPulse ? 'bg-accent-green animate-pulse' : 'bg-accent-green') : 'bg-red-500'}`} />
            <span className={isOnline ? '' : 'text-red-400'}>{isOnline ? t('common.online') : t('common.offline')}</span>
          </div>

          {/* Offline verification countdown — shown only when offline */}
          {!isOnline && offlineDaysLeft !== null && (
            <div className={`flex items-center gap-1.5 text-xs ${offlineDaysLeft <= 7 ? 'text-red-400' : 'text-yellow-500'}`}>
              <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{offlineDaysLeft} {offlineDaysLeft === 1 ? 'μέρα' : 'μέρες'} για επαλήθευση</span>
            </div>
          )}

          {/* Cloud sync status */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full shrink-0 ${syncEnabled && isOnline ? (syncPulse ? 'bg-brand-500 animate-pulse' : 'bg-brand-500/70') : 'bg-gray-600'}`} />
            <span className={syncEnabled && isOnline ? 'text-gray-500' : 'text-gray-600'}>
              {!syncEnabled ? 'Sync ανενεργός' : !isOnline ? 'Sync (offline)' : 'Sync ενεργός'}
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
