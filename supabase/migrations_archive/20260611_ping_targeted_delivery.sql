-- Targeted ping delivery: one row per assignee per ping event.
-- postgres_changes filter only works on real columns, not JSONB fields,
-- so activity_log.metadata can't be used here — a dedicated table is required.
CREATE TABLE IF NOT EXISTS public.task_ping_targets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  company_id     UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pinged_by      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Compound index covers the realtime filter and ordering by recency
CREATE INDEX IF NOT EXISTS idx_task_ping_targets_target_user
  ON public.task_ping_targets (target_user_id, created_at DESC);

ALTER TABLE public.task_ping_targets ENABLE ROW LEVEL SECURITY;

-- Required for postgres_changes subscriptions to fire on this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_ping_targets;

-- Each user can only receive events for their own rows
CREATE POLICY "Users see own ping targets" ON public.task_ping_targets
FOR SELECT TO authenticated
USING (target_user_id = auth.uid());

-- Update rpc_ping_task: insert one row per direct assignee, exclude sender
CREATE OR REPLACE FUNCTION public.rpc_ping_task(p_task_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id       UUID;
  v_user_id          UUID := auth.uid();
  v_task_manager_id  UUID;
  v_has_permission   BOOLEAN;
BEGIN
  SELECT company_id, manager_id INTO v_company_id, v_task_manager_id
  FROM public.tasks
  WHERE id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  v_has_permission := (
    v_task_manager_id = v_user_id
    OR public.has_permission('task.ping')
    OR (SELECT is_owner FROM public.users WHERE id = v_user_id LIMIT 1)
  );

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'Unauthorized to ping this task';
  END IF;

  -- Activity log entry (used for highlight animation on task detail page)
  INSERT INTO public.activity_log (task_id, company_id, user_id, event_type, metadata)
  VALUES (
    p_task_id, v_company_id, v_user_id, 'task_pinged',
    jsonb_build_object('pinged_by', v_user_id, 'pinged_at', NOW())
  );

  -- One row per directly-assigned user (excludes sender, excludes team-only assignments)
  INSERT INTO public.task_ping_targets (task_id, company_id, pinged_by, target_user_id)
  SELECT p_task_id, v_company_id, v_user_id, ta.assignee_user_id
  FROM public.task_assignments ta
  WHERE ta.task_id = p_task_id
    AND ta.assignee_user_id IS NOT NULL
    AND ta.assignee_user_id <> v_user_id;
END;
$function$;
