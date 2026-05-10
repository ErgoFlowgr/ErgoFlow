import { ipc, isElectron } from '../../lib/electron'

const STRIPE_BASIC_URL = 'https://buy.stripe.com/test_fZubJ1cYYbA3asZ5MH4Rq00'
const STRIPE_PLUS_URL  = 'https://buy.stripe.com/test_28EbJ1aQQ47BcB7ejd4Rq01'

interface PaywallProps {
  onRefresh: () => void
  userId: string
}

function openUrl(url: string) {
  if (isElectron) ipc.openExternal(url)
  else window.open(url, '_blank')
}

interface TierCardProps {
  name: string
  price: string
  priceNote?: string
  features: string[]
  buttonLabel?: string
  onBuy?: () => void
  highlight?: boolean
  badge?: string
  disabled?: boolean
}

function TierCard({ name, price, priceNote, features, buttonLabel, onBuy, highlight, badge, disabled }: TierCardProps) {
  return (
    <div className={`relative flex flex-col rounded-2xl p-6 border transition-all ${
      highlight
        ? 'bg-brand-500/10 border-brand-500 shadow-lg shadow-brand-500/10'
        : disabled
          ? 'bg-surface-800 border-surface-700 opacity-60'
          : 'bg-surface-800 border-surface-600'
    }`}>
      {badge && (
        <span className="absolute top-4 right-4 text-xs font-semibold bg-surface-600 text-gray-300 px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
      <div className="mb-4">
        <h2 className={`text-lg font-bold ${highlight ? 'text-brand-400' : 'text-white'}`}>{name}</h2>
        <div className="mt-2 flex items-end gap-1">
          <span className="text-3xl font-bold text-white">{price}</span>
          {priceNote && <span className="text-gray-400 text-sm mb-0.5">{priceNote}</span>}
        </div>
      </div>
      <ul className="flex-1 space-y-2 mb-6">
        {features.map(f => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
            <svg className={`w-4 h-4 mt-0.5 shrink-0 ${highlight ? 'text-brand-400' : disabled ? 'text-gray-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {f}
          </li>
        ))}
      </ul>
      {!disabled && onBuy && buttonLabel && (
        <button
          onClick={onBuy}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors ${
            highlight
              ? 'bg-brand-500 hover:bg-brand-600 text-white'
              : 'bg-surface-700 hover:bg-surface-600 text-white border border-surface-500'
          }`}
        >
          {buttonLabel}
        </button>
      )}
    </div>
  )
}

export default function Paywall({ onRefresh, userId }: PaywallProps) {
  const handleBuy = (baseUrl: string) => {
    const url = userId ? `${baseUrl}?client_reference_id=${userId}` : baseUrl
    console.log('[Paywall] opening URL:', url, '| userId:', userId)
    openUrl(url)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-surface-900 p-6">
      {/* Header */}
      <div className="text-center mb-10 max-w-md">
        <div className="w-14 h-14 rounded-full bg-brand-500/10 flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Επιλέξτε το πλάνο σας</h1>
        <p className="text-gray-400 text-sm">Η συνδρομή σας έληξε</p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl">
        <TierCard
          name="Basic"
          price="€19"
          priceNote="/μήνα"
          features={[
            'Απεριόριστα τιμολόγια',
            'Πλήρες CRM',
            'myDATA / e-τιμολόγηση',
          ]}
          buttonLabel="Επιλογή Basic"
          onBuy={() => handleBuy(STRIPE_BASIC_URL)}
        />
        <TierCard
          name="Plus"
          price="€39"
          priceNote="/μήνα"
          features={[
            'Όλα του Basic',
            'AI βοηθός (γνωρίζει την επιχείρησή σας)',
            'Προτεραιότητα υποστήριξης',
          ]}
          buttonLabel="Επιλογή Plus"
          onBuy={() => handleBuy(STRIPE_PLUS_URL)}
          highlight
        />
        <TierCard
          name="Pro"
          price="Σύντομα"
          features={[
            'Όλα του Plus',
            'Αυτόματες κλήσεις VAPI',
            'Απομαγνητοφώνηση κλήσεων',
          ]}
          badge="Σύντομα"
          disabled
        />
      </div>

      {/* Already subscribed */}
      <button
        onClick={onRefresh}
        className="mt-8 text-xs text-gray-500 hover:text-gray-300 transition-colors underline"
      >
        Έχετε ήδη εγγραφεί; Κάντε κλικ εδώ
      </button>
    </div>
  )
}
