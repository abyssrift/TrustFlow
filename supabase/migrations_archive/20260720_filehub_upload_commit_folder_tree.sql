-- 20260720_filehub_upload_commit_folder_tree.sql
-- Folder uploads used to be a two-phase client dance: the browser created the
-- whole directory tree up-front (ensureFolderTree -> rpc_filehub_folder_create
-- per segment), THEN uploaded + committed each file. When a batch half-failed
-- (network drop, tab close, quota hit mid-way), the folders were already made
-- but the files never committed -> empty "husk" folders left behind, and the
-- client had no reliable way to clean them up if it died mid-batch.
--
-- Fix: fold the folder-tree resolution INTO rpc_filehub_upload_commit via a new
-- optional p_rel_dir param (the file's webkitRelativePath directory, e.g.
-- 'Photos/2026'). The commit now get-or-creates each folder segment under
-- p_folder_id and lands the file in the leaf — all in ONE transaction. If the
-- commit fails, the folder creation rolls back with it. A folder can therefore
-- only ever exist because a file successfully committed into it: empty-husk
-- orphans are impossible by construction, and the client no longer pre-creates
-- anything.
--
-- Backward compatible: p_rel_dir defaults NULL, in which case the file lands
-- directly in p_folder_id exactly as before. The old 12-arg signature is
-- dropped and replaced by the 13-arg one (adding a param would otherwise create
-- an overload and make PostgREST calls ambiguous).
--
-- get-or-create matches rpc_filehub_folder_create semantics exactly:
-- (company_id, parent_id, scope, group_id, name) with deleted_at IS NULL, where
-- scope = p_visibility and group_id is set only for group-scoped folders.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- This migration also fixes four bugs that made bulk folder upload unusable.
-- All four were found by auditing the upload path end-to-end and reproducing
-- each one against a real Postgres running this SQL verbatim.
--
-- 1. RATE LIMIT (the big one). _rate_limit is a fixed 10-per-CLOCK-MINUTE cap
--    and upload_commit called it with max=10. A 700-file folder upload was
--    therefore: 10 files succeed, 690 raise 'Too many requests' — each AFTER
--    its storage PUT already landed, orphaning ~690 objects. The 4-worker pool
--    hit the wall within seconds. Raised to 1000/min; abuse is already bounded
--    by _company_file_size_limit + _company_storage_limit + plan limits, so the
--    per-file counter was buying almost nothing while breaking the feature.
--    rpc_filehub_replace_file had the identical bug at 20/min ('Replace All' on
--    a folder), raised to match.
--
-- 2. GROUP DEDUPE IGNORED THE FOLDER. filehub_dedupe_name's 'group' branch
--    matched on group_id alone with no folder predicate, so uploading a tree to
--    a channel silently renamed every repeated basename against the WHOLE
--    channel: Photos/2025/index.txt then Photos/2026/index.txt -> the second
--    became 'index (1).txt'. 20260716_filehub_group_name_conflict_folder_scoped
--    already made rpc_filehub_check_name_conflict folder-scoped for groups and
--    said "Bring group in line with the other two visibilities" — dedupe_name
--    was simply missed. This finishes that job, and upload_commit now passes
--    the resolved leaf folder instead of NULL for group uploads.
--
-- 3. DEDUPE WAS A RACY READ-THEN-INSERT. dedupe_name SELECTs a free name and
--    the caller INSERTs it, with no unique index behind it — 4 concurrent
--    commits of report.pdf all read "free" and all inserted 'report.pdf'.
--    Now serialized with a transaction-scoped advisory lock keyed on the dedupe
--    scope. A unique index would be the stronger fix, but existing rows may
--    already violate it, so that needs a separate backfill/cleanup migration.
--
-- 4. QUOTA CHECK WAS TOCTOU. The storage-quota read was an unlocked SELECT
--    while the increment happens in an AFTER INSERT trigger, so N parallel
--    commits all read the pre-batch total and all passed (measured: 4 workers
--    overshot a limit by 80%; worst case ~3x max file size over). The read now
--    takes FOR UPDATE, serializing the check against concurrent commits.

-- ── filehub_dedupe_name: scope the 'group' branch to the folder (bug 2) ──────
-- Body is otherwise verbatim from 20260617_filehub_versioning.sql; the ONLY
-- change is the added `f.folder_id IS NOT DISTINCT FROM p_folder_id` on the
-- group branch, matching what the broadcast/direct branches already do and what
-- rpc_filehub_check_name_conflict was already fixed to do in 20260716.
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
                       AND f.group_id = p_group_id
                       AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
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

