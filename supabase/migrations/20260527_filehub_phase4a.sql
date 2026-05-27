-- 20260527_filehub_phase4a.sql
-- Phase 4a: activity log table + tag management RPCs

-- ── Activity log table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.filehub_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES public.filehub_files(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('upload', 'download', 'view', 'delete', 'share')),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.filehub_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "filehub_activity_select" ON public.filehub_activity
    FOR SELECT USING (
        company_id = public.my_company_id()
        AND public.has_permission('filehub:view')
    );

CREATE INDEX IF NOT EXISTS filehub_activity_file_id_idx
    ON public.filehub_activity(file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS filehub_activity_company_id_idx
    ON public.filehub_activity(company_id);

-- ── Log an activity entry (SECURITY DEFINER — bypasses INSERT RLS) ────────────

CREATE OR REPLACE FUNCTION public.rpc_filehub_log_activity(
    p_file_id UUID,
    p_action TEXT,
    p_metadata JSONB DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.filehub_activity (company_id, file_id, user_id, action, metadata)
    VALUES (public.my_company_id(), p_file_id, auth.uid(), p_action, p_metadata);
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

-- ── Fetch activity for a specific file ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_filehub_file_activity(p_file_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',         a.id,
            'action',     a.action,
            'metadata',   a.metadata,
            'created_at', a.created_at,
            'user',       jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url)
        ) ORDER BY a.created_at DESC
    ), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_activity a
    JOIN public.users u ON u.id = a.user_id
    WHERE a.file_id = p_file_id AND a.company_id = public.my_company_id();
    RETURN v_rows;
END;
$$;

-- ── All tags with usage counts ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_filehub_all_tags()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object('tag', tag, 'count', cnt)
        ORDER BY cnt DESC, tag ASC
    ), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT t AS tag, COUNT(*)::int AS cnt
        FROM public.filehub_files f, unnest(f.tags) t
        WHERE f.deleted_at IS NULL AND f.company_id = public.my_company_id()
        GROUP BY t
    ) sub;
    RETURN v_rows;
END;
$$;

-- ── Rename a tag across all files ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_filehub_rename_tag(p_old TEXT, p_new TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    p_new := lower(trim(regexp_replace(p_new, '\s+', '-', 'g')));
    IF p_new = '' THEN RAISE EXCEPTION 'Tag name cannot be empty.'; END IF;
    UPDATE public.filehub_files
    SET tags = array_replace(tags, p_old, p_new)
    WHERE company_id = public.my_company_id()
      AND deleted_at IS NULL
      AND p_old = ANY(tags);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- ── Delete a tag from all files ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_filehub_delete_tag(p_tag TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    UPDATE public.filehub_files
    SET tags = array_remove(tags, p_tag)
    WHERE company_id = public.my_company_id()
      AND deleted_at IS NULL
      AND p_tag = ANY(tags);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;
