// ====================================================================
// purge-filehub-versions — FileHub + task-file version retention purge
// ====================================================================
//
// Deletes superseded FileHub file versions that have been non-current for
// more than 30 days, along with their storage objects. Triggered daily by a
// pg_cron job (see migration `schedule_purge_filehub_versions_daily`) which
// POSTs to this function via pg_net.
//
// Purge predicate for filehub_file_versions (the only rows that group ever
// touches):
//     superseded_at IS NOT NULL
//     AND superseded_at < now() - interval '30 days'
//     AND pinned = false
//
// The CURRENT version of every file has superseded_at IS NULL and is NEVER
// selected — guarded both by the SQL predicate and by an explicit in-code
// assertion before any delete. Versions marked `pinned = true` are likewise
// never purged, regardless of age — guarded the same way.
//
// FileHub unification Phase 4 (#153): task-file (brief attachment) versions
// never had ANY retention — task_attachment_versions.superseded_at was added
// by 20260709_task_attachment_versioning.sql with the comment "starts the
// (deferred) purge clock", but nothing ever consumed that clock, and a
// soft-deleted task_attachments row keeps its storage bytes forever ("Storage
// bytes intentionally kept — that's what makes recovery possible", see
// rpc_delete_task_attachment). This function now also purges, using the SAME
// 30-day retention:
//   - task_attachment_versions rows superseded > 30 days ago, whose parent
//     attachment is still live (a deleted parent is handled by the next
//     group instead, so its rows aren't half-purged out from under it).
//   - task_attachments rows soft-deleted > 30 days ago: every one of that
//     attachment's version storage objects is removed, then the row is
//     hard-deleted (ON DELETE CASCADE takes its task_attachment_versions
//     rows with it). Past this window `rpc_restore_task_attachment` simply
//     no-ops (row gone), the same as an expired FileHub Bin entry.
// These two groups never touch a row that's still within its 30-day window,
// so `rpc_task_attachment_versions`/`rpc_restore_task_attachment_version`
// keep working exactly as before for anything recent.
//
// !! SECRETS — set in Supabase Dashboard:
//    Project Settings → Edge Functions → Secrets
//
//   PURGE_FILEHUB_SECRET — shared secret. If set, callers must present
//                          `Authorization: Bearer <PURGE_FILEHUB_SECRET>`.
//                          The cron job reads the SAME value from Vault
//                          (vault.decrypted_secrets name 'purge_filehub_secret').
//                          Mirrors the process-notification-event pattern.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase Edge runtime and are used for the service-role DB/storage
// client (this is what lets the purge bypass RLS to delete version rows).
// ====================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Optional auth gate for pg_net trigger calls. Set PURGE_FILEHUB_SECRET in
// Edge Function secrets and store the same value in vault under the name
// 'purge_filehub_secret' so the cron job can include it.
const PURGE_FILEHUB_SECRET = Deno.env.get('PURGE_FILEHUB_SECRET') ?? ''

const RETENTION_DAYS = 30
const BATCH_SIZE = 100

interface Summary {
  eligible: number
  objects_removed: number
  rows_deleted: number
  batches: number
  task_versions_eligible: number
  task_versions_deleted: number
  task_attachments_eligible: number
  task_attachments_deleted: number
  errors: string[]
}

interface VersionRow {
  id: string
  file_id: string
  bucket: string
  storage_path: string
  superseded_at: string | null
  pinned: boolean
}

interface TaskAttachmentVersionRow {
  id: string
  attachment_id: string
  bucket: string
  storage_path: string | null
  superseded_at: string | null
}

interface TaskAttachmentRow {
  id: string
  deleted_at: string | null
}

