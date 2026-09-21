-- Transactional contract check for rpc_get_canonical_analytics_targets().
-- Run only after the canonical analytics target migration is installed.
-- All fixtures and temporary role changes are rolled back.
--
--   docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/checks/check_canonical_analytics_targets.sql

BEGIN;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE canonical_targets_check_ctx (
  company_id uuid,
  caller_id uuid,
  denied_id uuid,
  target_volume_id uuid,
  null_created_id uuid,
  empty_volume_id uuid,
  performance_id uuid,
  foreign_target_id uuid
);
GRANT SELECT ON canonical_targets_check_ctx TO authenticated;

DO $setup$
DECLARE
  v_company uuid := gen_random_uuid();
  v_foreign_company uuid := gen_random_uuid();
  v_caller uuid := gen_random_uuid();
  v_foreign_owner uuid := gen_random_uuid();
  v_denied uuid := gen_random_uuid();
  v_role uuid := gen_random_uuid();
  v_pipeline uuid;
  v_foreign_pipeline uuid;
  v_target_stage uuid;
  v_null_stage uuid;
  v_empty_stage uuid;
  v_performance_stage uuid;
  v_caller_project uuid;
  v_foreign_project uuid;
  v_target_volume uuid := gen_random_uuid();
  v_null_created uuid := gen_random_uuid();
  v_empty_volume uuid := gen_random_uuid();
  v_performance uuid := gen_random_uuid();
  v_foreign_target uuid := gen_random_uuid();
  v_visible_task1 uuid;
  v_visible_task2 uuid;
  v_hidden_task uuid;
  v_hidden_project_task uuid;
  v_permission_rows integer;
  v_marker text := 'canonical-target-' || gen_random_uuid()::text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_caller, v_marker || '-caller@test.invalid'),
    (v_foreign_owner, v_marker || '-foreign-owner@test.invalid'),
    (v_denied, v_marker || '-denied@test.invalid');

  INSERT INTO public.companies(id, name, slug) VALUES
    (v_company, v_marker || ' company', v_marker || '-company'),
    (v_foreign_company, v_marker || ' foreign company', v_marker || '-foreign');

  INSERT INTO public.users(id, company_id, email, full_name, is_owner, is_active) VALUES
    (v_caller, v_company, v_marker || '-caller@test.invalid', 'Canonical Target Caller', false, true),
    (v_foreign_owner, v_foreign_company, v_marker || '-foreign-owner@test.invalid', 'Canonical Target Foreign Owner', true, true),
    (v_denied, v_company, v_marker || '-denied@test.invalid', 'Canonical Target Denied Caller', false, true);

  INSERT INTO public.roles(id, company_id, name, is_system, is_default, created_by)
    VALUES(v_role, v_company, v_marker || ' target role', false, false, v_caller);
  INSERT INTO public.role_permissions(role_id, permission_id)
    SELECT v_role, id FROM public.permissions WHERE key = 'target.view';
  GET DIAGNOSTICS v_permission_rows = ROW_COUNT;
  ASSERT v_permission_rows = 1, 'target.view permission fixture must exist';
  INSERT INTO public.user_roles(user_id, role_id, company_id, assigned_by)
    VALUES(v_caller, v_role, v_company, v_caller);

  INSERT INTO public.pipelines(company_id, name, subject_kind, is_default, created_by, visibility_permissions)
    VALUES(v_company, v_marker || ' pipeline', 'task', false, v_caller, '{}')
    RETURNING id INTO v_pipeline;
  INSERT INTO public.pipeline_stages(pipeline_id, name, color, position, is_initial, is_terminal, terminal_type, submission_mode)
    VALUES(v_pipeline, 'Target', '#6B7280', 1, true, false, NULL, 'none') RETURNING id INTO v_target_stage;
  INSERT INTO public.pipeline_stages(pipeline_id, name, color, position, is_initial, is_terminal, terminal_type, submission_mode)
    VALUES(v_pipeline, 'Empty', '#6B7280', 2, false, false, NULL, 'none') RETURNING id INTO v_empty_stage;
  INSERT INTO public.pipeline_stages(pipeline_id, name, color, position, is_initial, is_terminal, terminal_type, submission_mode)
    VALUES(v_pipeline, 'Null Created', '#6B7280', 3, false, false, NULL, 'none') RETURNING id INTO v_null_stage;
  INSERT INTO public.pipeline_stages(pipeline_id, name, color, position, is_initial, is_terminal, terminal_type, submission_mode)
    VALUES(v_pipeline, 'Performance', '#6B7280', 4, false, false, NULL, 'none') RETURNING id INTO v_performance_stage;

  INSERT INTO public.pipelines(company_id, name, subject_kind, is_default, created_by, visibility_permissions)
    VALUES(v_foreign_company, v_marker || ' foreign pipeline', 'task', false, v_foreign_owner, '{}')
    RETURNING id INTO v_foreign_pipeline;
  INSERT INTO public.pipeline_stages(pipeline_id, name, color, position, is_initial, is_terminal, terminal_type, submission_mode)
    VALUES(v_foreign_pipeline, 'Foreign Target', '#6B7280', 1, true, false, NULL, 'none');

  -- Caller-owned project/task entries pass both task_accessible and
  -- fn_project_accessible. An unrelated task and an unassigned project owned
  -- by another company member must be filtered independently.
  INSERT INTO public.projects(company_id, name, pipeline_id, current_stage_id, owner_id, created_by)
    VALUES(v_company, v_marker || ' visible project', v_pipeline, v_target_stage, v_caller, v_caller)
    RETURNING id INTO v_caller_project;
  INSERT INTO public.projects(company_id, name, pipeline_id, current_stage_id, owner_id, created_by)
    VALUES(v_company, v_marker || ' hidden project', v_pipeline, v_target_stage, v_foreign_owner, v_foreign_owner)
    RETURNING id INTO v_foreign_project;

  INSERT INTO public.tasks(company_id, project_id, title, created_by, manager_id, pipeline_id, current_stage_id)
    VALUES(v_company, v_caller_project, v_marker || ' visible one', v_caller, v_caller, v_pipeline, v_target_stage)
    RETURNING id INTO v_visible_task1;
  INSERT INTO public.tasks(company_id, project_id, title, created_by, manager_id, pipeline_id, current_stage_id)
    VALUES(v_company, v_caller_project, v_marker || ' visible two', v_caller, v_caller, v_pipeline, v_target_stage)
    RETURNING id INTO v_visible_task2;
  INSERT INTO public.tasks(company_id, title, created_by, manager_id, pipeline_id, current_stage_id)
    VALUES(v_company, v_marker || ' hidden task', v_foreign_owner, v_foreign_owner, v_pipeline, v_target_stage)
    RETURNING id INTO v_hidden_task;
  INSERT INTO public.tasks(company_id, project_id, title, created_by, manager_id, pipeline_id, current_stage_id)
    VALUES(v_company, v_foreign_project, v_marker || ' hidden project task', v_caller, v_caller, v_pipeline, v_target_stage)
    RETURNING id INTO v_hidden_project_task;

  INSERT INTO public.pipeline_stage_targets
    (id, stage_id, target_type, target_quantity, target_active_seconds, target_lifecycle_seconds,
     target_deadline, created_at, updated_at, company_id, status, completed_at)
  VALUES
    (v_target_volume, v_target_stage, 'volume', 10, NULL, NULL, NULL, now() - interval '1 day', now(), v_company, 'active', NULL),
    (v_null_created, v_null_stage, 'volume', 10, NULL, NULL, NULL, NULL, now(), v_company, 'active', NULL),
    (v_empty_volume, v_empty_stage, 'volume', 10, NULL, NULL, NULL, now() - interval '1 day', now(), v_company, 'active', NULL),
    (v_performance, v_performance_stage, 'performance', NULL, 3600, 86400, NULL, now() - interval '1 day', now(), v_company, 'active', NULL),
    (v_foreign_target, (SELECT id FROM public.pipeline_stages WHERE pipeline_id = v_foreign_pipeline), 'volume', 10, NULL, NULL, NULL, now() - interval '1 day', now(), v_foreign_company, 'active', NULL);

  INSERT INTO public.pipeline_stage_history
    (task_id, company_id, pipeline_id, from_stage_id, to_stage_id, transitioned_by, transitioned_at, is_reversal)
  VALUES
    (v_visible_task1, v_company, v_pipeline, v_empty_stage, v_target_stage, v_caller, now() - interval '2 hours', false),
    (v_visible_task2, v_company, v_pipeline, v_empty_stage, v_target_stage, v_caller, now() - interval '1 hour', false),
    (v_visible_task1, v_company, v_pipeline, v_empty_stage, v_target_stage, v_caller, now() - interval '30 minutes', true),
    (v_hidden_task, v_company, v_pipeline, v_empty_stage, v_target_stage, v_foreign_owner, now() - interval '20 minutes', false),
    (v_hidden_project_task, v_company, v_pipeline, v_empty_stage, v_target_stage, v_caller, now() - interval '10 minutes', false);

  INSERT INTO canonical_targets_check_ctx VALUES
    (v_company, v_caller, v_denied, v_target_volume, v_null_created,
     v_empty_volume, v_performance, v_foreign_target);
