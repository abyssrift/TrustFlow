-- Issue #23: Shared Tasks (visible-only cross-pipeline linking).
--
-- A task keeps exactly one owning pipeline_id/current_stage_id (unchanged --
-- this is NOT independent per-pipeline progress tracking, see the design
-- doc). What this adds is the ability to additionally link a task onto
-- OTHER task-kind pipelines' boards as a read-only reference card, so
-- another team can see it's relevant to them without duplicating it
-- (spawn_recursive_task's child-task creation) or moving it out of its
-- real home (rpc_move_task_pipeline).

-- ============================================================
-- Section 1: task_pipeline_links table
-- ============================================================
CREATE TABLE public.task_pipeline_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  linked_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Both FKs CASCADE off tasks/companies, so rpc_platform_delete_company needs no
-- edit -- this table sweeps automatically on company/task/pipeline deletion,
-- same convention as pipeline_assignment_pool.

CREATE UNIQUE INDEX task_pipeline_links_uq ON public.task_pipeline_links (task_id, pipeline_id);
CREATE INDEX task_pipeline_links_pipeline_idx ON public.task_pipeline_links (pipeline_id);
CREATE INDEX task_pipeline_links_task_idx ON public.task_pipeline_links (task_id);

ALTER TABLE public.task_pipeline_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "TaskPipelineLinks: select by company" ON public.task_pipeline_links
  FOR SELECT USING (company_id = public.my_company_id());
-- No INSERT/UPDATE/DELETE policy -- all writes go through the SECURITY DEFINER
-- RPCs below, same convention as pipeline_assignment_pool/task_assignments.

-- ============================================================
-- Section 2: rpc_link_task_to_pipeline
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_link_task_to_pipeline(p_task_id uuid, p_pipeline_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id      UUID;
  v_task_pipeline_id UUID;
  v_user_id         UUID := auth.uid();
  v_is_owner        BOOLEAN;
  v_is_creator      BOOLEAN;
  v_is_manager      BOOLEAN;
  v_target_company  UUID;
  v_target_kind     TEXT;
BEGIN
  SELECT company_id, pipeline_id, created_by = v_user_id, manager_id = v_user_id
  INTO   v_company_id, v_task_pipeline_id, v_is_creator, v_is_manager
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  v_is_owner := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
  IF NOT (v_is_owner OR v_is_creator OR v_is_manager OR public.has_permission('task.edit')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF p_pipeline_id = v_task_pipeline_id THEN
    RAISE EXCEPTION 'Task is already in this pipeline';
  END IF;

  SELECT company_id, subject_kind INTO v_target_company, v_target_kind
  FROM public.pipelines WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_target_company IS NULL THEN RAISE EXCEPTION 'Pipeline not found'; END IF;
  IF v_target_company != v_company_id THEN RAISE EXCEPTION 'Pipeline is not in this company'; END IF;
  IF v_target_kind != 'task' THEN RAISE EXCEPTION 'Can only link to a task-kind pipeline'; END IF;

  INSERT INTO public.task_pipeline_links (task_id, pipeline_id, company_id, linked_by)
  VALUES (p_task_id, p_pipeline_id, v_company_id, v_user_id)
  ON CONFLICT (task_id, pipeline_id) DO NOTHING;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_link_task_to_pipeline(uuid, uuid) TO authenticated;

-- ============================================================
-- Section 3: rpc_unlink_task_from_pipeline
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_unlink_task_from_pipeline(p_task_id uuid, p_pipeline_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_is_owner   BOOLEAN;
  v_is_creator BOOLEAN;
  v_is_manager BOOLEAN;
BEGIN
  SELECT company_id, created_by = v_user_id, manager_id = v_user_id
  INTO   v_company_id, v_is_creator, v_is_manager
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  v_is_owner := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
  IF NOT (v_is_owner OR v_is_creator OR v_is_manager OR public.has_permission('task.edit')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  DELETE FROM public.task_pipeline_links
  WHERE task_id = p_task_id AND pipeline_id = p_pipeline_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_unlink_task_from_pipeline(uuid, uuid) TO authenticated;
