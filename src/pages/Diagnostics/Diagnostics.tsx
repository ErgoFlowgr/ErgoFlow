import { useEffect, useState } from 'react'
import { db } from '../../lib/db-driver'
import { getSettings } from '../../lib/db'
import { ipc, isElectron } from '../../lib/electron'
import { useSubscription } from '../../App'

interface DiagnosticsState {
  appVersion: string
  dataPath: string
  database: string
  syncEnabled: boolean
  syncQueue: number
  lastSettingsUpdate: string | null
  counts: Record<string, number>
  updateChannel: string
  releaseFeed: string
}

const tables = ['customers', 'jobs', 'offers', 'invoices', 'inventory', 'calls', 'sync_queue']

export default function Diagnostics() {
  const sub = useSubscription()
  const [state, setState] = useState<DiagnosticsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)

  const load = async () => {
    setError(null)
    try {
      const [settings, version, dataPath] = await Promise.all([
        getSettings(),
        isElectron ? ipc.getVersion().catch(() => 'unknown') : Promise.resolve(import.meta.env.VITE_APP_VERSION ?? 'web'),
        isElectron ? ipc.getDataPath().catch(() => 'unknown') : Promise.resolve('browser storage'),
      ])
      const counts: Record<string, number> = {}
      for (const table of tables) {
        try {
          const row = await db.get(`SELECT COUNT(*) as n FROM ${table}`) as { n?: number } | undefined
          counts[table] = row?.n ?? 0
        } catch {
          counts[table] = -1
        }
      }
      const queueRow = await db.get('SELECT COUNT(*) as n FROM sync_queue') as { n?: number } | undefined
      const updatedRow = await db.get("SELECT updated_at FROM settings WHERE id = 'main'") as { updated_at?: string } | undefined
      setState({
        appVersion: version,
        dataPath,
        database: isElectron ? `${dataPath}/ergoflow.sqlite` : 'IndexedDB/SQLite driver',
        syncEnabled: !!settings?.sync_enabled,
        syncQueue: queueRow?.n ?? 0,
        lastSettingsUpdate: updatedRow?.updated_at ?? null,
        counts,
        updateChannel: isElectron ? 'Electron auto-updater / GitHub release feed' : 'Web/mobile build',
        releaseFeed: 'GitHub latest release metadata may differ from local source until explicitly published.',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const createBackup = async () => {
    if (!isElectron) return
    setBackupBusy(true)
    setBackupMessage(null)
    setError(null)
    try {
      const result = await ipc.backup.create()
      if (!result.canceled && result.ok) {
        setBackupMessage(`Backup saved: ${result.filePath ?? 'selected location'}. Secrets were omitted.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBackupBusy(false)
    }
  }

  const restoreBackup = async () => {
    if (!isElectron) return
    setBackupBusy(true)
    setBackupMessage(null)
    setError(null)
    try {
      const result = await ipc.backup.restore()
      if (!result.canceled && result.ok) {
        setBackupMessage(`Backup restored. Safety copy created: ${result.safetyBackupPath ?? 'yes'}. ErgoFlow will reload.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBackupBusy(false)
    }
  }

  const showDataFolder = async () => {
    if (!isElectron) return
    try {
      await ipc.backup.showDataFolder()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const runSync = async () => {
    if (!isElectron) return
    setSyncing(true)
    setError(null)
    try {
      await ipc.syncNow()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Diagnostics / About</h1>
          <p className="text-sm text-gray-400 mt-1">Version, local database, sync queue, subscription and updater visibility.</p>
        </div>
        <button className="btn-secondary" onClick={load}>Refresh</button>
      </div>

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 px-4 py-3 text-sm">{error}</div>}
      {backupMessage && <div className="rounded-lg border border-accent-green/40 bg-accent-green/10 text-accent-green px-4 py-3 text-sm break-all">{backupMessage}</div>}
      {loading && <div className="card text-gray-400">Loading diagnostics...</div>}

      {state && (
        <>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="card"><p className="text-sm text-gray-400">App version</p><p className="text-2xl font-bold mt-1">{state.appVersion}</p></div>
            <div className="card"><p className="text-sm text-gray-400">Sync queue</p><p className={`text-2xl font-bold mt-1 ${state.syncQueue ? 'text-accent-yellow' : 'text-accent-green'}`}>{state.syncQueue}</p></div>
            <div className="card"><p className="text-sm text-gray-400">AI Caller usage</p><p className="text-2xl font-bold mt-1">{sub.vapiMinutesUsed}/100 min</p></div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card space-y-3">
              <h2 className="font-semibold">Runtime</h2>
              <Row label="Mode" value={isElectron ? 'Desktop / Electron' : 'Browser or mobile'} />
              <Row label="Data path" value={state.dataPath} />
              <Row label="Database" value={state.database} />
              <Row label="Sync enabled" value={state.syncEnabled ? 'yes' : 'no'} />
              <Row label="Last settings update" value={state.lastSettingsUpdate ?? '—'} />
              {isElectron && <button className="btn-secondary mt-2" onClick={runSync} disabled={syncing}>{syncing ? 'Syncing...' : 'Run sync now'}</button>}
            </div>

            <div className="card space-y-3">
              <h2 className="font-semibold">Subscription / AI Caller</h2>
              <Row label="Tier" value={sub.tier} />
              <Row label="Status" value={sub.status} />
              <Row label="VAPI phone" value={sub.vapiPhoneNumber ?? 'not provisioned'} />
              <Row label="Minutes used" value={`${sub.vapiMinutesUsed}/100`} />
              <Row label="Update channel" value={state.updateChannel} />
              <p className="text-xs text-gray-500 pt-2">{state.releaseFeed}</p>
            </div>
          </div>

          <div className="card space-y-4">
            <div>
              <h2 className="font-semibold">Backup / restore</h2>
              <p className="text-sm text-gray-400 mt-1">Create a local recovery file before risky updates or restore a previous ErgoFlow desktop backup.</p>
            </div>
            <div className="rounded-lg border border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow px-4 py-3 text-sm">
              Backups omit sensitive settings such as API keys, service credentials and tokens. After restore, those settings may need to be re-entered.
            </div>
            {isElectron ? (
              <div className="flex flex-wrap gap-3">
                <button className="btn-primary" onClick={createBackup} disabled={backupBusy}>{backupBusy ? 'Working...' : 'Create backup'}</button>
                <button className="btn-secondary" onClick={restoreBackup} disabled={backupBusy}>Restore backup</button>
                <button className="btn-secondary" onClick={showDataFolder} disabled={backupBusy}>Show data folder</button>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Desktop backup/restore is available only in the Electron app.</p>
            )}
          </div>

          <div className="card">
            <h2 className="font-semibold mb-3">Local row counts</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(state.counts).map(([table, count]) => (
                <div key={table} className="rounded-lg bg-surface-900 border border-surface-600 p-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">{table}</p>
                  <p className="text-xl font-bold mt-1">{count >= 0 ? count : 'n/a'}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 text-sm"><span className="text-gray-400">{label}</span><span className="font-medium text-right break-all">{value}</span></div>
}
