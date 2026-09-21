-- Transactional contract check for per-person, per-company guide progress.
BEGIN;

DO $check$
DECLARE
  v_uid uuid;
  v_other_uid uuid;
  v_has_other_user boolean := false;
  v_rows jsonb;
  v_guide_count integer;
  v_expected_guide record;
  v_progress public.user_guide_progress%rowtype;
  v_failed boolean := false;
BEGIN
  ASSERT to_regclass('public.user_guide_progress') IS NOT NULL, 'user guide progress table missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_guide_progress' AND column_name='company_id'), 'company scope column missing';
  ASSERT (
    SELECT count(*) = 9 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_guide_progress'
      AND column_name IN ('user_id', 'guide_id', 'guide_version', 'status', 'current_step', 'first_eligible_at', 'acknowledged_at', 'completed_at', 'updated_at')
  ), 'guide progress column contract incomplete';
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_guide_progress'::regclass AND contype = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, company_id, guide_id)'
  ), 'user/guide composite primary key missing';
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_guide_progress'::regclass AND contype = 'f'
      AND confrelid = 'public.users'::regclass AND pg_get_constraintdef(oid) LIKE '%user_id%'
  ), 'users foreign key missing';
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_guide_progress'::regclass AND contype = 'f'
      AND confrelid = 'public.companies'::regclass AND pg_get_constraintdef(oid) LIKE '%company_id%'
  ), 'companies foreign key missing';
  ASSERT (
    SELECT count(*) >= 5 FROM pg_constraint
    WHERE conrelid = 'public.user_guide_progress'::regclass AND contype = 'c'
  ), 'guide progress validation constraints incomplete';
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_guide_progress'::regclass
      AND conname = 'user_guide_progress_timestamp_order_check'
  ), 'guide progress timestamp ordering constraint missing';
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_guide_progress'::regclass
      AND conname = 'user_guide_progress_acknowledgement_check'
  ), 'terminal guide acknowledgement constraint missing';
  ASSERT to_regprocedure('public.rpc_sync_user_guide_progress(jsonb)') IS NOT NULL, 'guide sync RPC missing';
  ASSERT to_regprocedure('public.rpc_update_user_guide_progress(text,integer,text,integer,boolean)') IS NOT NULL, 'guide update RPC missing';
  ASSERT to_regprocedure('public._user_guide_progress_final_step(text,integer)') IS NOT NULL, 'private guide persistence metadata helper missing';
  FOR v_expected_guide IN
    SELECT guide_id, final_step
    FROM (VALUES
      ('profile', 2),
      ('top-bar', 2),
      ('tasks', 2),
      ('task-workflow', 2),
      ('deadlines', 2),
      ('projects', 2),
      ('portfolios', 2),
      ('filehub', 2),
      ('filehub-sharing', 2),
      ('team-people', 2),
      ('team-assignments', 2),
      ('workflow-pipelines', 2),
      ('intelligence', 2)
    ) AS expected(guide_id, final_step)
  LOOP
    ASSERT public._user_guide_progress_final_step(v_expected_guide.guide_id, 1) = v_expected_guide.final_step,
      format('guide final-step contract drifted for %s v1', v_expected_guide.guide_id);
  END LOOP;
  -- Synthetic profile v2 exists only for this SQL check's reset fixture.
  ASSERT public._user_guide_progress_final_step('profile', 2) = 2,
    'synthetic profile v2 reset fixture final-step contract drifted';
  ASSERT public._user_guide_progress_final_step('removed-guide', 1) IS NULL,
    'removed guide definition remains supported';
  ASSERT public._user_guide_progress_final_step('tasks', 2) IS NULL,
    'unsupported guide version remains supported';
  ASSERT NOT has_function_privilege('authenticated', 'public._user_guide_progress_final_step(text,integer)', 'EXECUTE'), 'guide metadata helper exposed to authenticated';
  ASSERT NOT has_function_privilege('anon', 'public._user_guide_progress_final_step(text,integer)', 'EXECUTE'), 'guide metadata helper exposed to anon';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'public._user_guide_progress_final_step(text,integer)'::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ), 'guide metadata helper exposed to PUBLIC';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_guide_progress'::regclass), 'RLS is not enabled';
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_guide_progress'
      AND policyname = 'user_guide_progress_read'
      AND cmd = 'SELECT' AND roles @> ARRAY['authenticated']::name[]
      AND qual LIKE '%auth.uid%' AND qual LIKE '%user_id%'
      AND qual LIKE '%company_id%' AND qual LIKE '%my_company_id%'
  ), 'user/company-scoped SELECT policy missing';
  ASSERT has_table_privilege('authenticated', 'public.user_guide_progress', 'SELECT'), 'authenticated SELECT grant missing';
  ASSERT NOT has_table_privilege('authenticated', 'public.user_guide_progress', 'INSERT'), 'authenticated INSERT leaked';
  ASSERT NOT has_table_privilege('authenticated', 'public.user_guide_progress', 'UPDATE'), 'authenticated UPDATE leaked';
  ASSERT NOT has_table_privilege('authenticated', 'public.user_guide_progress', 'DELETE'), 'authenticated DELETE leaked';
  ASSERT NOT has_table_privilege('anon', 'public.user_guide_progress', 'SELECT'), 'anon SELECT leaked';
  ASSERT NOT has_table_privilege('anon', 'public.user_guide_progress', 'INSERT'), 'anon INSERT leaked';
  ASSERT has_function_privilege('authenticated', 'public.rpc_sync_user_guide_progress(jsonb)', 'EXECUTE'), 'sync RPC grant missing';
  ASSERT has_function_privilege('authenticated', 'public.rpc_update_user_guide_progress(text,integer,text,integer,boolean)', 'EXECUTE'), 'update RPC grant missing';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_sync_user_guide_progress(jsonb)', 'EXECUTE'), 'sync RPC exposed to anon';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_update_user_guide_progress(text,integer,text,integer,boolean)', 'EXECUTE'), 'update RPC exposed to anon';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.rpc_sync_user_guide_progress(jsonb)'::regprocedure
      AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ), 'sync RPC exposed to PUBLIC';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.rpc_update_user_guide_progress(text,integer,text,integer,boolean)'::regprocedure
      AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ), 'update RPC exposed to PUBLIC';
  ASSERT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.rpc_sync_user_guide_progress(jsonb)'::regprocedure), 'sync RPC security/search_path incorrect';
  ASSERT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.rpc_update_user_guide_progress(text,integer,text,integer,boolean)'::regprocedure), 'update RPC security/search_path incorrect';
  ASSERT position('auth.uid()' IN pg_get_functiondef('public.rpc_sync_user_guide_progress(jsonb)'::regprocedure)) > 0, 'sync RPC does not derive caller identity';
  ASSERT position('auth.uid()' IN pg_get_functiondef('public.rpc_update_user_guide_progress(text,integer,text,integer,boolean)'::regprocedure)) > 0, 'update RPC does not derive caller identity';

  SELECT id INTO v_uid FROM public.users WHERE id IN (SELECT id FROM auth.users) ORDER BY id LIMIT 1;
  SELECT id INTO v_other_uid FROM public.users WHERE id IN (SELECT id FROM auth.users) AND id <> v_uid ORDER BY id LIMIT 1;
  ASSERT v_uid IS NOT NULL, 'an auth-backed seeded user is required';
  v_has_other_user := v_other_uid IS NOT NULL;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.guide_id) INTO v_rows
  FROM public.rpc_sync_user_guide_progress('[{"guide_id":"tasks","guide_version":1},{"guide_id":"top-bar","guide_version":1}]') p;
  SELECT count(*) INTO v_guide_count
  FROM jsonb_array_elements(v_rows) AS returned(value)
  WHERE value ->> 'guide_id' IN ('tasks', 'top-bar');
  ASSERT v_guide_count = 2, 'first sync did not discover both guides';
  SELECT * INTO v_progress FROM public.user_guide_progress WHERE user_id = v_uid AND guide_id = 'tasks';
  ASSERT v_progress.status = 'not_started' AND v_progress.current_step = 0 AND v_progress.acknowledged_at IS NULL AND v_progress.completed_at IS NULL, 'new guide did not start unacknowledged';
  ASSERT v_progress.first_eligible_at IS NOT NULL, 'new guide eligibility timestamp missing';
  ASSERT v_progress.company_id = (SELECT company_id FROM public.users WHERE id=v_uid), 'guide row company does not match caller company';
  ASSERT v_progress.first_eligible_at <= v_progress.updated_at, 'new guide timestamps are out of order';
  SELECT * INTO v_progress FROM public.rpc_update_user_guide_progress('top-bar', 1, 'familiar', 0, true);
  ASSERT v_progress.status='familiar' AND v_progress.completed_at IS NULL AND v_progress.acknowledged_at IS NOT NULL, 'familiar state was not persisted distinctly';
  ASSERT v_progress.acknowledged_at <= v_progress.updated_at, 'familiar acknowledgement timestamp is after updated_at';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_update_user_guide_progress('top-bar', 1, 'in_progress', 1, true);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'familiar guide unexpectedly left its terminal state';
  PERFORM public.rpc_sync_user_guide_progress('[{"guide_id":"tasks","guide_version":1}]');
  SELECT * INTO v_progress FROM public.user_guide_progress WHERE user_id = v_uid AND guide_id = 'tasks';
  ASSERT v_progress.status = 'not_started' AND v_progress.acknowledged_at IS NULL, 'same-version sync changed progress';
  -- A later capability sync may add rows, but it must not reset or delete
  -- earlier progress just because a guide is absent from the current payload.
  PERFORM public.rpc_sync_user_guide_progress('[{"guide_id":"filehub","guide_version":1}]');
  SELECT * INTO v_progress FROM public.user_guide_progress WHERE user_id = v_uid AND guide_id = 'top-bar';
  ASSERT v_progress.status = 'familiar' AND v_progress.acknowledged_at IS NOT NULL, 'syncing a new capability reset existing guide progress';

  -- Skip on a new guide acknowledges it without starting or completing it.
  SELECT * INTO v_progress FROM public.rpc_update_user_guide_progress('tasks', 1, 'not_started', 0, true);
  ASSERT v_progress.status = 'not_started' AND v_progress.current_step = 0
     AND v_progress.acknowledged_at IS NOT NULL AND v_progress.completed_at IS NULL,
    'Skip on a not-started guide changed its state or failed to clear New';

  SELECT * INTO v_progress FROM public.rpc_update_user_guide_progress('tasks', 1, 'in_progress', 1, true);
  ASSERT v_progress.status = 'in_progress' AND v_progress.current_step = 1 AND v_progress.acknowledged_at IS NOT NULL, 'progress/acknowledgement write failed';
  PERFORM public.rpc_sync_user_guide_progress('[{"guide_id":"filehub","guide_version":1}]');
  SELECT * INTO v_progress FROM public.user_guide_progress WHERE user_id = v_uid AND guide_id = 'tasks';
  ASSERT v_progress.status = 'in_progress' AND v_progress.current_step = 1, 'syncing a new capability reset in-progress guide progress';
  -- Skip on an in-progress guide preserves its resumable state and is not Done.
  SELECT * INTO v_progress FROM public.rpc_update_user_guide_progress('tasks', 1, 'in_progress', 1, true);
  ASSERT v_progress.status = 'in_progress' AND v_progress.current_step = 1
     AND v_progress.completed_at IS NULL,
    'Skip on an in-progress guide changed its status/step or marked it done';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_update_user_guide_progress('tasks', 1, 'not_started', 0, true);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'in-progress guide unexpectedly reset to not_started';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_update_user_guide_progress('tasks', 1, 'done', 0, true);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'forged early Done unexpectedly accepted';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_update_user_guide_progress('tasks', 1, 'in_progress', 3, true);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'overlarge current step unexpectedly accepted';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_update_user_guide_progress('tasks', 1, 'in_progress', -1, true);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'negative current step unexpectedly accepted';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_update_user_guide_progress('unknown-guide', 1, 'in_progress', 0, true);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'unknown guide unexpectedly accepted';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_sync_user_guide_progress('[{"guide_id":"unknown-guide","guide_version":1}]');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'unknown synced guide unexpectedly accepted';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_sync_user_guide_progress('[{"guide_id":"removed-guide","guide_version":1}]');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'removed guide definition unexpectedly synced';

  SELECT * INTO v_progress FROM public.rpc_update_user_guide_progress('tasks', 1, 'done', 2, true);
  ASSERT v_progress.status = 'done' AND v_progress.completed_at IS NOT NULL, 'Done did not set completed_at';
  ASSERT v_progress.first_eligible_at <= v_progress.acknowledged_at
     AND v_progress.acknowledged_at <= v_progress.completed_at
     AND v_progress.completed_at <= v_progress.updated_at,
    'Done timestamps are not ordered';
  SELECT * INTO v_progress FROM public.rpc_update_user_guide_progress('tasks', 1, 'done', 0, true);
  ASSERT v_progress.status = 'done' AND v_progress.current_step = 0 AND v_progress.completed_at IS NOT NULL, 'Replay/backtracking did not preserve Done';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_update_user_guide_progress('tasks', 1, 'done', 1, false);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'Done with acknowledgement disabled unexpectedly accepted';
  SELECT * INTO v_progress FROM public.rpc_update_user_guide_progress('tasks', 1, 'in_progress', 0, true);
  ASSERT v_progress.status = 'done' AND v_progress.current_step = 0 AND v_progress.completed_at IS NOT NULL AND v_progress.acknowledged_at IS NOT NULL, 'backtracking did not preserve completed lifecycle state';

  v_failed := false;
  BEGIN
    PERFORM public.rpc_update_user_guide_progress('tasks', 2, 'unknown', 0, false);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'unsupported guide version unexpectedly accepted';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_update_user_guide_progress('tasks', 1, 'unknown', 0, false);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'invalid status unexpectedly accepted';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_update_user_guide_progress('tasks', 1, 'familiar', 1, true);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'familiar state with a nonzero step unexpectedly accepted';

  -- A supported new guide version resets that guide exactly once, while older
  -- clients cannot write against the stale version or downgrade it by syncing.
  PERFORM public.rpc_sync_user_guide_progress('[{"guide_id":"profile","guide_version":1}]');
  SELECT * INTO v_progress FROM public.rpc_update_user_guide_progress('profile', 1, 'familiar', 0, true);
  ASSERT v_progress.status = 'familiar' AND v_progress.acknowledged_at IS NOT NULL, 'version fixture did not enter familiar state';
  PERFORM public.rpc_sync_user_guide_progress('[{"guide_id":"profile","guide_version":2}]');
  SELECT * INTO v_progress FROM public.user_guide_progress WHERE user_id = v_uid AND guide_id = 'profile';
  ASSERT v_progress.guide_version = 2 AND v_progress.status = 'not_started'
     AND v_progress.current_step = 0 AND v_progress.acknowledged_at IS NULL
     AND v_progress.completed_at IS NULL,
    'new guide version did not reset its progress';
  v_failed := false;
  BEGIN
    PERFORM public.rpc_update_user_guide_progress('profile', 1, 'in_progress', 0, true);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  ASSERT v_failed, 'stale guide version unexpectedly accepted a write';
  PERFORM public.rpc_sync_user_guide_progress('[{"guide_id":"profile","guide_version":1}]');
  SELECT * INTO v_progress FROM public.user_guide_progress WHERE user_id = v_uid AND guide_id = 'profile';
  ASSERT v_progress.guide_version = 2 AND v_progress.status = 'not_started', 'older sync downgraded a newer guide version';

  IF v_has_other_user THEN
    PERFORM set_config('request.jwt.claim.sub', v_other_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other_uid, 'role', 'authenticated')::text, true);
    SELECT jsonb_agg(to_jsonb(p)) INTO v_rows
    FROM public.rpc_sync_user_guide_progress('[{"guide_id":"tasks","guide_version":1}]') p;
    SELECT count(*) INTO v_guide_count
    FROM jsonb_array_elements(v_rows) AS returned(value)
    WHERE value ->> 'guide_id' = 'tasks';
    ASSERT v_guide_count = 1, 'second account did not receive its own guide record';
    SELECT * INTO v_progress FROM public.user_guide_progress WHERE user_id = v_other_uid AND guide_id = 'tasks';
    ASSERT v_progress.guide_version = 1 AND v_progress.status = 'not_started', 'guide progress was not isolated by account';
    SELECT * INTO v_progress FROM public.user_guide_progress WHERE user_id = v_uid AND guide_id = 'tasks';
    ASSERT v_progress.status = 'done' AND v_progress.current_step = 0, 'second account changed the first account progress';
    IF (SELECT company_id FROM public.users WHERE id = v_other_uid) IS DISTINCT FROM
       (SELECT company_id FROM public.users WHERE id = v_uid) THEN
      v_failed := false;
      BEGIN
        INSERT INTO public.user_guide_progress
          (user_id, company_id, guide_id, guide_version, status)
        VALUES (v_uid, (SELECT company_id FROM public.users WHERE id = v_other_uid), 'profile', 1, 'not_started');
      EXCEPTION WHEN OTHERS THEN v_failed := true;
      END;
      ASSERT v_failed, 'a caller row was accepted under another company';
    END IF;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  -- Every current catalog guide must accept completion at its catalog final step.
  FOR v_expected_guide IN
    SELECT guide_id, guide_version, final_step
    FROM (VALUES
      ('profile', 2, 2), ('top-bar', 1, 2), ('tasks', 1, 2), ('task-workflow', 1, 2),
      ('deadlines', 1, 2), ('projects', 1, 2), ('portfolios', 1, 2), ('filehub', 1, 2),
      ('filehub-sharing', 1, 2), ('team-people', 1, 2), ('team-assignments', 1, 2),
      ('workflow-pipelines', 1, 2), ('intelligence', 1, 2)
    ) AS expected(guide_id, guide_version, final_step)
  LOOP
    PERFORM public.rpc_sync_user_guide_progress(
      jsonb_build_array(jsonb_build_object('guide_id', v_expected_guide.guide_id, 'guide_version', v_expected_guide.guide_version))
    );
    SELECT * INTO v_progress FROM public.rpc_update_user_guide_progress(
      v_expected_guide.guide_id, v_expected_guide.guide_version, 'done', v_expected_guide.final_step, true
    );
    ASSERT v_progress.status = 'done' AND v_progress.current_step = v_expected_guide.final_step
       AND v_progress.completed_at IS NOT NULL,
      format('catalog guide %s did not complete at final step %s', v_expected_guide.guide_id, v_expected_guide.final_step);
  END LOOP;

  RAISE NOTICE 'check_user_guide_progress: schema, ACL, user/company isolation, discovery, lifecycle, and version semantics passed';
END;
$check$;

ROLLBACK;
