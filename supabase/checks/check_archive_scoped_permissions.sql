-- Issue #431: Cold Storage row-level authorization regression check.
-- Run against a local DB with:
--   npx supabase db query --local -f supabase/checks/check_archive_scoped_permissions.sql
-- or psql -f supabase/checks/check_archive_scoped_permissions.sql.
-- Creates transaction-only fixture rows, impersonates authenticated callers,
-- and rolls everything back.
BEGIN;

DO $$
DECLARE
  policy_count integer;
BEGIN
  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'archives';

  ASSERT policy_count = 1, format('expected exactly one archives policy, found %s', policy_count);
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'archives'
      AND policyname = 'archives_select_scoped'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND qual ILIKE '%fn_archive_accessible%'
      AND qual ILIKE '%view%'
      AND with_check IS NULL
  ), 'archives_select_scoped must be SELECT-only, authenticated-only, and call fn_archive_accessible(..., view)';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'archives'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ), 'an archives write policy survived cleanup';
END $$;

CREATE TEMP TABLE archive_scope_ctx (
  company_id uuid, other_company_id uuid, team_id uuid,
  owner_id uuid, creator_id uuid, assignee_id uuid, team_user_id uuid,
  project_owner_id uuid, project_assignee_id uuid, outsider_id uuid,
  view_all_id uuid, restore_all_id uuid,
  task_creator_archive uuid, task_assignee_archive uuid, task_team_archive uuid,
  task_outsider_archive uuid, project_owner_archive uuid, project_assignee_archive uuid,
  foreign_archive uuid
);
GRANT SELECT ON archive_scope_ctx TO authenticated;

DO $$
DECLARE
  c uuid; c2 uuid; owner_u uuid; owner2_u uuid; v_team_id uuid; team_u uuid;
  pool uuid[]; role_id uuid; i int; p uuid; p2 uuid;
  t uuid; a_creator uuid; a_assignee uuid; a_team uuid; a_out uuid;
  a_powner uuid; a_passignee uuid; a_foreign uuid;
  new_user_id uuid; slug text;
