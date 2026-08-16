// ====================================================================
// purge-company — company purge (grace-period sweep + instant purge)
// ====================================================================
//
// Two ways in, mirroring purge-filehub-bin (#55):
//
// 1. CRON MODE: pg_cron POSTs here daily with
//    `Authorization: Bearer <PURGE_EXPIRED_COMPANIES_SECRET>` (see migration
//    `20260816_company_purge_schedule.sql`). Sweeps every company that
//    rpc_platform_soft_delete_company put into `deleted_at IS NOT NULL` more
//    than 30 days ago and was never restored via rpc_platform_restore_company.
//
// 2. INSTANT MODE (platform-admin "purge now" button): the client calls this
//    function with the CALLING platform admin's own session JWT and
//    `{ mode: 'instant', company_id }` in the body. The JWT is handed to
//    `rpc_platform_purge_company_authorize()`, which raises unless the
//    caller is a platform admin and the company exists. On success it
//    purges ONLY that company, immediately, with no grace-period check.
//
// Per-company purge (either mode), same order both ways:
//   1. Read every FileHub storage object for the company from
//      filehub_files + filehub_file_versions (versions cover every
//      historical object, current included — same reasoning as
//      purge-filehub-bin: filehub_files.storage_path always mirrors the
//      current version, so removing every version's object also covers it).
//      This MUST happen before the DB purge below, since fn_purge_company_data
//      cascade-deletes these rows via the companies FK.
//   2. `fn_purge_company_data` (service_role-only RPC, see
//      20260816_company_purge_unification.sql) — deletes every DB row for
//      the company in one transaction (self-ref FK null-outs, graceful
//      timer stop, the 9 NO ACTION-FK tables, the 3 no-FK tables, then the
//      company row itself, cascading everything else).
//   3. Remove the storage objects collected in step 1, batched per bucket
//      (same REMOVE_BATCH pattern as filehub-orphan-sweep).
//
// !! SECRETS — Project Settings → Edge Functions → Secrets
//   PURGE_EXPIRED_COMPANIES_SECRET — shared secret for cron mode (cron reads
//     the same value from Vault, name 'purge_expired_companies_secret').
//     Any OTHER bearer token is treated as a platform admin's session JWT.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are injected
// by the Edge runtime.
// ====================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const PURGE_EXPIRED_COMPANIES_SECRET = Deno.env.get('PURGE_EXPIRED_COMPANIES_SECRET') ?? ''

const GRACE_PERIOD_DAYS = 30
const REMOVE_BATCH = 100

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface StorageRef {
  bucket: string
  storage_path: string
}

type Summary = {
  mode: 'cron' | 'instant'
  companies_purged: number
  objects_removed: number
  errors: string[]
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '')

  let body: { mode?: string; company_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    // no/invalid body is fine for cron mode
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const isCron = PURGE_EXPIRED_COMPANIES_SECRET.length > 0 && bearer === PURGE_EXPIRED_COMPANIES_SECRET

  // ── Cron mode: sweep every company past the grace period ───────────────
  if (isCron) {
    const summary = newSummary('cron')
    try {
      const cutoffIso = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data: expired, error } = await db
        .from('companies')
        .select('id')
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoffIso)
      if (error) throw error

      for (const row of (expired ?? []) as { id: string }[]) {
        await purgeCompany(db, row.id, summary)
      }
    } catch (err) {
      summary.errors.push(String(err))
      console.error('[purge-company]', err)
    }
    console.log('[purge-company]', JSON.stringify(summary))
    return respond(summary, summary.errors.length > 0 && summary.companies_purged === 0 ? 500 : 200)
  }

  // ── Instant mode: platform-admin "purge now" for one company ───────────
  if (body.mode !== 'instant' || !body.company_id || !bearer) {
    return respond({ error: 'unauthorized' }, 401)
  }

  // Verify the caller's own session JWT and authorize via the existing
  // platform-admin-gated RPC — no permission logic duplicated here.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  })
  const { data: authorizedId, error: authErr } = await userClient.rpc('rpc_platform_purge_company_authorize', {
    p_company_id: body.company_id,
  })
  if (authErr || !authorizedId) {
    return respond({ error: authErr?.message ?? 'unauthorized' }, 403)
  }

  const summary = newSummary('instant')
  try {
    await purgeCompany(db, authorizedId as string, summary)
  } catch (err) {
    summary.errors.push(String(err))
    console.error('[purge-company]', err)
    return respond(summary, 500)
  }
  console.log('[purge-company]', JSON.stringify(summary))
  return respond(summary, 200)
})

function newSummary(mode: 'cron' | 'instant'): Summary {
  return { mode, companies_purged: 0, objects_removed: 0, errors: [] }
}

// Purge one company: collect its FileHub storage objects, delete every DB
// row via fn_purge_company_data, then remove the collected objects, batched
// per bucket (same REMOVE_BATCH pattern as filehub-orphan-sweep).
async function purgeCompany(db: SupabaseClient, companyId: string, summary: Summary): Promise<void> {
  const refs: StorageRef[] = []

  const { data: files, error: filesErr } = await db
    .from('filehub_files')
    .select('bucket, storage_path')
    .eq('company_id', companyId)
  if (filesErr) {
    summary.errors.push(`filehub_files lookup failed for ${companyId}: ${filesErr.message}`)
  } else {
    refs.push(...((files ?? []) as StorageRef[]))
  }

  const { data: versions, error: versionsErr } = await db
    .from('filehub_file_versions')
    .select('bucket, storage_path')
    .eq('company_id', companyId)
  if (versionsErr) {
    summary.errors.push(`filehub_file_versions lookup failed for ${companyId}: ${versionsErr.message}`)
  } else {
    refs.push(...((versions ?? []) as StorageRef[]))
  }

  const { error: purgeErr } = await db.rpc('fn_purge_company_data', { p_company_id: companyId })
  if (purgeErr) {
    summary.errors.push(`fn_purge_company_data failed for ${companyId}: ${purgeErr.message}`)
    return
  }
  summary.companies_purged += 1

  const byBucket = new Map<string, string[]>()
  for (const ref of refs) {
    const bucket = ref.bucket || 'filehub-files'
    if (!byBucket.has(bucket)) byBucket.set(bucket, [])
    byBucket.get(bucket)!.push(ref.storage_path)
  }

  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const batch = paths.slice(i, i + REMOVE_BATCH)
      const { data: removed, error: rmErr } = await db.storage.from(bucket).remove(batch)
      if (rmErr) {
        summary.errors.push(`storage remove failed for ${companyId} (${bucket}): ${rmErr.message}`)
        continue
      }
      summary.objects_removed += removed?.length ?? 0
    }
  }
}

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
