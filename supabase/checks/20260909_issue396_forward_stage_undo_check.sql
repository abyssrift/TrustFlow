-- #396 deterministic, rollback-only contract check.
BEGIN;
DO $$
DECLARE
  c uuid; u uuid; other uuid; p uuid; lp uuid; a uuid; b uuid; d uuid; e uuid; f uuid; g uuid; h uuid; q uuid; t uuid; t2 uuid; subid uuid; j jsonb; x jsonb;
  tr uuid; act uuid; before_h bigint; after_h bigint; before_l bigint; after_l bigint; rejected boolean;
  s record; token uuid;
BEGIN
  SELECT company_id,id INTO c,u FROM public.users WHERE is_owner AND company_id IS NOT NULL LIMIT 1;
  -- A valid JWT-shaped UUID with no matching tenant user is deterministic and
  -- cannot inherit owner/permission grants from whatever seed happens to exist.
  other := gen_random_uuid();
  IF c IS NULL THEN RAISE EXCEPTION 'CHECK BLOCKED: no owner fixture'; END IF;
  INSERT INTO public.pipelines(company_id,name,subject_kind) VALUES(c,'#396 check','task') RETURNING id INTO p;
  INSERT INTO public.pipeline_stages(pipeline_id,name,position,is_initial) VALUES(p,'A',0,true) RETURNING id INTO a;
  INSERT INTO public.pipeline_stages(pipeline_id,name,position) VALUES(p,'B',1) RETURNING id INTO b;
  INSERT INTO public.pipeline_stages(pipeline_id,name,position) VALUES(p,'C',2) RETURNING id INTO d;
  INSERT INTO public.pipeline_stages(pipeline_id,name,position,reassign_on_entry) VALUES(p,'R',3,true) RETURNING id INTO e;
  INSERT INTO public.pipeline_stages(pipeline_id,name,position,harvests_to_deliverable) VALUES(p,'H',4,true) RETURNING id INTO f;
  INSERT INTO public.pipeline_stages(pipeline_id,name,position,is_terminal,terminal_type) VALUES(p,'T',5,true,'failure') RETURNING id INTO g;
  INSERT INTO public.pipeline_stages(pipeline_id,name,position) VALUES(p,'S',6) RETURNING id INTO h;
  INSERT INTO public.pipelines(company_id,name,subject_kind) VALUES(c,'#396 child','task') RETURNING id INTO lp;
  INSERT INTO public.pipeline_stages(pipeline_id,name,position,is_initial) VALUES(lp,'Child',0,true) RETURNING id INTO q;
  UPDATE public.pipeline_stages SET linked_pipeline_id=lp WHERE id=h;
  INSERT INTO public.pipeline_stage_transitions(from_stage_id,to_stage_id) VALUES(a,b),(b,d),(a,e),(a,f),(a,g),(a,h);
  SELECT id INTO tr FROM public.pipeline_stage_transitions WHERE from_stage_id=a AND to_stage_id=b LIMIT 1;
  INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id) VALUES(c,'#396 safe',u,p,a) RETURNING id INTO t;
  PERFORM set_config('request.jwt.claim.sub',u::text,true);

  -- Safe forward + exact inverse.
  j:=public.rpc_advance_stage(t,b); token:=(j->>'undo_token')::uuid;
  IF NOT (j->>'undoable')::boolean OR (j->>'history_id') IS NULL OR (j->>'from_stage_id')::uuid<>a OR (j->>'to_stage_id')::uuid<>b THEN RAISE EXCEPTION 'safe metadata wrong: %',j; END IF;
  x:=public.rpc_undo_forward_stage(t,token); IF (x->>'to_stage_id')::uuid<>a THEN RAISE EXCEPTION 'exact inverse wrong'; END IF;
  SELECT count(*) INTO before_h FROM public.pipeline_stage_history WHERE task_id=t; SELECT count(*) INTO before_l FROM public.task_stage_undo_ledger WHERE task_id=t;
  rejected:=false; BEGIN PERFORM public.rpc_undo_forward_stage(t,token); EXCEPTION WHEN OTHERS THEN rejected:=true; END; IF NOT rejected THEN RAISE EXCEPTION 'double undo accepted'; END IF;
  SELECT count(*) INTO after_h FROM public.pipeline_stage_history WHERE task_id=t; SELECT count(*) INTO after_l FROM public.task_stage_undo_ledger WHERE task_id=t; IF after_h<>before_h OR after_l<>before_l THEN RAISE EXCEPTION 'double refusal wrote rows'; END IF;

  -- Stale token after a newer transition; refusal is side-effect free.
  INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id) VALUES(c,'#396 stale',u,p,a) RETURNING id INTO t2;
  j:=public.rpc_advance_stage(t2,b); token:=(j->>'undo_token')::uuid; PERFORM public.rpc_advance_stage(t2,d);
  SELECT count(*) INTO before_h FROM public.pipeline_stage_history WHERE task_id=t2; SELECT count(*) INTO before_l FROM public.task_stage_undo_ledger WHERE task_id=t2;
  rejected:=false; BEGIN PERFORM public.rpc_undo_forward_stage(t2,token); EXCEPTION WHEN OTHERS THEN rejected:=true; END; IF NOT rejected THEN RAISE EXCEPTION 'stale token accepted'; END IF;
  SELECT count(*) INTO after_h FROM public.pipeline_stage_history WHERE task_id=t2; SELECT count(*) INTO after_l FROM public.task_stage_undo_ledger WHERE task_id=t2; IF after_h<>before_h OR after_l<>before_l THEN RAISE EXCEPTION 'stale refusal wrote rows'; END IF;

  -- Expired token and wrong-task token.
  INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id) VALUES(c,'#396 expiry',u,p,a) RETURNING id INTO t2;
  j:=public.rpc_advance_stage(t2,b); token:=(j->>'undo_token')::uuid; UPDATE public.task_stage_undo_ledger SET expires_at=now()-interval '1 second' WHERE undo_token=token;
  rejected:=false; BEGIN PERFORM public.rpc_undo_forward_stage(t2,token); EXCEPTION WHEN OTHERS THEN rejected:=true; END; IF NOT rejected THEN RAISE EXCEPTION 'expired token accepted'; END IF;
  INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id) VALUES(c,'#396 wrong',u,p,a) RETURNING id INTO t2;
  rejected:=false; BEGIN PERFORM public.rpc_undo_forward_stage(t2,token); EXCEPTION WHEN OTHERS THEN rejected:=true; END; IF NOT rejected THEN RAISE EXCEPTION 'wrong-task token accepted'; END IF;

  -- An authenticated identity outside the tenant cannot consume a valid token.
  INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id) VALUES(c,'#396 auth',u,p,a) RETURNING id INTO t2;
  j:=public.rpc_advance_stage(t2,b); token:=(j->>'undo_token')::uuid;
  SELECT count(*) INTO before_h FROM public.pipeline_stage_history WHERE task_id=t2; SELECT count(*) INTO before_l FROM public.task_stage_undo_ledger WHERE task_id=t2;
  PERFORM set_config('request.jwt.claim.sub',other::text,true); rejected:=false; BEGIN PERFORM public.rpc_undo_forward_stage(t2,token); EXCEPTION WHEN OTHERS THEN rejected:=true; END; IF NOT rejected THEN RAISE EXCEPTION 'unauthorized undo accepted'; END IF;
  SELECT count(*) INTO after_h FROM public.pipeline_stage_history WHERE task_id=t2; SELECT count(*) INTO after_l FROM public.task_stage_undo_ledger WHERE task_id=t2; IF after_h<>before_h OR after_l<>before_l THEN RAISE EXCEPTION 'unauthorized refusal wrote rows'; END IF;
  PERFORM set_config('request.jwt.claim.sub',u::text,true);

  -- Direct action result carries transition metadata at top level.
  INSERT INTO public.pipeline_stage_actions(stage_id,transition_id,action_type,label,required_role,is_active) VALUES(a,tr,'advance','Check advance','any',true) RETURNING id INTO act;
  INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id) VALUES(c,'#396 action',u,p,a) RETURNING id INTO t2;
  j:=public.rpc_execute_stage_action(t2,act,'{}'); IF (j->>'history_id') IS NULL OR (j->>'undo_token') IS NULL THEN RAISE EXCEPTION 'action metadata is not top-level: %',j; END IF;

  -- Every configured forward side effect is explicitly refused as undoable.
  INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id) VALUES(c,'#396 reassign',u,p,a) RETURNING id INTO t2; j:=public.rpc_advance_stage(t2,e); IF (j->>'undoable')::boolean OR NOT (j->'refusal_reasons' ? 'reassignment') THEN RAISE EXCEPTION 'reassign flag missing: %',j; END IF;
  INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id) VALUES(c,'#396 harvest',u,p,a) RETURNING id INTO t2; j:=public.rpc_advance_stage(t2,f); IF (j->>'undoable')::boolean OR NOT (j->'refusal_reasons' ? 'deliverable_harvest') THEN RAISE EXCEPTION 'harvest flag missing: %',j; END IF;
  IF to_regprocedure('public.fn_handle_task_handshake(uuid,uuid)') IS NOT NULL THEN INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id) VALUES(c,'#396 terminal',u,p,a) RETURNING id INTO t2; j:=public.rpc_advance_stage(t2,g); IF (j->>'undoable')::boolean OR NOT (j->'refusal_reasons' ? 'terminal_handshake') THEN RAISE EXCEPTION 'terminal flag missing: %',j; END IF; END IF;
  INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id,claimed_by,claimed_at) VALUES(c,'#396 claim',u,p,a,u,now()) RETURNING id INTO t2; j:=public.rpc_advance_stage(t2,b); IF (j->>'undoable')::boolean OR NOT (j->'refusal_reasons' ? 'claim_clear') THEN RAISE EXCEPTION 'claim flag missing: %',j; END IF;
  INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id) VALUES(c,'#396 submission',u,p,a) RETURNING id INTO t2; INSERT INTO public.task_submissions(task_id,company_id,submitted_by,stage_id,status,content) VALUES(t2,c,u,a,'pending','evidence') RETURNING id INTO subid; j:=public.rpc_advance_stage(t2,b,subid); IF (j->>'undoable')::boolean OR NOT (j->'refusal_reasons' ? 'submission_linked') THEN RAISE EXCEPTION 'submission flag missing: %',j; END IF;
  INSERT INTO public.tasks(company_id,title,created_by,pipeline_id,current_stage_id) VALUES(c,'#396 child',u,p,a) RETURNING id INTO t2; j:=public.rpc_advance_stage(t2,h); IF (j->>'undoable')::boolean OR NOT (j->'refusal_reasons' ? 'linked_child') THEN RAISE EXCEPTION 'child flag missing: %',j; END IF;

  -- Definition assertions document the concurrency invariant where multi-session
  -- contention cannot be reproduced inside one rollback transaction.
  IF position('FOR UPDATE' IN pg_get_functiondef('public.rpc_advance_stage(uuid,uuid,uuid)'::regprocedure))=0 OR position('FOR UPDATE' IN pg_get_functiondef('public.rpc_execute_stage_action(uuid,uuid,jsonb)'::regprocedure))=0 OR position('FOR UPDATE' IN pg_get_functiondef('public.rpc_submit_work(uuid,text,uuid,uuid,jsonb)'::regprocedure))=0 THEN RAISE EXCEPTION 'required task row lock missing'; END IF;
  RAISE NOTICE 'OK: #396 safe inverse, stale/expiry/auth refusals, action propagation, and lock definitions passed';
END $$;
ROLLBACK;
