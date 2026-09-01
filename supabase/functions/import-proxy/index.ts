import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptJson, encryptJson } from '../_shared/crypto.ts'
import { corsHeaders, json, text } from '../_shared/http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const TRELLO_API_KEY = Deno.env.get('TRELLO_API_KEY') ?? ''

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return text('Method not allowed', 405)

  // Identify the caller from their JWT — never trust a user id in the body.
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  const user = userData?.user
  if (userErr || !user) return text('Unauthorized', 401)

  const { provider, resource, params } = await req.json().catch(() => ({}))
  if (!provider || !resource) return text('Missing provider or resource', 400)
  const p = params ?? {}

  // Establish/refresh a stored connection for api-key + token providers.
  if (resource === 'connect') return handleConnect(supabase, user.id, provider, p)

  // Non-secret connection details, for prefilling the connect form on
  // reconnect. The API key / OAuth token never leaves the server.
  if (resource === 'read') return handleRead(supabase, provider)

  // RLS scopes this select to the caller's own row.
  const { data: conn } = await supabase
    .from('import_connections')
    .select('encrypted_tokens, instance_url')
    .eq('provider', provider)
    .maybeSingle()
  if (!conn) return text('No connection found for this provider', 401)

  let creds: any
  try { creds = await decryptJson(conn.encrypted_tokens) } catch { return text('Failed to decrypt credentials', 500) }

  if (provider === 'jira') return handleJira(creds, resource, p)
  if (provider === 'trello') return handleTrello(creds, resource, p)
  if (provider === 'odoo') return handleOdoo(creds, conn.instance_url, resource, p)
  return text(`Unknown provider: ${provider}`, 400)
})

async function handleConnect(
  supabase: SupabaseClient,
  userId: string,
  provider: string,
  params: Record<string, string>,
): Promise<Response> {
  let payload: Record<string, unknown>
  let instanceUrl: string | null = null

  if (provider === 'trello') {
    if (!params.token) return text('Missing Trello token', 400)
    payload = { token: params.token }
  } else if (provider === 'odoo') {
    const { instanceUrl: url, db, username, apiKey } = params
    if (!url || !db || !username || !apiKey) return text('Missing Odoo credentials', 400)
    instanceUrl = url.replace(/\/$/, '')
    const uid = await odooAuth(instanceUrl, db, username, apiKey)
    if (!uid) return text('Odoo authentication failed', 401)
    payload = { apiKey, db, username }
  } else {
    return text(`Provider ${provider} does not support api-key connect`, 400)
  }

  const encrypted = await encryptJson(payload)
  const { error } = await supabase.from('import_connections').upsert(
    { user_id: userId, provider, encrypted_tokens: encrypted, instance_url: instanceUrl },
    { onConflict: 'user_id,provider,instance_url' },
  )
  if (error) { console.error('[import-proxy] connect upsert failed:', error); return text('Failed to store connection', 500) }
  return json({ ok: true })
}

async function handleRead(supabase: SupabaseClient, provider: string): Promise<Response> {
  // RLS scopes this select to the caller's own row.
  const { data: conn } = await supabase
    .from('import_connections')
    .select('encrypted_tokens, instance_url, provider_display_name, updated_at')
    .eq('provider', provider)
    .maybeSingle()
  if (!conn) return json({ connected: false })

  // Best-effort: a corrupt/legacy ciphertext still means "connected", just
  // without the extra detail to prefill.
  let creds: any = {}
  try { creds = await decryptJson(conn.encrypted_tokens) } catch { /* fall through with {} */ }

  const detail: Record<string, unknown> = {
    connected: true,
    instanceUrl: conn.instance_url,
    displayName: conn.provider_display_name,
    updatedAt: conn.updated_at,
  }
  // Odoo's db/username aren't secrets — surface them so a reconnect only ever
  // needs a fresh API key, not the whole form retyped. apiKey/token never go here.
  if (provider === 'odoo') {
    detail.db = creds.db ?? null
    detail.username = creds.username ?? null
  }
  return json(detail)
}

