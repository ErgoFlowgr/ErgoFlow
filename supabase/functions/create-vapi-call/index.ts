/**
 * Create VAPI outbound call
 * Called by the authenticated ErgoFlow client. Uses service role only inside the
 * Edge Function; validates the caller's JWT before touching subscription/calls.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPI_API_KEY = Deno.env.get('VAPI_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VAPI_BASE = 'https://api.vapi.ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405)
  if (!VAPI_API_KEY || !SUPABASE_URL || !SUPABASE_SRK) return json({ error: 'Service misconfigured' }, 500)

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SRK)
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  const userId = userData.user?.id
  if (userError || !userId) return json({ error: 'Unauthorized' }, 401)

  let body: { phone?: string; customer_id?: string; customer_name?: string; reason?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const phone = normalizeGreekPhone(String(body.phone ?? ''))
  if (!phone) return json({ error: 'Missing destination phone' }, 400)

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, tier, vapi_assistant_id, vapi_phone_number_id, vapi_minutes_used')
    .eq('user_id', userId)
    .maybeSingle()

  if (!sub || !['pro'].includes(String(sub.tier ?? ''))) return json({ error: 'AI Caller requires Pro' }, 403)
  if (!sub.vapi_assistant_id) return json({ error: 'VAPI assistant not provisioned' }, 409)
  if ((sub.vapi_minutes_used ?? 0) >= 100) return json({ error: 'VAPI minute cap reached' }, 402)

  const callBody: Record<string, unknown> = {
    assistantId: sub.vapi_assistant_id,
    customer: { number: phone },
  }
  if (sub.vapi_phone_number_id) callBody.phoneNumberId = sub.vapi_phone_number_id
  if (body.customer_name || body.reason) {
    callBody.assistantOverrides = {
      variableValues: {
        customer_name: body.customer_name ?? '',
        call_reason: body.reason ?? '',
      },
    }
  }

  const callRes = await fetch(`${VAPI_BASE}/call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(callBody),
  })

  const callData = await safeJson(callRes)
  if (!callRes.ok) {
    console.error('VAPI create call failed:', callData)
    return json({ error: 'VAPI create call failed', detail: callData }, 502)
  }

  const vapiCallId = String(callData.id ?? '')
  const localCallId = crypto.randomUUID()
  await supabase.from('calls').insert({
    id: localCallId,
    owner_id: userId,
    vapi_call_id: vapiCallId || null,
    customer_id: body.customer_id || null,
    customer_phone: phone,
    customer_name: body.customer_name || phone,
    direction: 'outbound',
    status: String(callData.status ?? 'queued'),
    started_at: new Date().toISOString(),
    summary: body.reason ? `Outbound call requested: ${body.reason}` : 'Outbound call requested from ErgoFlow.',
    updated_at: new Date().toISOString(),
  })

  return json({ ok: true, id: localCallId, vapiCallId, status: callData.status ?? 'queued' })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try { return await res.json() as Record<string, unknown> } catch { return { text: await res.text().catch(() => '') } }
}

function normalizeGreekPhone(phone: string): string {
  let value = phone.trim().replace(/[\s().-]/g, '')
  if (!value) return ''
  if (value.startsWith('00')) value = '+' + value.slice(2)
  if (value.startsWith('69')) value = '+30' + value
  if (value.startsWith('2')) value = '+30' + value
  return value
}
