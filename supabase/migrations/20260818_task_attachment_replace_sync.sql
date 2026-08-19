-- Bug found during today's FileHub hardening review sweep (pre-existing,
-- not caused by today's work, but directly undermines it): rpc_replace_task_attachment
-- (Task Brief "Replace file") UPDATEs task_attachments' storage_path/size_bytes
-- in place, but:
--   1. Never touches the mirrored filehub_files row (linked via filehub_file_id,
--      set once by trg_filehub_link_task_file -- a BEFORE INSERT trigger, so it
--      never fires again on this UPDATE). The mirror keeps pointing at the old
--      object forever: FileHub browse/overview shows stale name/size for this
--      file indefinitely, and storage_used_bytes keeps counting the OLD bytes
--      (never freed) while the NEW bytes go completely uncounted -- a quiet
--      quota leak in both directions, on every brief-file replace.
--   2. Had zero size-limit / storage-quota enforcement -- the same category of
--      gap 20260818_filehub_task_rpc_hardening.sql fixed for the three other
--      task-attachment write paths, just missed there because replace isn't a
--      plain insert.
--
-- Fix: sync the mirror in the same UPDATE (safe to do as a flat NEW.size -
-- OLD.size delta via the existing _filehub_storage_tracker trigger --
-- task-visibility filehub_files rows are never shared with another live row,
-- since harvest only ever mirrors submission_attachments, not task_attachments,
-- so there's no dedup edge case to account for here). Quota check uses the net
-- delta, matching rpc_filehub_replace_file's own pattern, not the flat
-- filehub_check_upload_limits gate -- a same-or-smaller replacement must not
-- be rejected just because the company is already at quota.
CREATE OR REPLACE FUNCTION public.rpc_replace_task_attachment(
  p_attachment_id uuid,
  p_storage_path text,
  p_file_name text,
  p_file_size bigint,
  p_mime_type text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_att            RECORD;
  v_task           RECORD;
  v_caller_id      UUID := auth.uid();
  v_new_version_id UUID;
  v_new_version_no INT;
  v_size_limit     BIGINT;
  v_storage_limit  BIGINT;
  v_storage_used   BIGINT;
  v_net_delta      BIGINT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, task_id, company_id, deleted_at, file_size, filehub_file_id
  INTO   v_att
  FROM   public.task_attachments
  WHERE  id = p_attachment_id
  FOR UPDATE;

  IF NOT FOUND OR v_att.company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'attachment not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_att.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot replace a deleted attachment' USING ERRCODE = 'P0001';
  END IF;

  SELECT created_by, manager_id INTO v_task
  FROM   public.tasks WHERE id = v_att.task_id;

  -- Perm: task creator/manager/owner OR tasks.manage (rpc_add_task_attachments gate + owner)
  IF v_task.created_by <> v_caller_id
    AND (v_task.manager_id IS NULL OR v_task.manager_id <> v_caller_id)
    AND NOT has_permission('tasks.manage')
    AND NOT (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_caller_id)
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  v_size_limit := public._company_file_size_limit(v_att.company_id);
  IF v_size_limit <> -1 AND p_file_size > v_size_limit THEN
    RAISE EXCEPTION 'File too large for your plan (% MB limit). Upgrade to upload larger files.',
      round(v_size_limit::numeric / 1048576);
  END IF;

  v_net_delta := p_file_size - COALESCE(v_att.file_size, 0);
  IF v_net_delta > 0 THEN
    v_storage_limit := public._company_storage_limit(v_att.company_id);
    IF v_storage_limit <> -1 THEN
      SELECT COALESCE(storage_used_bytes, 0) INTO v_storage_used
      FROM public.company_billing WHERE company_id = v_att.company_id FOR UPDATE;
      IF (COALESCE(v_storage_used, 0) + v_net_delta) > v_storage_limit THEN
        RAISE EXCEPTION 'Storage quota exceeded (% MB of % MB used). Upgrade your plan to add more storage.',
          round(COALESCE(v_storage_used, 0)::numeric / 1048576),
          round(v_storage_limit::numeric / 1048576);
      END IF;
    END IF;
  END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_new_version_no
  FROM   public.task_attachment_versions
  WHERE  attachment_id = p_attachment_id;

  UPDATE public.task_attachment_versions
  SET    superseded_at = now()
  WHERE  attachment_id = p_attachment_id AND superseded_at IS NULL;

  INSERT INTO public.task_attachment_versions (
    attachment_id, company_id, version_no, storage_path, file_name, file_size, mime_type, created_by
  )
  VALUES (p_attachment_id, v_att.company_id, v_new_version_no, p_storage_path, p_file_name, p_file_size, p_mime_type, v_caller_id)
  RETURNING id INTO v_new_version_id;

  -- Pointer move + denorm sync (file_url doubles as the storage path in this table)
  UPDATE public.task_attachments
  SET    current_version_id = v_new_version_id,
         file_name          = p_file_name,
         file_url           = p_storage_path,
         storage_path       = p_storage_path,
         file_size          = p_file_size,
         mime_type          = p_mime_type,
         updated_at         = now(),
         updated_by         = v_caller_id
  WHERE  id = p_attachment_id;

  -- Keep the FileHub mirror in sync -- see migration header. Never shared
  -- with another live row (harvest never sources task_attachments), so a
  -- flat in-place update is safe; _filehub_storage_tracker picks up the
  -- resulting size_bytes delta automatically.
  IF v_att.filehub_file_id IS NOT NULL THEN
    UPDATE public.filehub_files
    SET storage_path  = p_storage_path,
        original_name = p_file_name,
        size_bytes    = p_file_size,
        mime_type     = p_mime_type,
        updated_at    = now()
    WHERE id = v_att.filehub_file_id;
  END IF;

  PERFORM public.log_event(
    v_att.company_id, v_caller_id, 'task', v_att.task_id,
    'task.attachment_replaced',
    jsonb_build_object('attachment_id', p_attachment_id, 'version_no', v_new_version_no, 'file_name', p_file_name)
  );

  RETURN v_new_version_id;
END;
$function$;
