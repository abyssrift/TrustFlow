-- 20260803_projects_table_field_filter.sql
-- Issue #197, plan docs/PROJECT_HIERARCHY_PLAN.md §18.3.
--
-- §18.3 chose typed custom fields over a JSONB blob for exactly ONE reason:
-- "a firm that filters 'Inventory Count Needed = YES' every week cannot do so
-- against inert JSON." That filter did not exist. Without it the blob would
-- have been the correct and cheaper call, so this is the migration that makes
-- the earlier decision true rather than aspirational.
--
-- ── Why this cannot be done client-side ───────────────────────────────────
-- rpc_projects_table pages with LIMIT/OFFSET. Filtering the 25 rows the client
-- happens to hold answers "which of this page matches", not "which projects
-- match" — the second page of an unfiltered query is not the second page of a
-- filtered one. Sorting is already page-local in ProjectsTable and that is
-- fine (a sort does not change the set); a filter is not.
--
-- ── Why a DO block and not a rewritten CREATE ─────────────────────────────
-- 1. ADDING A PARAMETER TO A CREATE OR REPLACE MAKES AN OVERLOAD, NOT A
--    REPLACEMENT. PostgREST then has two candidates and picks by the argument
--    names it is handed — which is how the pipeline editor broke earlier today
--    (20260802_drop_stale_stage_rpc_overloads.sql). So the old signature is
--    explicitly DROPped and exactly one signature is asserted at the end.
-- 2. The body is taken from the LIVE definition via pg_get_functiondef, never
--    retyped from a migration file. Recreating an RPC from a stale body has
--    silently dropped behaviour in this repo twice (rpc_filehub_group_list_
--    files), and rpc_projects_table specifically has already been patched in
--    place once since its last full CREATE
--    (20260803_project_stage_on_create_and_needs_attention.sql widened
--    "Needs attention"). Retyping it would have quietly reverted that.
--
-- ── Scope of the filter, deliberately small ──────────────────────────────
-- ponytail: three operators — equals / has any value / is blank. Ranges on
-- number and date fields are the obvious next ask and are NOT here; add them
-- when a real file needs them rather than guessing at a comparison vocabulary.
-- Equality covers the enum and boolean columns the corpus actually contains
-- ("Inventory Count Needed", "EL Status 2025", "Follow -up Status"), and
-- set/blank covers the "which rows did the spreadsheet leave empty" question
-- that a partially-filled column (62% coverage, §21.3 class C) always raises.

