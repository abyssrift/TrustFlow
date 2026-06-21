// ====================================================================
// purge-filehub-versions — FileHub version retention purge (Phase 2)
// ====================================================================
//
// Deletes superseded FileHub file versions that have been non-current for
// more than 30 days, along with their storage objects. Triggered daily by a
// pg_cron job (see migration `schedule_purge_filehub_versions_daily`) which
// POSTs to this function via pg_net.
//
// Purge predicate (the ONLY rows this function ever touches):
//     superseded_at IS NOT NULL
//     AND superseded_at < now() - interval '30 days'
//     AND pinned = false
//
// The CURRENT version of every file has superseded_at IS NULL and is NEVER
// selected — guarded both by the SQL predicate and by an explicit in-code
// assertion before any delete. Versions marked `pinned = true` are likewise
// never purged, regardless of age — guarded the same way.
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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Optional auth gate for pg_net trigger calls. Set PURGE_FILEHUB_SECRET in
// Edge Function secrets and store the same value in vault under the name
// 'purge_filehub_secret' so the cron job can include it.
const PURGE_FILEHUB_SECRET = Deno.env.get('PURGE_FILEHUB_SECRET') ?? ''

const RETENTION_DAYS = 30
const BATCH_SIZE = 100

interface VersionRow {
  id: string
  file_id: string
  bucket: string
  storage_path: string
  superseded_at: string | null
  pinned: boolean
}

serve(async (req: Request) => {
  if (PURGE_FILEHUB_SECRET) {
    const auth = req.headers.get('Authorization') ?? ''
    if (auth !== `Bearer ${PURGE_FILEHUB_SECRET}`) {
      return respond({ error: 'unauthorized' }, 401)
    }
  }

  const summary = {
    eligible: 0,
    objects_removed: 0,
    rows_deleted: 0,
    batches: 0,
    errors: [] as string[],
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // Loop in batches until no more eligible rows remain.
    // Each iteration re-queries from the top because deleted rows fall out of
    // the result set; ordering by superseded_at keeps progress deterministic.
    for (;;) {
      const { data, error } = await db
        .from('filehub_file_versions')
        .select('id, file_id, bucket, storage_path, superseded_at, pinned')
        .not('superseded_at', 'is', null)        // superseded_at IS NOT NULL
        .eq('pinned', false)                      // never touch pinned versions
        .lt('superseded_at', cutoffIso)          // superseded_at < now() - 30d
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

    console.log('[purge-filehub-versions]', JSON.stringify(summary))
    return respond(summary, 200)
  } catch (err) {
    console.error('[purge-filehub-versions]', err)
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
