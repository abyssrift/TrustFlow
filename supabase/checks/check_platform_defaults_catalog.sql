-- Issue #414 Task 1: catalog foundation contract.
-- This check is intentionally written before the migration (RED phase).
BEGIN;

DO $check$
DECLARE
  v_entry uuid;
  v_hash text;
  v_payload jsonb;
  v_company uuid;
BEGIN
  ASSERT to_regclass('public.platform_default_catalog_entries') IS NOT NULL,
    'catalog entries table is missing';
  ASSERT to_regclass('public.platform_default_catalog_heads') IS NOT NULL,
    'catalog heads table is missing';
  ASSERT to_regclass('public.company_platform_default_installations') IS NOT NULL,
    'company installation ledger is missing';

  SELECT id, canonical_hash, payload
    INTO v_entry, v_hash, v_payload
    FROM public.platform_default_catalog_entries
   WHERE catalog_key = 'roles_permissions' AND version = 1;
  ASSERT v_entry IS NOT NULL, 'roles_permissions v1 seed is missing';
  ASSERT v_hash = encode(digest(v_payload::text, 'sha256'), 'hex'),
    'catalog hash is not the stable canonical payload hash';
  ASSERT v_payload::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',
    'catalog payload contains a UUID instead of semantic identifiers';
  ASSERT (SELECT count(*) FROM jsonb_array_elements(v_payload->'roles')) =
    (SELECT count(*) FROM public.roles WHERE company_id IS NULL AND is_system = true AND deleted_at IS NULL),
    'roles_permissions v1 does not contain exactly the current global roles';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.roles r
     WHERE r.company_id IS NULL AND r.is_system = true AND r.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_payload->'roles') role_json
          WHERE role_json->>'name' = r.name
            AND (role_json->'permission_keys') = COALESCE((
              SELECT jsonb_agg(p.key ORDER BY p.key)
                FROM public.role_permissions rp
                JOIN public.permissions p ON p.id = rp.permission_id
               WHERE rp.role_id = r.id
            ), '[]'::jsonb)
       )
  ), 'roles_permissions v1 permission keys drift from current global role data';

  ASSERT EXISTS (
    SELECT 1 FROM public.platform_default_catalog_heads
     WHERE catalog_key = 'roles_permissions' AND recommended_version = 1
  ), 'roles_permissions v1 is not the recommended head';
  ASSERT public.rpc_resolve_published_catalog_entry('roles_permissions') IS NOT NULL,
    'published catalog resolver returned no entry';

  BEGIN
    UPDATE public.platform_default_catalog_entries SET version = 2 WHERE id = v_entry;
    RAISE EXCEPTION 'immutable catalog update unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'catalog entries are immutable; append a new version instead' THEN
      RAISE;
    END IF;
  END;

  SELECT c.id INTO v_company FROM public.companies c LIMIT 1;
  INSERT INTO public.company_platform_default_installations
    (company_id, catalog_key, installed_version)
  VALUES (v_company, 'roles_permissions', 1)
  ON CONFLICT (company_id, catalog_key) DO NOTHING;
  ASSERT EXISTS (
    SELECT 1 FROM public.company_platform_default_installations
     WHERE company_id = v_company AND catalog_key = 'roles_permissions'
       AND installed_version = 1
  ), 'company installation ledger did not record a catalog installation';

  RAISE NOTICE 'check_platform_defaults_catalog: contract passed';
END;
$check$;

ROLLBACK;
