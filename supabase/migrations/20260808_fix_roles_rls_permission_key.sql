-- #213: deleting a role throws an error for EVERYONE, owners included.
--
-- Root cause (confirmed against the live DB, reproduced in isolation):
-- RoleManagerContext.deleteRole() does a raw `roles.update({deleted_at})` —
-- the only direct client write to this table (create/edit both go through
-- SECURITY DEFINER RPCs). roles_select's USING clause is
-- `deleted_at IS NULL AND ...`. Postgres requires the POST-image of an
-- UPDATE to remain visible under the table's SELECT policy, regardless of
-- the UPDATE policy's own USING/WITH CHECK — so setting deleted_at to
-- non-null always fails RLS with "new row violates row-level security
-- policy", for every caller, permissions notwithstanding. Minimal repro:
-- a table with `FOR SELECT USING (deleted_at IS NULL)` and
-- `FOR UPDATE USING (true) WITH CHECK (true)` still rejects
-- `UPDATE t SET deleted_at = now()`.
--
-- Fix: give it a SECURITY DEFINER RPC (rpc_delete_role, matching the
-- existing rpc_create_role/rpc_update_role pattern) that bypasses RLS for
-- its own UPDATE, same as every other role write already does.
--
-- Along the way: roles_update also checked has_permission('company:settings')
-- — a colon typo; that key doesn't exist (only 'company.settings' does) —
-- and never checked 'role.manage', the permission that actually gates the
-- Role Registry UI everywhere else. Fixed for defense-in-depth on any
-- future direct client write, even though the app itself now goes through
-- the RPC below.

ALTER POLICY roles_update ON public.roles
  USING (
    company_id = (SELECT users.company_id FROM users WHERE users.id = auth.uid())
    AND is_system = false
    AND (
      (SELECT users.is_owner FROM users WHERE users.id = auth.uid()) = true
      OR has_permission('company.settings')
      OR has_permission('role.manage')
    )
  );

CREATE OR REPLACE FUNCTION public.rpc_delete_role(p_role_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role_company_id UUID;
  v_role_is_system BOOLEAN;
  v_caller_company_id UUID;
BEGIN
  IF NOT (public.has_permission('role.manage') OR (SELECT is_owner FROM public.users WHERE id = auth.uid())) THEN
    RAISE EXCEPTION 'Access Denied: Insufficient role management capabilities.';
  END IF;

  SELECT company_id, is_system INTO v_role_company_id, v_role_is_system
  FROM public.roles WHERE id = p_role_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target authority record not found.';
  END IF;

  IF v_role_is_system OR v_role_company_id IS NULL THEN
    RAISE EXCEPTION 'System Protection: system and global template roles cannot be deleted.';
  END IF;

  v_caller_company_id := public.my_company_id();
  IF v_role_company_id != v_caller_company_id THEN
    RAISE EXCEPTION 'Scope Violation: Target role belongs to an external operational node.';
  END IF;

  UPDATE public.roles SET deleted_at = NOW() WHERE id = p_role_id;
END;
$function$;
