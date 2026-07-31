-- 20260730_filehub_folder_versions.sql
-- Folder-level version control: a folder shows v1..vN and can be restored to a
-- previous version as a SET, which per-file versions structurally cannot express.
--
-- ── Why a batch id and not a counter on the folder row ──────────────────────
-- The obvious design — filehub_folders.version_no bumped whenever a file inside
-- changes — is the expensive one. A 700-file folder replace becomes 700 UPDATEs
-- against ONE row: all four parallel upload workers serialize on that row lock
-- (undoing 20260720, which raised the rate limit from 10 to 1000 precisely to
-- make bulk folder upload work) and it leaves 700 dead tuples on a tiny table.
--
-- Instead every version row carries the id of the upload batch that produced it.
-- Cost on the write path is ZERO: the uuid rides along in an INSERT that already
-- happens, and no shared row is touched. Folder version is derived at read time
-- as count(distinct batch_id) — index-only. Measured on the live folder before
-- building this: 10 shared buffer hits, all index scans, no seq scan.
--
-- ── Restore semantics ───────────────────────────────────────────────────────
-- "Restore folder to vN" = for every file in the folder, make current the newest
-- version created at or before batch N. It reuses rpc_filehub_restore_version
-- per file rather than re-implementing the pointer move, so Model B's rules (no
-- bytes copied, no new version created, the 30-day purge clock) hold for free.
--   * Files that did not exist at vN are LEFT ALONE, not deleted. Restoring a
--     version is not a destructive operation and must not quietly become one.
--   * The whole restore is one transaction: if any single file's permission
--     check fails, nothing moves. Partial folder state is worse than an error.

-- ── 1. Schema ───────────────────────────────────────────────────────────────
ALTER TABLE public.filehub_file_versions
    ADD COLUMN IF NOT EXISTS batch_id UUID;

COMMENT ON COLUMN public.filehub_file_versions.batch_id IS
    'Upload batch that produced this version. Folder version = count(distinct batch_id) over the folder''s files.';

CREATE INDEX IF NOT EXISTS idx_filehub_versions_batch
    ON public.filehub_file_versions (batch_id) WHERE batch_id IS NOT NULL;

-- Backs the per-folder rollup and the "newest version at or before T" lookup.
CREATE INDEX IF NOT EXISTS idx_filehub_versions_file_created
    ON public.filehub_file_versions (file_id, created_at);

-- ── 2. Backfill (HEURISTIC — read before trusting historical folder versions) ─
-- Rows predating this migration have no batch id, so batches are reconstructed
-- by clustering: versions by the SAME uploader in the SAME folder with no more
-- than 60s between consecutive rows become one batch (gaps-and-islands). Exact
-- for a bulk folder replace (the reported case landed 2 files 3s apart); wrong
-- if someone deliberately replaced two files a minute apart and considers those
-- separate events. Only touches rows where batch_id IS NULL, so it can never
-- overwrite a real client-supplied id and re-running it is a no-op.
WITH ordered AS (
    SELECT v.id, v.created_by, f.folder_id, v.created_at,
           lag(v.created_at) OVER (
               PARTITION BY v.created_by, COALESCE(f.folder_id, '00000000-0000-0000-0000-000000000000'::uuid)
               ORDER BY v.created_at
           ) AS prev_at
    FROM public.filehub_file_versions v
    JOIN public.filehub_files f ON f.id = v.file_id
    WHERE v.batch_id IS NULL
),
marked AS (
    SELECT *, CASE WHEN prev_at IS NULL OR created_at - prev_at > interval '60 seconds'
                   THEN 1 ELSE 0 END AS starts_batch
    FROM ordered
),
grouped AS (
    SELECT id, created_by, folder_id,
           sum(starts_batch) OVER (
               PARTITION BY created_by, COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid)
               ORDER BY created_at ROWS UNBOUNDED PRECEDING
           ) AS grp
    FROM marked
)
UPDATE public.filehub_file_versions t
SET batch_id = md5(
        COALESCE(g.created_by::text, '-') || '|' ||
        COALESCE(g.folder_id::text, '-')  || '|' || g.grp::text
    )::uuid
