-- 20260804_seed_company_default_roles.sql
-- Issue #181 — new workspaces are created with zero roles.
--
-- THE FIX ALREADY EXISTED. IT JUST WAS NOT IN THE REPO.
--
-- fn_seed_company_default_roles and trg_companies_seed_default_roles are live
-- on the local database and are the reason a fresh signup there now comes out
-- with 4 roles and 168 permissions. 20260803_fix_company_creation.sql even
-- documents the trigger by name and relies on it firing. But no migration
-- ever CREATED either object — they were applied by hand. So they exist in
-- exactly one place, they would vanish on any rebuild, and they were never
-- going to reach production, where 4 of 6 companies still have no roles at
-- all.
--
-- This migration is that repair captured verbatim from the live definitions
-- (pg_get_functiondef, not retyped from memory), plus the backfill #181 asks
-- for.
--
-- WHY A TRIGGER RATHER THAN FIXING THE FOUR RPCs
-- #181 lists four functions that can produce "a company exists with an owner"
-- and notes only one seeds roles. Patching each is four chances to drift and
-- no protection against a fifth path. A trigger on public.companies means the
-- roles are seeded wherever the row is born — including a hand-written INSERT
-- during support work, which is a path no RPC audit would have covered.
--
-- WHY THE SEEDER IS SAFE TO RUN ON AN EXISTING COMPANY
-- It returns immediately if the company holds ANY role. That is deliberate
-- and load-bearing: a company that customised its roles must never have the
-- template poured back over it. It also makes the backfill below a no-op for
-- every company that is already fine, and makes the whole migration
-- re-runnable.

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
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_seed_company_default_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_seed_company_default_roles(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_companies_seed_default_roles ON public.companies;
CREATE TRIGGER trg_companies_seed_default_roles
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_seed_company_default_roles();

-- ── backfill: the companies that were born before the trigger existed ───────
DO $backfill$
DECLARE
  v_company    RECORD;
  v_seeded     INT := 0;
  v_relinked   INT := 0;
BEGIN
  FOR v_company IN
    SELECT c.id, c.name
    FROM public.companies c
    WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.company_id = c.id)
  LOOP
    PERFORM public.fn_seed_company_default_roles(v_company.id);
    v_seeded := v_seeded + 1;
    RAISE NOTICE 'seeded default roles into company % (%)', v_company.name, v_company.id;
  END LOOP;

  -- The other half of #181's "unable to onboard a second user".
  --
  -- 20260803_fix_company_creation.sql's BUG A: before that fix, the creation
  -- RPC linked the new owner to the GLOBAL TEMPLATE 'Owner' role — a row
  -- shared by every company on the platform. Anyone who opened the role
  -- editor and pressed Save would have been editing the permission seed for
  -- every workspace created afterwards. That fix stopped NEW companies doing
  -- it; the rows already written were left pointing at the template.
  --
  -- Re-point each such row at the same-named role inside the user's own
  -- company, which the seeding above has now guaranteed exists. Matched on
  -- name because that is the identity the template copy preserves.
  WITH mislinked AS (
    SELECT ur.user_id, ur.company_id, ur.role_id AS template_role_id, own.id AS own_role_id
    FROM public.user_roles ur
    JOIN public.roles tmpl ON tmpl.id = ur.role_id AND tmpl.company_id IS NULL AND tmpl.is_system = TRUE
    JOIN public.roles own  ON own.company_id = ur.company_id
                          AND own.name = tmpl.name
                          AND own.deleted_at IS NULL
  ),
  moved AS (
    UPDATE public.user_roles ur
    SET role_id = m.own_role_id
    FROM mislinked m
    WHERE ur.user_id = m.user_id
      AND ur.company_id = m.company_id
      AND ur.role_id = m.template_role_id
      -- Never create a duplicate membership if the user somehow already holds
      -- their own company's copy as well.
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles dup
        WHERE dup.user_id = m.user_id AND dup.role_id = m.own_role_id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_relinked FROM moved;

  RAISE NOTICE '#181 backfill: % company(ies) seeded, % user_roles row(s) moved off the global template', v_seeded, v_relinked;
END;
$backfill$;
