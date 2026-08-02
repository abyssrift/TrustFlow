-- 20260802_project_custom_fields.sql
-- Issue #142 Phase 9 (redesigned), plan docs/PROJECT_HIERARCHY_PLAN.md §18.3.
--
-- Typed custom fields for projects. The spreadsheet intake must carry every
-- column of a real client file, including the ones this product has no concept
-- for ("Inventory Count Needed", "EL Status 2025", "Position"). §18.2 rule 3:
-- nothing is ever discarded.
--
-- Typed columns, NOT a jsonb blob — settled in §18.3. A blob preserves the
-- bytes and loses the product: a firm that filters "Inventory Count Needed =
-- YES" every week cannot do that against inert JSON. So a field has a declared
-- data type, and the type is enforced by the DATABASE (plan §13.2: a rule the
-- database does not enforce is not a rule — stage history was "enforced" by an
-- RPC and silently under-recorded for every other writer).
--
-- ── Decisions taken here, and why ─────────────────────────────────────────
--
-- 1. VALUE STORAGE: four nullable typed columns (value_text/value_num/
--    value_date/value_bool) + a CHECK that exactly one is populated + a
--    BEFORE trigger that requires the populated one to match the def's
--    data_type. A single TEXT column with a cast at read time was rejected:
--    the cast would throw at SELECT time on the row that is already wrong,
--    i.e. the corruption would be discovered by the reader, not refused at
--    the writer. Filtering and sorting also want a real numeric/date column.
--
-- 2. DELETING A DEF SOFT-DELETES IT AND RETAINS ITS VALUES. This is §18.2
--    rule 3 applied to the delete path: the whole reason this table exists is
--    that unrecognised data must survive, so "hide this column" must not
--    destroy an import. Every reader joins through
--    `project_field_defs.deleted_at IS NULL`, so a deleted field vanishes from
--    the table, the API and rpc_projects_table while its values stay on disk.
--    Re-saving a def with the same key REVIVES the same row (same id), so the
--    retained values come back — which is also what makes a re-import
--    idempotent instead of accumulating duplicate defs.
--    No purge RPC ships. ponytail: add one when a customer actually asks to
--    hard-delete field data (GDPR-style erasure); until then retention is the
--    safer default and un-delete is free.
--
-- 3. A DEF'S data_type CANNOT CHANGE WHILE VALUES EXIST, and an enum option
--    that is in use cannot be removed. Without these the def-edit path could
--    manufacture exactly the state the value trigger exists to prevent (the
--    trigger only fires on value writes), and the type guarantee would be a
--    lie one UPDATE later. Converting a populated field is a data migration,
--    not an edit.
--
-- 4. UNIQUENESS IS PARTIAL ON deleted_at (plan §13.6 / issue #180, and
--    20260802_pipelines_name_uniqueness_soft_delete.sql for the exact shape).
--    A total unique index here would burn a field key forever the first time
--    someone deleted a field — invisible in the UI, unusable, raw Postgres
--    error as the only feedback.
--
-- 5. VISIBILITY ROUTES THROUGH fn_project_accessible (plan §13.14). Values are
--    project data: a custom field can hold a fee, a status or a contact, so
--    seeing them is the same disclosure as seeing the row. That predicate is
--    the ONE definition — four SECURITY DEFINER readers each re-implemented
--    project visibility and diverged, which is why it exists. Nothing here
--    defines a sixth.
--    Field DEFS are company-level metadata (a column's name and type, no
--    per-project data), so they use the company-wide policy that clients /
--    portfolios / project_templates already use.
--
-- 6. NO NEW PERMISSION KEY. Managing and filling custom fields is editing
--    project data -> `project.edit`, mirroring 20260731_project_hierarchy_1's
--    reuse note. Split into project_field.* only if a firm needs "can edit
--    projects but not their schema" as a distinct grant.

