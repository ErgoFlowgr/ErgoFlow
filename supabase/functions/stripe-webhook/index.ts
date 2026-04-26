/**
 * Stripe Webhook Edge Function
 * Handles subscription lifecycle events from Stripe and updates the subscriptions table.
 *
 * Required env vars:
 *   STRIPE_WEBHOOK_SECRET   — webhook signing secret from Stripe dashboard
 *   STRIPE_PRICE_BASIC      — Stripe price ID for Basic tier
 *   STRIPE_PRICE_PLUS       — Stripe price ID for Plus tier
 *   STRIPE_PRICE_PRO        — Stripe price ID for Pro tier
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STRIPE_WEBHOOK_SECRET  = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
const STRIPE_PRICE_BASIC     = Deno.env.get('STRIPE_PRICE_BASIC') ?? ''
const STRIPE_PRICE_PLUS      = Deno.env.get('STRIPE_PRICE_PLUS') ?? ''
const STRIPE_PRICE_PRO       = Deno.env.get('STRIPE_PRICE_PRO') ?? ''
const SUPABASE_URL           = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK           = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Map Stripe price ID → internal tier name
function tierFromPriceId(priceId: string): string {
  if (priceId === STRIPE_PRICE_PRO)   return 'pro'
  if (priceId === STRIPE_PRICE_PLUS)  return 'plus'
  if (priceId === STRIPE_PRICE_BASIC) return 'basic'
  return 'basic'
}

Deno.serve(async (req: Request) => {
  if (!STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SRK) {
    console.error('Missing required environment variables')
    return new Response('Service misconfigured', { status: 500 })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // ── Verify Stripe signature ────────────────────────────────────────────
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 })
  }

  const body = await req.text()

  // Stripe signature verification (manual HMAC — no SDK needed)
  const isValid = await verifyStripeSignature(body, signature, STRIPE_WEBHOOK_SECRET)
  if (!isValid) {
    return new Response('Invalid signature', { status: 401 })
  }

  let event: Record<string, unknown>
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SRK)
  const eventType = String(event.type ?? '')
  const data = event.data as Record<string, unknown>
  const obj  = data?.object as Record<string, unknown>

  console.log('Stripe event:', eventType)

  // ── Handle events ──────────────────────────────────────────────────────
  switch (eventType) {

    // New subscription created (includes trial start)
    case 'customer.subscription.created': {
      const stripeCustomerId = String(obj.customer ?? '')
      const stripeSubId      = String(obj.id ?? '')
      const priceId          = getPriceId(obj)
      const tier             = tierFromPriceId(priceId)
      const status           = obj.status === 'trialing' ? 'trial' : 'active'
      const periodStart      = toIso(obj.current_period_start)
      const periodEnd        = toIso(obj.current_period_end)

      // Find the user_id from the subscription record (matched by stripe_customer_id)
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('id, user_id')
        .eq('stripe_customer_id', stripeCustomerId)
        .maybeSingle()

      if (sub) {
        await supabase.from('subscriptions').update({
          tier,
          status,
          stripe_subscription_id: stripeSubId,
          period_start: periodStart,
          period_end:   periodEnd,
          updated_at:   new Date().toISOString(),
        }).eq('id', sub.id)
      } else {
        console.warn('No subscription row found for customer:', stripeCustomerId)
      }

      // If upgrading to Pro, trigger VAPI provisioning
      if (tier === 'pro' && sub?.user_id) {
        await provisionVapi(sub.user_id, stripeCustomerId, supabase)
      }
      break
    }

    // Subscription changed (upgrade / downgrade / cancel at period end)
    case 'customer.subscription.updated': {
      const stripeCustomerId = String(obj.customer ?? '')
      const priceId          = getPriceId(obj)
      const tier             = tierFromPriceId(priceId)
      const status           = stripeStatusToInternal(String(obj.status ?? ''))
      const periodStart      = toIso(obj.current_period_start)
      const periodEnd        = toIso(obj.current_period_end)

      const { data: sub } = await supabase
        .from('subscriptions')
        .select('id, user_id, tier, vapi_assistant_id')
        .eq('stripe_customer_id', stripeCustomerId)
        .maybeSingle()

      if (sub) {
        await supabase.from('subscriptions').update({
          tier,
          status,
          period_start: periodStart,
          period_end:   periodEnd,
          updated_at:   new Date().toISOString(),
        }).eq('id', sub.id)

        // Newly upgraded to Pro and no assistant yet — provision one
        if (tier === 'pro' && !sub.vapi_assistant_id && sub.user_id) {
          await provisionVapi(sub.user_id, stripeCustomerId, supabase)
        }
      }
      break
    }

    // Payment succeeded → activate and reset VAPI minutes for new period
    case 'invoice.paid': {
      const stripeCustomerId = String(obj.customer ?? '')
      const periodStart      = toIso((obj as Record<string, unknown>).period_start)
      const periodEnd        = toIso((obj as Record<string, unknown>).period_end)

      await supabase.from('subscriptions').update({
        status:            'active',
        vapi_minutes_used: 0,   // reset counter for new billing period
        period_start:      periodStart,
        period_end:        periodEnd,
        updated_at:        new Date().toISOString(),
      }).eq('stripe_customer_id', stripeCustomerId)
      break
    }

    // Payment failed → mark as expired
    case 'invoice.payment_failed': {
      const stripeCustomerId = String(obj.customer ?? '')
      await supabase.from('subscriptions').update({
        status:     'expired',
        updated_at: new Date().toISOString(),
      }).eq('stripe_customer_id', stripeCustomerId)
      break
    }

    // Subscription deleted (cancelled immediately)
    case 'customer.subscription.deleted': {
      const stripeCustomerId = String(obj.customer ?? '')
      await supabase.from('subscriptions').update({
        status:     'cancelled',
        updated_at: new Date().toISOString(),
      }).eq('stripe_customer_id', stripeCustomerId)
      break
    }

    default:
      console.log('Unhandled event type:', eventType)
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

// ── Helpers ────────────────────────────────────────────────────────────────

function getPriceId(subscription: Record<string, unknown>): string {
  const items = subscription.items as Record<string, unknown> | undefined
  const data  = items?.data as Array<Record<string, unknown>> | undefined
  const price = data?.[0]?.price as Record<string, unknown> | undefined
  return String(price?.id ?? '')
}

function toIso(unixTs: unknown): string | null {
  if (typeof unixTs !== 'number') return null
  return new Date(unixTs * 1000).toISOString()
}

function stripeStatusToInternal(status: string): string {
  switch (status) {
    case 'active':   return 'active'
    case 'trialing': return 'trial'
    case 'past_due': return 'expired'
    case 'canceled': return 'cancelled'
    default:         return 'expired'
  }
}

async function provisionVapi(
  userId: string,
  _stripeCustomerId: string,
  supabase: ReturnType<typeof createClient>
): Promise<void> {
  try {
    // Call the vapi-provision Edge Function (deployed separately)
    const provisionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/vapi-provision`
    const res = await fetch(provisionUrl, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ user_id: userId }),
    })
    if (!res.ok) {
      console.error('vapi-provision failed:', await res.text())
    }
  } catch (err) {
    console.error('vapi-provision error:', err)
  }
}

// ── Stripe HMAC signature verification (no SDK) ────────────────────────────

async function verifyStripeSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    const parts    = Object.fromEntries(signature.split(',').map(p => p.split('=')))
    const timestamp = parts['t']
    const expected  = parts['v1']
    if (!timestamp || !expected) return false

    const payload = `${timestamp}.${body}`
    const key     = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
    return hex === expected
  } catch {
    return false
  }
}
