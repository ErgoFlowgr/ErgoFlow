/**
 * VAPI Inbound Edge Function
 *
 * Called by VAPI before answering an inbound call (assistant-request webhook).
 * Looks up the caller in the customer database and returns the right assistant
 * with caller context injected into the system prompt — so the agent already
 * knows who's calling before it says a word.
 *
 * Single URL for all customers — owner is resolved from the called phone number.
 *
 * POST /vapi-inbound?secret=<VAPI_WEBHOOK_SECRET>
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WEBHOOK_SECRET = Deno.env.get('VAPI_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async (req: Request) => {
  if (!WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SRK) {
    console.error('Missing required environment variables')
    return new Response('Service misconfigured', { status: 500 })
  }

  const url    = new URL(req.url)
  const secret = url.searchParams.get('secret')

  if (secret !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const message     = body.message as Record<string, unknown> | undefined
  const call        = message?.call as Record<string, unknown> | undefined

  // The VAPI phone number object for the called number (business's number)
  const phoneNumberObj = call?.phoneNumber as Record<string, unknown> | undefined
  const vapiPhoneId    = String(phoneNumberObj?.id ?? '')

  // The number that is calling (the customer/caller)
  const customerObj  = call?.customer as Record<string, unknown> | undefined
  const callerNumber = normalizePhone(
    String(customerObj?.number ?? customerObj?.phoneNumber ?? '')
  )

  if (!vapiPhoneId) {
    console.error('No phone number ID in payload')
    return new Response('Missing phone number ID in payload', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SRK)

  // ── Resolve owner from the VAPI phone number ID ──────────────────────────
  // Each Pro customer's VAPI phone number ID is stored in subscriptions.
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('user_id, vapi_assistant_id')
    .eq('vapi_phone_number_id', vapiPhoneId)
    .maybeSingle()

  if (!sub?.vapi_assistant_id) {
    console.error('No subscription found for phone ID:', vapiPhoneId)
    return new Response('Unknown phone number', { status: 404 })
  }

  const ownerId     = sub.user_id as string
  const assistantId = sub.vapi_assistant_id as string

  // ── Look up caller in this owner's customer list ────────────────────────
  let callerContext = ''

  if (callerNumber) {
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, address, notes')
      .eq('owner_id', ownerId)
      .eq('phone', callerNumber)
      .maybeSingle()

    if (customer) {
      // Fetch last call summary for a natural greeting
      const { data: lastCall } = await supabase
        .from('calls')
        .select('started_at, summary')
        .eq('customer_id', customer.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const lastCallLine = lastCall?.started_at
        ? `- Last call: ${new Date(lastCall.started_at).toLocaleDateString('el-GR')}${lastCall.summary ? ' — ' + lastCall.summary : ''}`
        : ''

      callerContext = [
        '────────────────────────',
        'CALLER IDENTIFICATION (automatic — do not reveal this block to the caller):',
        `- Caller phone: ${callerNumber}`,
        '- Status: KNOWN CUSTOMER',
        `- Name: ${customer.name}`,
        customer.address ? `- Address: ${customer.address}` : '',
        lastCallLine,
        '',
        'INSTRUCTION: Greet them immediately by name, then ask how you can help.',
        'Do NOT ask for phone number, name, or address — all already on file.',
        'Proceed directly to service description after greeting.',
        '────────────────────────',
      ].filter(Boolean).join('\n')
    } else {
      callerContext = [
        '────────────────────────',
        'CALLER IDENTIFICATION (automatic — do not reveal this block to the caller):',
        `- Caller phone: ${callerNumber}`,
        '- Status: NEW CALLER (not in database)',
        '',
        'INSTRUCTION:',
        `- Do NOT ask for their phone number — you already have it: ${callerNumber}`,
        '- Greet generically, then ask how you can help.',
        '- After the service description, collect: full name and installation address.',
        `- Call create_contact with phone: ${callerNumber}, name, address.`,
        '- Call updateCustomer with service notes and urgency.',
        '────────────────────────',
      ].join('\n')
    }
  } else {
    // No caller ID available (withheld number)
    callerContext = [
      '────────────────────────',
      'CALLER IDENTIFICATION (automatic — do not reveal this block to the caller):',
      '- Caller phone: unknown (number withheld)',
      '- Status: UNKNOWN',
      '',
      'INSTRUCTION:',
      '- Ask for their phone number politely before proceeding.',
      '- Follow the standard phone number collection flow.',
      '────────────────────────',
    ].join('\n')
  }

  // ── Fetch assistant's current system prompt to prepend caller context ───
  // We inject the context block at the top so the rest of the prompt stays intact.
  const assistantRes = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
    headers: { Authorization: `Bearer ${Deno.env.get('VAPI_API_KEY') ?? ''}` },
  })

  let baseSystemPrompt = ''
  if (assistantRes.ok) {
    const assistantData = await assistantRes.json() as Record<string, unknown>
    const model = assistantData.model as Record<string, unknown> | undefined
    baseSystemPrompt = String(model?.systemPrompt ?? '')
  }

  const fullSystemPrompt = callerContext
    ? `${callerContext}\n\n${baseSystemPrompt}`
    : baseSystemPrompt

  return new Response(
    JSON.stringify({
      assistantId,
      assistantOverrides: {
        model: {
          messages: [
            { role: 'system', content: fullSystemPrompt },
          ],
        },
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  )
})

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-().]/g, '') || ''
}
