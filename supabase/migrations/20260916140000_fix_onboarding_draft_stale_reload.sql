-- Bug: rpc_load_onboarding_draft() returned a draft row even after it had
-- already been marked completed_at (i.e. the user finished onboarding once
-- and it succeeded). A user who disbands their workspace (rpc_delete_company
-- nulls users.company_id) and re-enters onboarding got their OLD answers
-- AND old idempotency_key silently rehydrated by the client.
--
-- That reused idempotency_key then hit the replay short-circuit in
-- rpc_create_company_and_link: it matched the row already sitting in
-- company_onboarding_profiles from the FIRST (now-disbanded) company and
-- returned that stale profile result immediately, without ever calling the
-- one-arg rpc_create_company_and_link(name) that actually creates a company
-- and links users.company_id. The UI showed "Workspace ready" based on the
-- stale result, but the user's company_id was still NULL — so every
-- subsequent company-scoped RPC (e.g. starter template creation) failed
-- with "Authentication is required".
--
-- Fix: a completed draft is not resumable state, so stop returning it.
CREATE OR REPLACE FUNCTION public.rpc_load_onboarding_draft()
RETURNS public.user_onboarding_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_draft public.user_onboarding_drafts%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  SELECT * INTO v_draft FROM public.user_onboarding_drafts WHERE user_id = auth.uid() AND completed_at IS NULL;
  RETURN v_draft;
END;
$function$;

-- Once a completed draft is no longer loaded, a user starting a second
-- onboarding attempt saves with p_expected_revision = 0 while their old
-- completed row (same PRIMARY KEY user_id) still exists in the table. The
-- original INSERT ... ON CONFLICT DO NOTHING treated that as an unresolvable
-- conflict ('Onboarding draft revision conflict'). Allow the fresh-start
-- path to reset a completed row in place; a conflicting row that is NOT yet
-- completed (a real concurrent-save race) still falls through to the
-- exception, preserving the original safety check.
CREATE OR REPLACE FUNCTION public.rpc_save_onboarding_draft(
  p_branch text,
  p_step_key text,
  p_answers jsonb,
  p_idempotency_key uuid,
  p_expected_revision integer
)
RETURNS public.user_onboarding_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_draft public.user_onboarding_drafts%rowtype;
BEGIN
  IF v_user_id IS NULL OR p_branch NOT IN ('create', 'join') OR p_step_key IS NULL OR p_idempotency_key IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Invalid onboarding draft';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding-draft:' || v_user_id::text, 414));
  IF p_expected_revision = 0 THEN
    INSERT INTO public.user_onboarding_drafts (user_id, branch, step_key, answers, idempotency_key, revision, completed_at, updated_at)
    VALUES (v_user_id, p_branch, p_step_key, COALESCE(p_answers, '{}'::jsonb), p_idempotency_key, 1, NULL, now())
    ON CONFLICT (user_id) DO UPDATE
      SET branch = EXCLUDED.branch, step_key = EXCLUDED.step_key, answers = EXCLUDED.answers,
          idempotency_key = EXCLUDED.idempotency_key, revision = 1, completed_at = NULL, updated_at = now()
      WHERE public.user_onboarding_drafts.completed_at IS NOT NULL
    RETURNING * INTO v_draft;
    IF v_draft.user_id IS NULL THEN RAISE EXCEPTION 'Onboarding draft revision conflict'; END IF;
  ELSE
    UPDATE public.user_onboarding_drafts
       SET branch = p_branch, step_key = p_step_key, answers = COALESCE(p_answers, '{}'::jsonb),
           idempotency_key = p_idempotency_key, revision = revision + 1, updated_at = now()
     WHERE user_id = v_user_id AND revision = p_expected_revision AND completed_at IS NULL
     RETURNING * INTO v_draft;
    IF v_draft.user_id IS NULL THEN RAISE EXCEPTION 'Onboarding draft revision conflict'; END IF;
  END IF;
  RETURN v_draft;
END;
$function$;
