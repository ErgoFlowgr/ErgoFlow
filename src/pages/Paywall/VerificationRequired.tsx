import { useState } from 'react'

interface Props { onRetry: () => Promise<void> }

export default function VerificationRequired({ onRetry }: Props) {
  const [loading, setLoading] = useState(false)

  const handleRetry = async () => {
    setLoading(true)
    try { await onRetry() } finally { setLoading(false) }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-surface-900">
      <div className="w-full max-w-sm card text-center">
        <div className="w-14 h-14 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
          </svg>
        </div>

        <h2 className="text-xl font-semibold text-white mb-2">Απαιτείται σύνδεση</h2>
        <p className="text-gray-400 text-sm mb-6">
          Η άδεια χρήσης επαληθεύεται κάθε 30 ημέρες. Συνδεθείτε στο διαδίκτυο και πατήστε Επανέλεγχος.
        </p>

        <button
          onClick={handleRetry}
          disabled={loading}
          className="btn-primary w-full justify-center"
        >
          {loading ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
          ) : 'Επανέλεγχος'}
        </button>
      </div>
    </div>
  )
}
