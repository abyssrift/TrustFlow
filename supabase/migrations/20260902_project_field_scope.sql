-- 20260902_project_field_scope.sql
-- Issue #199 — "Same client, two engagements: client data is copied per project
-- instead of shared". Plan docs/CLIENT_SCOPED_FIELDS_PLAN.md §4 (Phase 1).
--
-- Custom field VALUES are stored strictly per project
-- (project_field_values.project_id). A client's contact card — focal point,
-- email, position, mobile — therefore gets written onto every one of that
-- client's projects, each independently editable, none authoritative. This
-- migration adds a `scope` to project_field_defs so a NEW field can declare
-- itself "about the client", and a parallel value table keyed by client_id.
--
-- ── What this migration deliberately does NOT do ──────────────────────────
--  * It moves ZERO rows. `scope` defaults to 'project'; every existing def and
--    value is untouched and every existing reader keeps working (§3.2).
--  * Promoting an already-populated field to client scope is a separate,
--    explicit RPC with a dry-run conflict preview — Phase 2, not here. So the
--    scope-flip guard below simply REFUSES the flip once values exist.
--
-- ── Why the three shared RPCs are PATCHED, never retyped ──────────────────
-- rpc_save_project_field_def / rpc_set_project_field_values / rpc_projects_table
-- are extended by pulling their LIVE body via pg_get_functiondef, doing anchored
-- replace()s that each fail loudly if the anchor is missing, then an explicit
-- DROP of the old signature + EXECUTE. Recreating an RPC from a remembered body
-- has silently dropped behaviour in this repo more than once (see the notes on
-- rpc_filehub_group_list_files), and rpc_projects_table specifically has been
-- patched in place TWICE since its last full CREATE (field filter #197, then
-- portfolio filter — its live signature already carries p_portfolio_id). Adding
-- a parameter with CREATE OR REPLACE makes an OVERLOAD, not a replacement, which
-- is why every patch below DROPs the prior signature and asserts exactly one
-- survives. Precedent: 20260804_project_field_display_format.sql and
-- 20260803_projects_table_field_filter.sql.

-- ── 1. scope column on project_field_defs ────────────────────────────────
ALTER TABLE public.project_field_defs
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'project';

DO $ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_field_defs'::regclass
      AND conname = 'project_field_defs_scope_ck'
  ) THEN
    ALTER TABLE public.project_field_defs
      ADD CONSTRAINT project_field_defs_scope_ck
      CHECK (scope IN ('project','client'));
  END IF;
END
$ck$;

COMMENT ON COLUMN public.project_field_defs.scope IS
  'What a custom field is ABOUT. ''project'' (default) -> project_field_values; ''client'' -> client_field_values, one value shared by every one of the client''s projects. A field is exactly one scope, never both — no per-project override of a client value.';

-- ── 2. client_field_values — structural copy of project_field_values ─────
-- clients(id) replaces projects(id), PK (client_id, field_def_id). Same four
-- typed columns, same one-value CHECK, same denormalized company_id derived by
-- the trigger (never from the caller), same updated_at.
CREATE TABLE IF NOT EXISTS public.client_field_values (
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  field_def_id UUID NOT NULL REFERENCES public.project_field_defs(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  value_text   TEXT,
  value_num    NUMERIC,
  value_date   DATE,
  value_bool   BOOLEAN,
  updated_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, field_def_id),
  CONSTRAINT client_field_values_one_value_ck
    CHECK (num_nonnulls(value_text, value_num, value_date, value_bool) = 1)
);

CREATE INDEX IF NOT EXISTS idx_client_field_values_def
  ON public.client_field_values (field_def_id);

ALTER TABLE public.client_field_values ENABLE ROW LEVEL SECURITY;

-- ── 3. type enforcement for client values (the project trigger, cloned) ──
-- Body of trg_project_field_value_typecheck with projects -> clients,
-- NEW.project_id -> NEW.client_id, and the def lookup additionally requiring
-- d.scope = 'client': a project-scoped def must never receive a client value.
CREATE OR REPLACE FUNCTION public.trg_client_field_value_typecheck()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_def       RECORD;
  v_c_company UUID;
