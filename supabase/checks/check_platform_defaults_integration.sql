-- Issue #414: end-to-end catalog contract.
BEGIN;

DO $check$
DECLARE
  v_expected text[] := ARRAY[
    'filehub_system_folders.standard',
    'notification_rules.standard',
    'onboarding_checklist.workspace-ready',
    'onboarding_preset.manifest',
    'onboarding_preset.overlay.client_delivery',
    'onboarding_preset.overlay.governed_regulatory',
    'onboarding_preset.overlay.internal_operations',
    'onboarding_preset.overlay.portfolio_intake',
    'onboarding_preset.overlay.product_development',
    'onboarding_preset.size.growing',
    'onboarding_preset.size.scaling',
    'onboarding_preset.size.small',
    'onboarding_preset.size.solo',
    'project_template.agency-campaign-launch',
    'project_template.business-tax-return',
    'project_template.civil-litigation-matter',
    'project_template.commercial-construction-project',
    'project_template.corporate-event-production',
    'project_template.hiring-pipeline',
    'project_template.medical-billing-revenue-cycle',
    'project_template.monthly-bookkeeping-close',
    'project_template.new-product-introduction',
    'project_template.product-release-launch',
    'project_template.property-claim-handling',
    'project_template.residential-purchase-transaction',
    'project_template.statutory-audit',
    'roles_permissions',
    'task_workflow.standard'
  ];
  v_actual text[];
BEGIN
  SELECT array_agg(e.catalog_key ORDER BY e.catalog_key)
    INTO v_actual
    FROM public.platform_catalog_entries e
   WHERE e.version = 1;
  ASSERT v_actual = v_expected,
    format('catalog keys differ; expected %s, got %s', v_expected, v_actual);
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.platform_catalog_entries e
     WHERE e.publication_state <> 'published'
        OR e.lifecycle_state <> 'published'
        OR NOT EXISTS (
          SELECT 1
            FROM public.platform_catalog_heads h
           WHERE h.catalog_key = e.catalog_key
             AND h.published_version >= e.version
        )
  ), 'catalog contains an unpublished catalog entry';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.platform_catalog_entries e
     WHERE public._catalog_payload_has_uuid(e.payload)
        OR e.payload::text ~ 'company_id|pipeline_id|stage_id|team_id|channel_id|group_id|user_id|assignee_team_id'
  ), 'platform catalog contains tenant-specific identifiers';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.platform_catalog_entries e
     WHERE e.catalog_key <> 'onboarding_checklist.workspace-ready'
       AND e.kind <> 'onboarding_preset'
       AND (e.owner_scope <> 'platform'
        OR e.classification <> 'platform_curated_default'
        OR e.permission_boundary NOT IN ('platform', 'company')
        OR e.customization_policy NOT IN ('clone-to-company', 'lazy-company-materialization')
        OR e.update_policy <> 'append-only-explicit-upgrade'
        OR e.editable
        OR e.replaceable
        OR e.existing_companies_affected)
  ), 'catalog metadata violates the no-silent-rewrite policy';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.platform_catalog_entries e
     WHERE e.kind = 'onboarding_preset'
       AND (e.owner_scope <> 'onboarding'
        OR e.classification <> 'one_time_onboarding_choice'
        OR e.permission_boundary <> 'authenticated-company-member'
        OR e.customization_policy <> 'immutable-company-snapshot'
        OR e.update_policy <> 'append-only-explicit-upgrade'
        OR e.cloneable
        OR e.editable
        OR e.replaceable
        OR e.existing_companies_affected)
  ), 'onboarding preset metadata violates the one-time choice policy';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.platform_catalog_entries e
     WHERE e.catalog_key = 'onboarding_checklist.workspace-ready'
       AND (e.owner_scope <> 'platform'
         OR e.classification <> 'one_time_onboarding_choice'
         OR e.permission_boundary <> 'authenticated-company-member'
         OR e.customization_policy <> 'read-only-selection'
         OR e.update_policy <> 'append-only-explicit-upgrade'
         OR e.cloneable
         OR e.editable
         OR e.replaceable
         OR e.existing_companies_affected)
  ), 'onboarding checklist metadata violates the one-time choice policy';
  ASSERT to_regprocedure('public.rpc_instantiate_template(uuid,jsonb,jsonb,jsonb,text,uuid)') IS NOT NULL,
    'bulk template instantiation writer was removed';
  ASSERT to_regprocedure('public.rpc_create_starter_template(text,text,text,jsonb)') IS NOT NULL,
    'starter-template materialization writer was removed';
  ASSERT to_regprocedure('public.rpc_create_catalog_starter_template(text,integer)') IS NOT NULL,
    'catalog starter adapter is missing';
  ASSERT to_regprocedure('public.rpc_create_catalog_pipeline(text,integer,text,text,boolean)') IS NOT NULL,
    'catalog pipeline adapter is missing';
  ASSERT to_regprocedure('public.rpc_filehub_get_system_folder(text,text,uuid)') IS NOT NULL,
    'lazy FileHub system-folder adapter is missing';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.platform_catalog_entries e
     WHERE e.catalog_key = 'filehub_system_folders.standard'
       AND (e.payload ? 'channels' OR e.payload ? 'groups')
  ), 'FileHub catalog unexpectedly seeds channels/groups';
  RAISE NOTICE 'check_platform_defaults_integration: contract passed';
END;
$check$;

ROLLBACK;
