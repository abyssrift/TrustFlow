-- Issue #414 Task 1: the database-owned platform defaults catalog.
--
-- The catalog stores immutable, semantic platform snapshots. Company-specific
-- rows are recorded separately after a snapshot has been materialized. A
-- catalog version is never edited in place and installation never replaces a
-- previously installed company version.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.platform_catalog_entries (
  catalog_key                 text NOT NULL,
  version                     integer NOT NULL,
  kind                        text NOT NULL,
  owner_scope                 text NOT NULL DEFAULT 'platform',
  classification              text NOT NULL DEFAULT 'platform_curated_default',
  permission_boundary         text NOT NULL DEFAULT 'platform',
  customization_policy        text NOT NULL DEFAULT 'clone-to-company',
  update_policy               text NOT NULL DEFAULT 'append-only-explicit-upgrade',
  cloneable                   boolean NOT NULL DEFAULT true,
  editable                    boolean NOT NULL DEFAULT false,
  replaceable                 boolean NOT NULL DEFAULT false,
  existing_companies_affected boolean NOT NULL DEFAULT false,
  payload                     jsonb NOT NULL,
  content_hash                text NOT NULL,
  baseline_hash               text NOT NULL,
  publication_state           text NOT NULL DEFAULT 'published',
  retired_at                  timestamptz,
  lifecycle_state             text NOT NULL DEFAULT 'published',
  materialized_references     jsonb NOT NULL DEFAULT '{}'::jsonb,
  creation_path               text NOT NULL DEFAULT 'migration',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  published_at                timestamptz,
  CONSTRAINT platform_catalog_entries_key_check
    CHECK (catalog_key = btrim(catalog_key) AND catalog_key <> ''),
  CONSTRAINT platform_catalog_entries_version_check CHECK (version > 0),
  CONSTRAINT platform_catalog_entries_kind_check CHECK (kind <> btrim('')),
  CONSTRAINT platform_catalog_entries_payload_check
    CHECK (jsonb_typeof(payload) IN ('object', 'array')),
  CONSTRAINT platform_catalog_entries_lifecycle_check
    CHECK (lifecycle_state IN ('draft', 'published', 'retired')),
  CONSTRAINT platform_catalog_entries_owner_scope_check
    CHECK (owner_scope IN ('platform', 'company', 'user', 'onboarding')),
  PRIMARY KEY (catalog_key, version),
  UNIQUE (catalog_key, content_hash)
);

-- These ALTERs make a replay safe if an earlier development copy of this
-- migration created the same table with the smaller initial contract.
ALTER TABLE public.platform_catalog_entries
  ADD COLUMN IF NOT EXISTS owner_scope text NOT NULL DEFAULT 'platform',
  ADD COLUMN IF NOT EXISTS permission_boundary text NOT NULL DEFAULT 'platform',
  ADD COLUMN IF NOT EXISTS customization_policy text NOT NULL DEFAULT 'clone-to-company',
  ADD COLUMN IF NOT EXISTS update_policy text NOT NULL DEFAULT 'append-only-explicit-upgrade',
  ADD COLUMN IF NOT EXISTS cloneable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS editable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS replaceable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS existing_companies_affected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS baseline_hash text,
  ADD COLUMN IF NOT EXISTS publication_state text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS materialized_references jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS creation_path text NOT NULL DEFAULT 'migration',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

UPDATE public.platform_catalog_entries
   SET baseline_hash = content_hash
 WHERE baseline_hash IS NULL;

