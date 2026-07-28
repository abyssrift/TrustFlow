-- FileHub unification Phase 3 (#152): let task-side surfaces (brief panel,
-- submission/evidence viewers) log activity onto a task file's filehub_files
-- pointer, so a file's Activity tab reflects work done *outside* FileHub too.
-- Resolves the pointer by (bucket, storage_path, visibility='task') instead of
-- an id, because those surfaces only hold storage coordinates. Access-checked
-- via the file's task. 15s dedupe so a double-tap / cross-surface open doesn't
-- write two identical rows.

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

    IF v_file IS NULL OR v_task IS NULL OR NOT public.task_accessible(v_task) THEN
        RETURN;  -- no pointer, or caller can't see the task → log nothing
    END IF;

    -- ponytail: 15s dedupe collapses double-taps and any cross-surface overlap.
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

REVOKE EXECUTE ON FUNCTION public.rpc_filehub_log_activity_by_path(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_log_activity_by_path(text, text, text, jsonb) TO authenticated;
