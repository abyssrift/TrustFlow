-- 20260617_filehub_versioning.sql
-- FileHub Version Control — Phase 1 (Database)
-- Model B: pointer + immutable versions.
--   * filehub_file_versions holds immutable content records.
--   * filehub_files.current_version_id points at the live version (superseded_at IS NULL).
--   * Replace  = insert new version, point current_version_id at it, supersede the old.
--   * Restore  = move the pointer (no byte copy, no new row).
--   * Denormalized live-row fields (storage_path/original_name/size_bytes/mime_type/content_hash)
--     always mirror the current version.
-- Conflict/replace/restore scope:
--   group     -> any member of the file's group (collaborative)
--   broadcast -> filehub:broadcast permission (collaborative)
--   direct    -> owner-only (uploaded_by = auth.uid())
-- Name match is case-insensitive on the trimmed name.
--
-- Wrapped in a single transaction so a mid-way failure rolls back cleanly with
-- no partial state. Strictly additive / non-destructive: only CREATE [OR REPLACE],
-- ADD COLUMN IF NOT EXISTS, DROP POLICY ... / CREATE POLICY, DROP FUNCTION (to
-- change a signature, immediately re-created), and a guarded one-time backfill
-- that only INSERTs version rows and UPDATEs current_version_id where it is NULL.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1.1 SCHEMA: filehub_file_versions
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.filehub_file_versions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id        UUID NOT NULL REFERENCES public.filehub_files(id) ON DELETE CASCADE,
    company_id     UUID NOT NULL REFERENCES public.companies(id),
    version_no     INT  NOT NULL,
    storage_path   TEXT NOT NULL,
    bucket         TEXT NOT NULL DEFAULT 'filehub-files',
    original_name  TEXT NOT NULL,
    size_bytes     BIGINT NOT NULL,
    mime_type      TEXT,
    content_hash   TEXT,
    created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at  TIMESTAMPTZ,            -- NULL = current version; non-null starts 30-day purge clock
    UNIQUE (file_id, version_no)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_filehub_versions_file
    ON public.filehub_file_versions(file_id, version_no);
CREATE INDEX IF NOT EXISTS idx_filehub_versions_purge
    ON public.filehub_file_versions(superseded_at) WHERE superseded_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_filehub_versions_company
    ON public.filehub_file_versions(company_id);

-- filehub_files additions
ALTER TABLE public.filehub_files
    ADD COLUMN IF NOT EXISTS current_version_id UUID REFERENCES public.filehub_file_versions(id),
    ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_by         UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 1.3 RLS on filehub_file_versions
--   SELECT only; all writes via SECURITY DEFINER RPCs; purge uses service role.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.filehub_file_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "filehub_versions_select" ON public.filehub_file_versions;
CREATE POLICY "filehub_versions_select" ON public.filehub_file_versions
    FOR SELECT USING (
        company_id = public.my_company_id()
        AND public.has_permission('filehub:view')
    );

-- ────────────────────────────────────────────────────────────────────────────
-- 1.2 BACKFILL: one current v1 per existing file (idempotent)
--   Covers ALL files (live + soft-deleted) so the invariant holds universally.
-- ────────────────────────────────────────────────────────────────────────────
DO $backfill$
BEGIN
    -- Insert a v1 version for every file that doesn't yet have a current_version_id.
    INSERT INTO public.filehub_file_versions (
        file_id, company_id, version_no, storage_path, bucket,
        original_name, size_bytes, mime_type, content_hash, created_by,
        created_at, superseded_at
    )
    SELECT
        f.id, f.company_id, 1, f.storage_path, COALESCE(f.bucket, 'filehub-files'),
        f.original_name, f.size_bytes, f.mime_type, f.content_hash, f.uploaded_by,
        f.created_at, NULL
    FROM public.filehub_files f
    WHERE f.current_version_id IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.filehub_file_versions v
          WHERE v.file_id = f.id AND v.version_no = 1
      );

    -- Point each file at its current (superseded_at IS NULL) version.
    UPDATE public.filehub_files f
    SET current_version_id = v.id
    FROM public.filehub_file_versions v
    WHERE v.file_id = f.id
      AND v.superseded_at IS NULL
      AND f.current_version_id IS NULL;
END;
$backfill$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1.4 STORAGE SELECT policy rewrite
--   An object is readable if a live file row with that storage_path is accessible,
--   OR a version row with that storage_path whose parent live file is accessible.
--   Both branches share the same accessibility predicate (factored into a helper).
-- ────────────────────────────────────────────────────────────────────────────

