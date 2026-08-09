-- 20260806_project_needs_attention.sql
-- Phase 10 (#191, plan §16.1) — ONE definition of "does this project need a
-- human", instead of the two that Phase 10 shipped a day apart.
--
-- ── THE DIVERGENCE THIS CLOSES ─────────────────────────────────────────────
-- rpc_projects_table's p_blocked filter (the Intelligence lens's attention
-- panel, and the projects list's "Needs attention" chip) said:
--
--     p.blocked OR (p.due_date IS NOT NULL AND p.due_date::date < CURRENT_DATE)
--
-- lib/projectExceptions.ts (the dashboard's "Needs Attention" panel) said
-- something strictly richer. Three concrete gaps in the server version:
--
--   1. It ignored `flags[]`. 20260801_project_header_flags.sql shipped
--      flags[]/flag_note ALONGSIDE the older blocked/blocked_reason and left
--      the two representations unreconciled. A project blocked through the
--      newer one was invisible to the filter — while the dashboard listed it.
--      (fn_trg_projects_notify_flags() in 20260805_project_notifications.sql
--      already unions them; this is that same union, not a third reading.)
--
--   2. It had NO done-exclusion. A FINISHED project that happened to be past
--      its due date still reported as needing attention. That one is a plain
--      user-visible bug, not merely an inconsistency.
--
--   3. It ignored overrun entirely — the forecast the RPC already computes
--      (fn_project_projection is joined LATERAL two lines above the filter)
--      landing after the due date.
--
-- §16.1: "If a surface needs a number it does not return, the RPC grows a
-- column; it does not get a second reader." So the SERVER definition becomes
-- the rich one and the client stops deriving its own — the resolution is NOT
-- to weaken the dashboard down to the filter.
--
-- ── WHY A FUNCTION AND NOT TWO INLINE COPIES ───────────────────────────────
-- The predicate is needed in two places in ONE query level: the SELECT list
-- (the new needs_attention column) and the WHERE clause (the p_blocked
-- filter). SQL cannot reference an output alias from the same level's WHERE,
-- so without a function the body would carry the boolean twice — which is the
-- exact failure mode this migration exists to delete, reproduced inside a
-- single function. fn_project_needs_attention() takes VALUES rather than a
-- project id on purpose: everything it needs is already joined and in scope at
-- both call sites, so it costs no extra lookup and, crucially, does not re-run
-- fn_project_projection() per row.
--
-- ── MECHANICS ──────────────────────────────────────────────────────────────
-- Same shape as 20260805_projects_table_projection_columns.sql, for the same
-- reasons: the live body is PATCHED from pg_get_functiondef (never retyped —
-- that has silently dropped behaviour twice in this repo), every needle is
-- anchored on a SINGLE line (stored bodies carry CRLF, so a needle with a bare
-- \n matches nothing), every needle is guarded so a miss rolls back instead of
-- half-patching, the DROP is mandatory because a changed RETURNS TABLE changes
-- the function's identity (CREATE OR REPLACE refuses; an added argument would
-- silently create an overload and earn a PGRST203), and the grants are
-- re-applied afterwards because DROP takes them and pg_get_functiondef never
-- carried them.
--
-- ADDITIVE ONLY: five columns appended at the END of the RETURNS list, no
-- existing column removed or reordered, and p_blocked keeps its NAME (renaming
-- it would create an overload — see 20260802_drop_stale_stage_rpc_overloads.sql).


-- ── 1. The one definition ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_project_needs_attention(
  p_blocked_flag          BOOLEAN,
  p_flags                 TEXT[],
  p_due_date              TIMESTAMPTZ,
  p_stage_is_terminal     BOOLEAN,
  p_stage_terminal_type   TEXT,
  p_projected_end         DATE,
  p_projection_confidence TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE                      -- CURRENT_DATE: stable within a statement, not immutable.
SET search_path TO 'public'
AS $$
  SELECT
    -- (a) BLOCKED — either live representation. A human said "stop", so this
    -- counts even in a terminal stage: the flag outranks the stage.
    COALESCE(p_blocked_flag, FALSE)
    OR 'blocked' = ANY (COALESCE(p_flags, '{}'::TEXT[]))
    -- (b) + (c) are both about a deadline, and a FINISHED project has no
    -- deadline left to miss. One done-exclusion, applied to both.
    OR (
      NOT COALESCE(p_stage_is_terminal AND p_stage_terminal_type = 'success', FALSE)
      AND (
        -- (b) OVERDUE.
        (p_due_date IS NOT NULL AND p_due_date::date < CURRENT_DATE)
        -- (c) OVERRUN — forecast to land after the due date, but ONLY at a
        -- confidence the server itself stands behind. 'none' means it refused
        -- to forecast (too few completed tasks); silence, not a guess. 'low'
        -- fires — the client renders it as uncertain rather than hiding it.
        OR (COALESCE(p_projection_confidence, 'none') <> 'none'
            AND p_projected_end IS NOT NULL
            AND p_due_date IS NOT NULL
            AND p_projected_end > p_due_date::date)
      )
    );
$$;

COMMENT ON FUNCTION public.fn_project_needs_attention(BOOLEAN, TEXT[], TIMESTAMPTZ, BOOLEAN, TEXT, DATE, TEXT)
  IS 'Issue #191 §16.1 — the single definition of "this project needs a human": blocked via either representation, OR (not finished AND (overdue OR forecast to overrun at a trusted confidence)). rpc_projects_table calls this for both its needs_attention column and its p_blocked filter; lib/projectExceptions.ts consumes the column rather than re-deriving it.';

REVOKE EXECUTE ON FUNCTION public.fn_project_needs_attention(BOOLEAN, TEXT[], TIMESTAMPTZ, BOOLEAN, TEXT, DATE, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_project_needs_attention(BOOLEAN, TEXT[], TIMESTAMPTZ, BOOLEAN, TEXT, DATE, TEXT) TO authenticated;


-- ── 2. Grow rpc_projects_table, and point its filter at the same body ──────
DO $patch$
DECLARE
  v_def  TEXT;
  v_sigs INT;

  -- The call, written once here so the column and the filter are literally the
  -- same text. Every argument is already in scope at both sites: `p` is the
  -- base table, `ps` is the LEFT JOIN on p.current_stage_id, `fpp` is the
  -- LEFT JOIN LATERAL fn_project_projection(p.id).
  v_call TEXT := 'public.fn_project_needs_attention(p.blocked, p.flags, p.due_date, ps.is_terminal, ps.terminal_type, fpp.projected_end, fpp.confidence)';

  -- (a) RETURNS list — five columns appended at the end.
  --     needs_attention           the predicate itself.
  --     flags / flag_note         so the dashboard panel stops issuing a
  --     stage_is_terminal /       follow-up `projects` select and a follow-up
  --     stage_terminal_type       `pipeline_stages` select purely to render
  --                               the badge and rank the list. Raw passthroughs
  --                               of columns already joined — no new
  --                               definitions, two fewer round trips.
  v_ret_needle TEXT := ', projection_confidence text)';
  v_ret_repl   TEXT := ', projection_confidence text, needs_attention boolean, flags text[], flag_note text, stage_is_terminal boolean, stage_terminal_type text)';

  -- (b) SELECT list — appended after the last existing expression.
  v_sel_needle TEXT := '    fpp.confidence AS projection_confidence';

  -- (c) The p_blocked filter, and the comment describing it. Two single-line
  --     needles inside the CASE, so the filter can never drift from the column.
  v_then_needle TEXT := '          THEN p.blocked OR (p.due_date IS NOT NULL AND p.due_date::date < CURRENT_DATE)';
  v_else_needle TEXT := '          ELSE NOT p.blocked AND NOT (p.due_date IS NOT NULL AND p.due_date::date < CURRENT_DATE)';
  v_c1_needle   TEXT := '    -- TRUE means "this row wants a human": explicitly blocked, OR past its';
  v_c2_needle   TEXT := '    -- due date and not finished. A 174-day-overdue project was previously';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rpc_projects_table not found';
  END IF;

  IF position('needs_attention' IN v_def) > 0 THEN
    RAISE NOTICE 'rpc_projects_table already returns needs_attention; nothing to patch';
    RETURN;
  END IF;

  IF position(v_ret_needle  IN v_def) = 0
     OR position(v_sel_needle  IN v_def) = 0
     OR position(v_then_needle IN v_def) = 0
     OR position(v_else_needle IN v_def) = 0
     OR position(v_c1_needle   IN v_def) = 0
     OR position(v_c2_needle   IN v_def) = 0 THEN
    RAISE EXCEPTION 'could not locate the RETURNS list, the SELECT tail, or both arms of the p_blocked CASE -- refusing to patch blindly';
  END IF;

  v_def := replace(v_def, v_ret_needle, v_ret_repl);

  v_def := replace(v_def, v_sel_needle, v_sel_needle || ','
    || E'\n    -- #191 §16.1: the ONE definition of "needs a human". The WHERE'
    || E'\n    -- clause below calls this same function, so the column and the'
    || E'\n    -- p_blocked filter cannot disagree about a single row.'
    || E'\n    ' || v_call || ' AS needs_attention,'
    || E'\n    -- Raw passthroughs so the dashboard panel can render the badge'
    || E'\n    -- and rank the list without two follow-up selects.'
    || E'\n    p.flags,'
    || E'\n    p.flag_note,'
    || E'\n    ps.is_terminal AS stage_is_terminal,'
    || E'\n    ps.terminal_type AS stage_terminal_type');

  v_def := replace(v_def, v_then_needle, '          THEN ' || v_call);
  v_def := replace(v_def, v_else_needle, '          ELSE NOT ' || v_call);

  v_def := replace(v_def, v_c1_needle,
       '    -- TRUE means "this row wants a human", defined in exactly ONE place:'
    || E'\n    -- public.fn_project_needs_attention(). Blocked through EITHER live'
    || E'\n    -- representation (projects.blocked or ''blocked'' in flags[]), OR past its');
  v_def := replace(v_def, v_c2_needle,
       '    -- due date, OR forecast to land after it at a confidence the server'
    || E'\n    -- itself trusts -- the last two only when the project is not already in'
    || E'\n    -- a success-terminal stage, because a FINISHED project has no deadline'
    || E'\n    -- left to miss. A 174-day-overdue project was previously');

  DROP FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB);
  EXECUTE v_def;

  SELECT count(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'rpc_projects_table must have exactly 1 signature, found % (overload trap)', v_sigs;
  END IF;

  RAISE NOTICE 'rpc_projects_table now returns needs_attention (+ flags, flag_note, stage_is_terminal, stage_terminal_type) and filters on the same function';
END
$patch$;

-- DROP takes the grants with it; pg_get_functiondef never carried them.
REVOKE EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB) TO authenticated;
