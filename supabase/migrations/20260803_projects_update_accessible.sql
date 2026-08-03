-- Close #189: projects_update is company-wide and has no WITH CHECK.
--
-- THE GAP
--     USING      (company_id = my_company_id() AND (is_owner OR project.edit))
--     WITH CHECK  NULL
--
-- Two distinct holes in one policy:
--
-- 1. USING is company-wide. #186 tightened projects_SELECT to default-deny via
--    fn_project_accessible and left UPDATE alone, so anyone holding
--    project.edit can modify a project they cannot even see. For a firm
--    holding competing clients that is the disclosure #186 exists to prevent,
--    reachable by writing instead of reading.
--
-- 2. No WITH CHECK means the post-image is never validated. A row can be
--    updated INTO a state the author could not have created — including
--    moving it to another company_id, which USING alone cannot stop because
--    USING only tests the row as it was BEFORE the write.
--
-- This is the class that produced the #185 escalation, where
-- rolled_forward_from_project_id became an access-control input on a
-- client-writable column. 20260802_rollforward_link_guard.sql plugged that one
-- column with a trigger and explicitly deferred the underlying policy, noting
-- its blast radius was wider than rollforward. This is that deferred fix.
--
-- WHY IT IS SAFE TO TIGHTEN NOW AND WAS NOT BEFORE
-- fn_project_accessible grants on: project.view_all, owning the project, or
-- being assigned a task in it. Until 20260803_backfill_project_view_all.sql,
-- NO role in any pre-existing company held project.view_all, so tightening
-- UPDATE to this predicate would have locked every manager out of editing
-- projects they legitimately administer. The backfill (0 -> 18 roles across
-- 7/7 companies on local) is what makes this change non-breaking. Order
-- matters: that migration must ship first.
--
-- WITH CHECK is the same predicate plus an explicit company pin. Same-company
-- is already implied by fn_project_accessible's own floor, but stating it here
-- means a future edit to that function cannot silently open a cross-tenant
-- write path.

DROP POLICY IF EXISTS projects_update ON public.projects;

CREATE POLICY projects_update ON public.projects
  FOR UPDATE
  USING (
    company_id = public.my_company_id()
    AND deleted_at IS NULL
    AND (
      (SELECT users.is_owner FROM public.users WHERE users.id = auth.uid()) = TRUE
      OR (public.has_permission('project.edit') AND public.fn_project_accessible(id))
    )
  )
  WITH CHECK (
    company_id = public.my_company_id()
    AND (
      (SELECT users.is_owner FROM public.users WHERE users.id = auth.uid()) = TRUE
      OR (public.has_permission('project.edit') AND public.fn_project_accessible(id))
    )
  );

DO $verify$
DECLARE
  v_using TEXT;
  v_check TEXT;
BEGIN
  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    INTO v_using, v_check
  FROM pg_policy
  WHERE polrelid = 'public.projects'::regclass AND polname = 'projects_update';

  IF v_check IS NULL THEN
    RAISE EXCEPTION 'projects_update still has no WITH CHECK — the post-image is unvalidated';
  END IF;
  IF position('fn_project_accessible' IN v_using) = 0 THEN
    RAISE EXCEPTION 'projects_update USING does not call fn_project_accessible — still company-wide';
  END IF;
  IF position('fn_project_accessible' IN v_check) = 0 THEN
    RAISE EXCEPTION 'projects_update WITH CHECK does not call fn_project_accessible';
  END IF;

  RAISE NOTICE 'projects_update now gated by fn_project_accessible on both USING and WITH CHECK';
END
$verify$;
