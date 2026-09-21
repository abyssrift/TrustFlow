-- Keep answer validation aligned with the published onboarding manifest.
-- The manifest owns conditional question visibility; this function must not
-- maintain a second list of operating-model branches.

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

  SELECT e.payload
    INTO v_manifest
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h
      ON h.catalog_key = e.catalog_key
     AND h.published_version = e.version
   WHERE e.catalog_key = 'onboarding_preset.manifest'
     AND e.kind = 'onboarding_preset'
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published'
     AND e.published_at IS NOT NULL;
  IF v_manifest IS NULL THEN
    RAISE EXCEPTION 'Published onboarding manifest is unavailable';
  END IF;

  v_needs_gates := EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_manifest->'questions') AS item(question)
      CROSS JOIN LATERAL jsonb_array_elements_text(item.question->'visible_when'->'values') AS allowed(value)
     WHERE item.question->>'key' = 'gates'
       AND item.question->'visible_when'->>'answer' = 'operating_models'
       AND allowed.value = ANY(v_models)
  );
  v_needs_time := EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_manifest->'questions') AS item(question)
      CROSS JOIN LATERAL jsonb_array_elements_text(item.question->'visible_when'->'values') AS allowed(value)
     WHERE item.question->>'key' = 'time_tracking'
       AND item.question->'visible_when'->>'answer' = 'operating_models'
       AND allowed.value = ANY(v_models)
  );
  v_needs_files := EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_manifest->'questions') AS item(question)
      CROSS JOIN LATERAL jsonb_array_elements_text(item.question->'visible_when'->'values') AS allowed(value)
     WHERE item.question->>'key' = 'files'
       AND item.question->'visible_when'->>'answer' = 'operating_models'
       AND allowed.value = ANY(v_models)
  );

  IF v_needs_gates AND (v_gates IS NULL OR v_gates NOT IN ('none', 'light', 'formal')) THEN RAISE EXCEPTION 'Choose a valid approval preference'; END IF;
  IF v_needs_time AND (v_time IS NULL OR v_time NOT IN ('off', 'optional', 'required')) THEN RAISE EXCEPTION 'Choose a valid time-tracking preference'; END IF;
  IF v_needs_files AND (v_files IS NULL OR v_files NOT IN ('light', 'centralized', 'governed')) THEN RAISE EXCEPTION 'Choose a valid file-sharing preference'; END IF;
  IF v_repeating NOT IN ('rare', 'sometimes', 'frequent') THEN RAISE EXCEPTION 'Choose a valid repeating-work preference'; END IF;

  RETURN jsonb_build_object(
    'size_band', v_size_band,
    'operating_models', to_jsonb(v_models_sorted),
    'gates', CASE WHEN v_needs_gates THEN to_jsonb(v_gates) ELSE to_jsonb('none'::text) END,
    'time_tracking', CASE WHEN v_needs_time THEN to_jsonb(v_time) ELSE to_jsonb('off'::text) END,
    'files', CASE WHEN v_needs_files THEN to_jsonb(v_files) ELSE to_jsonb('light'::text) END,
    'repeating_work', to_jsonb(v_repeating)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_onboarding_normalize_answers(jsonb) FROM PUBLIC, anon, authenticated;
