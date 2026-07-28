-- FileHub file-visibility #163 Phase 2a (rows): switch the ROW-level checks from
-- task_accessible to the configurable fn_task_file_accessible. Storage RLS is
-- flipped separately in Phase 2b. task_accessible stays untouched for task-detail
-- surfaces. An `uploaded_by = auth.uid()` floor is added to the file table RLS so
-- someone can always see a file they uploaded, whatever the pipeline preset (the
-- function only takes a task id, so it can't express "uploader of this file").

-- ── Table RLS: task_attachments (briefs) — was company-wide ───────────────────
ALTER POLICY task_attachments_select ON public.task_attachments
  USING (
    company_id = public.my_company_id()
    AND ( uploaded_by = auth.uid() OR public.fn_task_file_accessible(task_id) )
  );

-- ── Table RLS: submission_attachments — was submitter/reviewer/owner ──────────
ALTER POLICY submission_attachments_select ON public.submission_attachments
  USING (
    company_id = public.my_company_id()
    AND (
      uploaded_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.task_submissions ts
        WHERE ts.id = submission_attachments.submission_id
          AND public.fn_task_file_accessible(ts.task_id)
      )
    )
  );

-- ── filehub_file_accessible: task branch ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.filehub_file_accessible(p_file_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.filehub_files f
        WHERE f.id = p_file_id
          AND f.deleted_at IS NULL
          AND f.company_id = public.my_company_id()
          AND (
              f.uploaded_by = auth.uid()
              OR f.visibility = 'broadcast'
              OR (f.visibility = 'direct' AND EXISTS (
                  SELECT 1 FROM public.filehub_recipients r
                  WHERE r.file_id = f.id AND r.user_id = auth.uid()
              ))
              OR (f.visibility = 'group' AND f.group_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.filehub_group_members gm
                  WHERE gm.group_id = f.group_id AND gm.user_id = auth.uid()
              ))
              OR (f.visibility = 'task' AND f.task_id IS NOT NULL AND public.fn_task_file_accessible(f.task_id))
          )
    );
$function$;

-- ── rpc_filehub_pointer_id ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_pointer_id(p_source text, p_source_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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

  IF v_task IS NULL OR NOT public.fn_task_file_accessible(v_task) THEN
    RETURN NULL;
  END IF;
  RETURN v_id;
END;
$$;

-- ── rpc_filehub_log_activity_by_path ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_log_activity_by_path(
    p_bucket TEXT,
    p_storage_path TEXT,
    p_action TEXT,
    p_metadata JSONB DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_file   uuid;
    v_task   uuid;
    v_company uuid;
BEGIN
    SELECT id, task_id, company_id INTO v_file, v_task, v_company
    FROM public.filehub_files
    WHERE bucket = p_bucket AND storage_path = p_storage_path AND visibility = 'task'
    LIMIT 1;

    IF v_file IS NULL OR v_task IS NULL OR NOT public.fn_task_file_accessible(v_task) THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.filehub_activity
        WHERE file_id = v_file AND user_id = auth.uid() AND action = p_action
          AND created_at > now() - interval '15 seconds'
    ) THEN
        RETURN;
    END IF;

    INSERT INTO public.filehub_activity (company_id, file_id, user_id, action, metadata)
    VALUES (v_company, v_file, auth.uid(), p_action, p_metadata);
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
