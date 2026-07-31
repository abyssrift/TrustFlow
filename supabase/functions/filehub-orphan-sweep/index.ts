// ====================================================================
// filehub-orphan-sweep — remove untracked storage objects
// ====================================================================
//
// A FileHub upload is two steps: the client uploads bytes to the
// `filehub-files` bucket, THEN calls rpc_filehub_upload_commit to write the
// DB row. If the client dies between those two steps (tab close, network
// drop, crash) the bytes sit in the bucket with no filehub_files row pointing
// at them — an orphan. The client tries a best-effort remove on commit
// failure, but that can't cover the process-death case. This function is the
// durable backstop: a daily sweep that deletes bucket objects nothing in the
// DB references.
//
// Triggered daily by a pg_cron job (see migration
// `20260720_filehub_orphan_object_sweep_schedule.sql`) which POSTs here via
// pg_net.
//
// DELETE PREDICATE — an object is removed ONLY if ALL hold:
//   1. It lives in the `filehub-files` bucket.
//   2. No public.filehub_files row has that storage_path       (any deleted_at).
//   3. No public.filehub_file_versions row has that storage_path (any state).
//   4. It was created more than ORPHAN_MIN_AGE_HOURS ago.
//
// (2)+(3) together are load-bearing: soft-deleted files still in the Bin, and
// every historical version, keep their bytes for restore — those objects are
// referenced and MUST NOT be swept. (4) avoids racing an in-flight upload
// whose commit simply hasn't happened yet.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the Edge runtime
// and drive the service-role client (bypasses RLS to list + remove objects).
// Optional FILEHUB_ORPHAN_SWEEP_SECRET gates the endpoint the same way the
// bin purge does (cron reads the matching value from Vault).
// ====================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Pure selection logic (age floor + referenced-set subtraction), unit-tested
// in logic.test.ts. Kept out of here so the delete predicate can be exercised
// against fixtures without any I/O.
import { ageCandidates, selectOrphans, type StorageObj } from './logic.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SWEEP_SECRET = Deno.env.get('FILEHUB_ORPHAN_SWEEP_SECRET') ?? ''

const BUCKET = 'filehub-files'
const ORPHAN_MIN_AGE_HOURS = 24
const LIST_PAGE = 100
// Reference lookups go out as `.in(...)` on a GET query string, and storage
// paths are long (`{uuid}/{uuid}/{name}`) with every `/` percent-encoded. At
// 100 per batch the URL blows past the ~8KB proxy limit and every batch 414s —
// which fails closed (batch treated as referenced, nothing deleted), so the
// sweep would silently no-op. 25 keeps the URL comfortably under the limit.
const REF_CHECK_BATCH = 25
const REMOVE_BATCH = 100
// Hard ceiling so one run can never enumerate an unbounded bucket. NOTE: the
// listing is deterministic (name asc from the root), so this is a truncation,
// not a cursor — objects beyond the ceiling are not "picked up next run", they
// are never swept until the bucket shrinks. Fail-safe (under-deletion). If a
// bucket ever legitimately exceeds this, make the walk resumable instead of
// just raising the number.
const MAX_OBJECTS = 50000

serve(async (req: Request) => {
  // Fail CLOSED — deletes storage objects, verify_jwt=false. An unset secret
  // must never open it.
  const auth = req.headers.get('Authorization') ?? ''
  if (!SWEEP_SECRET || auth !== `Bearer ${SWEEP_SECRET}`) {
    return respond({ error: 'unauthorized' }, 401)
  }

  // Dry run: report what WOULD be removed but delete nothing. Off by default so
  // the daily cron (which POSTs an empty body) performs the real sweep. Trigger
  // with `?dryRun=true` or a JSON body `{"dryRun":true}` for a safe inspection.
  const dryRun = await parseDryRun(req)

  const summary = {
    dry_run: dryRun,
    scanned: 0,
    orphans_found: 0,
    objects_removed: 0,
    too_recent_skipped: 0,
    sample: [] as string[],
    errors: [] as string[],
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const cutoffMs = Date.now() - ORPHAN_MIN_AGE_HOURS * 60 * 60 * 1000

    // 1. Enumerate every object in the bucket. Paths are
    //    `{company_id}/{file_id}/{filename}`, so recurse two prefix levels.
    const objects = await listAllObjects(db)
    summary.scanned = objects.length

    // 2. Candidate orphans = old enough to not be an in-flight upload.
    //    (Unknown/unparseable created_at counts as too-recent — never delete
    //    something we can't age-verify.)
    const { candidates, tooRecent } = ageCandidates(objects, cutoffMs)
    summary.too_recent_skipped = tooRecent

    // 3. Subtract every path referenced by a live/bin file OR any version.
    const referenced = await referencedPaths(db, candidates, summary)
    const orphans = selectOrphans(candidates, referenced)
    summary.orphans_found = orphans.length
    summary.sample = orphans.slice(0, 10)

    // Dry run stops here: we've computed exactly what would be deleted, but
    // touch nothing. objects_removed stays 0.
    if (dryRun) {
      console.log('[filehub-orphan-sweep] DRY RUN', JSON.stringify(summary))
      return respond(summary, 200)
    }

    // 4. Remove orphans in batches. storage.remove tolerates missing paths.
    //    Count what the API says it actually removed, not the batch size — a
    //    partial success would otherwise over-report.
    for (let i = 0; i < orphans.length; i += REMOVE_BATCH) {
      const batch = orphans.slice(i, i + REMOVE_BATCH)
      const { data: removed, error } = await db.storage.from(BUCKET).remove(batch)
      if (error) {
        summary.errors.push(`remove batch @${i} failed: ${error.message}`)
        continue
      }
      summary.objects_removed += removed?.length ?? 0
    }

    console.log('[filehub-orphan-sweep]', JSON.stringify(summary))
    return respond(summary, 200)
  } catch (err) {
    console.error('[filehub-orphan-sweep]', err)
    summary.errors.push(String(err))
    return respond(summary, 500)
  }
})

