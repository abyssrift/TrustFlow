-- Who actually has access to a pipeline, for the kanban right sidebar.
-- The definition mirrors the pipelines_select RLS predicate exactly — the single
-- source of truth for "who can see this board" — so the sidebar list always equals
-- the set of users who can actually open the board, and auto-scales as roles/
-- permissions are added (access is role-driven; the only literal is the admin
-- override key, identical to the RLS).
--
-- Access = owner OR system.view_all_data OR open gate (empty visibility_permissions)
--          OR a role in visibility_permissions (via user_roles).
-- SECURITY DEFINER so names/avatars resolve even when users-table RLS would hide a
-- row from the caller; still hard-scoped to the caller's own company.

-- Per-user permission check (fn_has_permission, parameterized for any user).
-- Reusable primitive so membership/scoping logic never hardcodes role joins.
CREATE OR REPLACE FUNCTION public.fn_user_has_permission(p_user_id UUID, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user_id AND ur.revoked_at IS NULL AND p.key = p_key
    UNION ALL
    SELECT 1 FROM public.team_members tm
    JOIN public.team_roles tr ON tr.team_id = tm.team_id
    JOIN public.role_permissions rp ON rp.role_id = tr.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE tm.user_id = p_user_id AND tm.removed_at IS NULL AND p.key = p_key
  );
$function$;

CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_members(p_pipeline_id UUID)
RETURNS TABLE (id UUID, full_name TEXT, email TEXT, avatar_url TEXT, is_owner BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_roles      TEXT[];  -- visibility_permissions stores role UUIDs as text
BEGIN
  SELECT p.company_id, p.visibility_permissions
  INTO   v_company_id, v_roles
  FROM   public.pipelines p
  WHERE  p.id = p_pipeline_id AND p.deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT DISTINCT u.id, u.full_name, u.email, u.avatar_url, u.is_owner
  FROM   public.users u
  WHERE  u.company_id = v_company_id
    AND  u.deleted_at IS NULL
    AND (
      u.is_owner = TRUE
      OR v_roles IS NULL
      OR array_length(v_roles, 1) IS NULL           -- open gate → everyone in company
      OR public.fn_user_has_permission(u.id, 'system.view_all_data')  -- admin override (mirrors RLS)
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = u.id AND ur.company_id = v_company_id
          AND ur.revoked_at IS NULL AND ur.role_id::text = ANY(v_roles)
      )
    )
  ORDER BY u.full_name NULLS LAST;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_user_has_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_pipeline_members(UUID) TO authenticated;