serve(async (req: Request) => {
  if (PURGE_FILEHUB_SECRET) {
    const auth = req.headers.get('Authorization') ?? ''
    if (auth !== `Bearer ${PURGE_FILEHUB_SECRET}`) {
      return respond({ error: 'unauthorized' }, 401)
    }
  }

  const summary: Summary = {
    eligible: 0,
    objects_removed: 0,
    rows_deleted: 0,
    batches: 0,
    task_versions_eligible: 0,
    task_versions_deleted: 0,
    task_attachments_eligible: 0,
    task_attachments_deleted: 0,
    errors: [],
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

    await purgeFilehubFileVersions(db, cutoffIso, summary)
    await purgeSupersededTaskAttachmentVersions(db, cutoffIso, summary)
    await purgeDeletedTaskAttachments(db, cutoffIso, summary)

    console.log('[purge-filehub-versions]', JSON.stringify(summary))
    return respond(summary, 200)
  } catch (err) {
    console.error('[purge-filehub-versions]', err)
    summary.errors.push(String(err))
    return respond(summary, 500)
  }
})

// ── FileHub-native versions (unchanged behaviour) ───────────────────────────
async function purgeFilehubFileVersions(db: SupabaseClient, cutoffIso: string, summary: Summary): Promise<void> {
  // Loop in batches until no more eligible rows remain.
  // Each iteration re-queries from the top because deleted rows fall out of
  // the result set; ordering by superseded_at keeps progress deterministic.
  for (;;) {
    const { data, error } = await db
      .from('filehub_file_versions')
      .select('id, file_id, bucket, storage_path, superseded_at, pinned')
      .not('superseded_at', 'is', null) // superseded_at IS NOT NULL
      .eq('pinned', false) // never touch pinned versions
      .lt('superseded_at', cutoffIso) // superseded_at < now() - 30d
      .order('superseded_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (error) throw error

    const rows = (data ?? []) as VersionRow[]
    if (rows.length === 0) break

    summary.batches += 1
    summary.eligible += rows.length

    for (const row of rows) {
      // Hard guard: never act on a current version, regardless of the query.
      if (row.superseded_at === null) {
        summary.errors.push(`skip current version ${row.id} (superseded_at NULL)`)
        continue
      }
      // Hard guard: never act on a pinned version, regardless of the query.
      if (row.pinned) {
        summary.errors.push(`skip pinned version ${row.id}`)
        continue
      }

      const bucket = row.bucket || 'filehub-files'

      // 1) Remove the storage object first. Tolerate already-missing objects:
      //    storage.remove() does not error on a non-existent path, so a
      //    success response with no error means we can proceed to row delete.
      const { error: rmErr } = await db.storage.from(bucket).remove([row.storage_path])
      if (rmErr) {
        // Could not remove the object — do NOT delete the row, so the next
        // run retries (avoids orphaning a row whose bytes still exist).
        summary.errors.push(`object remove failed ${row.id} (${row.storage_path}): ${rmErr.message}`)
        continue
      }
      summary.objects_removed += 1

      // 2) Delete the version row. Re-assert the purge predicate in the WHERE
      //    clause so a row that became current between select and delete
      //    (e.g. a concurrent restore) is left untouched.
      const { data: deleted, error: delErr } = await db
        .from('filehub_file_versions')
        .delete()
        .eq('id', row.id)
        .not('superseded_at', 'is', null)
        .eq('pinned', false)
        .lt('superseded_at', cutoffIso)
        .select('id')

      if (delErr) {
        summary.errors.push(`row delete failed ${row.id}: ${delErr.message}`)
        continue
      }
      if ((deleted?.length ?? 0) > 0) {
        summary.rows_deleted += 1
      } else {
        summary.errors.push(`row ${row.id} not deleted (no longer purge-eligible)`)
      }
    }

    // Safety: if a whole batch produced no row deletions, stop to avoid an
    // infinite loop on persistently-failing rows.
    if (rows.length < BATCH_SIZE) break
  }
}

// ── Task-file (brief attachment) superseded versions, live parent only ─────
// A version whose parent attachment is already deleted is left for
// purgeDeletedTaskAttachments below, which purges the whole attachment (and
// therefore every one of its versions) in one pass instead of racing it here.
async function purgeSupersededTaskAttachmentVersions(
  db: SupabaseClient,
  cutoffIso: string,
  summary: Summary,
): Promise<void> {
  for (;;) {
    const { data, error } = await db
      .from('task_attachment_versions')
      .select('id, attachment_id, bucket, storage_path, superseded_at, task_attachments!inner(deleted_at)')
      .not('superseded_at', 'is', null)
      .lt('superseded_at', cutoffIso)
      .is('task_attachments.deleted_at', null)
      .order('superseded_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (error) throw error

    const rows = (data ?? []) as TaskAttachmentVersionRow[]
    if (rows.length === 0) break

    summary.batches += 1
    summary.task_versions_eligible += rows.length

    for (const row of rows) {
      // Hard guard: never act on a current version, regardless of the query.
      if (row.superseded_at === null) {
        summary.errors.push(`skip current task attachment version ${row.id} (superseded_at NULL)`)
        continue
      }

      if (row.storage_path) {
        const bucket = row.bucket || 'task-attachments'
        const { error: rmErr } = await db.storage.from(bucket).remove([row.storage_path])
        if (rmErr) {
          summary.errors.push(`object remove failed ${row.id} (${row.storage_path}): ${rmErr.message}`)
          continue
        }
        summary.objects_removed += 1
      }

      const { data: deleted, error: delErr } = await db
        .from('task_attachment_versions')
        .delete()
        .eq('id', row.id)
        .not('superseded_at', 'is', null)
        .lt('superseded_at', cutoffIso)
        .select('id')

      if (delErr) {
        summary.errors.push(`task attachment version delete failed ${row.id}: ${delErr.message}`)
        continue
      }
      if ((deleted?.length ?? 0) > 0) {
        summary.task_versions_deleted += 1
      } else {
        summary.errors.push(`task attachment version ${row.id} not deleted (no longer purge-eligible)`)
      }
    }

    if (rows.length < BATCH_SIZE) break
  }
}

// ── Task-file (brief attachment) soft-deleted past retention ───────────────
// Removes every version's storage object, then hard-deletes the attachment
// row — ON DELETE CASCADE takes its task_attachment_versions rows with it.
async function purgeDeletedTaskAttachments(db: SupabaseClient, cutoffIso: string, summary: Summary): Promise<void> {
  for (;;) {
    const { data, error } = await db
      .from('task_attachments')
      .select('id, deleted_at')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoffIso)
      .order('deleted_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (error) throw error

    const rows = (data ?? []) as TaskAttachmentRow[]
    if (rows.length === 0) break

    summary.batches += 1
    summary.task_attachments_eligible += rows.length

    for (const row of rows) {
      // Hard guard: never act on a live attachment, regardless of the query.
      if (row.deleted_at === null) {
        summary.errors.push(`skip live task attachment ${row.id} (deleted_at NULL)`)
        continue
      }

      const { data: versions, error: vErr } = await db
        .from('task_attachment_versions')
        .select('bucket, storage_path')
        .eq('attachment_id', row.id)

      if (vErr) {
        summary.errors.push(`version lookup failed for task attachment ${row.id}: ${vErr.message}`)
        continue
      }

      let removalFailed = false
      for (const v of (versions ?? []) as { bucket: string; storage_path: string | null }[]) {
        if (!v.storage_path) continue
        const bucket = v.bucket || 'task-attachments'
        const { error: rmErr } = await db.storage.from(bucket).remove([v.storage_path])
        if (rmErr) {
          summary.errors.push(`object remove failed for task attachment ${row.id} (${v.storage_path}): ${rmErr.message}`)
          removalFailed = true
          break
        }
        summary.objects_removed += 1
      }
      // Don't delete the row until every version's bytes are confirmed gone —
      // otherwise a retry would have no version rows left to find them by.
      if (removalFailed) continue

      // Re-assert the purge predicate so an attachment restored between
      // select and delete (e.g. a concurrent rpc_restore_task_attachment) is
      // left untouched.
      const { data: deleted, error: delErr } = await db
        .from('task_attachments')
        .delete()
        .eq('id', row.id)
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoffIso)
        .select('id')

      if (delErr) {
        summary.errors.push(`task attachment delete failed ${row.id}: ${delErr.message}`)
        continue
      }
      if ((deleted?.length ?? 0) > 0) {
        summary.task_attachments_deleted += 1
      } else {
        summary.errors.push(`task attachment ${row.id} not deleted (no longer purge-eligible)`)
      }
    }

    if (rows.length < BATCH_SIZE) break
  }
}

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
