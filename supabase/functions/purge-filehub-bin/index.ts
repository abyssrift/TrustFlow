// ====================================================================
// purge-filehub-bin — FileHub Bin retention purge
// ====================================================================
//
// Two ways in:
//
// 1. CRON MODE (unchanged behaviour): pg_cron POSTs here daily with
//    `Authorization: Bearer <PURGE_FILEHUB_BIN_SECRET>` (see migration
//    `20260622_filehub_bin_purge_schedule.sql`). Purges every company's Bin
//    down to the 15-day retention window and returns ONE buffered JSON
//    summary — pg_net stores the response body, so no streaming there.
//
// 2. INSTANT MODE (#55 "empty the bin now" button): the client calls this
//    function with the CALLING USER's own session JWT and `{ mode: 'instant' }`
//    in the body. The JWT is handed to `rpc_filehub_bin_empty_authorize()`,
//    which raises unless the caller is the company owner or holds the
//    `filehub:bin_empty` permission (seeded onto the Owner/Admin system roles
//    — see `20260719_filehub_bin_empty_permission.sql`). On success it purges
//    ONLY that caller's OWN company, with no age cutoff, and STREAMS progress
//    back as newline-delimited JSON so the client can drive a live progress
//    island (same UX as uploads):
//        {"type":"start","total":N}
//        {"type":"progress","files_deleted":X,"folders_deleted":Y,"total":N}
//        {"type":"done", ...summary}
//        {"type":"error","error":"…"}   (fatal; ends the stream)
//
// Purge predicate for files (either mode):
//     filehub_files.deleted_at IS NOT NULL AND deleted_at < <cutoff>
//     (cutoff = now() - 15 days for cron, now() for instant)
//
// Files that are merely "hidden" from someone's inbox (filehub_recipients.
// archived_at) are never selected here — hiding doesn't destroy any data, so
// there's nothing to purge; the Bin UI just stops listing them once
// archived_at falls outside the 15-day window.
//
// filehub_files.storage_path always mirrors the *current* filehub_file_versions
// row for that file (see 20260617_filehub_versioning.sql), so removing every
// version's storage object also covers the current one — no separate removal
// step needed. Deleting the filehub_files row cascades (ON DELETE CASCADE) to
// filehub_file_versions, filehub_recipients, and filehub_activity.
//
// Folders (both modes): filehub_folders past the same cutoff are hard-deleted
// too. filehub_folders.parent_id is ON DELETE CASCADE, so hard-deleting a
// folder wipes descendant folder rows regardless of THEIR eligibility — to
// avoid prematurely destroying a descendant that isn't past its own cutoff
// yet, we only ever hard-delete a folder once it has no remaining child
// folder rows, repeating leaf-to-root until nothing more is safely purgeable.
//
// !! SECRETS — Project Settings → Edge Functions → Secrets
//   PURGE_FILEHUB_BIN_SECRET — shared secret for cron mode. If set, cron
//     calls present it as a Bearer token (cron reads the same value from
//     Vault, name 'purge_filehub_bin_secret'). Any OTHER bearer token is
//     treated as a user session JWT for instant mode.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are injected
// by the Edge runtime.
// ====================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const PURGE_FILEHUB_BIN_SECRET = Deno.env.get('PURGE_FILEHUB_BIN_SECRET') ?? ''

const RETENTION_DAYS = 15
const BATCH_SIZE = 50
const FOLDER_BATCH_SIZE = 200

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface FileRow {
  id: string
  deleted_at: string | null
}

interface VersionRow {
  id: string
  bucket: string
  storage_path: string
}

type PathClaim = { bucket: string; storage_path: string }

type Summary = {
  mode: 'cron' | 'instant'
  eligible: number
  objects_removed: number
  files_deleted: number
  folders_deleted: number
  batches: number
  errors: string[]
}