-- ── 1. One filter element, one predicate ─────────────────────────────────
-- Kept out of the patched string on purpose: a helper is greppable, testable
-- on its own (supabase/checks/check_project_field_filter.sql) and keeps the
-- text substitution below down to a single line that either matches or fails
-- loudly.
--
-- SECURITY INVOKER (the default). Called from inside rpc_projects_table it
-- runs as that function's owner and sees everything, which is correct — the
-- caller has already been narrowed to one company and to fn_project_accessible
-- rows. Called directly it would be RLS-bound like any other read, and it is
-- not granted to anyone anyway.
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
    )
    WHEN 'set' THEN EXISTS (
      SELECT 1
      FROM public.project_field_values v
      JOIN public.project_field_defs d ON d.id = v.field_def_id AND d.deleted_at IS NULL
      WHERE v.project_id = p_project_id AND d.key = p_filter ->> 'key'
    )
    ELSE EXISTS (
      SELECT 1
      FROM public.project_field_values v
      JOIN public.project_field_defs d ON d.id = v.field_def_id AND d.deleted_at IS NULL
      WHERE v.project_id = p_project_id AND d.key = p_filter ->> 'key'
        AND CASE d.data_type
              -- The regex guard is not decoration: an unguarded ::NUMERIC on a
              -- value typed into a filter box raises invalid_text_representation
              -- and takes the whole projects list down with it. A filter that
              -- cannot be satisfied must return no rows, never an error.
              WHEN 'number'  THEN (p_filter ->> 'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
                                  AND v.value_num = (p_filter ->> 'value')::NUMERIC
              WHEN 'date'    THEN v.value_date::TEXT = (p_filter ->> 'value')
              WHEN 'boolean' THEN v.value_bool = (lower(p_filter ->> 'value') IN ('true','yes','y','1'))
              -- Case- and whitespace-insensitive for text and enum alike:
              -- §21.1's rule that real files drift in case and padding applies
              -- to what a user types into a filter just as much as to a cell.
              ELSE lower(trim(v.value_text)) = lower(trim(p_filter ->> 'value'))
            END
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.fn_project_field_matches(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ── 2. Add p_field_filters to rpc_projects_table, from the live body ─────
DO $patch$
DECLARE
  v_def        TEXT;
  v_sig_needle TEXT := 'p_offset integer DEFAULT 0)';
  v_sig_repl   TEXT := 'p_offset integer DEFAULT 0, p_field_filters jsonb DEFAULT NULL)';
  v_ord_needle TEXT := E'\n  ORDER BY days_in_current_stage DESC NULLS LAST, p.id';
  v_pred       TEXT :=
    E'\n    -- #197: every element of p_field_filters must match (AND), so a row'   ||
    E'\n    -- survives only when NO element fails. [{"key":..,"op":"eq"|"set"'      ||
    E'\n    -- |"unset","value":..}]. ponytail: a correlated EXISTS per filter per'  ||
    E'\n    -- row, like the CTEs above it — measured in the same range on the'      ||
    E'\n    -- seeded set. Move it into the `custom` CTE if a company ever has'      ||
    E'\n    -- enough values for it to show up in a plan.'                           ||
    E'\n    AND (p_field_filters IS NULL OR NOT EXISTS ('                            ||
    E'\n      SELECT 1 FROM jsonb_array_elements(p_field_filters) ff'                ||
    E'\n      WHERE NOT public.fn_project_field_matches(p.id, ff)'                   ||
    E'\n    ))';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rpc_projects_table not found';
  END IF;

  IF position('p_field_filters' IN v_def) > 0 THEN
    RAISE NOTICE 'rpc_projects_table already takes p_field_filters; nothing to patch';
    RETURN;
  END IF;

  IF position(v_sig_needle IN v_def) = 0 OR position(v_ord_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'could not locate the signature or the ORDER BY — refusing to patch blindly';
  END IF;

  v_def := replace(v_def, v_sig_needle, v_sig_repl);
  v_def := replace(v_def, v_ord_needle, v_pred || v_ord_needle);

  -- The DROP is the whole point (see header note 1). CREATE OR REPLACE with an
  -- extra argument would leave the 5-arg version in place beside the 6-arg one.
  DROP FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT);
  EXECUTE v_def;
  RAISE NOTICE 'rpc_projects_table now filters on custom fields';
END
$patch$;

-- DROP takes the grants with it; pg_get_functiondef never carried them.
REVOKE EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB) TO authenticated;

DO $verify$
DECLARE v_sigs INT;
BEGIN
  SELECT count(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'rpc_projects_table must have exactly 1 signature, found % (overload trap)', v_sigs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace
      AND pg_get_function_identity_arguments(oid) =
          'p_search text, p_stage_id uuid, p_blocked boolean, p_limit integer, p_offset integer, p_field_filters jsonb'
  ) THEN
    RAISE EXCEPTION 'rpc_projects_table has the wrong single signature';
  END IF;

  -- The one that would have been silently lost by retyping the body.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace
      AND prosrc LIKE '%custom_fields%' AND prosrc LIKE '%Needs attention%'
  ) THEN
    RAISE EXCEPTION 'the patched body lost custom_fields or the widened "Needs attention" predicate';
  END IF;

  RAISE NOTICE 'rpc_projects_table: exactly one signature, custom_fields and "Needs attention" intact';
END
$verify$;
