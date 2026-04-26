import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n/i18n'
import { getSettings, saveSettings, getCategories, upsertCategory, deleteCategory, type Settings, type Category, uuid } from '../../lib/db'
import { ipc, isElectron } from '../../lib/electron'
import { platform } from '../../lib/platform'
import { useSubscription } from '../../App'
import { syncNow } from '../../lib/sync-mobile'
import { db } from '../../lib/db-driver'


const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="card">
    <h2 className="font-semibold text-base mb-4 pb-3 border-b border-surface-600">{title}</h2>
    <div className="space-y-4">{children}</div>
  </div>
)

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="label">{label}</label>
    {children}
  </div>
)

export default function SettingsPage() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [claudeKey, setClaudeKey] = useState('')
  const { isPro, vapiPhoneNumber, vapiMinutesUsed } = useSubscription()
  const [newCat, setNewCat] = useState('')
  const [newCatColor, setNewCatColor] = useState('#4f6ef7')
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle')
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)

  const loadLastSync = async () => {
    try {
      const meta = await db.get(`SELECT value FROM sync_meta WHERE key = 'last_pull_at'`) as { value: string } | undefined
      setLastSyncAt(meta?.value ?? null)
    } catch { /* ignore */ }
  }

  const handleSyncNow = async () => {
    setSyncStatus('syncing')
    if (isElectron) {
      const onComplete = () => {
        setSyncStatus('ok')
        loadLastSync()
        setTimeout(() => setSyncStatus('idle'), 3000)
        ipc.off('sync:complete', onComplete)
      }
      ipc.on('sync:complete', onComplete)
      ipc.syncNow()
    } else {
      const ok = await syncNow(true)
      await loadLastSync()
      setSyncStatus(ok ? 'ok' : 'error')
      setTimeout(() => setSyncStatus('idle'), 3000)
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const s = await getSettings()
        setSettings(s ?? {} as Settings)
        if (!s?.company_name && !s?.owner_name && isElectron) ipc.syncNow()
      } catch { setSettings({} as Settings) }
      try { setCategories(await getCategories()) } catch { /* ignore */ }
      try { setClaudeKey(await platform.getKeychainValue('claude_api_key') ?? '') } catch { /* ignore */ }
    }
    load()
    loadLastSync()
    if (isElectron) {
      ipc.on('sync:complete', load)
      return () => ipc.off('sync:complete', load)
    }
  }, [])

  const save = async () => {
    if (!settings) return
    setSaveError(false)
    try {
      await saveSettings({ ...settings, claude_api_key: claudeKey || null })
      if (claudeKey) await platform.setKeychainValue('claude_api_key', claudeKey)
      i18n.changeLanguage(settings.language)
      document.documentElement.lang = settings.language
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error('[Settings] save failed:', e)
      setSaveError(true)
      setTimeout(() => setSaveError(false), 3000)
    }
  }

  const addCategory = async () => {
    if (!newCat) return
    await upsertCategory({ id: uuid(), name_el: newCat, name_en: newCat, color: newCatColor })
    setCategories(await getCategories())
    setNewCat('')
  }

  const delCategory = async (id: string) => {
    await deleteCategory(id)
    setCategories(await getCategories())
  }

  const update = (patch: Partial<Settings>) => setSettings(p => p ? { ...p, ...patch } : p)

  const handleSyncToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked ? 1 : 0
    await saveSettings({ sync_enabled: enabled })
    update({ sync_enabled: enabled })
    if (enabled) {
      if (isElectron) await ipc.syncEnable()
      else await syncNow(true)
      await loadLastSync()
    }
  }

  if (!settings) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className={`p-6 max-w-2xl mx-auto space-y-5 ${platform.isMobile ? 'pb-4' : 'pb-24'}`}>
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>

      {/* Company */}
      <Section title={t('settings.company')}>
        <div className="flex gap-3">
          <Field label={t('settings.firstName')}>
            <input className="input" value={settings.owner_name ?? ''} onChange={e => update({ owner_name: e.target.value })} />
          </Field>
          <Field label={t('settings.lastName')}>
            <input className="input" value={settings.owner_last_name ?? ''} onChange={e => update({ owner_last_name: e.target.value })} />
          </Field>
        </div>
        <Field label={t('settings.companyName')}>
          <input className="input" value={settings.company_name ?? ''} onChange={e => update({ company_name: e.target.value })} />
        </Field>
        <Field label={t('settings.workType')}>
          <input className="input" value={settings.work_type ?? ''} onChange={e => update({ work_type: e.target.value })} placeholder="π.χ. Υδραυλικός, Ηλεκτρολόγος, Ψύξη..." />
        </Field>
        <Field label={t('settings.mobile')}>
          <input className="input" value={settings.phone ?? ''} onChange={e => update({ phone: e.target.value })} />
        </Field>
        <Field label={t('settings.landline')}>
          <input className="input" value={settings.phone2 ?? ''} onChange={e => update({ phone2: e.target.value })} />
        </Field>
        <Field label={t('settings.address')}>
          <input className="input" value={settings.address ?? ''} onChange={e => update({ address: e.target.value })} />
        </Field>
        <Field label="ΑΦΜ">
          <input className="input" value={settings.company_vat ?? ''} onChange={e => update({ company_vat: e.target.value || null })} placeholder="π.χ. 123456789" />
        </Field>
        <Field label={t('settings.language')}>
          <select className="input" value={settings.language} onChange={e => update({ language: e.target.value as 'el' | 'en' })}>
            <option value="el">Ελληνικά</option>
            <option value="en">English</option>
          </select>
        </Field>
      </Section>

      {/* AI Phone Assistant (Pro only) */}
      {isPro && (
        <Section title="AI Τηλεφωνικός Βοηθός">
          <Field label="Αριθμός Gianna">
            <div className="input bg-surface-700 text-gray-300 select-all font-mono">
              {vapiPhoneNumber ?? '— Εκκρεμεί ανάθεση αριθμού'}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Δώσε αυτόν τον αριθμό στους πελάτες σου. Η Gianna απαντά, καταγράφει και συνοψίζει κάθε κλήση.
            </p>
          </Field>
          <Field label="Λεπτά που χρησιμοποιήθηκαν αυτόν τον μήνα">
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-surface-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${vapiMinutesUsed >= 100 ? 'bg-red-500' : vapiMinutesUsed >= 80 ? 'bg-yellow-500' : 'bg-brand-500'}`}
                  style={{ width: `${Math.min(100, vapiMinutesUsed)}%` }}
                />
              </div>
              <span className={`text-sm font-medium ${vapiMinutesUsed >= 100 ? 'text-red-400' : vapiMinutesUsed >= 80 ? 'text-yellow-400' : 'text-gray-300'}`}>
                {vapiMinutesUsed} / 100 λεπτά
              </span>
            </div>
            {vapiMinutesUsed >= 100 && (
              <p className="text-xs text-red-400 mt-1">Εξαντλήθηκαν τα λεπτά σου. Αγόρασε επιπλέον λεπτά για να συνεχίσει η Gianna.</p>
            )}
            {vapiMinutesUsed >= 80 && vapiMinutesUsed < 100 && (
              <p className="text-xs text-yellow-400 mt-1">Πλησιάζεις το όριο. Απομένουν {100 - vapiMinutesUsed} λεπτά.</p>
            )}
          </Field>
        </Section>
      )}


      {/* Navigation tabs */}
      <Section title={t('settings.navigation')}>
        <p className="text-xs text-gray-500 mb-3">{t('settings.navigationHint')}</p>
        {(['jobs','calls','customers','offers','invoices','inventory','chat'] as const).map(tab => {
          const hidden: string[] = (() => { try { return JSON.parse(settings.hidden_tabs ?? '[]') } catch { return [] } })()
          const isVisible = !hidden.includes(tab)
          const toggle = () => {
            const next = isVisible ? [...hidden, tab] : hidden.filter(h => h !== tab)
            const value = JSON.stringify(next)
            update({ hidden_tabs: value })
            saveSettings({ hidden_tabs: value }).catch(e => console.error('[Settings] tab toggle save failed:', e))
          }
          return (
            <label key={tab} className="flex items-center justify-between py-2 border-b border-surface-700 last:border-0 cursor-pointer">
              <span className="text-sm text-gray-300">{t(`nav.${tab}`)}</span>
              <input type="checkbox" checked={isVisible} onChange={toggle} className="w-4 h-4 accent-brand-500 cursor-pointer" />
            </label>
          )
        })}
      </Section>

      {/* Categories */}
      <Section title={t('settings.categories')}>
        <div className="flex flex-wrap gap-2 mb-3">
          {categories.map(cat => (
            <div key={cat.id} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium" style={{ backgroundColor: cat.color + '20', borderColor: cat.color, border: '1px solid' }}>
              <span style={{ color: cat.color }}>{i18n.language === 'en' ? cat.name_en : cat.name_el}</span>
              <button onClick={() => delCategory(cat.id)} className="text-gray-500 hover:text-white transition-colors ml-1">×</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <input className="input" placeholder={i18n.language === 'en' ? 'Category name' : 'Όνομα κατηγορίας'} value={newCat} onChange={e => setNewCat(e.target.value)} />
          </div>
          <input type="color" value={newCatColor} onChange={e => setNewCatColor(e.target.value)} className="h-9 w-9 rounded cursor-pointer bg-transparent border-0" />
          <button className="btn-secondary whitespace-nowrap" onClick={addCategory}>{t('settings.addCategory')}</button>
        </div>
      </Section>

      {/* myDATA / ΑΑΔΕ */}
      <Section title="myDATA / ΑΑΔΕ">
        <p className="text-xs text-gray-500">
          Συνδεθείτε με το myDATA της ΑΑΔΕ για αυτόματη υποβολή τιμολογίων και απόδοση ΜΑΡΚ.
          Λάβετε credentials από το <button className="text-brand-400 hover:underline" onClick={() => isElectron ? ipc.openExternal('https://www.aade.gr/mydata') : window.open('https://www.aade.gr/mydata', '_blank')}>aade.gr/mydata</button>.
        </p>
        <Field label="ΑΦΜ Εταιρείας">
          <input
            className="input"
            value={settings.company_vat ?? ''}
            onChange={e => update({ company_vat: e.target.value || null })}
            placeholder="π.χ. 123456789"
          />
        </Field>
        <Field label="ΑΑΔΕ Username (aade-user-id)">
          <input
            className="input"
            value={settings.mydata_user_id ?? ''}
            onChange={e => update({ mydata_user_id: e.target.value || null })}
            placeholder="Το username σας στο ΑΑΔΕ"
          />
        </Field>
        <Field label="myDATA API Key (Ocp-Apim-Subscription-Key)">
          <input
            className="input font-mono text-xs"
            type="password"
            value={settings.mydata_api_key ?? ''}
            onChange={e => update({ mydata_api_key: e.target.value || null })}
            placeholder="Subscription key από το developer portal ΑΑΔΕ"
          />
        </Field>
      </Section>

      {/* Sync */}
      <Section title="Συγχρονισμός">
        <label className="flex items-center justify-between py-1 cursor-pointer">
          <div>
            <span className="text-sm text-gray-300">Συγχρονισμός δεδομένων</span>
            <p className="text-xs text-gray-500 mt-0.5">
              {settings.sync_enabled ? 'Τα δεδομένα συγχρονίζονται με το cloud' : 'Τα δεδομένα αποθηκεύονται τοπικά'}
            </p>
          </div>
          <input
            type="checkbox"
            checked={!!settings.sync_enabled}
            onChange={handleSyncToggle}
            className="w-4 h-4 accent-brand-500 cursor-pointer"
          />
        </label>
        {!!settings.sync_enabled && (
          <div className="flex items-center justify-between pt-2 border-t border-surface-600">
            <div>
              <p className="text-sm text-gray-300">Τελευταία ενημέρωση</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {lastSyncAt ? new Date(lastSyncAt).toLocaleString('el-GR') : 'Δεν έχει γίνει ακόμη'}
              </p>
            </div>
            <button
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                syncStatus === 'syncing' ? 'bg-brand-500/20 text-brand-400 cursor-not-allowed' :
                syncStatus === 'ok' ? 'bg-emerald-500/20 text-emerald-400' :
                syncStatus === 'error' ? 'bg-red-500/20 text-red-400' :
                'bg-brand-500 text-white hover:bg-brand-600'
              }`}
              disabled={syncStatus === 'syncing'}
              onClick={handleSyncNow}
            >
              {syncStatus === 'syncing' ? 'Συγχρονισμός...' :
               syncStatus === 'ok' ? '✓ Ολοκληρώθηκε' :
               syncStatus === 'error' ? '✗ Σφάλμα' :
               'Συγχρονισμός τώρα'}
            </button>
          </div>
        )}
        {platform.isMobile && (
          <div className="pt-2 border-t border-surface-600">
            <button
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              onClick={async () => {
                await platform.clearToken().catch(() => {})
                await platform.removeKeychainValue('supabase_refresh_token').catch(() => {})
                window.location.reload()
              }}
            >
              Αποσύνδεση
            </button>
          </div>
        )}
      </Section>

      {/* Save bar — fixed on desktop, inline on mobile to avoid floating gap */}
      {platform.isMobile ? (
        <div className="pt-2 pb-4 flex justify-end">
          <button
            className={`min-w-24 justify-center px-4 py-2 rounded-lg font-medium transition-colors ${saveError ? 'bg-red-500 text-white' : 'btn-primary'}`}
            onClick={save}
          >
            {saved ? `✓ ${t('settings.saved')}` : saveError ? '✗ Σφάλμα' : t('settings.save')}
          </button>
        </div>
      ) : (
        <div className={`fixed left-0 right-0 p-4 bg-surface-800 border-t border-surface-600 flex justify-end z-40 bottom-0`} style={isElectron ? { left: '14rem' } : {}}>
          <button
            className={`min-w-24 justify-center px-4 py-2 rounded-lg font-medium transition-colors ${saveError ? 'bg-red-500 text-white' : 'btn-primary'}`}
            onClick={save}
          >
            {saved ? `✓ ${t('settings.saved')}` : saveError ? '✗ Σφάλμα' : t('settings.save')}
          </button>
        </div>
      )}
    </div>
  )
}