ALTER TABLE public.platform_catalog_entries
  ALTER COLUMN baseline_hash SET NOT NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_catalog_entries_key_check') THEN
    ALTER TABLE public.platform_catalog_entries
      ADD CONSTRAINT platform_catalog_entries_key_check
      CHECK (catalog_key = btrim(catalog_key) AND catalog_key <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_catalog_entries_version_check') THEN
    ALTER TABLE public.platform_catalog_entries
      ADD CONSTRAINT platform_catalog_entries_version_check CHECK (version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_catalog_entries_payload_check') THEN
    ALTER TABLE public.platform_catalog_entries
      ADD CONSTRAINT platform_catalog_entries_payload_check
      CHECK (jsonb_typeof(payload) IN ('object', 'array'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_catalog_entries_lifecycle_check') THEN
    ALTER TABLE public.platform_catalog_entries
      ADD CONSTRAINT platform_catalog_entries_lifecycle_check
      CHECK (lifecycle_state IN ('draft', 'published', 'retired'));
  END IF;
END;
$constraints$;

CREATE TABLE IF NOT EXISTS public.platform_catalog_heads (
  catalog_key         text PRIMARY KEY,
  recommended_version integer NOT NULL,
  published_version   integer,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_catalog_heads_recommended_fk
    FOREIGN KEY (catalog_key, recommended_version)
    REFERENCES public.platform_catalog_entries (catalog_key, version),
  CONSTRAINT platform_catalog_heads_published_fk
    FOREIGN KEY (catalog_key, published_version)
    REFERENCES public.platform_catalog_entries (catalog_key, version)
);

ALTER TABLE public.platform_catalog_heads
  ADD COLUMN IF NOT EXISTS published_version integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $head_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_catalog_heads_recommended_fk') THEN
    ALTER TABLE public.platform_catalog_heads
      ADD CONSTRAINT platform_catalog_heads_recommended_fk
      FOREIGN KEY (catalog_key, recommended_version)
      REFERENCES public.platform_catalog_entries (catalog_key, version);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_catalog_heads_published_fk') THEN
    ALTER TABLE public.platform_catalog_heads
      ADD CONSTRAINT platform_catalog_heads_published_fk
      FOREIGN KEY (catalog_key, published_version)
      REFERENCES public.platform_catalog_entries (catalog_key, version);
  END IF;
END;
$head_constraints$;

CREATE TABLE IF NOT EXISTS public.company_catalog_installations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  catalog_key                 text NOT NULL,
  catalog_version             integer NOT NULL,
  state                       text NOT NULL DEFAULT 'installed',
  baseline_hash               text NOT NULL,
  idempotency_key             text NOT NULL DEFAULT 'default',
  materialized_refs           jsonb NOT NULL DEFAULT '{}'::jsonb,
  materialized_references     jsonb NOT NULL DEFAULT '{}'::jsonb,
  creation_path               text NOT NULL DEFAULT 'rpc',
  selected_by                 uuid REFERENCES public.users(id) ON DELETE SET NULL,
  installed_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  customized_at               timestamptz,
  CONSTRAINT company_catalog_installations_version_check CHECK (catalog_version > 0),
  CONSTRAINT company_catalog_installations_state_check
    CHECK (state IN ('installed', 'customized', 'replaced', 'archived')),
  UNIQUE (company_id, catalog_key, catalog_version),
  CONSTRAINT company_catalog_installations_entry_fk
    FOREIGN KEY (catalog_key, catalog_version)
    REFERENCES public.platform_catalog_entries (catalog_key, version)
);

ALTER TABLE public.company_catalog_installations
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'installed',
  ADD COLUMN IF NOT EXISTS baseline_hash text,
  ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS materialized_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS materialized_references jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS creation_path text NOT NULL DEFAULT 'rpc',
  ADD COLUMN IF NOT EXISTS selected_by uuid,
  ADD COLUMN IF NOT EXISTS installed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS customized_at timestamptz;

UPDATE public.company_catalog_installations i
   SET baseline_hash = e.content_hash
  FROM public.platform_catalog_entries e
 WHERE e.catalog_key = i.catalog_key
   AND e.version = i.catalog_version
   AND i.baseline_hash IS NULL;

ALTER TABLE public.company_catalog_installations
  ALTER COLUMN baseline_hash SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_catalog_entries_key_version
  ON public.platform_catalog_entries (catalog_key, version DESC);
CREATE INDEX IF NOT EXISTS idx_company_catalog_installations_company_key
  ON public.company_catalog_installations (company_id, catalog_key);
CREATE INDEX IF NOT EXISTS idx_company_catalog_installations_key_version
  ON public.company_catalog_installations (catalog_key, catalog_version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_catalog_installations_unique_version
  ON public.company_catalog_installations (company_id, catalog_key, catalog_version);

CREATE OR REPLACE FUNCTION public._catalog_payload_has_uuid(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE jsonb_typeof(p_value)
    WHEN 'string' THEN p_value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    WHEN 'object' THEN EXISTS (
      SELECT 1
        FROM jsonb_each(p_value) item
       WHERE item.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR public._catalog_payload_has_uuid(item.value)
    )
    WHEN 'array' THEN EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p_value) item
       WHERE public._catalog_payload_has_uuid(item)
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_platform_catalog_entries_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_existing public.platform_catalog_entries%rowtype;
  v_max_version integer;
  v_hash text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'catalog entries are immutable; append a new version instead';
  END IF;

  IF NEW.catalog_key IS NULL OR NEW.catalog_key <> btrim(NEW.catalog_key) OR NEW.catalog_key = '' THEN
    RAISE EXCEPTION 'catalog key must be a non-empty trimmed semantic key';
  END IF;
  IF public._catalog_payload_has_uuid(NEW.payload) THEN
    RAISE EXCEPTION 'catalog payloads may contain semantic identifiers only; UUID keys and values are forbidden';
  END IF;

  v_hash := encode(extensions.digest(NEW.payload::text, 'sha256'), 'hex');
  SELECT * INTO v_existing
    FROM public.platform_catalog_entries e
   WHERE e.catalog_key = NEW.catalog_key
     AND e.version = NEW.version;

  -- Exact migration replay is a no-op. Reusing a version for a different
  -- payload is rejected and can never overwrite the existing snapshot.
  IF v_existing.catalog_key IS NOT NULL THEN
    IF v_existing.content_hash = v_hash AND v_existing.payload = NEW.payload THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'catalog version %, % already exists with a different payload', NEW.catalog_key, NEW.version;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.catalog_key, 414));
  SELECT max(e.version) INTO v_max_version
    FROM public.platform_catalog_entries e
   WHERE e.catalog_key = NEW.catalog_key;
  IF v_max_version IS NOT NULL AND NEW.version <= v_max_version THEN
    RAISE EXCEPTION 'catalog versions must increase monotonically (current %, got %)', v_max_version, NEW.version;
  END IF;

  NEW.content_hash := v_hash;
  NEW.baseline_hash := v_hash;
  IF NEW.lifecycle_state = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_catalog_entries_before_insert
  ON public.platform_catalog_entries;
DROP TRIGGER IF EXISTS trg_catalog_entries_before_update
  ON public.platform_catalog_entries;
DROP TRIGGER IF EXISTS trg_catalog_entries_before_delete
  ON public.platform_catalog_entries;
DROP TRIGGER IF EXISTS platform_catalog_entries_immutable_trg
  ON public.platform_catalog_entries;
CREATE TRIGGER platform_catalog_entries_immutable_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.platform_catalog_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_platform_catalog_entries_guard();

DROP FUNCTION IF EXISTS public.rpc_resolve_published_catalog_entry(text);
DROP FUNCTION IF EXISTS public.rpc_resolve_published_catalog_entry(text, integer);
DROP FUNCTION IF EXISTS public.rpc_resolve_platform_catalog(text, integer);
CREATE OR REPLACE FUNCTION public.rpc_resolve_platform_catalog(
  p_catalog_key text,
  p_version integer DEFAULT NULL
)
RETURNS TABLE (
  catalog_key text,
  version integer,
  kind text,
  owner_scope text,
  classification text,
  permission_boundary text,
  customization_policy text,
  update_policy text,
  cloneable boolean,
  editable boolean,
  replaceable boolean,
  existing_companies_affected boolean,
  payload jsonb,
  content_hash text,
  baseline_hash text,
  materialized_references jsonb,
  creation_path text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT e.catalog_key, e.version, e.kind, e.owner_scope, e.classification,
         e.permission_boundary, e.customization_policy, e.update_policy,
         e.cloneable, e.editable, e.replaceable,
         e.existing_companies_affected, e.payload, e.content_hash,
         e.baseline_hash, e.materialized_references, e.creation_path
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h
      ON h.catalog_key = e.catalog_key
     AND h.published_version = e.version
   WHERE e.catalog_key = p_catalog_key
     AND (p_version IS NULL OR e.version = p_version)
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published'
     AND e.published_at IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.rpc_resolve_published_catalog_entry(
  p_catalog_key text,
  p_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_entry jsonb;
BEGIN
  SELECT to_jsonb(e) INTO v_entry
    FROM public.rpc_resolve_platform_catalog(p_catalog_key, p_version) e;
  IF v_entry IS NULL THEN
    RAISE EXCEPTION 'catalog version is not published';
  END IF;
  RETURN v_entry;
END;
$function$;

DROP FUNCTION IF EXISTS public.rpc_install_platform_default_catalog(text, integer);
DROP FUNCTION IF EXISTS public.rpc_install_platform_default_catalog(text, integer, boolean);
DROP FUNCTION IF EXISTS public.rpc_install_platform_catalog_version(text, integer, boolean);
DROP FUNCTION IF EXISTS public.rpc_install_platform_catalog_upgrade(text, integer);
CREATE OR REPLACE FUNCTION public.rpc_install_platform_catalog_version(
  p_catalog_key text,
  p_version integer DEFAULT NULL,
  p_allow_parallel boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_company_id uuid := public.my_company_id();
  v_version integer;
  v_entry public.platform_catalog_entries%rowtype;
  v_existing public.company_catalog_installations%rowtype;
  v_id uuid;
BEGIN
  IF v_company_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.users u
     WHERE u.id = auth.uid()
       AND u.company_id = v_company_id
       AND (u.is_owner OR public.has_permission('company.settings'))
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':' || p_catalog_key, 414));

  SELECT e.* INTO v_entry
    FROM public.platform_catalog_entries e
    JOIN public.platform_catalog_heads h
      ON h.catalog_key = e.catalog_key
     AND h.published_version = e.version
   WHERE e.catalog_key = p_catalog_key
     AND (p_version IS NULL OR e.version = p_version)
     AND e.publication_state = 'published'
     AND e.lifecycle_state = 'published'
     AND e.published_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog version is not published';
  END IF;
  v_version := v_entry.version;

  SELECT * INTO v_existing
    FROM public.company_catalog_installations i
   WHERE i.company_id = v_company_id
     AND i.catalog_key = p_catalog_key
     AND i.catalog_version <> v_version
   ORDER BY i.catalog_version DESC
   LIMIT 1;
  IF FOUND AND NOT p_allow_parallel THEN
    RAISE EXCEPTION 'catalog already installed at version %, refusing silent overwrite', v_existing.catalog_version;
  END IF;

  INSERT INTO public.company_catalog_installations (
    company_id, catalog_key, catalog_version, baseline_hash, idempotency_key,
    materialized_refs,
    creation_path, selected_by
  )
  VALUES (
    v_company_id, p_catalog_key, v_version, v_entry.content_hash, 'default', '{}',
    'rpc', auth.uid()
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT i.id INTO v_id
      FROM public.company_catalog_installations i
     WHERE i.company_id = v_company_id
       AND i.catalog_key = p_catalog_key
       AND i.catalog_version = v_version;
  END IF;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_install_platform_default_catalog(
  p_catalog_key text,
  p_version integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.rpc_install_platform_catalog_version(p_catalog_key, p_version, false);
$$;

CREATE OR REPLACE FUNCTION public.rpc_install_platform_catalog_upgrade(
  p_catalog_key text,
  p_version integer
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.rpc_install_platform_catalog_version(p_catalog_key, p_version, true);
$$;

ALTER TABLE public.platform_catalog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_catalog_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_catalog_installations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_catalog_entries_read ON public.platform_catalog_entries;
CREATE POLICY platform_catalog_entries_read
  ON public.platform_catalog_entries FOR SELECT TO authenticated
  USING (
    lifecycle_state = 'published'
    AND published_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.platform_catalog_heads h
       WHERE h.catalog_key = platform_catalog_entries.catalog_key
         AND h.published_version = platform_catalog_entries.version
    )
  );

DROP POLICY IF EXISTS platform_catalog_heads_read ON public.platform_catalog_heads;
CREATE POLICY platform_catalog_heads_read
  ON public.platform_catalog_heads FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS company_catalog_installations_read ON public.company_catalog_installations;
CREATE POLICY company_catalog_installations_read
  ON public.company_catalog_installations FOR SELECT TO authenticated
  USING (company_catalog_installations.company_id = public.my_company_id());

REVOKE ALL ON public.platform_catalog_entries,
               public.platform_catalog_heads,
               public.company_catalog_installations
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.platform_catalog_entries,
               public.platform_catalog_heads,
               public.company_catalog_installations
  TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_resolve_platform_catalog(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_resolve_published_catalog_entry(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_install_platform_catalog_version(text, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_install_platform_default_catalog(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_install_platform_catalog_upgrade(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_platform_catalog(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_published_catalog_entry(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_install_platform_catalog_version(text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_install_platform_default_catalog(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_install_platform_catalog_upgrade(text, integer) TO authenticated;

-- v1 is a semantic snapshot of the global system roles and permission keys.
-- It deliberately contains no tenant UUIDs or materialized row identifiers.
DO $seed$
DECLARE
  v_payload jsonb;
  v_existing public.platform_catalog_entries%rowtype;
BEGIN
  -- Keep the platform role bundle independent of supabase/seed.sql ordering:
  -- migrations run before the optional development seed. The payload is the
  -- reviewed semantic snapshot of the four platform roles; tenant UUIDs are
  -- intentionally impossible here.
  v_payload := $catalog_payload${"schema_version":1,"roles":[{"name":"Admin","color":"#EF4444","is_default":false,"description":"Full administrative control. Has every permission across pipelines, tasks, users, roles, reports, and company settings.","permission_keys":["analytics.compare","analytics.view","archive:create","archive.delete","archive.restore","archive.view","company.billing","company.edit","company.settings","data.export","filehub:bin_empty","filehub:broadcast","filehub:group_override","filehub:group_override_manage","filehub:groups","filehub:send","filehub:share","filehub:share_override","filehub:view","filehub:view_all_files","manage_notifications","pipeline.create","pipeline.delete","pipeline.edit","pipeline.reverse","project.archive","project.create","project.edit","project.view","project.view_all","report.export","report.generate","report.schedule","report.view","role.manage","role.manage_global","submission.review","submission.view_all","system.view_all_data","target.set","target.view","task.assign","task.comment","task.create","task.delete","task.edit","task.view_all","task.view_detail","task.view_history","task.view_submissions","tasks.assign","tasks.create","tasks.delete","tasks.update","tasks.view_all","team.create","team.edit","team.manage_members","user.deactivate","user.edit","user.invite","user.view_all"]},{"name":"Manager","color":"#F59E0B","is_default":false,"description":"Operational lead. Can create and assign tasks, manage teams, review submissions, set targets, and access reports.","permission_keys":["filehub:broadcast","filehub:group_override","filehub:group_override_manage","filehub:groups","filehub:send","filehub:share","filehub:view","pipeline.create","pipeline.edit","pipeline.reverse","project.archive","project.create","project.edit","project.view","project.view_all","report.export","report.generate","report.view","submission.review","submission.view_all","target.set","target.view","task.assign","task.comment","task.create","task.edit","task.view_all","task.view_history","tasks.assign","tasks.create","tasks.update","tasks.view_all","team.create","team.edit","team.manage_members","user.edit","user.invite","user.view_all"]},{"name":"Owner","color":"#8B5CF6","is_default":false,"description":"Highest authority. Full unrestricted access to every permission, company resource, setting, and personnel management capability.","permission_keys":["analytics.compare","analytics.view","archive:create","archive.delete","archive.restore","archive.view","company.billing","company.edit","company.settings","data.export","filehub:bin_empty","filehub:broadcast","filehub:group_override","filehub:group_override_manage","filehub:groups","filehub:send","filehub:share","filehub:share_override","filehub:view","filehub:view_all_files","manage_notifications","pipeline.create","pipeline.delete","pipeline.edit","pipeline.reverse","project.archive","project.create","project.delete","project.edit","project.view","project.view_all","report.export","report.generate","report.schedule","report.view","role.manage","role.manage_global","submission.review","submission.view_all","system.view_all_data","target.set","target.view","task.assign","task.comment","task.create","task.delete","task.edit","task.view_all","task.view_detail","task.view_history","task.view_submissions","tasks.assign","tasks.create","tasks.delete","tasks.update","tasks.view_all","team.create","team.edit","team.manage_members","user.deactivate","user.edit","user.invite","user.view_all"]},{"name":"Personnel","color":"#10B981","is_default":true,"description":"Standard employee. Can view assigned tasks, leave comments, and submit work. Cannot access company-wide data.","permission_keys":["filehub:groups","filehub:send","filehub:view","task.comment","task.view_detail"]}]}$catalog_payload$::jsonb;

  SELECT * INTO v_existing
    FROM public.platform_catalog_entries
   WHERE catalog_key = 'roles_permissions'
     AND version = 1;
  IF v_existing.catalog_key IS NULL THEN
    INSERT INTO public.platform_catalog_entries (
      catalog_key, version, kind, owner_scope, classification,
      permission_boundary, customization_policy, update_policy,
      cloneable, editable, replaceable, existing_companies_affected,
      payload, content_hash, baseline_hash, publication_state, retired_at,
      lifecycle_state, published_at
    )
    VALUES (
      'roles_permissions', 1, 'role_bundle', 'platform', 'platform_curated_default', 'platform',
      'clone-to-company', 'append-only-explicit-upgrade', true, false, false,
      false, v_payload, '', '', 'published', NULL, 'published', now()
    );
  ELSIF v_existing.payload <> v_payload THEN
    RAISE EXCEPTION 'roles_permissions v1 replay differs; refusing overwrite';
  END IF;

  INSERT INTO public.platform_catalog_heads (
    catalog_key, recommended_version, published_version
  ) VALUES ('roles_permissions', 1, 1)
  ON CONFLICT (catalog_key) DO NOTHING;
  UPDATE public.platform_catalog_heads
     SET published_version = 1,
         updated_at = now()
   WHERE catalog_key = 'roles_permissions'
     AND recommended_version = 1
     AND published_version IS NULL;
END;
$seed$;
