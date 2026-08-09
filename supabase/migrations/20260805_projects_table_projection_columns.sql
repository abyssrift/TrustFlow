-- 20260805_projects_table_projection_columns.sql
-- Phase 10 (#191) — the Timeline tab needs a start, an end, and a forecast per
-- project. rpc_projects_table already returns the first two thirds of that.
--
-- §16.1's rule, quoted: "If a surface needs a number it does not return, the
-- RPC grows a column; it does not get a second reader." So this grows it,
-- rather than adding rpc_projects_timeline beside it — which would have been
-- easier to write and would have been the sixth reader in a codebase that has
-- already paid for that mistake under four other names.
--
-- Three columns:
--   start_date            — already on `projects`, simply never selected. The
--                           timeline cannot draw a bar without a left edge.
--   projected_end         — from fn_project_projection, the same single
--                           definition rpc_project_health and
--                           rpc_portfolios_table read. The timeline, the
--                           project page and the portfolio card therefore
--                           cannot show three different dates for one project.
--   projection_confidence — carried so the timeline can draw a forecast
--                           differently from a fact, and draw nothing at all
--                           when the server says 'none'. §16.2: a confident
--                           wrong date is worse than no date, and that is only
--                           enforceable if the confidence travels WITH the
--                           date rather than being re-derived per surface.
--
-- Patched from the LIVE body via pg_get_functiondef, not retyped: this
-- function has already been rewritten twice this week (field filters, then the
-- needs-attention predicate) and retyping a long body from a remembered
-- migration has silently dropped behaviour twice in this repo.
--
-- The DROP is mandatory and is the whole reason this is a DO block rather than
-- a CREATE OR REPLACE: changing the RETURNS TABLE changes the function's
-- identity, and REPLACE would refuse ("cannot change return type of existing
-- function") while an added argument would silently create an overload and
-- earn a PGRST203 from PostgREST.

DO $patch$
DECLARE
  v_def        TEXT;
  -- End of the RETURNS TABLE list.
  v_ret_needle TEXT := ', custom_fields jsonb)';
  v_ret_repl   TEXT := ', custom_fields jsonb, start_date timestamp with time zone, projected_end date, projection_confidence text)';
  -- NO NEWLINES IN ANY NEEDLE. The live body carries CRLF line endings (it was
  -- installed from a file checked out on Windows), so a needle containing a
  -- bare \n silently matches nothing — which is exactly what happened on the
  -- first attempt: the alias matched at 4333 and the FROM line at 4351, 18
  -- apart for a 17-character alias, and the extra byte was the \r. The guard
  -- below caught it rather than patching half the function, but the lesson is
  -- to anchor on single lines and let the original terminators stay where they
  -- are.
  v_sel_needle TEXT := ' AS custom_fields';
  v_sel_repl   TEXT := ' AS custom_fields,'
                    || E'\n    p.start_date,'
                    || E'\n    -- Phase 10: one definition of "when does this land", read here'
                    || E'\n    -- rather than recomputed.'
                    || E'\n    fpp.projected_end,'
                    || E'\n    fpp.confidence AS projection_confidence';
  -- The LATERAL goes at the HEAD of the join chain, immediately after the base
  -- table — not before ORDER BY, which is after the WHERE clause and where a
  -- JOIN is a syntax error (first attempt did exactly that and was rejected by
  -- the parser). It only references `p`, so the earliest legal position is
  -- also the correct one, and every existing LEFT JOIN still chains after it.
  v_ord_needle TEXT := '  FROM public.projects p';
  v_lat        TEXT := '  LEFT JOIN LATERAL public.fn_project_projection(p.id) fpp ON TRUE';
  v_sigs       INT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rpc_projects_table not found';
  END IF;

  IF position('projection_confidence' IN v_def) > 0 THEN
    RAISE NOTICE 'rpc_projects_table already returns the projection columns; nothing to patch';
    RETURN;
  END IF;

  IF position(v_ret_needle IN v_def) = 0
     OR position(v_sel_needle IN v_def) = 0
     OR position(v_ord_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'could not locate the RETURNS list, the final SELECT tail, or the ORDER BY — refusing to patch blindly';
  END IF;

  v_def := replace(v_def, v_ret_needle, v_ret_repl);
  v_def := replace(v_def, v_sel_needle, v_sel_repl);
  v_def := replace(v_def, v_ord_needle, v_ord_needle || E'\n' || v_lat);

  DROP FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB);
  EXECUTE v_def;

  SELECT count(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'rpc_projects_table must have exactly 1 signature, found % (overload trap)', v_sigs;
  END IF;

  RAISE NOTICE 'rpc_projects_table now returns start_date, projected_end and projection_confidence';
END
$patch$;

-- DROP takes the grants with it; pg_get_functiondef never carried them.
REVOKE EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB) TO authenticated;
