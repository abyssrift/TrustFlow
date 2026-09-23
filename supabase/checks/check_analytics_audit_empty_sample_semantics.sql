-- Transactional regression check for undefined audit metrics. Run against a
-- local/dev database with the migrations installed; this never deploys or
-- changes persistent data.
--
--   docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/checks/check_analytics_audit_empty_sample_semantics.sql

BEGIN;
SET LOCAL session_replication_role = replica;

DO $check$
DECLARE
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  owner1 uuid := gen_random_uuid(); owner2 uuid := gen_random_uuid();
  denied1 uuid := gen_random_uuid();
  role1 uuid := gen_random_uuid(); pipe_empty uuid; pipe_measured uuid; pipe_zero_revision uuid; pipe_foreign uuid;
  open_stage uuid; failure_stage uuid; foreign_success_stage uuid;
  measured jsonb; empty_result jsonb; global_before jsonb;
  denied boolean; public_proc regprocedure; private_proc regprocedure;
  wrapper_owner oid; private_owner oid; auth_role oid;
  wrapper_security_definer boolean; private_security_definer boolean;
  wrapper_config text[]; private_config text[];
  marker text := 'audit-empty-' || gen_random_uuid()::text;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (owner1,marker||'-owner1@test.invalid'), (owner2,marker||'-owner2@test.invalid'),
    (denied1,marker||'-denied@test.invalid');
  INSERT INTO public.companies(id,name,slug) VALUES
    (c1,marker||' company 1',marker||'-company-1'),
    (c2,marker||' company 2',marker||'-company-2');
  INSERT INTO public.users(id,company_id,email,full_name,is_owner,is_active) VALUES
    (owner1,c1,marker||'-owner1@test.invalid','Audit Check Owner',true,true),
    (owner2,c2,marker||'-owner2@test.invalid','Audit Check Foreign Owner',true,true),
    (denied1,c1,marker||'-denied@test.invalid','Audit Check Unauthorized',false,true);
  INSERT INTO public.roles(id,company_id,name,is_system,is_default,created_by)
    VALUES(role1,c1,marker||' analytics role',false,false,owner1);
  INSERT INTO public.role_permissions(role_id,permission_id)
    SELECT role1,id FROM public.permissions WHERE key='analytics.view';
  INSERT INTO public.user_roles(user_id,role_id,company_id,assigned_by)
    VALUES(owner1,role1,c1,owner1);
  INSERT INTO public.pipelines(company_id,name,subject_kind,is_default,created_by,visibility_permissions)
    VALUES(c1,marker||' empty','task',false,owner1,'{}') RETURNING id INTO pipe_empty;
  INSERT INTO public.pipelines(company_id,name,subject_kind,is_default,created_by,visibility_permissions)
    VALUES(c1,marker||' measured','task',false,owner1,'{}') RETURNING id INTO pipe_measured;
  INSERT INTO public.pipelines(company_id,name,subject_kind,is_default,created_by,visibility_permissions)
    VALUES(c1,marker||' zero revision','task',false,owner1,'{}') RETURNING id INTO pipe_zero_revision;
  INSERT INTO public.pipelines(company_id,name,subject_kind,is_default,created_by,visibility_permissions)
    VALUES(c2,marker||' foreign','task',false,owner2,'{}') RETURNING id INTO pipe_foreign;
  INSERT INTO public.pipeline_stages(pipeline_id,name,color,position,is_initial,is_terminal,terminal_type,submission_mode)
    VALUES(pipe_measured,'open','#6B7280',1,true,false,NULL,'none') RETURNING id INTO open_stage;
  INSERT INTO public.pipeline_stages(pipeline_id,name,color,position,is_initial,is_terminal,terminal_type,submission_mode)
    VALUES(pipe_measured,'failed','#EF4444',2,false,true,'failure','none') RETURNING id INTO failure_stage;

  -- Assert the security contract directly. A post-migration snapshot compared
  -- with another post-migration snapshot would not prove that these properties
  -- match the intended wrapper/private boundary.
  public_proc := 'public.rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean)'::regprocedure;
  private_proc := 'public._reporting_rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean)'::regprocedure;
  SELECT proowner, prosecdef, proconfig INTO wrapper_owner, wrapper_security_definer, wrapper_config
    FROM pg_proc WHERE oid=public_proc::oid;
  ASSERT wrapper_security_definer, 'public RPC must remain SECURITY DEFINER';
  ASSERT wrapper_config @> ARRAY['search_path=public'], 'public wrapper must retain fixed search_path';
  SELECT proowner, prosecdef, proconfig INTO private_owner, private_security_definer, private_config
    FROM pg_proc WHERE oid=private_proc::oid;
  ASSERT wrapper_owner=private_owner, 'public/private RPC ownership changed';
  ASSERT private_security_definer, 'private implementation must remain SECURITY DEFINER';
  ASSERT private_config @> ARRAY['search_path=public'], 'private implementation must retain fixed search_path';
  SELECT oid INTO auth_role FROM pg_roles WHERE rolname='authenticated';
  ASSERT auth_role IS NOT NULL, 'authenticated role must exist';

  ASSERT has_function_privilege('authenticated',public_proc,'EXECUTE'), 'authenticated wrapper EXECUTE missing';
  ASSERT NOT has_function_privilege('anon',public_proc,'EXECUTE'), 'anon wrapper EXECUTE exposed';
  ASSERT NOT has_function_privilege('service_role',public_proc,'EXECUTE'), 'service_role wrapper EXECUTE exposed';
  ASSERT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid=public_proc::oid),acldefault('f',wrapper_owner))) a
    WHERE a.grantee=auth_role AND a.privilege_type='EXECUTE'
  ), 'authenticated wrapper ACL must be explicit';
  ASSERT NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid=public_proc::oid),acldefault('f',wrapper_owner))) a
    WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN (wrapper_owner,auth_role)
  ), 'public wrapper ACL contains an unexpected EXECUTE grant';
  ASSERT NOT has_function_privilege('authenticated',private_proc,'EXECUTE'), 'private implementation exposed to authenticated';
  ASSERT NOT has_function_privilege('anon',private_proc,'EXECUTE'), 'private implementation exposed to anon';
  ASSERT NOT has_function_privilege('service_role',private_proc,'EXECUTE'), 'private implementation exposed to service_role';
  ASSERT NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid=private_proc::oid),acldefault('f',private_owner))) a
    WHERE a.privilege_type='EXECUTE' AND a.grantee<>private_owner
  ), 'private implementation must have owner-only EXECUTE';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner1::text,'role','authenticated')::text,true);

  -- No current or prior tasks: NULL means no defined denominator/sample.
  SELECT public.rpc_get_organizational_audit(
    p_pipeline_id:=pipe_empty,p_date_start:=now()-interval '10 days',p_date_end:=now()
  ) INTO empty_result;
  ASSERT jsonb_typeof(empty_result->'current'->'success_rate')='null', 'empty current success_rate must be JSON null';
  ASSERT jsonb_typeof(empty_result->'current'->'revision_rate')='null', 'empty current revision_rate must be JSON null';
  ASSERT jsonb_typeof(empty_result->'current'->'avg_lead_time_minutes')='null', 'empty current lead time must be JSON null';
  ASSERT jsonb_typeof(empty_result->'comparison'->'success_rate')='null', 'empty comparison success_rate must be JSON null';
  ASSERT jsonb_typeof(empty_result->'comparison'->'revision_rate')='null', 'empty comparison revision_rate must be JSON null';
  ASSERT jsonb_typeof(empty_result->'comparison'->'avg_lead_time_minutes')='null', 'empty comparison lead time must be JSON null';
  ASSERT jsonb_typeof(empty_result->'radar_advanced'->'flow_ratio')='null', 'empty flow_ratio must be JSON null';
  ASSERT jsonb_typeof(empty_result->'radar_advanced'->'first_pass_yield')='null', 'empty first_pass_yield must be JSON null';
  ASSERT (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(empty_result) AS keys(key)) = ARRAY[
    'comparison','conversion_by_stage','cost_metrics','current','quality_by_worker',
    'radar_advanced','sla_risks','stage_duration_analysis','summary','worker_engagement',
    'worker_time_metrics'
  ]::text[], 'public RPC top-level output keys changed';
  ASSERT (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(empty_result->'current') AS keys(key)) =
    ARRAY['avg_lead_time_minutes','revision_rate','sample_size','success_rate','throughput']::text[],
    'current output keys changed';
  ASSERT (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(empty_result->'comparison') AS keys(key)) =
    ARRAY['avg_lead_time_minutes','revision_rate','success_rate','throughput']::text[],
    'comparison output keys changed';
  ASSERT (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(empty_result->'radar_advanced') AS keys(key)) =
    ARRAY['automation_offload_rate','first_pass_yield','flow_ratio']::text[],
    'radar_advanced output keys changed';

  RESET ROLE;
  INSERT INTO public.tasks(company_id,title,created_by,manager_id,pipeline_id,current_stage_id)
    VALUES(c1,marker||' measured failed',owner1,owner1,pipe_measured,failure_stage);
  UPDATE public.tasks SET created_at=now()-interval '2 days',completed_at=now()-interval '2 days'
    WHERE company_id=c1 AND title=marker||' measured failed';
  INSERT INTO public.task_submissions(task_id,company_id,submitted_by,status)
    SELECT id,c1,owner1,'needs_revision' FROM public.tasks
    WHERE company_id=c1 AND title=marker||' measured failed';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner1::text,'role','authenticated')::text,true);
  SELECT public.rpc_get_organizational_audit(
    p_pipeline_id:=pipe_measured,p_date_start:=now()-interval '10 days',p_date_end:=now()
  ) INTO measured;
  ASSERT (measured->'current'->>'success_rate')::numeric=0, 'observed success_rate zero must remain numeric 0';
  ASSERT (measured->'current'->>'revision_rate')::numeric=100, 'observed revision_rate must use its valid denominator';
  ASSERT (measured->'current'->>'avg_lead_time_minutes')::numeric=0, 'observed zero lead time must remain numeric 0';
  ASSERT (measured->'radar_advanced'->>'flow_ratio')::numeric=0, 'observed flow_ratio zero must remain numeric 0';
  ASSERT (measured->'radar_advanced'->>'first_pass_yield')::numeric=0, 'observed first_pass_yield zero must remain numeric 0';
  ASSERT jsonb_typeof(measured->'comparison'->'success_rate')='null', 'empty comparison success_rate must remain JSON null';
  ASSERT jsonb_typeof(measured->'comparison'->'revision_rate')='null', 'empty comparison revision_rate must remain JSON null';
  ASSERT jsonb_typeof(measured->'comparison'->'avg_lead_time_minutes')='null', 'empty comparison lead time must remain JSON null';

  RESET ROLE;
  INSERT INTO public.pipeline_stages(pipeline_id,name,color,position,is_initial,is_terminal,terminal_type,submission_mode)
    VALUES(pipe_zero_revision,'open','#6B7280',1,true,false,NULL,'none') RETURNING id INTO open_stage;
  INSERT INTO public.pipeline_stages(pipeline_id,name,color,position,is_initial,is_terminal,terminal_type,submission_mode)
    VALUES(pipe_zero_revision,'failed','#EF4444',2,false,true,'failure','none') RETURNING id INTO failure_stage;
  INSERT INTO public.tasks(company_id,title,created_by,manager_id,pipeline_id,current_stage_id)
    VALUES(c1,marker||' no revisions',owner1,owner1,pipe_zero_revision,failure_stage);
  UPDATE public.tasks SET created_at=now()-interval '2 days',completed_at=now()-interval '2 days'
    WHERE company_id=c1 AND title=marker||' no revisions';
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner1::text,'role','authenticated')::text,true);
  SELECT public.rpc_get_organizational_audit(
    p_pipeline_id:=pipe_zero_revision,p_date_start:=now()-interval '10 days',p_date_end:=now()
  ) INTO measured;
  ASSERT (measured->'current'->>'success_rate')::numeric=0, 'observed success_rate zero must remain numeric 0';
  ASSERT (measured->'current'->>'revision_rate')::numeric=0, 'observed revision_rate zero must remain numeric 0';
  ASSERT (measured->'radar_advanced'->>'flow_ratio')::numeric=0, 'observed flow_ratio zero must remain numeric 0';

  -- A global request is still company-scoped. Capture the owner company's
  -- result, then add a successful task to the foreign company's pipeline and
  -- assert that neither current sample_size nor throughput changes.
  SELECT public.rpc_get_organizational_audit(
    p_pipeline_id:=NULL,p_date_start:=now()-interval '10 days',p_date_end:=now()
  ) INTO global_before;
  ASSERT (global_before->'current'->>'sample_size')::bigint = 2,
    'global sample_size did not reflect the two current-company tasks';
  ASSERT (global_before->'current'->>'throughput')::bigint = 0,
    'global throughput did not reflect the current-company failure tasks';
  RESET ROLE;
  INSERT INTO public.pipeline_stages(pipeline_id,name,color,position,is_initial,is_terminal,terminal_type,submission_mode)
    VALUES(pipe_foreign,'done','#22C55E',1,true,true,'success','none') RETURNING id INTO foreign_success_stage;
  INSERT INTO public.tasks(company_id,title,created_by,manager_id,pipeline_id,current_stage_id)
    VALUES(c2,marker||' foreign success',owner2,owner2,pipe_foreign,foreign_success_stage);
  UPDATE public.tasks SET created_at=now()-interval '2 days',completed_at=now()-interval '2 days'
    WHERE company_id=c2 AND title=marker||' foreign success';
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner1::text,'role','authenticated')::text,true);
  SELECT public.rpc_get_organizational_audit(
    p_pipeline_id:=NULL,p_date_start:=now()-interval '10 days',p_date_end:=now()
  ) INTO measured;
  ASSERT (measured->'current'->>'sample_size')::bigint = (global_before->'current'->>'sample_size')::bigint,
    'global sample_size included a foreign-company task';
  ASSERT (measured->'current'->>'throughput')::bigint = (global_before->'current'->>'throughput')::bigint,
    'global throughput included a foreign-company task';

  -- Unauthorized same-company callers and authorized callers targeting a
  -- different company must still be rejected by the public wrapper.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',denied1::text,'role','authenticated')::text,true);
  denied:=false; BEGIN
    PERFORM public.rpc_get_organizational_audit(p_pipeline_id:=pipe_empty,p_days:=10);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
  ASSERT denied,'permissionless same-company caller was accepted';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner1::text,'role','authenticated')::text,true);
  denied:=false; BEGIN
    PERFORM public.rpc_get_organizational_audit(p_pipeline_id:=pipe_foreign,p_days:=10);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
  ASSERT denied,'cross-company pipeline was accepted';
  RESET ROLE;

  RAISE NOTICE 'check_analytics_audit_empty_sample_semantics.sql: ALL CHECKS PASSED';
END
$check$;

ROLLBACK;
