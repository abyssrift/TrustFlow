-- Issue #431: make the scoped archive read explicit and preserve the optional
-- same-company expansion behind its own permission check.

CREATE OR REPLACE FUNCTION public.fn_archive_accessible(
  p_archive_id uuid,
  p_action text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid;
BEGIN
  IF v_uid IS NULL OR p_action NOT IN ('view', 'view_scoped', 'restore', 'purge') THEN
    RETURN false;
  END IF;

  SELECT u.company_id INTO v_company_id
  FROM public.users u
  WHERE u.id = v_uid
    AND u.deleted_at IS NULL
    AND u.is_active = true;

  IF v_company_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.archives a
    WHERE a.id = p_archive_id AND a.company_id = v_company_id
  ) THEN
    RETURN false;
  END IF;

  IF p_action IN ('view', 'view_scoped') THEN
    IF NOT public.has_permission('archive.view') THEN RETURN false; END IF;
    -- Only the ordinary view action honors the company-wide modifier.
    IF p_action = 'view' AND public.has_permission('archive.view_all') THEN
      RETURN true;
    END IF;
  ELSIF p_action = 'restore' THEN
    IF NOT public.has_permission('archive.restore') THEN RETURN false; END IF;
    IF public.has_permission('archive.restore_all') THEN RETURN true; END IF;
  ELSE
    RETURN public.has_permission('archive.delete')
       AND public.has_permission('archive.view_all');
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.archive_access_principals ap
    WHERE ap.archive_id = p_archive_id
      AND ap.company_id = v_company_id
      AND (
        ap.user_id = v_uid
        OR ap.team_id IN (
          SELECT tm.team_id
          FROM public.team_members tm
          WHERE tm.user_id = v_uid AND tm.removed_at IS NULL
        )
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_archive_accessible(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_archive_accessible(uuid, text) TO authenticated;

-- The previous migration may already have removed this exact legacy overload.
-- Revoke when present, then drop it so PostgREST has only one RPC candidate.
DO $legacy_rpc$
BEGIN
  IF to_regprocedure('public.rpc_get_archives(text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_get_archives(text, text) FROM PUBLIC, anon';
    EXECUTE 'DROP FUNCTION public.rpc_get_archives(text, text)';
  END IF;
END;
$legacy_rpc$;

CREATE OR REPLACE FUNCTION public.rpc_get_archives(
  p_entity_type text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_include_company boolean DEFAULT false
)
RETURNS SETOF public.archives
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_include_company IS TRUE
     AND (
       NOT public.has_permission('archive.view')
       OR NOT public.has_permission('archive.view_all')
     ) THEN
    RAISE EXCEPTION 'Insufficient permission to view all company archives'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.*
  FROM public.archives a
  WHERE CASE
          WHEN p_include_company IS TRUE
            THEN public.fn_archive_accessible(a.id, 'view')
          ELSE public.fn_archive_accessible(a.id, 'view_scoped')
        END
    AND (p_entity_type IS NULL OR a.entity_type = p_entity_type)
    AND (p_search IS NULL OR (
      a.search_vector @@ websearch_to_tsquery('english', p_search)
      OR a.metadata->>'title' ILIKE '%' || p_search || '%'
    ))
  ORDER BY a.archived_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_archives(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_archives(text, text, boolean) TO authenticated;
