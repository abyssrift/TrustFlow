// create-paymob-checkout
// Called by BillingPanel when a user upgrades to a paid plan.
// Authenticates with PayMob, creates an order + payment key, and returns
// the hosted iframe checkout URL. The user is redirected there to pay.
//
// SECRETS (Supabase Dashboard → Edge Functions → Secrets):
//   PAYMOB_API_KEY        — from PayMob dashboard
//   PAYMOB_INTEGRATION_ID — card integration ID
//   PAYMOB_IFRAME_ID      — hosted iframe ID

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PAYMOB_API_KEY       = Deno.env.get('PAYMOB_API_KEY') ?? ''
const PAYMOB_INTEGRATION_ID = Deno.env.get('PAYMOB_INTEGRATION_ID') ?? ''
const PAYMOB_IFRAME_ID     = Deno.env.get('PAYMOB_IFRAME_ID') ?? ''
const PAYMOB_BASE          = 'https://accept.paymob.com/api'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)

  if (!PAYMOB_API_KEY || !PAYMOB_INTEGRATION_ID || !PAYMOB_IFRAME_ID) {
    return respond({ error: 'PayMob not configured yet. Contact your administrator.' }, 503)
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!jwt) return respond({ error: 'Unauthorized' }, 401)

  const userDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: { user } } = await userDb.auth.getUser()
  if (!user) return respond({ error: 'Unauthorized' }, 401)

  const { data: canManage } = await userDb.rpc('_can_manage_billing')
  if (!canManage) return respond({ error: 'Permission denied' }, 403)

  // ── Resolve plan + profile ─────────────────────────────────────────────────
  const { plan_code } = await req.json()
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const [planRes, profileRes] = await Promise.all([
    db.from('billing_plans')
      .select('code, name, price_egp_cents, per_seat')
      .eq('code', plan_code)
      .eq('is_active', true)
      .single(),
    db.from('users')
      .select('company_id, full_name, email')
      .eq('id', user.id)
      .single(),
  ])

  const plan    = planRes.data
  const profile = profileRes.data

  if (!plan || plan.price_egp_cents === 0) {
    return respond({ error: 'Invalid plan or EGP price not set — update billing_plans.price_egp_cents.' }, 400)
  }
  if (!profile?.company_id) return respond({ error: 'No company context' }, 400)

  // Per-seat: multiply by current active member count
  let amount_cents = plan.price_egp_cents
  if (plan.per_seat) {
    const { count } = await db
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', profile.company_id)
      .is('deleted_at', null)
    amount_cents = plan.price_egp_cents * (count ?? 1)
  }

  // ── PayMob Step 1: authenticate ───────────────────────────────────────────
  const authRes = await fetch(`${PAYMOB_BASE}/auth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: PAYMOB_API_KEY }),
  }).then(r => r.json())

  if (!authRes.token) {
    console.error('[create-paymob-checkout] auth failed', authRes)
    return respond({ error: 'PayMob authentication failed' }, 502)
  }

  // ── PayMob Step 2: create order ───────────────────────────────────────────
  const orderRes = await fetch(`${PAYMOB_BASE}/ecommerce/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token:        authRes.token,
      delivery_needed:   false,
      amount_cents,
      currency:          'EGP',
      merchant_order_id: `tf_${profile.company_id}_${plan_code}_${Date.now()}`,
      items: [{
        name:        `TrustFlow ${plan.name} Plan`,
        amount_cents,
        description: 'Monthly subscription',
        quantity:    1,
      }],
    }),
  }).then(r => r.json())

  if (!orderRes.id) {
    console.error('[create-paymob-checkout] order failed', orderRes)
    return respond({ error: 'PayMob order creation failed' }, 502)
  }

  // ── PayMob Step 3: payment key ────────────────────────────────────────────
  const nameParts = (profile.full_name ?? 'User').split(' ')
  const keyRes = await fetch(`${PAYMOB_BASE}/acceptance/payment_keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token:           authRes.token,
      amount_cents,
      expiration:           3600,
      order_id:             orderRes.id,
      currency:             'EGP',
      integration_id:       parseInt(PAYMOB_INTEGRATION_ID, 10),
      lock_order_when_paid: true,
      // PayMob echoes `extras` back in the webhook — used to identify the company + plan.
      extras: { company_id: profile.company_id, plan_code },
      billing_data: {
        first_name:      nameParts[0] ?? 'User',
        last_name:       nameParts.slice(1).join(' ') || 'N/A',
        email:           profile.email ?? user.email ?? 'N/A',
        phone_number:    'N/A',
        apartment:       'N/A', floor: 'N/A', street: 'N/A', building: 'N/A',
        shipping_method: 'N/A', postal_code: 'N/A', city: 'N/A', country: 'EG', state: 'N/A',
      },
    }),
  }).then(r => r.json())

  if (!keyRes.token) {
    console.error('[create-paymob-checkout] payment key failed', keyRes)
    return respond({ error: 'PayMob payment key generation failed' }, 502)
  }

  // Log intent so the webhook has a fallback lookup if extras don't arrive.
  await db.from('billing_events').insert({
    company_id: profile.company_id,
    type:       'checkout_initiated',
    plan_code,
    created_by: user.id,
    data:       { paymob_order_id: orderRes.id, amount_cents, currency: 'EGP' },
  })

  return respond({
    checkout_url: `https://accept.paymob.com/api/acceptance/iframes/${PAYMOB_IFRAME_ID}?payment_token=${keyRes.token}`,
    order_id:     orderRes.id,
  }, 200)
})

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