serve(async (req: Request) => {
  // Browser calls (instant mode) send a CORS preflight; without this the
  // whole request is blocked before it ever runs.
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.replace(/^Bearer\s+/i, '')

  let body: { mode?: string } = {}
  try {
    body = await req.json()
  } catch {
    // no/invalid body is fine for cron mode
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const isCron = PURGE_FILEHUB_BIN_SECRET.length > 0 && bearer === PURGE_FILEHUB_BIN_SECRET
  let scopeCompanyId: string | null = null
  let cutoffIso: string

  if (isCron) {
    cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  } else {
    if (body.mode !== 'instant' || !bearer) {
      return respond({ error: 'unauthorized' }, 401)
    }
    // Verify the caller's own session JWT and get their company via the
    // existing has_permission()/is_owner-backed RPC — no permission logic
    // duplicated here.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    })
    const { data: companyId, error: authErr } = await userClient.rpc('rpc_filehub_bin_empty_authorize')
    if (authErr || !companyId) {
      return respond({ error: authErr?.message ?? 'unauthorized' }, 403)
    }
    scopeCompanyId = companyId as string
    cutoffIso = new Date().toISOString()
  }

  // ── Cron mode: run to completion, return a single buffered summary ─────────
  if (isCron) {
    const summary = newSummary('cron')
    try {
      await purge(db, scopeCompanyId, cutoffIso, summary)
    } catch (err) {
      summary.errors.push(String(err))
      console.error('[purge-filehub-bin]', err)
      console.log('[purge-filehub-bin]', JSON.stringify(summary))
      return respond(summary, 500)
    }
    console.log('[purge-filehub-bin]', JSON.stringify(summary))
    return respond(summary, 200)
  }

  // ── Instant mode: stream NDJSON progress so the client can show live UI ────
  const summary = newSummary('instant')
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      try {
        const total = await countBin(db, scopeCompanyId!, cutoffIso)
        send({ type: 'start', total })

        let lastEmit = 0
        const onProgress = () => {
          const now = Date.now()
          // Throttle to ~150ms so a big bin doesn't flood the socket.
          if (now - lastEmit < 150) return
          lastEmit = now
          send({
            type: 'progress',
            files_deleted: summary.files_deleted,
            folders_deleted: summary.folders_deleted,
            total,
          })
        }

        await purge(db, scopeCompanyId, cutoffIso, summary, onProgress)
        send({ type: 'done', ...summary })
      } catch (err) {
        console.error('[purge-filehub-bin]', err)
        summary.errors.push(String(err))
        send({ type: 'error', error: String(err), ...summary })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson', ...CORS },
  })
})

function newSummary(mode: 'cron' | 'instant'): Summary {
  return { mode, eligible: 0, objects_removed: 0, files_deleted: 0, folders_deleted: 0, batches: 0, errors: [] }
}

// Count files + folders currently eligible, for the progress denominator.
async function countBin(db: SupabaseClient, companyId: string, cutoffIso: string): Promise<number> {
  let files = db.from('filehub_files').select('id', { count: 'exact', head: true })
    .not('deleted_at', 'is', null).lt('deleted_at', cutoffIso).eq('company_id', companyId)
    .neq('visibility', 'project')
    .neq('visibility', 'task') // task-file pointers are owned by the task, not the Bin — never purge them

  let folders = db.from('filehub_folders').select('id', { count: 'exact', head: true })
    .not('deleted_at', 'is', null).lt('deleted_at', cutoffIso).eq('company_id', companyId)
    .is('project_id', null) // project workspace folders have their own lifecycle
  const [f, d] = await Promise.all([files, folders])
  return (f.count ?? 0) + (d.count ?? 0)
}

