-- 20260730133225_filehub_folder_versions_read_and_restore.sql
-- Part 2 of 2 — depends on 20260730133142 (batch_id column + write path).
-- Adds the per-file restore override, the folder version list, folder restore,
-- and the self-checks for the whole feature.

-- ── 4. Per-file restore accepts the manage-tier override ────────────────────
-- Folder restore loops through this, and the person most likely to use it is an
-- owner/admin who is not a literal channel member — the same mismatch fixed in
-- filehub_file_accessible today. View-only override is deliberately not enough.
CREATE OR REPLACE FUNCTION public.rpc_filehub_restore_version(p_version_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    IF NOT FOUND THEN RAISE EXCEPTION 'Version not found.'; END IF;
    v_file_id := v_version.file_id;

    SELECT * INTO v_file
    FROM public.filehub_files
    WHERE id = v_file_id AND company_id = v_company_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'File not found.'; END IF;

    IF v_file.visibility = 'group' THEN
        IF NOT (
            EXISTS (
                SELECT 1 FROM public.filehub_group_members
                WHERE group_id = v_file.group_id AND user_id = v_user_id
            )
            OR public.has_permission('filehub:group_override_manage')
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

    IF v_version.superseded_at IS NULL THEN RETURN; END IF;

    UPDATE public.filehub_file_versions
    SET superseded_at = now()
    WHERE file_id = v_file_id AND superseded_at IS NULL AND id <> p_version_id;

    UPDATE public.filehub_file_versions
    SET superseded_at = NULL
    WHERE id = p_version_id;

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

GRANT EXECUTE ON FUNCTION public.rpc_filehub_restore_version(uuid) TO authenticated;

-- ── 5. Read: the folder's version list ──────────────────────────────────────
-- `is_effective` marks the version the folder's CURRENT pointers correspond to.
-- It is the newest batch that still owns at least one live version, so after a
-- restore to v1 the list correctly reads v1 as effective while v2 stays in
-- history — mirroring how per-file restore keeps superseded versions around.
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_versions(p_folder_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_rows JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF NOT public.filehub_folder_accessible(p_folder_id) THEN
        RAISE EXCEPTION 'Folder not found.';
    END IF;

    WITH v AS (
        SELECT ver.batch_id, ver.file_id, ver.created_at, ver.created_by,
               ver.superseded_at, ver.version_no
        FROM public.filehub_file_versions ver
        JOIN public.filehub_files f ON f.id = ver.file_id
        WHERE f.folder_id = p_folder_id
          AND f.deleted_at IS NULL
          AND ver.batch_id IS NOT NULL
    ),
    b AS (
        SELECT batch_id,
               min(created_at)                                   AS created_at,
               count(DISTINCT file_id)                           AS files_touched,
               count(*) FILTER (WHERE version_no = 1)            AS files_added,
               count(*) FILTER (WHERE version_no > 1)            AS files_replaced,
               count(*) FILTER (WHERE superseded_at IS NULL)     AS live_files,
               -- NOT min(created_by): this Postgres has no min/max aggregate for
               -- uuid (verified against the live server). array_agg works on any
               -- type and picks the batch's first actor deterministically.
               (array_agg(created_by ORDER BY created_at))[1]    AS created_by
        FROM v GROUP BY batch_id
    ),
    s AS (
        SELECT b.*, row_number() OVER (ORDER BY created_at) AS seq FROM b
    ),
    eff AS (
        SELECT COALESCE(max(seq) FILTER (WHERE live_files > 0), 0) AS effective_seq FROM s
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'batch_id',       s.batch_id,
        'seq',            s.seq,
        'created_at',     s.created_at,
        'files_touched',  s.files_touched,
        'files_added',    s.files_added,
        'files_replaced', s.files_replaced,
        'live_files',     s.live_files,
        'is_effective',   (s.seq = eff.effective_seq),
        'actor',          jsonb_build_object(
                              'id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url)
    ) ORDER BY s.seq DESC), '[]'::jsonb)
    INTO v_rows
    FROM s
    CROSS JOIN eff
    LEFT JOIN public.users u ON u.id = s.created_by;

    RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_versions(UUID) TO authenticated;

-- ── 6. Restore the whole folder to one of those versions ────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_restore_batch(
    p_folder_id UUID,
    p_batch_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_target_at TIMESTAMPTZ;
    v_restored  INT := 0;
    v_unchanged INT := 0;
    v_skipped   INT := 0;
    r           RECORD;
    v_ver       UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF NOT public.filehub_folder_accessible(p_folder_id) THEN
        RAISE EXCEPTION 'Folder not found.';
    END IF;

    -- Anchor on the LAST version in the batch, so "restore to vN" means the
    -- state immediately AFTER that batch finished, not part-way through it.
    SELECT max(ver.created_at) INTO v_target_at
    FROM public.filehub_file_versions ver
    JOIN public.filehub_files f ON f.id = ver.file_id
    WHERE f.folder_id = p_folder_id
      AND f.deleted_at IS NULL
      AND ver.batch_id = p_batch_id;

    IF v_target_at IS NULL THEN
        RAISE EXCEPTION 'That folder version no longer exists.';
    END IF;

    FOR r IN
        SELECT id FROM public.filehub_files
        WHERE folder_id = p_folder_id AND deleted_at IS NULL
    LOOP
        SELECT id INTO v_ver
        FROM public.filehub_file_versions
        WHERE file_id = r.id AND created_at <= v_target_at
        ORDER BY created_at DESC, version_no DESC
        LIMIT 1;

        IF v_ver IS NULL THEN
            -- File did not exist at that point. Leaving it is the only safe
            -- move: restoring a version must never delete anything.
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        IF EXISTS (SELECT 1 FROM public.filehub_file_versions
                   WHERE id = v_ver AND superseded_at IS NULL) THEN
            v_unchanged := v_unchanged + 1;
            CONTINUE;
        END IF;

        -- Reuse the per-file pointer move (and its permission checks). Any
        -- failure aborts the whole call — no half-restored folders.
        PERFORM public.rpc_filehub_restore_version(v_ver);
        v_restored := v_restored + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'restored', v_restored, 'unchanged', v_unchanged, 'skipped_newer', v_skipped);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_restore_batch(UUID, UUID) TO authenticated;

-- ── Self-checks ─────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_null_batches INT;
    v_folder       UUID;
    v_versions     JSONB;
    v_owner        UUID;
BEGIN
    -- Backfill must have covered every pre-existing version.
    SELECT count(*) INTO v_null_batches FROM public.filehub_file_versions WHERE batch_id IS NULL;
    ASSERT v_null_batches = 0, format('%s versions left without a batch_id', v_null_batches);

    -- Both write RPCs must now accept the batch parameter.
    ASSERT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'rpc_filehub_upload_commit') = 1,
           'exactly one rpc_filehub_upload_commit arity must exist (PostgREST overload trap)';
    ASSERT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'rpc_filehub_replace_file') = 1,
           'exactly one rpc_filehub_replace_file arity must exist';
    ASSERT (SELECT pg_get_functiondef(p.oid) LIKE '%p_batch_id%'
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'rpc_filehub_upload_commit'),
           'upload_commit lost p_batch_id';
    -- Guard the rest of the payload too, since this recreated the function.
    ASSERT (SELECT pg_get_functiondef(p.oid) LIKE '%p_rel_dir%'
                AND pg_get_functiondef(p.oid) LIKE '%group_override_manage%'
                AND pg_get_functiondef(p.oid) LIKE '%pg_advisory_xact_lock%'
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'rpc_filehub_upload_commit'),
           'upload_commit lost rel_dir / override / dedupe lock — recreated from a stale body';

    -- The folder from the original report must now read as exactly 2 versions.
    SELECT id INTO v_folder FROM public.filehub_folders
    WHERE id = '05042156-e9b8-4d95-a9f7-046b386d5918' AND deleted_at IS NULL;

    IF v_folder IS NOT NULL THEN
        SELECT u.id INTO v_owner FROM public.users u
        WHERE u.is_owner AND u.company_id = (SELECT company_id FROM public.filehub_folders WHERE id = v_folder)
        LIMIT 1;
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

        v_versions := public.rpc_filehub_folder_versions(v_folder);
        ASSERT jsonb_array_length(v_versions) = 2,
            format('reported folder should read as 2 versions, got %s: %s',
                   jsonb_array_length(v_versions), v_versions);
        ASSERT (v_versions -> 0 ->> 'seq')::int = 2, 'newest version must sort first';
        ASSERT (v_versions -> 0 ->> 'is_effective')::boolean, 'v2 must be the effective version';
        RAISE NOTICE 'folder version assertions passed: %', v_versions;
    END IF;
END $$;
