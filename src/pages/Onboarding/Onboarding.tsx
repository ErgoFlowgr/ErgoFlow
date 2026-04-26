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
  const [claudeKey, setClaudeKey]         = useState('')
  const [saving, setSaving]               = useState(false)

  const TOTAL_STEPS = 4

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

    await saveToKeychain('claude_api_key', claudeKey)

    await saveSettings({
      owner_name: name,
      company_name: company,
      phone,
      work_type: workType,
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
              <button className="btn-primary w-full mt-4 justify-center" onClick={() => setStep(2)} disabled={!name}>
                {t('onboarding.continue')}
              </button>
              <button className="btn-ghost w-full mt-2 justify-center text-sm text-gray-500" onClick={finish}>
                {t('onboarding.skip')}
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

          {/* Step 4 — Claude API key */}
          {step === 4 && (
            <>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-8 h-8 bg-brand-500/20 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold">{t('onboarding.step5Title')}</h2>
              </div>
              <p className="text-gray-400 text-sm mb-6">{t('onboarding.step5Sub')}</p>

              <div>
                <label className="label">{t('onboarding.claudeKey')}</label>
                <input
                  className="input font-mono text-sm"
                  type="password"
                  value={claudeKey}
                  onChange={e => setClaudeKey(e.target.value)}
                  placeholder="sk-ant-..."
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button className="btn-ghost flex-1 justify-center" onClick={() => setStep(3)}>{t('onboarding.back')}</button>
                <button
                  className="btn-primary flex-1 justify-center"
                  onClick={finish}
                  disabled={saving || !claudeKey}
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
