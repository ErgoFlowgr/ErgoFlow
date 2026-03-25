import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { saveSettings, upsertCategory } from '../../lib/db'
import { uuid } from '../../lib/db'
import { isElectron, ipc } from '../../lib/electron'

const DEFAULT_CATEGORIES = [
  { name_el: 'Επισκευή',         name_en: 'Repair',              color: '#4f6ef7' },
  { name_el: 'Εγκατάσταση',      name_en: 'Installation',        color: '#22c55e' },
  { name_el: 'Ανάλυση Ανάγκης',  name_en: 'Needs Analysis',      color: '#f59e0b' },
  { name_el: 'Γεωθερμία',        name_en: 'Geothermal',          color: '#a855f7' },
  { name_el: 'Καθαρισμός',       name_en: 'Cleaning',            color: '#f97316' },
]

interface Props { onComplete: () => void }

export default function Onboarding({ onComplete }: Props) {
  const { t } = useTranslation()
  const [step, setStep]                   = useState(1)
  const [name, setName]                   = useState('')
  const [company, setCompany]             = useState('')
  const [phone, setPhone]                 = useState('')
  const [workType, setWorkType]           = useState('')
  const [selectedCats, setSelectedCats]   = useState<string[]>(DEFAULT_CATEGORIES.map(c => c.name_en))
  const [vapiKey, setVapiKey]             = useState('')
  const [aiProvider, setAiProvider]       = useState<'claude' | 'ollama'>('claude')
  const [claudeKey, setClaudeKey]         = useState('')
  const [ollamaUrl, setOllamaUrl]         = useState('http://localhost:11434')
  const [saving, setSaving]               = useState(false)

  const TOTAL_STEPS = 5

  const workTypes = [
    { key: 'heating',      label: t('onboarding.heating') },
    { key: 'electrical',   label: t('onboarding.electrical') },
    { key: 'construction', label: t('onboarding.construction') },
    { key: 'other',        label: t('onboarding.other') },
  ]

  const toggleCat = (name: string) =>
    setSelectedCats(p => p.includes(name) ? p.filter(x => x !== name) : [...p, name])

  const saveToKeychain = async (key: string, value: string) => {
    if (isElectron && value) await ipc.keychain.set(key, value)
  }

  const finish = async () => {
    setSaving(true)

    // Save API keys to keychain
    await saveToKeychain('vapi_api_key', vapiKey)
    await saveToKeychain('claude_api_key', claudeKey)
    if (aiProvider === 'ollama') await saveToKeychain('ollama_url', ollamaUrl)

    await saveSettings({
      owner_name: name,
      company_name: company,
      phone,
      work_type: workType,
      ai_provider: aiProvider,
      ollama_url: aiProvider === 'ollama' ? ollamaUrl : undefined,
      onboarding_complete: 1,
    })

    for (const cat of DEFAULT_CATEGORIES.filter(c => selectedCats.includes(c.name_en))) {
      await upsertCategory({ id: uuid(), ...cat })
    }

    onComplete()
  }

  return (
    <div className="flex items-center justify-center h-screen bg-surface-900">
      <div className="w-full max-w-md">

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(i => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'w-8 bg-brand-500' : i < step ? 'w-4 bg-brand-500/50' : 'w-4 bg-surface-600'
              }`}
            />
          ))}
        </div>

        <div className="card">

          {/* Step 1 — Contact info */}
          {step === 1 && (
            <>
              <h2 className="text-xl font-semibold mb-1">{t('onboarding.step1Title')}</h2>
              <p className="text-gray-400 text-sm mb-6">{t('onboarding.step1Sub')}</p>
              <div className="space-y-4">
                <div>
                  <label className="label">{t('onboarding.name')}</label>
                  <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Σταύρος Παναγιώτου" />
                </div>
                <div>
                  <label className="label">{t('onboarding.company')}</label>
                  <input className="input" value={company} onChange={e => setCompany(e.target.value)} placeholder="Clima Energy" />
                </div>
                <div>
                  <label className="label">{t('onboarding.phone')}</label>
                  <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+306971981206" />
                </div>
              </div>
              <button className="btn-primary w-full mt-6 justify-center" onClick={() => setStep(2)} disabled={!name}>
                {t('onboarding.continue')}
              </button>
            </>
          )}

          {/* Step 2 — Work type */}
          {step === 2 && (
            <>
              <h2 className="text-xl font-semibold mb-1">{t('onboarding.step2Title')}</h2>
              <p className="text-gray-400 text-sm mb-6">{t('onboarding.step2Sub')}</p>
              <div className="space-y-2">
                {workTypes.map(wt => (
                  <button
                    key={wt.key}
                    onClick={() => setWorkType(wt.key)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors duration-150 ${
                      workType === wt.key
                        ? 'border-brand-500 bg-brand-500/10 text-white'
                        : 'border-surface-500 text-gray-300 hover:border-brand-500/50'
                    }`}
                  >
                    {wt.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-3 mt-6">
                <button className="btn-ghost flex-1 justify-center" onClick={() => setStep(1)}>{t('onboarding.back')}</button>
                <button className="btn-primary flex-1 justify-center" onClick={() => setStep(3)} disabled={!workType}>{t('onboarding.continue')}</button>
              </div>
            </>
          )}

          {/* Step 3 — Categories */}
          {step === 3 && (
            <>
              <h2 className="text-xl font-semibold mb-1">{t('onboarding.step3Title')}</h2>
              <p className="text-gray-400 text-sm mb-6">{t('onboarding.step3Sub')}</p>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_CATEGORIES.map(cat => (
                  <button
                    key={cat.name_en}
                    onClick={() => toggleCat(cat.name_en)}
                    style={{
                      borderColor: selectedCats.includes(cat.name_en) ? cat.color : undefined,
                      backgroundColor: selectedCats.includes(cat.name_en) ? cat.color + '20' : undefined,
                    }}
                    className={`px-4 py-2 rounded-full border text-sm font-medium transition-all duration-150 ${
                      selectedCats.includes(cat.name_en) ? 'text-white' : 'border-surface-500 text-gray-400'
                    }`}
                  >
                    {cat.name_el}
                  </button>
                ))}
              </div>
              <div className="flex gap-3 mt-6">
                <button className="btn-ghost flex-1 justify-center" onClick={() => setStep(2)}>{t('onboarding.back')}</button>
                <button className="btn-primary flex-1 justify-center" onClick={() => setStep(4)} disabled={selectedCats.length === 0}>
                  {t('onboarding.continue')}
                </button>
              </div>
            </>
          )}

          {/* Step 4 — Connect VAPI */}
          {step === 4 && (
            <>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-8 h-8 bg-brand-500/20 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 8V5z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold">Connect VAPI</h2>
              </div>
              <p className="text-gray-400 text-sm mb-6">
                VAPI is your AI phone assistant. It answers calls, looks up customers, and logs everything automatically.
              </p>
              <div>
                <label className="label">VAPI API Key</label>
                <input
                  className="input font-mono text-sm"
                  type="password"
                  value={vapiKey}
                  onChange={e => setVapiKey(e.target.value)}
                  placeholder="vapi_..."
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button className="btn-ghost flex-1 justify-center" onClick={() => setStep(3)}>{t('onboarding.back')}</button>
                <button className="btn-ghost flex-1 justify-center text-gray-400" onClick={() => setStep(5)}>
                  Skip for now
                </button>
                <button className="btn-primary flex-1 justify-center" onClick={() => setStep(5)} disabled={!vapiKey}>
                  {t('onboarding.continue')}
                </button>
              </div>
            </>
          )}

          {/* Step 5 — Choose AI */}
          {step === 5 && (
            <>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-8 h-8 bg-brand-500/20 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold">Choose AI</h2>
              </div>
              <p className="text-gray-400 text-sm mb-6">
                Pick your AI assistant. Claude is cloud-based and more capable. Ollama runs locally on your machine.
              </p>

              {/* Provider cards */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                {(['claude', 'ollama'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setAiProvider(p)}
                    className={`p-4 rounded-lg border text-left transition-colors duration-150 ${
                      aiProvider === p
                        ? 'border-brand-500 bg-brand-500/10'
                        : 'border-surface-500 hover:border-brand-500/50'
                    }`}
                  >
                    <div className="font-semibold text-sm text-white capitalize">{p === 'claude' ? 'Claude' : 'Ollama'}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {p === 'claude' ? 'Cloud · Most capable' : 'Local · Private'}
                    </div>
                  </button>
                ))}
              </div>

              {aiProvider === 'claude' && (
                <div>
                  <label className="label">Claude API Key</label>
                  <input
                    className="input font-mono text-sm"
                    type="password"
                    value={claudeKey}
                    onChange={e => setClaudeKey(e.target.value)}
                    placeholder="sk-ant-..."
                  />
                </div>
              )}

              {aiProvider === 'ollama' && (
                <div>
                  <label className="label">Ollama URL</label>
                  <input
                    className="input font-mono text-sm"
                    value={ollamaUrl}
                    onChange={e => setOllamaUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                  />
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button className="btn-ghost flex-1 justify-center" onClick={() => setStep(4)}>{t('onboarding.back')}</button>
                <button
                  className="btn-primary flex-1 justify-center"
                  onClick={finish}
                  disabled={saving || (aiProvider === 'claude' && !claudeKey)}
                >
                  {saving ? '...' : t('onboarding.finish')}
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
