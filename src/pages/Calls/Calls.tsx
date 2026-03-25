import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getCalls, getCallStats, getCategories, type Call, type Category } from '../../lib/db'
import CallDetailPanel from './CallDetailPanel'

export default function Calls() {
  const { t } = useTranslation()
  const [calls, setCalls] = useState<Call[]>([])
  const [stats, setStats] = useState({ total: 0, inbound: 0, outbound: 0, missed: 0 })
  const [categories, setCategories] = useState<Category[]>([])
  const [selected, setSelected] = useState<Call | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [c, s, cats] = await Promise.all([getCalls(), getCallStats(), getCategories()])
    setCalls(c)
    setStats(s)
    setCategories(cats)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  const catName = (id: string | null) =>
    categories.find(c => c.id === id)?.name_el ?? '—'

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
      <div className="flex-1 p-6 overflow-auto">
        <h1 className="text-2xl font-bold mb-6">{t('calls.title')}</h1>

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-600 text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">{t('calls.caller')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.phone')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.time')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.duration')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.category')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.status')}</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
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
