-- FileHub unification Phase 3 (#152): resolve a task file's filehub_files pointer
-- id so the Browse detail pane can read/log filehub_activity against it (activity
-- is FK-bound to filehub_files). Access-checked via the file's task.
-- Versions still come from the source RPCs (rpc_task_attachment_versions /
-- rpc_submission_versions), so no view/function re-emission is needed.

CREATE OR REPLACE FUNCTION public.rpc_filehub_pointer_id(p_source text, p_source_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_task uuid;
BEGIN
  IF p_source = 'task_brief' THEN
    SELECT filehub_file_id, task_id INTO v_id, v_task
    FROM public.task_attachments WHERE id = p_source_id;
  ELSIF p_source = 'submission' THEN
    SELECT a.filehub_file_id, s.task_id INTO v_id, v_task
    FROM public.submission_attachments a
    JOIN public.task_submissions s ON s.id = a.submission_id
    WHERE a.id = p_source_id;
  ELSE
    RETURN NULL;
  END IF;

  IF v_task IS NULL OR NOT public.task_accessible(v_task) THEN
    RETURN NULL;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_filehub_pointer_id(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_pointer_id(text, uuid) TO authenticated;
