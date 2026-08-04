-- 20260804_project_name_conflicts.sql
-- Re-importing an edited spreadsheet was a dead end.
--
-- fn_check_batch_duplicate_names (20260801) RAISEs on a pasted name that
-- matches an existing active project: "rename them or archive the existing
-- project first." For the batch-paste flow that is the right answer. For the
-- flow it actually fires in — someone fixes a number in the same workbook and
-- drops it back in — it is a wall: every row collides, the only remedies
-- offered are to rename work that is already correctly named or to archive
-- live projects, and the import cannot proceed.
--
-- The missing third option is REPLACE: keep the project, its tasks, its
-- history and everything referencing it, and update the columns the
-- spreadsheet carries.
--
-- This migration adds ONE read-only function and changes nothing else. In
-- particular rpc_preview_instantiate_template and rpc_instantiate_template
-- are untouched, because they do not need to know:
--   * RENAME is a client-side edit — the row goes to the RPC under its new
--     name and the existing check passes.
--   * SKIP and REPLACE both remove the row from p_projects, so again the
--     existing check passes. A replaced project is then written by the same
--     rpc_set_project_field_values the import already calls for every other
--     project (it takes project ids, and does not care where they came from).
-- So the RPCs keep their guarantee — a green preview still promises a
-- successful commit — and the 250-line commit path is not re-typed to add a
-- feature that lives entirely upstream of it. (Re-typing a long live body
-- from a remembered migration has silently dropped behaviour twice in this
-- repo; see bug_group_list_files_folder_id.)
--
-- Why this has to be SECURITY DEFINER rather than a client-side select:
-- projects_company_id_name_key is company-wide, but the projects SELECT
-- policy is not — a colliding project the importer cannot see would be
-- invisible to a client query and the commit would fail on the raw
-- constraint again, which is exactly the class of bug 20260801 existed to
-- kill. `can_edit` is returned alongside so the UI can offer Replace only
-- where projects_update would actually allow it, and Rename/Skip otherwise —
-- the alternative is offering a button that fails.

CREATE OR REPLACE FUNCTION public.rpc_project_name_conflicts(p_names TEXT[])
RETURNS TABLE (
  name           TEXT,
  project_id     UUID,
  task_count     INT,
  portfolio_name TEXT,
  created_at     TIMESTAMPTZ,
  can_edit       BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id    UUID := auth.uid();
  v_is_owner   BOOLEAN := COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = v_user_id), FALSE);
BEGIN
  -- Same gate as the import itself. This reads names of projects the caller
  -- may not otherwise be allowed to see, so it is not open to any member.
  IF NOT (v_is_owner OR public.has_permission('project.create')) THEN
    RAISE EXCEPTION 'Insufficient permissions to check project names.';
  END IF;

  RETURN QUERY
  SELECT
    p.name,
    p.id,
    (SELECT COUNT(*)::INT FROM public.tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL),
    pf.name,
    p.created_at,
    -- Mirrors the projects_update USING clause (20260803) exactly. If these
    -- ever diverge the UI offers a Replace that the policy then refuses.
    v_is_owner OR (public.has_permission('project.edit') AND public.fn_project_accessible(p.id))
  FROM public.projects p
  LEFT JOIN public.portfolios pf ON pf.id = p.portfolio_id
  WHERE p.company_id = v_company_id
    -- deleted_at IS NULL matches the partial unique index's scope: a name
    -- held only by a soft-deleted project is free, and reporting it as a
    -- conflict would contradict the constraint this mirrors.
    AND p.deleted_at IS NULL
    AND p.name = ANY (
      SELECT DISTINCT TRIM(n) FROM unnest(p_names) AS n WHERE NULLIF(TRIM(n), '') IS NOT NULL
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_project_name_conflicts(TEXT[]) TO authenticated;

COMMENT ON FUNCTION public.rpc_project_name_conflicts(TEXT[]) IS
  'Which of these project names are already taken by an active project in my company, and may I edit each one? Read-only pre-flight for the import wizard''s Replace / Rename / Skip step.';
