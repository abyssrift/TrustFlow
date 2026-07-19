import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ENCRYPTION_KEY = Deno.env.get('IMPORT_ENCRYPTION_KEY') ?? ''

const PROVIDERS: Record<string, {
  tokenUrl: string
  clientIdEnv: string
  clientSecretEnv: string
  authHeader?: (clientId: string, clientSecret: string) => string
}> = {
  jira: {
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    clientIdEnv: 'JIRA_CLIENT_ID',
    clientSecretEnv: 'JIRA_CLIENT_SECRET',
    authHeader: (id, secret) => btoa(`${id}:${secret}`),
  },
  trello: {
    tokenUrl: 'https://trello.com/1/OAuthGetAccessToken',
    clientIdEnv: 'TRELLO_API_KEY',
    clientSecretEnv: 'TRELLO_API_SECRET',
  },
}

serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  const url = new URL(req.url)
  const provider = url.searchParams.get('provider')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (!provider || !code || !state) {
    return new Response('Missing provider, code, or state', { status: 400 })
  }

  const config = PROVIDERS[provider]
  if (!config) return new Response(`Unknown provider: ${provider}`, { status: 400 })

  const clientId = Deno.env.get(config.clientIdEnv)
  const clientSecret = Deno.env.get(config.clientSecretEnv)
  if (!clientId || !clientSecret) {
    return new Response(`Missing credentials for ${provider}`, { status: 500 })
  }

  const appUrl = Deno.env.get('APP_URL') ?? 'https://app.trustflow.io'
  const redirectUri = `${appUrl}/api/import-oauth/callback`

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  })

  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    console.error(`[import-oauth] token exchange failed for ${provider}:`, err)
    return new Response('Token exchange failed', { status: 502 })
  }

  const tokenData = await tokenRes.json()
  const accessToken = tokenData.access_token

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const encrypted = await encryptToken(accessToken, provider, config)

  const { error: upsertError } = await supabase.from('import_connections').upsert({
    user_id: state,
    provider,
    encrypted_tokens: encrypted,
    instance_url: null,
  }, { onConflict: 'user_id,provider,instance_url' })

  if (upsertError) {
    console.error(`[import-oauth] db upsert failed for ${provider}:`, upsertError)
    return new Response('Failed to store connection', { status: 500 })
  }

  const redirectTarget = `${appUrl}/imports?connect=${provider}&status=success`
  return Response.redirect(redirectTarget, 302)
})

async function encryptToken(token: string, provider: string, config: typeof PROVIDERS[string]): Promise<string> {
  if (ENCRYPTION_KEY) {
    const { crypto } = await import('https://deno.land/std@0.168.0/crypto/mod.ts')
    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify({ access_token: token }))
    const key = encoder.encode(ENCRYPTION_KEY.padEnd(32, ' ').slice(0, 32))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']), data)
    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)
    return btoa(String.fromCharCode(...combined))
  }
  return JSON.stringify({ access_token: token })
}
