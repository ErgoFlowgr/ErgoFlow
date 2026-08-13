/**
 * VAPI sync Edge Function
 * Authenticated client helper: pulls recent VAPI call status for the user's
 * assistant and updates existing call rows by vapi_call_id.
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

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SRK)
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  const userId = userData.user?.id
  if (userError || !userId) return json({ error: 'Unauthorized' }, 401)

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('vapi_assistant_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!sub?.vapi_assistant_id) return json({ ok: true, synced: 0, message: 'No VAPI assistant provisioned' })

  const listRes = await fetch(`${VAPI_BASE}/call?assistantId=${encodeURIComponent(sub.vapi_assistant_id)}&limit=50`, {
    headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
  })
  const listData = await safeJson(listRes)
  if (!listRes.ok) return json({ error: 'VAPI sync failed', detail: listData }, 502)

  const calls = Array.isArray(listData) ? listData : Array.isArray(listData.data) ? listData.data : []
  let synced = 0
  for (const raw of calls as Array<Record<string, unknown>>) {
    const id = String(raw.id ?? '')
    if (!id) continue
    const patch = {
      status: String(raw.status ?? 'unknown'),
      duration_seconds: typeof raw.duration === 'number' ? raw.duration : null,
      transcript: extractTranscript(raw),
      summary: extractSummary(raw),
      recording_url: String((raw.recordingUrl ?? raw.recording_url) ?? '') || null,
      started_at: raw.startedAt ?? raw.started_at ?? null,
      ended_at: raw.endedAt ?? raw.ended_at ?? null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('calls')
      .update(patch)
      .eq('owner_id', userId)
      .eq('vapi_call_id', id)
    if (!error) synced++
  }

  return json({ ok: true, synced })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function safeJson(res: Response): Promise<Record<string, unknown> | Array<unknown>> {
  try { return await res.json() as Record<string, unknown> | Array<unknown> } catch { return { text: await res.text().catch(() => '') } }
}

function extractTranscript(call: Record<string, unknown>): string | null {
  const artifact = call.artifact as Record<string, unknown> | undefined
  const candidates = [call.transcript, call.transcriptText, artifact?.transcript]
  const value = candidates.find(v => typeof v === 'string' && v.trim())
  return typeof value === 'string' ? value : null
}

function extractSummary(call: Record<string, unknown>): string | null {
  const analysis = call.analysis as Record<string, unknown> | undefined
  const artifact = call.artifact as Record<string, unknown> | undefined
  const candidates = [call.summary, analysis?.summary, artifact?.summary]
  const value = candidates.find(v => typeof v === 'string' && v.trim())
  return typeof value === 'string' ? value : null
}
