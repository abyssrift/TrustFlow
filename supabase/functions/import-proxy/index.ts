import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ENCRYPTION_KEY = Deno.env.get('IMPORT_ENCRYPTION_KEY') ?? ''

const PROVIDER_CONFIGS: Record<string, {
  baseUrl?: string
  defaultHeaders?: Record<string, string>
  authType: 'oauth2' | 'api_key'
  fetchProjects?: string
  fetchTasks?: string
}> = {
  jira: {
    baseUrl: 'https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3',
    defaultHeaders: { Accept: 'application/json' },
    authType: 'oauth2',
    fetchProjects: '/project',
    fetchTasks: '/search?jql={jql}&maxResults=100&fields=summary,description,status,priority,duedate,assignee,labels,parent,attachment,comment',
  },
  odoo: {
    authType: 'api_key',
    fetchProjects: '/xmlrpc/2/object',
    fetchTasks: '/xmlrpc/2/object',
  },
  trello: {
    baseUrl: 'https://api.trello.com/1',
    defaultHeaders: { Accept: 'application/json' },
    authType: 'api_key',
    fetchProjects: '/members/{memberId}/boards',
    fetchTasks: '/boards/{boardId}/cards?customFieldItems=true',
  },
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const { provider, resource, params, userId } = await req.json()
  if (!provider || !resource || !userId) {
    return new Response('Missing provider, resource, or userId', { status: 400 })
  }

  const config = PROVIDER_CONFIGS[provider]
  if (!config) return new Response(`Unknown provider: ${provider}`, { status: 400 })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const { data: conn, error: connError } = await supabase
    .from('import_connections')
    .select('encrypted_tokens, instance_url')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()

  if (connError || !conn) {
    return new Response('No connection found for this provider', { status: 401 })
  }

  let accessToken: string
  try {
    accessToken = await decryptToken(conn.encrypted_tokens)
  } catch {
    return new Response('Failed to decrypt credentials', { status: 500 })
  }

  if (provider === 'odoo') {
    return handleOdoo(accessToken, conn.instance_url, resource, params)
  }

  return handleApi(provider, config, accessToken, resource, params)
})

async function handleApi(
  provider: string,
  config: typeof PROVIDER_CONFIGS[string],
  token: string,
  resource: string,
  params: Record<string, string> | undefined
): Promise<Response> {
  let endpoint: string

  if (provider === 'jira') {
    const cloudId = params?.cloudId ?? ''
    const base = config.baseUrl!.replace('{cloudId}', cloudId)
    const jql = params?.jql ?? ''
    const path = resource === 'projects' ? config.fetchProjects!
      : config.fetchTasks!.replace('{jql}', encodeURIComponent(jql))
    endpoint = `${base}${path}`
  } else if (provider === 'trello') {
    const base = config.baseUrl!
    const memberId = params?.memberId ?? ''
    const boardId = params?.boardId ?? ''
    const path = resource === 'projects' ? config.fetchProjects!.replace('{memberId}', memberId)
      : config.fetchTasks!.replace('{boardId}', boardId)
    const key = Deno.env.get('TRELLO_API_KEY') ?? ''
    const sep = path.includes('?') ? '&' : '?'
    endpoint = `${base}${path}${sep}key=${key}&token=${token}`
  } else {
    return new Response(`Unsupported provider: ${provider}`, { status: 400 })
  }

  const headers: Record<string, string> = {
    ...config.defaultHeaders,
  }

  if (provider === 'jira') {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(endpoint, { headers })
  const data = await res.json()
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  })
}

async function handleOdoo(
  apiKey: string,
  instanceUrl: string | null,
  resource: string,
  params: Record<string, string> | undefined
): Promise<Response> {
  const baseUrl = instanceUrl?.replace(/\/$/, '') ?? ''
  if (!baseUrl) return new Response('Odoo instance URL is required', { status: 400 })

  const db = params?.db ?? ''
  const username = params?.username ?? ''

  // Authenticate to get session
  const authPayload = {
    jsonrpc: '2.0',
    method: 'call',
    params: { service: 'common', method: 'login', args: [db, username, apiKey] },
    id: 1,
  }

  const authRes = await fetch(`${baseUrl}/xmlrpc/2/common`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(authPayload),
  })

  const authData = await authRes.json()
  const uid = authData?.result
  if (!uid || typeof uid !== 'number') {
    return new Response('Odoo authentication failed', { status: 401 })
  }

  let result: any

  if (resource === 'projects') {
    const projPayload = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [db, uid, apiKey, 'project.project', 'search_read', [], { fields: ['id', 'name'] }],
      },
      id: 2,
    }
    const projRes = await fetch(`${baseUrl}/xmlrpc/2/object`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projPayload),
    })
    const projData = await projRes.json()
    result = projData?.result ?? []
  } else if (resource === 'tasks') {
    const projectId = params?.projectId ?? ''
    const domain = projectId ? `[["project_id","=",${projectId}]]` : '[]'
    const taskPayload = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [db, uid, apiKey, 'project.task', 'search_read', JSON.parse(domain), {
          fields: ['id', 'name', 'description', 'stage_id', 'user_id', 'priority', 'date_deadline', 'tag_ids', 'parent_id'],
        }],
      },
      id: 3,
    }
    const taskRes = await fetch(`${baseUrl}/xmlrpc/2/object`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskPayload),
    })
    const taskData = await taskRes.json()
    result = taskData?.result ?? []
  }

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
}

async function decryptToken(encrypted: string): Promise<string> {
  if (!ENCRYPTION_KEY) {
    const parsed = JSON.parse(encrypted)
    return parsed.access_token
  }

  const { crypto } = await import('https://deno.land/std@0.168.0/crypto/mod.ts')
  const raw = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
  const iv = raw.slice(0, 12)
  const data = raw.slice(12)
  const key = new TextEncoder().encode(ENCRYPTION_KEY.padEnd(32, ' ').slice(0, 32))
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']),
    data,
  )
  const parsed = JSON.parse(new TextDecoder().decode(decrypted))
  return parsed.access_token
}
