-- Transactional security regression check for
-- 20260921074104_analytics_bucketed_range_tenant_scope.sql.
--
-- This check never applies a migration and never leaves fixture data behind:
-- it creates isolated marker rows inside BEGIN/ROLLBACK. Run manually against
-- a database where the migration is installed.

BEGIN;
SET LOCAL session_replication_role = replica;

DO $check$
DECLARE
  v_company uuid := gen_random_uuid();
  v_foreign_company uuid := gen_random_uuid();
  v_caller uuid := gen_random_uuid();
  v_foreign_owner uuid := gen_random_uuid();
  v_denied uuid := gen_random_uuid();
  v_role uuid := gen_random_uuid();
  v_pipeline uuid;
  v_foreign_pipeline uuid;
  v_deleted_pipeline uuid;
  v_missing_pipeline uuid := gen_random_uuid();
  v_marker text := 'bucketed-range-scope-' || gen_random_uuid()::text;
  v_public regprocedure;
  v_private regprocedure;
  v_owner oid;
  v_authenticated oid;
  v_security_definer boolean;
  v_config text[];
  v_denied_call boolean;
  v_count bigint;
  v_call_name text;
BEGIN
  IF to_regprocedure('public.rpc_get_pipeline_throughput_range(uuid,date,date,integer)') IS NULL
     OR to_regprocedure('public.rpc_get_pipeline_points_range(uuid,date,date,integer)') IS NULL THEN
    RAISE EXCEPTION 'bucketed range public wrappers are missing';
  END IF;

  IF to_regprocedure('public._reporting_rpc_get_pipeline_throughput_range(uuid,date,date,integer)') IS NULL
     OR to_regprocedure('public._reporting_rpc_get_pipeline_points_range(uuid,date,date,integer)') IS NULL THEN
    RAISE EXCEPTION 'bucketed range private delegates are missing';
  END IF;

  INSERT INTO auth.users (id, email)
  VALUES
    (v_caller, v_marker || '-caller@test.invalid'),
    (v_foreign_owner, v_marker || '-foreign@test.invalid'),
    (v_denied, v_marker || '-denied@test.invalid');

  INSERT INTO public.companies (id, name, slug)
  VALUES
    (v_company, v_marker || ' company', v_marker || '-company'),
    (v_foreign_company, v_marker || ' foreign company', v_marker || '-foreign-company');

  INSERT INTO public.users (id, company_id, email, full_name, is_owner, is_active)
  VALUES
    (v_caller, v_company, v_marker || '-caller@test.invalid', 'Bucketed Range Caller', true, true),
    (v_foreign_owner, v_foreign_company, v_marker || '-foreign@test.invalid', 'Bucketed Range Foreign Owner', true, true),
    (v_denied, v_company, v_marker || '-denied@test.invalid', 'Bucketed Range Denied Caller', false, true);

  INSERT INTO public.roles (id, company_id, name, is_system, is_default, created_by)
  VALUES (v_role, v_company, v_marker || ' analytics role', false, false, v_caller);
  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_role, id FROM public.permissions WHERE key = 'analytics.view';
  INSERT INTO public.user_roles (user_id, role_id, company_id, assigned_by)
  VALUES (v_caller, v_role, v_company, v_caller);

  INSERT INTO public.pipelines
    (company_id, name, subject_kind, is_default, created_by, visibility_permissions)
  VALUES
    (v_company, v_marker || ' active', 'task', false, v_caller, '{}')
    RETURNING id INTO v_pipeline;
  INSERT INTO public.pipelines
    (company_id, name, subject_kind, is_default, created_by, visibility_permissions)
  VALUES
    (v_foreign_company, v_marker || ' foreign', 'task', false, v_foreign_owner, '{}')
    RETURNING id INTO v_foreign_pipeline;
  INSERT INTO public.pipelines
    (company_id, name, subject_kind, is_default, created_by, visibility_permissions)
  VALUES
    (v_company, v_marker || ' deleted', 'task', false, v_caller, '{}')
    RETURNING id INTO v_deleted_pipeline;
  UPDATE public.pipelines SET deleted_at = now() WHERE id = v_deleted_pipeline;

  SELECT oid INTO v_authenticated FROM pg_roles WHERE rolname = 'authenticated';
  ASSERT v_authenticated IS NOT NULL, 'authenticated role must exist';

  -- The public wrappers are SECURITY DEFINER, fixed to public, and explicitly
  -- executable only by authenticated. PUBLIC, anon, and service_role must not
  -- receive an inherited or explicit EXECUTE grant.
  FOREACH v_public IN ARRAY ARRAY[
    'public.rpc_get_pipeline_throughput_range(uuid,date,date,integer)'::regprocedure,
    'public.rpc_get_pipeline_points_range(uuid,date,date,integer)'::regprocedure
  ] LOOP
    SELECT proowner, prosecdef, proconfig
      INTO v_owner, v_security_definer, v_config
    FROM pg_proc WHERE oid = v_public::oid;
    ASSERT v_security_definer, format('%s must remain SECURITY DEFINER', v_public);
    ASSERT v_config @> ARRAY['search_path=public'], format('%s must retain fixed search_path', v_public);
    ASSERT has_function_privilege('authenticated', v_public, 'EXECUTE'), format('%s must be executable by authenticated', v_public);
    ASSERT NOT has_function_privilege('anon', v_public, 'EXECUTE'), format('%s exposed to anon', v_public);
    ASSERT NOT has_function_privilege('service_role', v_public, 'EXECUTE'), format('%s exposed to service_role', v_public);
    ASSERT NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = v_public::oid), acldefault('f', v_owner))) a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ), format('%s exposed to PUBLIC', v_public);
    ASSERT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = v_public::oid), acldefault('f', v_owner))) a
      WHERE a.grantee = v_authenticated AND a.privilege_type = 'EXECUTE'
    ), format('%s authenticated grant must be explicit', v_public);
  END LOOP;

  -- The renamed implementations remain private owner-only delegates.
  FOREACH v_private IN ARRAY ARRAY[
    'public._reporting_rpc_get_pipeline_throughput_range(uuid,date,date,integer)'::regprocedure,
    'public._reporting_rpc_get_pipeline_points_range(uuid,date,date,integer)'::regprocedure
  ] LOOP
    SELECT proowner INTO v_owner FROM pg_proc WHERE oid = v_private::oid;
    ASSERT NOT has_function_privilege('authenticated', v_private, 'EXECUTE'), format('%s exposed to authenticated', v_private);
    ASSERT NOT has_function_privilege('anon', v_private, 'EXECUTE'), format('%s exposed to anon', v_private);
    ASSERT NOT has_function_privilege('service_role', v_private, 'EXECUTE'), format('%s exposed to service_role', v_private);
    ASSERT NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = v_private::oid), acldefault('f', v_owner))) a
      WHERE a.grantee <> v_owner AND a.privilege_type = 'EXECUTE'
    ), format('%s must retain owner-only EXECUTE', v_private);
  END LOOP;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_caller::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_caller::text, true);
  FOREACH v_private IN ARRAY ARRAY[
    'public._reporting_rpc_get_pipeline_throughput_range(uuid,date,date,integer)'::regprocedure,
    'public._reporting_rpc_get_pipeline_points_range(uuid,date,date,integer)'::regprocedure
  ] LOOP
    SELECT format('%I.%I', n.nspname, p.proname)
      INTO v_call_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.oid = v_private::oid;
    v_denied_call := false;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s($1, $2, $3, $4)', v_call_name)
        INTO v_count USING v_pipeline, current_date - 7, current_date, 4;
    EXCEPTION WHEN SQLSTATE '42501' THEN v_denied_call := true;
    END;
    ASSERT v_denied_call, format('%s must reject direct authenticated execution', v_private);
  END LOOP;

  -- Missing auth, missing analytics.view, foreign-company, deleted, and
  -- missing pipeline IDs must all fail closed with 42501 for both wrappers.
  FOREACH v_public IN ARRAY ARRAY[
    'public.rpc_get_pipeline_throughput_range(uuid,date,date,integer)'::regprocedure,
    'public.rpc_get_pipeline_points_range(uuid,date,date,integer)'::regprocedure
  ] LOOP
    SELECT format('%I.%I', n.nspname, p.proname)
      INTO v_call_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.oid = v_public::oid;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    v_denied_call := false;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s($1, $2, $3, $4)', v_call_name)
        INTO v_count USING v_pipeline, current_date - 7, current_date, 4;
    EXCEPTION WHEN SQLSTATE '42501' THEN v_denied_call := true;
    END;
    ASSERT v_denied_call, format('%s accepted a missing authenticated subject', v_public);

    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_denied::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_denied::text, true);
    v_denied_call := false;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s($1, $2, $3, $4)', v_call_name)
        INTO v_count USING v_pipeline, current_date - 7, current_date, 4;
    EXCEPTION WHEN SQLSTATE '42501' THEN v_denied_call := true;
    END;
    ASSERT v_denied_call, format('%s accepted a caller without analytics.view', v_public);

    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_caller::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_caller::text, true);
    v_denied_call := false;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s($1, $2, $3, $4)', v_call_name)
        INTO v_count USING v_foreign_pipeline, current_date - 7, current_date, 4;
    EXCEPTION WHEN SQLSTATE '42501' THEN v_denied_call := true;
    END;
    ASSERT v_denied_call, format('%s accepted a foreign-company pipeline', v_public);

    v_denied_call := false;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s($1, $2, $3, $4)', v_call_name)
        INTO v_count USING v_deleted_pipeline, current_date - 7, current_date, 4;
    EXCEPTION WHEN SQLSTATE '42501' THEN v_denied_call := true;
    END;
    ASSERT v_denied_call, format('%s accepted a deleted pipeline', v_public);

    v_denied_call := false;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s($1, $2, $3, $4)', v_call_name)
        INTO v_count USING v_missing_pipeline, current_date - 7, current_date, 4;
    EXCEPTION WHEN SQLSTATE '42501' THEN v_denied_call := true;
    END;
    ASSERT v_denied_call, format('%s accepted a missing pipeline', v_public);

    -- Same-company active pipeline succeeds for the authorized caller. The
    -- source calculations may legitimately return zero rows; no fixture data
    -- is needed to prove the wrapper authorization path.
    EXECUTE format('SELECT count(*) FROM %s($1, $2, $3, $4)', v_call_name)
      INTO v_count USING v_pipeline, current_date - 7, current_date, 4;
  END LOOP;

  -- Function execution itself must be denied for anon, even before wrapper
  -- body authorization is reached.
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  FOREACH v_public IN ARRAY ARRAY[
    'public.rpc_get_pipeline_throughput_range(uuid,date,date,integer)'::regprocedure,
    'public.rpc_get_pipeline_points_range(uuid,date,date,integer)'::regprocedure
  ] LOOP
    SELECT format('%I.%I', n.nspname, p.proname)
      INTO v_call_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.oid = v_public::oid;
    v_denied_call := false;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s($1, $2, $3, $4)', v_call_name)
        INTO v_count USING v_pipeline, current_date - 7, current_date, 4;
    EXCEPTION WHEN SQLSTATE '42501' THEN v_denied_call := true;
    END;
    ASSERT v_denied_call, format('%s must reject anon with 42501', v_public);
  END LOOP;

  SET LOCAL ROLE service_role;
  FOREACH v_public IN ARRAY ARRAY[
    'public.rpc_get_pipeline_throughput_range(uuid,date,date,integer)'::regprocedure,
    'public.rpc_get_pipeline_points_range(uuid,date,date,integer)'::regprocedure
  ] LOOP
    SELECT format('%I.%I', n.nspname, p.proname)
      INTO v_call_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.oid = v_public::oid;
    v_denied_call := false;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s($1, $2, $3, $4)', v_call_name)
        INTO v_count USING v_pipeline, current_date - 7, current_date, 4;
    EXCEPTION WHEN SQLSTATE '42501' THEN v_denied_call := true;
    END;
    ASSERT v_denied_call, format('%s must reject service_role with 42501', v_public);
  END LOOP;

  RAISE NOTICE 'check_analytics_bucketed_range_tenant_scope.sql: ALL CHECKS PASSED';
END
$check$;

ROLLBACK;