FROM grouped g
WHERE t.id = g.id AND t.batch_id IS NULL;

-- ── 3. Write path: carry the batch id through ───────────────────────────────
-- Signature changes, so the old arity must go or PostgREST sees an ambiguous
-- overload (the trap called out in 20260720).
DROP FUNCTION IF EXISTS public.rpc_filehub_upload_commit(
    TEXT, TEXT, UUID[], UUID, TEXT[], TEXT, TEXT, TEXT, BIGINT, TEXT, UUID, UUID, TEXT
);

-- Body verbatim from the live definition (which came from
-- 20260721_filehub_channel_override_manage_permission.sql). The ONLY changes
-- are the added p_batch_id parameter and the batch_id column on the version
-- INSERT — applied by script against the live body, not retyped, because
-- recreating this function from a stale body has already caused two production
-- regressions (see 20260718 and 20260730_filehub_group_list_files_version_keys).
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
    p_group_id         UUID    DEFAULT NULL,
    p_rel_dir          TEXT    DEFAULT NULL,
    p_batch_id         UUID    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id     UUID   := public.my_company_id();
    v_user_id        UUID   := auth.uid();
    v_file_id        UUID;
    v_version_id     UUID;
    v_clean_tags     TEXT[];
    v_final_name     TEXT;
    v_size_limit     BIGINT;
    v_storage_limit  BIGINT;
    v_storage_used   BIGINT;
    v_target_folder  UUID   := p_folder_id;
    v_scope          TEXT;
    v_folder_group   UUID;
    v_parent         UUID;
    v_child          UUID;
    v_seg            TEXT;
    v_lock_key       BIGINT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;

    PERFORM public._rate_limit('file_upload', 1000);

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
        IF NOT (
            EXISTS (
                SELECT 1 FROM public.filehub_group_members
                WHERE group_id = p_group_id AND user_id = v_user_id
            )
            OR public.has_permission('filehub:group_override_manage')
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

    v_size_limit := public._company_file_size_limit(v_company_id);
    IF v_size_limit <> -1 AND p_size_bytes > v_size_limit THEN
        RAISE EXCEPTION 'File too large for your plan (% MB limit). Upgrade to upload larger files.',
            round(v_size_limit::numeric / 1048576);
    END IF;

    v_storage_limit := public._company_storage_limit(v_company_id);
    IF v_storage_limit <> -1 THEN
        SELECT COALESCE(storage_used_bytes, 0) INTO v_storage_used
        FROM public.company_billing WHERE company_id = v_company_id FOR UPDATE;
        IF (COALESCE(v_storage_used, 0) + p_size_bytes) > v_storage_limit THEN
            RAISE EXCEPTION 'Storage quota exceeded (% MB of % MB used). Upgrade your plan to add more storage.',
                round(COALESCE(v_storage_used, 0)::numeric / 1048576),
                round(v_storage_limit::numeric / 1048576);
        END IF;
    END IF;

    IF p_original_name IS NULL OR length(trim(p_original_name)) = 0 THEN
        RAISE EXCEPTION 'Original filename is required.';
    END IF;
    IF p_storage_path IS NULL OR length(trim(p_storage_path)) = 0 THEN
        RAISE EXCEPTION 'Storage path is required.';
    END IF;
    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_folder_id AND company_id = v_company_id AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Folder does not exist in this company.';
    END IF;

    IF p_rel_dir IS NOT NULL AND length(trim(p_rel_dir)) > 0
       AND p_folder_id IS NOT NULL
       AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_folder_id
          AND company_id = v_company_id
          AND scope = p_visibility
          AND group_id IS NOT DISTINCT FROM (CASE WHEN p_visibility = 'group' THEN p_group_id ELSE NULL END)
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Target folder does not exist in this scope.';
    END IF;
    IF p_visibility = 'direct' AND EXISTS (
        SELECT 1 FROM unnest(p_recipient_ids) rid
        WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = rid AND u.company_id = v_company_id)
    ) THEN
        RAISE EXCEPTION 'One or more recipients are not members of your company.';
    END IF;

    IF p_rel_dir IS NOT NULL AND length(trim(p_rel_dir)) > 0 THEN
        v_scope        := p_visibility;
        v_folder_group := CASE WHEN v_scope = 'group' THEN p_group_id ELSE NULL END;
        v_parent       := p_folder_id;
        FOREACH v_seg IN ARRAY regexp_split_to_array(trim(p_rel_dir), '/') LOOP
            v_seg := trim(v_seg);
            CONTINUE WHEN length(v_seg) = 0;

            SELECT id INTO v_child
            FROM public.filehub_folders
            WHERE company_id = v_company_id
              AND parent_id IS NOT DISTINCT FROM v_parent
              AND scope = v_scope
              AND group_id IS NOT DISTINCT FROM v_folder_group
              AND name = v_seg
              AND deleted_at IS NULL;

            IF v_child IS NULL THEN
                INSERT INTO public.filehub_folders (company_id, name, created_by, parent_id, scope, group_id)
                VALUES (v_company_id, v_seg, v_user_id, v_parent, v_scope, v_folder_group)
                ON CONFLICT DO NOTHING
                RETURNING id INTO v_child;

                IF v_child IS NULL THEN
                    SELECT id INTO v_child
                    FROM public.filehub_folders
                    WHERE company_id = v_company_id
                      AND parent_id IS NOT DISTINCT FROM v_parent
                      AND scope = v_scope
                      AND group_id IS NOT DISTINCT FROM v_folder_group
                      AND name = v_seg
                      AND deleted_at IS NULL;
                END IF;

                IF v_child IS NULL THEN
                    RAISE EXCEPTION 'Cannot create folder "%" here — a folder with that name already exists at this level.', v_seg;
                END IF;
            END IF;

            v_parent := v_child;
        END LOOP;
        v_target_folder := v_parent;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT lower(trim(t))) FILTER (WHERE length(trim(t)) > 0), '{}')
    INTO v_clean_tags FROM unnest(COALESCE(p_tags, '{}')) AS t;

    v_lock_key := hashtextextended(
        v_company_id::text
          || '|' || p_visibility
          || '|' || COALESCE((CASE WHEN p_visibility = 'group'  THEN p_group_id END)::text, '-')
          || '|' || COALESCE((CASE WHEN p_visibility = 'direct' THEN v_user_id  END)::text, '-')
          || '|' || COALESCE(v_target_folder::text, '-'),
        0
    );
    PERFORM pg_advisory_xact_lock(v_lock_key);

    v_final_name := public.filehub_dedupe_name(
        p_original_name, p_visibility, p_group_id, v_target_folder
    );

    INSERT INTO public.filehub_files (
        company_id, uploaded_by, storage_path, bucket, original_name, mime_type,
        size_bytes, content_hash, caption, visibility, folder_id, tags, replaces_file_id, group_id,
        updated_at, updated_by
    ) VALUES (
        v_company_id, v_user_id, p_storage_path, 'filehub-files', v_final_name, p_mime_type,
        p_size_bytes, p_content_hash, NULLIF(trim(coalesce(p_caption, '')), ''),
        p_visibility, v_target_folder, v_clean_tags, p_replaces_file_id,
        CASE WHEN p_visibility = 'group' THEN p_group_id ELSE NULL END,
        now(), v_user_id
    ) RETURNING id INTO v_file_id;

    INSERT INTO public.filehub_file_versions (
        file_id, company_id, version_no, storage_path, bucket,
        original_name, size_bytes, mime_type, content_hash, created_by, superseded_at,
        batch_id
    ) VALUES (
        v_file_id, v_company_id, 1, p_storage_path, 'filehub-files',
        v_final_name, p_size_bytes, p_mime_type, p_content_hash, v_user_id, NULL,
        p_batch_id
    ) RETURNING id INTO v_version_id;

    UPDATE public.filehub_files SET current_version_id = v_version_id WHERE id = v_file_id;

    IF p_visibility = 'direct' THEN
        INSERT INTO public.filehub_recipients (file_id, user_id)
        SELECT v_file_id, rid FROM unnest(p_recipient_ids) AS rid
        WHERE rid <> v_user_id
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_file_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_upload_commit(
    TEXT, TEXT, UUID[], UUID, TEXT[], TEXT, TEXT, TEXT, BIGINT, TEXT, UUID, UUID, TEXT, UUID
) TO authenticated;

