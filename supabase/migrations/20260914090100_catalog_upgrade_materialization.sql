-- Issue #414: explicit catalog adoption creates real company-owned copies.
-- The public upgrade RPC is the transaction boundary. The private helpers keep
-- each resource type's row-writing rules in one place for future consumers.

ALTER TABLE public.project_templates
  ADD COLUMN IF NOT EXISTS catalog_key text,
  ADD COLUMN IF NOT EXISTS catalog_version integer,
  ADD COLUMN IF NOT EXISTS baseline_hash text,
  ADD COLUMN IF NOT EXISTS is_platform_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_templates_company_catalog_version
  ON public.project_templates (company_id, catalog_key, catalog_version)
  WHERE catalog_key IS NOT NULL AND catalog_version IS NOT NULL AND deleted_at IS NULL;

-- Provenance is immutable after materialization, except for repairing a
-- legacy ledger row that was created with an empty reference object before a
-- writer completed. Fresh databases do not have this trigger yet; older
-- development databases may already have its stricter version.
DO $install_guard$
BEGIN
  IF to_regprocedure('public._company_catalog_installations_before_update()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public._company_catalog_installations_before_update()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog
      AS $body$
      BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.company_id IS DISTINCT FROM OLD.company_id
           OR NEW.catalog_key IS DISTINCT FROM OLD.catalog_key
           OR NEW.catalog_version IS DISTINCT FROM OLD.catalog_version
           OR NEW.baseline_hash IS DISTINCT FROM OLD.baseline_hash
           OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
           OR NEW.installed_at IS DISTINCT FROM OLD.installed_at THEN
          RAISE EXCEPTION 'catalog installation provenance is immutable';
        END IF;
        IF OLD.materialized_refs = '{}'::jsonb
           AND NEW.materialized_refs <> '{}'::jsonb
           AND NEW.materialized_references = NEW.materialized_refs THEN
          RETURN NEW;
        END IF;
        IF NEW.materialized_refs IS DISTINCT FROM OLD.materialized_refs
           OR NEW.materialized_references IS DISTINCT FROM OLD.materialized_references THEN
          RAISE EXCEPTION 'catalog installation provenance is immutable';
        END IF;
        IF NEW.state = OLD.state THEN RETURN NEW; END IF;
        IF OLD.state = 'installed' AND NEW.state = 'customized' THEN
          NEW.customized_at := now();
          RETURN NEW;
        ELSIF OLD.state IN ('installed', 'customized') AND NEW.state = 'replaced' THEN
          NEW.customized_at := OLD.customized_at;
          RETURN NEW;
        ELSIF OLD.state IN ('installed', 'customized') AND NEW.state = 'archived' THEN
          NEW.customized_at := OLD.customized_at;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'invalid catalog installation lifecycle transition % -> %', OLD.state, NEW.state;
      END;
      $body$;
    $fn$;
  ELSE
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public._company_catalog_installations_before_update()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog
      AS $body$
      BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.company_id IS DISTINCT FROM OLD.company_id
           OR NEW.catalog_key IS DISTINCT FROM OLD.catalog_key
           OR NEW.catalog_version IS DISTINCT FROM OLD.catalog_version
           OR NEW.baseline_hash IS DISTINCT FROM OLD.baseline_hash
           OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
           OR NEW.installed_at IS DISTINCT FROM OLD.installed_at THEN
          RAISE EXCEPTION 'catalog installation provenance is immutable';
        END IF;
        IF OLD.materialized_refs = '{}'::jsonb
           AND NEW.materialized_refs <> '{}'::jsonb
           AND NEW.materialized_references = NEW.materialized_refs THEN
          RETURN NEW;
        END IF;
        IF NEW.materialized_refs IS DISTINCT FROM OLD.materialized_refs
           OR NEW.materialized_references IS DISTINCT FROM OLD.materialized_references THEN
          RAISE EXCEPTION 'catalog installation provenance is immutable';
        END IF;
        IF NEW.state = OLD.state THEN RETURN NEW; END IF;
        IF OLD.state = 'installed' AND NEW.state = 'customized' THEN
          NEW.customized_at := now();
          RETURN NEW;
        ELSIF OLD.state IN ('installed', 'customized') AND NEW.state = 'replaced' THEN
          NEW.customized_at := OLD.customized_at;
          RETURN NEW;
        ELSIF OLD.state IN ('installed', 'customized') AND NEW.state = 'archived' THEN
          NEW.customized_at := OLD.customized_at;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'invalid catalog installation lifecycle transition % -> %', OLD.state, NEW.state;
      END;
      $body$;
    $fn$;
  END IF;
END;
$install_guard$;

DROP TRIGGER IF EXISTS trg_company_catalog_installations_before_update
  ON public.company_catalog_installations;
CREATE TRIGGER trg_company_catalog_installations_before_update
  BEFORE UPDATE ON public.company_catalog_installations
  FOR EACH ROW EXECUTE FUNCTION public._company_catalog_installations_before_update();

CREATE OR REPLACE FUNCTION public.rpc_create_catalog_starter_template(
  p_catalog_key text,
  p_catalog_version integer DEFAULT NULL
)
RETURNS public.project_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_entry public.platform_catalog_entries%rowtype;
  v_company_id uuid := public.my_company_id();
  v_user_id uuid := auth.uid();
  v_template public.project_templates;
BEGIN
  IF v_company_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  SELECT e.* INTO v_entry
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h
      ON h.catalog_key = e.catalog_key
     AND h.published_version = e.version
   WHERE e.catalog_key = p_catalog_key
     AND (p_catalog_version IS NULL OR e.version = p_catalog_version)
     AND e.kind = 'project_template'
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project template catalog entry is not published';
  END IF;

  SELECT * INTO v_template
    FROM public.rpc_create_starter_template(
      v_entry.payload->>'name', v_entry.payload->>'description',
      v_entry.payload->>'color', v_entry.payload->'tasks'
    );

  UPDATE public.project_templates
     SET catalog_key = v_entry.catalog_key,
         catalog_version = v_entry.version,
         baseline_hash = v_entry.content_hash,
         is_platform_default = true
   WHERE id = v_template.id
   RETURNING * INTO v_template;

  PERFORM public.fn_record_company_catalog_installation(
    v_company_id, v_entry.catalog_key, v_entry.version,
    jsonb_build_object('template_id', v_template.id, 'starter_id', v_entry.payload->>'id'),
    'starter-picker', v_user_id
  );
  RETURN v_template;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_create_catalog_starter_template(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_catalog_starter_template(text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_catalog_entry_for_version(
  p_catalog_key text,
  p_version integer
)
RETURNS public.platform_catalog_entries
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_entry public.platform_catalog_entries;
BEGIN
  SELECT e.* INTO v_entry
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h
      ON h.catalog_key = e.catalog_key
     AND h.published_version = e.version
   WHERE e.catalog_key = p_catalog_key
     AND e.version = p_version
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published'
     AND e.published_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog version is not published';
  END IF;
  RETURN v_entry;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_materialize_catalog_roles(
  p_company_id uuid,
  p_created_by uuid,
  p_catalog_key text,
  p_version integer,
  p_name_suffix text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_entry public.platform_catalog_entries;
  v_role jsonb;
  v_role_id uuid;
  v_name text;
  v_suffix text := COALESCE(NULLIF(btrim(p_name_suffix), ''), 'Catalog v' || p_version);
  v_role_ids jsonb := '{}'::jsonb;
BEGIN
  v_entry := public.fn_catalog_entry_for_version(p_catalog_key, p_version);
  IF v_entry.kind <> 'role_bundle' THEN
    RAISE EXCEPTION 'catalog entry is not a role bundle';
  END IF;

  FOR v_role IN SELECT value FROM jsonb_array_elements(v_entry.payload->'roles') AS item(value)
  LOOP
    v_name := btrim(v_role->>'name') || ' (' || v_suffix || ')';
    SELECT r.id INTO v_role_id
      FROM public.roles r
     WHERE r.company_id = p_company_id
       AND lower(r.name) = lower(v_name)
       AND r.deleted_at IS NULL
     ORDER BY r.created_at
     LIMIT 1;

    IF v_role_id IS NULL THEN
      INSERT INTO public.roles (
        company_id, name, description, color, is_system, is_default, created_by
      ) VALUES (
        p_company_id, v_name, v_role->>'description', v_role->>'color',
        false, false, p_created_by
      ) RETURNING id INTO v_role_id;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(v_role->'permission_keys') AS required(key)
       WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = required.key)
    ) THEN
      RAISE EXCEPTION 'role bundle references an unknown permission';
    END IF;

    INSERT INTO public.role_permissions (role_id, permission_id, granted_by)
    SELECT v_role_id, p.id, p_created_by
      FROM public.permissions p
     WHERE p.key IN (SELECT value FROM jsonb_array_elements_text(v_role->'permission_keys'))
    ON CONFLICT DO NOTHING;

    v_role_ids := v_role_ids || jsonb_build_object(v_role->>'name', v_role_id);
    v_role_id := NULL;
  END LOOP;

  RETURN jsonb_build_object('role_ids', v_role_ids, 'catalog_version', p_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_materialize_catalog_pipeline(
  p_company_id uuid,
  p_created_by uuid,
  p_catalog_key text,
  p_version integer,
  p_name_suffix text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_entry public.platform_catalog_entries;
  v_pipeline_id uuid;
  v_stage_id uuid;
  v_transition_id uuid;
  v_stage_ids jsonb := '{}'::jsonb;
  v_stage jsonb;
  v_transition jsonb;
  v_action jsonb;
  v_name text;
BEGIN
  v_entry := public.fn_catalog_entry_for_version(p_catalog_key, p_version);
  IF v_entry.kind <> 'task_workflow' THEN
    RAISE EXCEPTION 'catalog entry is not a task workflow';
  END IF;
  v_name := btrim(v_entry.payload->>'name') || COALESCE(' (' || NULLIF(btrim(p_name_suffix), '') || ')', '');

  SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
   WHERE p.company_id = p_company_id
     AND p.name = v_name
     AND p.deleted_at IS NULL
   ORDER BY p.created_at
   LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    INSERT INTO public.pipelines (
      company_id, name, description, is_default, created_by,
      visibility_permissions, subject_kind
    ) VALUES (
      p_company_id, v_name, v_entry.payload->>'description',
      p_name_suffix IS NULL AND COALESCE((v_entry.payload->>'is_default')::boolean, false),
      p_created_by,
      '{}', 'task'
    ) RETURNING id INTO v_pipeline_id;

    FOR v_stage IN SELECT value FROM jsonb_array_elements(v_entry.payload->'stages') AS item(value)
    LOOP
      INSERT INTO public.pipeline_stages (
        pipeline_id, name, color, position, is_initial, is_terminal,
        terminal_type, requires_submission, submission_mode
      ) VALUES (
        v_pipeline_id, v_stage->>'name', v_stage->>'color', (v_stage->>'position')::integer,
        COALESCE((v_stage->>'is_initial')::boolean, false),
        COALESCE((v_stage->>'is_terminal')::boolean, false),
        v_stage->>'terminal_type', COALESCE((v_stage->>'requires_submission')::boolean, false),
        COALESCE(v_stage->>'submission_mode', 'none')
      ) RETURNING id INTO v_stage_id;
      v_stage_ids := v_stage_ids || jsonb_build_object(v_stage->>'key', v_stage_id);
    END LOOP;

    FOR v_transition IN SELECT value FROM jsonb_array_elements(v_entry.payload->'transitions') AS item(value)
    LOOP
      INSERT INTO public.pipeline_stage_transitions (
        from_stage_id, to_stage_id, label, transition_type
      ) VALUES (
        (v_stage_ids->>(v_transition->>'from'))::uuid,
        (v_stage_ids->>(v_transition->>'to'))::uuid,
        v_transition->>'label', (v_transition->>'transition_type')::transition_outcome_type
      ) RETURNING id INTO v_transition_id;
    END LOOP;

    FOR v_action IN SELECT value FROM jsonb_array_elements(v_entry.payload->'actions') AS item(value)
    LOOP
      SELECT t.id INTO v_transition_id
        FROM public.pipeline_stage_transitions t
       WHERE t.from_stage_id = (v_stage_ids->>(v_action->>'from'))::uuid
         AND t.to_stage_id = (v_stage_ids->>(v_action->>'to'))::uuid;
      INSERT INTO public.pipeline_stage_actions (
        stage_id, action_type, label, style, required_role, position,
        is_active, transition_id
      ) VALUES (
        (v_stage_ids->>(v_action->>'from'))::uuid, v_action->>'action_type',
        v_action->>'label', v_action->>'style', v_action->>'required_role',
        COALESCE((v_action->>'position')::integer, 0), true, v_transition_id
      );
    END LOOP;
  ELSE
    FOR v_stage IN SELECT value FROM jsonb_array_elements(v_entry.payload->'stages') AS item(value)
    LOOP
      SELECT ps.id INTO v_stage_id
        FROM public.pipeline_stages ps
       WHERE ps.pipeline_id = v_pipeline_id
         AND ps.name = v_stage->>'name'
       ORDER BY ps.position
       LIMIT 1;
      v_stage_ids := v_stage_ids || jsonb_build_object(v_stage->>'key', v_stage_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('pipeline_id', v_pipeline_id, 'stage_ids', v_stage_ids, 'catalog_version', p_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_materialize_catalog_notification_rules(
  p_company_id uuid,
  p_created_by uuid,
  p_catalog_key text,
  p_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_entry public.platform_catalog_entries;
  v_rule jsonb;
  v_event_types jsonb := '[]'::jsonb;
  v_rule_ids jsonb := '[]'::jsonb;
BEGIN
  v_entry := public.fn_catalog_entry_for_version(p_catalog_key, p_version);
  IF v_entry.kind <> 'notification_rule_set' THEN
    RAISE EXCEPTION 'catalog entry is not a notification rule set';
  END IF;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(v_entry.payload->'rules') AS item(value)
  LOOP
    INSERT INTO public.notification_rules (
      company_id, name, description, event_type, conditions,
      recipient_strategies, recipient_config, is_active, created_by,
      catalog_key, catalog_version, baseline_hash, is_platform_default
    ) VALUES (
      p_company_id, v_rule->>'name', v_rule->>'description', v_rule->>'event_type',
      COALESCE(v_rule->'conditions', '{}'::jsonb),
      ARRAY(SELECT jsonb_array_elements_text(v_rule->'recipient_strategies')),
      COALESCE(v_rule->'recipient_config', '{}'::jsonb),
      COALESCE((v_rule->>'is_active')::boolean, true), p_created_by,
      p_catalog_key, p_version, v_entry.content_hash, true
    ) ON CONFLICT DO NOTHING;
    v_event_types := v_event_types || jsonb_build_array(v_rule->>'event_type');
  END LOOP;

  SELECT COALESCE(jsonb_agg(r.id ORDER BY r.event_type), '[]'::jsonb)
    INTO v_rule_ids
    FROM public.notification_rules r
   WHERE r.company_id = p_company_id
     AND r.catalog_key = p_catalog_key
     AND r.catalog_version = p_version;
  RETURN jsonb_build_object('rule_ids', v_rule_ids, 'event_types', v_event_types, 'catalog_version', p_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_materialize_catalog_filehub_folders(
  p_company_id uuid,
  p_created_by uuid,
  p_catalog_key text,
  p_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_entry public.platform_catalog_entries;
  v_folder jsonb;
  v_folder_id uuid;
  v_folders jsonb := '{}'::jsonb;
BEGIN
  v_entry := public.fn_catalog_entry_for_version(p_catalog_key, p_version);
  IF v_entry.kind <> 'filehub_system_folder' THEN
    RAISE EXCEPTION 'catalog entry is not a FileHub system-folder set';
  END IF;

  FOR v_folder IN SELECT value FROM jsonb_array_elements(v_entry.payload->'folders') AS item(value)
  LOOP
    v_folder_id := public.rpc_filehub_folder_create(
      v_folder->>'name', NULL, v_folder->>'scope', NULL, NULL
    );
    v_folders := v_folders || jsonb_build_object(v_folder->>'key', v_folder_id);
  END LOOP;
  RETURN jsonb_build_object('folder_ids', v_folders, 'catalog_version', p_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_adopt_platform_catalog_version(
  p_catalog_key text,
  p_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_company_id uuid := public.my_company_id();
  v_user_id uuid := auth.uid();
  v_entry public.platform_catalog_entries;
  v_existing public.company_catalog_installations%rowtype;
  v_refs jsonb;
  v_installation_id uuid;
  v_created_by uuid := auth.uid();
BEGIN
  IF v_company_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.id = v_user_id
       AND u.company_id = v_company_id
       AND (u.is_owner OR public.has_permission('company.settings'))
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('catalog-adopt:' || v_company_id::text || ':' || p_catalog_key, 414));
  v_entry := public.fn_catalog_entry_for_version(p_catalog_key, p_version);

  SELECT * INTO v_existing
    FROM public.company_catalog_installations i
   WHERE i.company_id = v_company_id
     AND i.catalog_key = p_catalog_key
     AND i.catalog_version = p_version
   FOR UPDATE;
  IF FOUND AND jsonb_typeof(v_existing.materialized_refs) = 'object'
     AND v_existing.materialized_refs <> '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'installation_id', v_existing.id,
      'catalog_key', p_catalog_key,
      'catalog_version', p_version,
      'materialized_refs', v_existing.materialized_refs,
      'replayed', true
    );
  END IF;

  CASE v_entry.kind
    WHEN 'role_bundle' THEN
      v_refs := public.fn_materialize_catalog_roles(v_company_id, v_created_by, p_catalog_key, p_version, 'Catalog v' || p_version);
    WHEN 'task_workflow' THEN
      v_refs := public.fn_materialize_catalog_pipeline(v_company_id, v_created_by, p_catalog_key, p_version, 'Catalog v' || p_version);
    WHEN 'project_template' THEN
      SELECT to_jsonb(t) INTO v_refs
        FROM public.rpc_create_catalog_starter_template(p_catalog_key, p_version) t;
      v_refs := jsonb_build_object(
        'template_id', v_refs->>'id',
        'starter_id', v_entry.payload->>'id'
      );
    WHEN 'notification_rule_set' THEN
      v_refs := public.fn_materialize_catalog_notification_rules(v_company_id, v_created_by, p_catalog_key, p_version);
    WHEN 'filehub_system_folder' THEN
      v_refs := public.fn_materialize_catalog_filehub_folders(v_company_id, v_created_by, p_catalog_key, p_version);
    WHEN 'onboarding_checklist' THEN
      v_refs := jsonb_build_object(
        'checklist_key', COALESCE(v_entry.payload->>'checklist_key', p_catalog_key),
        'item_count', jsonb_array_length(v_entry.payload->'items'),
        'catalog_version', p_version
      );
    ELSE
      RAISE EXCEPTION 'catalog kind % has no adoption materializer', v_entry.kind;
  END CASE;

  IF v_refs IS NULL OR jsonb_typeof(v_refs) <> 'object' OR v_refs = '{}'::jsonb THEN
    RAISE EXCEPTION 'catalog adoption produced empty materialized references';
  END IF;

  -- The starter adapter records its own provenance while it calls the
  -- established starter writer. Re-read that row before finalizing the
  -- coordinator result so the same transaction updates it instead of racing
  -- its unique key.
  IF v_existing.id IS NULL THEN
    SELECT * INTO v_existing
      FROM public.company_catalog_installations i
     WHERE i.company_id = v_company_id
       AND i.catalog_key = p_catalog_key
       AND i.catalog_version = p_version
     FOR UPDATE;
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.company_catalog_installations (
      company_id, catalog_key, catalog_version, baseline_hash,
      idempotency_key, materialized_refs, materialized_references,
      creation_path, selected_by
    ) VALUES (
      v_company_id, p_catalog_key, p_version, v_entry.content_hash,
      'catalog-upgrade:' || p_catalog_key || ':v' || p_version,
      v_refs, v_refs, 'explicit-catalog-upgrade', v_user_id
    ) RETURNING id INTO v_installation_id;
  ELSE
    UPDATE public.company_catalog_installations
       SET materialized_refs = v_refs,
           materialized_references = v_refs,
           baseline_hash = v_entry.content_hash,
           creation_path = 'explicit-catalog-upgrade',
           selected_by = COALESCE(selected_by, v_user_id),
           updated_at = now()
     WHERE id = v_existing.id
     RETURNING id INTO v_installation_id;
  END IF;

  RETURN jsonb_build_object(
    'installation_id', v_installation_id,
    'catalog_key', p_catalog_key,
    'catalog_version', p_version,
    'materialized_refs', v_refs,
    'replayed', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_install_platform_catalog_upgrade(
  p_catalog_key text,
  p_version integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.rpc_adopt_platform_catalog_version(p_catalog_key, p_version);
  RETURN (v_result->>'installation_id')::uuid;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_catalog_entry_for_version(text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_materialize_catalog_roles(uuid,uuid,text,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_materialize_catalog_pipeline(uuid,uuid,text,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_materialize_catalog_notification_rules(uuid,uuid,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_materialize_catalog_filehub_folders(uuid,uuid,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_adopt_platform_catalog_version(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_adopt_platform_catalog_version(text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_install_platform_catalog_upgrade(text,integer) TO authenticated;
