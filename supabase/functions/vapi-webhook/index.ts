/**
 * VAPI Webhook Edge Function
 * Receives VAPI call events and stores them in the database.
 * Protected by a shared secret in the URL query string.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WEBHOOK_SECRET    = Deno.env.get('VAPI_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async (req: Request) => {
  // ── Fail fast if misconfigured ─────────────────────────────────────────
  if (!WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SRK) {
    console.error('Missing required environment variables')
    return new Response('Service misconfigured', { status: 500 })
  }

  // ── Security: validate secret ──────────────────────────────────────────
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')

  if (secret !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SRK)

  // ── Extract call data ──────────────────────────────────────────────────
  const event    = payload.message as Record<string, unknown> | undefined
  const callData = event?.call    as Record<string, unknown> | undefined

  if (!callData) {
    return new Response('No call data', { status: 400 })
  }

  const vapiCallId     = String(callData.id ?? '')
  const vapiAssistantId = String(callData.assistantId ?? callData.assistant_id ?? '')
  const customerPhone  = extractPhone(callData)
  const status         = normalizeStatus(String(event?.type ?? ''))
  const durationSecs   = typeof callData.duration === 'number' ? callData.duration : null
  const transcript     = extractTranscript(callData)
  const summary        = extractSummary(callData)
  const recordingUrl   = String((callData.recordingUrl ?? callData.recording_url) ?? '')
  const startedAt      = callData.startedAt ?? callData.started_at ?? null
  const endedAt        = callData.endedAt   ?? callData.ended_at   ?? null

  // ── Resolve owner from assistant ID ───────────────────────────────────
  // Each Pro+ customer has their own assistant. We look up who owns this one.
  let ownerId: string | null = url.searchParams.get('owner') // fallback for legacy

  if (!ownerId && vapiAssistantId) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('vapi_assistant_id', vapiAssistantId)
      .maybeSingle()
    ownerId = sub?.user_id ?? null
  }

  if (!ownerId) {
    console.error('Could not resolve owner for assistant:', vapiAssistantId)
    return new Response('Cannot resolve owner', { status: 400 })
  }

  // ── Track VAPI minutes used ────────────────────────────────────────────
  if (vapiAssistantId && durationSecs && status === 'completed') {
    const minutesUsed = Math.ceil(durationSecs / 60)
    // Increment minutes_used; also check if over limit
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, vapi_minutes_used')
      .eq('user_id', ownerId)
      .maybeSingle()

    if (sub) {
      const newTotal = (sub.vapi_minutes_used ?? 0) + minutesUsed
      await supabase.from('subscriptions').update({
        vapi_minutes_used: newTotal,
        updated_at: new Date().toISOString(),
      }).eq('id', sub.id)

      // Hard cap: disable assistant at 100 minutes
      if (newTotal >= 100) {
        await disableVapiAssistant(vapiAssistantId)
        console.log(`User ${ownerId} hit 100 min cap — assistant disabled`)
      }
      // Warning: log at 80 minutes (in-app warning handled client-side via subscription fetch)
      else if (newTotal >= 80) {
        console.log(`User ${ownerId} at ${newTotal} min — warning threshold reached`)
      }
    }
  }

  // ── Look up or create customer ─────────────────────────────────────────
  let customerId: string | null = null
  let customerName: string | null = null

  if (customerPhone) {
    const { data: existing } = await supabase
      .from('customers')
      .select('id, name')
      .eq('owner_id', ownerId)
      .eq('phone', customerPhone)
      .maybeSingle()

    if (existing) {
      customerId   = existing.id
      customerName = existing.name
    } else {
      // Create a minimal customer record
      const newId = crypto.randomUUID()
      customerName = customerPhone
      await supabase.from('customers').insert({
        id: newId,
        owner_id: ownerId,
        name: customerPhone,
        phone: customerPhone,
      })
      customerId = newId
    }
  }

  // ── Insert call record ─────────────────────────────────────────────────
  const callId = crypto.randomUUID()
  const { error } = await supabase.from('calls').upsert({
    id: callId,
    owner_id: ownerId,
    vapi_call_id: vapiCallId,
    customer_id: customerId,
    customer_phone: customerPhone,
    customer_name: customerName,
    direction: 'inbound',
    status,
    duration_seconds: durationSecs,
    transcript,
    summary,
    recording_url: recordingUrl || null,
    started_at: startedAt,
    ended_at: endedAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'vapi_call_id' })

  if (error) {
    console.error('DB error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true, callId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

// ── Helpers ────────────────────────────────────────────────────────────────

function extractPhone(call: Record<string, unknown>): string | null {
  const customer = call.customer as Record<string, unknown> | undefined
  return String(customer?.number ?? customer?.phone ?? call.phoneNumber ?? call.phone_number ?? '') || null
}

function normalizeStatus(eventType: string): string {
  if (eventType.includes('ended'))      return 'completed'
  if (eventType.includes('missed'))     return 'missed'
  if (eventType.includes('in-progress')) return 'in-progress'
  return 'completed'
}

function extractTranscript(call: Record<string, unknown>): string | null {
  const messages = call.messages as Array<Record<string, unknown>> | undefined
  if (!messages?.length) return null
  return messages.map(m => `${m.role}: ${m.message ?? m.content}`).join('\n')
}

function extractSummary(call: Record<string, unknown>): string | null {
  const analysis = call.analysis as Record<string, unknown> | undefined
  return String(analysis?.summary ?? call.summary ?? '') || null
}

async function disableVapiAssistant(assistantId: string): Promise<void> {
  try {
    const apiKey = Deno.env.get('VAPI_API_KEY') ?? ''
    if (!apiKey) return
    // Set the assistant to reject all calls by clearing its phone number association
    await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      method: 'PATCH',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isServerUrlSecret: true, silenceTimeoutSeconds: 0 }),
    })
  } catch (err) {
    console.error('Failed to disable assistant:', err)
  }
}
