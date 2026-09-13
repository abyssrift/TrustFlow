-- Issue #414 Task 1: the database-owned platform defaults catalog.
-- Entries are append-only snapshots. Tenant installation state lives separately.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.platform_default_catalog_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_key     text NOT NULL CHECK (catalog_key = btrim(catalog_key) AND catalog_key <> ''),
  version         integer NOT NULL CHECK (version > 0),
  payload         jsonb NOT NULL CHECK (jsonb_typeof(payload) IN ('object', 'array')),
  canonical_hash  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_key, version),
  UNIQUE (catalog_key, canonical_hash)
);

CREATE TABLE IF NOT EXISTS public.platform_default_catalog_heads (
  catalog_key          text PRIMARY KEY,
  recommended_version  integer NOT NULL,
  published_version    integer,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (catalog_key, recommended_version)
    REFERENCES public.platform_default_catalog_entries (catalog_key, version),
  FOREIGN KEY (catalog_key, published_version)
    REFERENCES public.platform_default_catalog_entries (catalog_key, version)
);

CREATE TABLE IF NOT EXISTS public.company_platform_default_installations (
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  catalog_key      text NOT NULL,
  installed_version integer NOT NULL CHECK (installed_version > 0),
  installed_at     timestamptz NOT NULL DEFAULT now(),
  customized_at    timestamptz,
  PRIMARY KEY (company_id, catalog_key),
  FOREIGN KEY (catalog_key, installed_version)
    REFERENCES public.platform_default_catalog_entries (catalog_key, version)
);

CREATE INDEX IF NOT EXISTS idx_company_platform_default_installations_catalog
  ON public.company_platform_default_installations (catalog_key, installed_version);

CREATE OR REPLACE FUNCTION public._catalog_payload_has_uuid(p_value jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE jsonb_typeof(p_value)
    WHEN 'string' THEN p_value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    WHEN 'object' THEN EXISTS (
      SELECT 1 FROM jsonb_each(p_value) item
       WHERE public._catalog_payload_has_uuid(item.value)
    )
    WHEN 'array' THEN EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_value) item
     WHERE public._catalog_payload_has_uuid(item)
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public._catalog_entries_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public._catalog_payload_has_uuid(NEW.payload) THEN
    RAISE EXCEPTION 'catalog payloads may contain semantic identifiers only; UUID values are forbidden';
  END IF;

  NEW.canonical_hash := encode(digest(NEW.payload::text, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_catalog_entries_before_insert
  ON public.platform_default_catalog_entries;
CREATE TRIGGER trg_catalog_entries_before_insert
  BEFORE INSERT ON public.platform_default_catalog_entries
  FOR EACH ROW EXECUTE FUNCTION public._catalog_entries_before_insert();

CREATE OR REPLACE FUNCTION public._catalog_entries_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'catalog entries are immutable; append a new version instead';
END;
$$;

DROP TRIGGER IF EXISTS trg_catalog_entries_immutable
  ON public.platform_default_catalog_entries;
CREATE TRIGGER trg_catalog_entries_immutable
  BEFORE UPDATE OR DELETE ON public.platform_default_catalog_entries
  FOR EACH ROW EXECUTE FUNCTION public._catalog_entries_immutable();

CREATE OR REPLACE FUNCTION public.rpc_resolve_published_catalog_entry(p_catalog_key text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'catalog_key', e.catalog_key,
    'version', e.version,
    'payload', e.payload,
    'canonical_hash', e.canonical_hash
  )
    FROM public.platform_default_catalog_heads h
    JOIN public.platform_default_catalog_entries e
      ON e.catalog_key = h.catalog_key AND e.version = h.published_version
   WHERE h.catalog_key = p_catalog_key
     AND h.published_version IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.rpc_install_platform_default_catalog(
  p_catalog_key text,
  p_version integer DEFAULT NULL
)
RETURNS public.company_platform_default_installations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid := public.my_company_id();
  v_version integer;
  v_existing public.company_platform_default_installations%rowtype;
  v_result public.company_platform_default_installations%rowtype;
BEGIN
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'No company context'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.id = auth.uid() AND u.company_id = v_company_id AND u.is_owner = true
  ) AND NOT public.has_permission('company.settings') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COALESCE(p_version, h.recommended_version)
    INTO v_version
    FROM public.platform_default_catalog_heads h
   WHERE h.catalog_key = p_catalog_key;
  IF v_version IS NULL THEN RAISE EXCEPTION 'Unknown catalog key or no recommended version'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_default_catalog_heads h
     WHERE h.catalog_key = p_catalog_key AND h.published_version = v_version
  ) THEN
    RAISE EXCEPTION 'Catalog version is not published';
  END IF;

  SELECT * INTO v_existing
    FROM public.company_platform_default_installations
   WHERE company_id = v_company_id AND catalog_key = p_catalog_key;
  IF FOUND THEN
    IF v_existing.installed_version <> v_version THEN
      RAISE EXCEPTION 'Catalog already installed at version %, refusing silent overwrite', v_existing.installed_version;
    END IF;
    RETURN v_existing;
  END IF;

  INSERT INTO public.company_platform_default_installations (company_id, catalog_key, installed_version)
  VALUES (v_company_id, p_catalog_key, v_version)
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

-- The catalog is the only authority for published defaults. Direct table writes
-- are restricted; callers use the explicit resolver/install RPCs.
ALTER TABLE public.platform_default_catalog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_default_catalog_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_platform_default_installations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_catalog_entries_read ON public.platform_default_catalog_entries;
CREATE POLICY platform_catalog_entries_read ON public.platform_default_catalog_entries
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.platform_default_catalog_heads h
     WHERE h.catalog_key = catalog_key AND h.published_version = version
  ));

DROP POLICY IF EXISTS platform_catalog_heads_read ON public.platform_default_catalog_heads;
CREATE POLICY platform_catalog_heads_read ON public.platform_default_catalog_heads
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS company_catalog_installations_read ON public.company_platform_default_installations;
CREATE POLICY company_catalog_installations_read ON public.company_platform_default_installations
  FOR SELECT TO authenticated USING (company_id = public.my_company_id());

REVOKE ALL ON public.platform_default_catalog_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_default_catalog_heads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.company_platform_default_installations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.platform_default_catalog_entries TO authenticated;
GRANT SELECT ON public.platform_default_catalog_heads TO authenticated;
GRANT SELECT ON public.company_platform_default_installations TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_published_catalog_entry(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_install_platform_default_catalog(text, integer) TO authenticated;

-- v1 is a semantic snapshot of the current global roles and their permission
-- keys. UUIDs are deliberately resolved away at seed time.
DO $seed$
DECLARE
  v_payload jsonb;
BEGIN
  SELECT jsonb_build_object(
    'schema_version', 1,
    'roles', COALESCE(jsonb_agg(jsonb_build_object(
      'name', r.name,
      'description', r.description,
      'color', r.color,
      'is_default', r.is_default,
      'permission_keys', COALESCE((
        SELECT jsonb_agg(p.key ORDER BY p.key)
          FROM public.role_permissions rp
          JOIN public.permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = r.id
      ), '[]'::jsonb)
    ) ORDER BY r.name), '[]'::jsonb)
  ) INTO v_payload
  FROM public.roles r
  WHERE r.company_id IS NULL AND r.is_system = true AND r.deleted_at IS NULL;

  INSERT INTO public.platform_default_catalog_entries (catalog_key, version, payload)
  VALUES ('roles_permissions', 1, v_payload);

  INSERT INTO public.platform_default_catalog_heads (catalog_key, recommended_version, published_version)
  VALUES ('roles_permissions', 1, 1);
END;
$seed$;
