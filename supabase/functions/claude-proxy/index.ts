/**
 * Claude Proxy Edge Function
 * Proxies Claude API calls server-side so ANTHROPIC_API_KEY never reaches the client.
 * Requires a valid Supabase user JWT with an active Plus/Pro subscription or AI trial.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS })
  }

  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not configured')
    return new Response('Service misconfigured', { status: 500, headers: CORS_HEADERS })
  }

  // ── Authenticate user ────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS })
  }
  const token = authHeader.slice(7)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SRK)
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS })
  }

  // ── Check subscription ────────────────────────────────────────────────────
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tier, status, ai_trial_start')
    .eq('user_id', user.id)
    .maybeSingle()

  const tier         = sub?.tier   ?? 'free'
  const status       = sub?.status ?? 'active'
  const canPaid      = ['plus', 'pro'].includes(tier) && status === 'active'
  const trialStart   = sub?.ai_trial_start ? new Date(sub.ai_trial_start) : null
  const trialActive  = trialStart != null && (Date.now() - trialStart.getTime()) < 14 * 24 * 60 * 60 * 1000
  const canUseAI     = canPaid || trialActive

  if (!canUseAI) {
    return new Response(
      JSON.stringify({ error: 'upgrade_required' }),
      { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }

  // ── Parse and forward request ─────────────────────────────────────────────
  let body: { messages: unknown; system?: string; model?: string; max_tokens?: number }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS })
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      body.model      ?? 'claude-sonnet-4-6',
      max_tokens: body.max_tokens ?? 1024,
      system:     body.system,
      messages:   body.messages,
    }),
  })

  const resText = await res.text()
  return new Response(resText, {
    status:  res.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
})
