-- Rate limiting: per-minute sliding window counters.
-- Protects uploads, task creation, and pipeline creation from bots and spam.
-- rpc_join_company_by_code already has its own 10-second cooldown — not touched here.

-- ─────────────────────────────────────────────────────────────
-- 1. Bucket table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  user_id      uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  action       text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        int         NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, action, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_window_idx
  ON public.rate_limit_buckets (window_start);

-- Only accessed by SECURITY DEFINER functions; no RLS needed.
ALTER TABLE public.rate_limit_buckets DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- 2. Helper: upsert per-minute bucket, raise if over limit
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._rate_limit(p_action text, p_max int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid        := auth.uid();
  v_window  timestamptz := date_trunc('minute', now());
  v_count   int;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.rate_limit_buckets (user_id, action, window_start, count)
  VALUES (v_user_id, p_action, v_window, 1)
  ON CONFLICT (user_id, action, window_start)
  DO UPDATE SET count = rate_limit_buckets.count + 1
  RETURNING count INTO v_count;

  IF v_count > p_max THEN
    RAISE EXCEPTION 'Too many requests. Please wait a moment and try again.';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. Hourly cleanup via pg_cron
-- ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('rate-limit-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'rate-limit-cleanup'
);
SELECT cron.schedule(
  'rate-limit-cleanup',
  '0 * * * *',
  $$DELETE FROM public.rate_limit_buckets WHERE window_start < now() - interval '1 hour'$$
);

-- ─────────────────────────────────────────────────────────────
-- 4. Pipeline creation rate limit (10/min) — trigger-based
--    Pipeline inserts are direct client INSERTs, not an RPC.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._rate_limit_pipeline_create()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._rate_limit('create_pipeline', 10);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rate_limit_pipeline_create ON public.pipelines;
CREATE TRIGGER rate_limit_pipeline_create
  BEFORE INSERT ON public.pipelines
  FOR EACH ROW EXECUTE FUNCTION public._rate_limit_pipeline_create();

-- ─────────────────────────────────────────────────────────────
-- 5. rpc_create_task: 60/min
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_task(
  p_title                 text,
  p_description           text        DEFAULT NULL,
  p_priority              text        DEFAULT 'medium',
  p_due_date              timestamptz DEFAULT NULL,
  p_pipeline_id           uuid        DEFAULT NULL,
  p_project_id            uuid        DEFAULT NULL,
  p_manager_id            uuid        DEFAULT NULL,
  p_category              text        DEFAULT NULL,
  p_weight                bigint      DEFAULT 0,
  p_visibility_permission text        DEFAULT NULL,
  p_start_date            timestamptz DEFAULT NULL,
  p_estimated_hours       numeric     DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_task_id           UUID;
  v_company_id        UUID;
  v_user_id           UUID := auth.uid();
  v_initial_stage     UUID;
  v_initial_name      TEXT;
  v_resolved_pipeline UUID;
BEGIN
  v_company_id := public.my_company_id();

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('task.create')
    OR public.has_permission('system.view_all_data')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create tasks';
  END IF;

  PERFORM public._rate_limit('create_task', 60);

  v_resolved_pipeline := p_pipeline_id;

  IF v_resolved_pipeline IS NULL AND p_project_id IS NOT NULL THEN
    SELECT pipeline_id INTO v_resolved_pipeline
    FROM   public.projects
    WHERE  id = p_project_id AND company_id = v_company_id;
  END IF;

  IF v_resolved_pipeline IS NULL THEN
    SELECT id INTO v_resolved_pipeline
    FROM   public.pipelines
    WHERE  company_id = v_company_id AND is_default = TRUE AND deleted_at IS NULL
    LIMIT  1;
  END IF;

  IF v_resolved_pipeline IS NOT NULL THEN
    SELECT id, name INTO v_initial_stage, v_initial_name
    FROM   public.pipeline_stages
    WHERE  pipeline_id = v_resolved_pipeline AND is_initial = TRUE
    LIMIT  1;
  END IF;

  INSERT INTO public.tasks (
    company_id, title, description, priority, due_date,
    created_by, manager_id, project_id,
    pipeline_id, current_stage_id,
    status, category, weight,
    visibility_permission, start_date, estimated_hours
  ) VALUES (
    v_company_id, p_title, p_description, p_priority, p_due_date,
    v_user_id, COALESCE(p_manager_id, v_user_id), p_project_id,
    v_resolved_pipeline, v_initial_stage,
    COALESCE(v_initial_name, 'open'), p_category, p_weight,
    p_visibility_permission, p_start_date, p_estimated_hours
  ) RETURNING id INTO v_task_id;

  IF v_initial_stage IS NOT NULL THEN
    INSERT INTO public.pipeline_stage_history (
      task_id, company_id, pipeline_id,
      from_stage_id, to_stage_id,
      transitioned_by, from_stage_name, to_stage_name
    ) VALUES (
      v_task_id, v_company_id, v_resolved_pipeline,
      NULL, v_initial_stage,
      v_user_id, NULL, v_initial_name
    );
  END IF;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'task', v_task_id, 'task.created',
    jsonb_build_object(
      'title',                 p_title,
      'priority',              p_priority,
      'pipeline',              v_resolved_pipeline,
      'visibility_permission', p_visibility_permission,
      'start_date',            p_start_date,
      'estimated_hours',       p_estimated_hours
    )
  );

  RETURN v_task_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. rpc_filehub_upload_commit: 10/min
-- ─────────────────────────────────────────────────────────────
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
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_company_id    UUID   := public.my_company_id();
    v_user_id       UUID   := auth.uid();
    v_file_id       UUID;
    v_version_id    UUID;
    v_clean_tags    TEXT[];
    v_final_name    TEXT;
    v_size_limit    BIGINT;
    v_storage_limit BIGINT;
    v_storage_used  BIGINT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;

    PERFORM public._rate_limit('file_upload', 10);

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
        SELECT COALESCE(storage_used_bytes, 0) INTO v_storage_used
        FROM public.company_billing WHERE company_id = v_company_id;
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

-- ─────────────────────────────────────────────────────────────
-- 7. rpc_filehub_replace_file: 20/min
-- ─────────────────────────────────────────────────────────────
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

    PERFORM public._rate_limit('file_replace', 20);

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
            FROM public.company_billing WHERE company_id = v_company_id;
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
