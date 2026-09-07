-- 20260801_seed_default_company_roles.sql
-- Fixes #181: new workspaces were created with zero roles, making RBAC
-- unusable once a second person joins (the owner never notices because
-- has_permission() bypasses for is_owner).
--
-- Root cause: rpc_create_company_and_link is the only function that ever
-- inserts into public.companies, and while it links the creator to the
-- shared global "Owner" system role (company_id IS NULL, is_system = TRUE),
-- it never creates any company-scoped role for the new workspace. The other
-- three functions in the creation family (handle_new_user,
-- rpc_join_company_by_code, rpc_complete_onboarding) don't create companies
-- at all, so they were never the gap.
--
-- Fix: an AFTER INSERT trigger on public.companies — the single point where
-- a company row is born, so a future 5th creation path can't reintroduce
-- this. It clones the four existing global system roles (Personnel/Manager/
-- Admin/Owner — verified as the shape actually in use by both healthy
-- production companies, not an invented taxonomy) into company-scoped rows
-- with the same permission sets, editable by the owner. This also makes
-- future permission grants keep working automatically: every existing
-- role_permissions-seeding migration in this repo grants by role NAME
-- (`WHERE r.name IN ('Owner','Admin','Manager','Personnel')`) or by "whoever
-- already holds related permission X", never scoped to company_id IS NULL,
-- so the per-company clones stay in sync going forward.
--
-- Idempotent: a company that already has any role of its own (custom or
-- previously seeded) is left untouched.

CREATE OR REPLACE FUNCTION public.fn_seed_company_default_roles(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    ON CONFLICT (company_id, name) DO NOTHING
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
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_seed_company_default_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_seed_company_default_roles(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_seed_default_roles ON public.companies;
CREATE TRIGGER trg_companies_seed_default_roles
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_seed_company_default_roles();
