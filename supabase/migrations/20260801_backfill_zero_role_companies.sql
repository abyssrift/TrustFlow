-- 20260801_backfill_zero_role_companies.sql
-- Backfill for #181: repairs existing companies that were created before
-- the trg_companies_seed_default_roles trigger (20260801_seed_default_company_roles.sql)
-- existed, and so still have zero roles of their own.
--
-- Reuses the same fn_seed_company_default_roles() the trigger uses, so the
-- seeded shape is identical and this file can't drift from the fix. That
-- function is itself idempotent (no-ops for a company that already has any
-- role), so this migration is safe to re-run and, on production, will only
-- ever touch the companies that measured zero roles at diagnosis time — the
-- two companies that already have their own custom roles are untouched by
-- construction, not by a special case here.

DO $$
DECLARE
  v_company RECORD;
BEGIN
  FOR v_company IN
    SELECT c.id
    FROM public.companies c
    WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.company_id = c.id)
  LOOP
    PERFORM public.fn_seed_company_default_roles(v_company.id);
  END LOOP;
END;
$$;
