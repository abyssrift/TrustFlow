-- Issue #431: allow a separately authorized, same-company archive view while
-- keeping the default archive reader principal-scoped.

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
    -- The explicit scoped action intentionally ignores archive.view_all.
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

-- Remove the exact legacy signature before defining the sole three-argument
-- PostgREST endpoint. This avoids overload resolution ambiguity.
REVOKE ALL ON FUNCTION public.rpc_get_archives(text, text) FROM PUBLIC, anon;
DROP FUNCTION public.rpc_get_archives(text, text);

CREATE FUNCTION public.rpc_get_archives(
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
       public.has_permission('archive.view') IS NOT TRUE
       OR public.has_permission('archive.view_all') IS NOT TRUE
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
