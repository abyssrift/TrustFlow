-- Manifest v2 adds catalog-owned visibility predicates for optional questions.
-- The v1 snapshot remains immutable; this migration publishes a new head so
-- existing companies and saved drafts are never rewritten in place.

DO $migration$
DECLARE
  v_v1 jsonb;
  v_payload jsonb;
  v_questions jsonb;
BEGIN
  SELECT payload
    INTO v_v1
    FROM public.platform_catalog_entries
   WHERE catalog_key = 'onboarding_preset.manifest'
     AND version = 1;

  IF v_v1 IS NULL THEN
    RAISE EXCEPTION 'onboarding_preset.manifest v1 is required before v2';
  END IF;

  SELECT jsonb_agg(
           CASE question->>'key'
             WHEN 'gates' THEN question || jsonb_build_object(
               'visible_when', jsonb_build_object('answer', 'operating_models', 'values', jsonb_build_array('client_delivery', 'governed_regulatory')))
             WHEN 'time_tracking' THEN question || jsonb_build_object(
               'visible_when', jsonb_build_object('answer', 'operating_models', 'values', jsonb_build_array('client_delivery', 'product_development', 'governed_regulatory')))
             WHEN 'files' THEN question || jsonb_build_object(
               'visible_when', jsonb_build_object('answer', 'operating_models', 'values', jsonb_build_array('client_delivery', 'portfolio_intake', 'governed_regulatory')))
             ELSE question
           END
           ORDER BY ordinality
         )
    INTO v_questions
    FROM jsonb_array_elements(v_v1->'questions') WITH ORDINALITY AS item(question, ordinality);

  v_payload := v_v1
    || jsonb_build_object('manifest_version', 2, 'questions', COALESCE(v_questions, '[]'::jsonb));

  INSERT INTO public.platform_catalog_entries (
    catalog_key, version, kind, owner_scope, classification,
    permission_boundary, customization_policy, update_policy,
    cloneable, editable, replaceable, existing_companies_affected,
    payload, content_hash, baseline_hash, publication_state,
    lifecycle_state, published_at
  ) VALUES (
    'onboarding_preset.manifest', 2, 'onboarding_preset', 'onboarding', 'one_time_onboarding_choice',
    'authenticated-company-member', 'immutable-company-snapshot', 'append-only-explicit-upgrade',
    false, false, false, false, v_payload, '', '', 'published', 'published', now()
  );

  INSERT INTO public.platform_catalog_heads (catalog_key, recommended_version, published_version)
  VALUES ('onboarding_preset.manifest', 2, 2)
  ON CONFLICT (catalog_key) DO UPDATE
    SET recommended_version = EXCLUDED.recommended_version,
        published_version = EXCLUDED.published_version,
        updated_at = now();
END;
$migration$;
