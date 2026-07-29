-- FileHub is now available on all plans; file size cap varies by tier.
-- Removes FileHub from the "gated features" list and adds max_file_bytes to each plan's limits.

-- ─────────────────────────────────────────────────────────────
-- Update human-readable feature copy to reflect FileHub on all tiers
-- ─────────────────────────────────────────────────────────────
UPDATE public.billing_plans SET features = '["Up to 5 members","Core tasks & pipelines","FileHub (10 MB/file)","Community support"]'::jsonb WHERE code = 'free';
UPDATE public.billing_plans SET features = '["Unlimited members","Advanced analytics & reporting","FileHub (250 MB/file)","Priority support"]'::jsonb WHERE code = 'pro';
UPDATE public.billing_plans SET features = '["Unlimited members","FileHub (1 GB/file)","Analytics & reporting","Data retention & export","Automations","Priority support"]'::jsonb WHERE code = 'business';
UPDATE public.billing_plans SET features = '["Unlimited members","FileHub (unlimited)","Everything in Business","Custom contracts & SLAs","Dedicated onboarding","SSO (coming soon)"]'::jsonb WHERE code = 'enterprise';

-- ─────────────────────────────────────────────────────────────
-- Plan limits: give everyone FileHub, gate only by file size
-- ─────────────────────────────────────────────────────────────
UPDATE public.billing_plans SET limits = jsonb_build_object(
  'max_members',   5,
  'max_file_bytes', 10485760,   -- 10 MB
  'features',      '[]'::jsonb
) WHERE code = 'free';

UPDATE public.billing_plans SET limits = jsonb_build_object(
  'max_members',   NULL,
  'max_file_bytes', 262144000,  -- 250 MB
  'features',      '["analytics","reporting"]'::jsonb
) WHERE code = 'pro';

UPDATE public.billing_plans SET limits = jsonb_build_object(
  'max_members',   NULL,
  'max_file_bytes', 1073741824, -- 1 GB
  'features',      '["analytics","reporting","retention","automations","data_export"]'::jsonb
) WHERE code = 'business';

UPDATE public.billing_plans SET limits = jsonb_build_object(
  'max_members',   NULL,
  'max_file_bytes', NULL,       -- unlimited
  'features',      '["analytics","reporting","retention","automations","data_export","sso"]'::jsonb
) WHERE code = 'enterprise';

-- ─────────────────────────────────────────────────────────────
-- Helper: per-company file size limit in bytes (-1 = unlimited)
-- Falls back to 25 MB (free) if no billing row exists.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._company_file_size_limit(p_company_id uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN (bp.limits->>'max_file_bytes') IS NULL THEN -1
        ELSE (bp.limits->>'max_file_bytes')::bigint
      END
      FROM public.company_billing cb
      JOIN public.billing_plans bp ON bp.code = cb.plan_code
      WHERE cb.company_id = p_company_id
    ),
    10485760  -- 10 MB default (free plan) if no billing row
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- Lightweight RPC any member can call — no billing permission needed.
-- Returns the limits JSON for the caller's company/plan.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_my_plan_limits()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT bp.limits
      FROM public.company_billing cb
      JOIN public.billing_plans bp ON bp.code = cb.plan_code
      WHERE cb.company_id = public.my_company_id()
    ),
    '{"max_members": 5, "max_file_bytes": 10485760, "features": []}'::jsonb
  );
$$;
GRANT EXECUTE ON FUNCTION public.rpc_my_plan_limits() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- Patch rpc_filehub_upload_commit: replace hardcoded 500 MB cap
-- with plan-based limit. Signature unchanged.
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
    v_company_id   UUID   := public.my_company_id();
    v_user_id      UUID   := auth.uid();
    v_file_id      UUID;
    v_version_id   UUID;
    v_clean_tags   TEXT[];
    v_final_name   TEXT;
    v_size_limit   BIGINT;
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

    -- Plan-based file size enforcement (replaces hardcoded 500 MB cap).
    v_size_limit := public._company_file_size_limit(v_company_id);
    IF v_size_limit <> -1 AND p_size_bytes > v_size_limit THEN
        RAISE EXCEPTION 'File too large for your plan (% MB limit). Upgrade to upload larger files.',
            round(v_size_limit::numeric / 1048576);
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

-- ─────────────────────────────────────────────────────────────
-- Same patch for rpc_filehub_replace_file
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
    v_company_id UUID   := public.my_company_id();
    v_user_id    UUID   := auth.uid();
    v_file       public.filehub_files%ROWTYPE;
    v_next_no    INT;
    v_version_id UUID;
    v_size_limit BIGINT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
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

    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found.';
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