// ── Jira (OAuth2 3LO) ─────────────────────────────────────────────
async function handleJira(creds: any, resource: string, params: Record<string, string>): Promise<Response> {
  const cloudId = creds.cloudId ?? ''
  if (!cloudId) return text('Jira cloudId missing from connection', 400)
  const base = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`
  const headers = { Accept: 'application/json', Authorization: `Bearer ${creds.access_token}` }

  if (resource === 'projects') {
    return passthrough(await fetch(`${base}/project/search`, { headers }))
  }
  // The legacy GET /search is removed on Jira Cloud; use POST /search/jql.
  const res = await fetch(`${base}/search/jql`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: params.jql ?? '',
      maxResults: 100,
      fields: ['summary', 'description', 'status', 'priority', 'duedate', 'assignee', 'labels', 'parent'],
    }),
  })
  return passthrough(res)
}

// ── Trello (token auth) ───────────────────────────────────────────
async function handleTrello(creds: any, resource: string, params: Record<string, string>): Promise<Response> {
  const auth = `key=${TRELLO_API_KEY}&token=${creds.token}`
  const headers = { Accept: 'application/json' }

  if (resource === 'projects') {
    const memberId = params.memberId || 'me'
    return passthrough(await fetch(`https://api.trello.com/1/members/${memberId}/boards?fields=id,name&${auth}`, { headers }))
  }
  // Lists with their open cards in one call — lets the adapter attach the
  // stage (list) *name*, which the raw card only carries as an idList.
  const boardId = params.boardId ?? ''
  const url = `https://api.trello.com/1/boards/${boardId}/lists`
    + `?cards=open&card_fields=name,desc,due,idMembers,labels,url&fields=id,name&${auth}`
  return passthrough(await fetch(url, { headers }))
}

// ── Odoo (JSON-RPC over /jsonrpc, not the XML-RPC endpoints) ───────
async function handleOdoo(creds: any, instanceUrl: string | null, resource: string, params: Record<string, string>): Promise<Response> {
  const base = (instanceUrl ?? '').replace(/\/$/, '')
  if (!base) return text('Odoo instance URL is required', 400)
  const { apiKey, db, username } = creds

  const uid = await odooAuth(base, db, username, apiKey)
  if (!uid) return text('Odoo authentication failed', 401)
  const exec = (model: string, method: string, positional: unknown[], kwargs: Record<string, unknown>) =>
    odooExecute(base, db, uid, apiKey, model, method, positional, kwargs)

  if (resource === 'projects') {
    return json((await exec('project.project', 'search_read', [[]], { fields: ['id', 'name'] })) ?? [])
  }

  // Odoo 17 renamed project.task.user_id (m2o) → user_ids (m2m). search_read is
  // all-or-nothing, so probe which field this instance has before requesting it.
  const af = await exec('project.task', 'fields_get', [['user_id', 'user_ids']], { attributes: ['type'] })
  const assigneeField = af?.user_ids ? 'user_ids' : (af?.user_id ? 'user_id' : null)

  const fields = ['id', 'name', 'description', 'stage_id', 'priority', 'date_deadline', 'tag_ids', 'parent_id']
  if (assigneeField) fields.push(assigneeField)

  const projectId = params.projectId
  const domain = projectId ? [['project_id', '=', Number(projectId)]] : []
  const tasks: any[] = (await exec('project.task', 'search_read', [domain], { fields })) ?? []

  // Normalise assignees → emails on `_assignees` (m2m gives ids only → read res.users).
  if (assigneeField === 'user_ids') {
    const ids = [...new Set(tasks.flatMap((t) => (Array.isArray(t.user_ids) ? t.user_ids : [])))]
    const users: any[] = ids.length ? (await exec('res.users', 'read', [ids], { fields: ['email', 'name'] })) ?? [] : []
    const map: Record<number, string> = Object.fromEntries(users.map((u) => [u.id, u.email || u.name]))
    for (const t of tasks) t._assignees = (t.user_ids || []).map((id: number) => map[id]).filter(Boolean)
  } else if (assigneeField === 'user_id') {
    for (const t of tasks) t._assignees = t.user_id?.[1] ? [t.user_id[1]] : []
  }
  return json(tasks)
}

async function odooJsonRpc(base: string, db: string, service: string, method: string, args: unknown[]): Promise<any> {
  const res = await fetch(`${base}/jsonrpc`, {
    method: 'POST',
    // X-Odoo-Database disambiguates the DB on multi-tenant SaaS hosts (a
    // dedicated subdomain resolves it from the hostname; a shared host needs this).
    headers: { 'Content-Type': 'application/json', 'X-Odoo-Database': db },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
  })
  const data = await res.json()
  return data?.result
}

function odooAuth(base: string, db: string, username: string, apiKey: string): Promise<number | null> {
  // An Odoo API key is accepted in place of the password.
  return odooJsonRpc(base, db, 'common', 'authenticate', [db, username, apiKey, {}])
    .then((uid) => (typeof uid === 'number' ? uid : null))
}

function odooExecute(
  base: string, db: string, uid: number, apiKey: string,
  model: string, method: string, positional: unknown[], kwargs: Record<string, unknown>,
): Promise<any> {
  return odooJsonRpc(base, db, 'object', 'execute_kw', [db, uid, apiKey, model, method, positional, kwargs])
}

// Pass the provider's JSON straight through (adapters normalise shape).
async function passthrough(res: Response): Promise<Response> {
  const body = await res.text()
  return new Response(body, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
