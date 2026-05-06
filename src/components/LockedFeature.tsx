import { useSubscription } from '../App'

interface Props {
  requiredTier: 'plus' | 'pro'
  children: React.ReactNode
}

const TIER_LABELS: Record<string, string> = {
  plus: 'Plus (€69/μήνα)',
  pro:  'Pro (€130/μήνα)',
}

export default function LockedFeature({ requiredTier, children }: Props) {
  const { tier, status } = useSubscription()

  // Trial and trial-tier users get full access
  if (status === 'trial' || tier === 'trial') return <>{children}</>

  const tiers = ['free', 'basic', 'plus', 'pro']
  const userLevel     = tiers.indexOf(tier)
  const requiredLevel = tiers.indexOf(requiredTier)

  if (userLevel >= requiredLevel) return <>{children}</>

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-8">
      <div className="w-14 h-14 bg-surface-700 rounded-2xl flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold mb-2">Απαιτείται αναβάθμιση</h2>
      <p className="text-gray-400 text-sm mb-6 max-w-xs">
        {tier === 'free'
          ? <>Είστε στο δωρεάν πλάνο. Αναβαθμίστε στο <span className="text-white font-medium">{TIER_LABELS[requiredTier]}</span> για πρόσβαση σε αυτή τη λειτουργία.</>
          : <>Αυτή η λειτουργία είναι διαθέσιμη στο πλάνο <span className="text-white font-medium">{TIER_LABELS[requiredTier]}</span>.</>
        }
      </p>
      <a
        href="https://ergoflow.gr/pricing"
        className="btn-primary px-6"
        onClick={e => { e.preventDefault(); window.electron?.openExternal('https://ergoflow.gr/pricing') }}
      >
        Αναβάθμιση τώρα
      </a>
    </div>
  )
}
