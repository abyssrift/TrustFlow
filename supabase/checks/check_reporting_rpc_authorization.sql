-- Transactional authorization check for the reporting RPC boundary.
-- Fixtures include auth.users rows because auth.uid() must resolve normally.
--
--   docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/checks/check_reporting_rpc_authorization.sql

BEGIN;

DO $check$
DECLARE
  c1 CONSTANT uuid := gen_random_uuid(); c2 CONSTANT uuid := gen_random_uuid();
  owner1 CONSTANT uuid := gen_random_uuid(); member1 CONSTANT uuid := gen_random_uuid();
  denied1 CONSTANT uuid := gen_random_uuid(); owner2 CONSTANT uuid := gen_random_uuid();
  pipe1 uuid; pipe2 uuid; role_id uuid;
  denied boolean; r jsonb; marker text := 'reporting-auth-' || gen_random_uuid()::text;
  proc regprocedure; public_count integer; foreign_rows bigint;
  grantee_oid oid; summary_proc regprocedure; compare_proc regprocedure;
  private_summary regprocedure; private_compare regprocedure; authorized_rows bigint;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (owner1, marker || '-owner1@test.invalid'), (member1, marker || '-member1@test.invalid'),
    (denied1, marker || '-denied1@test.invalid'), (owner2, marker || '-owner2@test.invalid');
  INSERT INTO public.companies (id, name, slug) VALUES
    (c1, marker || ' company 1', marker || '-company-1'),
    (c2, marker || ' company 2', marker || '-company-2');
  INSERT INTO public.users (id, company_id, email, full_name, is_owner, is_active) VALUES
    (owner1, c1, marker || '-owner1@test.invalid', 'Reporting Check Owner', true, true),
    (member1, c1, marker || '-member1@test.invalid', 'Reporting Check Authorized Member', false, true),
    (denied1, c1, marker || '-denied1@test.invalid', 'Reporting Check Permissionless', false, true),
    (owner2, c2, marker || '-owner2@test.invalid', 'Reporting Check Foreign Owner', true, true);
  INSERT INTO public.pipelines (company_id, name, subject_kind, is_default, created_by, visibility_permissions)
  VALUES (c1, marker || ' pipeline 1', 'task', false, owner1, '{}') RETURNING id INTO pipe1;
  INSERT INTO public.pipelines (company_id, name, subject_kind, is_default, created_by, visibility_permissions)
  VALUES (c2, marker || ' pipeline 2', 'task', false, owner2, '{}') RETURNING id INTO pipe2;
  IF (SELECT count(*) FROM public.permissions WHERE key IN ('analytics.view', 'analytics.compare')) <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED: reporting permissions are missing';
  END IF;
  INSERT INTO public.roles (id, company_id, name, is_system, is_default, created_by)
  VALUES (gen_random_uuid(), c1, marker || ' analytics role', false, false, owner1) RETURNING id INTO role_id;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT role_id, id FROM public.permissions WHERE key IN ('analytics.view', 'analytics.compare');
  INSERT INTO public.user_roles (user_id, role_id, company_id, assigned_by)
  VALUES (member1, role_id, c1, owner1);

  -- Exact public identities, no stale overloads, and effective ACLs.
  FOREACH proc IN ARRAY ARRAY[
    'public.rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean)'::regprocedure,
    'public.rpc_get_user_company_history(uuid)'::regprocedure,
    'public.rpc_get_user_performance_series(uuid,text,integer,uuid)'::regprocedure,
    'public.rpc_get_pipeline_stage_dwell(uuid,date,date)'::regprocedure,
    'public.rpc_get_pipeline_throughput(uuid,text,integer)'::regprocedure
  ] LOOP
    SELECT count(*) INTO public_count
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = (SELECT proname FROM pg_proc WHERE oid = proc::oid);
    ASSERT public_count = 1, 'unexpected public overload count';
    ASSERT has_function_privilege('authenticated', proc, 'EXECUTE'), 'authenticated execution missing';
    ASSERT NOT has_function_privilege('anon', proc, 'EXECUTE'), 'anon execution exposed';
    ASSERT NOT EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = proc::oid),
                               acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = proc::oid)))) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ), 'PUBLIC execution exposed';
    SELECT oid INTO grantee_oid FROM pg_roles WHERE rolname = 'authenticated';
    ASSERT EXISTS (SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = proc::oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = proc::oid)))) acl WHERE acl.grantee = grantee_oid AND acl.privilege_type = 'EXECUTE'), 'authenticated lacks explicit EXECUTE ACL';
  END LOOP;
  -- Exactly one installed compatibility shape must exist for each RPC.
  summary_proc := COALESCE(
    to_regprocedure('public.rpc_get_user_performance_summary(uuid,date,date)'),
    to_regprocedure('public.rpc_get_user_performance_summary(uuid,timestamptz,timestamptz)'));
  compare_proc := COALESCE(
    to_regprocedure('public.rpc_compare_personnel(uuid[],date,date,jsonb)'),
    to_regprocedure('public.rpc_compare_personnel(uuid[],timestamptz,timestamptz,json)'));
  ASSERT (CASE WHEN to_regprocedure('public.rpc_get_user_performance_summary(uuid,date,date)') IS NOT NULL THEN 1 ELSE 0 END)
       + (CASE WHEN to_regprocedure('public.rpc_get_user_performance_summary(uuid,timestamptz,timestamptz)') IS NOT NULL THEN 1 ELSE 0 END) = 1,
       'expected exactly one public summary signature';
  ASSERT (CASE WHEN to_regprocedure('public.rpc_compare_personnel(uuid[],date,date,jsonb)') IS NOT NULL THEN 1 ELSE 0 END)
       + (CASE WHEN to_regprocedure('public.rpc_compare_personnel(uuid[],timestamptz,timestamptz,json)') IS NOT NULL THEN 1 ELSE 0 END) = 1,
       'expected exactly one public comparison signature';
  ASSERT summary_proc IS NOT NULL AND compare_proc IS NOT NULL, 'known reporting signature family missing';
  SELECT count(*) INTO public_count FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='rpc_get_user_performance_summary';
  ASSERT public_count = 1, 'unexpected public summary overload count';
  SELECT count(*) INTO public_count FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='rpc_compare_personnel';
  ASSERT public_count = 1, 'unexpected public comparison overload count';
  private_summary := CASE WHEN summary_proc = to_regprocedure('public.rpc_get_user_performance_summary(uuid,date,date)')
    THEN to_regprocedure('public._reporting_rpc_get_user_performance_summary(uuid,date,date)')
    ELSE to_regprocedure('public._reporting_rpc_get_user_performance_summary(uuid,timestamptz,timestamptz)') END;
  private_compare := CASE WHEN compare_proc = to_regprocedure('public.rpc_compare_personnel(uuid[],date,date,jsonb)')
    THEN to_regprocedure('public._reporting_rpc_compare_personnel(uuid[],date,date,jsonb)')
    ELSE to_regprocedure('public._reporting_rpc_compare_personnel(uuid[],timestamptz,timestamptz,json)') END;
  ASSERT private_summary IS NOT NULL AND private_compare IS NOT NULL, 'matching private reporting signature missing';
  FOREACH proc IN ARRAY ARRAY[summary_proc, compare_proc] LOOP
    ASSERT has_function_privilege('authenticated', proc, 'EXECUTE'), 'authenticated execution missing';
    ASSERT NOT has_function_privilege('anon', proc, 'EXECUTE'), 'anon execution exposed';
    ASSERT NOT has_function_privilege('service_role', proc, 'EXECUTE'), 'service_role execution exposed';
    ASSERT NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid=proc::oid), acldefault('f',(SELECT proowner FROM pg_proc WHERE oid=proc::oid)))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'), 'PUBLIC execution exposed';
    SELECT oid INTO grantee_oid FROM pg_roles WHERE rolname='authenticated';
    ASSERT EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid=proc::oid)) a WHERE a.grantee=grantee_oid AND a.privilege_type='EXECUTE'), 'authenticated lacks explicit EXECUTE ACL';
  END LOOP;
  FOREACH proc IN ARRAY ARRAY[private_summary, private_compare] LOOP
    ASSERT NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid=proc::oid), acldefault('f',(SELECT proowner FROM pg_proc WHERE oid=proc::oid)))) a
      WHERE a.grantee=0 OR (a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AND a.privilege_type='EXECUTE')
    ), 'private delegation target ACL exposed';
  END LOOP;
  ASSERT to_regprocedure('public.rpc_get_user_performance_series(uuid,text,integer)') IS NULL, 'stale series overload remains';
  FOREACH proc IN ARRAY ARRAY[
    'public._reporting_rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean)'::regprocedure,
    'public._reporting_rpc_get_user_company_history(uuid)'::regprocedure,
    'public._reporting_rpc_get_user_performance_series(uuid,text,integer,uuid)'::regprocedure,
    'public._reporting_rpc_get_pipeline_stage_dwell(uuid,date,date)'::regprocedure,
    'public._reporting_rpc_get_pipeline_throughput(uuid,text,integer)'::regprocedure
  ] LOOP
    ASSERT NOT EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = proc::oid),
                               acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = proc::oid)))) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ), 'private delegation target is executable by PUBLIC';
    ASSERT NOT has_function_privilege('anon', proc, 'EXECUTE'), 'private delegation target is executable by anon';
    ASSERT NOT has_function_privilege('authenticated', proc, 'EXECUTE'), 'private delegation target is executable by authenticated';
    ASSERT NOT has_function_privilege('service_role', proc, 'EXECUTE'), 'private delegation target is executable by service_role';
    ASSERT NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = proc::oid), acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = proc::oid)))) acl
      WHERE (acl.grantee = 0 OR acl.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))) AND acl.privilege_type = 'EXECUTE'
    ), 'private role ACL exposes delegation target';
  END LOOP;
  FOREACH proc IN ARRAY ARRAY[private_summary, private_compare] LOOP
    ASSERT NOT has_function_privilege('anon', proc, 'EXECUTE'), 'private target executable by anon';
    ASSERT NOT has_function_privilege('authenticated', proc, 'EXECUTE'), 'private target executable by authenticated';
    ASSERT NOT has_function_privilege('service_role', proc, 'EXECUTE'), 'private target executable by service_role';
  END LOOP;

  -- Anonymous rejection for every contained RPC.
  RAISE NOTICE 'authorization check: anonymous rejection';
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  RAISE NOTICE 'authorization check: anonymous audit';
  denied := false; BEGIN PERFORM public.rpc_get_organizational_audit(p_pipeline_id := pipe1, p_days := 1); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'anon audit accepted';
  RAISE NOTICE 'authorization check: anonymous history';
  denied := false; BEGIN PERFORM public.rpc_get_user_company_history(member1); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'anon history accepted';
  RAISE NOTICE 'authorization check: anonymous series';
  denied := false; BEGIN PERFORM public.rpc_get_user_performance_series(member1, 'month', 1, c1); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'anon series accepted';
  RAISE NOTICE 'authorization check: anonymous summary';
  denied := false; BEGIN
    IF summary_proc = to_regprocedure('public.rpc_get_user_performance_summary(uuid,date,date)') THEN
      EXECUTE 'SELECT public.rpc_get_user_performance_summary($1,$2::date,$3::date)' USING member1,current_date-1,current_date;
    ELSE
      EXECUTE 'SELECT public.rpc_get_user_performance_summary($1,$2::timestamptz,$3::timestamptz)' USING member1,(current_date-1)::timestamptz,current_date::timestamptz;
    END IF;
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'anon summary accepted';
  RAISE NOTICE 'authorization check: anonymous dwell';
  denied := false; BEGIN PERFORM public.rpc_get_pipeline_stage_dwell(pipe1, current_date - 1, current_date); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'anon dwell accepted';
  RAISE NOTICE 'authorization check: anonymous comparison';
  denied := false; BEGIN
    IF compare_proc = to_regprocedure('public.rpc_compare_personnel(uuid[],date,date,jsonb)') THEN
      EXECUTE 'SELECT count(*) FROM public.rpc_compare_personnel($1,$2::date,$3::date,$4::jsonb)' USING ARRAY[member1],current_date-1,current_date,'{}'::jsonb;
    ELSE
      EXECUTE 'SELECT count(*) FROM public.rpc_compare_personnel($1,$2::timestamptz,$3::timestamptz,$4::json)' USING ARRAY[member1],(current_date-1)::timestamptz,current_date::timestamptz,'{}'::json;
    END IF;
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'anon comparison accepted';
  RAISE NOTICE 'authorization check: anonymous throughput';
  denied := false; BEGIN PERFORM public.rpc_get_pipeline_throughput(pipe1, 'month', 1); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'anon throughput accepted';

  -- Authenticated but permissionless rejection for every contained RPC.
  RAISE NOTICE 'authorization check: permissionless rejection';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', denied1::text, 'role', 'authenticated')::text, true);
  denied := false; BEGIN PERFORM public.rpc_get_organizational_audit(p_pipeline_id := pipe1, p_days := 1); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'permissionless audit accepted';
  denied := false; BEGIN PERFORM public.rpc_get_user_company_history(denied1); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'permissionless history accepted';
  denied := false; BEGIN PERFORM public.rpc_get_user_performance_series(denied1, 'month', 1, c1); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'permissionless series accepted';
  denied := false; BEGIN
    IF summary_proc = to_regprocedure('public.rpc_get_user_performance_summary(uuid,date,date)') THEN
      EXECUTE 'SELECT public.rpc_get_user_performance_summary($1,$2::date,$3::date)' USING denied1,current_date-1,current_date;
    ELSE
      EXECUTE 'SELECT public.rpc_get_user_performance_summary($1,$2::timestamptz,$3::timestamptz)' USING denied1,(current_date-1)::timestamptz,current_date::timestamptz;
    END IF;
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'permissionless summary accepted';
  denied := false; BEGIN PERFORM public.rpc_get_pipeline_stage_dwell(pipe1, current_date - 1, current_date); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'permissionless dwell accepted';
  denied := false; BEGIN
    IF compare_proc = to_regprocedure('public.rpc_compare_personnel(uuid[],date,date,jsonb)') THEN
      EXECUTE 'SELECT count(*) FROM public.rpc_compare_personnel($1,$2::date,$3::date,$4::jsonb)' USING ARRAY[denied1],current_date-1,current_date,'{}'::jsonb;
    ELSE
      EXECUTE 'SELECT count(*) FROM public.rpc_compare_personnel($1,$2::timestamptz,$3::timestamptz,$4::json)' USING ARRAY[denied1],(current_date-1)::timestamptz,current_date::timestamptz,'{}'::json;
    END IF;
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'permissionless comparison accepted';
  denied := false; BEGIN PERFORM public.rpc_get_pipeline_throughput(pipe1, 'month', 1); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'permissionless throughput accepted';

  -- Same-tenant non-owner with analytics.view succeeds for the whole surface.
  RAISE NOTICE 'authorization check: authorized audit';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', member1::text, 'role', 'authenticated')::text, true);
  PERFORM public.rpc_get_organizational_audit(p_pipeline_id := pipe1, p_days := 1);
  RAISE NOTICE 'authorization check: authorized history';
  PERFORM public.rpc_get_user_company_history(member1);
  RAISE NOTICE 'authorization check: authorized series';
  PERFORM public.rpc_get_user_performance_series(member1, 'month', 1, c1);
  RAISE NOTICE 'authorization check: authorized summary';
  IF summary_proc = to_regprocedure('public.rpc_get_user_performance_summary(uuid,date,date)') THEN
    EXECUTE 'SELECT public.rpc_get_user_performance_summary($1,$2::date,$3::date)' INTO r USING member1,current_date-1,current_date;
  ELSE
    EXECUTE 'SELECT public.rpc_get_user_performance_summary($1,$2::timestamptz,$3::timestamptz)' INTO r USING member1,(current_date-1)::timestamptz,current_date::timestamptz;
  END IF;
  RAISE NOTICE 'authorization check: authorized dwell';
  PERFORM public.rpc_get_pipeline_stage_dwell(pipe1, current_date - 1, current_date);
  RAISE NOTICE 'authorization check: authorized comparison';
  IF compare_proc = to_regprocedure('public.rpc_compare_personnel(uuid[],date,date,jsonb)') THEN
    EXECUTE 'SELECT count(*) FROM public.rpc_compare_personnel($1,$2::date,$3::date,$4::jsonb) WHERE user_id=$5' INTO authorized_rows USING ARRAY[member1],current_date-1,current_date,'{}'::jsonb,member1;
  ELSE
    EXECUTE 'SELECT count(*) FROM public.rpc_compare_personnel($1,$2::timestamptz,$3::timestamptz,$4::json) WHERE user_id=$5' INTO authorized_rows USING ARRAY[member1],(current_date-1)::timestamptz,current_date::timestamptz,'{}'::json,member1;
  END IF;
  ASSERT authorized_rows = 1, 'authorized comparison did not return the expected user';
  RAISE NOTICE 'authorization check: authorized throughput';
  PERFORM public.rpc_get_pipeline_throughput(pipe1, 'month', 1);
  ASSERT r IS NOT NULL, 'authorized summary returned null';

  -- Foreign-company targets and audit identity override must fail closed.
  RAISE NOTICE 'authorization check: cross-tenant rejection';
  denied := false; BEGIN PERFORM public.rpc_get_organizational_audit(p_pipeline_id := pipe2, p_days := 1); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'foreign audit accepted';
  denied := false; BEGIN PERFORM public.rpc_get_user_company_history(owner2); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'foreign history accepted';
  denied := false; BEGIN PERFORM public.rpc_get_user_performance_series(owner2, 'month', 1, c2); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'foreign series accepted';
  denied := false; BEGIN
    IF summary_proc = to_regprocedure('public.rpc_get_user_performance_summary(uuid,date,date)') THEN
      EXECUTE 'SELECT public.rpc_get_user_performance_summary($1,$2::date,$3::date)' USING owner2,current_date-1,current_date;
    ELSE
      EXECUTE 'SELECT public.rpc_get_user_performance_summary($1,$2::timestamptz,$3::timestamptz)' USING owner2,(current_date-1)::timestamptz,current_date::timestamptz;
    END IF;
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'foreign summary accepted';
  denied := false; BEGIN PERFORM public.rpc_get_pipeline_stage_dwell(pipe2, current_date - 1, current_date); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'foreign dwell accepted';
  denied := false; BEGIN
    IF compare_proc = to_regprocedure('public.rpc_compare_personnel(uuid[],date,date,jsonb)') THEN
      EXECUTE 'SELECT count(*) FROM public.rpc_compare_personnel($1,$2::date,$3::date,$4::jsonb)' INTO foreign_rows USING ARRAY[owner2],current_date-1,current_date,'{}'::jsonb;
    ELSE
      EXECUTE 'SELECT count(*) FROM public.rpc_compare_personnel($1,$2::timestamptz,$3::timestamptz,$4::json)' INTO foreign_rows USING ARRAY[owner2],(current_date-1)::timestamptz,current_date::timestamptz,'{}'::json;
    END IF;
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END;
  ASSERT denied, 'foreign comparison did not raise documented 42501 denial';
  denied := false; BEGIN PERFORM public.rpc_get_pipeline_throughput(pipe2, 'month', 1); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'foreign throughput accepted';
  denied := false; BEGIN PERFORM public.rpc_get_organizational_audit(p_pipeline_id := pipe1, p_auth_user_id := owner1, p_days := 1); EXCEPTION WHEN SQLSTATE '42501' THEN denied := true; END; ASSERT denied, 'audit auth override accepted';

  RAISE NOTICE 'check_reporting_rpc_authorization.sql: ALL CHECKS PASSED';
END $check$;

ROLLBACK;