END
$setup$;

SET LOCAL ROLE authenticated;

DO $check$
DECLARE
  v_ctx record;
  v_proc regprocedure := 'public.rpc_get_canonical_analytics_targets()'::regprocedure;
  v_owner oid;
  v_authenticated oid;
  v_config text[];
  v_security_definer boolean;
  v_row record;
  v_denied_call boolean;
BEGIN
  SELECT * INTO STRICT v_ctx FROM canonical_targets_check_ctx;
  SELECT proowner, proconfig, prosecdef
    INTO v_owner, v_config, v_security_definer
  FROM pg_proc WHERE oid = v_proc::oid;
  SELECT oid INTO v_authenticated FROM pg_roles WHERE rolname = 'authenticated';
  ASSERT v_authenticated IS NOT NULL, 'authenticated role must exist';
  ASSERT v_security_definer, 'reader must remain SECURITY DEFINER';
  ASSERT v_config @> ARRAY['search_path=public'], 'reader must retain fixed search_path';
  ASSERT has_function_privilege('authenticated', v_proc, 'EXECUTE'), 'authenticated must have EXECUTE';
  ASSERT NOT has_function_privilege('anon', v_proc, 'EXECUTE'), 'anon must not have EXECUTE';
  ASSERT NOT has_function_privilege('service_role', v_proc, 'EXECUTE'), 'service_role must not have EXECUTE';
  ASSERT NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = v_proc::oid), acldefault('f', v_owner))) a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ), 'PUBLIC must not have EXECUTE';
  ASSERT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = v_proc::oid), acldefault('f', v_owner))) a
    WHERE a.grantee = v_authenticated AND a.privilege_type = 'EXECUTE'
  ), 'authenticated EXECUTE grant must be explicit';
  ASSERT NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = v_proc::oid), acldefault('f', v_owner))) a
    WHERE a.grantee NOT IN (v_owner, v_authenticated) AND a.privilege_type = 'EXECUTE'
  ), 'function ACL has an unexpected EXECUTE grantee';

  -- An authenticated database role with no subject exercises the explicit
  -- unauthenticated 42501 guard while retaining function EXECUTE.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_denied_call := false;
  BEGIN
    PERFORM * FROM public.rpc_get_canonical_analytics_targets();
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied_call := true;
  END;
  ASSERT v_denied_call, 'unauthenticated call must raise 42501';

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_ctx.denied_id::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_ctx.denied_id::text, true);
  v_denied_call := false;
  BEGIN
    PERFORM * FROM public.rpc_get_canonical_analytics_targets();
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied_call := true;
  END;
  ASSERT v_denied_call, 'same-company caller without target.view must raise 42501';

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_ctx.caller_id::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_ctx.caller_id::text, true);
  SELECT * INTO v_row FROM public.rpc_get_canonical_analytics_targets() WHERE id = v_ctx.target_volume_id;
  ASSERT v_row.observed_value = 2, 'only two visible non-reversal forward entries must count';
  ASSERT v_row.progress_unit = 'tasks', 'valid volume target must report tasks';
  ASSERT v_row.stored_status = 'active', 'stored lifecycle status must be returned independently';

  SELECT * INTO v_row FROM public.rpc_get_canonical_analytics_targets() WHERE id = v_ctx.null_created_id;
  ASSERT v_row.observed_value IS NULL AND v_row.progress_unit IS NULL,
    'volume target with NULL created_at must report unavailable progress';

  SELECT * INTO v_row FROM public.rpc_get_canonical_analytics_targets() WHERE id = v_ctx.empty_volume_id;
  ASSERT v_row.observed_value = 0 AND v_row.progress_unit = 'tasks',
    'valid empty volume window must preserve measured zero';

  SELECT * INTO v_row FROM public.rpc_get_canonical_analytics_targets() WHERE id = v_ctx.performance_id;
  ASSERT v_row.target_active_seconds = 3600 AND v_row.target_lifecycle_seconds = 86400,
    'performance target must return its stored SLA thresholds';
  ASSERT v_row.observed_value IS NULL AND v_row.progress_unit IS NULL,
    'performance target must not fabricate observed progress';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.rpc_get_canonical_analytics_targets() WHERE id = v_ctx.foreign_target_id
  ), 'cross-company target must be omitted';
END
$check$;

RESET ROLE;
DO $done$
BEGIN
  RAISE NOTICE 'check_canonical_analytics_targets.sql: ALL CHECKS PASSED';
END
$done$;

ROLLBACK;
