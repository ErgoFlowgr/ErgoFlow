import { useEffect, useRef, useState } from 'react'
import { getSupabaseConfig, isElectron, ipc } from '../../lib/electron'
import { platform } from '../../lib/platform'
import { db } from '../../lib/db-driver'

interface Props { onAuth: (isNewAccount: boolean) => void }

type Mode = 'signin' | 'signup'

export default function Auth({ onAuth }: Props) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const autoSubmitPending = useRef(false)

  useEffect(() => {
    const loadSaved = async () => {
      const savedEmail = await platform.getKeychainValue('saved_email')
      const savedPassword = await platform.getKeychainValue('saved_password')
      if (savedEmail && savedPassword) {
        setEmail(savedEmail)
        setPassword(savedPassword)
        autoSubmitPending.current = true
      }
    }
    loadSaved()
  }, [])

  // Auto-submit once saved credentials are populated into state
  useEffect(() => {
    if (autoSubmitPending.current && email && password) {
      autoSubmitPending.current = false
      signIn(email, password)
    }
  }, [email, password])

  const storeToken = async (accessToken: string, refreshToken?: string) => {
    await platform.setToken(accessToken)
    if (refreshToken) await platform.setKeychainValue('supabase_refresh_token', refreshToken)
  }

  const signIn = async (signinEmail: string, signinPassword: string) => {
    setLoading(true)
    setError('')
    try {
      const config = await getSupabaseConfig()
      if (!config) { setError('No server configuration found.'); return }

      const doFetch = () => fetch(`${config.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: config.anonKey },
        body: JSON.stringify({ email: signinEmail, password: signinPassword }),
      })

      let res: Response
      try {
        res = await doFetch()
      } catch {
        // Android WebView first-request failure — wait and retry once
        await new Promise(r => setTimeout(r, 1200))
        res = await doFetch()
      }

      const data = await res.json() as { access_token?: string; refresh_token?: string; user?: { id?: string }; error_description?: string }
      if (!res.ok) { setError(data.error_description ?? 'Sign in failed'); return }
      if (data.user?.id) await db.switch(data.user.id)
      await storeToken(data.access_token ?? '', data.refresh_token)
      await platform.setKeychainValue('saved_email', signinEmail)
      await platform.setKeychainValue('saved_password', signinPassword)
      onAuth(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Error: ${msg}`)
      console.error('[Auth] signIn error:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    setError('')
    setInfo('')
    if (mode === 'signup' && password !== confirmPassword) { setError('Passwords do not match'); return }
    if (mode === 'signin') { await signIn(email, password); return }

    // Sign up
    setLoading(true)
    try {
      const config = await getSupabaseConfig()
      if (!config) { setError('No server configuration found.'); return }
      const res = await fetch(`${config.url}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: config.anonKey },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json() as {
        access_token?: string; refresh_token?: string
        user?: { id?: string; confirmation_sent_at?: string }
        error_description?: string; msg?: string
      }
      if (!res.ok) { setError(data.error_description ?? data.msg ?? 'Sign up failed'); return }
      if (data.access_token) {
        if (data.user?.id) await db.switch(data.user.id)
        await storeToken(data.access_token, data.refresh_token)
        await platform.setKeychainValue('saved_email', email)
        await platform.setKeychainValue('saved_password', password)
        onAuth(true)
      } else {
        setInfo('Account created! Check your email to confirm, then sign in.')
        setMode('signin')
        setPassword('')
        setConfirmPassword('')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Error: ${msg}`)
      console.error('[Auth] signup error:', e)
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = email && password && (mode === 'signin' || confirmPassword) && !loading

  return (
    <div className="flex items-center justify-center h-screen bg-surface-900">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brand-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 8V5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold">Ergoflow</h1>
          <p className="text-gray-400 text-sm mt-1">
            {mode === 'signin' ? 'Sign in to continue' : 'Create your account'}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex bg-surface-700 rounded-lg p-1 mb-4">
          <button
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === 'signin' ? 'bg-surface-500 text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => { setMode('signin'); setError(''); setInfo('') }}
          >
            Sign In
          </button>
          <button
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === 'signup' ? 'bg-surface-500 text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => { setMode('signup'); setError(''); setInfo('') }}
          >
            Create Account
          </button>
        </div>

        <div className="card space-y-4">
          {info && <p className="text-green-400 text-sm">{info}</p>}

          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              onKeyDown={e => e.key === 'Enter' && canSubmit && handleSubmit()}
            />
          </div>

          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 6 characters' : ''}
              onKeyDown={e => e.key === 'Enter' && canSubmit && handleSubmit()}
            />
          </div>

          {mode === 'signup' && (
            <div>
              <label className="label">Confirm Password</label>
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && canSubmit && handleSubmit()}
              />
            </div>
          )}

          {error && <p className="text-accent-red text-sm">{error}</p>}

          <button
            className="btn-primary w-full justify-center mt-2"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {loading
              ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : mode === 'signin' ? 'Sign In' : 'Create Account'
            }
          </button>

        </div>
      </div>
    </div>
  )
}
