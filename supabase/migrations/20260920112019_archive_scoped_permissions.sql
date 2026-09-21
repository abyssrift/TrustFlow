-- Issue #431: preserve live task/project access at archive time and enforce it
-- at every Cold Storage database boundary.

INSERT INTO public.permissions (key, label, description, category) VALUES
  ('archive.view_all', 'View All Cold Storage Archives',
   'With archive.view, view every archived item in the caller company regardless of archive principals.', 'archives'),
  ('archive.restore_all', 'Restore All Cold Storage Archives',
   'With archive.restore, restore every archived item in the caller company regardless of archive principals.', 'archives')
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    category = EXCLUDED.category;

-- Publish an additive role catalog snapshot so future company bootstrap grants
-- both scoped modifiers to its catalog Admin and Owner roles. Catalog entries
-- are immutable; v1 remains untouched.
DO $catalog$
DECLARE
  v_v1 public.platform_catalog_entries%ROWTYPE;
  v_v2_payload jsonb;
  v_existing_payload jsonb;
BEGIN
  SELECT e.* INTO v_v1
  FROM public.platform_catalog_entries e
  WHERE e.catalog_key = 'roles_permissions'
    AND e.version = 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'roles_permissions catalog v1 is required';
  END IF;

  SELECT jsonb_set(
           v_v1.payload,
           '{roles}',
           jsonb_agg(
             CASE
               WHEN role_item.value->>'name' IN ('Admin', 'Owner') THEN
                 jsonb_set(
                   role_item.value,
                   '{permission_keys}',
                   (role_item.value->'permission_keys')
                     || '["archive.view_all","archive.restore_all"]'::jsonb
                 )
               ELSE role_item.value
             END
             ORDER BY role_item.ordinality
           )
         )
    INTO v_v2_payload
  FROM jsonb_array_elements(v_v1.payload->'roles')
       WITH ORDINALITY AS role_item(value, ordinality);

  SELECT e.payload INTO v_existing_payload
  FROM public.platform_catalog_entries e
  WHERE e.catalog_key = 'roles_permissions'
    AND e.version = 2;

  IF FOUND THEN
    IF v_existing_payload <> v_v2_payload THEN
      RAISE EXCEPTION 'roles_permissions catalog v2 already has a different payload';
    END IF;
  ELSE
    INSERT INTO public.platform_catalog_entries (
      catalog_key, version, kind, owner_scope, classification,
      permission_boundary, customization_policy, update_policy,
      cloneable, editable, replaceable, existing_companies_affected,
      payload, content_hash, baseline_hash, publication_state, retired_at,
      lifecycle_state, materialized_references, creation_path, published_at
    ) VALUES (
      v_v1.catalog_key, 2, v_v1.kind, v_v1.owner_scope, v_v1.classification,
      v_v1.permission_boundary, v_v1.customization_policy, v_v1.update_policy,
      v_v1.cloneable, v_v1.editable, v_v1.replaceable, true,
      v_v2_payload, '', '', 'published', NULL,
      'published', '{}'::jsonb, 'migration', now()
    );
  END IF;

  UPDATE public.platform_catalog_heads
  SET recommended_version = 2,
      published_version = 2,
      updated_at = now()
  WHERE catalog_key = 'roles_permissions';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'roles_permissions catalog head is required';
  END IF;
END;
$catalog$;