BEGIN
  SELECT d.company_id, d.data_type, d.enum_options, d.key
  INTO v_def
  FROM public.project_field_defs d
  WHERE d.id = NEW.field_def_id AND d.deleted_at IS NULL AND d.scope = 'client';

  IF NOT FOUND THEN
    -- Unknown, deleted, or a project-scoped def: all answer "does not exist",
    -- same as every other not-found/not-allowed denial in this codebase.
    RAISE EXCEPTION 'Custom field % does not exist.', NEW.field_def_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT c.company_id INTO v_c_company
  FROM public.clients c
  WHERE c.id = NEW.client_id AND c.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client % does not exist.', NEW.client_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Multi-tenancy is not optional: a value may never bridge two companies,
  -- whatever route it arrives by (RPC, direct insert, future importer).
  IF v_c_company <> v_def.company_id THEN
    RAISE EXCEPTION 'Custom field % belongs to a different company than client %.',
      v_def.key, NEW.client_id USING ERRCODE = 'check_violation';
  END IF;

  NEW.company_id := v_def.company_id;
  NEW.updated_at := now();

  -- client_field_values_one_value_ck already guarantees exactly one column
  -- is populated, so asserting the RIGHT one is populated is sufficient.
  IF (v_def.data_type IN ('text','enum') AND NEW.value_text IS NULL)
     OR (v_def.data_type = 'number'  AND NEW.value_num  IS NULL)
     OR (v_def.data_type = 'date'    AND NEW.value_date IS NULL)
     OR (v_def.data_type = 'boolean' AND NEW.value_bool IS NULL)
  THEN
    RAISE EXCEPTION 'Custom field "%" is of type % — value must be stored in the matching column.',
      v_def.key, v_def.data_type USING ERRCODE = 'check_violation';
  END IF;

  IF v_def.data_type = 'enum' AND NOT (NEW.value_text = ANY (v_def.enum_options)) THEN
    RAISE EXCEPTION 'Value "%" is not one of the allowed options for custom field "%".',
      NEW.value_text, v_def.key USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_field_values_typecheck ON public.client_field_values;
CREATE TRIGGER trg_client_field_values_typecheck
  BEFORE INSERT OR UPDATE ON public.client_field_values
  FOR EACH ROW EXECUTE FUNCTION public.trg_client_field_value_typecheck();

-- ── 3b. the other direction: a client-scoped def must never get a PROJECT
--        value. Same one-line addition to the existing project trigger's def
--        lookup. Every pre-existing def is scope='project' (column default),
--        so no existing project_field_values row changes behaviour.
CREATE OR REPLACE FUNCTION public.trg_project_field_value_typecheck()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_def       RECORD;
  v_p_company UUID;
BEGIN
  SELECT d.company_id, d.data_type, d.enum_options, d.key
  INTO v_def
  FROM public.project_field_defs d
  WHERE d.id = NEW.field_def_id AND d.deleted_at IS NULL AND d.scope = 'project';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Custom field % does not exist.', NEW.field_def_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT p.company_id INTO v_p_company
  FROM public.projects p
  WHERE p.id = NEW.project_id AND p.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project % does not exist.', NEW.project_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Multi-tenancy is not optional: a value may never bridge two companies,
  -- whatever route it arrives by (RPC, direct insert, future importer).
  IF v_p_company <> v_def.company_id THEN
    RAISE EXCEPTION 'Custom field % belongs to a different company than project %.',
      v_def.key, NEW.project_id USING ERRCODE = 'check_violation';
  END IF;

  NEW.company_id := v_def.company_id;
  NEW.updated_at := now();

  -- project_field_values_one_value_ck already guarantees exactly one column
  -- is populated, so asserting the RIGHT one is populated is sufficient.
  IF (v_def.data_type IN ('text','enum') AND NEW.value_text IS NULL)
     OR (v_def.data_type = 'number'  AND NEW.value_num  IS NULL)
     OR (v_def.data_type = 'date'    AND NEW.value_date IS NULL)
     OR (v_def.data_type = 'boolean' AND NEW.value_bool IS NULL)
  THEN
    RAISE EXCEPTION 'Custom field "%" is of type % — value must be stored in the matching column.',
      v_def.key, v_def.data_type USING ERRCODE = 'check_violation';
  END IF;

  IF v_def.data_type = 'enum' AND NOT (NEW.value_text = ANY (v_def.enum_options)) THEN
    RAISE EXCEPTION 'Value "%" is not one of the allowed options for custom field "%".',
      NEW.value_text, v_def.key USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. RLS — company-wide select, RPC-only writes ───────────────────────
-- Mirrors project_field_defs_select and clients_select: a client's contact
-- card is ALREADY company-visible (the clients row is), so its custom fields
-- being the same is consistent (§3.1). No company_id/deleted_at on the value
-- row to filter — company_id is the tenant floor, derived by the trigger.
DROP POLICY IF EXISTS client_field_values_select ON public.client_field_values;
CREATE POLICY client_field_values_select ON public.client_field_values
  FOR SELECT USING (company_id = public.my_company_id());

-- No INSERT/UPDATE/DELETE policies: every write goes through the SECURITY
-- DEFINER RPC below, which runs its own permission + accessibility checks.
-- Same convention as project_field_values.

