/**
 * VAPI Tool-Call Edge Function
 *
 * Each Ergoflow customer gets a unique URL with their owner_id:
 *   POST /vapi-tools?secret=<SECRET>&owner=<CUSTOMER_UUID>
 *
 * This scopes ALL database queries to that customer's data only.
 * One function, all customers, fully isolated via owner_id.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WEBHOOK_SECRET = Deno.env.get('VAPI_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async (req: Request) => {
  // ── Fail fast if misconfigured ─────────────────────────────────────────
  if (!WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SRK) {
    console.error('Missing required environment variables')
    return new Response('Service misconfigured', { status: 500 })
  }

  // ── Security ──────────────────────────────────────────────────────────────
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')

  if (secret !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  // ── Owner scoping ─────────────────────────────────────────────────────────
  const ownerId = url.searchParams.get('owner')
  if (!ownerId) {
    return new Response('Missing owner parameter', { status: 400 })
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

  const message = body.message as Record<string, unknown> | undefined
  const toolCallList = message?.toolCallList as Array<Record<string, unknown>> | undefined

  if (!toolCallList?.length) {
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SRK)

  // ── Process each tool call ────────────────────────────────────────────────
  const results = await Promise.all(
    toolCallList.map(async (toolCall) => {
      const toolCallId = String(toolCall.id ?? '')
      const fn = toolCall.function as Record<string, unknown> | undefined
      const name = String(fn?.name ?? '')
      let args: Record<string, unknown> = {}

      try {
        args = JSON.parse(String(fn?.arguments ?? '{}'))
      } catch {
        // leave args empty
      }

      let result: string

      if (name === 'lookup_contact' || name === 'getCustomer') {
        result = await lookupContact(supabase, args, ownerId)
      } else if (name === 'create_contact') {
        result = await createContact(supabase, args, ownerId)
      } else if (name === 'updateCustomer') {
        result = await updateCustomer(supabase, args, ownerId)
      } else {
        result = `Unknown tool: ${name}`
      }

      return { toolCallId, result }
    })
  )

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

// ── Tool: lookup_contact ──────────────────────────────────────────────────────
// Returns customer profile + last 5 calls summary so the AI can greet them properly.
async function lookupContact(
  supabase: ReturnType<typeof createClient>,
  args: Record<string, unknown>,
  ownerId: string
): Promise<string> {
  const phone = normalizePhone(String(args.phone ?? ''))

  if (!phone) return 'No phone number provided.'

  const { data: customer } = await supabase
    .from('customers')
    .select('id, name, email, address, notes')
    .eq('owner_id', ownerId)
    .eq('phone', phone)
    .maybeSingle()

  if (!customer) {
    return `No customer found for ${phone}. This appears to be a new caller.`
  }

  // Fetch last 5 calls
  const { data: calls } = await supabase
    .from('calls')
    .select('started_at, status, duration_seconds, summary')
    .eq('customer_id', customer.id)
    .order('started_at', { ascending: false })
    .limit(5)

  const parts: string[] = [
    `Customer found: ${customer.name}`,
  ]

  if (customer.address) parts.push(`Address: ${customer.address}`)
  if (customer.email)   parts.push(`Email: ${customer.email}`)
  if (customer.notes)   parts.push(`Notes: ${customer.notes}`)

  if (calls?.length) {
    const callLines = calls.map((c) => {
      const date = c.started_at ? new Date(c.started_at).toLocaleDateString('el-GR') : 'unknown date'
      const dur  = c.duration_seconds ? `${Math.round(c.duration_seconds / 60)} min` : ''
      const sum  = c.summary ? ` — ${c.summary}` : ''
      return `  • ${date}${dur ? ' (' + dur + ')' : ''}${sum}`
    })
    parts.push(`Last ${calls.length} call(s):\n${callLines.join('\n')}`)
  } else {
    parts.push('No previous calls on record.')
  }

  return parts.join('\n')
}

// ── Tool: create_contact ──────────────────────────────────────────────────────
// Creates a new customer record. Call this when lookup_contact returns nothing.
async function createContact(
  supabase: ReturnType<typeof createClient>,
  args: Record<string, unknown>,
  ownerId: string
): Promise<string> {
  const phone = normalizePhone(String(args.phone ?? ''))
  const name  = String(args.name ?? phone)

  if (!phone) return 'No phone number provided.'

  // Check if already exists for this owner
  const { data: existing } = await supabase
    .from('customers')
    .select('id, name')
    .eq('owner_id', ownerId)
    .eq('phone', phone)
    .maybeSingle()

  if (existing) {
    return `Customer already exists: ${existing.name}.`
  }

  const { error } = await supabase.from('customers').insert({
    id: crypto.randomUUID(),
    owner_id: ownerId,
    name,
    phone,
    address: args.address ? String(args.address) : null,
  })

  if (error) return `Failed to create customer: ${error.message}`

  return `New customer created: ${name} (${phone}).`
}

// ── Tool: updateCustomer ──────────────────────────────────────────────────────
// Updates name, address, or notes for a customer identified by phone.
async function updateCustomer(
  supabase: ReturnType<typeof createClient>,
  args: Record<string, unknown>,
  ownerId: string
): Promise<string> {
  const phone = normalizePhone(String(args.phone ?? ''))

  if (!phone) return 'No phone number provided.'

  const { data: customer } = await supabase
    .from('customers')
    .select('id, name')
    .eq('owner_id', ownerId)
    .eq('phone', phone)
    .maybeSingle()

  if (!customer) {
    return `No customer found for ${phone}. Cannot update.`
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (args.name)    updates.name    = String(args.name)
  if (args.address) updates.address = String(args.address)
  if (args.email)   updates.email   = String(args.email)
  if (args.notes) {
    // Append to existing notes rather than overwrite
    const { data: existing } = await supabase
      .from('customers')
      .select('notes')
      .eq('id', customer.id)
      .maybeSingle()

    const prev = existing?.notes ? existing.notes + '\n' : ''
    updates.notes = prev + String(args.notes)
  }

  const { error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', customer.id)

  if (error) return `Failed to update customer: ${error.message}`

  const updated = Object.keys(updates)
    .filter((k) => k !== 'updated_at')
    .join(', ')

  return `Updated ${customer.name}: ${updated}.`
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizePhone(phone: string): string {
  // Strip spaces/dashes, keep + prefix
  return phone.replace(/[\s\-().]/g, '') || ''
}
