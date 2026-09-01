// filehub-share-resolve
// Public endpoint (verify_jwt = false) — resolves a FileHub share-link token
// into fresh short-lived signed download URL(s), for the public /share/[token]
// web page. This is the ONLY code path that lets a logged-out visitor read a
// FileHub file, so every check here (revoked, expired, soft-deleted) IS the
// security boundary — the table's own RLS only lets the creator see their
// own links, which is irrelevant to this flow since it runs as service role.
//
// A link targets EXACTLY one of file_id / folder_id (DB check constraint).
//
// GET /filehub-share-resolve?token=<hex token>
//   file link   → 200 { kind: 'file',   name, mime_type, size_bytes, signed_url, download_allowed, expires_at }
//   folder link → 200 { kind: 'folder', name, expires_at, download_allowed, items: [{ name, mime_type, size_bytes, signed_url, path }] }
//   400 missing token · 404 unknown/deleted target · 410 expired/revoked
//
// download_allowed (20260901, #37) is enforced HERE, not just in the client:
// when a link was created with downloads off, no signed_url is ever minted --
// items/files come back with signed_url: null so a view-only link can never
// actually hand out file bytes.
//
// Folder links recurse into nested subfolders (20260901, #37) instead of only
// listing files directly inside the shared folder. Each item's `path` is its
// location relative to the shared folder root ('' for a direct child).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// The signed URL only needs to live long enough for the visitor's browser to
// start the download after this response arrives.
const SIGNED_URL_TTL_SECONDS = 300

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token) return respond({ error: 'missing_token' }, 400)

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const { data: link, error: linkErr } = await db
    .from('filehub_share_links')
    .select('id, file_id, folder_id, expires_at, revoked_at, view_count, download_allowed')
    .eq('token', token)
    .maybeSingle()

  if (linkErr || !link) return respond({ error: 'not_found' }, 404)
  if (link.revoked_at) return respond({ error: 'revoked' }, 410)
  if (new Date(link.expires_at).getTime() < Date.now()) return respond({ error: 'expired' }, 410)

  // A view is a view whether the target resolves or not below; bump once here.
  const bumpView = () =>
    db.from('filehub_share_links')
      .update({ view_count: link.view_count + 1, last_viewed_at: new Date().toISOString() })
      .eq('id', link.id)

  // ── Folder link → resolve every (non-deleted) file in the folder AND its
  // nested subfolders ──────────────────────────────────────────────────────
  if (link.folder_id) {
    const { data: folder, error: folderErr } = await db
      .from('filehub_folders')
      .select('name, deleted_at')
      .eq('id', link.folder_id)
      .maybeSingle()

    if (folderErr || !folder || folder.deleted_at) return respond({ error: 'not_found' }, 404)

    // BFS down filehub_folders. Path is relative to the shared root: '' for
    // a direct child, 'Sub/Nested' for a file two folders down.
    const pathById = new Map<string, string>([[link.folder_id, '']])
    let frontier = [link.folder_id]
    while (frontier.length) {
      const { data: children, error: childErr } = await db
        .from('filehub_folders')
        .select('id, name, parent_id')
        .in('parent_id', frontier)
        .is('deleted_at', null)
      if (childErr) return respond({ error: 'storage_error' }, 500)
      const next: string[] = []
      for (const c of children ?? []) {
        const parentPath = pathById.get(c.parent_id as string) ?? ''
        pathById.set(c.id, parentPath ? `${parentPath}/${c.name}` : c.name)
        next.push(c.id)
      }
      frontier = next
    }

    const folderIds = Array.from(pathById.keys())
    const { data: files, error: filesErr } = await db
      .from('filehub_files')
      .select('folder_id, original_name, mime_type, size_bytes, bucket, storage_path')
      .in('folder_id', folderIds)
      .is('deleted_at', null)
      .order('original_name', { ascending: true })

    if (filesErr) return respond({ error: 'storage_error' }, 500)

    const items = await Promise.all(
      (files ?? []).map(async (f) => {
        const base = { name: f.original_name, mime_type: f.mime_type, size_bytes: f.size_bytes, path: pathById.get(f.folder_id as string) ?? '' }
        if (!link.download_allowed) return { ...base, signed_url: null }
        const { data: signed } = await db.storage
          .from(f.bucket || 'filehub-files')
          .createSignedUrl(f.storage_path, SIGNED_URL_TTL_SECONDS)
        return signed?.signedUrl ? { ...base, signed_url: signed.signedUrl } : null
      })
    )

    await bumpView()

    return respond({
      kind: 'folder',
      name: folder.name,
      expires_at: link.expires_at,
      download_allowed: link.download_allowed,
      items: items.filter(Boolean),
    }, 200)
  }

  // ── File link (default / legacy) ───────────────────────────────────────────
  const { data: file, error: fileErr } = await db
    .from('filehub_files')
    .select('original_name, mime_type, size_bytes, bucket, storage_path, deleted_at')
    .eq('id', link.file_id)
    .maybeSingle()

  if (fileErr || !file || file.deleted_at) return respond({ error: 'not_found' }, 404)

  let signedUrl: string | null = null
  if (link.download_allowed) {
    const { data: signed, error: signErr } = await db.storage
      .from(file.bucket || 'filehub-files')
      .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS)
    if (signErr || !signed) return respond({ error: 'storage_error' }, 500)
    signedUrl = signed.signedUrl
  }

  await bumpView()

  return respond({
    kind: 'file',
    name: file.original_name,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    signed_url: signedUrl,
    download_allowed: link.download_allowed,
    expires_at: link.expires_at,
  }, 200)
})

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
