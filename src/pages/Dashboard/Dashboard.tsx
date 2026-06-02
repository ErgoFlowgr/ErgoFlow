import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ipc, isElectron } from '../../lib/electron'
import { db } from '../../lib/db-driver'
import { getCalls, getCustomers, getCallStats, getJobs, getOffers, type Call, type Job, type Offer } from '../../lib/db'

interface Stats {
  total: number
  inbound: number
  outbound: number
  missed: number
  customers: number
  todayCalls: number
  todayMissed: number
}

const PhoneIcon    = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 8V5z" /></svg>
const UsersIcon    = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
const MissedIcon   = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
const OffersIcon   = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
const TodayIcon    = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
const ChevronRight = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
const PlusIcon     = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode
  label: string
  value: number | string
  sub?: string
  color: string
}) {
  return (
    <div className="bg-surface-800 rounded-xl p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-lg ${color}`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-sm text-gray-400">{label}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/20 text-emerald-400',
    missed:    'bg-red-500/20 text-red-400',
    'in-progress': 'bg-yellow-500/20 text-yellow-400',
  }
  return map[status] ?? 'bg-gray-500/20 text-gray-400'
}

function jobStatusBadge(status: string) {
  const map: Record<string, string> = {
    pending:     'bg-gray-500/20 text-gray-400',
    'in-progress': 'bg-yellow-500/20 text-yellow-400',
    completed:   'bg-emerald-500/20 text-emerald-400',
  }
  return map[status] ?? 'bg-gray-500/20 text-gray-400'
}

function priorityDot(priority: string) {
  const map: Record<string, string> = {
    high:   'bg-red-400',
    normal: 'bg-yellow-400',
    low:    'bg-gray-500',
  }
  return map[priority] ?? 'bg-gray-500'
}

