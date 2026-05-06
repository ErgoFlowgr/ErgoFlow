import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getCalls, getCallStats, getCategories, deleteCall, type Call, type Category } from '../../lib/db'
import CallDetailPanel from './CallDetailPanel'

export default function Calls() {
  const { t, i18n } = useTranslation()
  const [calls, setCalls] = useState<Call[]>([])
  const [stats, setStats] = useState({ total: 0, inbound: 0, outbound: 0, missed: 0 })
  const [categories, setCategories] = useState<Category[]>([])
  const [selected, setSelected] = useState<Call | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [c, s, cats] = await Promise.all([getCalls(), getCallStats(), getCategories()])
      setCalls(c)
      setStats(s)
      setCategories(cats)
    } catch (e) {
      console.error('[Calls] load failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  const catName = (id: string | null) => {
    const cat = categories.find(c => c.id === id)
    if (!cat) return '—'
    return i18n.language === 'en' ? cat.name_en : cat.name_el
  }

  const formatDuration = (secs: number | null) => {
    if (!secs) return '—'
    const m = Math.floor(secs / 60), s = secs % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const formatTime = (ts: string | null) =>
    ts ? new Date(ts).toLocaleString() : '—'

  const statusBadge = (status: string) => {
    if (status === 'completed') return <span className="badge-green">{t('status.completed')}</span>
    if (status === 'missed')    return <span className="badge-red">{t('status.missed')}</span>
    return <span className="badge-yellow">{t('status.in-progress')}</span>
  }

  const statCards = [
    { label: t('calls.total'),    value: stats.total,    color: 'text-brand-500' },
    { label: t('calls.inbound'),  value: stats.inbound,  color: 'text-accent-green' },
    { label: t('calls.outbound'), value: stats.outbound, color: 'text-accent-yellow' },
    { label: t('calls.missed'),   value: stats.missed,   color: 'text-accent-red' },
  ]

  return (
    <div className="flex h-full">
      <div className="flex-1 p-4 sm:p-6 overflow-auto">
        <h1 className="text-2xl font-bold mb-6">{t('calls.title')}</h1>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {statCards.map(s => (
            <div key={s.label} className="card">
              <p className="text-sm text-gray-400">{s.label}</p>
              <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Calls table */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-full bg-surface-700 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 8V5z" />
              </svg>
            </div>
            <p className="text-gray-300 font-medium">{t('calls.noData')}</p>
            <p className="text-gray-500 text-sm mt-1">{t('calls.noDataSub')}</p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-surface-600 text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">{t('calls.caller')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.phone')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.time')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.duration')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.category')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.status')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {calls.map(call => (
                  <tr
                    key={call.id}
                    onClick={() => setSelected(call)}
                    className={`border-b border-surface-700 cursor-pointer hover:bg-surface-700 transition-colors ${selected?.id === call.id ? 'bg-surface-700' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium">{call.customer_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{call.customer_phone ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{formatTime(call.started_at)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDuration(call.duration_seconds)}</td>
                    <td className="px-4 py-3 text-gray-400">{catName(call.category_id)}</td>
                    <td className="px-4 py-3">{statusBadge(call.status)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={async e => {
                          e.stopPropagation()
                          if (!confirm('Delete this call?')) return
                          await deleteCall(call.id)
                          if (selected?.id === call.id) setSelected(null)
                          load()
                        }}
                        className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete call"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <CallDetailPanel call={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
