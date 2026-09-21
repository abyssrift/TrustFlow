-- Issue #414 Task 6: catalog metadata for FileHub's system folders.
--
-- FileHub channels remain company-created resources. The catalog deliberately
-- contains no channel rows and bootstrap creates no folders. These two roots
-- are materialized lazily by the existing folder writer when a feature first
-- needs them.

DO $catalog$
DECLARE
  v_payload jsonb := $filehub_payload${"schema_version":1,"kind":"filehub_system_folder","folders":[{"key":"portfolio_imports","name":"Portfolio Imports","scope":"broadcast"},{"key":"client_files","name":"Client Files","scope":"broadcast"}]}$filehub_payload$::jsonb;
  v_existing public.platform_catalog_entries%rowtype;
BEGIN
  SELECT * INTO v_existing
    FROM public.platform_catalog_entries
   WHERE catalog_key = 'filehub_system_folders.standard'
     AND version = 1;

  IF v_existing.catalog_key IS NULL THEN
    INSERT INTO public.platform_catalog_entries (
      catalog_key, version, kind, owner_scope, classification,
      permission_boundary, customization_policy, update_policy,
      cloneable, editable, replaceable, existing_companies_affected,
      payload, content_hash, baseline_hash, publication_state, retired_at,
      lifecycle_state, published_at
    ) VALUES (
      'filehub_system_folders.standard', 1, 'filehub_system_folder',
      'platform', 'platform_curated_default', 'company',
      'lazy-company-materialization', 'append-only-explicit-upgrade',
      true, false, false, false, v_payload, '', '', 'published', NULL,
      'published', now()
    );
  ELSIF v_existing.payload <> v_payload THEN
    RAISE EXCEPTION 'filehub_system_folders.standard v1 replay differs; refusing overwrite';
  END IF;

  INSERT INTO public.platform_catalog_heads (
    catalog_key, recommended_version, published_version
  ) VALUES ('filehub_system_folders.standard', 1, 1)
  ON CONFLICT (catalog_key) DO NOTHING;

  UPDATE public.platform_catalog_heads
     SET published_version = 1,
         updated_at = now()
   WHERE catalog_key = 'filehub_system_folders.standard'
     AND recommended_version = 1
     AND published_version IS NULL;
END;
$catalog$;

CREATE OR REPLACE FUNCTION public.rpc_filehub_get_system_folder(
  p_name TEXT,
  p_scope TEXT DEFAULT 'broadcast',
  p_group_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id UUID := auth.uid();
  v_entry public.platform_catalog_entries%rowtype;
  v_folder jsonb;
  v_folder_id UUID;
  v_name TEXT := trim(p_name);
  v_key TEXT;
BEGIN
  IF v_company_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF NOT public.has_permission('filehub:view') THEN
    RAISE EXCEPTION 'Insufficient permissions.';
  END IF;
  IF p_scope <> 'broadcast' OR p_group_id IS NOT NULL THEN
    RAISE EXCEPTION 'System folders are broadcast roots and cannot belong to a channel.';
  END IF;

  SELECT e.* INTO v_entry
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h
      ON h.catalog_key = e.catalog_key
     AND h.published_version = e.version
   WHERE e.catalog_key = 'filehub_system_folders.standard'
     AND e.kind = 'filehub_system_folder'
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FileHub system-folder catalog entry is not published';
  END IF;

  SELECT value, value->>'key'
    INTO v_folder, v_key
    FROM jsonb_array_elements(v_entry.payload->'folders') AS item(value)
   WHERE lower(value->>'name') = lower(v_name)
     AND value->>'scope' = p_scope;
  IF v_folder IS NULL THEN
    RAISE EXCEPTION 'Unknown FileHub system folder: %', p_name;
  END IF;

  -- The existing writer remains the only folder-row writer. Its latest
  -- project-aware signature is used explicitly; it performs a race-safe
  -- get-or-create against the live-folder unique indexes.
  v_folder_id := public.rpc_filehub_folder_create(
    v_folder->>'name', NULL, p_scope, NULL, NULL
  );

  -- Installation records provenance once. A later system-folder call is a
  -- no-op for the ledger as well as for the folder row.
  PERFORM public.fn_record_company_catalog_installation(
    v_company_id,
    v_entry.catalog_key,
    v_entry.version,
    jsonb_build_object('folder_key', v_key, 'folder_id', v_folder_id),
    'filehub-system-folder',
    v_user_id
  );
  RETURN v_folder_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_filehub_get_system_folder(TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_get_system_folder(TEXT, TEXT, UUID) TO authenticated;
