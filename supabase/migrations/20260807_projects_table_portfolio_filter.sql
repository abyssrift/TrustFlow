-- 20260807_projects_table_portfolio_filter.sql
-- Phase 10 (#191) — a portfolio is a FILTER over projects, not a destination.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- /portfolios/[id] shipped its own hand-built project list: a direct select on
-- `projects` rendered as cards, with no search, no stage filter, no board, no
-- timeline, no sorting, no paging. Opening a batch therefore dropped you into a
-- strictly worse version of the screen you already had. The owner's words:
-- "portfolios are composed of projects after all" — so opening one lands on the
-- projects screen, scoped.
--
-- Scoping is a WHERE clause, which means it has to live in the one reader every
-- projects surface already shares (§16.1: "if a surface needs something the RPC
-- does not return, the RPC grows — it does not get a second implementation").
-- Three surfaces read this function with three dissimilar call shapes
-- (ProjectsTable paged+filtered, ProjectBoard one call per stage, ProjectsTimeline
-- one big page); a per-surface portfolio filter would be three filters.
--
-- ── ACCESS ─────────────────────────────────────────────────────────────────
-- The new predicate is ANDed into the existing WHERE, one line below
-- `public.fn_project_accessible(p.id)`. It is an INTERSECTION with access and
-- can only ever REMOVE rows: there is no code path in which passing a portfolio
-- id returns a project the same caller would not already have seen with
-- p_portfolio_id => NULL. Proven in
-- supabase/checks/20260807_projects_table_portfolio_filter_check.sql.
--
-- ── MECHANICS (same as 20260805_projects_table_projection_columns.sql and
--    20260806_project_needs_attention.sql — follow them, do not improvise) ───
--   * The live body is PATCHED from pg_get_functiondef, never retyped. This
--     body has been rewritten four times in a week (field filters, projection
--     columns, needs_attention) and retyping has silently dropped behaviour
--     twice in this repo.
--   * Every needle is anchored on a SINGLE line — stored bodies carry CRLF, so
--     a needle containing a bare \n matches nothing and silently no-ops.
--   * Every needle is guarded: a miss RAISEs and rolls back rather than
--     half-patching.
--   * The DROP is MANDATORY. `CREATE OR REPLACE` with a changed argument list
--     creates an OVERLOAD, not a replacement, and PostgREST then answers
--     PGRST203 to every caller. Asserted afterwards: exactly 1 signature.
--   * DROP takes the grants with it and pg_get_functiondef never carried them,
--     so REVOKE/GRANT are re-applied at the bottom.
--
-- ── BACKWARD COMPATIBILITY ─────────────────────────────────────────────────
-- p_portfolio_id is appended at the END with a NULL default, so both call
-- styles keep working: every app caller uses supabase.rpc() with NAMED params,
-- and the one positional caller in the repo
-- (supabase/checks/check_project_projection.sql: `(NULL, NULL, NULL, 500, 0,
-- NULL)`) still binds the same six arguments and defaults the seventh.


DO $patch$
DECLARE
  v_def  TEXT;
  v_sigs INT;

  -- (a) The argument list. `p_field_filters` is currently last; the new
  --     parameter goes after it so no existing positional call moves.
  v_sig_needle TEXT := 'p_field_filters jsonb DEFAULT NULL::jsonb)';
  v_sig_repl   TEXT := 'p_field_filters jsonb DEFAULT NULL::jsonb, p_portfolio_id uuid DEFAULT NULL::uuid)';

  -- (b) The WHERE clause. Anchored on the p_stage_id line — the nearest
  --     existing "narrow the list by one id" predicate, which is exactly what
  --     this is. `p.portfolio_id` must stay table-qualified: the RETURNS TABLE
  --     declares an OUT parameter also called `portfolio_id`.
  v_where_needle TEXT := '    AND (p_stage_id IS NULL OR p.current_stage_id = p_stage_id)';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rpc_projects_table not found';
  END IF;

  IF position('p_portfolio_id' IN v_def) > 0 THEN
    RAISE NOTICE 'rpc_projects_table already takes p_portfolio_id; nothing to patch';
    RETURN;
  END IF;

  IF position(v_sig_needle IN v_def) = 0 OR position(v_where_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'could not locate the argument list tail or the p_stage_id predicate -- refusing to patch blindly';
  END IF;

  v_def := replace(v_def, v_sig_needle, v_sig_repl);

  v_def := replace(v_def, v_where_needle, v_where_needle
    || E'\n    -- #191 Phase 10: opening a portfolio lands on THIS screen, scoped.'
    || E'\n    -- ANDed one line below fn_project_accessible on purpose -- an'
    || E'\n    -- intersection with access, never a substitute for it. It can only'
    || E'\n    -- remove rows from what the caller could already see.'
    || E'\n    AND (p_portfolio_id IS NULL OR p.portfolio_id = p_portfolio_id)');

  DROP FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB);
  EXECUTE v_def;

  SELECT count(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'rpc_projects_table must have exactly 1 signature, found % (overload trap)', v_sigs;
  END IF;

  RAISE NOTICE 'rpc_projects_table now takes p_portfolio_id';
END
$patch$;

-- DROP takes the grants with it; pg_get_functiondef never carried them.
REVOKE EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB, UUID) TO authenticated;

-- Belt and braces: prove the shipped signature is the one the clients call, and
-- that the needs_attention / custom_fields work that came before survived.
DO $$
DECLARE v_args TEXT; v_ret TEXT;
BEGIN
  SELECT pg_get_function_identity_arguments(oid), pg_get_function_result(oid)
    INTO v_args, v_ret
  FROM pg_proc WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;

  -- Names, not just types: PostgREST binds supabase.rpc()'s object keys to
  -- parameter NAMES, so a rename is as breaking as a retype.
  IF v_args <> 'p_search text, p_stage_id uuid, p_blocked boolean, p_limit integer, p_offset integer, p_field_filters jsonb, p_portfolio_id uuid' THEN
    RAISE EXCEPTION 'rpc_projects_table has the wrong single signature: (%)', v_args;
  END IF;
  IF position('needs_attention' IN v_ret) = 0 OR position('custom_fields' IN v_ret) = 0 THEN
    RAISE EXCEPTION 'rpc_projects_table lost columns during the patch: %', v_ret;
  END IF;

  RAISE NOTICE 'rpc_projects_table: exactly one signature (%), needs_attention and custom_fields intact', v_args;
END $$;
