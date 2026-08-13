/**
 * Claude Proxy Edge Function
 * Proxies Claude API calls server-side so ANTHROPIC_API_KEY never reaches the client.
 * Requires a valid Supabase user JWT with an active AI-enabled subscription or AI trial.
 * Enforces backend monthly/fair-use AI Helper limits before forwarding to Anthropic.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

const TRIAL_AI_ACTION_LIMIT = 50
const TIER_AI_ACTION_LIMITS: Record<string, number> = {
  free:  0,
  basic: 50,
  plus:  1000,
  pro:   1000,
}

type ClaudeRequest = {
  messages: unknown
  system?: string
  model?: string
  max_tokens?: number
}

type AnthropicResponse = {
  content?: Array<{ text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
  id?: string
}

const usagePeriod = (date = new Date()): string => date.toISOString().slice(0, 7)

const textSize = (value: unknown): number => {
  try { return JSON.stringify(value).length } catch { return 0 }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS })
  }

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SRK) {
    console.error('Claude proxy misconfigured')
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

  // ── Parse request before consuming a billable AI action ───────────────────
  let body: ClaudeRequest
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS })
  }

  // ── Check subscription and monthly/fair-use limit ─────────────────────────
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tier, status, ai_trial_start')
    .eq('user_id', user.id)
    .maybeSingle()

  const tier        = sub?.tier   ?? 'free'
  const status      = sub?.status ?? 'inactive'
  const trialStart  = sub?.ai_trial_start ? new Date(sub.ai_trial_start) : null
  const trialActive = trialStart != null && (Date.now() - trialStart.getTime()) < 14 * 24 * 60 * 60 * 1000
  const paidLimit   = status === 'active' ? (TIER_AI_ACTION_LIMITS[tier] ?? 0) : 0
  const actionLimit = Math.max(paidLimit, trialActive ? TRIAL_AI_ACTION_LIMIT : 0)

  if (actionLimit <= 0) {
    return new Response(
      JSON.stringify({ error: 'upgrade_required' }),
      { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }

  const period = usagePeriod()
  const { data: usage, error: usageErr } = await supabase.rpc('consume_ai_action', {
    p_user_id: user.id,
    p_period:  period,
    p_limit:   actionLimit,
  }).single()

  if (usageErr) {
    console.error('AI usage limit check failed', usageErr)
    return new Response('Usage limit check failed', { status: 500, headers: CORS_HEADERS })
  }

  if (!usage?.allowed) {
    return new Response(
      JSON.stringify({
        error: 'ai_limit_reached',
        action_count: usage?.action_count ?? actionLimit,
        action_limit: actionLimit,
        period,
      }),
      { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }

  // ── Forward request ───────────────────────────────────────────────────────
  const model = body.model ?? 'claude-sonnet-4-6'
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: body.max_tokens ?? 1024,
      system:     body.system,
      messages:   body.messages,
    }),
  })

  const resText = await anthropicRes.text()

  if (anthropicRes.ok) {
    let parsed: AnthropicResponse | null = null
    try { parsed = JSON.parse(resText) as AnthropicResponse } catch { parsed = null }

    const inputTokens  = parsed?.usage?.input_tokens ?? 0
    const outputTokens = parsed?.usage?.output_tokens ?? 0
    const outputChars  = parsed?.content?.map(c => c.text ?? '').join('\n').length ?? 0

    const { error: eventErr } = await supabase.from('ai_usage_events').insert({
      user_id:       user.id,
      period,
      event_type:    'claude_proxy',
      model,
      input_chars:   textSize({ system: body.system, messages: body.messages }),
      output_chars:  outputChars,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      request_id:    parsed?.id ?? null,
    })
    if (eventErr) console.error('AI usage event insert failed', eventErr)

    const { error: monthlyErr } = await supabase.rpc('add_ai_usage_tokens', {
      p_user_id:       user.id,
      p_period:        period,
      p_input_tokens:  inputTokens,
      p_output_tokens: outputTokens,
      p_model:         model,
    })
    if (monthlyErr) console.error('AI usage monthly token update failed', monthlyErr)
  }

  return new Response(resText, {
    status:  anthropicRes.status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type':      'application/json',
      'X-AI-Usage-Period': period,
      'X-AI-Action-Count': String(usage.action_count),
      'X-AI-Action-Limit': String(actionLimit),
    },
  })
})