DROP FUNCTION IF EXISTS public.rpc_filehub_upload_commit(
    TEXT, TEXT, UUID[], UUID, TEXT[], TEXT, TEXT, TEXT, BIGINT, TEXT, UUID, UUID
);

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
    p_rel_dir          TEXT    DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

    -- 1000/min, not 10: a folder upload is legitimately hundreds of commits in
    -- a burst. See the header — 10 made bulk upload structurally impossible.
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

    v_size_limit := public._company_file_size_limit(v_company_id);
    IF v_size_limit <> -1 AND p_size_bytes > v_size_limit THEN
        RAISE EXCEPTION 'File too large for your plan (% MB limit). Upgrade to upload larger files.',
            round(v_size_limit::numeric / 1048576);
    END IF;

    v_storage_limit := public._company_storage_limit(v_company_id);
    IF v_storage_limit <> -1 THEN
        -- FOR UPDATE: the increment lives in an AFTER INSERT trigger, so an
        -- unlocked read let N parallel workers all see the pre-batch total and
        -- all pass (bug 4). Locking the billing row serializes the check-then-
        -- insert against concurrent commits for this company. Only taken when a
        -- limit actually applies, so unlimited plans keep full parallelism.
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

    -- When we're about to create children under p_folder_id, the parent's scope
    -- MUST match this upload's — same check rpc_filehub_folder_create makes.
    -- Without it a scope mismatch (e.g. a folder picked while visibility was
    -- 'broadcast', then switched to 'direct') slips past the scope-filtered
    -- get-or-create SELECT below and hits idx_filehub_folders_unique_child,
    -- which is keyed on (company_id, parent_id, name) WITHOUT scope — an
    -- unavoidable unique_violation. Fail early with a readable message instead.
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

    -- Resolve (get-or-create) the folder sub-tree from p_rel_dir under
    -- p_folder_id, in-transaction. The file lands in the leaf; a failure
    -- anywhere below rolls the whole thing back, so no empty folders survive.
    --
    -- CONCURRENCY: the web client uploads a batch through 4 parallel workers,
    -- so N commits race to create the SAME segment on the first upload into a
    -- new tree. A bare SELECT-then-INSERT would have all N miss, all N insert,
    -- and N-1 die on the partial unique indexes (idx_filehub_folders_unique_
    -- root/_child) — rolling back those commits and orphaning their bytes.
    -- INSERT ... ON CONFLICT DO NOTHING + re-SELECT makes the loser of the race
    -- simply adopt the winner's folder: DO NOTHING waits on the winner's
    -- uncommitted tuple (xact lock) rather than erroring, and once that txn
    -- commits the loser's re-SELECT — a new statement, so a fresh READ
    -- COMMITTED snapshot — sees the committed row. If the winner instead rolls
    -- back, the loser's insert proceeds normally. Verified both ways against a
    -- real Postgres: concurrent workers -> exactly one folder row.
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

                -- Lost the race (or hit a conflicting row we can't see): re-read.
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

                -- Still nothing: a folder with this name exists at this level
                -- under a different scope (the unique child index ignores
                -- scope). Surface it rather than nesting under a NULL parent.
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

    -- Serialize dedupe-then-insert within this dedupe scope (bug 3). Without
    -- it, concurrent workers uploading the same basename each read "name is
    -- free" and all insert it. The key mirrors the scope filehub_dedupe_name
    -- matches on, so uploads into different folders/channels never contend.
    -- Taken AFTER the folder tree resolves (v_target_folder must be known).
    -- Lock order across the whole function is stable — billing row, then folder
    -- tuples top-down, then this — so parallel workers can't deadlock.
    v_lock_key := hashtextextended(
        v_company_id::text
          || '|' || p_visibility
          || '|' || COALESCE((CASE WHEN p_visibility = 'group'  THEN p_group_id END)::text, '-')
          || '|' || COALESCE((CASE WHEN p_visibility = 'direct' THEN v_user_id  END)::text, '-')
          || '|' || COALESCE(v_target_folder::text, '-'),
        0
    );
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- Group uploads now dedupe within the destination folder, not across the
    -- entire channel (bug 2) — hence v_target_folder for every visibility.
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
        original_name, size_bytes, mime_type, content_hash, created_by, superseded_at
    ) VALUES (
        v_file_id, v_company_id, 1, p_storage_path, 'filehub-files',
        v_final_name, p_size_bytes, p_mime_type, p_content_hash, v_user_id, NULL
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
    TEXT, TEXT, UUID[], UUID, TEXT[], TEXT, TEXT, TEXT, BIGINT, TEXT, UUID, UUID, TEXT
) TO authenticated;

-- ── rpc_filehub_replace_file: same two bugs, same flow ──────────────────────
-- Body verbatim from 20260701_rate_limits.sql except for the two marked lines.
-- 'Replace All' on a folder upload drives this once per file, so the 20/min cap
-- mass-failed it exactly like upload_commit's 10/min did (bug 1), and its quota
-- read had the identical unlocked-SELECT TOCTOU (bug 4).
CREATE OR REPLACE FUNCTION public.rpc_filehub_replace_file(
    p_target_id    UUID,
    p_storage_path TEXT,
    p_size_bytes   BIGINT,
    p_content_hash TEXT,
    p_mime_type    TEXT,
    p_caption      TEXT DEFAULT NULL
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

    -- CHANGED (bug 1): 20 -> 1000, matching upload_commit.
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
            -- CHANGED (bug 4): FOR UPDATE, see upload_commit for the rationale.
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

    SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next_no
    FROM public.filehub_file_versions WHERE file_id = p_target_id;

    UPDATE public.filehub_file_versions
    SET superseded_at = now()
    WHERE file_id = p_target_id AND superseded_at IS NULL;

    INSERT INTO public.filehub_file_versions (
        file_id, company_id, version_no, storage_path, bucket,
        original_name, size_bytes, mime_type, content_hash, created_by, superseded_at
    ) VALUES (
        p_target_id, v_company_id, v_next_no, p_storage_path, 'filehub-files',
        v_file.original_name, p_size_bytes, p_mime_type, p_content_hash, v_user_id, NULL
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

GRANT EXECUTE ON FUNCTION public.rpc_filehub_replace_file(UUID, TEXT, BIGINT, TEXT, TEXT, TEXT) TO authenticated;
