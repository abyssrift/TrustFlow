// billing-webhook-paymob
// Receives PayMob transaction callbacks, verifies the HMAC signature, and
// applies the confirmed plan via rpc_confirm_billing_payment.
//
// Configure in PayMob dashboard → Integration → Transaction processed callback:
//   https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/billing-webhook-paymob
//
// SECRETS:
//   PAYMOB_HMAC_SECRET  — from PayMob dashboard → Integration → HMAC Secret
//
// PayMob sends the HMAC as a query param (?hmac=...) and the transaction
// as JSON in the POST body. The function is intentionally unauthenticated
// (PayMob doesn't send a Bearer token) — HMAC is the security mechanism.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PAYMOB_HMAC_SECRET   = Deno.env.get('PAYMOB_HMAC_SECRET') ?? ''

// PayMob HMAC: SHA-512 over these fields concatenated in this exact order.
const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured',
  'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure',
  'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment',
  'is_voided', 'order.id', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
]

async function hmacSha512(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function getField(obj: Record<string, any>, dotPath: string): unknown {
  return dotPath.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj)
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)

  const rawBody = await req.text()
  const url     = new URL(req.url)
  const hmac    = url.searchParams.get('hmac') ?? ''

  let payload: any
  try { payload = JSON.parse(rawBody) } catch {
    return respond({ error: 'Invalid JSON' }, 400)
  }

  const obj = payload.obj ?? {}

  // ── HMAC verification ─────────────────────────────────────────────────────
  if (PAYMOB_HMAC_SECRET) {
    const message = HMAC_FIELDS
      .map(f => { const v = getField(obj, f); return v == null ? '' : String(v) })
      .join('')
    const expected = await hmacSha512(PAYMOB_HMAC_SECRET, message)
    if (hmac !== expected) {
      console.error('[billing-webhook-paymob] HMAC mismatch — possible spoofed request')
      return respond({ error: 'Invalid signature' }, 403)
    }
  }

  // ── Ignore unsuccessful transactions ──────────────────────────────────────
  if (!obj.success) {
    console.log('[billing-webhook-paymob] Transaction not successful, txn:', obj.id)
    return respond({ received: true }, 200)
  }

  // ── Extract company + plan from PayMob extras ─────────────────────────────
  // extras are passed in create-paymob-checkout and echoed back by PayMob.
  const company_id = obj.payment_key_claims?.extra?.company_id
  const plan_code  = obj.payment_key_claims?.extra?.plan_code
  // card_token is present when the integration has tokenization enabled.
  const card_token = obj.token ?? null

  if (!company_id || !plan_code) {
    console.error('[billing-webhook-paymob] Missing extras — company_id or plan_code not echoed back', obj.id)
    return respond({ error: 'Missing context in transaction extras' }, 400)
  }

  // ── Apply plan ────────────────────────────────────────────────────────────
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { error } = await db.rpc('rpc_confirm_billing_payment', {
    p_company_id:      company_id,
    p_plan_code:       plan_code,
    p_paymob_order_id: String(obj.order?.id ?? obj.id),
    p_card_token:      card_token,
    p_amount_cents:    obj.amount_cents,
  })

  if (error) {
    console.error('[billing-webhook-paymob] DB error applying plan:', error)
    return respond({ error: 'Failed to apply plan' }, 500)
  }

  console.log(`[billing-webhook-paymob] Plan "${plan_code}" confirmed for company ${company_id}`)
  return respond({ received: true }, 200)
})

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
