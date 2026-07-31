-- Proves #179 + #180 work as a pair: once archiving soft-deletes a project,
-- its name must become reusable. Run with BOTH migrations applied.
--
--   psql "$LOCAL_DB_URL" -f supabase/checks/projects_name_reuse_after_archive_check.sql
--
-- Fails loudly if either half is missing:
--   * without #180, the re-create raises duplicate key on projects_company_id_name_key
--   * without #179, the project is hard-deleted and the test is vacuous, so we
--     assert the archived row still exists and is soft-deleted.
BEGIN;
DO $$
DECLARE
  v_company UUID; v_user UUID; v_tag TEXT := substr(md5(random()::text),1,8);
  v_name TEXT; v_p1 UUID; v_p2 UUID; v_arch UUID; v_err TEXT;
BEGIN
  SELECT id, company_id INTO v_user, v_company
  FROM public.users WHERE is_owner = true LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No owner user found - run against a seeded dev DB, not prod.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  v_name := 'name-reuse-probe-' || v_tag;

  INSERT INTO public.projects (company_id, name, created_by)
  VALUES (v_company, v_name, v_user) RETURNING id INTO v_p1;

  v_arch := public.rpc_archive_project(v_p1);

  -- #179: the row survives, soft-deleted (not destroyed).
  ASSERT EXISTS (SELECT 1 FROM public.projects WHERE id = v_p1),
    '#179 missing: archive hard-deleted the project row';
  ASSERT (SELECT deleted_at IS NOT NULL FROM public.projects WHERE id = v_p1),
    '#179 missing: archived project was not soft-deleted';

  -- #180: the name is free again.
  BEGIN
    INSERT INTO public.projects (company_id, name, created_by)
    VALUES (v_company, v_name, v_user) RETURNING id INTO v_p2;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE EXCEPTION '#180 missing: cannot reuse an archived project name (%)', v_err;
  END;

  ASSERT v_p2 IS DISTINCT FROM v_p1, 'expected a genuinely new project row';
  ASSERT (SELECT count(*) FROM public.projects
          WHERE company_id = v_company AND name = v_name) = 2,
    'expected the archived and the live project to coexist under one name';
  ASSERT (SELECT count(*) FROM public.projects
          WHERE company_id = v_company AND name = v_name AND deleted_at IS NULL) = 1,
    'exactly one project with that name may be live at a time';

  RAISE NOTICE 'name reuse after archive: PASSED (archived row kept, name reusable, only one live)';
END $$;
ROLLBACK;
