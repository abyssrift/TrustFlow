-- Can a user with project.edit grant themselves read access to a project's
-- files they cannot otherwise see, by pointing rolled_forward_from_project_id
-- at it? The new filehub RLS branch trusts that column.
BEGIN;
DO $$
DECLARE
  v_company UUID; v_actor UUID; v_role UUID;
  v_secret_project UUID; v_my_project UUID; v_folder UUID; v_file UUID;
  v_can_see_secret BOOLEAN; v_files_before INT; v_files_after INT;
  v_updated INT;
BEGIN
  -- Pick a company that actually has a non-owner to act as the attacker.
  SELECT c.id INTO v_company
  FROM public.companies c
  JOIN public.users u ON u.company_id = c.id AND NOT u.is_owner
  GROUP BY c.id
  ORDER BY count(*) DESC
  LIMIT 1;

  -- Reuse an existing non-owner user; public.users.id FKs auth.users, so a
  -- synthetic one cannot be minted here.
  SELECT id INTO v_actor FROM public.users
  WHERE company_id = v_company AND is_owner = false LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'no non-owner user in this company to act as the attacker';
  END IF;

  -- Give the actor a role carrying project.edit / project.view (permission_id
  -- FKs the permissions catalogue; keys are looked up, not inlined).
  SELECT role_id INTO v_role FROM public.user_roles WHERE user_id = v_actor LIMIT 1;
  IF v_role IS NULL THEN
    INSERT INTO public.roles (company_id, name) VALUES (v_company, 'esc-test-role')
    RETURNING id INTO v_role;
    INSERT INTO public.user_roles (user_id, role_id, company_id)
    VALUES (v_actor, v_role, v_company) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role, p.id FROM public.permissions p
  WHERE p.key IN ('project.edit', 'project.view')
  ON CONFLICT DO NOTHING;

  -- A project the actor must NOT see, owned by someone else, with a project file.
  INSERT INTO public.projects (company_id, name, status, created_by)
  VALUES (v_company, 'SECRET Engagement '||substr(md5(random()::text),1,6), 'active',
          (SELECT id FROM public.users WHERE company_id = v_company AND id <> v_actor LIMIT 1))
  RETURNING id INTO v_secret_project;

  INSERT INTO public.filehub_folders (company_id, name, scope, project_id, created_by)
  VALUES (v_company, 'Secret Deliverable', 'project', v_secret_project,
          (SELECT created_by FROM public.projects WHERE id = v_secret_project))
  RETURNING id INTO v_folder;

  INSERT INTO public.filehub_files (company_id, original_name, storage_path, visibility,
                                    project_id, folder_id, uploaded_by, size_bytes, mime_type)
  VALUES (v_company, 'secret_workpapers.xlsx', 'x/secret.xlsx', 'project',
          v_secret_project, v_folder,
          (SELECT created_by FROM public.projects WHERE id = v_secret_project), 1, 'application/vnd.ms-excel')
  RETURNING id INTO v_file;

  -- A project the actor DOES own.
  INSERT INTO public.projects (company_id, name, status, created_by, owner_id)
  VALUES (v_company, 'My Engagement '||substr(md5(random()::text),1,6), 'active', v_actor, v_actor)
  RETURNING id INTO v_my_project;

  -- Become the actor.
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_can_see_secret := public.fn_project_accessible(v_secret_project);
  RAISE NOTICE 'actor can see the secret project directly? %  (expect false)', v_can_see_secret;

  SELECT count(*) INTO v_files_before FROM public.filehub_files WHERE id = v_file;
  RAISE NOTICE 'secret files visible BEFORE: %  (expect 0)', v_files_before;

  -- THE ATTACK: claim my project was rolled forward from the secret one.
  UPDATE public.projects
     SET rolled_forward_from_project_id = v_secret_project
   WHERE id = v_my_project;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'attacker UPDATE affected % row(s)  (0 = blocked by RLS)', v_updated;

  SELECT count(*) INTO v_files_after FROM public.filehub_files WHERE id = v_file;
  RAISE NOTICE 'secret files visible AFTER:  %  (expect 0; 1 = ESCALATION)', v_files_after;

  IF v_files_after > v_files_before THEN
    RAISE WARNING 'ESCALATION CONFIRMED: project.edit + a forged rolled_forward_from_project_id grants read on another project''s files';
  ELSE
    RAISE NOTICE 'no escalation via this path';
  END IF;
END $$;
ROLLBACK;

-- Expected result AFTER 20260802_rollforward_link_guard.sql:
--   the attacker UPDATE raises
--   "projects.rolled_forward_from_project_id may only be set by
--    rpc_rollforward_project (it grants read access to the source project's files)."
--
-- BEFORE the guard this script printed:
--   secret files visible AFTER: 1  -> ESCALATION CONFIRMED
--
-- So a clean run of this file is an ERROR, not a NOTICE. If it ever completes
-- without raising, the guard has regressed and file disclosure is live again.
