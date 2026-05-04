-- Fix rpc_add_task_attachments: include company_id in INSERT
-- The task_attachments table has company_id NOT NULL; the previous version
-- never set it, causing a null-constraint violation on every brief file upload.
CREATE OR REPLACE FUNCTION public.rpc_add_task_attachments(p_task_id uuid, p_attachments jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_task        RECORD;
  v_caller_id   UUID := auth.uid();
  v_item        JSONB;
  v_inserted    JSONB := '[]'::JSONB;
  v_new_id      UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT created_by, manager_id, company_id INTO v_task
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_task.created_by <> v_caller_id
    AND (v_task.manager_id IS NULL OR v_task.manager_id <> v_caller_id)
    AND NOT has_permission('tasks.manage')
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_attachments)
  LOOP
    INSERT INTO public.task_attachments (
      task_id, company_id, uploaded_by, file_name, file_url,
      file_size, mime_type, category, storage_path
    )
    VALUES (
      p_task_id, v_task.company_id, v_caller_id,
      v_item->>'file_name',
      v_item->>'file_url',
      (v_item->>'file_size')::BIGINT,
      v_item->>'mime_type',
      v_item->>'category',
      v_item->>'storage_path'
    )
    RETURNING id INTO v_new_id;

    v_inserted := v_inserted || jsonb_build_object('id', v_new_id);
  END LOOP;

  RETURN v_inserted;
END;
$function$;
