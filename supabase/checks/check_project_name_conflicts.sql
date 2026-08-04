-- rpc_project_name_conflicts is what stands between "you edited the
-- spreadsheet, drop it back in" and the raw wall
-- fn_check_batch_duplicate_names throws. The wizard trusts four things about
-- it, none of which tsc can check:
--
--   1. a name held by an ACTIVE project is reported (else Replace is never
--      offered and the user hits the RAISE anyway);
--   2. a name held only by a SOFT-DELETED project is NOT reported -- the
--      partial unique index allows that name, so reporting it would block an
--      import the DB would happily accept;
--   3. a name nobody holds is absent, and the match is exact/trimmed, not
--      fuzzy -- a false positive here tells someone their new project already
--      exists and invites them to overwrite an unrelated one;
--   4. can_edit tracks projects_update. The UI only shows Replace when this
--      is true; if it over-reports, Replace is a button that fails at the
--      policy.
--
-- Everything runs in ONE transaction and rolls back.
BEGIN;

-- trg_dispatch_notification_event pg_net-POSTs to a hardcoded PRODUCTION url.
-- Any check that writes rows which emit notification events must disable it
-- for its own transaction (see security_local_clone_drives_prod).
SET LOCAL session_replication_role = replica;

DO $check$
DECLARE
  v_company  UUID;
  v_user     UUID;
  v_active   UUID;
  v_deleted  UUID;
  v_rows     INT;
  v_taken    BOOLEAN;
  v_can_edit BOOLEAN;
  v_tasks    INT;
BEGIN
  SELECT u.company_id, u.id INTO v_company, v_user
  FROM public.users u
  WHERE u.is_owner AND u.company_id IS NOT NULL AND u.deleted_at IS NULL
  ORDER BY u.created_at
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'no owner with a company in this database — cannot check';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  -- Fixtures are seeded as postgres, on purpose: the soft-deleted row could
  -- not be inserted through the policies at all, and this check is about the
  -- RPC's answers, not about who may create a project.
  INSERT INTO public.projects (company_id, name, status, created_by)
  VALUES (v_company, 'CHK conflict active', 'active', v_user)
  RETURNING id INTO v_active;

  INSERT INTO public.projects (company_id, name, status, created_by, deleted_at)
  VALUES (v_company, 'CHK conflict archived', 'active', v_user, now())
  RETURNING id INTO v_deleted;

  -- Two tasks, so task_count is a real count and not accidentally 0 for all
  -- rows. The wizard prints this number next to a destructive-sounding
  -- action ("Replace — keeps its N tasks"), so it has to be the truth.
  INSERT INTO public.tasks (company_id, title, project_id, created_by, manager_id)
  VALUES (v_company, 'CHK t1', v_active, v_user, v_user),
         (v_company, 'CHK t2', v_active, v_user, v_user);

  -- Everything below runs as the authenticated owner, which is who calls it.
  PERFORM set_config('role', 'authenticated', true);

  -- ── 1 + 2 + 3: exactly the active name comes back ─────────────────────────
  SELECT COUNT(*) INTO v_rows
  FROM public.rpc_project_name_conflicts(ARRAY[
    'CHK conflict active',
    'CHK conflict archived',
    'CHK conflict nobody has this'
  ]);

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 conflict (the active one), got %', v_rows;
  END IF;

  SELECT TRUE, k.can_edit, k.task_count INTO v_taken, v_can_edit, v_tasks
  FROM public.rpc_project_name_conflicts(ARRAY['CHK conflict active']) k;

  IF NOT COALESCE(v_taken, FALSE) THEN
    RAISE EXCEPTION 'the active project name was not reported as taken';
  END IF;

  IF v_tasks <> 2 THEN
    RAISE EXCEPTION 'task_count should be 2, got %', v_tasks;
  END IF;

  -- ── 4: can_edit agrees with what projects_update would actually permit ────
  IF NOT COALESCE(v_can_edit, FALSE) THEN
    RAISE EXCEPTION 'an owner must be able to edit their own project, but can_edit was %', v_can_edit;
  END IF;

  UPDATE public.projects SET description = 'CHK replace touched this' WHERE id = v_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'can_edit said true but projects_update refused the write — the two have drifted';
  END IF;

  -- Whitespace is trimmed on the way in (the wizard sends cell text), but the
  -- comparison itself is exact: 'chk conflict active' is a DIFFERENT project.
  SELECT COUNT(*) INTO v_rows
  FROM public.rpc_project_name_conflicts(ARRAY['  CHK conflict active  ', 'chk conflict active']);

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'expected the trimmed name to match and the lowercased one not to, got % rows', v_rows;
  END IF;

  -- Empty and NULL entries must not blow up or match everything.
  SELECT COUNT(*) INTO v_rows
  FROM public.rpc_project_name_conflicts(ARRAY['', '   ', NULL]::TEXT[]);

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'blank names must match nothing, got % rows', v_rows;
  END IF;

  RAISE NOTICE 'check_project_name_conflicts: 5/5 pass';
END;
$check$;

ROLLBACK;
