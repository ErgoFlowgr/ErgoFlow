import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n/i18n'
import { getSettings, saveSettings, getCategories, upsertCategory, deleteCategory, type Settings, type Category, uuid } from '../../lib/db'
import { ipc } from '../../lib/electron'

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
  const [vapiKey, setVapiKey] = useState('')
  const [claudeKey, setClaudeKey] = useState('')
  const [newCatEl, setNewCatEl] = useState('')
  const [newCatEn, setNewCatEn] = useState('')
  const [newCatColor, setNewCatColor] = useState('#4f6ef7')
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaLoading, setOllamaLoading] = useState(false)

  useEffect(() => {
    getSettings().then(s => setSettings(s))
    getCategories().then(setCategories)
    ipc.keychain.get('vapi_api_key').then(v => setVapiKey(v ?? ''))
    ipc.keychain.get('claude_api_key').then(v => setClaudeKey(v ?? ''))
  }, [])

  const fetchOllamaModels = async (baseUrl: string) => {
    setOllamaLoading(true)
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`)
      if (!res.ok) { setOllamaModels([]); return }
      const data = await res.json() as { models?: Array<{ name: string }> }
      setOllamaModels((data.models ?? []).map(m => m.name))
    } catch {
      setOllamaModels([])
    } finally {
      setOllamaLoading(false)
    }
  }

  useEffect(() => {
    if (settings?.ai_provider === 'ollama') {
      fetchOllamaModels(settings.ollama_url ?? 'http://localhost:11434')
    }
  }, [settings?.ai_provider, settings?.ollama_url])

  const save = async () => {
    if (!settings) return
    // Save to settings table — also syncs claude_api_key to Supabase for Android
    await saveSettings({ ...settings, claude_api_key: claudeKey || null })
    if (vapiKey)    await ipc.keychain.set('vapi_api_key', vapiKey)
    if (claudeKey)  await ipc.keychain.set('claude_api_key', claudeKey)
    i18n.changeLanguage(settings.language)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const addCategory = async () => {
    if (!newCatEl || !newCatEn) return
    await upsertCategory({ id: uuid(), name_el: newCatEl, name_en: newCatEn, color: newCatColor })
    setCategories(await getCategories())
    setNewCatEl(''); setNewCatEn('')
  }

  const delCategory = async (id: string) => {
    await deleteCategory(id)
    setCategories(await getCategories())
  }

  if (!settings) return null

  const update = (patch: Partial<Settings>) => setSettings(p => p ? { ...p, ...patch } : p)

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5 pb-24">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>

      {/* Company */}
      <Section title={t('settings.company')}>
        <div className="flex gap-3">
          <Field label="Όνομα / First Name">
            <input className="input" value={settings.owner_name ?? ''} onChange={e => update({ owner_name: e.target.value })} />
          </Field>
          <Field label="Επώνυμο / Last Name">
            <input className="input" value={settings.owner_last_name ?? ''} onChange={e => update({ owner_last_name: e.target.value })} />
          </Field>
        </div>
        <Field label={t('settings.companyName')}>
          <input className="input" value={settings.company_name ?? ''} onChange={e => update({ company_name: e.target.value })} />
        </Field>
        <Field label="Τύπος Επιχείρησης / Business Type">
          <input className="input" value={settings.work_type ?? ''} onChange={e => update({ work_type: e.target.value })} placeholder="e.g. HVAC, Plumber, Electrician..." />
        </Field>
        <Field label="Κινητό / Mobile">
          <input className="input" value={settings.phone ?? ''} onChange={e => update({ phone: e.target.value })} />
        </Field>
        <Field label="Σταθερό / Landline">
          <input className="input" value={settings.phone2 ?? ''} onChange={e => update({ phone2: e.target.value })} />
        </Field>
        <Field label="Διεύθυνση / Address">
          <input className="input" value={settings.address ?? ''} onChange={e => update({ address: e.target.value })} />
        </Field>
        <Field label={t('settings.language')}>
          <select className="input" value={settings.language} onChange={e => update({ language: e.target.value as 'el' | 'en' })}>
            <option value="el">Ελληνικά</option>
            <option value="en">English</option>
          </select>
        </Field>
      </Section>

      {/* VAPI */}
      <Section title={t('settings.vapi')}>
        <Field label={t('settings.vapiKey')}>
          <input className="input font-mono text-xs" type="password" value={vapiKey} onChange={e => setVapiKey(e.target.value)} placeholder="vapi_..." />
        </Field>
        <button className="text-xs text-brand-500 hover:underline" onClick={() => ipc.openExternal('https://vapi.ai')}>
          {t('settings.vapiLearn')} →
        </button>
      </Section>

      {/* AI */}
      <Section title={t('settings.ai')}>
        <Field label={t('settings.ai')}>
          <div className="flex gap-3">
            {(['claude', 'ollama'] as const).map(p => (
              <button
                key={p}
                onClick={() => update({ ai_provider: p })}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  settings.ai_provider === p
                    ? 'border-brand-500 bg-brand-500/10 text-white'
                    : 'border-surface-500 text-gray-400 hover:border-brand-500/50'
                }`}
              >
                {p === 'claude' ? 'Cloud AI (API Key)' : 'Ollama (Local)'}
              </button>
            ))}
          </div>
        </Field>
        {settings.ai_provider === 'claude' ? (
          <Field label="API Key">
            <input className="input font-mono text-xs" type="password" value={claudeKey} onChange={e => setClaudeKey(e.target.value)} placeholder="sk-ant-... / sk-..." />
          </Field>
        ) : (
          <>
            <Field label={t('settings.ollamaUrl')}>
              <div className="flex gap-2">
                <input className="input font-mono text-xs flex-1" value={settings.ollama_url} onChange={e => update({ ollama_url: e.target.value })} />
                <button
                  className="btn-secondary text-xs px-3"
                  onClick={() => fetchOllamaModels(settings.ollama_url ?? 'http://localhost:11434')}
                  disabled={ollamaLoading}
                >
                  {ollamaLoading ? '...' : 'Refresh'}
                </button>
              </div>
            </Field>
            {ollamaModels.length === 0 && !ollamaLoading && (
              <p className="text-xs text-yellow-500">Ollama not reachable — enter model names manually or start Ollama and click Refresh.</p>
            )}
            {(['ollama_chat_model', 'ollama_embed_model'] as const).map((field, i) => {
              const labels = ['Chat Model', 'Embed Model (PDF search)']
              const placeholders = ['qwen2.5:latest', 'nomic-embed-text']
              const val = settings[field] ?? ''
              return (
                <Field key={field} label={labels[i]}>
                  {ollamaModels.length > 0 ? (
                    <select className="input font-mono text-xs" value={val} onChange={e => update({ [field]: e.target.value })}>
                      {!val && <option value="">— select model —</option>}
                      {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
                      {val && !ollamaModels.includes(val) && <option value={val}>{val} (saved)</option>}
                    </select>
                  ) : (
                    <input className="input font-mono text-xs" value={val} onChange={e => update({ [field]: e.target.value })} placeholder={placeholders[i]} />
                  )}
                </Field>
              )
            })}
          </>
        )}
      </Section>

      {/* Web Search */}
      <Section title="Αναζήτηση Web / Web Search">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Επιτρέπεται αναζήτηση / Allow web search</p>
            <p className="text-xs text-gray-500 mt-0.5">Ο AI θα μπορεί να αναζητά πληροφορίες στο διαδίκτυο</p>
          </div>
          <button
            onClick={() => update({ allow_web_search: settings.allow_web_search ? 0 : 1 })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.allow_web_search ? 'bg-brand-500' : 'bg-surface-500'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.allow_web_search ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {!!settings.allow_web_search && (
          <Field label="Brave Search API Key">
            <input className="input font-mono text-xs" type="password" value={settings.brave_search_key ?? ''} onChange={e => update({ brave_search_key: e.target.value })} placeholder="BSA..." />
            <p className="text-xs text-gray-500 mt-1">$5 δωρεάν credits/μήνα · Εγγραφή στο <span className="text-brand-400">brave.com/search/api</span></p>
          </Field>
        )}
      </Section>

      {/* Categories */}
      <Section title={t('settings.categories')}>
        <div className="flex flex-wrap gap-2 mb-3">
          {categories.map(cat => (
            <div key={cat.id} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium" style={{ backgroundColor: cat.color + '20', borderColor: cat.color, border: '1px solid' }}>
              <span style={{ color: cat.color }}>{cat.name_el}</span>
              <button onClick={() => delCategory(cat.id)} className="text-gray-500 hover:text-white transition-colors ml-1">×</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <input className="input" placeholder="Ελληνικά" value={newCatEl} onChange={e => setNewCatEl(e.target.value)} />
          </div>
          <div className="flex-1">
            <input className="input" placeholder="English" value={newCatEn} onChange={e => setNewCatEn(e.target.value)} />
          </div>
          <input type="color" value={newCatColor} onChange={e => setNewCatColor(e.target.value)} className="h-9 w-9 rounded cursor-pointer bg-transparent border-0" />
          <button className="btn-secondary whitespace-nowrap" onClick={addCategory}>{t('settings.addCategory')}</button>
        </div>
      </Section>

      {/* Save bar */}
      <div className="fixed bottom-0 left-56 right-0 p-4 bg-surface-800 border-t border-surface-600 flex justify-end">
        <button className="btn-primary min-w-24 justify-center" onClick={save}>
          {saved ? `✓ ${t('settings.saved')}` : t('settings.save')}
        </button>
      </div>
    </div>
  )
}