-- Keep broad modifiers elevated by default. Grant existing true system roles
-- and only the exact Admin/Owner role IDs recorded by catalog materialization;
-- never grant by a custom role's display name. The base archive.view or
-- archive.restore permission remains independently required as a kill switch.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.key IN ('archive.view_all', 'archive.restore_all')
WHERE r.is_system = true
  AND r.name IN ('Owner', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.company_catalog_installations i
CROSS JOIN LATERAL jsonb_each_text(
  COALESCE(i.materialized_refs->'role_ids', '{}'::jsonb)
) AS catalog_role(role_name, role_id)
JOIN public.roles r
  ON r.id::text = catalog_role.role_id
 AND r.company_id = i.company_id
 AND r.deleted_at IS NULL
JOIN public.permissions p
  ON p.key IN ('archive.view_all', 'archive.restore_all')
WHERE i.catalog_key = 'roles_permissions'
  AND catalog_role.role_name IN ('Admin', 'Owner')
ON CONFLICT DO NOTHING;

CREATE TABLE public.archive_access_principals (
  archive_id uuid NOT NULL REFERENCES public.archives(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT archive_access_principals_exactly_one
    CHECK (((user_id IS NOT NULL)::integer + (team_id IS NOT NULL)::integer) = 1)
);

CREATE UNIQUE INDEX archive_access_principals_archive_user_uidx
  ON public.archive_access_principals (archive_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX archive_access_principals_archive_team_uidx
  ON public.archive_access_principals (archive_id, team_id)
  WHERE team_id IS NOT NULL;
CREATE INDEX archive_access_principals_company_idx
  ON public.archive_access_principals (company_id, archive_id);

ALTER TABLE public.archive_access_principals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.archive_access_principals FROM PUBLIC, anon, authenticated;

-- Internal extractor used both by the insert trigger and the one-time backfill.
-- IDs are joined as text rather than cast from historical JSON so malformed old
-- metadata is ignored conservatively instead of aborting the migration.
CREATE OR REPLACE FUNCTION public.fn_capture_archive_access(p_archive_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_archive public.archives%ROWTYPE;
BEGIN
  SELECT a.* INTO v_archive
  FROM public.archives a
  WHERE a.id = p_archive_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.archive_access_principals (archive_id, company_id, user_id)
  SELECT v_archive.id, v_archive.company_id, u.id
  FROM public.users u
  WHERE u.id = v_archive.archived_by
    AND u.company_id = v_archive.company_id
  ON CONFLICT DO NOTHING;

  -- Task creator/manager and project creator/owner are immutable in snapshots.
  INSERT INTO public.archive_access_principals (archive_id, company_id, user_id)
  SELECT v_archive.id, v_archive.company_id, u.id
  FROM public.users u
  WHERE u.company_id = v_archive.company_id
    AND u.id::text IN (
      v_archive.snapshot->'task'->>'created_by',
      v_archive.snapshot->'task'->>'manager_id',
      v_archive.snapshot->'project'->>'created_by',
      v_archive.snapshot->'project'->>'owner_id'
    )
  ON CONFLICT DO NOTHING;

  -- Historical involved users are provable participants recorded by the
  -- archive writer (assignees, commenters, submitters, and project children).
  INSERT INTO public.archive_access_principals (archive_id, company_id, user_id)
  SELECT v_archive.id, v_archive.company_id, u.id
  FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(v_archive.metadata->'involved_user_ids') = 'array'
              THEN v_archive.metadata->'involved_user_ids' ELSE '[]'::jsonb END
       ) involved(user_id)
  JOIN public.users u
    ON u.id::text = involved.user_id
   AND u.company_id = v_archive.company_id
  ON CONFLICT DO NOTHING;

  -- Task snapshots retain the authoritative relational assignments, including
  -- assigned teams that cannot be represented by involved_user_ids.
  IF v_archive.entity_type = 'task' THEN
    INSERT INTO public.archive_access_principals (archive_id, company_id, user_id)
    SELECT v_archive.id, v_archive.company_id, u.id
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(v_archive.snapshot->'assignments') = 'array'
                THEN v_archive.snapshot->'assignments' ELSE '[]'::jsonb END
         ) assignment
    JOIN public.users u
      ON u.id::text = assignment->>'assignee_user_id'
     AND u.company_id = v_archive.company_id
    ON CONFLICT DO NOTHING;

    INSERT INTO public.archive_access_principals (archive_id, company_id, team_id)
    SELECT v_archive.id, v_archive.company_id, t.id
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(v_archive.snapshot->'assignments') = 'array'
                THEN v_archive.snapshot->'assignments' ELSE '[]'::jsonb END
         ) assignment
    JOIN public.teams t
      ON t.id::text = assignment->>'assignee_team_id'
     AND t.company_id = v_archive.company_id
    ON CONFLICT DO NOTHING;

    -- A task archived from a project remains available to that project's owner.
    INSERT INTO public.archive_access_principals (archive_id, company_id, user_id)
    SELECT v_archive.id, v_archive.company_id, u.id
    FROM public.projects p
    JOIN public.users u ON u.id = p.owner_id AND u.company_id = p.company_id
    WHERE p.id::text = v_archive.snapshot->'task'->>'project_id'
      AND p.company_id = v_archive.company_id
    ON CONFLICT DO NOTHING;
  END IF;

  -- Project archives are inserted after their task archives. Derive child
  -- direct/team assignments from those immutable snapshots while they are in
  -- the same transaction; the same query safely backfills older projects.
  IF v_archive.entity_type = 'project' THEN
    INSERT INTO public.archive_access_principals (archive_id, company_id, user_id)
    SELECT v_archive.id, v_archive.company_id, u.id
    FROM public.archives child
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(child.snapshot->'assignments') = 'array'
           THEN child.snapshot->'assignments' ELSE '[]'::jsonb END
    ) assignment
    JOIN public.users u
      ON u.id::text = assignment->>'assignee_user_id'
     AND u.company_id = v_archive.company_id
    WHERE child.company_id = v_archive.company_id
      AND child.entity_type = 'task'
      AND child.snapshot->'task'->>'project_id' = v_archive.entity_id::text
    ON CONFLICT DO NOTHING;

    INSERT INTO public.archive_access_principals (archive_id, company_id, team_id)
    SELECT v_archive.id, v_archive.company_id, t.id
    FROM public.archives child
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(child.snapshot->'assignments') = 'array'
           THEN child.snapshot->'assignments' ELSE '[]'::jsonb END
    ) assignment
    JOIN public.teams t
      ON t.id::text = assignment->>'assignee_team_id'
     AND t.company_id = v_archive.company_id
    WHERE child.company_id = v_archive.company_id
      AND child.entity_type = 'task'
      AND child.snapshot->'task'->>'project_id' = v_archive.entity_id::text
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_capture_archive_access(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_capture_archive_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.fn_capture_archive_access(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_capture_archive_access() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_archives_capture_access
AFTER INSERT ON public.archives
FOR EACH ROW EXECUTE FUNCTION public.trg_capture_archive_access();

-- Conservative backfill: no company-wide row is manufactured. Archives whose
-- old snapshots prove only archived_by retain only that principal.
SELECT public.fn_capture_archive_access(a.id)
FROM public.archives a;

CREATE OR REPLACE FUNCTION public.fn_archive_accessible(
  p_archive_id uuid,
  p_action text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid;
BEGIN
  IF v_uid IS NULL OR p_action NOT IN ('view', 'restore', 'purge') THEN
    RETURN false;
  END IF;

  SELECT u.company_id INTO v_company_id
  FROM public.users u
  WHERE u.id = v_uid
    AND u.deleted_at IS NULL
    AND u.is_active = true;

  IF v_company_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.archives a
    WHERE a.id = p_archive_id AND a.company_id = v_company_id
  ) THEN
    RETURN false;
  END IF;

  IF p_action = 'view' THEN
    IF NOT public.has_permission('archive.view') THEN RETURN false; END IF;
    IF public.has_permission('archive.view_all') THEN RETURN true; END IF;
  ELSIF p_action = 'restore' THEN
    IF NOT public.has_permission('archive.restore') THEN RETURN false; END IF;
    IF public.has_permission('archive.restore_all') THEN RETURN true; END IF;
  ELSE
    RETURN public.has_permission('archive.delete')
       AND public.has_permission('archive.view_all');
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.archive_access_principals ap
    WHERE ap.archive_id = p_archive_id
      AND ap.company_id = v_company_id
      AND (
        ap.user_id = v_uid
        OR ap.team_id IN (
          SELECT tm.team_id
          FROM public.team_members tm
          WHERE tm.user_id = v_uid AND tm.removed_at IS NULL
        )
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_archive_accessible(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_archive_accessible(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "Archives are viewable by company members" ON public.archives;
DROP POLICY IF EXISTS "Archives can be created by company members" ON public.archives;
DROP POLICY IF EXISTS archives_select_scoped ON public.archives;
CREATE POLICY archives_select_scoped ON public.archives
FOR SELECT TO authenticated
USING (public.fn_archive_accessible(id, 'view'));

REVOKE ALL ON TABLE public.archives FROM anon, authenticated;
GRANT SELECT ON TABLE public.archives TO authenticated;

-- Archive creation remains behind the existing RPC authorization, with no raw
-- client insert path and no inherited PUBLIC execution. Preserve the deployed
-- bodies' own search_path settings: changing an existing definer body to an
-- empty path is unsafe without checking its effective pg_get_functiondef().
REVOKE ALL ON FUNCTION public.rpc_archive_task(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_archive_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_archive_task(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_archive_project(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_get_archives(
  p_entity_type text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS SETOF public.archives
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.*
  FROM public.archives a
  WHERE public.fn_archive_accessible(a.id, 'view')
    AND (p_entity_type IS NULL OR a.entity_type = p_entity_type)
    AND (p_search IS NULL OR (
      a.search_vector @@ websearch_to_tsquery('english', p_search)
      OR a.metadata->>'title' ILIKE '%' || p_search || '%'
    ))
  ORDER BY a.archived_at DESC;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_archives(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_archives(text, text) TO authenticated;

-- The internal task rebuilder bypasses RLS by design and must never be a public
-- endpoint. Only the validated wrappers execute it as their definer owner.
REVOKE ALL ON FUNCTION public._internal_restore_task_archive(uuid)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_restore_archive(p_archive_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task_id uuid;
BEGIN
  IF NOT public.fn_archive_accessible(p_archive_id, 'restore') THEN
    RAISE EXCEPTION 'Archive not found or unauthorized.' USING ERRCODE = '42501';
  END IF;

  SELECT (a.snapshot->'task'->>'id')::uuid INTO v_task_id
  FROM public.archives a
  WHERE a.id = p_archive_id
    AND a.entity_type = 'task'
    AND a.restored_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Archive not found, already restored, or unauthorized.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = v_task_id) THEN
    RAISE EXCEPTION 'A task with this ID already exists in the active pipeline.';
  END IF;

  RETURN public._internal_restore_task_archive(p_archive_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_restore_archive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_restore_archive(uuid) TO authenticated;

-- Preserve the mature project reconstruction implementation behind a sealed
-- internal name; the public wrapper below owns all caller authorization.
ALTER FUNCTION public.rpc_restore_project(uuid)
  RENAME TO _internal_restore_project_archive;
REVOKE ALL ON FUNCTION public._internal_restore_project_archive(uuid)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_restore_project(p_archive_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.fn_archive_accessible(p_archive_id, 'restore')
     OR NOT EXISTS (
       SELECT 1 FROM public.archives a
       WHERE a.id = p_archive_id
         AND a.entity_type = 'project'
         AND a.restored_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Archive not found, already restored, or unauthorized.' USING ERRCODE = '42501';
  END IF;

  RETURN public._internal_restore_project_archive(p_archive_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_restore_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_restore_project(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_purge_archives(p_archive_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid := public.my_company_id();
  v_requested integer;
  v_count integer;
BEGIN
  IF v_company_id IS NULL OR p_archive_ids IS NULL OR cardinality(p_archive_ids) = 0 THEN
    RAISE EXCEPTION 'Archive selection is required.' USING ERRCODE = '42501';
  END IF;

  SELECT count(DISTINCT requested.id) INTO v_requested
  FROM unnest(p_archive_ids) requested(id);

  IF v_requested <> (
    SELECT count(*)
    FROM public.archives a
    WHERE a.id = ANY(p_archive_ids)
      AND public.fn_archive_accessible(a.id, 'purge')
  ) THEN
    RAISE EXCEPTION 'Archive not found or unauthorized.' USING ERRCODE = '42501';
  END IF;

  WITH deleted AS (
    DELETE FROM public.archives a
    WHERE a.id = ANY(p_archive_ids)
      AND public.fn_archive_accessible(a.id, 'purge')
    RETURNING a.id
  )
  SELECT count(*) INTO v_count FROM deleted;

  PERFORM public.log_event(
    v_company_id, auth.uid(), 'archive', NULL, 'archive.purged',
    jsonb_build_object('archive_ids', p_archive_ids, 'count', v_count)
  );

  RETURN jsonb_build_object('deleted_count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_purge_archives(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_purge_archives(uuid[]) TO authenticated;