function formatDuration(secs: number | null) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const [stats, setStats] = useState<Stats>({ total: 0, inbound: 0, outbound: 0, missed: 0, customers: 0, todayCalls: 0, todayMissed: 0 })
  const [recentCalls, setRecentCalls] = useState<Call[]>([])
  const [todayJobs, setTodayJobs] = useState<Job[]>([])
  const [pendingOffers, setPendingOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [companyName, setCompanyName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10)

      const [callStats, calls, customers, settings, allJobs] = await Promise.all([
        getCallStats().catch(() => ({ total: 0, inbound: 0, outbound: 0, missed: 0 })),
        getCalls(200).catch(() => [] as Call[]),
        getCustomers().catch(() => []),
        db.get('SELECT company_name, owner_name, hidden_tabs FROM settings WHERE id = ?', ['main']).catch(() => undefined) as Promise<{ company_name: string; owner_name: string; hidden_tabs: string | null } | undefined>,
        getJobs().catch(() => [] as Job[]),
      ])

      const todayCalls  = calls.filter(c => c.started_at?.startsWith(today)).length
      const todayMissed = calls.filter(c => c.started_at?.startsWith(today) && c.status === 'missed').length

      setStats({ ...callStats, customers: customers.length, todayCalls, todayMissed })
      setRecentCalls(calls.slice(0, 8))
      setTodayJobs(allJobs.filter(j => j.scheduled_date === today && j.status !== 'cancelled'))
      setCompanyName(settings?.company_name ?? 'Ergoflow')
      setOwnerName(settings?.owner_name ?? '')
      try { setHiddenTabs(JSON.parse(settings?.hidden_tabs ?? '[]')) } catch { setHiddenTabs([]) }
      try { setPendingOffers(await getOffers('pending')) } catch { /* ignore */ }
    } catch (e) {
      console.error('[Dashboard]', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    if (isElectron) {
      ipc.on('sync:complete', load)
    } else {
      window.addEventListener('sync:complete', load)
    }
    return () => {
      clearInterval(interval)
      if (isElectron) ipc.off('sync:complete', load)
      else window.removeEventListener('sync:complete', load)
    }
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const hidden = (tab: string) => hiddenTabs.includes(tab)

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? t('dashboard.goodMorning') : hour < 18 ? t('dashboard.goodAfternoon') : t('dashboard.goodEvening')
  const locale = i18n.language === 'el' ? 'el-GR' : 'en-GB'

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">{greeting}{ownerName ? ` ${ownerName.replace(/ς$/i, '')}` : ''} 👋</h1>
        <p className="text-gray-400 text-sm mt-1">{companyName} · {now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {!hidden('calls') && <StatCard icon={<TodayIcon />}  label={t('dashboard.callsToday')}  value={stats.todayCalls}  sub={stats.todayMissed > 0 ? `${stats.todayMissed} ${t('dashboard.missed')}` : undefined} color="bg-brand-500/20 text-brand-400" />}
        {!hidden('calls') && <StatCard icon={<PhoneIcon />}  label={t('dashboard.totalCalls')}  value={stats.total}        color="bg-blue-500/20 text-blue-400" />}
        {!hidden('customers') && <StatCard icon={<UsersIcon />}  label={t('dashboard.customers')}   value={stats.customers}    color="bg-purple-500/20 text-purple-400" />}
        {!hidden('calls') && <StatCard icon={<MissedIcon />} label={t('dashboard.missedCalls')} value={stats.missed}       color="bg-red-500/20 text-red-400" />}
        {!hidden('offers') && <StatCard icon={<OffersIcon />} label={t('dashboard.pendingOffers')} value={pendingOffers.length} color="bg-amber-500/20 text-amber-400" />}
      </div>

      {/* Today's jobs */}
      {!hidden('jobs') && <div className="bg-surface-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
          <h2 className="text-sm font-semibold text-white">{t('dashboard.todayJobs')}</h2>
          <button
            onClick={() => navigate('/jobs', { state: { filterDate: new Date().toISOString().slice(0, 10) } })}
            className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
          >
            {t('dashboard.viewAll')} <ChevronRight />
          </button>
        </div>
        {todayJobs.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-500 text-sm">{t('dashboard.noJobsToday')}</div>
        ) : (
          <div className="divide-y divide-surface-600">
            {todayJobs.map(job => (
              <div key={job.id} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-700 cursor-pointer transition-colors" onClick={() => navigate('/jobs', { state: { jobId: job.id } })}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot(job.priority)}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{job.title}</p>
                  {job.customer_name && <p className="text-xs text-gray-500 truncate">{job.customer_name}</p>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${jobStatusBadge(job.status)}`}>
                  {t(`jobs.status_${job.status.replace('-', '')}`)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>}

      {/* Pending Offers */}
      {!hidden('offers') && <div className="bg-surface-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
          <h2 className="text-sm font-semibold text-white">{t('dashboard.pendingOffers')}</h2>
          <button onClick={() => navigate('/offers')} className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors">
            {t('dashboard.viewAll')} <ChevronRight />
          </button>
        </div>
        {pendingOffers.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-500 text-sm">{t('dashboard.noPendingOffers')}</div>
        ) : (
          <div className="divide-y divide-surface-600">
            {pendingOffers.slice(0, 6).map(off => (
              <div key={off.id} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-700 cursor-pointer transition-colors" onClick={() => navigate('/offers')}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{off.number}</p>
                  {off.customer_name && <p className="text-xs text-gray-500 truncate">{off.customer_name}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-white">{off.total.toLocaleString(locale, { style: 'currency', currency: 'EUR' })}</p>
                  <p className="text-xs text-gray-500">{off.issue_date ?? '—'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>}

      {/* Recent calls + quick actions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent calls */}
        {!hidden('calls') && <div className="lg:col-span-2 bg-surface-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
            <h2 className="text-sm font-semibold text-white">{t('dashboard.recentCalls')}</h2>
            <button
              onClick={() => navigate('/calls')}
              className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              {t('dashboard.viewAll')} <ChevronRight />
            </button>
          </div>

          {recentCalls.length === 0 ? (
            <div className="px-5 py-10 text-center text-gray-500 text-sm">{t('dashboard.noCallsYet')}</div>
          ) : (
            <div className="divide-y divide-surface-600">
              {recentCalls.map(call => (
                <div key={call.id} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-700 cursor-pointer transition-colors" onClick={() => navigate('/calls')}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{call.customer_name ?? call.customer_phone ?? 'Unknown'}</p>
                    <p className="text-xs text-gray-500">{timeAgo(call.started_at)} · {formatDuration(call.duration_seconds)}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(call.status)}`}>
                    {call.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>}

        {/* Quick actions */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-white px-1">{t('dashboard.quickActions')}</h2>

          <button
            onClick={() => navigate('/customers')}
            className="w-full flex items-center gap-3 p-4 bg-surface-800 hover:bg-surface-700 rounded-xl text-left transition-colors group"
          >
            <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400 group-hover:bg-purple-500/30 transition-colors">
              <PlusIcon />
            </div>
            <div>
              <p className="text-sm font-medium text-white">{t('dashboard.addCustomer')}</p>
              <p className="text-xs text-gray-500">{t('dashboard.addCustomerSub')}</p>
            </div>
          </button>

          {!hidden('calls') && <button
            onClick={() => navigate('/calls')}
            className="w-full flex items-center gap-3 p-4 bg-surface-800 hover:bg-surface-700 rounded-xl text-left transition-colors group"
          >
            <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400 group-hover:bg-blue-500/30 transition-colors">
              <PhoneIcon />
            </div>
            <div>
              <p className="text-sm font-medium text-white">{t('dashboard.viewCalls')}</p>
              <p className="text-xs text-gray-500">{t('dashboard.viewCallsSub')}</p>
            </div>
          </button>}

          <button
            onClick={() => navigate('/customers')}
            className="w-full flex items-center gap-3 p-4 bg-surface-800 hover:bg-surface-700 rounded-xl text-left transition-colors group"
          >
            <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400 group-hover:bg-purple-500/30 transition-colors">
              <UsersIcon />
            </div>
            <div>
              <p className="text-sm font-medium text-white">{t('dashboard.customers')}</p>
              <p className="text-xs text-gray-500">{stats.customers} {t('dashboard.totalContacts')}</p>
            </div>
          </button>

          {!hidden('chat') && <button
            onClick={() => navigate('/chat')}
            className="w-full flex items-center gap-3 p-4 bg-surface-800 hover:bg-surface-700 rounded-xl text-left transition-colors group"
          >
            <div className="p-2 bg-brand-500/20 rounded-lg text-brand-400 group-hover:bg-brand-500/30 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            </div>
            <div>
              <p className="text-sm font-medium text-white">{t('nav.chat')}</p>
              <p className="text-xs text-gray-500">{t('dashboard.askProducts')}</p>
            </div>
          </button>}
        </div>
      </div>
    </div>
  )
}
