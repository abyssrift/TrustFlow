-- Issue #284: fix a cross-user RLS leak in harvested_files' SELECT policy.
--
-- 20260819_harvest_rules_schema.sql created "HarvestedFiles: select by
-- folder access" with:
--
--   company_id = public.my_company_id()
--   AND EXISTS (SELECT 1 FROM public.filehub_folders fo WHERE fo.id = harvested_files.destination_folder_id)
--
-- The migration's own comment claimed this composes on filehub_folders' RLS
-- to get real per-folder access control "for free" (the task_pipeline_links
-- technique). It doesn't: filehub_folders' SELECT policy
-- (filehub_folders_select_company) is COMPANY-SCOPED ONLY --
-- company_id = my_company_id() AND deleted_at IS NULL -- not per-folder. The
-- EXISTS above only proves "this folder exists in my company," which is
-- already guaranteed by harvested_files.company_id = my_company_id() one
-- line up. Net effect: every same-company user could read every
-- harvested_files pointer row regardless of whether they actually have
-- access to the destination folder (owner/broadcast/group/project scope) --
-- e.g. a user with no access to a private project's deliverable folder could
-- still see that project's harvested file pointers.
--
-- Caught by supabase/checks/check_project_deliverable.sql assertion (5b):
-- "outsider can read the harvested pointer row via RLS" -- expected to be
-- denied, was not.
--
-- Fix: reuse public.filehub_folder_accessible(p_folder_id UUID), the
-- existing function that already implements real per-folder accessibility
-- (owner, broadcast, group membership + overrides, and
-- scope = 'project' AND fn_project_accessible(project_id) -- exactly what a
-- project's deliverable folder needs). filehub_files' own real SELECT
-- policy already uses this same function for its 'project'-visibility
-- branch; harvested_files should compose on it too, not re-derive folder
-- access via a second (broken) EXISTS.

DROP POLICY "HarvestedFiles: select by folder access" ON public.harvested_files;

CREATE POLICY "HarvestedFiles: select by folder access" ON public.harvested_files
  FOR SELECT USING (
    company_id = public.my_company_id()
    AND public.filehub_folder_accessible(destination_folder_id)
  );

DO $$
BEGIN
  ASSERT (
    SELECT count(*) FROM pg_policy WHERE polrelid = 'public.harvested_files'::regclass
  ) = 1, 'harvested_files must still have exactly 1 RLS policy (SELECT-only) after the fix';

  RAISE NOTICE '20260820_harvested_files_rls_fix.sql wiring assertions passed';
END $$;
