-- Issue #414: the workspace-ready checklist is catalog content, not UI-owned defaults.
BEGIN;

DO $check$
DECLARE
  v_entry jsonb;
  v_payload jsonb;
BEGIN
  SELECT public.rpc_resolve_published_catalog_entry('onboarding_checklist.workspace-ready', NULL)
    INTO v_entry;
  ASSERT v_entry IS NOT NULL, 'workspace-ready checklist is not published';
  ASSERT v_entry->>'kind' = 'onboarding_checklist', 'wrong checklist catalog kind';
  ASSERT v_entry->>'owner_scope' = 'platform', 'checklist owner must be platform';
  ASSERT v_entry->>'classification' = 'one_time_onboarding_choice', 'checklist classification is wrong';
  ASSERT v_entry->>'permission_boundary' = 'authenticated-company-member', 'checklist permission boundary is wrong';
  ASSERT (v_entry->>'editable')::boolean = false, 'platform checklist cannot be edited in place';
  ASSERT (v_entry->>'replaceable')::boolean = false, 'platform checklist cannot be replaced in place';

  v_payload := v_entry->'payload';
  ASSERT (v_payload->>'schema_version')::integer = 1, 'unsupported checklist schema';
  ASSERT jsonb_typeof(v_payload->'items') = 'array', 'checklist items must be an array';
  ASSERT jsonb_array_length(v_payload->'items') >= 3, 'workspace-ready checklist is incomplete';
  ASSERT NOT public._catalog_payload_has_uuid(v_payload), 'checklist contains tenant-specific UUIDs';
  ASSERT (v_payload->'items'->0->>'key') = 'owner_access', 'owner item must be first';
  ASSERT (v_payload->'items'->1->>'key') = 'main_workflow', 'workflow item must be second';
  ASSERT (v_payload->'items'->2->>'key') = 'filehub_defaults', 'FileHub item must be third';
  RAISE NOTICE 'check_catalog_onboarding_checklist: contract passed';
END;
$check$;

ROLLBACK;