-- Replace: same treatment. Body verbatim from live except the added parameter,
-- the batch_id column, and the manage-tier override on the group branch.
DROP FUNCTION IF EXISTS public.rpc_filehub_replace_file(UUID, TEXT, BIGINT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.rpc_filehub_replace_file(
    p_target_id    UUID,
    p_storage_path TEXT,
    p_size_bytes   BIGINT,
    p_content_hash TEXT,
    p_mime_type    TEXT,
    p_caption      TEXT DEFAULT NULL,
    p_batch_id     UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_company_id    UUID   := public.my_company_id();
    v_user_id       UUID   := auth.uid();
    v_file          public.filehub_files%ROWTYPE;
    v_next_no       INT;
    v_version_id    UUID;
    v_size_limit    BIGINT;
    v_storage_limit BIGINT;
    v_storage_used  BIGINT;
    v_net_delta     BIGINT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;

    PERFORM public._rate_limit('file_replace', 1000);

    IF p_storage_path IS NULL OR length(trim(p_storage_path)) = 0 THEN
        RAISE EXCEPTION 'Storage path is required.';
    END IF;

    v_size_limit := public._company_file_size_limit(v_company_id);
    IF v_size_limit <> -1 AND p_size_bytes > v_size_limit THEN
        RAISE EXCEPTION 'File too large for your plan (% MB limit). Upgrade to upload larger files.',
            round(v_size_limit::numeric / 1048576);
    END IF;

    SELECT * INTO v_file
    FROM public.filehub_files
    WHERE id = p_target_id AND company_id = v_company_id AND deleted_at IS NULL;

    IF NOT FOUND THEN RAISE EXCEPTION 'File not found.'; END IF;

    v_net_delta := p_size_bytes - COALESCE(v_file.size_bytes, 0);
    IF v_net_delta > 0 THEN
        v_storage_limit := public._company_storage_limit(v_company_id);
        IF v_storage_limit <> -1 THEN
            SELECT COALESCE(storage_used_bytes, 0) INTO v_storage_used
            FROM public.company_billing WHERE company_id = v_company_id FOR UPDATE;
            IF (COALESCE(v_storage_used, 0) + v_net_delta) > v_storage_limit THEN
                RAISE EXCEPTION 'Storage quota exceeded (% MB of % MB used). Upgrade your plan.',
                    round(COALESCE(v_storage_used, 0)::numeric / 1048576),
                    round(v_storage_limit::numeric / 1048576);
            END IF;
        END IF;
    END IF;

    IF v_file.visibility = 'group' THEN
        IF NOT (
            EXISTS (
                SELECT 1 FROM public.filehub_group_members
                WHERE group_id = v_file.group_id AND user_id = v_user_id
            )
            -- Manage-tier override only. filehub:group_override is view-only and
            -- must never grant writes (20260721).
            OR public.has_permission('filehub:group_override_manage')
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

    SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next_no
    FROM public.filehub_file_versions WHERE file_id = p_target_id;

    UPDATE public.filehub_file_versions
    SET superseded_at = now()
    WHERE file_id = p_target_id AND superseded_at IS NULL;

    INSERT INTO public.filehub_file_versions (
        file_id, company_id, version_no, storage_path, bucket,
        original_name, size_bytes, mime_type, content_hash, created_by, superseded_at,
        batch_id
    ) VALUES (
        p_target_id, v_company_id, v_next_no, p_storage_path, 'filehub-files',
        v_file.original_name, p_size_bytes, p_mime_type, p_content_hash, v_user_id, NULL,
        p_batch_id
    ) RETURNING id INTO v_version_id;

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

GRANT EXECUTE ON FUNCTION public.rpc_filehub_replace_file(UUID, TEXT, BIGINT, TEXT, TEXT, TEXT, UUID) TO authenticated;

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
