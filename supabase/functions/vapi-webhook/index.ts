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

  const vapiCallId    = String(callData.id ?? '')
  const customerPhone = extractPhone(callData)
  const status        = normalizeStatus(String(event?.type ?? ''))
  const durationSecs  = typeof callData.duration === 'number' ? callData.duration : null
  const transcript    = extractTranscript(callData)
  const summary       = extractSummary(callData)
  const recordingUrl  = String((callData.recordingUrl ?? callData.recording_url) ?? '')
  const startedAt     = callData.startedAt ?? callData.started_at ?? null
  const endedAt       = callData.endedAt   ?? callData.ended_at   ?? null

  // ── Look up or create customer ─────────────────────────────────────────
  let customerId: string | null = null
  let customerName: string | null = null

  if (customerPhone) {
    const { data: existing } = await supabase
      .from('customers')
      .select('id, name')
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
