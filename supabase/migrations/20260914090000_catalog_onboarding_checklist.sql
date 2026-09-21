-- Issue #414: workspace readiness copy is a published catalog snapshot.
-- WelcomeTour remains a separate user-level lifecycle and is intentionally not
-- represented here.

-- Older development databases carried narrower catalog checks. Widen those
-- checks before publishing the first checklist entry so the migration is
-- replay-safe on both the current schema and those databases.
DO $constraints$
BEGIN
  ALTER TABLE public.platform_catalog_entries
    DROP CONSTRAINT IF EXISTS platform_catalog_entries_kind_check,
    DROP CONSTRAINT IF EXISTS platform_catalog_entries_classification_check,
    DROP CONSTRAINT IF EXISTS platform_catalog_entries_owner_scope_check;
END;
$constraints$;

ALTER TABLE public.platform_catalog_entries
  ADD CONSTRAINT platform_catalog_entries_kind_check
    CHECK (kind = btrim(kind) AND kind <> ''),
  ADD CONSTRAINT platform_catalog_entries_classification_check
    CHECK (classification = btrim(classification) AND classification <> ''),
  ADD CONSTRAINT platform_catalog_entries_owner_scope_check
    CHECK (owner_scope = ANY (ARRAY['platform', 'company', 'user', 'onboarding']));

DO $catalog$
DECLARE
  v_payload jsonb := $workspace_ready_payload${
    "schema_version": 1,
    "checklist_key": "workspace-ready",
    "items": [
      {"key":"owner_access","title":"Owner access","description":"You have full administrative access to this workspace."},
      {"key":"main_workflow","title":"Main Workflow","description":"A ready-to-edit task pipeline was added for your team."},
      {"key":"filehub_defaults","title":"File Hub defaults","description":"Standard system folders are available when you open File Hub."}
    ]
  }$workspace_ready_payload$::jsonb;
  v_existing public.platform_catalog_entries%rowtype;
BEGIN
  SELECT * INTO v_existing
    FROM public.platform_catalog_entries
   WHERE catalog_key = 'onboarding_checklist.workspace-ready'
     AND version = 1;

  IF v_existing.catalog_key IS NULL THEN
    INSERT INTO public.platform_catalog_entries (
      catalog_key, version, kind, owner_scope, classification,
      permission_boundary, customization_policy, update_policy,
      cloneable, editable, replaceable, existing_companies_affected,
      payload, content_hash, baseline_hash, publication_state, retired_at,
      lifecycle_state, published_at
    ) VALUES (
      'onboarding_checklist.workspace-ready', 1, 'onboarding_checklist',
      'platform', 'one_time_onboarding_choice', 'authenticated-company-member',
      'read-only-selection', 'append-only-explicit-upgrade',
      false, false, false, false, v_payload, '', '', 'published', NULL,
      'published', now()
    );
  ELSIF v_existing.payload <> v_payload THEN
    RAISE EXCEPTION 'onboarding checklist v1 replay differs; refusing overwrite';
  END IF;

  INSERT INTO public.platform_catalog_heads (
    catalog_key, recommended_version, published_version
  ) VALUES ('onboarding_checklist.workspace-ready', 1, 1)
  ON CONFLICT (catalog_key) DO NOTHING;
END;
$catalog$;

COMMENT ON TABLE public.platform_catalog_entries IS
  'Immutable semantic platform defaults and templates catalog. Company resources are recorded in company_catalog_installations.';
