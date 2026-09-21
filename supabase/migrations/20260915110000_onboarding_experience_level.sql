-- Task 2: persist the onboarding experience level in immutable snapshots.
-- This is append-only after 20260914110500; existing rows and catalog
-- installations are intentionally not backfilled or rewritten.

CREATE OR REPLACE FUNCTION public.fn_onboarding_normalize_answers(p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_size_band text := COALESCE(p_answers->>'size_band', p_answers->>'sizeBand');
  v_models_json jsonb := COALESCE(p_answers->'operating_models', p_answers->'operatingModels');
  v_models text[];
  v_models_sorted text[];
  v_experience_level text := COALESCE(p_answers->>'experience_level', p_answers->>'experienceLevel', 'guided');
  v_gates text := COALESCE(p_answers->>'gates', p_answers->>'gate_preference');
  v_time text := COALESCE(p_answers->>'time_tracking', p_answers->>'timeTracking');
  v_files text := p_answers->>'files';
  v_repeating text := COALESCE(p_answers->>'repeating_work', p_answers->>'repeatingWork', 'rare');
  v_manifest jsonb;
  v_needs_gates boolean;
  v_needs_time boolean;
  v_needs_files boolean;
BEGIN
  IF v_size_band IS NULL OR v_size_band NOT IN ('solo', 'small', 'growing', 'scaling') THEN
    RAISE EXCEPTION 'Choose a valid team size';
  END IF;
  IF v_models_json IS NULL OR jsonb_typeof(v_models_json) <> 'array' THEN
    RAISE EXCEPTION 'Choose at least one work type';
  END IF;
  v_models := ARRAY(SELECT value FROM jsonb_array_elements_text(v_models_json));
  IF cardinality(v_models) = 0 OR cardinality(v_models) <> (SELECT count(DISTINCT value) FROM unnest(v_models) AS item(value)) THEN
    RAISE EXCEPTION 'Choose at least one distinct work type';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_models) AS item(value) WHERE value NOT IN ('client_delivery', 'internal_operations', 'product_development', 'portfolio_intake', 'governed_regulatory')) THEN
    RAISE EXCEPTION 'Choose valid work types';
  END IF;
  IF v_experience_level NOT IN ('guided', 'full_control') THEN
    RAISE EXCEPTION 'Choose a valid experience level';
  END IF;

  v_models_sorted := ARRAY(
    SELECT value
      FROM unnest(v_models) AS item(value)
     ORDER BY CASE value
       WHEN 'client_delivery' THEN 1
       WHEN 'internal_operations' THEN 2
       WHEN 'product_development' THEN 3
       WHEN 'portfolio_intake' THEN 4
       WHEN 'governed_regulatory' THEN 5
       ELSE 99
     END
  );

  SELECT e.payload INTO v_manifest
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h
      ON h.catalog_key = e.catalog_key AND h.published_version = e.version
   WHERE e.catalog_key = 'onboarding_preset.manifest'
     AND e.kind = 'onboarding_preset'
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published'
     AND e.published_at IS NOT NULL;
  IF v_manifest IS NULL THEN RAISE EXCEPTION 'Published onboarding manifest is unavailable'; END IF;

  v_needs_gates := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manifest->'questions') AS item(question)
    CROSS JOIN LATERAL jsonb_array_elements_text(item.question->'visible_when'->'values') AS allowed(value)
    WHERE item.question->>'key' = 'gates' AND item.question->'visible_when'->>'answer' = 'operating_models' AND allowed.value = ANY(v_models)
  );
  v_needs_time := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manifest->'questions') AS item(question)
    CROSS JOIN LATERAL jsonb_array_elements_text(item.question->'visible_when'->'values') AS allowed(value)
    WHERE item.question->>'key' = 'time_tracking' AND item.question->'visible_when'->>'answer' = 'operating_models' AND allowed.value = ANY(v_models)
  );
  v_needs_files := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manifest->'questions') AS item(question)
    CROSS JOIN LATERAL jsonb_array_elements_text(item.question->'visible_when'->'values') AS allowed(value)
    WHERE item.question->>'key' = 'files' AND item.question->'visible_when'->>'answer' = 'operating_models' AND allowed.value = ANY(v_models)
  );
  IF v_needs_gates AND (v_gates IS NULL OR v_gates NOT IN ('none', 'light', 'formal')) THEN RAISE EXCEPTION 'Choose a valid approval preference'; END IF;
  IF v_needs_time AND (v_time IS NULL OR v_time NOT IN ('off', 'optional', 'required')) THEN RAISE EXCEPTION 'Choose a valid time-tracking preference'; END IF;
  IF v_needs_files AND (v_files IS NULL OR v_files NOT IN ('light', 'centralized', 'governed')) THEN RAISE EXCEPTION 'Choose a valid file-sharing preference'; END IF;
  IF v_repeating NOT IN ('rare', 'sometimes', 'frequent') THEN RAISE EXCEPTION 'Choose a valid repeating-work preference'; END IF;

  RETURN jsonb_build_object(
    'size_band', v_size_band,
    'operating_models', to_jsonb(v_models_sorted),
    'experience_level', v_experience_level,
    'gates', CASE WHEN v_needs_gates THEN to_jsonb(v_gates) ELSE to_jsonb('none'::text) END,
    'time_tracking', CASE WHEN v_needs_time THEN to_jsonb(v_time) ELSE to_jsonb('off'::text) END,
    'files', CASE WHEN v_needs_files THEN to_jsonb(v_files) ELSE to_jsonb('light'::text) END,
    'repeating_work', to_jsonb(v_repeating)
  );
