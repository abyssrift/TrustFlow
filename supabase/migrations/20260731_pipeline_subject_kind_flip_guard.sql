-- #172 follow-up: the subject_kind guard was one-directional.
--
-- rpc_advance_project_stage already refuses a stage belonging to a task-kind
-- pipeline. Nothing enforced the mirror: verified on the live schema,
--   rpc_advance_stage           references subject_kind : false
--   task creation / import RPCs references subject_kind : false
--   CHECK constraints on tasks  referencing subject_kind: 0
--
-- On its own that is a slow leak — one mis-placed task at a time. What makes
-- it worth a guard is the Phase 2 UI that just shipped: it exposes a
-- Tasks/Projects toggle on any pipeline, with no restriction on flipping one
-- that is already in use. Measured on seeded data: 14 pipelines carry tasks and
-- the largest carries 95. So a single click could strand 95 tasks on a pipeline
-- whose stages describe project lifecycles, and the form's own copy ("tasks
-- cannot be created on a project pipeline") would be false the moment it ran.
--
-- Refuse the flip while live tasks remain. Deliberately narrow:
--   * only blocks task -> project, never project -> task (harmless direction)
--   * only counts live tasks (deleted_at IS NULL); archived ones do not block
--   * says how many, so the message is actionable rather than just a refusal
--
-- NOT covered here: placing a *new* task onto an already-project-kind pipeline.
-- That needs the task pipeline pickers to filter on subject_kind = 'task', which
-- is UI work across several screens rather than one constraint. Tracked
-- separately; this closes the bulk, one-click version of the same mistake.

CREATE OR REPLACE FUNCTION public.fn_pipelines_guard_subject_kind_flip()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_task_count INT;
BEGIN
  IF NEW.subject_kind = 'project' AND COALESCE(OLD.subject_kind, 'task') <> 'project' THEN
    SELECT count(*) INTO v_task_count
    FROM public.tasks
    WHERE pipeline_id = NEW.id AND deleted_at IS NULL;

    IF v_task_count > 0 THEN
      RAISE EXCEPTION
        'Cannot convert "%" to a project pipeline: % task(s) still live on it. Move or archive them first.',
        NEW.name, v_task_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipelines_guard_subject_kind_flip ON public.pipelines;
CREATE TRIGGER trg_pipelines_guard_subject_kind_flip
  BEFORE UPDATE OF subject_kind ON public.pipelines
  FOR EACH ROW
  WHEN (NEW.subject_kind IS DISTINCT FROM OLD.subject_kind)
  EXECUTE FUNCTION public.fn_pipelines_guard_subject_kind_flip();
