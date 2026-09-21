-- Drafts are user-owned resumable state with optimistic revision checks.
BEGIN;

DO $check$
DECLARE
  v_uid uuid;
  v_key uuid := gen_random_uuid();
  v_draft public.user_onboarding_drafts%rowtype;
  v_failed boolean := false;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_onboarding_drafts' AND policyname = 'user_onboarding_drafts_read'), 'draft read policy missing';
  ASSERT has_function_privilege('authenticated', 'public.rpc_load_onboarding_draft()', 'EXECUTE'), 'draft load RPC ACL missing';
  ASSERT NOT has_table_privilege('authenticated', 'public.user_onboarding_drafts', 'INSERT'), 'draft insert leaked to authenticated';
  SELECT id INTO v_uid FROM public.users WHERE id IN (SELECT id FROM auth.users) LIMIT 1;
  ASSERT v_uid IS NOT NULL, 'no auth-backed user for draft check';
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  SELECT * INTO v_draft FROM public.rpc_save_onboarding_draft('create', 'size_band', '{"size_band":"small"}'::jsonb, v_key, 0);
  ASSERT v_draft.revision = 1, 'first draft revision is not one';
  SELECT * INTO v_draft FROM public.rpc_save_onboarding_draft('create', 'operating_models', '{"operating_models":["internal_operations"]}'::jsonb, v_key, 1);
  ASSERT v_draft.revision = 2, 'draft revision did not increment';
  SELECT * INTO v_draft FROM public.rpc_load_onboarding_draft();
  ASSERT v_draft.revision = 2 AND v_draft.idempotency_key = v_key, 'draft load did not return the current user draft';
  BEGIN
    PERFORM public.rpc_save_onboarding_draft('create', 'size_band', '{}'::jsonb, v_key, 1);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    ASSERT SQLERRM LIKE '%revision conflict%', 'draft conflict message is unclear';
  END;
  ASSERT v_failed, 'stale draft write unexpectedly succeeded';

  -- A completed draft (prior onboarding finished successfully) must not be
  -- resurfaced as resumable state, and a fresh onboarding attempt afterward
  -- must be able to start clean rather than hit a phantom revision conflict.
  UPDATE public.user_onboarding_drafts SET completed_at = now() WHERE user_id = v_uid;
  SELECT * INTO v_draft FROM public.rpc_load_onboarding_draft();
  ASSERT v_draft.user_id IS NULL, 'completed draft was still returned as resumable';
  SELECT * INTO v_draft FROM public.rpc_save_onboarding_draft('create', 'size_band', '{"size_band":"solo"}'::jsonb, gen_random_uuid(), 0);
  ASSERT v_draft.revision = 1 AND v_draft.completed_at IS NULL, 'fresh restart after a completed draft did not reset it';

  RAISE NOTICE 'check_user_onboarding_drafts: user boundary, resumability, optimistic conflict, and post-completion restart passed';
END;
$check$;

ROLLBACK;
