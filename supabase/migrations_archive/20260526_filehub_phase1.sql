-- 20260526_filehub_phase1.sql
-- Phase 1: backend foundation for the File Hub (a.k.a. Resource Hub)
-- Locked decisions (Adam, 2026-05-26):
--   route       = /filehub
--   folders     = flat (no nesting in v1)
--   tags        = text[] column on filehub_files
--   dup hint    = soft, via content_hash lookup
--   visibility  = 'direct' | 'broadcast' (no auto-expiry, manual delete only)

-- ────────────────────────────────────────────────────────────────────────────
-- 1. PERMISSIONS
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.permissions (key, label, category) VALUES
    ('filehub:view',      'View File Hub',                   'filehub'),
    ('filehub:send',      'Send Files to Specific Members',  'filehub'),
    ('filehub:broadcast', 'Broadcast Files Company-Wide',    'filehub')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. TABLES
-- ────────────────────────────────────────────────────────────────────────────

-- 2a. Folders (flat, per-company)
CREATE TABLE IF NOT EXISTS public.filehub_folders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_filehub_folders_company ON public.filehub_folders(company_id);

-- 2b. Files
CREATE TABLE IF NOT EXISTS public.filehub_files (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    uploaded_by       UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
    storage_path      TEXT NOT NULL,           -- path inside the filehub-files bucket
    bucket            TEXT NOT NULL DEFAULT 'filehub-files',
    original_name     TEXT NOT NULL,
    mime_type         TEXT,
    size_bytes        BIGINT NOT NULL CHECK (size_bytes >= 0),
    content_hash      TEXT,                    -- sha256 hex for soft duplicate detection
    caption           TEXT,
    visibility        TEXT NOT NULL CHECK (visibility IN ('direct', 'broadcast')),
    folder_id         UUID REFERENCES public.filehub_folders(id) ON DELETE SET NULL,
    tags              TEXT[] NOT NULL DEFAULT '{}',
    replaces_file_id  UUID REFERENCES public.filehub_files(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ              -- soft delete
);
CREATE INDEX IF NOT EXISTS idx_filehub_files_company        ON public.filehub_files(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_filehub_files_uploader       ON public.filehub_files(uploaded_by) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_filehub_files_folder         ON public.filehub_files(folder_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_filehub_files_visibility     ON public.filehub_files(company_id, visibility) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_filehub_files_tags_gin       ON public.filehub_files USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_filehub_files_content_hash   ON public.filehub_files(company_id, content_hash) WHERE deleted_at IS NULL AND content_hash IS NOT NULL;

-- 2c. Recipients (only populated for visibility='direct')
CREATE TABLE IF NOT EXISTS public.filehub_recipients (
    file_id      UUID NOT NULL REFERENCES public.filehub_files(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    read_at      TIMESTAMPTZ,
    archived_at  TIMESTAMPTZ,                  -- per-recipient hide (doesn't affect sender)
    PRIMARY KEY (file_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_filehub_recipients_user ON public.filehub_recipients(user_id) WHERE archived_at IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.filehub_folders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filehub_files      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filehub_recipients ENABLE ROW LEVEL SECURITY;

-- Folders: visible to all company members
CREATE POLICY "filehub_folders_select_company" ON public.filehub_folders
    FOR SELECT USING (company_id = public.my_company_id());

-- Files: visible if uploader, OR broadcast within same company, OR you're a recipient
CREATE POLICY "filehub_files_select_visibility" ON public.filehub_files
    FOR SELECT USING (
        deleted_at IS NULL
        AND company_id = public.my_company_id()
        AND (
            uploaded_by = auth.uid()
            OR visibility = 'broadcast'
            OR EXISTS (
                SELECT 1 FROM public.filehub_recipients r
                WHERE r.file_id = filehub_files.id AND r.user_id = auth.uid()
            )
        )
    );

-- Recipients: see your own rows + sender sees rows for their files
CREATE POLICY "filehub_recipients_select_own_or_sender" ON public.filehub_recipients
    FOR SELECT USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.filehub_files f
            WHERE f.id = filehub_recipients.file_id AND f.uploaded_by = auth.uid()
        )
    );

-- All writes go through SECURITY DEFINER RPCs; no INSERT/UPDATE/DELETE policies.

-- ────────────────────────────────────────────────────────────────────────────
-- 4. STORAGE BUCKET
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('filehub-files', 'filehub-files', false, 524288000, NULL) -- 500MB cap, all mime types
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: signed URLs are gated by these policies.
-- Path convention: {company_id}/{file_id}/{filename}

DROP POLICY IF EXISTS "filehub_storage_select" ON storage.objects;
CREATE POLICY "filehub_storage_select" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'filehub-files'
        AND EXISTS (
            SELECT 1 FROM public.filehub_files f
            WHERE f.storage_path = storage.objects.name
              AND f.deleted_at IS NULL
              AND f.company_id = public.my_company_id()
              AND (
                  f.uploaded_by = auth.uid()
                  OR f.visibility = 'broadcast'
                  OR EXISTS (SELECT 1 FROM public.filehub_recipients r WHERE r.file_id = f.id AND r.user_id = auth.uid())
              )
        )
    );

DROP POLICY IF EXISTS "filehub_storage_insert" ON storage.objects;
CREATE POLICY "filehub_storage_insert" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'filehub-files'
        AND auth.uid() IS NOT NULL
        AND public.has_permission('filehub:view')
        -- Path must start with the user's company_id
        AND split_part(name, '/', 1) = public.my_company_id()::text
    );

DROP POLICY IF EXISTS "filehub_storage_delete" ON storage.objects;
CREATE POLICY "filehub_storage_delete" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'filehub-files'
        AND EXISTS (
            SELECT 1 FROM public.filehub_files f
            WHERE f.storage_path = storage.objects.name
              AND f.uploaded_by = auth.uid()
        )
    );

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RPCs
-- ────────────────────────────────────────────────────────────────────────────

-- 5a. List files for the given mode (inbox / sent / broadcast)
CREATE OR REPLACE FUNCTION public.rpc_filehub_list(
    p_mode      TEXT,                -- 'inbox' | 'sent' | 'broadcast'
    p_search    TEXT DEFAULT NULL,
    p_folder_id UUID DEFAULT NULL,
    p_tag       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_rows       JSONB;
    v_search     TEXT := NULLIF(trim(coalesce(p_search,'')), '');
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view File Hub.';
    END IF;
    IF p_mode NOT IN ('inbox','sent','broadcast') THEN
        RAISE EXCEPTION 'Invalid mode: %', p_mode;
    END IF;

    SELECT COALESCE(jsonb_agg(row_payload ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT
            f.created_at,
            jsonb_build_object(
                'id',             f.id,
                'original_name',  f.original_name,
                'mime_type',      f.mime_type,
                'size_bytes',     f.size_bytes,
                'content_hash',   f.content_hash,
                'caption',        f.caption,
                'visibility',     f.visibility,
                'storage_path',   f.storage_path,
                'bucket',         f.bucket,
                'tags',           f.tags,
                'created_at',     f.created_at,
                'folder', CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader', jsonb_build_object(
                    'id',         u.id,
                    'full_name',  u.full_name,
                    'avatar_url', u.avatar_url
                ),
                'recipient_state', CASE
                    WHEN p_mode = 'inbox' THEN jsonb_build_object(
                        'read_at',     r.read_at,
                        'archived_at', r.archived_at
                    )
                    ELSE NULL
                END,
                'recipients', CASE
                    WHEN p_mode = 'sent' THEN COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'user_id',    ru.id,
                            'full_name',  ru.full_name,
                            'avatar_url', ru.avatar_url,
                            'read_at',    rr.read_at
                        ))
                        FROM public.filehub_recipients rr
                        JOIN public.users ru ON ru.id = rr.user_id
                        WHERE rr.file_id = f.id
                    ), '[]'::jsonb)
                    ELSE NULL
                END,
                'recipient_count', (
                    SELECT COUNT(*) FROM public.filehub_recipients rc WHERE rc.file_id = f.id
                )
            ) AS row_payload
        FROM public.filehub_files f
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        LEFT JOIN public.users u            ON u.id  = f.uploaded_by
        LEFT JOIN public.filehub_recipients r
            ON r.file_id = f.id AND r.user_id = v_user_id
        WHERE f.deleted_at IS NULL
          AND f.company_id = v_company_id
          AND (
              (p_mode = 'inbox'     AND f.visibility = 'direct' AND r.user_id IS NOT NULL AND r.archived_at IS NULL)
              OR
              (p_mode = 'sent'      AND f.uploaded_by = v_user_id AND f.visibility = 'direct')
              OR
              (p_mode = 'broadcast' AND f.visibility = 'broadcast')
          )
          AND (p_folder_id IS NULL OR f.folder_id = p_folder_id)
          AND (p_tag       IS NULL OR p_tag = ANY (f.tags))
          AND (
              v_search IS NULL
              OR f.original_name ILIKE '%' || v_search || '%'
              OR f.caption       ILIKE '%' || v_search || '%'
              OR EXISTS (SELECT 1 FROM unnest(f.tags) t WHERE t ILIKE '%' || v_search || '%')
          )
    ) src;

    RETURN v_rows;