// Recursively list all file objects in the bucket (two prefix levels:
// company_id/ then file_id/). Returns full object paths + created_at.
async function listAllObjects(db: ReturnType<typeof createClient>): Promise<StorageObj[]> {
  const out: StorageObj[] = []

  const listDir = async (prefix: string): Promise<{ name: string; isFolder: boolean; created_at: string | null }[]> => {
    const entries: { name: string; isFolder: boolean; created_at: string | null }[] = []
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await db.storage.from(BUCKET).list(prefix, {
        limit: LIST_PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) throw error
      const page = data ?? []
      for (const e of page) {
        // Supabase marks folder placeholders with a null `id`; real objects
        // carry an id + metadata (created_at).
        const isFolder = (e as { id: string | null }).id === null
        entries.push({ name: e.name, isFolder, created_at: (e as { created_at: string | null }).created_at ?? null })
      }
      if (page.length < LIST_PAGE) break
    }
    return entries
  }

  const companies = await listDir('')
  for (const company of companies) {
    if (!company.isFolder) continue
    const fileDirs = await listDir(company.name)
    for (const fileDir of fileDirs) {
      if (!fileDir.isFolder) continue
      const files = await listDir(`${company.name}/${fileDir.name}`)
      for (const f of files) {
        if (f.isFolder) continue
        out.push({ path: `${company.name}/${fileDir.name}/${f.name}`, created_at: f.created_at })
        if (out.length >= MAX_OBJECTS) return out
      }
    }
  }
  return out
}

// Set of the given paths that ARE referenced by filehub_files.storage_path or
// filehub_file_versions.storage_path (any deleted_at / version state).
async function referencedPaths(
  db: ReturnType<typeof createClient>,
  paths: string[],
  summary: { errors: string[] },
): Promise<Set<string>> {
  const referenced = new Set<string>()
  for (let i = 0; i < paths.length; i += REF_CHECK_BATCH) {
    const batch = paths.slice(i, i + REF_CHECK_BATCH)

    const { data: files, error: fErr } = await db
      .from('filehub_files')
      .select('storage_path')
      .in('storage_path', batch)
    if (fErr) {
      // On lookup failure, conservatively treat the WHOLE batch as referenced
      // so we never delete something we couldn't verify.
      summary.errors.push(`files ref lookup @${i} failed: ${fErr.message}`)
      batch.forEach((p) => referenced.add(p))
      continue
    }
    ;(files ?? []).forEach((r: { storage_path: string }) => referenced.add(r.storage_path))

    const { data: versions, error: vErr } = await db
      .from('filehub_file_versions')
      .select('storage_path')
      .in('storage_path', batch)
    if (vErr) {
      summary.errors.push(`versions ref lookup @${i} failed: ${vErr.message}`)
      batch.forEach((p) => referenced.add(p))
      continue
    }
    ;(versions ?? []).forEach((r: { storage_path: string }) => referenced.add(r.storage_path))
  }
  return referenced
}

// dryRun from `?dryRun=true` (query) or `{"dryRun":true}` (JSON body). Tolerant
// of an empty/garbage body — the cron POSTs `{}`, which parses to live mode.
async function parseDryRun(req: Request): Promise<boolean> {
  try {
    const url = new URL(req.url)
    if ((url.searchParams.get('dryRun') ?? '').toLowerCase() === 'true') return true
  } catch { /* no-op */ }
  try {
    const body = await req.clone().json()
    return body?.dryRun === true
  } catch {
    return false
  }
}

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
