// billing-paymob-renew
// Daily cron job (02:00 UTC) that charges saved PayMob card tokens for
// companies whose subscription period ends within the next 24 hours.
//
// Flow per company:
//   1. PayMob auth → fresh API token
//   2. Create renewal order
//   3. Get payment key
//   4. Charge saved card token (server-to-server, no user interaction)
//   5. On success → rpc_record_renewal_charge (extends period by 30 days)
//      On failure → rpc_mark_renewal_failed   (marks status = 'past_due')
//
// SECRETS:
//   PAYMOB_API_KEY              — PayMob API key
//   PAYMOB_INTEGRATION_ID       — card integration ID
//   BILLING_PAYMOB_RENEW_SECRET — shared secret matching Vault 'billing_paymob_renew_secret'

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PAYMOB_API_KEY        = Deno.env.get('PAYMOB_API_KEY') ?? ''
const PAYMOB_INTEGRATION_ID = Deno.env.get('PAYMOB_INTEGRATION_ID') ?? ''
const RENEW_SECRET          = Deno.env.get('BILLING_PAYMOB_RENEW_SECRET') ?? ''
const PAYMOB_BASE           = 'https://accept.paymob.com/api'

serve(async (req: Request) => {
  // Shared-secret guard (matches the value stored in Vault + set on the Edge Function secret)
  if (RENEW_SECRET) {
    const auth = req.headers.get('Authorization') ?? ''
    if (auth !== `Bearer ${RENEW_SECRET}`) return respond({ error: 'unauthorized' }, 401)
  }

  if (!PAYMOB_API_KEY || !PAYMOB_INTEGRATION_ID) {
    return respond({ error: 'PayMob secrets not configured' }, 503)
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: renewals, error: dbErr } = await db.rpc('rpc_billing_renewals_due')
  if (dbErr) return respond({ error: dbErr.message }, 500)

  const summary = { total: (renewals ?? []).length, charged: 0, failed: 0, errors: [] as string[] }

  for (const r of (renewals ?? [])) {
    const amount_cents = r.per_seat
      ? r.price_egp_cents * Number(r.active_members)
      : r.price_egp_cents

    try {
      // Step 1: Auth
      const auth = await paymobPost('/auth/tokens', { api_key: PAYMOB_API_KEY })
      if (!auth.token) throw new Error('Auth failed')

      // Step 2: Order
      const order = await paymobPost('/ecommerce/orders', {
        auth_token:        auth.token,
        delivery_needed:   false,
        amount_cents,
        currency:          'EGP',
        merchant_order_id: `tf_renew_${r.company_id}_${Date.now()}`,
        items: [{
          name:        `TrustFlow ${r.plan_code} renewal`,
          amount_cents,
          description: 'Monthly renewal',
          quantity:    1,
        }],
      })
      if (!order.id) throw new Error('Order creation failed')

      // Step 3: Payment key
      const key = await paymobPost('/acceptance/payment_keys', {
        auth_token:           auth.token,
        amount_cents,
        expiration:           3600,
        order_id:             order.id,
        currency:             'EGP',
        integration_id:       parseInt(PAYMOB_INTEGRATION_ID, 10),
        lock_order_when_paid: true,
        billing_data: {
          first_name: 'Renewal', last_name: 'Charge', email: 'billing@trustflow.app',
          phone_number: 'N/A', apartment: 'N/A', floor: 'N/A', street: 'N/A',
          building: 'N/A', shipping_method: 'N/A', postal_code: 'N/A',
          city: 'N/A', country: 'EG', state: 'N/A',
        },
      })
      if (!key.token) throw new Error('Payment key failed')

      // Step 4: Charge saved card token
      const charge = await paymobPost('/acceptance/payments/pay', {
        source:        { identifier: r.card_token, subtype: 'TOKEN' },
        payment_token: key.token,
      })

      if (!charge.success) {
        throw new Error(charge.data?.message ?? charge.detail ?? 'Charge declined')
      }

      await db.rpc('rpc_record_renewal_charge', {
        p_company_id:      r.company_id,
        p_plan_code:       r.plan_code,
        p_paymob_order_id: String(order.id),
        p_amount_cents:    amount_cents,
      })
      summary.charged++
      console.log(`[billing-paymob-renew] Renewed ${r.company_id} (${r.plan_code}) — ${amount_cents} EGP`)

    } catch (err) {
      const msg = String(err)
      console.error(`[billing-paymob-renew] Failed ${r.company_id}:`, msg)
      await db.rpc('rpc_mark_renewal_failed', {
        p_company_id: r.company_id,
        p_plan_code:  r.plan_code,
        p_error:      msg,
      })
      summary.failed++
      summary.errors.push(`${r.company_id}: ${msg}`)
    }
  }

  console.log('[billing-paymob-renew]', JSON.stringify(summary))
  return respond(summary, 200)
})

async function paymobPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${PAYMOB_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
