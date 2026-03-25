import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getOverseerLog, type OverseerEntry } from '../../lib/db'
import { ipc } from '../../lib/electron'

interface CheckResult { name: string; status: 'ok' | 'error' | 'warning'; message: string }

export default function Overseer() {
  const { t } = useTranslation()
  const [log, setLog] = useState<OverseerEntry[]>([])
  const [selected, setSelected] = useState<OverseerEntry | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    getOverseerLog().then(entries => {
      setLog(entries)
      if (entries.length > 0) setSelected(entries[0])
    })

    const onReport = () => {
      getOverseerLog().then(entries => {
        setLog(entries)
        if (entries.length > 0) setSelected(entries[0])
      })
      setRunning(false)
    }
    ipc.on('overseer:report', onReport)
    return () => ipc.off('overseer:report', onReport)
  }, [])

  const runNow = async () => {
    setRunning(true)
    try {
      await ipc.runOverseer()
    } finally {
      setRunning(false)
    }
  }

  const statusColor = (status: string) => {
    if (status === 'ok')       return 'text-accent-green'
    if (status === 'degraded') return 'text-accent-yellow'
    return 'text-accent-red'
  }

  const statusIcon = (status: string) => {
    if (status === 'ok') return '✅'
    if (status === 'degraded') return '⚠️'
    return '🔴'
  }

  const checkIcon = (status: string) => {
    if (status === 'ok')      return <span className="text-accent-green">✓</span>
    if (status === 'warning') return <span className="text-accent-yellow">⚠</span>
    return <span className="text-accent-red">✗</span>
  }

  const parseChecks = (entry: OverseerEntry): CheckResult[] => {
    try { return JSON.parse(entry.checks) } catch { return [] }
  }

  return (
    <div className="flex h-full">
      {/* History list */}
      <div className="w-72 border-r border-surface-600 bg-surface-800 flex flex-col">
        <div className="p-4 border-b border-surface-600 flex items-center justify-between">
          <h2 className="font-semibold">{t('overseer.history')}</h2>
          <button
            className="btn-primary text-xs px-3 py-1.5"
            onClick={runNow}
            disabled={running}
          >
            {running ? (
              <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            ) : t('overseer.runNow')}
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {log.length === 0 ? (
            <p className="text-gray-500 text-sm text-center p-6">{t('overseer.noHistory')}</p>
          ) : (
            log.map(entry => (
              <button
                key={entry.id}
                onClick={() => setSelected(entry)}
                className={`w-full text-left px-4 py-3 border-b border-surface-700 hover:bg-surface-700 transition-colors ${selected?.id === entry.id ? 'bg-surface-700' : ''}`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span>{statusIcon(entry.status)}</span>
                  <span className={`text-xs font-semibold ${statusColor(entry.status)}`}>
                    {t(`overseer.status_${entry.status}`)}
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  {new Date(entry.checked_at).toLocaleString()}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-auto p-6">
        {!selected ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">{t('overseer.noHistory')}</p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-6">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-2xl">{statusIcon(selected.status)}</span>
                <h1 className={`text-2xl font-bold ${statusColor(selected.status)}`}>
                  {t(`overseer.status_${selected.status}`)}
                </h1>
              </div>
              <p className="text-sm text-gray-400">{new Date(selected.checked_at).toLocaleString()}</p>
            </div>

            {/* System checks */}
            <div className="card">
              <h2 className="font-semibold mb-4">{t('overseer.checks')}</h2>
              <div className="space-y-3">
                {parseChecks(selected).map((check, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 font-bold text-lg leading-none">{checkIcon(check.status)}</span>
                    <div>
                      <p className="text-sm font-medium">{check.name}</p>
                      <p className="text-xs text-gray-400">{check.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Briefing */}
            {selected.briefing && (
              <div className="card">
                <h2 className="font-semibold mb-3">{t('overseer.briefing')}</h2>
                <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{selected.briefing}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
