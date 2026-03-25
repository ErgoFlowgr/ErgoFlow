import { useTranslation } from 'react-i18next'

interface CheckResult { name: string; status: 'ok' | 'error' | 'warning'; message: string }
interface Report {
  status: 'ok' | 'degraded' | 'critical'
  checks: CheckResult[]
  briefing: string
  errors: CheckResult[]
  checkedAt: string
}

interface Props { report: unknown; onClose: () => void }

export default function OverseerModal({ report: rawReport, onClose }: Props) {
  const { t } = useTranslation()
  const report = rawReport as Report

  const statusColor = report.status === 'ok' ? 'text-accent-green' : report.status === 'degraded' ? 'text-accent-yellow' : 'text-accent-red'
  const statusIcon  = report.status === 'ok' ? '✅' : report.status === 'degraded' ? '⚠️' : '🔴'
  const checkIcon = (s: string) => s === 'ok' ? '✓' : s === 'warning' ? '⚠' : '✗'
  const checkColor = (s: string) => s === 'ok' ? 'text-accent-green' : s === 'warning' ? 'text-accent-yellow' : 'text-accent-red'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">{statusIcon}</span>
            <h2 className={`text-lg font-bold ${statusColor}`}>{t(`overseer.status_${report.status}`)}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <p className="text-xs text-gray-400 mb-4">{new Date(report.checkedAt).toLocaleString()}</p>

        {/* Checks */}
        <div className="space-y-2 mb-5">
          {report.checks.map((check, i) => (
            <div key={i} className="flex items-center gap-3 bg-surface-700 rounded-lg px-3 py-2">
              <span className={`font-bold ${checkColor(check.status)}`}>{checkIcon(check.status)}</span>
              <div>
                <p className="text-sm font-medium">{check.name}</p>
                <p className="text-xs text-gray-400">{check.message}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Briefing */}
        {report.briefing && (
          <div className="bg-surface-700 rounded-lg p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t('overseer.briefing')}</p>
            <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{report.briefing}</p>
          </div>
        )}

        <button className="btn-primary w-full justify-center mt-4" onClick={onClose}>{t('common.close')}</button>
      </div>
    </div>
  )
}