-- ── 5. rpc_save_project_field_def — trailing p_scope, patched from live ──
DO $patch$
DECLARE
  v_def TEXT;
  v_sig_needle  TEXT := 'p_format text DEFAULT NULL::text)';
  v_sig_repl    TEXT := 'p_format text DEFAULT NULL::text, p_scope text DEFAULT NULL::text)';
  v_dec_needle  TEXT := '  v_in_use   TEXT;';
  v_dec_repl    TEXT := '  v_in_use   TEXT;' || E'\n' ||
                        '  v_scope    TEXT := NULLIF(lower(trim(COALESCE(p_scope, ''''))), '''');';
  v_val_needle  TEXT :=
    E'  IF p_data_type NOT IN (''text'',''number'',''date'',''enum'',''boolean'') THEN\n' ||
    E'    RAISE EXCEPTION ''Unknown field data type "%".'', p_data_type;\n' ||
    E'  END IF;';
  v_val_repl    TEXT :=
    E'  IF p_data_type NOT IN (''text'',''number'',''date'',''enum'',''boolean'') THEN\n' ||
    E'    RAISE EXCEPTION ''Unknown field data type "%".'', p_data_type;\n' ||
    E'  END IF;\n' ||
    E'  IF v_scope IS NOT NULL AND v_scope NOT IN (''project'',''client'') THEN\n' ||
    E'    RAISE EXCEPTION ''Unknown field scope "%".'', p_scope;\n' ||
    E'  END IF;';
  v_flip_needle TEXT :=
    E'  IF v_found THEN\n' ||
    E'    -- Decision 3: a populated field''s type is frozen, and an in-use enum';
  v_flip_repl   TEXT :=
    E'  IF v_found THEN\n' ||
    E'    -- #199: scope cannot be flipped once values exist in EITHER table.\n' ||
    E'    -- Promoting a populated field is a reviewed data migration (Phase 2).\n' ||
    E'    IF v_scope IS NOT NULL AND v_scope <> v_existing.scope\n' ||
    E'       AND ( EXISTS (SELECT 1 FROM public.project_field_values WHERE field_def_id = v_existing.id)\n' ||
    E'             OR EXISTS (SELECT 1 FROM public.client_field_values WHERE field_def_id = v_existing.id) )\n' ||
    E'    THEN\n' ||
    E'      RAISE EXCEPTION ''Cannot change the scope of custom field "%" while it has values — use rpc_promote_field_to_client_scope.'',\n' ||
    E'        v_existing.key;\n' ||
    E'    END IF;\n' ||
    E'\n' ||
    E'    -- Decision 3: a populated field''s type is frozen, and an in-use enum';
  v_upd_needle  TEXT := '        format        = COALESCE(p_format, format),';
  v_upd_repl    TEXT := '        format        = COALESCE(p_format, format),' || E'\n' ||
                        '        scope         = COALESCE(v_scope, scope),';
  v_ins_needle  TEXT := '(company_id, key, label, data_type, enum_options, source_column, sort_order, format, created_by)';
  v_ins_repl    TEXT := '(company_id, key, label, data_type, enum_options, source_column, sort_order, format, scope, created_by)';
  v_vals_needle TEXT := 'COALESCE(p_sort_order, 0), p_format, v_uid)';
  v_vals_repl   TEXT := 'COALESCE(p_sort_order, 0), p_format, COALESCE(v_scope, ''project''), v_uid)';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc
  WHERE proname = 'rpc_save_project_field_def' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rpc_save_project_field_def not found';
  END IF;

  -- The stored body has CRLF line endings (migrations authored on Windows); the
  -- multi-line anchors below are LF. Normalise so replace() matches.
  v_def := replace(v_def, E'\r\n', E'\n');

  IF position('p_scope' IN v_def) > 0 THEN
    RAISE NOTICE 'rpc_save_project_field_def already takes p_scope; nothing to patch';
    RETURN;
  END IF;

  IF position(v_sig_needle IN v_def) = 0
     OR position(v_dec_needle IN v_def) = 0
     OR position(v_val_needle IN v_def) = 0
     OR position(v_flip_needle IN v_def) = 0
     OR position(v_upd_needle IN v_def) = 0
     OR position(v_ins_needle IN v_def) = 0
     OR position(v_vals_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'could not locate all anchors in rpc_save_project_field_def — refusing to patch blindly';
  END IF;

  v_def := replace(v_def, v_sig_needle,  v_sig_repl);
  v_def := replace(v_def, v_dec_needle,  v_dec_repl);
  v_def := replace(v_def, v_val_needle,  v_val_repl);
  v_def := replace(v_def, v_flip_needle, v_flip_repl);
  v_def := replace(v_def, v_upd_needle,  v_upd_repl);
  v_def := replace(v_def, v_ins_needle,  v_ins_repl);
  v_def := replace(v_def, v_vals_needle, v_vals_repl);

  DROP FUNCTION public.rpc_save_project_field_def(text, text, text, text[], text, integer, uuid, text);
  EXECUTE v_def;
  RAISE NOTICE 'rpc_save_project_field_def now carries p_scope';
END
$patch$;

-- DROP takes the grants with it; pg_get_functiondef never carried them.
REVOKE EXECUTE ON FUNCTION public.rpc_save_project_field_def(text, text, text, text[], text, integer, uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_save_project_field_def(text, text, text, text[], text, integer, uuid, text, text) TO authenticated;

DO $verify$
DECLARE
  v_args TEXT;
  v_sigs INT;
BEGIN
  SELECT count(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_save_project_field_def' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'rpc_save_project_field_def must have exactly 1 signature, found % (overload trap)', v_sigs;
  END IF;

  SELECT pg_get_function_identity_arguments(oid) INTO v_args FROM pg_proc
  WHERE proname = 'rpc_save_project_field_def' AND pronamespace = 'public'::regnamespace;
  IF v_args <> 'p_key text, p_label text, p_data_type text, p_enum_options text[], p_source_column text, p_sort_order integer, p_id uuid, p_format text, p_scope text' THEN
    RAISE EXCEPTION 'rpc_save_project_field_def has the wrong signature: %', v_args;
  END IF;

  -- Guards that would have been silently lost by retyping the body.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'rpc_save_project_field_def' AND pronamespace = 'public'::regnamespace
      AND prosrc LIKE '%is in use%' AND prosrc LIKE '%while it has values%'
      AND prosrc LIKE '%while it has values — use rpc_promote_field_to_client_scope%'
  ) THEN
    RAISE EXCEPTION 'the patched body lost the frozen-type / in-use-enum / scope-flip guard';
  END IF;
  RAISE NOTICE 'rpc_save_project_field_def: one signature, guards intact';
END
$verify$;

-- ── 6. rpc_set_project_field_values — client_id as an alternative key ────
DO $patch$
DECLARE
  v_def TEXT;
  v_tmp_needle TEXT :=
    E'  CREATE TEMP TABLE _pfv_in ON COMMIT DROP AS\n' ||
    E'  SELECT (e ->> ''project_id'')::UUID   AS project_id,\n' ||
    E'         (e ->> ''field_def_id'')::UUID AS field_def_id,\n' ||
    E'         NULLIF(e -> ''value'' #>> ''{}'', '''') AS raw\n' ||
    E'  FROM jsonb_array_elements(p_values) e;';
  v_tmp_repl TEXT :=
    E'  CREATE TEMP TABLE _pfv_in ON COMMIT DROP AS\n' ||
    E'  SELECT (e ->> ''project_id'')::UUID   AS project_id,\n' ||
    E'         (e ->> ''client_id'')::UUID    AS client_id,\n' ||
    E'         (e ->> ''field_def_id'')::UUID AS field_def_id,\n' ||
    E'         NULLIF(e -> ''value'' #>> ''{}'', '''') AS raw\n' ||
    E'  FROM jsonb_array_elements(p_values) e;\n' ||
    E'\n' ||
    E'  -- #199: each element addresses EITHER a project or a client, never\n' ||
    E'  -- both, never neither. The def''s scope then has to agree (below).\n' ||
    E'  IF EXISTS (SELECT 1 FROM _pfv_in WHERE (project_id IS NULL) = (client_id IS NULL)) THEN\n' ||
    E'    RAISE EXCEPTION ''Each value must carry exactly one of project_id or client_id.'';\n' ||
    E'  END IF;';
  v_acc_needle TEXT :=
    E'  SELECT project_id INTO v_bad\n' ||
    E'  FROM (SELECT DISTINCT project_id FROM _pfv_in) x\n' ||
    E'  WHERE NOT public.fn_project_accessible(project_id)\n' ||
    E'  LIMIT 1;\n' ||
    E'  IF v_bad IS NOT NULL THEN\n' ||
    E'    RAISE EXCEPTION ''Project not found.'';\n' ||
    E'  END IF;';
  v_acc_repl TEXT :=
    E'  SELECT project_id INTO v_bad\n' ||
    E'  FROM (SELECT DISTINCT project_id FROM _pfv_in WHERE project_id IS NOT NULL) x\n' ||
    E'  WHERE NOT public.fn_project_accessible(project_id)\n' ||
    E'  LIMIT 1;\n' ||
    E'  IF v_bad IS NOT NULL THEN\n' ||
    E'    RAISE EXCEPTION ''Project not found.'';\n' ||
    E'  END IF;\n' ||
    E'\n' ||
    E'  -- Client rows: the client must exist, be live, and be this company''s.\n' ||
    E'  -- Denial reads the same as non-existence (§13.14).\n' ||
    E'  SELECT client_id INTO v_bad\n' ||
    E'  FROM (SELECT DISTINCT client_id FROM _pfv_in WHERE client_id IS NOT NULL) x\n' ||
    E'  WHERE NOT EXISTS (\n' ||
    E'    SELECT 1 FROM public.clients cl\n' ||
    E'    WHERE cl.id = x.client_id AND cl.company_id = public.my_company_id() AND cl.deleted_at IS NULL\n' ||
    E'  )\n' ||
    E'  LIMIT 1;\n' ||
    E'  IF v_bad IS NOT NULL THEN\n' ||
    E'    RAISE EXCEPTION ''Client not found.'';\n' ||
    E'  END IF;';
  v_defck_needle TEXT :=
    E'  SELECT field_def_id INTO v_bad\n' ||
    E'  FROM (SELECT DISTINCT field_def_id FROM _pfv_in) x\n' ||
    E'  WHERE NOT EXISTS (\n' ||
    E'    SELECT 1 FROM public.project_field_defs d\n' ||
    E'    WHERE d.id = x.field_def_id AND d.deleted_at IS NULL\n' ||
    E'      AND d.company_id = public.my_company_id()\n' ||
    E'  )\n' ||
    E'  LIMIT 1;\n' ||
    E'  IF v_bad IS NOT NULL THEN\n' ||
    E'    RAISE EXCEPTION ''Custom field not found.'';\n' ||
    E'  END IF;';
  v_defck_repl TEXT :=
    E'  -- Unknown / deleted / other-company def, OR a def whose scope disagrees\n' ||
    E'  -- with how the element is keyed: all answer "Custom field not found."\n' ||
    E'  SELECT i.field_def_id INTO v_bad\n' ||
    E'  FROM _pfv_in i\n' ||
    E'  WHERE NOT EXISTS (\n' ||
    E'    SELECT 1 FROM public.project_field_defs d\n' ||
    E'    WHERE d.id = i.field_def_id AND d.deleted_at IS NULL\n' ||
    E'      AND d.company_id = public.my_company_id()\n' ||
    E'      AND d.scope = CASE WHEN i.client_id IS NOT NULL THEN ''client'' ELSE ''project'' END\n' ||
    E'  )\n' ||
    E'  LIMIT 1;\n' ||
    E'  IF v_bad IS NOT NULL THEN\n' ||
    E'    RAISE EXCEPTION ''Custom field not found.'';\n' ||
    E'  END IF;';
  v_del_needle TEXT :=
    E'  WITH del AS (\n' ||
    E'    DELETE FROM public.project_field_values v\n' ||
    E'    USING _pfv_in i\n' ||
    E'    WHERE v.project_id = i.project_id AND v.field_def_id = i.field_def_id\n' ||
    E'      AND i.raw IS NULL\n' ||
    E'    RETURNING 1\n' ||
    E'  )\n' ||
    E'  SELECT COUNT(*)::INT INTO v_cleared FROM del;';
  v_del_repl TEXT :=
    E'  WITH del AS (\n' ||
    E'    DELETE FROM public.project_field_values v\n' ||
    E'    USING _pfv_in i\n' ||
    E'    WHERE v.project_id = i.project_id AND v.field_def_id = i.field_def_id\n' ||
    E'      AND i.raw IS NULL\n' ||
    E'    RETURNING 1\n' ||
    E'  ),\n' ||
    E'  del_client AS (\n' ||
    E'    DELETE FROM public.client_field_values v\n' ||
    E'    USING _pfv_in i\n' ||
    E'    WHERE v.client_id = i.client_id AND v.field_def_id = i.field_def_id\n' ||
    E'      AND i.raw IS NULL\n' ||
    E'    RETURNING 1\n' ||
    E'  )\n' ||
    E'  SELECT (SELECT COUNT(*) FROM del) + (SELECT COUNT(*) FROM del_client) INTO v_cleared;';
  v_ups_needle TEXT :=
    E'  WITH ups AS (\n' ||
    E'    INSERT INTO public.project_field_values AS v\n' ||
    E'      (project_id, field_def_id, company_id, value_text, value_num, value_date, value_bool, updated_by)\n' ||
    E'    SELECT i.project_id, i.field_def_id, d.company_id,\n' ||
    E'           CASE WHEN d.data_type IN (''text'',''enum'') THEN i.raw END,\n' ||
    E'           CASE WHEN d.data_type = ''number''  THEN i.raw::NUMERIC END,\n' ||
    E'           CASE WHEN d.data_type = ''date''    THEN i.raw::DATE    END,\n' ||
    E'           CASE WHEN d.data_type = ''boolean'' THEN i.raw::BOOLEAN END,\n' ||
    E'           v_uid\n' ||
    E'    FROM _pfv_in i\n' ||
    E'    JOIN public.project_field_defs d ON d.id = i.field_def_id AND d.deleted_at IS NULL\n' ||
    E'    WHERE i.raw IS NOT NULL\n' ||
    E'    ON CONFLICT (project_id, field_def_id) DO UPDATE\n' ||
    E'      SET value_text = EXCLUDED.value_text,\n' ||
    E'          value_num  = EXCLUDED.value_num,\n' ||
    E'          value_date = EXCLUDED.value_date,\n' ||
    E'          value_bool = EXCLUDED.value_bool,\n' ||
    E'          updated_by = EXCLUDED.updated_by\n' ||
    E'    RETURNING 1\n' ||
    E'  )\n' ||
    E'  SELECT COUNT(*)::INT INTO v_set FROM ups;';
  v_ups_repl TEXT :=
    E'  WITH ups AS (\n' ||
    E'    INSERT INTO public.project_field_values AS v\n' ||
    E'      (project_id, field_def_id, company_id, value_text, value_num, value_date, value_bool, updated_by)\n' ||
    E'    SELECT i.project_id, i.field_def_id, d.company_id,\n' ||
    E'           CASE WHEN d.data_type IN (''text'',''enum'') THEN i.raw END,\n' ||
    E'           CASE WHEN d.data_type = ''number''  THEN i.raw::NUMERIC END,\n' ||
    E'           CASE WHEN d.data_type = ''date''    THEN i.raw::DATE    END,\n' ||
    E'           CASE WHEN d.data_type = ''boolean'' THEN i.raw::BOOLEAN END,\n' ||
    E'           v_uid\n' ||
    E'    FROM _pfv_in i\n' ||
    E'    JOIN public.project_field_defs d ON d.id = i.field_def_id AND d.deleted_at IS NULL\n' ||
    E'    WHERE i.raw IS NOT NULL AND i.project_id IS NOT NULL\n' ||
    E'    ON CONFLICT (project_id, field_def_id) DO UPDATE\n' ||
    E'      SET value_text = EXCLUDED.value_text,\n' ||
    E'          value_num  = EXCLUDED.value_num,\n' ||
    E'          value_date = EXCLUDED.value_date,\n' ||
    E'          value_bool = EXCLUDED.value_bool,\n' ||
    E'          updated_by = EXCLUDED.updated_by\n' ||
    E'    RETURNING 1\n' ||
    E'  ),\n' ||
    E'  ups_client AS (\n' ||
    E'    INSERT INTO public.client_field_values AS v\n' ||
    E'      (client_id, field_def_id, company_id, value_text, value_num, value_date, value_bool, updated_by)\n' ||
    E'    SELECT i.client_id, i.field_def_id, d.company_id,\n' ||
    E'           CASE WHEN d.data_type IN (''text'',''enum'') THEN i.raw END,\n' ||
    E'           CASE WHEN d.data_type = ''number''  THEN i.raw::NUMERIC END,\n' ||
    E'           CASE WHEN d.data_type = ''date''    THEN i.raw::DATE    END,\n' ||
    E'           CASE WHEN d.data_type = ''boolean'' THEN i.raw::BOOLEAN END,\n' ||
    E'           v_uid\n' ||
    E'    FROM _pfv_in i\n' ||
    E'    JOIN public.project_field_defs d ON d.id = i.field_def_id AND d.deleted_at IS NULL\n' ||
    E'    WHERE i.raw IS NOT NULL AND i.client_id IS NOT NULL\n' ||
    E'    ON CONFLICT (client_id, field_def_id) DO UPDATE\n' ||
    E'      SET value_text = EXCLUDED.value_text,\n' ||
    E'          value_num  = EXCLUDED.value_num,\n' ||
    E'          value_date = EXCLUDED.value_date,\n' ||
    E'          value_bool = EXCLUDED.value_bool,\n' ||
    E'          updated_by = EXCLUDED.updated_by\n' ||
    E'    RETURNING 1\n' ||
    E'  )\n' ||
    E'  SELECT (SELECT COUNT(*) FROM ups) + (SELECT COUNT(*) FROM ups_client) INTO v_set;';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc
  WHERE proname = 'rpc_set_project_field_values' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rpc_set_project_field_values not found';
  END IF;

  v_def := replace(v_def, E'\r\n', E'\n');  -- stored body is CRLF; anchors are LF

  IF position('client_field_values' IN v_def) > 0 THEN
    RAISE NOTICE 'rpc_set_project_field_values already handles client_field_values; nothing to patch';
    RETURN;
  END IF;

  IF position(v_tmp_needle IN v_def) = 0
     OR position(v_acc_needle IN v_def) = 0
     OR position(v_defck_needle IN v_def) = 0
     OR position(v_del_needle IN v_def) = 0
     OR position(v_ups_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'could not locate all anchors in rpc_set_project_field_values — refusing to patch blindly';
  END IF;

  v_def := replace(v_def, v_tmp_needle,   v_tmp_repl);
  v_def := replace(v_def, v_acc_needle,   v_acc_repl);
  v_def := replace(v_def, v_defck_needle, v_defck_repl);
  v_def := replace(v_def, v_del_needle,   v_del_repl);
  v_def := replace(v_def, v_ups_needle,   v_ups_repl);

  DROP FUNCTION public.rpc_set_project_field_values(jsonb);
  EXECUTE v_def;
  RAISE NOTICE 'rpc_set_project_field_values now accepts client_id elements';
END
$patch$;

REVOKE EXECUTE ON FUNCTION public.rpc_set_project_field_values(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_set_project_field_values(jsonb) TO authenticated;

DO $verify$
DECLARE v_sigs INT;
BEGIN
  SELECT count(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_set_project_field_values' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'rpc_set_project_field_values must have exactly 1 signature, found % (overload trap)', v_sigs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'rpc_set_project_field_values' AND pronamespace = 'public'::regnamespace
      AND prosrc LIKE '%client_field_values%'
      AND prosrc LIKE '%fn_project_accessible%'
      AND prosrc LIKE '%exactly one of project_id or client_id%'
  ) THEN
    RAISE EXCEPTION 'the patched rpc_set_project_field_values lost the project gate or the client branch';
  END IF;
  RAISE NOTICE 'rpc_set_project_field_values: one signature, both branches present';
END
$verify$;

-- ── 7. rpc_projects_table — fold client-scoped values into custom_fields ─
DO $patch$
DECLARE
  v_def TEXT;
  v_cte_needle TEXT :=
    E'    WHERE v.company_id = v_company_id\n' ||
    E'    GROUP BY v.project_id\n' ||
    E'  )\n' ||
    E'  SELECT';
  v_cte_repl TEXT :=
    E'    WHERE v.company_id = v_company_id\n' ||
    E'    GROUP BY v.project_id\n' ||
    E'  ),\n' ||
    E'  -- #199: client-scoped custom values, one row per client, folded into\n' ||
    E'  -- the same custom_fields object below — keys are globally unique per\n' ||
    E'  -- company (project_field_defs_company_key_live) so there is no collision.\n' ||
    E'  client_custom AS (\n' ||
    E'    SELECT v.client_id,\n' ||
    E'           jsonb_object_agg(d.key, CASE d.data_type\n' ||
    E'             WHEN ''number''  THEN to_jsonb(v.value_num)\n' ||
    E'             WHEN ''date''    THEN to_jsonb(v.value_date)\n' ||
    E'             WHEN ''boolean'' THEN to_jsonb(v.value_bool)\n' ||
    E'             ELSE to_jsonb(v.value_text)\n' ||
    E'           END) AS fields\n' ||
    E'    FROM public.client_field_values v\n' ||
    E'    JOIN public.project_field_defs d ON d.id = v.field_def_id AND d.deleted_at IS NULL AND d.scope = ''client''\n' ||
    E'    WHERE v.company_id = v_company_id\n' ||
    E'    GROUP BY v.client_id\n' ||
    E'  )\n' ||
    E'  SELECT';
  v_col_needle TEXT := E'    COALESCE(cfv.fields, ''{}''::JSONB) AS custom_fields,';
  v_col_repl   TEXT := E'    (COALESCE(cfv.fields, ''{}''::JSONB) || COALESCE(ccf.fields, ''{}''::JSONB)) AS custom_fields,';
  v_join_needle TEXT := E'  LEFT JOIN custom cfv              ON cfv.project_id = p.id';
  v_join_repl   TEXT := E'  LEFT JOIN custom cfv              ON cfv.project_id = p.id\n' ||
                        E'  LEFT JOIN client_custom ccf       ON ccf.client_id = p.client_id';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rpc_projects_table not found';
  END IF;

  v_def := replace(v_def, E'\r\n', E'\n');  -- stored body is CRLF; anchors are LF

  IF position('client_custom' IN v_def) > 0 THEN
    RAISE NOTICE 'rpc_projects_table already folds client_custom; nothing to patch';
    RETURN;
  END IF;

  IF position(v_cte_needle IN v_def) = 0
     OR position(v_col_needle IN v_def) = 0
     OR position(v_join_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'could not locate the custom CTE / custom_fields column / custom join in rpc_projects_table — refusing to patch blindly';
  END IF;

  v_def := replace(v_def, v_cte_needle,  v_cte_repl);
  v_def := replace(v_def, v_col_needle,  v_col_repl);
  v_def := replace(v_def, v_join_needle, v_join_repl);

  -- Its live signature already carries p_portfolio_id (#191 Phase 10). DROP
  -- that exact 7-arg version — CREATE OR REPLACE would leave it beside the new
  -- body and PostgREST would answer PGRST203 for every call.
  DROP FUNCTION public.rpc_projects_table(text, uuid, boolean, integer, integer, jsonb, uuid);
  EXECUTE v_def;
  RAISE NOTICE 'rpc_projects_table now folds client-scoped custom fields';
END
$patch$;

REVOKE EXECUTE ON FUNCTION public.rpc_projects_table(text, uuid, boolean, integer, integer, jsonb, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_projects_table(text, uuid, boolean, integer, integer, jsonb, uuid) TO authenticated;

DO $verify$
DECLARE v_sigs INT; v_args TEXT;
BEGIN
  SELECT count(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'rpc_projects_table must have exactly 1 signature, found % (overload trap)', v_sigs;
  END IF;

  SELECT pg_get_function_identity_arguments(oid) INTO v_args FROM pg_proc
  WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;
  IF v_args <> 'p_search text, p_stage_id uuid, p_blocked boolean, p_limit integer, p_offset integer, p_field_filters jsonb, p_portfolio_id uuid' THEN
    RAISE EXCEPTION 'rpc_projects_table has the wrong signature: %', v_args;
  END IF;

  -- The pre-existing behaviour that would have been silently lost by retyping.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace
      AND prosrc LIKE '%custom_fields%'
      AND prosrc LIKE '%Needs attention%'
      AND prosrc LIKE '%p_field_filters%'
      AND prosrc LIKE '%p_portfolio_id%'
      AND prosrc LIKE '%client_custom%'
  ) THEN
    RAISE EXCEPTION 'the patched rpc_projects_table lost custom_fields / Needs attention / a filter arg / the client leg';
  END IF;
  RAISE NOTICE 'rpc_projects_table: one signature, all prior behaviour + client_custom intact';
END
$verify$;

-- ── 8. fn_project_field_matches — one client-scoped leg per branch ──────
-- Plain SQL, signature unchanged. Each eq / set / unset branch UNIONs its
-- project_field_values EXISTS with a client_field_values EXISTS resolved via
-- the project's client_id and d.scope = 'client'.
CREATE OR REPLACE FUNCTION public.fn_project_field_matches(p_project_id UUID, p_filter JSONB)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE COALESCE(p_filter ->> 'op', 'eq')
    WHEN 'unset' THEN NOT EXISTS (
      SELECT 1
      FROM public.project_field_values v
      JOIN public.project_field_defs d ON d.id = v.field_def_id AND d.deleted_at IS NULL
      WHERE v.project_id = p_project_id AND d.key = p_filter ->> 'key'
      UNION ALL
      SELECT 1
      FROM public.client_field_values v
      JOIN public.project_field_defs d ON d.id = v.field_def_id AND d.deleted_at IS NULL AND d.scope = 'client'
      WHERE v.client_id = (SELECT client_id FROM public.projects WHERE id = p_project_id)
        AND d.key = p_filter ->> 'key'
    )
    WHEN 'set' THEN EXISTS (
      SELECT 1
      FROM public.project_field_values v
      JOIN public.project_field_defs d ON d.id = v.field_def_id AND d.deleted_at IS NULL
      WHERE v.project_id = p_project_id AND d.key = p_filter ->> 'key'
      UNION ALL
      SELECT 1
      FROM public.client_field_values v
      JOIN public.project_field_defs d ON d.id = v.field_def_id AND d.deleted_at IS NULL AND d.scope = 'client'
      WHERE v.client_id = (SELECT client_id FROM public.projects WHERE id = p_project_id)
        AND d.key = p_filter ->> 'key'
    )
    ELSE EXISTS (
      SELECT 1
      FROM public.project_field_values v
      JOIN public.project_field_defs d ON d.id = v.field_def_id AND d.deleted_at IS NULL
      WHERE v.project_id = p_project_id AND d.key = p_filter ->> 'key'
        AND CASE d.data_type
              WHEN 'number'  THEN (p_filter ->> 'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
                                  AND v.value_num = (p_filter ->> 'value')::NUMERIC
              WHEN 'date'    THEN v.value_date::TEXT = (p_filter ->> 'value')
              WHEN 'boolean' THEN v.value_bool = (lower(p_filter ->> 'value') IN ('true','yes','y','1'))
              ELSE lower(trim(v.value_text)) = lower(trim(p_filter ->> 'value'))
            END
      UNION ALL
      SELECT 1
      FROM public.client_field_values v
      JOIN public.project_field_defs d ON d.id = v.field_def_id AND d.deleted_at IS NULL AND d.scope = 'client'
      WHERE v.client_id = (SELECT client_id FROM public.projects WHERE id = p_project_id)
        AND d.key = p_filter ->> 'key'
        AND CASE d.data_type
              WHEN 'number'  THEN (p_filter ->> 'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
                                  AND v.value_num = (p_filter ->> 'value')::NUMERIC
              WHEN 'date'    THEN v.value_date::TEXT = (p_filter ->> 'value')
              WHEN 'boolean' THEN v.value_bool = (lower(p_filter ->> 'value') IN ('true','yes','y','1'))
              ELSE lower(trim(v.value_text)) = lower(trim(p_filter ->> 'value'))
            END
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.fn_project_field_matches(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ── 9. wiring self-check ────────────────────────────────────────────────
DO $$
DECLARE v_dummy BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_field_defs' AND column_name = 'scope'
  ) THEN
    RAISE EXCEPTION 'project_field_defs.scope missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'client_field_values') THEN
    RAISE EXCEPTION 'client_field_values table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_client_field_values_typecheck'
      AND tgrelid = 'public.client_field_values'::regclass
  ) THEN
    RAISE EXCEPTION 'client_field_values typecheck trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'client_field_values' AND policyname = 'client_field_values_select'
  ) THEN
    RAISE EXCEPTION 'client_field_values_select policy missing';
  END IF;

  -- fn_project_field_matches still evaluates without error on a null project.
  SELECT public.fn_project_field_matches(NULL, '{"key":"x","op":"set"}'::jsonb) INTO v_dummy;

  PERFORM 1 FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('rpc_save_project_field_def','rpc_set_project_field_values','rpc_projects_table')
  GROUP BY p.proname HAVING count(*) <> 1;
  IF FOUND THEN
    RAISE EXCEPTION 'a patched RPC has more than one signature (overload trap)';
  END IF;

  RAISE NOTICE '#199 Phase 1: scope column, client_field_values (+trigger+RLS), and the three RPC patches are all in place.';
END
$$;
