import { useTranslation } from 'react-i18next'
import type { Call } from '../../lib/db'

interface Props { call: Call; onClose: () => void }

export default function CallDetailPanel({ call, onClose }: Props) {
  const { t } = useTranslation()

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
        {/* Meta */}
        <div className="space-y-2 text-sm">
          {[
            [t('calls.phone'), call.customer_phone],
            [t('calls.time'),  call.started_at ? new Date(call.started_at).toLocaleString() : '—'],
            [t('calls.duration'), call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s` : '—'],
            [t('calls.status'), call.status],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-gray-400">{k}</span>
              <span className="font-medium">{v ?? '—'}</span>
            </div>
          ))}
        </div>

        {/* Recording */}
        {call.recording_url && (
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Recording</p>
            <audio controls src={call.recording_url} className="w-full" />
          </div>
        )}

        {/* Summary */}
        {call.summary && (
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{t('calls.summary')}</p>
            <p className="text-sm text-gray-300 leading-relaxed">{call.summary}</p>
          </div>
        )}

        {/* Transcript */}
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