-- ── 1. project_field_defs — per COMPANY, never global ─────────────────────
CREATE TABLE IF NOT EXISTS public.project_field_defs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Slug, stable across renames of `label`. Lowercase-only by constraint so
  -- "Position" and "position" can never both exist and the unique index needs
  -- no lower() expression.
  key           TEXT NOT NULL,
  label         TEXT NOT NULL,
  data_type     TEXT NOT NULL,
  enum_options  TEXT[],
  -- The spreadsheet header this came from, verbatim ("Follow -up Status",
  -- double space and all) — what makes re-importing the same file with a
  -- saved mapping require no re-mapping (§18.5 acceptance 6).
  source_column TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT project_field_defs_key_ck  CHECK (key ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT project_field_defs_type_ck CHECK (data_type IN ('text','number','date','enum','boolean')),
  -- An enum with no options is unfillable; options on a non-enum are a lie
  -- about what the column accepts.
  CONSTRAINT project_field_defs_enum_ck CHECK (
    (data_type =  'enum' AND enum_options IS NOT NULL AND array_length(enum_options, 1) >= 1)
    OR
    (data_type <> 'enum' AND enum_options IS NULL)
  )
);

-- Partial on deleted_at — see decision 4 above.
CREATE UNIQUE INDEX IF NOT EXISTS project_field_defs_company_key_live
  ON public.project_field_defs (company_id, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_field_defs_company
  ON public.project_field_defs (company_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_project_field_defs_updated_at ON public.project_field_defs;
CREATE TRIGGER trg_project_field_defs_updated_at
  BEFORE UPDATE ON public.project_field_defs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.project_field_defs ENABLE ROW LEVEL SECURITY;

-- ── 2. project_field_values — one row per (project, field) ────────────────
CREATE TABLE IF NOT EXISTS public.project_field_values (
  project_id   UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  field_def_id UUID NOT NULL REFERENCES public.project_field_defs(id) ON DELETE CASCADE,
  -- Denormalized tenant floor. DERIVED by the trigger from the def, never
  -- taken from the caller — plan §13.5's rule for portfolio_id, same reason:
  -- a denormalized key nothing keeps in agreement goes stale silently.
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  value_text   TEXT,
  value_num    NUMERIC,
  value_date   DATE,
  value_bool   BOOLEAN,
  updated_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, field_def_id),
  -- No deleted_at: a cleared value is a deleted row. There is nothing to
  -- soft-delete — the def carries the history, the value is just a cell.
  CONSTRAINT project_field_values_one_value_ck
    CHECK (num_nonnulls(value_text, value_num, value_date, value_bool) = 1)
);

CREATE INDEX IF NOT EXISTS idx_project_field_values_def
  ON public.project_field_values (field_def_id);

ALTER TABLE public.project_field_values ENABLE ROW LEVEL SECURITY;

-- ── 3. The type enforcement (plan §13.2 — a trigger, not a convention) ────
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
  WHERE d.id = NEW.field_def_id AND d.deleted_at IS NULL;

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

DROP TRIGGER IF EXISTS trg_project_field_values_typecheck ON public.project_field_values;
CREATE TRIGGER trg_project_field_values_typecheck
  BEFORE INSERT OR UPDATE ON public.project_field_values
  FOR EACH ROW EXECUTE FUNCTION public.trg_project_field_value_typecheck();

-- ── 4. RLS ────────────────────────────────────────────────────────────────
-- Defs: company-wide, same policy shape as clients / portfolios /
-- project_templates (20260731_project_hierarchy_4_rls_placeholder.sql).
DROP POLICY IF EXISTS project_field_defs_select ON public.project_field_defs;
CREATE POLICY project_field_defs_select ON public.project_field_defs
  FOR SELECT USING (company_id = my_company_id() AND deleted_at IS NULL);

-- Values: the project gate, and only the project gate (plan §13.14).
-- fn_project_accessible already enforces existence + the company floor, so
-- the cross-tenant case answers identically to the no-access case: zero rows.
DROP POLICY IF EXISTS project_field_values_select ON public.project_field_values;
CREATE POLICY project_field_values_select ON public.project_field_values
  FOR SELECT USING (public.fn_project_accessible(project_id));

-- No INSERT/UPDATE/DELETE policies on either table: every write goes through
-- the SECURITY DEFINER RPCs below, which run their own permission and
-- accessibility checks. Same convention as clients/portfolios/templates.

-- ── 5. rpc_save_project_field_def — create, update, revive, re-import ─────
-- One upsert keyed on (company_id, key) rather than separate create/update
-- RPCs: they would share every line of validation, and a re-import that has
-- to ask "does this field exist yet?" first is a round trip that can race.
-- Pass p_id only to RENAME a key (the one operation the key cannot address).
CREATE OR REPLACE FUNCTION public.rpc_save_project_field_def(
  p_key           TEXT,
  p_label         TEXT,
  p_data_type     TEXT,
  p_enum_options  TEXT[] DEFAULT NULL,
  p_source_column TEXT   DEFAULT NULL,
  p_sort_order    INT    DEFAULT NULL,
  p_id            UUID   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company  UUID := public.my_company_id();
  v_uid      UUID := auth.uid();
  v_existing RECORD;
  v_found    BOOLEAN;
  v_id       UUID;
  v_in_use   TEXT;
BEGIN
  IF NOT public.has_permission('project.edit') THEN
    RAISE EXCEPTION 'Insufficient permissions to manage project fields.';
  END IF;

  p_key   := lower(trim(COALESCE(p_key, '')));
  p_label := trim(COALESCE(p_label, ''));

  IF p_key !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'Field key must be 1-64 characters of a-z, 0-9 or underscore (got "%").', p_key;
  END IF;
  IF p_label = '' THEN
    RAISE EXCEPTION 'Field label is required.';
  END IF;
  IF p_data_type NOT IN ('text','number','date','enum','boolean') THEN
    RAISE EXCEPTION 'Unknown field data type "%".', p_data_type;
  END IF;
  IF p_data_type = 'enum' THEN
    -- Trim, drop blanks, de-duplicate: enum options come from real spreadsheet
    -- cells, which have trailing spaces and repeats.
    SELECT ARRAY_AGG(DISTINCT o ORDER BY o) INTO p_enum_options
    FROM unnest(COALESCE(p_enum_options, '{}')) o
    WHERE trim(o) <> '';
    IF p_enum_options IS NULL THEN
      RAISE EXCEPTION 'An enum field needs at least one option.';
    END IF;
  ELSE
    p_enum_options := NULL;
  END IF;

  -- Locate the row this call is addressing: explicit id, else the key within
  -- this company. Live row wins over a soft-deleted one with the same key.
  SELECT * INTO v_existing
  FROM public.project_field_defs
  WHERE company_id = v_company
    AND ( (p_id IS NOT NULL AND id = p_id)
          OR (p_id IS NULL AND key = p_key) )
  ORDER BY (deleted_at IS NULL) DESC, created_at DESC
  LIMIT 1;
  v_found := FOUND;

  IF p_id IS NOT NULL AND NOT v_found THEN
    -- Same wording as every other cross-tenant denial: not found and not
    -- allowed answer identically (§13.14).
    RAISE EXCEPTION 'Custom field not found.';
  END IF;

  IF v_found THEN
    -- Decision 3: a populated field's type is frozen, and an in-use enum
    -- option cannot be withdrawn. Both would otherwise create rows the value
    -- trigger would have refused.
    IF v_existing.data_type <> p_data_type
       AND EXISTS (SELECT 1 FROM public.project_field_values WHERE field_def_id = v_existing.id)
    THEN
      RAISE EXCEPTION 'Cannot change custom field "%" from % to % while it has values. Delete the values first.',
        v_existing.key, v_existing.data_type, p_data_type;
    END IF;

    IF p_data_type = 'enum' AND v_existing.data_type = 'enum' THEN
      SELECT v.value_text INTO v_in_use
      FROM public.project_field_values v
      WHERE v.field_def_id = v_existing.id
        AND NOT (v.value_text = ANY (p_enum_options))
      LIMIT 1;
      IF v_in_use IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot remove option "%" from custom field "%" — it is in use.',
          v_in_use, v_existing.key;
      END IF;
    END IF;

    UPDATE public.project_field_defs
    SET key           = p_key,
        label         = p_label,
        data_type     = p_data_type,
        enum_options  = p_enum_options,
        source_column = COALESCE(p_source_column, source_column),
        sort_order    = COALESCE(p_sort_order, sort_order),
        deleted_at    = NULL   -- revive; a no-op for a live def
    WHERE id = v_existing.id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.project_field_defs
      (company_id, key, label, data_type, enum_options, source_column, sort_order, created_by)
    VALUES
      (v_company, p_key, p_label, p_data_type, p_enum_options, p_source_column,
       COALESCE(p_sort_order, 0), v_uid)
    RETURNING id INTO v_id;
  END IF;

  RETURN (SELECT to_jsonb(d) FROM public.project_field_defs d WHERE d.id = v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_save_project_field_def(TEXT, TEXT, TEXT, TEXT[], TEXT, INT, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_save_project_field_def(TEXT, TEXT, TEXT, TEXT[], TEXT, INT, UUID) TO authenticated;

-- ── 6. rpc_delete_project_field_def — soft delete, values retained ────────
CREATE OR REPLACE FUNCTION public.rpc_delete_project_field_def(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company  UUID := public.my_company_id();
  v_key      TEXT;
  v_retained INT;
BEGIN
  IF NOT public.has_permission('project.edit') THEN
    RAISE EXCEPTION 'Insufficient permissions to manage project fields.';
  END IF;

  UPDATE public.project_field_defs
  SET deleted_at = now()
  WHERE id = p_id AND company_id = v_company AND deleted_at IS NULL
  RETURNING key INTO v_key;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Custom field not found.';
  END IF;

  -- Deliberately NOT deleted (decision 2): the values stay on disk, invisible
  -- to every reader, and come back if the field is re-saved under the same key.
  SELECT COUNT(*)::INT INTO v_retained
  FROM public.project_field_values WHERE field_def_id = p_id;

  RETURN jsonb_build_object('id', p_id, 'key', v_key, 'values_retained', v_retained);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_delete_project_field_def(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_delete_project_field_def(UUID) TO authenticated;

-- ── 7. rpc_set_project_field_values — BULK, because import writes hundreds ─
-- p_values: [{"project_id":uuid, "field_def_id":uuid, "value":<scalar|null>}]
-- Keyed by field_def_id, not by key: the caller has just created the defs and
-- holds their ids, and an id cannot be ambiguous across a rename.
-- A null / empty-string value CLEARS the cell (deletes the row) — a blank
-- spreadsheet cell must not be storable as "".
-- The whole batch fails on the first bad row. Import must never half-succeed
-- quietly; §18.2 rule 3 is about not losing data, and a partially applied
-- batch loses it in the most confusing way available.
CREATE OR REPLACE FUNCTION public.rpc_set_project_field_values(p_values JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_bad     UUID;
  v_set     INT := 0;
  v_cleared INT := 0;
BEGIN
  IF NOT public.has_permission('project.edit') THEN
    RAISE EXCEPTION 'Insufficient permissions to edit project fields.';
  END IF;

  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'array' THEN
    RAISE EXCEPTION 'p_values must be a JSON array of {project_id, field_def_id, value}.';
  END IF;

  CREATE TEMP TABLE _pfv_in ON COMMIT DROP AS
  SELECT (e ->> 'project_id')::UUID   AS project_id,
         (e ->> 'field_def_id')::UUID AS field_def_id,
         NULLIF(e -> 'value' #>> '{}', '') AS raw
  FROM jsonb_array_elements(p_values) e;

  -- Visibility: the same predicate as every other project reader (§13.14).
  -- Writing to a project you cannot see is a write-side disclosure — you would
  -- learn it exists — so it answers with the same "Project not found." as a
  -- read.
  SELECT project_id INTO v_bad
  FROM (SELECT DISTINCT project_id FROM _pfv_in) x
  WHERE NOT public.fn_project_accessible(project_id)
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;

  -- A def id that is unknown, deleted, or another company's would otherwise
  -- be dropped by the join below and the import would silently lose a column.
  SELECT field_def_id INTO v_bad
  FROM (SELECT DISTINCT field_def_id FROM _pfv_in) x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.project_field_defs d
    WHERE d.id = x.field_def_id AND d.deleted_at IS NULL
      AND d.company_id = public.my_company_id()
  )
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Custom field not found.';
  END IF;

  WITH del AS (
    DELETE FROM public.project_field_values v
    USING _pfv_in i
    WHERE v.project_id = i.project_id AND v.field_def_id = i.field_def_id
      AND i.raw IS NULL
    RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_cleared FROM del;

  -- The casts are the type enforcement's public face: "8,000" into a number
  -- field raises invalid_text_representation here, and the trigger catches
  -- anything that gets past this (a direct INSERT, a future writer).
  WITH ups AS (
    INSERT INTO public.project_field_values AS v
      (project_id, field_def_id, company_id, value_text, value_num, value_date, value_bool, updated_by)
    SELECT i.project_id, i.field_def_id, d.company_id,
           CASE WHEN d.data_type IN ('text','enum') THEN i.raw END,
           CASE WHEN d.data_type = 'number'  THEN i.raw::NUMERIC END,
           CASE WHEN d.data_type = 'date'    THEN i.raw::DATE    END,
           CASE WHEN d.data_type = 'boolean' THEN i.raw::BOOLEAN END,
           v_uid
    FROM _pfv_in i
    JOIN public.project_field_defs d ON d.id = i.field_def_id AND d.deleted_at IS NULL
    WHERE i.raw IS NOT NULL
    ON CONFLICT (project_id, field_def_id) DO UPDATE
      SET value_text = EXCLUDED.value_text,
          value_num  = EXCLUDED.value_num,
          value_date = EXCLUDED.value_date,
          value_bool = EXCLUDED.value_bool,
          updated_by = EXCLUDED.updated_by
    RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_set FROM ups;

  DROP TABLE _pfv_in;
  RETURN jsonb_build_object('set', v_set, 'cleared', v_cleared);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_set_project_field_values(JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_set_project_field_values(JSONB) TO authenticated;

-- ── 8. rpc_projects_table carries the values — no second round trip ───────
-- Checked before adding anything: the function already returns one row per
-- project and already aggregates three per-project CTEs, so custom fields ride
-- along as a fourth. A separate rpc_project_custom_fields would be a second
-- request per table page for data the first request is already shaped to
-- carry, and the two could disagree about which fields are deleted.
--
-- The signature is unchanged; one column, `custom_fields JSONB`, is APPENDED
-- (a jsonb object keyed by field key, '{}' when a project has none). Existing
-- callers (ProjectsTable.tsx, ProjectBoard.tsx) select by name and are
-- unaffected. Column order/definitions below are otherwise byte-identical to
-- 20260801_project_visibility.sql — a return-type change forces DROP+CREATE,
-- it is not a rewrite.
DROP FUNCTION IF EXISTS public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT);

CREATE OR REPLACE FUNCTION public.rpc_projects_table(
  p_search   TEXT    DEFAULT NULL,
  p_stage_id UUID    DEFAULT NULL,
  p_blocked  BOOLEAN DEFAULT NULL,
  p_limit    INT     DEFAULT 100,
  p_offset   INT     DEFAULT 0
)
RETURNS TABLE (
  id                    UUID,
  name                  TEXT,
  color                 TEXT,
  client_id             UUID,
  client_name           TEXT,
  portfolio_id          UUID,
  portfolio_name        TEXT,
  current_stage_id      UUID,
  stage_name            TEXT,
  stage_color           TEXT,
  days_in_current_stage INT,
  due_date              TIMESTAMPTZ,
  days_remaining        INT,
  tasks_total           INT,
  tasks_done            INT,
  weighted_progress     NUMERIC,
  owner_id              UUID,
  owner_name            TEXT,
  owner_avatar_url      TEXT,
  blocked               BOOLEAN,
  blocked_reason        TEXT,
  tracked_seconds       BIGINT,
  estimated_hours       NUMERIC,
  updated_at            TIMESTAMPTZ,
  custom_fields         JSONB
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID := public.my_company_id();
BEGIN
  IF NOT public.has_permission('project.view') THEN
    RAISE EXCEPTION 'Insufficient permissions to view projects.';
  END IF;

  RETURN QUERY
  WITH stage_age AS (
    SELECT DISTINCT ON (psh.project_id)
      psh.project_id, psh.transitioned_at
    FROM public.project_stage_history psh
    WHERE psh.company_id = v_company_id
    ORDER BY psh.project_id, psh.transitioned_at DESC
  ),
  task_rollup AS (
    SELECT
      t.project_id,
      COUNT(*)::INT AS tasks_total,
      COUNT(*) FILTER (
        WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)
      )::INT AS tasks_done,
      COALESCE(SUM(t.weight), 0) AS total_weight,
      COALESCE(SUM(t.weight) FILTER (
        WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)
      ), 0) AS completed_weight,
      COALESCE(SUM(t.estimated_hours), 0) AS estimated_hours
    FROM public.tasks t
    LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.company_id = v_company_id
      AND t.deleted_at IS NULL
      AND t.project_id IS NOT NULL
    GROUP BY t.project_id
  ),
  time_rollup AS (
    SELECT t.project_id, COALESCE(SUM(ws.total_seconds_spent), 0)::BIGINT AS tracked_seconds
    FROM public.task_work_sessions ws
    JOIN public.tasks t ON t.id = ws.task_id
    WHERE t.company_id = v_company_id
      AND t.deleted_at IS NULL
      AND t.project_id IS NOT NULL
    GROUP BY t.project_id
  ),
  -- ponytail: company-wide scan then hash join, exactly like the three CTEs
  -- above it (measured at 6ms in #186). Turn it into a LATERAL over the paged
  -- rows if a company ever has enough field values for it to show up.
  custom AS (
    SELECT v.project_id,
           jsonb_object_agg(d.key, CASE d.data_type
             WHEN 'number'  THEN to_jsonb(v.value_num)
             WHEN 'date'    THEN to_jsonb(v.value_date)
             WHEN 'boolean' THEN to_jsonb(v.value_bool)
             ELSE to_jsonb(v.value_text)
           END) AS fields
    FROM public.project_field_values v
    -- Soft-deleted defs drop out here: the values are retained, not shown.
    JOIN public.project_field_defs d ON d.id = v.field_def_id AND d.deleted_at IS NULL
    WHERE v.company_id = v_company_id
    GROUP BY v.project_id
  )
  SELECT
    p.id,
    p.name,
    p.color,
    p.client_id,
    c.name AS client_name,
    p.portfolio_id,
    pf.name AS portfolio_name,
    p.current_stage_id,
    ps.name AS stage_name,
    ps.color AS stage_color,
    (CASE WHEN sa.transitioned_at IS NULL THEN NULL
          ELSE EXTRACT(DAY FROM (now() - sa.transitioned_at))::INT END) AS days_in_current_stage,
    p.due_date,
    (CASE WHEN p.due_date IS NULL THEN NULL
          ELSE EXTRACT(DAY FROM (p.due_date - now()))::INT END) AS days_remaining,
    COALESCE(tr.tasks_total, 0) AS tasks_total,
    COALESCE(tr.tasks_done, 0) AS tasks_done,
    (CASE WHEN COALESCE(tr.total_weight, 0) = 0 THEN 0
          ELSE ROUND(tr.completed_weight / tr.total_weight * 100, 2) END) AS weighted_progress,
    p.owner_id,
    u.full_name AS owner_name,
    u.avatar_url AS owner_avatar_url,
    p.blocked,
    p.blocked_reason,
    COALESCE(tmr.tracked_seconds, 0) AS tracked_seconds,
    COALESCE(tr.estimated_hours, 0) AS estimated_hours,
    p.updated_at,
    COALESCE(cfv.fields, '{}'::JSONB) AS custom_fields
  FROM public.projects p
  LEFT JOIN public.clients c        ON c.id = p.client_id
  LEFT JOIN public.portfolios pf    ON pf.id = p.portfolio_id
  LEFT JOIN public.pipeline_stages ps ON ps.id = p.current_stage_id
  LEFT JOIN public.users u          ON u.id = p.owner_id
  LEFT JOIN stage_age sa            ON sa.project_id = p.id
  LEFT JOIN task_rollup tr          ON tr.project_id = p.id
  LEFT JOIN time_rollup tmr         ON tmr.project_id = p.id
  LEFT JOIN custom cfv              ON cfv.project_id = p.id
  WHERE p.company_id = v_company_id
    AND p.deleted_at IS NULL
    AND public.fn_project_accessible(p.id)
    AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%')
    AND (p_stage_id IS NULL OR p.current_stage_id = p_stage_id)
    AND (p_blocked IS NULL OR p.blocked = p_blocked)
  ORDER BY days_in_current_stage DESC NULLS LAST, p.id
  LIMIT  LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT) TO authenticated;
