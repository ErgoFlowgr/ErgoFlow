/**
 * VAPI Provision Edge Function
 * Called when a customer activates Pro.
 * Clones the Gianna template assistant and assigns a phone number.
 *
 * Required env vars:
 *   VAPI_API_KEY              — Stavros's VAPI account API key
 *   VAPI_TEMPLATE_ASSISTANT   — ID of the Gianna template assistant to clone
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPI_API_KEY            = Deno.env.get('VAPI_API_KEY') ?? ''
const VAPI_TEMPLATE_ASSISTANT = Deno.env.get('VAPI_TEMPLATE_ASSISTANT') ?? ''
const SUPABASE_URL            = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK            = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_API_KEY       = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const VAPI_BASE = 'https://api.vapi.ai'

Deno.serve(async (req: Request) => {
  if (!VAPI_API_KEY || !VAPI_TEMPLATE_ASSISTANT || !SUPABASE_URL || !SUPABASE_SRK) {
    console.error('Missing required environment variables')
    return new Response('Service misconfigured', { status: 500 })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Only callable by service role (from stripe-webhook)
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: { user_id: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { user_id } = body
  if (!user_id) {
    return new Response('Missing user_id', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SRK)

  // Check if already provisioned
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, vapi_assistant_id')
    .eq('user_id', user_id)
    .maybeSingle()

  if (sub?.vapi_assistant_id) {
    console.log('Already provisioned for user:', user_id)
    return new Response(JSON.stringify({ ok: true, already_provisioned: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── 1. Fetch customer's company name from settings ────────────────────
  const { data: settingsRow } = await supabase
    .from('settings')
    .select('company_name, owner_name')
    .eq('owner_id', user_id)
    .maybeSingle()

  const rawName = settingsRow?.company_name ?? settingsRow?.owner_name ?? ''
  const companyName = rawName ? await transliterateToGreek(rawName) : 'την εταιρεία σας'

  // ── 2. Fetch template assistant ────────────────────────────────────────
  const templateRes = await fetch(`${VAPI_BASE}/assistant/${VAPI_TEMPLATE_ASSISTANT}`, {
    headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
  })

  if (!templateRes.ok) {
    const err = await templateRes.text()
    console.error('Failed to fetch template assistant:', err)
    return new Response('Failed to fetch template', { status: 502 })
  }

  const template = await templateRes.json() as Record<string, unknown>

  // ── 3. Clone the assistant for this customer ───────────────────────────
  // Strip VAPI-managed fields, keep everything else (model, voice, tools, system prompt)
  const { id: _id, orgId: _orgId, createdAt: _c, updatedAt: _u, ...assistantConfig } = template as Record<string, unknown>

  // Inject company name into system prompt
  const configWithCompany = injectCompanyName(assistantConfig, companyName)

  // Update the server URL in tools to route to this user's vapi-tools endpoint
  const clonedConfig = updateToolUrls(configWithCompany, user_id)

  const cloneRes = await fetch(`${VAPI_BASE}/assistant`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(clonedConfig),
  })

  if (!cloneRes.ok) {
    const err = await cloneRes.text()
    console.error('Failed to clone assistant:', err)
    return new Response('Failed to create assistant', { status: 502 })
  }

  const cloned = await cloneRes.json() as Record<string, unknown>
  const assistantId = String(cloned.id ?? '')

  // ── 3. Buy a phone number and assign it to the new assistant ──────────
  const inboundSecret  = Deno.env.get('VAPI_WEBHOOK_SECRET') ?? ''
  const inboundUrl     = `${SUPABASE_URL}/functions/v1/vapi-inbound?secret=${inboundSecret}`

  const phoneRes = await fetch(`${VAPI_BASE}/phone-number`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider:  'twilio',
      areaCode:  '30',
      serverUrl: inboundUrl,  // routes to vapi-inbound for pre-call caller lookup
    }),
  })

  let phoneNumber: string | null = null

  if (phoneRes.ok) {
    const phoneData = await phoneRes.json() as Record<string, unknown>
    phoneNumber = String(phoneData.number ?? phoneData.phoneNumber ?? '') || null
  } else {
    // Phone provisioning failed — log but don't fail the whole operation
    // Support can manually assign a number later
    console.error('Phone provisioning failed:', await phoneRes.text())
  }

  // ── 4. Save to Supabase ────────────────────────────────────────────────
  const { error } = await supabase
    .from('subscriptions')
    .update({
      vapi_assistant_id:  assistantId,
      vapi_phone_number:  phoneNumber,
      updated_at:         new Date().toISOString(),
    })
    .eq('user_id', user_id)

  if (error) {
    console.error('Failed to save vapi_assistant_id:', error)
    return new Response('DB error', { status: 500 })
  }

  console.log(`Provisioned assistant ${assistantId} for user ${user_id}, phone: ${phoneNumber}`)

  return new Response(JSON.stringify({ ok: true, assistantId, phoneNumber }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Transliterate a company name to Greek phonetics using Claude.
 * e.g. "Clima Energy" → "Κλίμα Ένερτζι"
 * Falls back to the original name if the API call fails.
 */
async function transliterateToGreek(name: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) return name
  // If already all Greek, return as-is
  if (/^[\u0370-\u03FF\s]+$/.test(name)) return name

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [{
          role:    'user',
          content: `Transliterate this company name to Greek phonetics so it sounds natural when spoken aloud in Greek. Return ONLY the transliterated name, nothing else.\n\n"${name}"`,
        }],
      }),
    })

    if (!res.ok) return name
    const data = await res.json() as { content: Array<{ text: string }> }
    const result = data.content?.[0]?.text?.trim()
    return result || name
  } catch {
    return name
  }
}

/**
 * Replace "ERGOFLOW" in the system prompt with the customer's actual company name.
 */
function injectCompanyName(
  config: Record<string, unknown>,
  companyName: string,
): Record<string, unknown> {
  const model = config.model as Record<string, unknown> | undefined
  if (!model?.systemPrompt) return config

  const updatedPrompt = (model.systemPrompt as string).replace(/ERGOFLOW/g, companyName)

  return {
    ...config,
    model: { ...model, systemPrompt: updatedPrompt },
  }
}

/**
 * Update tool server URLs in the cloned assistant config to point to this user.
 * Each tool's server.url should include the owner param for the vapi-tools function.
 */
function updateToolUrls(
  config: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  const model = config.model as Record<string, unknown> | undefined
  if (!model) return config

  const tools = model.tools as Array<Record<string, unknown>> | undefined
  if (!tools?.length) return config

  const baseUrl = `${SUPABASE_URL}/functions/v1/vapi-tools`
  const secret  = Deno.env.get('VAPI_WEBHOOK_SECRET') ?? ''

  const updatedTools = tools.map((tool) => {
    const server = tool.server as Record<string, unknown> | undefined
    if (!server) return tool
    return {
      ...tool,
      server: {
        ...server,
        url: `${baseUrl}?secret=${secret}&owner=${userId}`,
      },
    }
  })

  return {
    ...config,
    model: { ...model, tools: updatedTools },
  }
}
