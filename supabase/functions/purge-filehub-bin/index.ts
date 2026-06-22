// ====================================================================
// purge-filehub-bin — FileHub Bin retention purge
// ====================================================================
//
// Permanently deletes FileHub files that have sat in the Bin for more than
// 15 days, along with every version's storage object. Triggered daily by a
// pg_cron job (see migration `20260622_filehub_bin_purge_schedule.sql`)
// which POSTs to this function via pg_net.
//
// Purge predicate (the ONLY rows this function ever touches):
//     filehub_files.deleted_at IS NOT NULL
//     AND filehub_files.deleted_at < now() - interval '15 days'
//
// Files that are merely "hidden" from someone's inbox (filehub_recipients.
// archived_at) are never selected here — hiding doesn't destroy any data,
// so there's nothing to purge; the Bin UI just stops listing them once
// archived_at falls outside the 15-day window.
//
// filehub_files.storage_path always mirrors the *current* filehub_file_versions
// row for that file (see 20260617_filehub_versioning.sql), so removing every
// version's storage object also covers the current one — no separate removal
// step needed. Deleting the filehub_files row cascades (ON DELETE CASCADE) to
// filehub_file_versions, filehub_recipients, and filehub_activity.
//
// !! SECRETS — set in Supabase Dashboard:
//    Project Settings → Edge Functions → Secrets
//
//   PURGE_FILEHUB_BIN_SECRET — shared secret. If set, callers must present
//                              `Authorization: Bearer <PURGE_FILEHUB_BIN_SECRET>`.
//                              The cron job reads the SAME value from Vault
//                              (vault.decrypted_secrets name 'purge_filehub_bin_secret').
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase Edge runtime and are used for the service-role DB/storage
// client (this is what lets the purge bypass RLS to delete rows).
// ====================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Optional auth gate for pg_net trigger calls. Set PURGE_FILEHUB_BIN_SECRET in
// Edge Function secrets and store the same value in vault under the name
// 'purge_filehub_bin_secret' so the cron job can include it.
const PURGE_FILEHUB_BIN_SECRET = Deno.env.get('PURGE_FILEHUB_BIN_SECRET') ?? ''

const RETENTION_DAYS = 15
const BATCH_SIZE = 50

interface FileRow {
  id: string
  deleted_at: string | null
}

interface VersionRow {
  bucket: string
  storage_path: string
}

serve(async (req: Request) => {
  if (PURGE_FILEHUB_BIN_SECRET) {
    const auth = req.headers.get('Authorization') ?? ''
    if (auth !== `Bearer ${PURGE_FILEHUB_BIN_SECRET}`) {
      return respond({ error: 'unauthorized' }, 401)
    }
  }

  const summary = {
    eligible: 0,
    objects_removed: 0,
    files_deleted: 0,
    batches: 0,
    errors: [] as string[],
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // Loop in batches until no more eligible rows remain. Each iteration
    // re-queries from the top since purged rows fall out of the result set.
    for (;;) {
      const { data, error } = await db
        .from('filehub_files')
        .select('id, deleted_at')
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoffIso)
        .order('deleted_at', { ascending: true })
        .limit(BATCH_SIZE)

      if (error) throw error

      const rows = (data ?? []) as FileRow[]
      if (rows.length === 0) break

      summary.batches += 1
      summary.eligible += rows.length

      for (const row of rows) {
        // Hard guard: never act on a live (non-deleted) file, regardless of the query.
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

        // Remove every version's storage object first. Tolerate already-missing
        // objects (storage.remove() does not error on a non-existent path).
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

        // If any object failed to remove, leave the row alone so the next run
        // retries — avoids orphaning bytes that still exist.
        if (removalFailed) continue

        // Delete the file row. Re-assert the purge predicate in the WHERE
        // clause so a row that was restored between select and delete (e.g.
        // a concurrent rpc_filehub_restore call) is left untouched.
        const { data: deleted, error: delErr } = await db
          .from('filehub_files')
          .delete()
          .eq('id', row.id)
          .not('deleted_at', 'is', null)
          .lt('deleted_at', cutoffIso)
          .select('id')

        if (delErr) {
          summary.errors.push(`row delete failed ${row.id}: ${delErr.message}`)
          continue
        }
        if ((deleted?.length ?? 0) > 0) {
          summary.files_deleted += 1
        } else {
          summary.errors.push(`row ${row.id} not deleted (no longer purge-eligible)`)
        }
      }

      if (rows.length < BATCH_SIZE) break
    }

    console.log('[purge-filehub-bin]', JSON.stringify(summary))
    return respond(summary, 200)
  } catch (err) {
    console.error('[purge-filehub-bin]', err)
    summary.errors.push(String(err))
    return respond(summary, 500)
  }
})

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
