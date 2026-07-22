import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptJson } from '../_shared/crypto.ts'
import { corsHeaders, text } from '../_shared/http.ts'

// Jira 3LO. One public endpoint handles both legs:
//   start    (no ?code)  → 302 to Atlassian's consent screen
//   callback (?code=...)  → exchange code, resolve cloudId, store, bounce to app
// Trello is OAuth 1.0a / token-flow and is connected client-side via import-proxy.
//
// DEPLOY: this must be reachable by the browser and by Atlassian, so deploy it
// WITHOUT JWT verification:  supabase functions deploy import-oauth --no-verify-jwt
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Atlassian 3LO scopes — read work + user, offline for refresh.
const JIRA_SCOPE = 'read:jira-work read:jira-user offline_access'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET') return text('Method not allowed', 405)

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') // caller's user id
  if (!state) return text('Missing state', 400)

  const clientId = Deno.env.get('JIRA_CLIENT_ID')
  const clientSecret = Deno.env.get('JIRA_CLIENT_SECRET')
  if (!clientId || !clientSecret) return text('Missing Jira credentials', 500)

  // redirect_uri must be byte-identical across authorize + token exchange and
  // match what's registered in the Atlassian app. Derive from this request
  // (query stripped); allow an env override if the public origin differs.
  const selfUrl = Deno.env.get('IMPORT_OAUTH_REDIRECT_URL') ?? `${url.origin}${url.pathname}`
  const appUrl = Deno.env.get('APP_URL') ?? 'https://app.trustflow.io'

  // ── Leg 1: start — send the user to Atlassian to consent ──
  if (!code) {
    const authorize = new URL('https://auth.atlassian.com/authorize')
    authorize.searchParams.set('audience', 'api.atlassian.com')
    authorize.searchParams.set('client_id', clientId)
    authorize.searchParams.set('scope', JIRA_SCOPE)
    authorize.searchParams.set('redirect_uri', selfUrl)
    authorize.searchParams.set('state', state)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('prompt', 'consent')
    return Response.redirect(authorize.toString(), 302)
  }

  // ── Leg 2: callback — exchange the code for a token ──
  const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: selfUrl,
    }),
  })
  if (!tokenRes.ok) {
    console.error('[import-oauth] token exchange failed:', await tokenRes.text())
    return text('Token exchange failed', 502)
  }
  const { access_token } = await tokenRes.json()

  // Resolve the cloudId — every /ex/jira/{cloudId} API call needs it.
  const resourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' },
  })
  const resources = await resourcesRes.json()
  const cloudId = Array.isArray(resources) && resources[0]?.id
  if (!cloudId) {
    console.error('[import-oauth] no accessible Jira site for token')
    return text('No accessible Jira site for this account', 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const encrypted = await encryptJson({ access_token, cloudId })
  const { error } = await supabase.from('import_connections').upsert(
    { user_id: state, provider: 'jira', encrypted_tokens: encrypted, instance_url: null },
    { onConflict: 'user_id,provider,instance_url' },
  )
  if (error) {
    console.error('[import-oauth] upsert failed:', error)
    return text('Failed to store connection', 500)
  }

  return Response.redirect(`${appUrl}/imports?connect=jira&status=success`, 302)
})