BEGIN
  slug := 'archive-check-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.companies(name, slug) VALUES ('#431 archive check', slug) RETURNING id INTO c;
  slug := 'archive-check-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.companies(name, slug) VALUES ('#431 foreign archive check', slug) RETURNING id INTO c2;

  -- Create two company owners, six isolated callers, and a separate team member.
  -- auth.users is the required parent for public.users; every row is rolled back.
  pool := ARRAY[]::uuid[];
  FOR i IN 1..9 LOOP
    new_user_id := gen_random_uuid();
    INSERT INTO auth.users(
      id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      new_user_id, 'authenticated', 'authenticated',
      format('archive-check-%s-%s@example.invalid', i, replace(gen_random_uuid()::text, '-', '')),
      '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    );
    INSERT INTO public.users(id, company_id, email, full_name, is_owner)
    VALUES (
      new_user_id,
      CASE WHEN i = 9 THEN c2 ELSE c END,
      (SELECT email FROM auth.users WHERE id = new_user_id),
      '#431 archive user ' || i,
      i IN (1, 9)
    );
    CASE
      WHEN i = 1 THEN owner_u := new_user_id;
      WHEN i BETWEEN 2 AND 7 THEN pool := array_append(pool, new_user_id);
      WHEN i = 8 THEN team_u := new_user_id;
      WHEN i = 9 THEN owner2_u := new_user_id;
    END CASE;
  END LOOP;

  INSERT INTO public.teams(company_id, name, created_by)
  VALUES(c, '#431 archive check team', owner_u) RETURNING id INTO v_team_id;
  INSERT INTO public.team_members(team_id, user_id, company_id, added_by)
  VALUES(v_team_id, team_u, c, owner_u);

  -- Pool order: creator, direct assignee, project owner, project assignee,
  -- unrelated same-company user, archive.view_all + archive.delete.
  INSERT INTO public.permissions(key,label,category) VALUES
    ('archive.view_all','View all Cold Storage archives','archives'),
    ('archive.restore_all','Restore all Cold Storage archives','archives')
  ON CONFLICT(key) DO NOTHING;
  INSERT INTO public.permissions(key,label,category) VALUES
    ('archive.view','View Cold Storage Archives','archives'),
    ('archive.restore','Restore from Archives','archives'),
    ('archive.delete','Permanently Delete Archives','archives')
  ON CONFLICT(key) DO NOTHING;

  -- One role per test identity, with only the capabilities each assertion needs.
  FOR i IN 1..6 LOOP
    INSERT INTO public.roles(company_id,name) VALUES(c,'#431 archive check '||i) RETURNING id INTO p2;
    INSERT INTO public.user_roles(user_id,role_id,company_id) VALUES(pool[i],p2,c);
    INSERT INTO public.role_permissions(role_id,permission_id)
      SELECT p2,id FROM public.permissions WHERE key IN ('archive.view',
        CASE WHEN i IN (2,5) THEN 'archive.restore' ELSE 'archive.view' END,
        CASE WHEN i IN (2,5,6) THEN 'archive.delete' ELSE 'archive.view' END,
        CASE WHEN i=6 THEN 'archive.view_all' ELSE 'archive.view' END,
        CASE WHEN i=6 THEN 'archive.restore_all' ELSE 'archive.view' END)
      ON CONFLICT DO NOTHING;
  END LOOP;
  INSERT INTO public.roles(company_id,name) VALUES(c,'#431 archive team reader') RETURNING id INTO role_id;
  INSERT INTO public.user_roles(user_id,role_id,company_id) VALUES(team_u,role_id,c);
  INSERT INTO public.role_permissions(role_id,permission_id)
    SELECT role_id,id FROM public.permissions WHERE key='archive.view' ON CONFLICT DO NOTHING;
  -- Reuse the creator identity for restore_all; the dedicated unrelated archive
  -- below is owned and archived by the company owner, so this still proves the override.
  INSERT INTO public.roles(company_id,name) VALUES(c,'#431 archive restore all') RETURNING id INTO role_id;
  INSERT INTO public.user_roles(user_id,role_id,company_id) VALUES(pool[1],role_id,c);
  INSERT INTO public.role_permissions(role_id,permission_id)
    SELECT role_id,id FROM public.permissions WHERE key IN ('archive.view','archive.restore','archive.restore_all') ON CONFLICT DO NOTHING;

  INSERT INTO public.projects(company_id,name,created_by,owner_id) VALUES(c,'#431 scoped project',pool[1],pool[3]) RETURNING id INTO p;
  INSERT INTO public.projects(company_id,name,created_by,owner_id) VALUES(c2,'#431 foreign project',owner2_u,owner2_u) RETURNING id INTO p2;
  INSERT INTO public.tasks(company_id,title,project_id,created_by) VALUES(c,'#431 creator task',p,pool[1]) RETURNING id INTO t;
  INSERT INTO public.archives(company_id,entity_type,entity_id,snapshot,metadata,archived_by)
  VALUES(c,'task',t,jsonb_build_object('task',jsonb_build_object('id',t,'company_id',c,'project_id',p,'created_by',pool[1]),'assignments','[]'::jsonb,'comments','[]'::jsonb,'attachments','[]'::jsonb,'history','[]'::jsonb,'work_sessions','[]'::jsonb,'submissions','[]'::jsonb),jsonb_build_object('title','#431 creator task'),pool[1]) RETURNING id INTO a_creator;
  INSERT INTO public.tasks(company_id,title,project_id,created_by) VALUES(c,'#431 assignee task',NULL,pool[1]) RETURNING id INTO t;
  INSERT INTO public.task_assignments(task_id,company_id,assignee_user_id,assigned_by) VALUES(t,c,pool[2],pool[1]);
  INSERT INTO public.archives(company_id,entity_type,entity_id,snapshot,metadata,archived_by)
  VALUES(c,'task',t,jsonb_build_object('task',jsonb_build_object('id',t,'company_id',c,'created_by',pool[1]),'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(ta)),'[]'::jsonb) FROM public.task_assignments ta WHERE ta.task_id=t),'comments','[]'::jsonb,'attachments','[]'::jsonb,'history','[]'::jsonb,'work_sessions','[]'::jsonb,'submissions','[]'::jsonb),jsonb_build_object('title','#431 assignee task'),owner_u) RETURNING id INTO a_assignee;
  INSERT INTO public.tasks(company_id,title,created_by) VALUES(c,'#431 team task',pool[1]) RETURNING id INTO t;
  INSERT INTO public.task_assignments(task_id,company_id,assignee_team_id,assigned_by) VALUES(t,c,v_team_id,pool[1]);
  INSERT INTO public.archives(company_id,entity_type,entity_id,snapshot,metadata,archived_by)
  VALUES(c,'task',t,jsonb_build_object('task',jsonb_build_object('id',t,'company_id',c,'created_by',pool[1]),'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(ta)),'[]'::jsonb) FROM public.task_assignments ta WHERE ta.task_id=t),'comments','[]'::jsonb,'attachments','[]'::jsonb,'history','[]'::jsonb,'work_sessions','[]'::jsonb,'submissions','[]'::jsonb),jsonb_build_object('title','#431 team task'),owner_u) RETURNING id INTO a_team;
  INSERT INTO public.tasks(company_id,title,created_by) VALUES(c,'#431 unrelated task',owner_u) RETURNING id INTO t;
  INSERT INTO public.archives(company_id,entity_type,entity_id,snapshot,metadata,archived_by)
  VALUES(c,'task',t,jsonb_build_object('task',jsonb_build_object('id',t,'company_id',c,'created_by',owner_u),'assignments','[]'::jsonb,'comments','[]'::jsonb,'attachments','[]'::jsonb,'history','[]'::jsonb,'work_sessions','[]'::jsonb,'submissions','[]'::jsonb),jsonb_build_object('title','#431 unrelated task'),owner_u) RETURNING id INTO a_out;
  INSERT INTO public.tasks(company_id,title,project_id,created_by) VALUES(c,'#431 project assigned task',p,pool[1]) RETURNING id INTO t;
  INSERT INTO public.task_assignments(task_id,company_id,assignee_user_id,assigned_by) VALUES(t,c,pool[4],pool[1]);
  INSERT INTO public.archives(company_id,entity_type,entity_id,snapshot,metadata,archived_by)
  VALUES(c,'task',t,jsonb_build_object('task',jsonb_build_object('id',t,'company_id',c,'project_id',p,'created_by',pool[1]),'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(ta)),'[]'::jsonb) FROM public.task_assignments ta WHERE ta.task_id=t),'comments','[]'::jsonb,'attachments','[]'::jsonb,'history','[]'::jsonb,'work_sessions','[]'::jsonb,'submissions','[]'::jsonb),jsonb_build_object('title','#431 project assigned task'),owner_u);
  -- Project access must come from this immutable child snapshot, not the live row.
  DELETE FROM public.task_assignments WHERE task_id=t;
  INSERT INTO public.archives(company_id,entity_type,entity_id,snapshot,metadata,archived_by)
  VALUES(c,'project',p,jsonb_build_object('project',to_jsonb((SELECT pr FROM public.projects pr WHERE pr.id=p))),jsonb_build_object('title','#431 scoped project'),owner_u) RETURNING id INTO a_powner;
  INSERT INTO public.archives(company_id,entity_type,entity_id,snapshot,metadata,archived_by)
  VALUES(c,'project',p,jsonb_build_object('project',to_jsonb((SELECT pr FROM public.projects pr WHERE pr.id=p))),jsonb_build_object('title','#431 project assignee'),owner_u) RETURNING id INTO a_passignee;
  INSERT INTO public.archives(company_id,entity_type,entity_id,snapshot,metadata,archived_by)
  VALUES(c2,'task',gen_random_uuid(),jsonb_build_object('task',jsonb_build_object('id',gen_random_uuid(),'company_id',c2),'assignments','[]'::jsonb,'comments','[]'::jsonb,'attachments','[]'::jsonb,'history','[]'::jsonb,'work_sessions','[]'::jsonb,'submissions','[]'::jsonb),jsonb_build_object('title','#431 foreign'),owner2_u) RETURNING id INTO a_foreign;
  ASSERT EXISTS (
    SELECT 1 FROM public.archive_access_principals ap
    WHERE ap.archive_id = a_passignee
      AND ap.company_id = c
      AND ap.user_id = pool[4]
  ), 'project child assignment was not captured from its archived task snapshot';
  INSERT INTO archive_scope_ctx VALUES(c,c2,v_team_id,owner_u,pool[1],pool[2],team_u,pool[3],pool[4],pool[5],pool[6],pool[1],a_creator,a_assignee,a_team,a_out,a_powner,a_passignee,a_foreign);
END $$;

DO $$
DECLARE
  v_payload jsonb;
BEGIN
  SELECT e.payload INTO v_payload
  FROM public.platform_catalog_entries e
  JOIN public.platform_catalog_heads h
    ON h.catalog_key = e.catalog_key
   AND h.published_version = e.version
  WHERE e.catalog_key = 'roles_permissions'
    AND e.version = 2;

  ASSERT v_payload IS NOT NULL,
    'roles_permissions v2 is not the published bootstrap catalog head';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_payload->'roles') role_item
    WHERE role_item->>'name' IN ('Admin', 'Owner')
      AND NOT (
        role_item->'permission_keys' ? 'archive.view_all'
        AND role_item->'permission_keys' ? 'archive.restore_all'
      )
  ), 'catalog Admin/Owner is missing a Cold Storage override';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_payload->'roles') role_item
    WHERE role_item->>'name' NOT IN ('Admin', 'Owner')
      AND (
        role_item->'permission_keys' ? 'archive.view_all'
        OR role_item->'permission_keys' ? 'archive.restore_all'
      )
  ), 'Cold Storage overrides leaked to a non-elevated catalog role';
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE x archive_scope_ctx%ROWTYPE; n int; got boolean; msg text; state text;
BEGIN
 SELECT * INTO x FROM archive_scope_ctx;
 -- Exercise raw archives SELECT RLS and the SECURITY DEFINER reader for a
 -- same-company user with archive.view but no principal relationship.
 PERFORM set_config('request.jwt.claim.sub',x.outsider_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x.outsider_id,'role','authenticated')::text,true);
 SELECT count(*) INTO n FROM public.archives WHERE id IN (x.task_creator_archive,x.task_assignee_archive,x.task_team_archive,x.task_outsider_archive,x.project_owner_archive,x.project_assignee_archive);
 ASSERT n=0, format('raw archives SELECT exposed %s scoped rows to unrelated same-company user',n);
 SELECT count(*) INTO n FROM public.rpc_get_archives() WHERE id IN (x.task_creator_archive,x.task_assignee_archive,x.task_team_archive,x.task_outsider_archive,x.project_owner_archive,x.project_assignee_archive);
 ASSERT n=0, format('rpc_get_archives exposed %s scoped rows to unrelated same-company user',n);

 -- Creator/owner, direct assignee, assigned-team member, project owner and
 -- project task assignee each retain access to their corresponding archive.
 PERFORM set_config('request.jwt.claim.sub',x.creator_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x.creator_id,'role','authenticated')::text,true);
 ASSERT EXISTS(SELECT 1 FROM public.archives WHERE id=x.task_creator_archive),'task creator denied by raw RLS';
 ASSERT EXISTS(SELECT 1 FROM public.rpc_get_archives() WHERE id=x.task_creator_archive),'task creator denied by archive reader';
 PERFORM set_config('request.jwt.claim.sub',x.assignee_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x.assignee_id,'role','authenticated')::text,true);
 ASSERT EXISTS(SELECT 1 FROM public.rpc_get_archives() WHERE id=x.task_assignee_archive),'direct task assignee denied';
 PERFORM set_config('request.jwt.claim.sub',x.team_user_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x.team_user_id,'role','authenticated')::text,true);
 ASSERT EXISTS(SELECT 1 FROM public.rpc_get_archives() WHERE id=x.task_team_archive),'assigned-team member denied';
 PERFORM set_config('request.jwt.claim.sub',x.project_owner_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x.project_owner_id,'role','authenticated')::text,true);
 ASSERT EXISTS(SELECT 1 FROM public.rpc_get_archives() WHERE id=x.project_owner_archive),'project owner denied';
 PERFORM set_config('request.jwt.claim.sub',x.project_assignee_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x.project_assignee_id,'role','authenticated')::text,true);
 ASSERT EXISTS(SELECT 1 FROM public.rpc_get_archives() WHERE id=x.project_assignee_archive),'project involved/direct assignee denied';

 -- archive.view_all is a same-company scope modifier. The omitted/default
 -- include-company argument stays principal-scoped; opting in exposes the
 -- unrelated same-company archive without crossing the tenant boundary.
 PERFORM set_config('request.jwt.claim.sub',x.view_all_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x.view_all_id,'role','authenticated')::text,true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.rpc_get_archives() WHERE id=x.task_outsider_archive),'default rpc_get_archives scope exposed unrelated same-company archive';
 ASSERT EXISTS(SELECT 1 FROM public.rpc_get_archives(NULL,NULL,true) WHERE id=x.task_outsider_archive),'archive.view_all did not expose same-company archive when explicitly requested';
 ASSERT NOT EXISTS(SELECT 1 FROM public.rpc_get_archives(NULL,NULL,true) WHERE id=x.foreign_archive),'explicit company-scoped rpc_get_archives escaped company boundary';

 -- Generic restore/delete permission must still be scoped. A mutation that
 -- succeeds, or reaches a later data-integrity error, is an authorization bug.
 PERFORM set_config('request.jwt.claim.sub',x.outsider_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x.outsider_id,'role','authenticated')::text,true);
 BEGIN PERFORM public.rpc_restore_archive(x.task_outsider_archive); EXCEPTION WHEN OTHERS THEN state:=SQLSTATE; msg:=SQLERRM; END;
 ASSERT state='42501',format('unauthorized rpc_restore_archive was not rejected at authorization boundary (SQLSTATE %, %)',state,msg);
 state:=NULL; msg:=NULL;
 BEGIN PERFORM public.rpc_restore_project(x.project_owner_archive); EXCEPTION WHEN OTHERS THEN state:=SQLSTATE; msg:=SQLERRM; END;
 ASSERT state='42501',format('unauthorized rpc_restore_project was not rejected at authorization boundary (SQLSTATE %, %)',state,msg);
 state:=NULL; msg:=NULL;
 BEGIN PERFORM public.rpc_purge_archives(ARRAY[x.task_assignee_archive]); EXCEPTION WHEN OTHERS THEN state:=SQLSTATE; msg:=SQLERRM; END;
 ASSERT state='42501',format('unauthorized rpc_purge_archives was not rejected at authorization boundary (SQLSTATE %, %)',state,msg);

 -- A same-company archive principal with archive.delete is still not allowed to
 -- purge without the elevated archive.view_all capability.
 PERFORM set_config('request.jwt.claim.sub',x.assignee_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x.assignee_id,'role','authenticated')::text,true);
 state:=NULL; msg:=NULL;
 BEGIN PERFORM public.rpc_purge_archives(ARRAY[x.task_assignee_archive]); EXCEPTION WHEN OTHERS THEN state:=SQLSTATE; msg:=SQLERRM; END;
 ASSERT state='42501',format('scoped principal with archive.delete passed the purge gate (SQLSTATE %, %)',state,msg);
 ASSERT EXISTS(SELECT 1 FROM public.archives WHERE id=x.task_assignee_archive),'scoped principal purge removed archive';

 -- archive.view_all and archive.restore_all are independent, tenant-bounded
 -- overrides. The restore_all user also has archive.restore for the RPC gate.
 PERFORM set_config('request.jwt.claim.sub',x.view_all_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x.view_all_id,'role','authenticated')::text,true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.rpc_get_archives() WHERE id=x.task_outsider_archive),'default rpc_get_archives scope exposed unrelated same-company archive';
 ASSERT EXISTS(SELECT 1 FROM public.rpc_get_archives(NULL,NULL,true) WHERE id=x.task_outsider_archive),'archive.view_all did not expose same-company archive when explicitly requested';
 ASSERT NOT EXISTS(SELECT 1 FROM public.rpc_get_archives(NULL,NULL,true) WHERE id=x.foreign_archive),'explicit company-scoped rpc_get_archives escaped company boundary';
 state:=NULL; msg:=NULL;
 BEGIN PERFORM public.rpc_purge_archives(ARRAY[x.foreign_archive]); EXCEPTION WHEN OTHERS THEN state:=SQLSTATE; msg:=SQLERRM; END;
 ASSERT state='42501',format('archive.view_all + archive.delete escaped company purge boundary (SQLSTATE %, %)',state,msg);
 state:=NULL; msg:=NULL;
 BEGIN PERFORM public.rpc_purge_archives(ARRAY[x.task_team_archive]); EXCEPTION WHEN OTHERS THEN state:=SQLSTATE; msg:=SQLERRM; END;
 ASSERT state IS NULL,format('archive.view_all + archive.delete could not purge same-company archive (SQLSTATE %, %)',state,msg);
 ASSERT NOT EXISTS(SELECT 1 FROM public.archives WHERE id=x.task_team_archive),'elevated same-company purge left archive behind';
 state:=NULL; msg:=NULL;
 BEGIN PERFORM public.rpc_restore_archive(x.task_outsider_archive); EXCEPTION WHEN OTHERS THEN state:=SQLSTATE; msg:=SQLERRM; END;
 ASSERT state='42501',format('archive.restore_all without archive.restore bypassed the base gate (SQLSTATE %, %)',state,msg);

 -- restore_all plus its base archive.restore grants the mutator gate, while
 -- retaining company isolation.
 PERFORM set_config('request.jwt.claim.sub',x.restore_all_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x.restore_all_id,'role','authenticated')::text,true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.rpc_get_archives() WHERE id=x.task_outsider_archive),'default rpc_get_archives scope exposed unrelated same-company archive';
 state:=NULL; msg:=NULL;
 BEGIN PERFORM * FROM public.rpc_get_archives(NULL,NULL,true); EXCEPTION WHEN OTHERS THEN state:=SQLSTATE; msg:=SQLERRM; END;
 ASSERT state='42501',format('archive.restore_all without archive.view_all passed the company-scope reader gate (SQLSTATE %, %)',state,msg);
 state:=NULL; msg:=NULL;
 BEGIN PERFORM public.rpc_restore_archive(x.task_outsider_archive); EXCEPTION WHEN OTHERS THEN state:=SQLSTATE; msg:=SQLERRM; END;
 ASSERT state IS DISTINCT FROM '42501',format('archive.restore_all did not pass the authorization gate (SQLSTATE %, %)',state,msg);
 RAISE NOTICE 'archive scoped permission checks passed';
END $$;
RESET ROLE;
DO $$
DECLARE x archive_scope_ctx%ROWTYPE;
BEGIN
  SELECT * INTO x FROM archive_scope_ctx;
  ASSERT EXISTS (
    SELECT 1 FROM public.archives WHERE id = x.task_assignee_archive
  ), 'unauthorized purge removed archive';
  ASSERT EXISTS (
    SELECT 1 FROM public.archives WHERE id = x.foreign_archive
  ), 'cross-tenant purge removed archive';
END $$;
ROLLBACK;