-- Accessibility helper: is the given live filehub_files row visible to the caller?
-- (same audience: uploader OR broadcast OR direct-recipient OR group-member,
--  same company, not deleted.) STABLE so the planner can reuse it.
CREATE OR REPLACE FUNCTION public.filehub_file_accessible(p_file_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.filehub_files f
        WHERE f.id = p_file_id
          AND f.deleted_at IS NULL
          AND f.company_id = public.my_company_id()
          AND (
              f.uploaded_by = auth.uid()
              OR f.visibility = 'broadcast'
              OR (f.visibility = 'direct' AND EXISTS (
                  SELECT 1 FROM public.filehub_recipients r
                  WHERE r.file_id = f.id AND r.user_id = auth.uid()
              ))
              OR (f.visibility = 'group' AND f.group_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.filehub_group_members gm
                  WHERE gm.group_id = f.group_id AND gm.user_id = auth.uid()
              ))
          )
    );
$$;
GRANT EXECUTE ON FUNCTION public.filehub_file_accessible(UUID) TO authenticated;

DROP POLICY IF EXISTS "filehub_storage_select" ON storage.objects;
CREATE POLICY "filehub_storage_select" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'filehub-files'
        AND (
            -- (a) live file object accessible to the user
            EXISTS (
                SELECT 1 FROM public.filehub_files f
                WHERE f.storage_path = storage.objects.name
                  AND public.filehub_file_accessible(f.id)
            )
            -- (b) version object whose parent live file is accessible
            OR EXISTS (
                SELECT 1 FROM public.filehub_file_versions v
                WHERE v.storage_path = storage.objects.name
                  AND public.filehub_file_accessible(v.file_id)
            )
        )
    );

-- ────────────────────────────────────────────────────────────────────────────
-- 1.5 RPCs
-- ────────────────────────────────────────────────────────────────────────────

