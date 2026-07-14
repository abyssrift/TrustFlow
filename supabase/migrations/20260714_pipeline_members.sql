-- Who actually has access to a pipeline, for the kanban right sidebar.
-- Access = company owners + users whose role (directly via user_roles, or via a
-- team role) is listed in pipelines.visibility_permissions (an array of role IDs).
-- An empty/NULL visibility_permissions means no role gate → all active company users.
-- SECURITY DEFINER so names/avatars resolve even when users-table RLS would hide a
-- row from the caller; still hard-scoped to the caller's own company.

CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_members(p_pipeline_id UUID)
RETURNS TABLE (id UUID, full_name TEXT, email TEXT, avatar_url TEXT, is_owner BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_roles      UUID[];
BEGIN
  SELECT p.company_id, p.visibility_permissions
  INTO   v_company_id, v_roles
  FROM   public.pipelines p
  WHERE  p.id = p_pipeline_id AND p.deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RETURN; -- unknown/deleted pipeline
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
      OR array_length(v_roles, 1) IS NULL           -- no role gate → everyone in company
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = u.id AND ur.revoked_at IS NULL AND ur.role_id = ANY(v_roles)
      )
      OR EXISTS (
        SELECT 1 FROM public.team_members tm
        JOIN   public.team_roles tr ON tr.team_id = tm.team_id
        WHERE  tm.user_id = u.id AND tm.removed_at IS NULL AND tr.role_id = ANY(v_roles)
      )
    )
  ORDER BY u.full_name NULLS LAST;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_get_pipeline_members(UUID) TO authenticated;
