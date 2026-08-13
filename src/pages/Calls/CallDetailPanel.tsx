import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { upsertCustomer, upsertJob, type Call } from '../../lib/db'

interface Props { call: Call; onClose: () => void; onChanged?: () => void }

export default function CallDetailPanel({ call, onClose, onChanged }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const createCustomer = async () => {
    if (!call.customer_phone && !call.customer_name) return
    setBusy('customer')
    setMessage(null)
    try {
      const name = call.customer_name && call.customer_name !== call.customer_phone ? call.customer_name : call.customer_phone ?? 'Unknown caller'
      await upsertCustomer({
        name,
        phone: call.customer_phone,
        notes: call.summary ? `AI Caller summary:\n${call.summary}` : null,
      })
      setMessage('Customer created/updated from call summary.')
      await onChanged?.()
    } catch (e) {
      setMessage(`Customer action failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const createJob = async () => {
    setBusy('job')
    setMessage(null)
    try {
      await upsertJob({
        customer_id: call.customer_id,
        customer_name: call.customer_name,
        title: call.summary ? call.summary.slice(0, 80) : `Follow-up call ${call.customer_phone ?? ''}`.trim(),
        description: call.summary ?? call.transcript ?? null,
        notes: [
          call.customer_phone ? `Phone: ${call.customer_phone}` : '',
          call.vapi_call_id ? `VAPI call: ${call.vapi_call_id}` : '',
        ].filter(Boolean).join('\n') || null,
        status: 'pending',
        priority: 'normal',
      })
      setMessage('Follow-up job created from call summary.')
      await onChanged?.()
    } catch (e) {
      setMessage(`Job action failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-40 sm:relative sm:inset-auto sm:w-96 sm:border-l border-surface-600 bg-surface-800 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-surface-600">
        <h2 className="font-semibold">{call.customer_name ?? t('calls.caller')}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="space-y-2 text-sm">
          {[
            [t('calls.phone'), call.customer_phone],
            ['Direction', call.direction],
            [t('calls.time'),  call.started_at ? new Date(call.started_at).toLocaleString() : '—'],
            [t('calls.duration'), call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s` : '—'],
            [t('calls.status'), call.status],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <span className="text-gray-400">{k}</span>
              <span className="font-medium text-right break-all">{v ?? '—'}</span>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-surface-600 bg-surface-900 p-3 space-y-3">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Actions from summary</p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary text-xs" onClick={createCustomer} disabled={busy !== null || (!call.customer_phone && !call.customer_name)}>{busy === 'customer' ? 'Working...' : 'Create customer'}</button>
            <button className="btn-secondary text-xs" onClick={createJob} disabled={busy !== null}>{busy === 'job' ? 'Working...' : 'Create job'}</button>
          </div>
          <p className="text-[11px] text-gray-500">Creates draft records only. Review customer/job details before sending offers or invoices.</p>
          {message && <p className="text-xs text-brand-300">{message}</p>}
        </div>

        {call.recording_url && (
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Recording</p>
            <audio controls src={call.recording_url} className="w-full" />
          </div>
        )}

        {call.summary && (
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{t('calls.summary')}</p>
            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{call.summary}</p>
          </div>
        )}

        {call.transcript && (
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{t('calls.transcript')}</p>
            <div className="bg-surface-900 rounded-lg p-3 text-sm text-gray-300 leading-relaxed max-h-64 overflow-auto whitespace-pre-wrap">
              {call.transcript}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
