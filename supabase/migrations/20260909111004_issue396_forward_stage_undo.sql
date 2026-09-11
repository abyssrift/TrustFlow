-- #396 DB package
-- Clean up names from the rejected local prototype so every environment keeps
-- one canonical action/submission API.
DROP FUNCTION IF EXISTS public.rpc_execute_stage_action_legacy(uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.rpc_submit_work_legacy(uuid,text,uuid,uuid,jsonb);
CREATE TABLE IF NOT EXISTS public.task_stage_undo_ledger (undo_token uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,from_stage_id uuid,to_stage_id uuid NOT NULL,actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,history_id uuid NOT NULL REFERENCES public.pipeline_stage_history(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,consumed_at timestamptz,undoable boolean NOT NULL DEFAULT false,refusal_reasons jsonb NOT NULL DEFAULT '[]',effect_flags jsonb NOT NULL DEFAULT '{}',undo_history_id uuid REFERENCES public.pipeline_stage_history(id) ON DELETE SET NULL);
ALTER TABLE public.pipeline_stage_history ADD COLUMN IF NOT EXISTS recorded_at timestamptz;
UPDATE public.pipeline_stage_history SET recorded_at=transitioned_at WHERE recorded_at IS NULL;
ALTER TABLE public.pipeline_stage_history ALTER COLUMN recorded_at SET DEFAULT clock_timestamp();
ALTER TABLE public.pipeline_stage_history ALTER COLUMN recorded_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS pipeline_stage_history_task_recorded_idx ON public.pipeline_stage_history(task_id,recorded_at,id);
ALTER TABLE public.task_stage_undo_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_stage_undo_ledger FROM anon,authenticated,public;
CREATE OR REPLACE FUNCTION public.fn_trg_harvest_task_on_stage_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF current_setting('trustflow.undo_forward_stage',true)='on' THEN RETURN NEW; END IF; IF COALESCE((SELECT harvests_to_deliverable FROM public.pipeline_stages WHERE id=NEW.current_stage_id),false) THEN PERFORM public.fn_harvest_task_output(NEW.id); END IF; RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.rpc_advance_stage(p_task_id uuid, p_to_stage_id uuid, p_submission_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID; v_user_id UUID := auth.uid(); v_current_stage UUID; v_pipeline_id UUID;
  v_from_name TEXT; v_to_name TEXT; v_target_pipe UUID; v_requires_sub BOOLEAN; v_requires_att BOOLEAN;
  v_is_terminal BOOLEAN; v_linked_pipe UUID; v_child_inherits BOOLEAN; v_reassign BOOLEAN;
  v_harvest BOOLEAN; v_sub_content TEXT; v_att_count INTEGER; v_child UUID; v_src UUID; v_new UUID; v_child_stage UUID;
  v_history UUID; v_claimed BOOLEAN; v_cross BOOLEAN; v_unauth BOOLEAN; v_flags JSONB; v_refusals JSONB := '[]'::jsonb;
  v_undoable BOOLEAN; v_token UUID;
BEGIN
  SELECT company_id,current_stage_id,pipeline_id,claimed_by IS NOT NULL INTO v_company_id,v_current_stage,v_pipeline_id,v_claimed
  FROM public.tasks WHERE id=p_task_id AND deleted_at IS NULL FOR UPDATE;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_user_id IS NOT NULL AND v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  v_unauth := v_user_id IS NULL;
  SELECT requires_submission,requires_attachments INTO v_requires_sub,v_requires_att FROM public.pipeline_stages WHERE id=v_current_stage;
  IF v_user_id IS NOT NULL AND (COALESCE(v_requires_sub,FALSE) OR COALESCE(v_requires_att,FALSE)) THEN
    SELECT content INTO v_sub_content FROM public.task_submissions WHERE task_id=p_task_id AND stage_id=v_current_stage AND status IN ('pending','approved') ORDER BY submitted_at DESC LIMIT 1;
    SELECT count(*) INTO v_att_count FROM public.submission_attachments WHERE submission_id IN (SELECT id FROM public.task_submissions WHERE task_id=p_task_id AND stage_id=v_current_stage AND status IN ('pending','approved'));
    IF COALESCE(v_requires_sub,FALSE) AND (v_sub_content IS NULL OR btrim(v_sub_content)='') AND v_att_count=0 THEN RAISE EXCEPTION 'Stage advancement blocked: Mandatory evidence missing (Text or Attachments required).'; END IF;
    IF COALESCE(v_requires_att,FALSE) AND v_att_count=0 THEN RAISE EXCEPTION 'Stage advancement blocked: Mandatory attachments missing.'; END IF;
  END IF;
  SELECT ps.pipeline_id INTO v_target_pipe FROM public.pipeline_stages ps JOIN public.pipelines p ON p.id=ps.pipeline_id WHERE ps.id=p_to_stage_id AND p.subject_kind='task';
  IF v_target_pipe IS NULL THEN RAISE EXCEPTION 'Target stage not found or is not in a task pipeline'; END IF;
  IF v_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id=v_user_id AND is_owner=TRUE) AND v_pipeline_id=v_target_pipe AND NOT EXISTS (SELECT 1 FROM public.pipeline_stage_transitions WHERE from_stage_id=v_current_stage AND to_stage_id=p_to_stage_id) THEN RAISE EXCEPTION 'Invalid stage transition path'; END IF;
  v_cross := v_pipeline_id IS DISTINCT FROM v_target_pipe;
  SELECT name INTO v_from_name FROM public.pipeline_stages WHERE id=v_current_stage;
  SELECT name,linked_pipeline_id,child_inherits_submission,reassign_on_entry,harvests_to_deliverable,is_terminal INTO v_to_name,v_linked_pipe,v_child_inherits,v_reassign,v_harvest,v_is_terminal FROM public.pipeline_stages WHERE id=p_to_stage_id;
  v_flags := jsonb_build_object('submission_linked',p_submission_id IS NOT NULL,'linked_child_configured',v_linked_pipe IS NOT NULL,'linked_child_created',false,'terminal_handshake_would_fire',COALESCE(v_is_terminal,FALSE),'terminal_handshake_fired',false,'reassign_configured',COALESCE(v_reassign,FALSE),'deliverable_harvest_destination',COALESCE(v_harvest,FALSE),'claim_present',v_claimed,'claim_cleared',v_claimed,'cross_pipeline',v_cross,'unauthenticated_system',v_unauth);
  IF p_submission_id IS NOT NULL THEN v_refusals := v_refusals || '["submission_linked"]'::jsonb; END IF;
  IF v_linked_pipe IS NOT NULL THEN v_refusals := v_refusals || '["linked_child"]'::jsonb; END IF;
  IF v_is_terminal THEN v_refusals := v_refusals || '["terminal_handshake"]'::jsonb; END IF;
  IF v_reassign THEN v_refusals := v_refusals || '["reassignment"]'::jsonb; END IF;
  IF v_harvest THEN v_refusals := v_refusals || '["deliverable_harvest"]'::jsonb; END IF;
  IF v_claimed THEN v_refusals := v_refusals || '["claim_clear"]'::jsonb; END IF;
  IF v_cross THEN v_refusals := v_refusals || '["cross_pipeline"]'::jsonb; END IF;
  IF v_unauth THEN v_refusals := v_refusals || '["system_or_unauthenticated"]'::jsonb; END IF;
  UPDATE public.tasks SET current_stage_id=p_to_stage_id,pipeline_id=v_target_pipe,updated_at=now() WHERE id=p_task_id;
  INSERT INTO public.pipeline_stage_history(task_id,company_id,pipeline_id,from_stage_id,to_stage_id,transitioned_by,from_stage_name,to_stage_name,submission_id)
  VALUES(p_task_id,v_company_id,v_target_pipe,v_current_stage,p_to_stage_id,v_user_id,v_from_name,v_to_name,p_submission_id) RETURNING id INTO v_history;
  IF v_linked_pipe IS NOT NULL THEN
    SELECT public.spawn_recursive_task(p_task_id,v_linked_pipe) INTO v_child;
    v_flags := jsonb_set(v_flags,'{linked_child_created}',to_jsonb(v_child IS NOT NULL));
    IF v_child_inherits AND v_child IS NOT NULL THEN
      v_src := p_submission_id; IF v_src IS NULL THEN SELECT id INTO v_src FROM public.task_submissions WHERE task_id=p_task_id AND status IN ('pending','approved') ORDER BY submitted_at DESC LIMIT 1; END IF;
      IF v_src IS NOT NULL THEN SELECT id INTO v_child_stage FROM public.pipeline_stages WHERE pipeline_id=v_linked_pipe AND is_initial=TRUE LIMIT 1;
        INSERT INTO public.task_submissions(task_id,company_id,submitted_by,content,stage_id,status,revision_count) SELECT v_child,company_id,submitted_by,content,COALESCE(v_child_stage,stage_id),'pending',1 FROM public.task_submissions WHERE id=v_src RETURNING id INTO v_new;
        INSERT INTO public.submission_attachments(submission_id,company_id,uploaded_by,file_name,file_url,file_size,mime_type,category,storage_path) SELECT v_new,company_id,uploaded_by,file_name,file_url,file_size,mime_type,category,storage_path FROM public.submission_attachments WHERE submission_id=v_src;
      END IF;
    END IF;
  END IF;
  IF v_is_terminal THEN PERFORM public.fn_handle_task_handshake(p_task_id,p_to_stage_id); v_flags := jsonb_set(v_flags,'{terminal_handshake_fired}','true'::jsonb); END IF;
  IF v_reassign THEN PERFORM public.rpc_auto_assign_task(p_task_id,'reassign'); END IF;
  v_undoable := v_user_id IS NOT NULL AND NOT v_cross AND p_submission_id IS NULL AND v_linked_pipe IS NULL AND NOT v_is_terminal AND NOT v_reassign AND NOT v_harvest AND NOT v_claimed;
  INSERT INTO public.task_stage_undo_ledger(task_id,company_id,pipeline_id,from_stage_id,to_stage_id,actor_id,history_id,expires_at,undoable,refusal_reasons,effect_flags)
  VALUES(p_task_id,v_company_id,v_target_pipe,v_current_stage,p_to_stage_id,v_user_id,v_history,now()+interval '30 seconds',v_undoable,v_refusals,v_flags) RETURNING undo_token INTO v_token;
  RETURN jsonb_build_object('history_id',v_history,'undo_token',v_token,'undoable',v_undoable,'refusal_reasons',v_refusals,'from_stage_id',v_current_stage,'to_stage_id',p_to_stage_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rpc_advance_stage(uuid,uuid,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_advance_stage(uuid,uuid,uuid) FROM anon,public;
CREATE OR REPLACE FUNCTION public.rpc_undo_forward_stage(p_task_id uuid, p_undo_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l public.task_stage_undo_ledger%ROWTYPE; t public.tasks%ROWTYPE; h uuid; n1 text; n2 text;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id=p_task_id AND deleted_at IS NULL FOR UPDATE;
  IF t.id IS NULL OR auth.uid() IS NULL OR t.company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO l FROM public.task_stage_undo_ledger WHERE undo_token=p_undo_token AND task_id=p_task_id FOR UPDATE;
  IF l.undo_token IS NULL THEN RAISE EXCEPTION 'Invalid undo token'; END IF;
  IF NOT (l.actor_id=auth.uid() OR COALESCE((SELECT is_owner FROM public.users WHERE id=auth.uid()),false) OR public.has_permission('pipeline.reverse')) THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF NOT l.undoable OR l.consumed_at IS NOT NULL OR l.expires_at < now() THEN RAISE EXCEPTION 'Undo token is stale, refused, or already consumed'; END IF;
  IF t.current_stage_id IS DISTINCT FROM l.to_stage_id OR t.pipeline_id IS DISTINCT FROM l.pipeline_id THEN RAISE EXCEPTION 'Undo token is not the current task transition'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_stage_history x WHERE x.id=l.history_id AND x.task_id=p_task_id AND x.to_stage_id=t.current_stage_id AND x.is_reversal=FALSE AND NOT EXISTS (SELECT 1 FROM public.pipeline_stage_history y WHERE y.task_id=p_task_id AND (y.recorded_at,y.id)>(x.recorded_at,x.id))) THEN RAISE EXCEPTION 'Undo token is not the latest history event'; END IF;
  IF l.from_stage_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.pipeline_stages s WHERE s.id=l.from_stage_id AND s.pipeline_id=l.pipeline_id) THEN RAISE EXCEPTION 'Undo source stage is invalid'; END IF;
  PERFORM set_config('trustflow.undo_forward_stage','on',true);
  UPDATE public.tasks SET current_stage_id=l.from_stage_id,updated_at=now() WHERE id=p_task_id AND current_stage_id=l.to_stage_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task changed while undoing'; END IF;
  SELECT name INTO n1 FROM public.pipeline_stages WHERE id=l.to_stage_id; SELECT name INTO n2 FROM public.pipeline_stages WHERE id=l.from_stage_id;
  INSERT INTO public.pipeline_stage_history(task_id,company_id,pipeline_id,from_stage_id,to_stage_id,transitioned_by,from_stage_name,to_stage_name,is_reversal) VALUES(p_task_id,t.company_id,l.pipeline_id,l.to_stage_id,l.from_stage_id,auth.uid(),n1,n2,true) RETURNING id INTO h;
  UPDATE public.task_stage_undo_ledger SET consumed_at=now(),undo_history_id=h WHERE undo_token=p_undo_token;
  RETURN jsonb_build_object('history_id',h,'undo_token',p_undo_token,'task_id',p_task_id,'from_stage_id',l.to_stage_id,'to_stage_id',l.from_stage_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rpc_undo_forward_stage(uuid,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_undo_forward_stage(uuid,uuid) FROM anon,public;
CREATE OR REPLACE FUNCTION public.rpc_execute_stage_action(
    p_task_id    UUID,
    p_action_id  UUID,
    p_payload    JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id              UUID    := auth.uid();
    v_company_id           UUID;
    v_task                 RECORD;
    v_action               RECORD;
    v_is_owner             BOOLEAN;
    v_is_assigned          BOOLEAN;
    v_is_manager           BOOLEAN;
    v_is_creator           BOOLEAN;
    v_sub_id               UUID;
    v_assignment_id        UUID;
    v_stage_requires_timer BOOLEAN;
    v_stage_is_initial     BOOLEAN;
    v_min_timer_seconds    INTEGER;
    v_total_seconds        INTEGER;
    v_manual_entry_status  TEXT;
    v_transition_meta      JSONB;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL FOR UPDATE;
    IF v_task IS NULL THEN RAISE EXCEPTION 'Task not found or deleted'; END IF;

    v_company_id := v_task.company_id;
    IF v_company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized: task belongs to a different company';
    END IF;

    SELECT * INTO v_action FROM public.pipeline_stage_actions WHERE id = p_action_id AND is_active = TRUE;
    IF v_action IS NULL THEN RAISE EXCEPTION 'Action not found or inactive'; END IF;
    IF v_action.stage_id != v_task.current_stage_id THEN
        RAISE EXCEPTION 'Action does not belong to the task''s current stage';
    END IF;

    v_is_owner   := (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE;
    v_is_creator := v_task.created_by = v_user_id;
    v_is_manager := v_task.manager_id = v_user_id;

    SELECT id INTO v_assignment_id
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND (
        assignee_user_id = v_user_id
        OR assignee_team_id IN (
            SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
        )
      )
    LIMIT 1;
    v_is_assigned := v_assignment_id IS NOT NULL;

    IF NOT v_is_owner THEN
        CASE v_action.required_role
            WHEN 'any'      THEN NULL;
            WHEN 'assignee' THEN IF NOT v_is_assigned THEN RAISE EXCEPTION 'Only assigned users can perform this action'; END IF;
            WHEN 'manager'  THEN IF NOT v_is_manager  THEN RAISE EXCEPTION 'Only the task manager can perform this action'; END IF;
            WHEN 'reviewer' THEN
                IF NOT (v_is_manager OR public.has_permission('submission.review')) THEN
                    RAISE EXCEPTION 'Only reviewers can perform this action';
                END IF;
            WHEN 'creator'  THEN IF NOT v_is_creator  THEN RAISE EXCEPTION 'Only the task creator can perform this action'; END IF;
            ELSE IF NOT public.has_permission(v_action.required_role) THEN
                RAISE EXCEPTION 'Missing required permission: %', v_action.required_role;
            END IF;
        END CASE;
    END IF;

    IF v_action.precondition IS NOT NULL THEN
        CASE v_action.precondition
            WHEN 'has_pending_submission' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending') THEN
                    RAISE EXCEPTION 'Precondition failed: no pending submission exists';
                END IF;
            WHEN 'no_pending_submission' THEN
                IF EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending') THEN
                    RAISE EXCEPTION 'Precondition failed: a pending submission already exists';
                END IF;
            WHEN 'is_assigned' THEN
                IF NOT v_is_assigned THEN RAISE EXCEPTION 'Precondition failed: you must be assigned to this task'; END IF;
            WHEN 'has_approved_submission' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'approved') THEN
                    RAISE EXCEPTION 'Precondition failed: no approved submission exists';
                END IF;
            WHEN 'has_attachment' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_attachments WHERE task_id = p_task_id) THEN
                    RAISE EXCEPTION 'Precondition failed: task has no attachments';
                END IF;
            WHEN 'all_subtasks_complete' THEN
                IF EXISTS (
                    SELECT 1 FROM public.tasks child
                    WHERE child.parent_task_id = p_task_id AND child.deleted_at IS NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM public.pipeline_stages ps
                          WHERE ps.id = child.current_stage_id AND ps.is_terminal = TRUE AND ps.terminal_type = 'success'
                      )
                ) THEN
                    RAISE EXCEPTION 'Precondition failed: not all subtasks are completed';
                END IF;
            ELSE NULL;
        END CASE;
    END IF;

    -- Timer gate: advance actions only.
    -- Applies to the ASSIGNED worker. A manager/owner who is not assigned
    -- bypasses the gate to keep workflow moving. An assigned worker who also
    -- happens to be manager/owner must still declare their time.
    SELECT COALESCE(ps.requires_timer, false),
           COALESCE(ps.is_initial, false),
           COALESCE(ps.min_timer_seconds, 300)
    INTO v_stage_requires_timer, v_stage_is_initial, v_min_timer_seconds
    FROM public.pipeline_stages ps WHERE ps.id = v_task.current_stage_id;

    IF v_stage_requires_timer
       AND NOT v_stage_is_initial
       AND v_is_assigned
       AND v_min_timer_seconds > 0
       AND v_action.action_type = 'advance'
    THEN
        SELECT COALESCE(SUM(
            CASE
                WHEN status = 'completed' THEN COALESCE(total_seconds_spent, 0)
                WHEN status = 'active'    THEN EXTRACT(EPOCH FROM (now() - started_at))::INTEGER
                ELSE 0
            END
        ), 0) INTO v_total_seconds
        FROM public.task_work_sessions
        WHERE task_id  = p_task_id
          AND user_id  = v_user_id
          AND stage_id = v_task.current_stage_id;

        IF v_total_seconds < v_min_timer_seconds THEN
            SELECT approval_status INTO v_manual_entry_status
            FROM public.task_manual_time_entries
            WHERE task_id = p_task_id AND stage_id = v_task.current_stage_id AND user_id = v_user_id
            ORDER BY logged_at DESC
            LIMIT 1;

            IF v_manual_entry_status IS NULL OR v_manual_entry_status = 'rejected' THEN
                RAISE EXCEPTION 'LOW_TIMER_TIME: Less than the required minimum time was logged for this stage. Please declare your actual work hours before proceeding.'
                USING ERRCODE = 'P0001';
            ELSIF v_manual_entry_status = 'pending' THEN
                RAISE EXCEPTION 'TIME_APPROVAL_PENDING: Your time declaration is awaiting manager approval. The stage will advance automatically once approved.'
                USING ERRCODE = 'P0001';
            END IF;
        END IF;
    END IF;

    CASE v_action.action_type
        WHEN 'start_task' THEN
            IF v_action.transition_id IS NOT NULL THEN
                v_transition_meta := public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'start_task') || COALESCE(v_transition_meta, '{}'::jsonb);

        WHEN 'submit_work' THEN
            v_sub_id := public.rpc_submit_work(p_task_id, COALESCE(p_payload->>'content', ''),
                v_assignment_id, v_action.transition_id, COALESCE(p_payload->'attachments', '[]'::jsonb));
            RETURN jsonb_build_object('success', true, 'action', 'submit_work', 'submission_id', v_sub_id);

        WHEN 'advance' THEN
            IF v_action.transition_id IS NOT NULL THEN
                v_transition_meta := public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'advance') || COALESCE(v_transition_meta, '{}'::jsonb);

        WHEN 'review_approve' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'approved', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_approve');

        WHEN 'review_reject' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'rejected', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_reject');

        WHEN 'review_revise' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'needs_revision', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_revise');

        WHEN 'start_timer' THEN
            INSERT INTO public.task_work_sessions (task_id, user_id, company_id, stage_id, status)
            VALUES (p_task_id, v_user_id, v_company_id, v_task.current_stage_id, 'active') ON CONFLICT DO NOTHING;
            PERFORM public.log_event(v_company_id, v_user_id, 'task', p_task_id, 'task.timer_started',
                jsonb_build_object('action_id', p_action_id));
            RETURN jsonb_build_object('success', true, 'action', 'start_timer');

        WHEN 'assign_user' THEN
            IF p_payload->>'assign_user_id' IS NOT NULL THEN
                INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
                VALUES (p_task_id, v_company_id, (p_payload->>'assign_user_id')::UUID, v_user_id)
                ON CONFLICT DO NOTHING;
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'assign_user');

        WHEN 'custom' THEN
            IF v_action.transition_id IS NOT NULL THEN
                v_transition_meta := public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'custom') || COALESCE(v_transition_meta, '{}'::jsonb);

        ELSE RAISE EXCEPTION 'Unknown action type: %', v_action.action_type;
    END CASE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_execute_stage_action(uuid,uuid,jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_execute_stage_action(uuid,uuid,jsonb) FROM anon,public;
CREATE OR REPLACE FUNCTION public.rpc_submit_work(p_task_id uuid, p_content text DEFAULT NULL::text, p_assignment_id uuid DEFAULT NULL::uuid, p_transition_id uuid DEFAULT NULL::uuid, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_submission_id   UUID;
    v_company_id      UUID;
    v_user_id         UUID    := auth.uid();
    v_current_stage   UUID;
    v_target_stage_id UUID;
    v_revision_count  INTEGER := 0;
    v_att             RECORD;
    v_is_owner        BOOLEAN;
    v_task_created_by UUID;
    v_task_manager_id UUID;
    v_version_id      UUID;
BEGIN
    SELECT company_id, current_stage_id, created_by, manager_id
    INTO   v_company_id, v_current_stage, v_task_created_by, v_task_manager_id
    FROM   public.tasks
    WHERE  id = p_task_id AND deleted_at IS NULL
    FOR UPDATE;

    IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
    IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    v_is_owner := (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_user_id);

    IF p_assignment_id IS NULL THEN
        SELECT id INTO p_assignment_id
        FROM public.task_assignments
        WHERE task_id = p_task_id
          AND (
            assignee_user_id = v_user_id
            OR assignee_team_id IN (
                SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
            )
          )
        LIMIT 1;
    END IF;

    IF p_assignment_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.task_assignments
            WHERE id = p_assignment_id AND task_id = p_task_id
              AND (
                assignee_user_id = v_user_id
                OR assignee_team_id IN (
                    SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
                )
              )
        ) THEN
            RAISE EXCEPTION 'Forbidden: Assignment does not belong to user or task.' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF NOT (v_is_owner OR v_task_manager_id = v_user_id OR v_task_created_by = v_user_id) THEN
            RAISE EXCEPTION 'Forbidden: You must be assigned to this task to submit work.' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- First submission gets revision_count=0; each resubmission increments from the previous max.
    SELECT COALESCE(MAX(revision_count) + 1, 0) INTO v_revision_count
    FROM public.task_submissions
    WHERE task_id = p_task_id
      AND (p_assignment_id IS NULL OR assignment_id = p_assignment_id);

    UPDATE public.task_work_sessions
    SET status = 'completed', last_heartbeat_at = now()
    WHERE task_id = p_task_id AND user_id = v_user_id AND status = 'active';

    INSERT INTO public.task_submissions (
        task_id, company_id, submitted_by, assignment_id,
        content, stage_id, status, revision_count
    )
    VALUES (
        p_task_id, v_company_id, v_user_id, p_assignment_id,
        p_content, v_current_stage, 'pending', v_revision_count
    )
    RETURNING id INTO v_submission_id;

    -- A1 (Model B): every new submission starts at version 1
    INSERT INTO public.task_submission_versions (
        submission_id, company_id, version_no, content, created_by
    )
    VALUES (v_submission_id, v_company_id, 1, p_content, v_user_id)
    RETURNING id INTO v_version_id;

    UPDATE public.task_submissions
    SET current_version_id = v_version_id
    WHERE id = v_submission_id;

    IF p_attachments IS NOT NULL AND jsonb_array_length(p_attachments) > 0 THEN
        FOR v_att IN SELECT * FROM jsonb_to_recordset(p_attachments) AS x(
            file_name text, file_url text, file_size bigint,
            mime_type text, category text, storage_path text
        )
        LOOP
            PERFORM public.filehub_check_upload_limits(v_att.file_size);

            INSERT INTO public.submission_attachments (
                submission_id, company_id, uploaded_by,
                file_name, file_url, file_size, mime_type, category, storage_path, version_id
            )
            VALUES (
                v_submission_id, v_company_id, v_user_id,
                v_att.file_name, v_att.file_url, v_att.file_size,
                v_att.mime_type, v_att.category, v_att.storage_path, v_version_id
            );
        END LOOP;
    END IF;

    IF p_transition_id IS NOT NULL THEN
        SELECT to_stage_id INTO v_target_stage_id
        FROM public.pipeline_stage_transitions WHERE id = p_transition_id;
        IF v_target_stage_id IS NOT NULL THEN
            PERFORM public.rpc_advance_stage(p_task_id, v_target_stage_id, v_submission_id);
        END IF;
    END IF;

    RETURN v_submission_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rpc_submit_work(uuid,text,uuid,uuid,jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_submit_work(uuid,text,uuid,uuid,jsonb) FROM anon,public;
-- #395 uses the same monotonic ordering field for reversal/latest checks.
CREATE OR REPLACE FUNCTION public.rpc_revert_stage(p_task_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id       UUID;
  v_user_id          UUID := auth.uid();
  v_current_stage    UUID;
  v_pipeline_id      UUID;
  v_prev_stage       UUID;
  v_from_stage_name  TEXT;
  v_to_stage_name    TEXT;
  v_history_id       UUID;
BEGIN
  SELECT company_id, current_stage_id, pipeline_id
  INTO   v_company_id, v_current_stage, v_pipeline_id
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_user_id IS NULL OR v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.reverse')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  SELECT from_stage_id
  INTO   v_prev_stage
  FROM   public.pipeline_stage_history
  WHERE  task_id = p_task_id
    AND  to_stage_id = v_current_stage
    AND  pipeline_id = v_pipeline_id
    AND  is_reversal = FALSE
  ORDER BY recorded_at DESC, id DESC
  LIMIT 1;

  IF v_prev_stage IS NULL THEN
    RAISE EXCEPTION 'Cannot revert: no prior stage found for this task in its current pipeline';
  END IF;

  UPDATE public.tasks
  SET current_stage_id = v_prev_stage, updated_at = NOW()
  WHERE id = p_task_id;

  SELECT name INTO v_from_stage_name FROM public.pipeline_stages WHERE id = v_current_stage;
  SELECT name INTO v_to_stage_name FROM public.pipeline_stages WHERE id = v_prev_stage;

  INSERT INTO public.pipeline_stage_history (
    task_id, company_id, pipeline_id, from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name, is_reversal
  )
  VALUES (
    p_task_id, v_company_id, v_pipeline_id, v_current_stage, v_prev_stage,
    v_user_id, v_from_stage_name, v_to_stage_name, TRUE
  )
  RETURNING id INTO v_history_id;

  RETURN v_history_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rpc_revert_stage(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_revert_stage(uuid) FROM anon,public;
CREATE OR REPLACE FUNCTION public.rpc_undo_stage_reversal(p_task_id uuid, p_reversal_history_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id       UUID;
  v_user_id          UUID := auth.uid();
  v_current_stage    UUID;
  v_pipeline_id      UUID;
  v_reversal         public.pipeline_stage_history%ROWTYPE;
  v_from_stage_name  TEXT;
  v_to_stage_name    TEXT;
  v_history_id       UUID;
BEGIN
  SELECT company_id, current_stage_id, pipeline_id
  INTO v_company_id, v_current_stage, v_pipeline_id
  FROM public.tasks
  WHERE id = p_task_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_user_id IS NULL OR v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.reverse')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  SELECT h.* INTO v_reversal
  FROM public.pipeline_stage_history h
  WHERE h.id = p_reversal_history_id
    AND h.task_id = p_task_id
    AND h.pipeline_id = v_pipeline_id
    AND h.is_reversal = TRUE
    AND h.to_stage_id = v_current_stage;

  IF v_reversal.id IS NULL THEN
    RAISE EXCEPTION 'Cannot undo: reversal is not the current task transition';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.pipeline_stage_history newer
    WHERE newer.task_id = p_task_id
      AND (newer.recorded_at, newer.id) > (v_reversal.recorded_at, v_reversal.id)
  ) THEN
    RAISE EXCEPTION 'Cannot undo: a newer stage transition already exists';
  END IF;

  IF v_reversal.from_stage_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages s
    WHERE s.id = v_reversal.from_stage_id AND s.pipeline_id = v_pipeline_id
  ) THEN
    RAISE EXCEPTION 'Cannot undo: reversal source stage is no longer valid';
  END IF;

  UPDATE public.tasks
  SET current_stage_id = v_reversal.from_stage_id, updated_at = NOW()
  WHERE id = p_task_id AND current_stage_id = v_reversal.to_stage_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot undo: task stage changed while undoing';
  END IF;

  SELECT name INTO v_from_stage_name FROM public.pipeline_stages WHERE id = v_reversal.to_stage_id;
  SELECT name INTO v_to_stage_name FROM public.pipeline_stages WHERE id = v_reversal.from_stage_id;

  INSERT INTO public.pipeline_stage_history (
    task_id, company_id, pipeline_id, from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name, is_reversal
  )
  VALUES (
    p_task_id, v_company_id, v_pipeline_id, v_reversal.to_stage_id,
    v_reversal.from_stage_id, v_user_id, v_from_stage_name, v_to_stage_name, TRUE
  )
  RETURNING id INTO v_history_id;

  RETURN v_history_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rpc_undo_stage_reversal(uuid,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_undo_stage_reversal(uuid,uuid) FROM anon,public;