END;
$$;

-- 5b. Commit a file row after the client has uploaded the bytes to storage
CREATE OR REPLACE FUNCTION public.rpc_filehub_upload_commit(
    p_storage_path    TEXT,
    p_visibility      TEXT,                          -- 'direct' | 'broadcast'
    p_recipient_ids   UUID[] DEFAULT '{}',
    p_folder_id       UUID   DEFAULT NULL,
    p_tags            TEXT[] DEFAULT '{}',
    p_caption         TEXT   DEFAULT NULL,
    p_original_name   TEXT   DEFAULT NULL,
    p_mime_type       TEXT   DEFAULT NULL,
    p_size_bytes      BIGINT DEFAULT 0,
    p_content_hash    TEXT   DEFAULT NULL,
    p_replaces_file_id UUID  DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_file_id    UUID;
    v_clean_tags TEXT[];
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;

    IF p_visibility NOT IN ('direct','broadcast') THEN
        RAISE EXCEPTION 'Invalid visibility: %', p_visibility;
    END IF;
    IF p_visibility = 'broadcast' AND NOT public.has_permission('filehub:broadcast') THEN
        RAISE EXCEPTION 'You do not have permission to broadcast files.';
    END IF;
    IF p_visibility = 'direct' AND (p_recipient_ids IS NULL OR cardinality(p_recipient_ids) = 0) THEN
        RAISE EXCEPTION 'Direct sends require at least one recipient.';
    END IF;
    IF p_size_bytes > 524288000 THEN
        RAISE EXCEPTION 'File exceeds 500 MB limit.';
    END IF;
    IF p_original_name IS NULL OR length(trim(p_original_name)) = 0 THEN
        RAISE EXCEPTION 'Original filename is required.';
    END IF;
    IF p_storage_path IS NULL OR length(trim(p_storage_path)) = 0 THEN
        RAISE EXCEPTION 'Storage path is required.';
    END IF;

    -- Sanity check the folder belongs to this company
    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders WHERE id = p_folder_id AND company_id = v_company_id
    ) THEN
        RAISE EXCEPTION 'Folder does not exist in this company.';
    END IF;

    -- Validate recipients are in the same company
    IF p_visibility = 'direct' AND EXISTS (
        SELECT 1 FROM unnest(p_recipient_ids) rid
        WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = rid AND u.company_id = v_company_id)
    ) THEN
        RAISE EXCEPTION 'One or more recipients are not members of your company.';
    END IF;

    -- Clean tags (trim, lowercase, drop empties, dedupe)
    SELECT COALESCE(array_agg(DISTINCT lower(trim(t))) FILTER (WHERE length(trim(t)) > 0), '{}')
    INTO v_clean_tags
    FROM unnest(COALESCE(p_tags,'{}')) AS t;

    INSERT INTO public.filehub_files (
        company_id, uploaded_by, storage_path, bucket, original_name, mime_type,
        size_bytes, content_hash, caption, visibility, folder_id, tags, replaces_file_id
    ) VALUES (
        v_company_id, v_user_id, p_storage_path, 'filehub-files', p_original_name, p_mime_type,
        p_size_bytes, p_content_hash, NULLIF(trim(coalesce(p_caption,'')), ''),
        p_visibility, p_folder_id, v_clean_tags, p_replaces_file_id
    )
    RETURNING id INTO v_file_id;

    IF p_visibility = 'direct' THEN
        INSERT INTO public.filehub_recipients (file_id, user_id)
        SELECT v_file_id, rid
        FROM unnest(p_recipient_ids) AS rid
        WHERE rid <> v_user_id  -- never include the sender as a recipient
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_file_id;
END;
$$;