// The actual purge. Shared by both modes; onProgress (optional) is called
// after each file and each folder batch so the streaming caller can report.
async function purge(
  db: SupabaseClient,
  scopeCompanyId: string | null,
  cutoffIso: string,
  summary: Summary,
  onProgress?: () => void,
): Promise<void> {
  // ── Files ──────────────────────────────────────────────────────────────
  for (;;) {
    let query = db
      .from('filehub_files')
      .select('id, deleted_at')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoffIso)
      .neq('visibility', 'task') // task-file pointers are owned by the task, not the Bin — never purge them
      .order('deleted_at', { ascending: true })
      .limit(BATCH_SIZE)
      .neq('visibility', 'project')
    if (scopeCompanyId) query = query.eq('company_id', scopeCompanyId)

    const { data, error } = await query
    if (error) throw error

    const rows = (data ?? []) as FileRow[]
    if (rows.length === 0) break

    summary.batches += 1
    summary.eligible += rows.length
    let batchDeleted = false

    for (const row of rows) {
      if (!row.deleted_at) {
        summary.errors.push(`skip live file ${row.id} (deleted_at NULL)`)
        continue
      }

      const { data: safe, error: safetyErr } = await db.rpc('filehub_purge_is_safe', {
        p_file_id: row.id,
        p_version_id: null,
      })
      if (safetyErr || safe !== true) {
        summary.errors.push(`skip referenced FileHub file ${row.id}${safetyErr ? `: ${safetyErr.message}` : ''}`)
        continue
      }

      const { data: versions, error: vErr } = await db
        .from('filehub_file_versions')
        .select('id, bucket, storage_path')
        .eq('file_id', row.id)

      if (vErr) {
        summary.errors.push(`version lookup failed ${row.id}: ${vErr.message}`)
        continue
      }

      const versionRows = (versions ?? []) as VersionRow[]
      const claims: PathClaim[] = []
      const claimedKeys = new Set<string>()
      let claimFailed = false
      for (const v of versionRows) {
        const bucket = v.bucket || 'filehub-files'
        const key = `${bucket}\u0000${v.storage_path}`
        if (claimedKeys.has(key)) continue
        const { data: claimed, error: claimErr } = await db.rpc('rpc_filehub_purge_claim_target', {
          p_bucket: bucket,
          p_storage_path: v.storage_path,
          p_file_id: row.id,
          // This is a whole-file purge. The version id is used below for
          // per-version safety checks, but passing it here would make the
          // claim predicate treat the file's own other versions as external
          // owners and prevent the whole-file claim from succeeding.
          p_version_id: null,
        })
        if (claimErr || claimed !== true) {
          summary.errors.push(`skip claimed or referenced FileHub path ${v.storage_path}${claimErr ? `: ${claimErr.message}` : ''}`)
          claimFailed = true
          break
        }
        claimedKeys.add(key)
        claims.push({ bucket, storage_path: v.storage_path })

        const { data: safeVersion, error: versionSafetyErr } = await db.rpc('filehub_purge_is_safe', {
          p_file_id: row.id,
          p_version_id: v.id,
        })
        if (versionSafetyErr || safeVersion !== true) {
          summary.errors.push(`skip referenced FileHub version ${v.id}${versionSafetyErr ? `: ${versionSafetyErr.message}` : ''}`)
          claimFailed = true
          break
        }
      }
      if (claimFailed) {
        await releaseClaims(db, claims, summary)
        continue
      }

      let removalFailed = false
      const removedKeys = new Set<string>()
      for (const claim of claims) {
        const key = `${claim.bucket}\u0000${claim.storage_path}`
        const { error: rmErr } = await db.storage.from(claim.bucket).remove([claim.storage_path])
        if (rmErr) {
          summary.errors.push(`object remove failed ${row.id} (${claim.storage_path}): ${rmErr.message}`)
          removalFailed = true
          break
        }
        removedKeys.add(key)
        summary.objects_removed += 1
      }

      if (removalFailed) {
        await releaseClaims(db, claims, summary, removedKeys)
        continue
      }

      let unsafeAfter = false
      for (const v of versionRows) {
        const { data: safeAfter, error: safetyAfterErr } = await db.rpc('filehub_purge_is_safe', {
          p_file_id: row.id,
          p_version_id: v.id,
        })
        if (safetyAfterErr || safeAfter !== true) {
          summary.errors.push(`skip FileHub row delete after recheck ${row.id} version ${v.id}${safetyAfterErr ? `: ${safetyAfterErr.message}` : ''}`)
          unsafeAfter = true
          break
        }
      }
      if (unsafeAfter) {
        continue
      }

      // Re-assert the purge predicate so a row restored between select and
      // delete (e.g. a concurrent rpc_filehub_restore call) is left alone.
      let delQuery = db
        .from('filehub_files')
        .delete()
        .eq('id', row.id)
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoffIso)
        .select('id')
      if (scopeCompanyId) delQuery = delQuery.eq('company_id', scopeCompanyId)

      const { data: deleted, error: delErr } = await delQuery
      if (delErr) {
        summary.errors.push(`row delete failed ${row.id}: ${delErr.message}`)
        continue
      }
      if ((deleted?.length ?? 0) > 0) {
        summary.files_deleted += 1
        batchDeleted = true
        await releaseClaims(db, claims, summary)
        onProgress?.()
      } else {
        summary.errors.push(`row ${row.id} not deleted (no longer purge-eligible)`)
      }
    }

    if (rows.length < BATCH_SIZE || !batchDeleted) break
  }

  // ── Folders ────────────────────────────────────────────────────────────
  // Leaf-to-root passes: only hard-delete a folder once no other folder still
  // references it as parent_id, so ON DELETE CASCADE never reaches a
  // descendant that isn't itself past the cutoff.
  for (;;) {
    const { data: deletedCount, error } = await db.rpc('rpc_filehub_purge_folder_leaf_batch', {
      p_cutoff: cutoffIso,
      p_company_id: scopeCompanyId,
      p_limit: FOLDER_BATCH_SIZE,
    })
    if (error) {
      summary.errors.push(`folder candidate query failed: ${error.message}`)
      break
    }
    const count = Number(deletedCount ?? 0)
    if (count === 0) break
    summary.batches += 1
    summary.eligible += count
    summary.folders_deleted += count
    onProgress?.()
  }
}

async function releaseClaims(
  db: SupabaseClient,
  claims: PathClaim[],
  summary: Summary,
  keep: Set<string> = new Set(),
): Promise<void> {
  for (const claim of claims) {
    const key = `${claim.bucket}\u0000${claim.storage_path}`
    if (keep.has(key)) continue
    const { error } = await db.rpc('rpc_filehub_purge_release', {
      p_bucket: claim.bucket,
      p_storage_path: claim.storage_path,
    })
    if (error) summary.errors.push(`purge claim release failed (${claim.storage_path}): ${error.message}`)
  }
}

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
