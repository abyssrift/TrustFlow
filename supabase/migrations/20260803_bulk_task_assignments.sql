-- Issue #198 — bulk task assignment for the project Assignments screen.
--
-- This is NOT a second assignment writer. `rpc_update_task_assignments` stays
-- the only thing that touches `task_assignments`; this wrapper just calls it
-- once per task inside ONE transaction. That matters three ways:
--
--   1. It inherits every guarantee the existing writer already proves — the
--      "only the task manager (or owner) may reassign" check, delete-then-
--      insert semantics, the `trg_task_assignments_notify` trigger, and the
--      `log_event` audit row. A hand-rolled bulk INSERT would have re-derived
--      all four and drifted (.agents/rules/global-utilities-index.md, rule 1).
--   2. It is atomic. A manager selecting 22 tasks either assigns all 22 or
--      none — a client-side Promise.all can fail on task 9 and leave the
--      engagement half-assigned with no way to tell which half.
--   3. One round trip instead of N. Issue #198: "A 22-task engagement should
--      not need 22 round trips."
--
-- The permission check is deliberately left inside the inner function and NOT
-- duplicated here: one predicate, one definition. If the caller may not
-- reassign task 9, the inner RAISE aborts the whole batch, which is the
-- correct answer — a partial bulk assign is worse than a refused one.
--
-- DROP + CREATE, never a bare CREATE OR REPLACE with a changed signature:
-- adding a parameter to a CREATE OR REPLACE creates an OVERLOAD rather than
-- replacing, and PostgREST then cannot resolve which one to call. That is
-- exactly what took out the pipeline editor earlier (see
-- 20260802_drop_stale_stage_rpc_overloads.sql). The DO block at the bottom
-- asserts exactly one signature survives.

DROP FUNCTION IF EXISTS public.rpc_bulk_update_task_assignments(uuid[], uuid[], uuid[]);

CREATE FUNCTION public.rpc_bulk_update_task_assignments(
  p_task_ids uuid[],
  p_user_ids uuid[] DEFAULT '{}'::uuid[],
  p_team_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER               -- the inner function is the SECURITY DEFINER one
SET search_path TO 'public'
AS $$
DECLARE
  v_task_id uuid;
  v_count   integer := 0;
BEGIN
  IF p_task_ids IS NULL OR array_length(p_task_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- DISTINCT so a duplicated id in the selection cannot make the same task
  -- pay the delete-then-insert cost twice (and emit two notifications).
  FOREACH v_task_id IN ARRAY ARRAY(SELECT DISTINCT unnest(p_task_ids)) LOOP
    PERFORM public.rpc_update_task_assignments(v_task_id, p_user_ids, p_team_ids);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_bulk_update_task_assignments(uuid[], uuid[], uuid[]) TO authenticated;

-- Assert exactly one signature exists, so this migration can never be the
-- thing that ships an ambiguous overload.
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_bulk_update_task_assignments';

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'rpc_bulk_update_task_assignments has % signatures, expected exactly 1', v_n;
  END IF;
END;
$$;
