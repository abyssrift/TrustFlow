-- Create activity log table for tracking task events (including pings)
CREATE TABLE IF NOT EXISTS public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on activity_log
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view activity log for tasks in their company
CREATE POLICY "Users can view activity log" ON public.activity_log
FOR SELECT TO authenticated
USING (
  company_id = public.my_company_id()
);

-- Create table for storing company-specific ping sound settings
CREATE TABLE IF NOT EXISTS public.company_ping_sounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  sound_url TEXT NOT NULL,
  sound_file_name TEXT NOT NULL,
  file_size_bytes INTEGER,
  mime_type TEXT DEFAULT 'audio/mpeg',
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.company_ping_sounds ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view ping sounds for their company
CREATE POLICY "Users can view company ping sounds" ON public.company_ping_sounds
FOR SELECT TO authenticated
USING (
  company_id = public.my_company_id()
);

-- Policy: Only users with task.ping permission or admin notifications can insert
CREATE POLICY "Users can insert ping sounds" ON public.company_ping_sounds
FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.my_company_id()
  AND (
    public.has_permission('task.ping')
    OR public.has_permission('admin:notifications')
  )
);

-- Policy: Only users with task.ping permission or admin notifications can update
CREATE POLICY "Users can update ping sounds" ON public.company_ping_sounds
FOR UPDATE TO authenticated
USING (company_id = public.my_company_id())
WITH CHECK (
  public.has_permission('task.ping')
  OR public.has_permission('admin:notifications')
);

-- RPC to trigger a ping on a task
CREATE OR REPLACE FUNCTION public.rpc_ping_task(p_task_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id UUID := auth.uid();
  v_task_manager_id UUID;
  v_has_permission BOOLEAN;
BEGIN
  -- Get task's company and manager
  SELECT company_id, manager_id INTO v_company_id, v_task_manager_id
  FROM public.tasks
  WHERE id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  -- Check authorization: user must be task manager or have task.ping permission
  v_has_permission := (
    -- User is the task's manager
    v_task_manager_id = v_user_id
    OR
    -- User has ping permission
    public.has_permission('task.ping')
    OR
    -- User is owner
    (SELECT is_owner FROM public.users WHERE id = v_user_id LIMIT 1)
  );

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'Unauthorized to ping this task';
  END IF;

  -- Broadcast via Realtime by inserting into activity_log
  INSERT INTO public.activity_log (
    task_id, company_id, user_id, event_type, metadata
  )
  VALUES (
    p_task_id, v_company_id, v_user_id, 'task_pinged',
    jsonb_build_object(
      'pinged_by', v_user_id,
      'pinged_at', NOW()
    )
  );
END;
$function$;
