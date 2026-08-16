-- #212: role names could be created as exact duplicates. RoleBuilder saves
-- whatever name is typed with no uniqueness check.
--
-- The existing `roles_company_id_name_key` unique index already blocked
-- exact-CASE duplicates (raw Postgres error surfaced via errorToast), but:
--   1. It was case-SENSITIVE, so 'Manager' and 'manager' could coexist.
--   2. It had no `WHERE deleted_at IS NULL`, so a soft-deleted role's name
--      permanently blocked reuse -- worth fixing while touching this index,
--      flagged in #212 itself ("soft-deleted roles should probably be
--      excluded from the duplicate check").
--
-- Fix: replace the index with a case-insensitive, not-deleted-scoped one,
-- and have rpc_create_role/rpc_update_role translate the resulting
-- unique_violation into a friendly message. No RoleBuilder.tsx change
-- needed -- createRole/updateRole already errorToast(e.message) on
-- failure (contexts/RoleManagerContext.tsx), so the friendly RPC message
-- surfaces as-is.
--
-- 20260802_pipelines_name_uniqueness_soft_delete.sql deliberately left this
-- constraint alone, on the stated premise that "no delete RPC writes
-- deleted_at" for roles. That's since gone stale: rpc_delete_role (#213,
-- supabase/checks/check_role_delete_permission.sql) does soft-delete via
-- `UPDATE roles SET deleted_at = NOW()`, confirmed against prod. So the
-- partial index isn't speculative here, it closes the same real gap it
-- closed for pipelines.
--
-- Changing the index's shape also changes fn_seed_company_default_roles'
-- ON CONFLICT (company_id, name) arbiter match -- updated below to the new
-- expression + predicate, same body otherwise.

ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_company_id_name_key;
DROP INDEX IF EXISTS public.roles_company_id_name_key;
CREATE UNIQUE INDEX roles_company_id_name_key
  ON public.roles (company_id, lower(name))
  NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.rpc_create_role(p_name text, p_description text, p_color text, p_permissions uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role_id UUID;
  v_company_id UUID;
  v_perm_id UUID;
BEGIN
  v_company_id := public.my_company_id();

  -- Auth Check
  IF NOT ( (SELECT is_owner FROM public.users WHERE id = auth.uid()) OR public.has_permission('role.manage') ) THEN
    RAISE EXCEPTION 'Access Denied';
  END IF;

  -- Create Role
  BEGIN
    INSERT INTO public.roles (company_id, name, description, color, created_by)
    VALUES (v_company_id, p_name, p_description, p_color, auth.uid())
    RETURNING id INTO v_role_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A role named "%" already exists.', p_name;
  END;

  -- Attach Permissions
  IF p_permissions IS NOT NULL AND array_length(p_permissions, 1) > 0 THEN
    FOREACH v_perm_id IN ARRAY p_permissions
    LOOP
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_role_id, v_perm_id);
    END LOOP;
  END IF;

  RETURN v_role_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_role(p_role_id uuid, p_name text, p_description text, p_color text, p_permissions uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role_company_id UUID;
  v_caller_company_id UUID;
  v_perm_id UUID;
BEGIN
  IF NOT public.has_permission('role.manage') THEN
    RAISE EXCEPTION 'Access Denied: Insufficient role management capabilities.';
  END IF;

  SELECT company_id INTO v_role_company_id
  FROM public.roles
  WHERE id = p_role_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target authority record not found.';
  END IF;

  v_caller_company_id := public.my_company_id();

  IF v_role_company_id IS NULL THEN
    IF NOT public.has_permission('role.manage_global') THEN
      RAISE EXCEPTION 'System Protection: Elevated authorization required to modify platform-wide protocols.';
    END IF;
  ELSIF v_role_company_id != v_caller_company_id THEN
    RAISE EXCEPTION 'Scope Violation: Target role belongs to an external operational node.';
  END IF;

  BEGIN
    UPDATE public.roles
    SET name = p_name,
        description = p_description,
        color = p_color,
        updated_at = NOW()
    WHERE id = p_role_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A role named "%" already exists.', p_name;
  END;

  DELETE FROM public.role_permissions WHERE role_id = p_role_id;

  IF p_permissions IS NOT NULL AND array_length(p_permissions, 1) > 0 THEN
    FOREACH v_perm_id IN ARRAY p_permissions
    LOOP
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (p_role_id, v_perm_id);
    END LOOP;
  END IF;
END;
$function$;

-- fn_seed_company_default_roles' ON CONFLICT (company_id, name) targeted the
-- old total index by column match; it no longer matches the new expression +
-- partial index above, so a fresh company would fail to seed its default
-- roles. Same body, arbiter updated to match (same convention already used
-- for clients in 20260801_batch_configuration_step.sql).
CREATE OR REPLACE FUNCTION public.fn_seed_company_default_roles(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_template     RECORD;
  v_new_role_id  uuid;
BEGIN
  -- Company already has role(s) of its own (custom or already seeded) — do nothing.
  IF EXISTS (SELECT 1 FROM public.roles WHERE company_id = p_company_id) THEN
    RETURN;
  END IF;

  FOR v_template IN
    SELECT id, name, description, color, is_default
    FROM public.roles
    WHERE company_id IS NULL
      AND is_system = TRUE
      AND deleted_at IS NULL
    ORDER BY name
  LOOP
    INSERT INTO public.roles (company_id, name, description, color, is_system, is_default)
    VALUES (p_company_id, v_template.name, v_template.description, v_template.color, FALSE, v_template.is_default)
    ON CONFLICT (company_id, lower(name)) WHERE deleted_at IS NULL DO NOTHING
    RETURNING id INTO v_new_role_id;

    IF v_new_role_id IS NOT NULL THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      SELECT v_new_role_id, rp.permission_id
      FROM public.role_permissions rp
      WHERE rp.role_id = v_template.id
      ON CONFLICT DO NOTHING;
    END IF;

    v_new_role_id := NULL;
  END LOOP;
END;
$function$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, count(*) AS n
    FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname IN ('rpc_create_role', 'rpc_update_role', 'fn_seed_company_default_roles')
    GROUP BY p.proname
  LOOP
    IF r.n <> 1 THEN
      RAISE EXCEPTION 'MIGRATION FAILED: % has % signatures, expected exactly 1', r.proname, r.n;
    END IF;
  END LOOP;
END;
$$;
