-- FileHub file-visibility #163 Phase 3: save endpoint for a pipeline's file
-- visibility policy. Dedicated RPC (not folded into rpc_update_pipeline, which
-- already has overloads — adding a param there risks PostgREST ambiguity).
-- Only the preset is validated: unknown role/user ids in the config are
-- harmless, since fn_task_file_accessible fails closed on ids nobody holds.

CREATE OR REPLACE FUNCTION public.rpc_pipeline_set_file_visibility(
  p_pipeline_id uuid,
  p_config jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_uid     uuid := auth.uid();
  v_preset  text := p_config ->> 'preset';
BEGIN
  SELECT company_id INTO v_company FROM public.pipelines WHERE id = p_pipeline_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Pipeline not found'; END IF;
  IF v_company <> public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF NOT ((SELECT is_owner FROM public.users WHERE id = v_uid) = TRUE
          OR public.has_permission('pipeline.edit')) THEN
    RAISE EXCEPTION 'Insufficient permissions to edit pipelines';
  END IF;

  IF jsonb_typeof(p_config) <> 'object'
     OR v_preset IS NULL
     OR v_preset NOT IN ('task_members', 'submitters_reviewers', 'company', 'custom') THEN
    RAISE EXCEPTION 'Invalid file-visibility config';
  END IF;

  UPDATE public.pipelines
  SET file_visibility = p_config, updated_at = now()
  WHERE id = p_pipeline_id;

  PERFORM public.log_event(
    v_company, v_uid, 'pipeline', p_pipeline_id, 'pipeline.file_visibility_updated',
    jsonb_build_object('preset', v_preset)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_pipeline_set_file_visibility(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_pipeline_set_file_visibility(uuid, jsonb) TO authenticated;
