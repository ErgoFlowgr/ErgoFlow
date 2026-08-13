import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getCalls, getCallStats, getCategories, deleteCall, upsertCall, type Call, type Category } from '../../lib/db'
import { supabaseFetch } from '../../lib/platform'
import { useSubscription } from '../../App'
import CallDetailPanel from './CallDetailPanel'

export default function Calls() {
  const { t, i18n } = useTranslation()
  const { vapiMinutesUsed, vapiPhoneNumber, refreshSubscription } = useSubscription()
  const [calls, setCalls] = useState<Call[]>([])
  const [stats, setStats] = useState({ total: 0, inbound: 0, outbound: 0, missed: 0 })
  const [categories, setCategories] = useState<Category[]>([])
  const [selected, setSelected] = useState<Call | null>(null)
  const [loading, setLoading] = useState(true)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

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

  const formatTime = (ts: string | null) => ts ? new Date(ts).toLocaleString() : '—'

  const statusBadge = (status: string) => {
    if (status === 'completed') return <span className="badge-green">{t('status.completed')}</span>
    if (status === 'missed' || status === 'failed') return <span className="badge-red">{t('status.missed')}</span>
    return <span className="badge-yellow">{status || t('status.in-progress')}</span>
  }

  const syncFromVapi = async () => {
    setMessage('Syncing VAPI call status...')
    try {
      const res = await supabaseFetch('/functions/v1/vapi-sync', { method: 'POST', body: '{}' })
      const data = await res.json().catch(() => ({})) as { synced?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'VAPI sync failed')
      setMessage(`Synced ${data.synced ?? 0} call row(s).`)
      await Promise.all([load(), refreshSubscription()])
    } catch (e) {
      setMessage(`Sync failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const startOutboundCall = async () => {
    if (!phone.trim()) return
    setCreating(true)
    setMessage(null)
    try {
      const res = await supabaseFetch('/functions/v1/create-vapi-call', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), customer_name: name.trim() || undefined, reason: reason.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({})) as { id?: string; vapiCallId?: string; status?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not create VAPI call')
      await upsertCall({
        id: data.id,
        vapi_call_id: data.vapiCallId ?? null,
        customer_phone: phone.trim(),
        customer_name: name.trim() || phone.trim(),
        direction: 'outbound',
        status: data.status ?? 'queued',
        started_at: new Date().toISOString(),
        summary: reason.trim() ? `Outbound call requested: ${reason.trim()}` : 'Outbound call requested from ErgoFlow.',
      })
      setPhone(''); setName(''); setReason('')
      setMessage('Outbound call queued. Use Sync status after the call ends to pull transcript/summary.')
      await Promise.all([load(), refreshSubscription()])
    } catch (e) {
      setMessage(`Call failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setCreating(false)
    }
  }

  const statCards = [
    { label: t('calls.total'),    value: stats.total,    color: 'text-brand-500' },
    { label: t('calls.inbound'),  value: stats.inbound,  color: 'text-accent-green' },
    { label: t('calls.outbound'), value: stats.outbound, color: 'text-accent-yellow' },
    { label: t('calls.missed'),   value: stats.missed,   color: 'text-accent-red' },
  ]

  return (
    <div className="flex h-full w-full">
      <div className="flex-1 p-4 sm:p-6 overflow-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold">{t('calls.title')}</h1>
            <p className="text-sm text-gray-400 mt-1">AI Caller · {vapiMinutesUsed}/100 min used · {vapiPhoneNumber ? `Number ${vapiPhoneNumber}` : 'No number provisioned yet'}</p>
          </div>
          <button className="btn-secondary" onClick={syncFromVapi}>Sync status</button>
        </div>

        {message && <div className="mb-4 rounded-lg border border-surface-600 bg-surface-800 px-4 py-3 text-sm text-gray-300">{message}</div>}

        <div className="card mb-6">
          <h2 className="font-semibold mb-3">Start outbound call</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <input className="input" placeholder="Customer phone" value={phone} onChange={e => setPhone(e.target.value)} />
            <input className="input" placeholder="Customer name (optional)" value={name} onChange={e => setName(e.target.value)} />
            <input className="input" placeholder="Reason / job note (optional)" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-gray-500">Creates a VAPI outbound call and a local call row; transcript arrives through webhook/sync.</p>
            <button className="btn-primary" onClick={startOutboundCall} disabled={creating || !phone.trim()}>{creating ? 'Calling...' : 'Call now'}</button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {statCards.map(s => (
            <div key={s.label} className="card">
              <p className="text-sm text-gray-400">{s.label}</p>
              <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <p className="text-gray-300 font-medium">{t('calls.noData')}</p>
            <p className="text-gray-500 text-sm mt-1">Inbound webhook and outbound calls will appear here.</p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead><tr className="border-b border-surface-600 text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">{t('calls.caller')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.phone')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.time')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.duration')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.category')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('calls.status')}</th>
                  <th className="px-4 py-3" />
                </tr></thead>
                <tbody>
                  {calls.map(call => (
                    <tr key={call.id} onClick={() => setSelected(call)} className={`border-b border-surface-700 cursor-pointer hover:bg-surface-700 transition-colors ${selected?.id === call.id ? 'bg-surface-700' : ''}`}>
                      <td className="px-4 py-3 font-medium">{call.customer_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-400">{call.customer_phone ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-400">{formatTime(call.started_at)}</td>
                      <td className="px-4 py-3 text-gray-400">{formatDuration(call.duration_seconds)}</td>
                      <td className="px-4 py-3 text-gray-400">{catName(call.category_id)}</td>
                      <td className="px-4 py-3">{statusBadge(call.status)}</td>
                      <td className="px-4 py-3 text-right"><button onClick={async e => { e.stopPropagation(); if (!confirm('Delete this call?')) return; await deleteCall(call.id); if (selected?.id === call.id) setSelected(null); load() }} className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Delete call">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {selected && <CallDetailPanel call={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  )
}
