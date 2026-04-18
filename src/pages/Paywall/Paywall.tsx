import { ipc } from '../../lib/electron'

// Stripe payment link — replace with the actual URL after Stripe is configured
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/PLACEHOLDER'

interface PaywallProps {
  onRefresh: () => void
}

export default function Paywall({ onRefresh }: PaywallProps) {
  const handleSubscribe = () => {
    ipc.openExternal(STRIPE_PAYMENT_LINK)
  }

  return (
    <div className="flex items-center justify-center h-screen bg-surface-900">
      <div className="bg-surface-800 border border-surface-600 rounded-2xl p-10 max-w-md w-full text-center shadow-2xl">
        {/* Icon */}
        <div className="w-16 h-16 rounded-full bg-brand-500/10 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">Η δοκιμαστική περίοδος έληξε</h1>
        <p className="text-gray-400 text-sm mb-6">
          Για να συνεχίσετε να χρησιμοποιείτε το Ergoflow, απαιτείται ενεργή συνδρομή.
        </p>

        {/* Price */}
        <div className="bg-surface-700 rounded-xl p-5 mb-6">
          <p className="text-gray-400 text-sm mb-1">Συνδρομή</p>
          <p className="text-3xl font-bold text-white">29€<span className="text-base font-normal text-gray-400">/μήνα</span></p>
          <p className="text-xs text-gray-500 mt-2">Ακύρωση οποιαδήποτε στιγμή</p>
        </div>

        {/* Subscribe button */}
        <button
          onClick={handleSubscribe}
          className="w-full py-3 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl transition-colors mb-4"
        >
          Εγγραφή
        </button>

        {/* Already subscribed */}
        <button
          onClick={onRefresh}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors underline"
        >
          Έχετε ήδη εγγραφεί; Κάντε κλικ εδώ για ανανέωση άδειας
        </button>
      </div>
    </div>
  )
}