-- Internal helper: build the auto-renamed name `base (N).ext` for the Keep-Both
-- path, picking the lowest free N within scope. Returns the original name if no
-- collision. SECURITY DEFINER so it can read across the company's files.
CREATE OR REPLACE FUNCTION public.filehub_dedupe_name(
    p_name       TEXT,
    p_visibility TEXT,
    p_group_id   UUID,
    p_folder_id  UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_base       TEXT;   -- name without extension
    v_ext        TEXT;   -- extension including leading dot ('' if none)
    v_dot        INT;
    v_candidate  TEXT;
    v_n          INT := 0;
    v_clash      BOOLEAN;
BEGIN
    -- Split base / extension on the last dot (ignore leading dot of dotfiles).
    v_dot := length(p_name) - position('.' IN reverse(p_name)) + 1;
    IF position('.' IN reverse(p_name)) > 0 AND v_dot > 1 THEN
        v_base := left(p_name, v_dot - 1);
        v_ext  := substring(p_name FROM v_dot);   -- includes the dot
    ELSE
        v_base := p_name;
        v_ext  := '';
    END IF;

    v_candidate := p_name;

    LOOP
        SELECT EXISTS (
            SELECT 1
            FROM public.filehub_files f
            WHERE f.deleted_at IS NULL
              AND f.company_id = v_company_id
              AND lower(trim(f.original_name)) = lower(trim(v_candidate))
              AND (
                  (p_visibility = 'group'     AND f.visibility = 'group'
                       AND f.group_id = p_group_id)
                  OR (p_visibility = 'broadcast' AND f.visibility = 'broadcast'
                       AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
                  OR (p_visibility = 'direct'    AND f.visibility = 'direct'
                       AND f.uploaded_by = v_user_id
                       AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
              )
        ) INTO v_clash;

        EXIT WHEN NOT v_clash;

        v_n := v_n + 1;
        v_candidate := v_base || ' (' || v_n || ')' || v_ext;
    END LOOP;

    RETURN v_candidate;
END;
$$;

-- 1.5a check_name_conflict ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_filehub_check_name_conflict(
    p_name       TEXT,
    p_visibility TEXT,
    p_group_id   UUID DEFAULT NULL,
    p_folder_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_row        JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
        'id',            f.id,
        'original_name', f.original_name,
        'uploader_name', u.full_name,
        'size_bytes',    f.size_bytes,
        'created_at',    f.created_at
    )
    INTO v_row
    FROM public.filehub_files f
    LEFT JOIN public.users u ON u.id = f.uploaded_by
    WHERE f.deleted_at IS NULL
      AND f.company_id = v_company_id
      AND lower(trim(f.original_name)) = lower(trim(p_name))
      AND (
          (p_visibility = 'group'     AND f.visibility = 'group'
               AND f.group_id = p_group_id)
          OR (p_visibility = 'broadcast' AND f.visibility = 'broadcast'
               AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
          OR (p_visibility = 'direct'    AND f.visibility = 'direct'
               AND f.uploaded_by = v_user_id
               AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
      )
    ORDER BY f.created_at DESC
    LIMIT 1;

    RETURN v_row;  -- NULL if no conflict
END;
$$;

-- 1.5b upload_commit (extend the existing 12-param function) -------------------
DROP FUNCTION IF EXISTS public.rpc_filehub_upload_commit(TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID);

CREATE OR REPLACE FUNCTION public.rpc_filehub_upload_commit(
    p_storage_path     TEXT,
    p_visibility       TEXT,
    p_recipient_ids    UUID[]  DEFAULT '{}',
    p_folder_id        UUID    DEFAULT NULL,
    p_tags             TEXT[]  DEFAULT '{}',
    p_caption          TEXT    DEFAULT NULL,
    p_original_name    TEXT    DEFAULT NULL,
    p_mime_type        TEXT    DEFAULT NULL,
    p_size_bytes       BIGINT  DEFAULT 0,
    p_content_hash     TEXT    DEFAULT NULL,
    p_replaces_file_id UUID    DEFAULT NULL,
    p_group_id         UUID    DEFAULT NULL
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
    v_version_id UUID;
    v_clean_tags TEXT[];
    v_final_name TEXT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF p_visibility NOT IN ('direct', 'broadcast', 'group') THEN
        RAISE EXCEPTION 'Invalid visibility: %', p_visibility;
    END IF;
    IF p_visibility = 'broadcast' AND NOT public.has_permission('filehub:broadcast') THEN
        RAISE EXCEPTION 'You do not have permission to broadcast files.';
    END IF;
    IF p_visibility = 'direct' AND (p_recipient_ids IS NULL OR cardinality(p_recipient_ids) = 0) THEN
        RAISE EXCEPTION 'Direct sends require at least one recipient.';
    END IF;
    IF p_visibility = 'group' THEN
        IF p_group_id IS NULL THEN
            RAISE EXCEPTION 'Group uploads require a group_id.';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_group_members
            WHERE group_id = p_group_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_groups
            WHERE id = p_group_id AND company_id = v_company_id
        ) THEN
            RAISE EXCEPTION 'Group not found.';
        END IF;
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
    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders WHERE id = p_folder_id AND company_id = v_company_id
    ) THEN
        RAISE EXCEPTION 'Folder does not exist in this company.';
    END IF;
    IF p_visibility = 'direct' AND EXISTS (
        SELECT 1 FROM unnest(p_recipient_ids) rid
        WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = rid AND u.company_id = v_company_id)
    ) THEN
        RAISE EXCEPTION 'One or more recipients are not members of your company.';
    END IF;

    SELECT COALESCE(array_agg(DISTINCT lower(trim(t))) FILTER (WHERE length(trim(t)) > 0), '{}')
    INTO v_clean_tags FROM unnest(COALESCE(p_tags, '{}')) AS t;

    -- Auto-dedupe the name within scope for the Keep-Both / no-conflict path.
    -- Race-safe because it runs inside this transaction; the lowest free N wins.
    v_final_name := public.filehub_dedupe_name(
        p_original_name, p_visibility, p_group_id,
        CASE WHEN p_visibility = 'group' THEN NULL ELSE p_folder_id END
    );

    INSERT INTO public.filehub_files (
        company_id, uploaded_by, storage_path, bucket, original_name, mime_type,
        size_bytes, content_hash, caption, visibility, folder_id, tags, replaces_file_id, group_id,
        updated_at, updated_by
    ) VALUES (
        v_company_id, v_user_id, p_storage_path, 'filehub-files', v_final_name, p_mime_type,
        p_size_bytes, p_content_hash, NULLIF(trim(coalesce(p_caption, '')), ''),
        p_visibility, p_folder_id, v_clean_tags, p_replaces_file_id,
        CASE WHEN p_visibility = 'group' THEN p_group_id ELSE NULL END,
        now(), v_user_id
    ) RETURNING id INTO v_file_id;

    -- Create the immutable v1 version and point the file at it.
    INSERT INTO public.filehub_file_versions (
        file_id, company_id, version_no, storage_path, bucket,
        original_name, size_bytes, mime_type, content_hash, created_by, superseded_at
    ) VALUES (
        v_file_id, v_company_id, 1, p_storage_path, 'filehub-files',
        v_final_name, p_size_bytes, p_mime_type, p_content_hash, v_user_id, NULL
    ) RETURNING id INTO v_version_id;

    UPDATE public.filehub_files
    SET current_version_id = v_version_id
    WHERE id = v_file_id;

    IF p_visibility = 'direct' THEN
        INSERT INTO public.filehub_recipients (file_id, user_id)
        SELECT v_file_id, rid FROM unnest(p_recipient_ids) AS rid
        WHERE rid <> v_user_id
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_file_id;
END;
$$;

-- 1.5c replace_file -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_filehub_replace_file(
    p_target_id    UUID,
    p_storage_path TEXT,
    p_size_bytes   BIGINT,
    p_content_hash TEXT,
    p_mime_type    TEXT,
    p_caption      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_file       public.filehub_files%ROWTYPE;
    v_next_no    INT;
    v_version_id UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF p_storage_path IS NULL OR length(trim(p_storage_path)) = 0 THEN
        RAISE EXCEPTION 'Storage path is required.';
    END IF;
    IF p_size_bytes > 524288000 THEN
        RAISE EXCEPTION 'File exceeds 500 MB limit.';
    END IF;

    SELECT * INTO v_file
    FROM public.filehub_files
    WHERE id = p_target_id AND company_id = v_company_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found.';
    END IF;

    -- Permission checks per visibility scope.
    IF v_file.visibility = 'group' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_group_members
            WHERE group_id = v_file.group_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
    ELSIF v_file.visibility = 'broadcast' THEN
        IF NOT public.has_permission('filehub:broadcast') THEN
            RAISE EXCEPTION 'You do not have permission to replace broadcast files.';
        END IF;
    ELSIF v_file.visibility = 'direct' THEN
        IF v_file.uploaded_by <> v_user_id THEN
            RAISE EXCEPTION 'Only the owner can replace a direct file.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported visibility: %', v_file.visibility;
    END IF;

    -- Next version number for this file.
    SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next_no
    FROM public.filehub_file_versions WHERE file_id = p_target_id;

    -- Supersede the currently-current version.
    UPDATE public.filehub_file_versions
    SET superseded_at = now()
    WHERE file_id = p_target_id AND superseded_at IS NULL;

    -- Insert the new current version. Keep original_name = live file's current
    -- name so the lineage name stays stable.
    INSERT INTO public.filehub_file_versions (
        file_id, company_id, version_no, storage_path, bucket,
        original_name, size_bytes, mime_type, content_hash, created_by, superseded_at
    ) VALUES (
        p_target_id, v_company_id, v_next_no, p_storage_path, 'filehub-files',
        v_file.original_name, p_size_bytes, p_mime_type, p_content_hash, v_user_id, NULL
    ) RETURNING id INTO v_version_id;

    -- Sync denormalized live-row fields to the new version.
    UPDATE public.filehub_files
    SET current_version_id = v_version_id,
        storage_path       = p_storage_path,
        size_bytes         = p_size_bytes,
        mime_type          = p_mime_type,
        content_hash       = p_content_hash,
        caption            = COALESCE(NULLIF(trim(coalesce(p_caption, '')), ''), caption),
        updated_at         = now(),
        updated_by         = v_user_id
    WHERE id = p_target_id;

    RETURN v_version_id;
END;
$$;

-- 1.5d file_versions ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_filehub_file_versions(p_file_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF NOT public.filehub_file_accessible(p_file_id) THEN
        RAISE EXCEPTION 'File not found or not accessible.';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',            v.id,
            'version_no',    v.version_no,
            'original_name', v.original_name,
            'size_bytes',    v.size_bytes,
            'mime_type',     v.mime_type,
            'storage_path',  v.storage_path,
            'bucket',        v.bucket,
            'created_at',    v.created_at,
            'superseded_at', v.superseded_at,
            'is_current',    (v.superseded_at IS NULL),
            'expires_at',    CASE WHEN v.superseded_at IS NULL THEN NULL
                                  ELSE v.superseded_at + interval '30 days' END,
            'uploader',      jsonb_build_object(
                                'id',         u.id,
                                'full_name',  u.full_name,
                                'avatar_url', u.avatar_url
                             )
        ) ORDER BY v.version_no DESC
    ), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_file_versions v
    LEFT JOIN public.users u ON u.id = v.created_by
    WHERE v.file_id = p_file_id;

    RETURN v_rows;
END;
$$;

-- 1.5e restore_version --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_filehub_restore_version(p_version_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_file_id    UUID;
    v_file       public.filehub_files%ROWTYPE;
    v_version    public.filehub_file_versions%ROWTYPE;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;

    SELECT * INTO v_version
    FROM public.filehub_file_versions
    WHERE id = p_version_id AND company_id = v_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Version not found.';
    END IF;
    v_file_id := v_version.file_id;

    SELECT * INTO v_file
    FROM public.filehub_files
    WHERE id = v_file_id AND company_id = v_company_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found.';
    END IF;

    -- Same permission checks as replace_file.
    IF v_file.visibility = 'group' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_group_members
            WHERE group_id = v_file.group_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
    ELSIF v_file.visibility = 'broadcast' THEN
        IF NOT public.has_permission('filehub:broadcast') THEN
            RAISE EXCEPTION 'You do not have permission to restore broadcast files.';
        END IF;
    ELSIF v_file.visibility = 'direct' THEN
        IF v_file.uploaded_by <> v_user_id THEN
            RAISE EXCEPTION 'Only the owner can restore a direct file.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported visibility: %', v_file.visibility;
    END IF;

    -- No-op if the version is already current.
    IF v_version.superseded_at IS NULL THEN
        RETURN;
    END IF;

    -- Pointer move: supersede the previously-current version...
    UPDATE public.filehub_file_versions
    SET superseded_at = now()
    WHERE file_id = v_file_id AND superseded_at IS NULL AND id <> p_version_id;

    -- ...and make the target current. No byte copy, no new row.
    UPDATE public.filehub_file_versions
    SET superseded_at = NULL
    WHERE id = p_version_id;

    -- Sync denormalized live-row fields to the restored version.
    UPDATE public.filehub_files
    SET current_version_id = p_version_id,
        storage_path       = v_version.storage_path,
        original_name      = v_version.original_name,
        size_bytes         = v_version.size_bytes,
        mime_type          = v_version.mime_type,
        content_hash       = v_version.content_hash,
        updated_at         = now(),
        updated_by         = v_user_id
    WHERE id = v_file_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1.6 (cross-phase) Re-create list RPCs adding version_count to the JSONB.
--   Logic otherwise identical to the current definitions.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_filehub_list(
    p_mode      TEXT,
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
                'current_version_id', f.current_version_id,
                'version_count',  (SELECT count(*) FROM public.filehub_file_versions v WHERE v.file_id = f.id),
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

CREATE OR REPLACE FUNCTION public.rpc_filehub_group_list_files(
    p_group_id UUID,
    p_search   TEXT DEFAULT NULL,
    p_tag      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
    v_search     TEXT := NULLIF(trim(coalesce(p_search, '')), '');
    v_rows       JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'You are not a member of this group.';
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
                'group_id',       f.group_id,
                'current_version_id', f.current_version_id,
                'version_count',  (SELECT count(*) FROM public.filehub_file_versions v WHERE v.file_id = f.id),
                'folder',         CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader',       jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url),
                'recipient_state', NULL::jsonb,
                'recipients',     NULL::jsonb,
                'recipient_count', 0
            ) AS row_payload
        FROM public.filehub_files f
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        JOIN public.users u ON u.id = f.uploaded_by
        WHERE f.deleted_at IS NULL
          AND f.group_id = p_group_id
          AND f.visibility = 'group'
          AND f.company_id = v_company_id
          AND (v_search IS NULL
               OR f.original_name ILIKE '%' || v_search || '%'
               OR f.caption       ILIKE '%' || v_search || '%'
               OR EXISTS (SELECT 1 FROM unnest(f.tags) t WHERE t ILIKE '%' || v_search || '%'))
          AND (p_tag IS NULL OR p_tag = ANY(f.tags))
    ) src;

    RETURN v_rows;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- GRANTS
-- ────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.rpc_filehub_check_name_conflict(TEXT,TEXT,UUID,UUID)                                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_upload_commit(TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_replace_file(UUID,TEXT,BIGINT,TEXT,TEXT,TEXT)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_file_versions(UUID)                                                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_restore_version(UUID)                                                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_list(TEXT,TEXT,UUID,TEXT)                                                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_list_files(UUID,TEXT,TEXT)                                                 TO authenticated;

COMMIT;
