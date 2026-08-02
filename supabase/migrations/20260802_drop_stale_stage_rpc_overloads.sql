-- Fix: the pipeline editor cannot save or add a stage.
--
--   Could not choose the best candidate function between:
--     public.rpc_update_stage(... p_submission_mode => text),
--     public.rpc_update_stage(... p_submission_mode => text, p_harvests_to_deliverable => boolean)
--
-- WHAT HAPPENED
-- 20260801_project_deliverable.sql (#174, Phase 4) added the
-- `p_harvests_to_deliverable` toggle to rpc_update_stage and rpc_add_stage
-- using CREATE OR REPLACE FUNCTION. **Adding a parameter does not replace a
-- function — it creates an overload.** Postgres keys a function by
-- (name, argument types), so the 15-arg version stayed live next to the new
-- 16-arg one, and rpc_add_stage's 13-arg version next to its 14-arg one.
--
-- Every added parameter is DEFAULT NULL, so both signatures accept exactly
-- the same calls. PostgREST resolves an RPC by the SET OF ARGUMENT NAMES in
-- the request body; when the editor sends any subset that both signatures
-- satisfy, both match, neither is more specific, and PostgREST returns
-- PGRST203 rather than guessing. Result: stage update AND stage creation are
-- dead in the pipeline editor, for every pipeline in every company — not
-- only for projects.
--
-- Verified before dropping: pg_get_functiondef of the 16-arg body is the
-- 15-arg body plus the one new COALESCE column (whitespace realigned), and
-- likewise 14 vs 13. The newer signature therefore accepts every call the
-- older one did, so dropping the older is behaviour-preserving. The reverse
-- was the real hazard: with both live, a caller sending only the old names
-- could bind the OLD function and silently skip harvests_to_deliverable.
--
-- WHY THIS IS THE WHOLE FIX AND NOT A PATCH
-- The alternative — teaching the client to always send all 16 names — leaves
-- the ambiguity in the database for the next caller to trip over. One
-- signature per function is the invariant; enforce it here.
--
-- NOT fixed here, deliberately: rpc_create_pipeline (4/6),
-- rpc_update_pipeline (4/9), rpc_get_user_performance_series (3/4) and
-- rpc_notify_timer_auto_stopped (3/4) carry the identical latent trap — same
-- required-arg count, extra params defaulted, so they are equally ambiguous
-- and simply have not been called with a colliding name-set yet. They predate
-- this effort and each needs its own body diff and caller check before a drop.
-- Filed separately. rpc_filehub_analytics (1/2) is NOT this bug — its two
-- signatures take differently-named params, so PostgREST disambiguates fine.

DROP FUNCTION IF EXISTS public.rpc_update_stage(
  uuid, text, text, text, boolean, boolean, text, boolean, boolean,
  boolean, uuid, jsonb, integer, boolean, text
);

DROP FUNCTION IF EXISTS public.rpc_add_stage(
  uuid, text, text, text, boolean, boolean, text, boolean, boolean,
  boolean, jsonb, integer, text
);

DO $verify$
DECLARE
  v_update INT;
  v_add    INT;
BEGIN
  SELECT count(*) INTO v_update FROM pg_proc
   WHERE proname = 'rpc_update_stage' AND pronamespace = 'public'::regnamespace;
  SELECT count(*) INTO v_add FROM pg_proc
   WHERE proname = 'rpc_add_stage' AND pronamespace = 'public'::regnamespace;

  IF v_update <> 1 THEN
    RAISE EXCEPTION 'rpc_update_stage must have exactly 1 signature, found %', v_update;
  END IF;
  IF v_add <> 1 THEN
    RAISE EXCEPTION 'rpc_add_stage must have exactly 1 signature, found %', v_add;
  END IF;

  RAISE NOTICE 'rpc_update_stage and rpc_add_stage each have exactly one signature';
END
$verify$;
