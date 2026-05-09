import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n/i18n'
import { getSettings, saveSettings, getCategories, upsertCategory, deleteCategory, type Settings, type Category, uuid } from '../../lib/db'
import { ipc, isElectron } from '../../lib/electron'
import { platform } from '../../lib/platform'
import { useSubscription } from '../../App'
import { checkLicense } from '../../lib/license'
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
  const { tier, status, isPro, isFree, isPlus, aiTrialActive, aiTrialUsed, refreshSubscription, vapiPhoneNumber, vapiMinutesUsed } = useSubscription()
  const [licenseChecking, setLicenseChecking] = useState(false)
  const [licenseChecked, setLicenseChecked] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [newCatColor, setNewCatColor] = useState('#4f6ef7')
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle')
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const isDirty = useRef(false)
  const [inputKey, setInputKey] = useState(0)
  const [logoError, setLogoError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  // Uncontrolled refs — React never sets value on these; Android IME types freely
  const ownerNameRef      = useRef<HTMLInputElement>(null)
  const ownerLastNameRef  = useRef<HTMLInputElement>(null)
  const companyNameRef    = useRef<HTMLInputElement>(null)
  const workTypeRef       = useRef<HTMLInputElement>(null)
  const phoneRef          = useRef<HTMLInputElement>(null)
  const phone2Ref         = useRef<HTMLInputElement>(null)
  const addressRef        = useRef<HTMLInputElement>(null)
  const vatRef            = useRef<HTMLInputElement>(null)
  const mydataUserIdRef   = useRef<HTMLInputElement>(null)
  const mydataApiKeyRef   = useRef<HTMLInputElement>(null)
  const bratnetUsernameRef = useRef<HTMLInputElement>(null)
  const bratnetApiKeyRef   = useRef<HTMLInputElement>(null)

  const loadLastSync = async () => {
    try {
      const meta = await db.get(`SELECT value FROM sync_meta WHERE key = 'last_pull_at'`) as { value: string } | undefined
      setLastSyncAt(meta?.value ?? null)
    } catch { /* ignore */ }
  }

  const handleSyncNow = async () => {
    setSyncStatus('syncing')
    if (isElectron) {
      const cleanup = () => {
        ipc.off('sync:complete', onComplete)
        ipc.off('sync:error', onError)
      }
      const onComplete = () => {
        cleanup()
        setSyncStatus('ok')
        loadLastSync()
        setTimeout(() => setSyncStatus('idle'), 3000)
      }
      const onError = () => {
        cleanup()
        setSyncStatus('error')
        setTimeout(() => setSyncStatus('idle'), 3000)
      }
      ipc.on('sync:complete', onComplete)
      ipc.on('sync:error', onError)
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
      let s: Awaited<ReturnType<typeof getSettings>> | null = null
      try {
        s = await getSettings()
        setSettings(s ?? {} as Settings)
        setInputKey(k => k + 1)
        if (!s?.company_name && !s?.owner_name && isElectron) ipc.syncNow()
      } catch { setSettings({} as Settings) }
      try { setCategories(await getCategories()) } catch { /* ignore */ }
      try {
        const keychainKey = await platform.getKeychainValue('claude_api_key')
        const key = keychainKey || s?.claude_api_key || ''
        setClaudeKey(key)
        if (!keychainKey && key) await platform.setKeychainValue('claude_api_key', key).catch(() => {})
      } catch { /* ignore */ }
    }
    const isInputFocused = () =>
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement ||
      document.activeElement instanceof HTMLSelectElement

    const loadOnSync = async () => {
      // Skip if user has unsaved changes OR has any input focused.
      if (isDirty.current || isInputFocused()) return
      const s = await getSettings()
      // Re-check after the async fetch — user may have focused/typed during the await
      if (isDirty.current || isInputFocused()) return
      setSettings(s ?? {} as Settings)
      // Only remount inputs if DB values differ from what's currently in the DOM —
      // avoids wiping in-progress typing when a sync:complete fires.
      const changed =
        (s?.owner_name ?? '')        !== (ownerNameRef.current?.value ?? '')        ||
        (s?.owner_last_name ?? '')   !== (ownerLastNameRef.current?.value ?? '')    ||
        (s?.company_name ?? '')      !== (companyNameRef.current?.value ?? '')      ||
        (s?.work_type ?? '')         !== (workTypeRef.current?.value ?? '')         ||
        (s?.phone ?? '')             !== (phoneRef.current?.value ?? '')            ||
        (s?.phone2 ?? '')            !== (phone2Ref.current?.value ?? '')           ||
        (s?.address ?? '')           !== (addressRef.current?.value ?? '')          ||
        (s?.company_vat ?? '')       !== (vatRef.current?.value ?? '')              ||
        (s?.mydata_user_id ?? '')    !== (mydataUserIdRef.current?.value ?? '')     ||
        (s?.mydata_api_key ?? '')    !== (mydataApiKeyRef.current?.value ?? '')     ||
        (s?.bratnet_username ?? '')  !== (bratnetUsernameRef.current?.value ?? '')  ||
        (s?.bratnet_api_key ?? '')   !== (bratnetApiKeyRef.current?.value ?? '')
      if (changed) setInputKey(k => k + 1)
      try { setCategories(await getCategories()) } catch { /* ignore */ }
    }
    load()
    loadLastSync()
    if (isElectron) {
      ipc.on('sync:complete', loadOnSync)
      return () => ipc.off('sync:complete', loadOnSync)
    } else {
      window.addEventListener('sync:complete', loadOnSync)
      return () => window.removeEventListener('sync:complete', loadOnSync)
    }
  }, [])

  const save = async () => {
    if (!settings) return
    setSaveError(false)
    const str = (ref: React.RefObject<HTMLInputElement | null>) => ref.current?.value ?? ''
    const nullable = (ref: React.RefObject<HTMLInputElement | null>) => ref.current?.value || null
    try {
      await saveSettings({
        ...settings,
        owner_name:      str(ownerNameRef)     || null,
        owner_last_name: str(ownerLastNameRef)  || null,
        company_name:    str(companyNameRef)    || null,
        work_type:       str(workTypeRef)       || null,
        phone:           str(phoneRef)          || null,
        phone2:          str(phone2Ref)         || null,
        address:         str(addressRef)        || null,
        company_vat:      nullable(vatRef),
        mydata_user_id:   nullable(mydataUserIdRef),
        mydata_api_key:   nullable(mydataApiKeyRef),
        bratnet_username: nullable(bratnetUsernameRef),
        bratnet_api_key:  nullable(bratnetApiKeyRef),
        claude_api_key:   claudeKey || null,
      })
      if (claudeKey) await platform.setKeychainValue('claude_api_key', claudeKey)
      i18n.changeLanguage(settings.language)
      document.documentElement.lang = settings.language
      isDirty.current = false
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

  const update = (patch: Partial<Settings>) => { isDirty.current = true; setSettings(p => p ? { ...p, ...patch } : p) }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoError(null)
    if (!file.type.startsWith('image/')) {
      setLogoError('Επιτρέπονται μόνο εικόνες (PNG, JPG)')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('Το αρχείο υπερβαίνει τα 2MB')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = reader.result as string
      update({ company_logo: base64 })
      await saveSettings({ company_logo: base64 })
    }
    reader.readAsDataURL(file)
    // Reset input so the same file can be re-selected after removal
    e.target.value = ''
  }

  const handleLogoRemove = async () => {
    update({ company_logo: null })
    await saveSettings({ company_logo: null })
  }

  const handleSyncToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked ? 1 : 0
    await saveSettings({ sync_enabled: enabled })
    update({ sync_enabled: enabled })
    window.dispatchEvent(new Event('settings:changed'))
    if (enabled) {
      setSyncStatus('syncing')
      try {
        if (isElectron) {
          await ipc.syncEnable()
        } else {
          // On Android: if the device has no local company data (fresh install), let
          // Supabase win by removing settings from the push queue before the pull.
          // If the user has already entered data locally, keep it in the queue so
          // pendingIds protects it — Supabase's old data won't overwrite what they typed.
          const hasLocalData = !!(companyNameRef.current?.value || ownerNameRef.current?.value)
          if (!hasLocalData) {
            try { await db.run('DELETE FROM sync_queue WHERE table_name = ? AND record_id = ?', ['settings', 'main']) } catch { /* ignore */ }
          }
          await syncNow(true)
          // Re-save sync_enabled=1 after pull (Supabase may have had 0), then push
          await saveSettings({ sync_enabled: 1 })
          update({ sync_enabled: 1 })
          await syncNow()
        }
        await loadLastSync()
        setSyncStatus('ok')
        setTimeout(() => setSyncStatus('idle'), 3000)
      } catch {
        setSyncStatus('error')
        setTimeout(() => setSyncStatus('idle'), 3000)
      }
    }
  }

  const handleCheckLicense = async () => {
    setLicenseChecking(true)
    setLicenseChecked(false)
    try {
      await checkLicense()
      await refreshSubscription()
      setLicenseChecked(true)
      setTimeout(() => setLicenseChecked(false), 3000)
    } finally {
      setLicenseChecking(false)
    }
  }

  const openExternal = (url: string) => {
    if (isElectron) {
      ipc.openExternal(url)
    } else {
      window.open(url, '_blank')
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
        {/* Logo */}
        <div>
          <label className="label">{t('settings.companyLogo')}</label>
          <div className="flex items-center gap-3">
            {settings.company_logo && (
              <img
                src={settings.company_logo}
                alt="Company logo"
                className="max-h-20 max-w-40 rounded object-contain bg-surface-700 p-1"
              />
            )}
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                className="btn-secondary text-sm px-3 py-1.5"
                onClick={() => logoInputRef.current?.click()}
              >
                {t('settings.companyLogoUpload')}
              </button>
              {settings.company_logo && (
                <button
                  type="button"
                  className="text-sm text-red-400 hover:text-red-300 transition-colors text-left"
                  onClick={handleLogoRemove}
                >
                  {t('settings.companyLogoRemove')}
                </button>
              )}
              <span className="text-xs text-gray-500">{t('settings.companyLogoHint')}</span>
              {logoError && <span className="text-xs text-red-400">{logoError}</span>}
            </div>
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleLogoChange}
          />
        </div>

        <div className="flex gap-3">
          <Field label={t('settings.firstName')}>
            <input key={inputKey} ref={ownerNameRef} className="input" defaultValue={settings.owner_name ?? ''} onInput={() => { isDirty.current = true }} />
          </Field>
          <Field label={t('settings.lastName')}>
            <input key={inputKey} ref={ownerLastNameRef} className="input" defaultValue={settings.owner_last_name ?? ''} onInput={() => { isDirty.current = true }} />
          </Field>
        </div>
        <Field label={t('settings.companyName')}>
          <input key={inputKey} ref={companyNameRef} className="input" defaultValue={settings.company_name ?? ''} onInput={() => { isDirty.current = true }} />
        </Field>
        <Field label={t('settings.workType')}>
          <input key={inputKey} ref={workTypeRef} className="input" defaultValue={settings.work_type ?? ''} onInput={() => { isDirty.current = true }} placeholder="π.χ. Υδραυλικός, Ηλεκτρολόγος, Ψύξη..." />
        </Field>
        <Field label={t('settings.mobile')}>
          <input key={inputKey} ref={phoneRef} className="input" defaultValue={settings.phone ?? ''} onInput={() => { isDirty.current = true }} />
        </Field>
        <Field label={t('settings.landline')}>
          <input key={inputKey} ref={phone2Ref} className="input" defaultValue={settings.phone2 ?? ''} onInput={() => { isDirty.current = true }} />
        </Field>
        <Field label={t('settings.address')}>
          <input key={inputKey} ref={addressRef} className="input" defaultValue={settings.address ?? ''} onInput={() => { isDirty.current = true }} />
        </Field>
        <Field label={t('settings.language')}>
          <select className="input" value={settings.language} onChange={e => update({ language: e.target.value as 'el' | 'en' })}>
            <option value="el">Ελληνικά</option>
            <option value="en">English</option>
          </select>
        </Field>
      </Section>

      {/* Subscription */}
      <Section title="Συνδρομή">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Πλάνο</span>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
            tier === 'pro'   ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
            tier === 'plus'  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
            tier === 'basic' ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30' :
                               'bg-surface-600 text-gray-400 border border-surface-500'
          }`}>
            {tier === 'pro' ? 'Pro' : tier === 'plus' ? 'Plus' : tier === 'basic' ? 'Basic' : 'Free'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Κατάσταση</span>
          <span className={`text-sm font-medium ${status === 'active' ? 'text-emerald-400' : 'text-yellow-400'}`}>
            {status === 'active' ? 'Ενεργό' : status === 'expired' ? 'Ληγμένο' : status === 'cancelled' ? 'Ακυρωμένο' : 'Απαιτείται επαλήθευση'}
          </span>
        </div>
        {aiTrialActive && settings?.ai_trial_start && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">AI δοκιμή</span>
            <span className="text-sm text-brand-300">
              {Math.max(0, 14 - Math.floor((Date.now() - new Date(settings.ai_trial_start).getTime()) / 86400000))} ημέρες απομένουν
            </span>
          </div>
        )}
        {aiTrialUsed && !aiTrialActive && (
          <p className="text-xs text-gray-500">Η δοκιμή AI έχει λήξει</p>
        )}
        <div className="flex items-center justify-between pt-2 border-t border-surface-600 gap-3">
          <div className="flex gap-2">
            {(isFree || (!isPlus && !isPro)) ? (
              <button
                className="btn-primary text-sm px-4 py-2"
                onClick={() => openExternal('https://ergoflow.gr/pricing')}
              >
                Αναβάθμιση πλάνου
              </button>
            ) : (
              <button
                className="btn-secondary text-sm px-4 py-2"
                onClick={() => openExternal('https://billing.stripe.com/PLACEHOLDER')}
              >
                Διαχείριση συνδρομής
              </button>
            )}
          </div>
          <button
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-surface-700"
            onClick={handleCheckLicense}
            disabled={licenseChecking}
          >
            {licenseChecking ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                Έλεγχος...
              </span>
            ) : licenseChecked ? (
              <span className="text-emerald-400">✓ Ελέγχθηκε</span>
            ) : (
              'Ανανέωση άδειας'
            )}
          </button>
        </div>
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


      {/* App Behavior (desktop only) */}
      {isElectron && (
        <Section title={t('settings.appBehavior')}>
          <label className="flex items-center justify-between py-1 cursor-pointer">
            <div>
              <span className="text-sm text-gray-300">{t('settings.minimizeToTray')}</span>
              <p className="text-xs text-gray-500 mt-0.5">{t('settings.minimizeToTraySub')}</p>
            </div>
            <input
              type="checkbox"
              checked={!!settings.minimize_to_tray}
              onChange={async (e) => {
                const value = e.target.checked ? 1 : 0
                update({ minimize_to_tray: value })
                await saveSettings({ minimize_to_tray: value })
                ipc.setMinimizeToTray(!!value)
              }}
              className="w-4 h-4 accent-brand-500 cursor-pointer"
            />
          </label>
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

      {/* Ηλεκτρονική Τιμολόγηση (Bratnet) */}
      <Section title={t('settings.einvoicing')}>
        <p className="text-xs text-gray-500">
          Συνδεθείτε με το σύστημα ηλεκτρονικής τιμολόγησης Bratnet για αυτόματη υποβολή τιμολογίων και απόδοση ΜΑΡΚ.
        </p>
        {/* ΑΦΜ is shared with the e-invoicing provider */}
        <Field label="ΑΦΜ Εταιρείας">
          <input key={inputKey} ref={vatRef} className="input" defaultValue={settings.company_vat ?? ''} onInput={() => { isDirty.current = true }} placeholder="π.χ. 123456789" />
        </Field>
        <Field label={t('settings.bratnetUsername')}>
          <input key={inputKey} ref={bratnetUsernameRef} className="input" defaultValue={settings.bratnet_username ?? ''} onInput={() => { isDirty.current = true }} placeholder="Bratnet username" />
        </Field>
        <Field label={t('settings.bratnetApiKey')}>
          <input key={inputKey} ref={bratnetApiKeyRef} className="input font-mono text-xs" type="password" defaultValue={settings.bratnet_api_key ?? ''} onInput={() => { isDirty.current = true }} placeholder="Bratnet API key" />
        </Field>
        {/* Hidden inputs keep mydata refs mounted so the save function can still null them safely */}
        <input ref={mydataUserIdRef} type="hidden" defaultValue={settings.mydata_user_id ?? ''} />
        <input ref={mydataApiKeyRef} type="hidden" defaultValue={settings.mydata_api_key ?? ''} />
      </Section>

      {/* Cloud Sync */}
      <Section title="Συγχρονισμός">
        <p className="text-xs text-gray-500 -mt-1 mb-3">
          Συγχρονίζει τα δεδομένα σας με τους servers Ergoflow. Η εφαρμογή λειτουργεί κανονικά χωρίς internet — ο συγχρονισμός χρησιμεύει για backup και χρήση σε πολλές συσκευές.
        </p>
        <label className="flex items-center justify-between py-1 cursor-pointer">
          <div>
            <span className="text-sm text-gray-300">Αυτόματος συγχρονισμός</span>
            <p className="text-xs text-gray-500 mt-0.5">
              {settings.sync_enabled
                ? 'Τα δεδομένα συγχρονίζονται αυτόματα με τους servers Ergoflow'
                : 'Ανενεργό — τα δεδομένα υπάρχουν μόνο σε αυτή τη συσκευή'}
            </p>
          </div>
          <input
            type="checkbox"
            checked={!!settings.sync_enabled}
            onChange={handleSyncToggle}
            className="w-4 h-4 accent-brand-500 cursor-pointer"
          />
        </label>
        {!settings.sync_enabled && (
          <div className="flex items-start gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <span className="text-yellow-500 text-sm mt-0.5">⚠</span>
            <p className="text-xs text-yellow-400">Χωρίς συγχρονισμό. Αν χαθεί ή χαλάσει η συσκευή, τα δεδομένα δεν ανακτώνται.</p>
          </div>
        )}
        <div className="flex items-center justify-between pt-2 border-t border-surface-600">
          <div>
            <p className="text-sm text-gray-300">Τελευταίος συγχρονισμός</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {settings.sync_enabled
                ? (lastSyncAt ? new Date(lastSyncAt).toLocaleString('el-GR') : 'Δεν έχει γίνει ακόμη')
                : 'Ο συγχρονισμός είναι ανενεργός'}
            </p>
          </div>
          <button
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !settings.sync_enabled ? 'bg-surface-600 text-gray-500 cursor-not-allowed' :
              syncStatus === 'syncing' ? 'bg-brand-500/20 text-brand-400 cursor-not-allowed' :
              syncStatus === 'ok' ? 'bg-emerald-500/20 text-emerald-400' :
              syncStatus === 'error' ? 'bg-red-500/20 text-red-400' :
              'bg-brand-500 text-white hover:bg-brand-600'
            }`}
            disabled={!settings.sync_enabled || syncStatus === 'syncing'}
            onClick={handleSyncNow}
            title={!settings.sync_enabled ? 'Ενεργοποιήστε πρώτα τον συγχρονισμό' : undefined}
          >
            {syncStatus === 'syncing' ? 'Συγχρονισμός...' :
             syncStatus === 'ok' ? '✓ Ολοκληρώθηκε' :
             syncStatus === 'error' ? '✗ Σφάλμα' :
             'Συγχρονισμός τώρα'}
          </button>
        </div>
        {platform.isMobile && (
          <div className="pt-2 border-t border-surface-600">
            <button
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              onClick={async () => {
                await platform.clearToken().catch(() => {})
                await platform.removeKeychainValue('supabase_refresh_token').catch(() => {})
                await platform.removeKeychainValue('saved_email').catch(() => {})
                await platform.removeKeychainValue('saved_password').catch(() => {})
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
