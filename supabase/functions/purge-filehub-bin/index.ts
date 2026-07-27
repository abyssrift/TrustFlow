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
  bucket: string
  storage_path: string
}

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
    .neq('visibility', 'task') // task-file pointers are owned by the task, not the Bin — never purge them

  let folders = db.from('filehub_folders').select('id', { count: 'exact', head: true })
    .not('deleted_at', 'is', null).lt('deleted_at', cutoffIso).eq('company_id', companyId)
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
    if (scopeCompanyId) query = query.eq('company_id', scopeCompanyId)

    const { data, error } = await query
    if (error) throw error

    const rows = (data ?? []) as FileRow[]
    if (rows.length === 0) break

    summary.batches += 1
    summary.eligible += rows.length

    for (const row of rows) {
      if (!row.deleted_at) {
        summary.errors.push(`skip live file ${row.id} (deleted_at NULL)`)
        continue
      }

      const { data: versions, error: vErr } = await db
        .from('filehub_file_versions')
        .select('bucket, storage_path')
        .eq('file_id', row.id)

      if (vErr) {
        summary.errors.push(`version lookup failed ${row.id}: ${vErr.message}`)
        continue
      }

      let removalFailed = false
      for (const v of (versions ?? []) as VersionRow[]) {
        const bucket = v.bucket || 'filehub-files'
        const { error: rmErr } = await db.storage.from(bucket).remove([v.storage_path])
        if (rmErr) {
          summary.errors.push(`object remove failed ${row.id} (${v.storage_path}): ${rmErr.message}`)
          removalFailed = true
          break
        }
        summary.objects_removed += 1
      }

      if (removalFailed) continue

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
        onProgress?.()
      } else {
        summary.errors.push(`row ${row.id} not deleted (no longer purge-eligible)`)
      }
    }

    if (rows.length < BATCH_SIZE) break
  }

  // ── Folders ────────────────────────────────────────────────────────────
  // Leaf-to-root passes: only hard-delete a folder once no other folder still
  // references it as parent_id, so ON DELETE CASCADE never reaches a
  // descendant that isn't itself past the cutoff.
  for (;;) {
    let query = db
      .from('filehub_folders')
      .select('id')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoffIso)
      .limit(FOLDER_BATCH_SIZE)
    if (scopeCompanyId) query = query.eq('company_id', scopeCompanyId)

    const { data: candidates, error } = await query
    if (error) {
      summary.errors.push(`folder candidate query failed: ${error.message}`)
      break
    }
    if (!candidates || candidates.length === 0) break

    const ids = candidates.map((c: { id: string }) => c.id)
    const { data: childRows, error: childErr } = await db
      .from('filehub_folders')
      .select('parent_id')
      .in('parent_id', ids)

    if (childErr) {
      summary.errors.push(`folder child check failed: ${childErr.message}`)
      break
    }

    const blocked = new Set((childRows ?? []).map((r: { parent_id: string }) => r.parent_id))
    const leafIds = ids.filter((id: string) => !blocked.has(id))
    if (leafIds.length === 0) break // remaining candidates all have not-yet-eligible children

    const { error: delErr, count } = await db
      .from('filehub_folders')
      .delete({ count: 'exact' })
      .in('id', leafIds)

    if (delErr) {
      summary.errors.push(`folder delete failed: ${delErr.message}`)
      break
    }
    summary.folders_deleted += count ?? leafIds.length
    onProgress?.()
  }
}

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