END;
$function$;

-- Preserve the existing writer and signature; only add the normalized answer
-- to the resolved snapshot payload.
CREATE OR REPLACE FUNCTION public.fn_apply_onboarding_preset(
  p_company_id uuid, p_user_id uuid, p_answers jsonb, p_idempotency_key uuid, p_creation_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_answers jsonb;
  v_size_band text;
  v_models text[];
  v_keys jsonb := '[]'::jsonb;
  v_versions jsonb := '[]'::jsonb;
  v_recommendations jsonb := jsonb_build_object('workflow','[]'::jsonb,'gates','[]'::jsonb,'time','[]'::jsonb,'files','[]'::jsonb,'repeating_work','[]'::jsonb,'tutorial_topics','[]'::jsonb);
  v_guarantees jsonb := jsonb_build_object('admin','[]'::jsonb,'member','[]'::jsonb,'tutorial_topics','[]'::jsonb);
  v_safe_defaults jsonb := '{}'::jsonb;
  v_deferred jsonb := '[]'::jsonb;
  v_entry public.platform_catalog_entries%rowtype;
  v_key text;
  v_profile_id uuid;
  v_revision integer;
  v_applied jsonb;
  v_resolved jsonb;
  v_index integer := 0;
  v_existing public.company_onboarding_profiles%rowtype;
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL OR p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Company, user, and idempotency key are required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding-profile:' || p_company_id::text, 414));
  SELECT * INTO v_existing FROM public.company_onboarding_profiles p WHERE p.company_id = p_company_id AND p.idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN public.fn_onboarding_profile_result(v_existing.id); END IF;
  v_answers := public.fn_onboarding_normalize_answers(p_answers);
  v_size_band := v_answers->>'size_band';
  v_models := ARRAY(SELECT value FROM jsonb_array_elements_text(v_answers->'operating_models'));
  v_keys := v_keys || jsonb_build_array('onboarding_preset.size.' || v_size_band);
  FOR v_key IN SELECT value FROM unnest(v_models) AS item(value) LOOP v_keys := v_keys || jsonb_build_array('onboarding_preset.overlay.' || v_key); END LOOP;
  FOR v_key IN SELECT value FROM jsonb_array_elements_text(v_keys) LOOP
    SELECT e.* INTO v_entry
      FROM public.platform_catalog_entries e
      JOIN public.platform_catalog_heads h ON h.catalog_key = e.catalog_key AND h.published_version = e.version
     WHERE e.catalog_key = v_key AND e.kind = 'onboarding_preset' AND e.publication_state = 'published' AND e.lifecycle_state = 'published' AND e.published_at IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected onboarding preset is not published: %', v_key; END IF;
    v_versions := v_versions || jsonb_build_array(jsonb_build_object('catalog_key', v_entry.catalog_key, 'version', v_entry.version, 'role', CASE WHEN v_entry.payload->>'preset_type' = 'size_band' THEN 'size_band' ELSE 'operating_model_overlay' END));
    v_recommendations := jsonb_set(v_recommendations, '{workflow}', v_recommendations->'workflow' || COALESCE(v_entry.payload->'recommendations'->'workflow', '[]'::jsonb));
    v_recommendations := jsonb_set(v_recommendations, '{gates}', v_recommendations->'gates' || COALESCE(v_entry.payload->'recommendations'->'gates', '[]'::jsonb));
    v_recommendations := jsonb_set(v_recommendations, '{time}', v_recommendations->'time' || COALESCE(v_entry.payload->'recommendations'->'time', '[]'::jsonb));
    v_recommendations := jsonb_set(v_recommendations, '{files}', v_recommendations->'files' || COALESCE(v_entry.payload->'recommendations'->'files', '[]'::jsonb));
    v_recommendations := jsonb_set(v_recommendations, '{repeating_work}', v_recommendations->'repeating_work' || COALESCE(v_entry.payload->'recommendations'->'repeating_work', '[]'::jsonb));
    v_recommendations := jsonb_set(v_recommendations, '{tutorial_topics}', v_recommendations->'tutorial_topics' || COALESCE(v_entry.payload->'recommendations'->'tutorial_topics', '[]'::jsonb));
    v_guarantees := jsonb_set(v_guarantees, '{admin}', v_guarantees->'admin' || COALESCE(v_entry.payload->'guarantees'->'admin', '[]'::jsonb));
    v_guarantees := jsonb_set(v_guarantees, '{member}', v_guarantees->'member' || COALESCE(v_entry.payload->'guarantees'->'member', '[]'::jsonb));
    v_guarantees := jsonb_set(v_guarantees, '{tutorial_topics}', v_guarantees->'tutorial_topics' || COALESCE(v_entry.payload->'guarantees'->'tutorial_topics', '[]'::jsonb));
    v_safe_defaults := v_safe_defaults || COALESCE(v_entry.payload->'safe_defaults'->'feature_settings', '{}'::jsonb);
    v_deferred := v_deferred || COALESCE(v_entry.payload->'deferred', '[]'::jsonb);
  END LOOP;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('installation_id', i.id, 'catalog_key', i.catalog_key, 'catalog_version', i.catalog_version, 'materialized_references', i.materialized_references) ORDER BY i.catalog_key), '[]'::jsonb) INTO v_applied
    FROM public.company_catalog_installations i WHERE i.company_id = p_company_id AND i.state IN ('installed', 'customized');
  v_resolved := jsonb_build_object('creation_path', p_creation_path, 'size_band', v_size_band, 'experience_level', v_answers->>'experience_level', 'operating_models', to_jsonb(v_models), 'selected_catalog_keys', v_keys, 'selected_catalog_versions', v_versions, 'recommendations', v_recommendations, 'guarantees', v_guarantees, 'safe_defaults', v_safe_defaults, 'deferred', v_deferred);
  SELECT COALESCE(max(p.revision), 0) + 1 INTO v_revision FROM public.company_onboarding_profiles p WHERE p.company_id = p_company_id;
  INSERT INTO public.company_onboarding_profiles (company_id, revision, size_band, operating_models, answers, resolved_profile, applied_catalog_installations, idempotency_key, completed_by)
  VALUES (p_company_id, v_revision, v_size_band, v_models, v_answers, v_resolved, v_applied, p_idempotency_key, p_user_id) RETURNING id INTO v_profile_id;
  FOR v_key IN SELECT value FROM jsonb_array_elements_text(v_keys) LOOP
    v_index := v_index + 1;
    SELECT (item->>'version')::integer INTO v_revision FROM jsonb_array_elements(v_versions) AS item WHERE item->>'catalog_key' = v_key;
    INSERT INTO public.company_onboarding_profile_catalog_entries (profile_id, catalog_key, catalog_version, catalog_role, ordinal)
    VALUES (v_profile_id, v_key, v_revision, CASE WHEN v_key LIKE 'onboarding_preset.size.%' THEN 'size_band' ELSE 'operating_model_overlay' END, v_index);
  END LOOP;
  RETURN public.fn_onboarding_profile_result(v_profile_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_onboarding_normalize_answers(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_apply_onboarding_preset(uuid,uuid,jsonb,uuid,text) FROM PUBLIC, anon, authenticated;