-- 5c. Soft-delete a file (uploader only)
CREATE OR REPLACE FUNCTION public.rpc_filehub_delete(p_file_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    UPDATE public.filehub_files
    SET deleted_at = now()
    WHERE id = p_file_id
      AND uploaded_by = v_user_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found or you are not the uploader.';
    END IF;
END;
$$;

-- 5d. Mark a direct file as read (recipient action)
CREATE OR REPLACE FUNCTION public.rpc_filehub_mark_read(p_file_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    UPDATE public.filehub_recipients
    SET read_at = COALESCE(read_at, now())
    WHERE file_id = p_file_id AND user_id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'You are not a recipient of this file.';
    END IF;
END;
$$;

-- 5e. Recipient hides a file from their inbox (sender still sees it)
CREATE OR REPLACE FUNCTION public.rpc_filehub_recipient_hide(p_file_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    UPDATE public.filehub_recipients
    SET archived_at = now()
    WHERE file_id = p_file_id AND user_id = v_user_id AND archived_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'You are not a recipient of this file, or it is already hidden.';
    END IF;
END;
$$;

-- 5f. Folder CRUD
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_create(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_id         UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    INSERT INTO public.filehub_folders (company_id, name, created_by)
    VALUES (v_company_id, trim(p_name), v_user_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_rename(p_id UUID, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
BEGIN
    UPDATE public.filehub_folders
    SET name = trim(p_name)
    WHERE id = p_id AND company_id = v_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Folder not found.';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_delete(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
BEGIN
    -- Files inside this folder become unfiled (folder_id := NULL via ON DELETE SET NULL)
    DELETE FROM public.filehub_folders WHERE id = p_id AND company_id = v_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Folder not found.';
    END IF;
END;
$$;

-- 5g. Soft duplicate detection — does any non-deleted file in this company have the same content_hash?
CREATE OR REPLACE FUNCTION public.rpc_filehub_check_duplicate(p_content_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_rows JSONB;
BEGIN
    IF p_content_hash IS NULL OR length(p_content_hash) = 0 THEN
        RETURN '[]'::jsonb;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',            f.id,
        'original_name', f.original_name,
        'size_bytes',    f.size_bytes,
        'created_at',    f.created_at,
        'uploader_name', u.full_name
    )), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_files f
    LEFT JOIN public.users u ON u.id = f.uploaded_by
    WHERE f.company_id = v_company_id
      AND f.content_hash = p_content_hash
      AND f.deleted_at IS NULL
    LIMIT 5;
    RETURN v_rows;
END;
$$;

-- 5h. Tag autocomplete — distinct tags in this company matching the prefix
CREATE OR REPLACE FUNCTION public.rpc_filehub_tag_suggestions(p_prefix TEXT DEFAULT NULL, p_limit INT DEFAULT 12)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_prefix     TEXT := lower(trim(coalesce(p_prefix,'')));
    v_tags       TEXT[];
BEGIN
    SELECT array_agg(t ORDER BY t)
    INTO v_tags
    FROM (
        SELECT DISTINCT unnest(f.tags) AS t
        FROM public.filehub_files f
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
    ) all_tags
    WHERE v_prefix = '' OR t LIKE v_prefix || '%'
    LIMIT GREATEST(p_limit, 1);
    RETURN COALESCE(v_tags, '{}'::text[]);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. GRANTS — the RPCs are SECURITY DEFINER, but authenticated role still needs EXECUTE
-- ────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.rpc_filehub_list(TEXT, TEXT, UUID, TEXT)                                                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_upload_commit(TEXT, TEXT, UUID[], UUID, TEXT[], TEXT, TEXT, TEXT, BIGINT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_delete(UUID)                                                                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_mark_read(UUID)                                                                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_recipient_hide(UUID)                                                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_create(TEXT)                                                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_rename(UUID, TEXT)                                                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_delete(UUID)                                                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_check_duplicate(TEXT)                                                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_tag_suggestions(TEXT, INT)                                                            TO authenticated;
