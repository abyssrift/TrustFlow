-- Phase 2B / #422: converge brief and submission attachment rows on the
-- immutable FileHub version they already reference.  Legacy columns and
-- legacy attachment-version tables remain readable during rollout.

ALTER TABLE public.task_attachments
  ADD COLUMN IF NOT EXISTS filehub_file_version_id uuid
    REFERENCES public.filehub_file_versions(id);
ALTER TABLE public.submission_attachments
  ADD COLUMN IF NOT EXISTS filehub_file_version_id uuid
    REFERENCES public.filehub_file_versions(id);
ALTER TABLE public.task_attachment_versions
  ADD COLUMN IF NOT EXISTS filehub_file_version_id uuid
    REFERENCES public.filehub_file_versions(id);

CREATE INDEX IF NOT EXISTS idx_task_attachments_filehub_version
  ON public.task_attachments (filehub_file_version_id);
CREATE INDEX IF NOT EXISTS idx_submission_attachments_filehub_version
  ON public.submission_attachments (filehub_file_version_id);
CREATE INDEX IF NOT EXISTS idx_task_attachment_versions_filehub_version
  ON public.task_attachment_versions (filehub_file_version_id);

-- Repair task FileHub rows that predate the versioning trigger.  This is
-- metadata-only: it registers the existing object as immutable v1.
INSERT INTO public.filehub_file_versions
  (file_id, company_id, version_no, storage_path, bucket, original_name,
   size_bytes, mime_type, created_by, created_at)
SELECT f.id, f.company_id, 1, f.storage_path, f.bucket, f.original_name,
  f.size_bytes, f.mime_type, f.uploaded_by, f.created_at
FROM public.filehub_files f
WHERE f.visibility = 'task' AND f.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.filehub_file_versions v WHERE v.file_id = f.id);

UPDATE public.filehub_files f
SET current_version_id = v.id
FROM public.filehub_file_versions v
WHERE v.file_id = f.id AND f.visibility = 'task'
  AND f.deleted_at IS NULL AND f.current_version_id IS NULL
  AND v.version_no = (SELECT min(v2.version_no)
                      FROM public.filehub_file_versions v2 WHERE v2.file_id = f.id);

-- Re-runnable pointer backfill.  The storage-path match is deliberately the
-- first choice: a restored legacy row may point at an older immutable FileHub
-- version rather than the file's current version.
UPDATE public.task_attachments a
SET filehub_file_id = f.id
FROM public.filehub_files f
WHERE a.filehub_file_id IS NULL
  AND a.storage_path IS NOT NULL
  AND f.company_id = a.company_id
  AND f.visibility = 'task'
  AND f.task_id = a.task_id
  AND f.bucket = 'task-attachments'
  AND f.storage_path = a.storage_path;

UPDATE public.submission_attachments a
SET filehub_file_id = f.id
FROM public.filehub_files f, public.task_submissions s
WHERE a.filehub_file_id IS NULL
  AND a.storage_path IS NOT NULL
  AND s.id = a.submission_id
  AND f.company_id = a.company_id
  AND f.visibility = 'task'
  AND f.task_id = s.task_id
  AND f.bucket = 'submission-attachments'
  AND f.storage_path = a.storage_path;

UPDATE public.task_attachments a
SET filehub_file_version_id = COALESCE(
  (SELECT v.id FROM public.filehub_file_versions v
   WHERE v.file_id = a.filehub_file_id AND v.storage_path = a.storage_path
   ORDER BY v.version_no DESC LIMIT 1),
  (SELECT f.current_version_id FROM public.filehub_files f
   WHERE f.id = a.filehub_file_id)
)
WHERE a.filehub_file_id IS NOT NULL AND a.filehub_file_version_id IS NULL;

UPDATE public.task_attachment_versions v
SET filehub_file_version_id = COALESCE(
  (SELECT fv.id FROM public.filehub_file_versions fv
   JOIN public.task_attachments a ON a.filehub_file_id = fv.file_id
   WHERE a.id = v.attachment_id AND fv.storage_path = v.storage_path
   ORDER BY fv.version_no DESC LIMIT 1),
  (SELECT a.filehub_file_version_id FROM public.task_attachments a
   WHERE a.id = v.attachment_id AND a.storage_path = v.storage_path)
)
WHERE v.filehub_file_version_id IS NULL;

UPDATE public.submission_attachments a
SET filehub_file_version_id = COALESCE(
  (SELECT v.id FROM public.filehub_file_versions v
   WHERE v.file_id = a.filehub_file_id AND v.storage_path = a.storage_path
   ORDER BY v.version_no DESC LIMIT 1),
  (SELECT f.current_version_id FROM public.filehub_files f
   WHERE f.id = a.filehub_file_id)
)
WHERE a.filehub_file_id IS NOT NULL AND a.filehub_file_version_id IS NULL;

-- The trigger is the write-through choke point for plain INSERTs from both
-- RPC families.  Explicit pointers (notably kept submission attachments) are
-- preserved; legacy metadata remains the fallback when no FileHub pointer is
-- available.
CREATE OR REPLACE FUNCTION public.filehub_link_task_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bucket text;
  v_task_id uuid;
  v_uploader uuid;
  v_existing uuid;
  v_final_name text;
  v_version_id uuid;
  v_storage_path text;
  v_original_name text;
  v_size bigint;
  v_mime_type text;
BEGIN
  IF NEW.storage_path IS NULL THEN RETURN NEW; END IF;

  IF NEW.filehub_file_version_id IS NOT NULL AND NEW.filehub_file_id IS NULL THEN
    RAISE EXCEPTION 'FileHub version pointers require a FileHub file pointer';
  END IF;

  IF NEW.filehub_file_id IS NOT NULL THEN
    IF TG_TABLE_NAME = 'task_attachments' THEN
      v_task_id := NEW.task_id;
    ELSE
      SELECT task_id INTO v_task_id FROM public.task_submissions WHERE id = NEW.submission_id;
    END IF;
    SELECT f.current_version_id INTO v_version_id
    FROM public.filehub_files f
    WHERE f.id = NEW.filehub_file_id AND f.company_id = NEW.company_id
      AND f.visibility = 'task' AND f.task_id = v_task_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'FileHub pointer does not belong to this company/task'; END IF;
    v_version_id := COALESCE(NEW.filehub_file_version_id, v_version_id);
    SELECT v.storage_path, v.bucket, v.original_name, v.size_bytes, v.mime_type
    INTO v_storage_path, v_bucket, v_original_name, v_size, v_mime_type
    FROM public.filehub_file_versions v
    WHERE v.id = v_version_id AND v.file_id = NEW.filehub_file_id
      AND v.company_id = NEW.company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'FileHub version pointer does not belong to the FileHub file'; END IF;
    NEW.filehub_file_version_id := v_version_id;
    NEW.storage_path := v_storage_path;
    NEW.file_url := v_storage_path;
    NEW.file_name := v_original_name;
    NEW.file_size := v_size;
    NEW.mime_type := v_mime_type;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'task_attachments' THEN
    v_bucket := 'task-attachments';
    v_task_id := NEW.task_id;
    v_uploader := COALESCE(NEW.uploaded_by,
      (SELECT created_by FROM public.tasks WHERE id = NEW.task_id));
  ELSE
    v_bucket := 'submission-attachments';
    SELECT s.task_id, COALESCE(NEW.uploaded_by, s.submitted_by)
    INTO v_task_id, v_uploader
    FROM public.task_submissions s WHERE s.id = NEW.submission_id;
  END IF;

  IF v_uploader IS NULL OR v_task_id IS NULL THEN
    RAISE WARNING 'filehub_link_task_file: could not resolve task/uploader for % row %', TG_TABLE_NAME, NEW.id;
    RETURN NEW;
  END IF;

  PERFORM public.filehub_advisory_lock(NEW.company_id::text || '|task|' || v_task_id::text);
  SELECT id, current_version_id INTO v_existing, v_version_id
  FROM public.filehub_files
  WHERE company_id = NEW.company_id AND bucket = v_bucket
    AND storage_path = NEW.storage_path AND visibility = 'task'
  LIMIT 1;

  IF v_existing IS NULL THEN
    v_final_name := public.filehub_dedupe_name(NEW.file_name, 'task', NULL, NULL, v_task_id);
    INSERT INTO public.filehub_files (
      company_id, uploaded_by, storage_path, bucket, original_name,
      mime_type, size_bytes, visibility, task_id, created_at
    ) VALUES (
      NEW.company_id, v_uploader, NEW.storage_path, v_bucket, v_final_name,
      NEW.mime_type, COALESCE(NEW.file_size, 0), 'task', v_task_id,
      COALESCE(NEW.created_at, now())
    ) RETURNING id INTO v_existing;

    INSERT INTO public.filehub_file_versions (
      file_id, company_id, version_no, storage_path, bucket, original_name,
      size_bytes, mime_type, created_by
    ) VALUES (
      v_existing, NEW.company_id, 1, NEW.storage_path, v_bucket, v_final_name,
      COALESCE(NEW.file_size, 0), NEW.mime_type, v_uploader
    ) RETURNING id INTO v_version_id;
    UPDATE public.filehub_files SET current_version_id = v_version_id
    WHERE id = v_existing;
  END IF;

  NEW.filehub_file_id := v_existing;
  NEW.filehub_file_version_id := COALESCE(v_version_id,
    (SELECT current_version_id FROM public.filehub_files WHERE id = v_existing));
  RETURN NEW;
END;
$function$;

-- Brief replacement keeps its existing RPC signature and legacy version
-- return value, but appends an immutable FileHub version instead of mutating
-- the FileHub file row without history.
CREATE OR REPLACE FUNCTION public.rpc_replace_task_attachment(
  p_attachment_id uuid, p_storage_path text, p_file_name text,
  p_file_size bigint, p_mime_type text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a record; t record; caller uuid := auth.uid();
  legacy_version uuid; fh_version uuid; next_no int; fh record;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.task_attachments WHERE id = p_attachment_id FOR UPDATE;
  IF NOT FOUND OR a.company_id <> public.my_company_id() THEN RAISE EXCEPTION 'attachment not found' USING ERRCODE='P0002'; END IF;
  IF a.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'cannot replace a deleted attachment' USING ERRCODE='P0001'; END IF;
  SELECT created_by, manager_id INTO t FROM public.tasks WHERE id = a.task_id;
  IF t.created_by <> caller AND (t.manager_id IS NULL OR t.manager_id <> caller)
     AND NOT public.has_permission('tasks.manage')
     AND NOT COALESCE((SELECT is_owner FROM public.users WHERE id = caller), false)
  THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO next_no
  FROM public.task_attachment_versions WHERE attachment_id = p_attachment_id;
  UPDATE public.task_attachment_versions SET superseded_at = now()
  WHERE attachment_id = p_attachment_id AND superseded_at IS NULL;
  INSERT INTO public.task_attachment_versions
    (attachment_id, company_id, version_no, storage_path, file_name, file_size, mime_type, created_by, filehub_file_version_id)
  VALUES (p_attachment_id, a.company_id, next_no, p_storage_path, p_file_name,
          p_file_size, p_mime_type, caller, NULL) RETURNING id INTO legacy_version;

  IF a.filehub_file_id IS NOT NULL THEN
    SELECT * INTO fh FROM public.filehub_files WHERE id = a.filehub_file_id FOR UPDATE;
    SELECT COALESCE(MAX(version_no), 0) + 1 INTO next_no
    FROM public.filehub_file_versions WHERE file_id = fh.id;
    UPDATE public.filehub_file_versions SET superseded_at = now()
    WHERE file_id = fh.id AND superseded_at IS NULL;
    INSERT INTO public.filehub_file_versions
      (file_id, company_id, version_no, storage_path, bucket, original_name,
       size_bytes, mime_type, created_by)
    VALUES (fh.id, a.company_id, next_no, p_storage_path, fh.bucket, p_file_name,
            COALESCE(p_file_size, 0), p_mime_type, caller)
    RETURNING id INTO fh_version;
    UPDATE public.filehub_files SET current_version_id = fh_version,
      storage_path = p_storage_path, original_name = p_file_name,
      size_bytes = COALESCE(p_file_size, 0), mime_type = p_mime_type,
      updated_at = now(), updated_by = caller WHERE id = fh.id;
    UPDATE public.task_attachment_versions
    SET filehub_file_version_id = fh_version
    WHERE id = legacy_version;
  END IF;

  UPDATE public.task_attachments SET current_version_id = legacy_version,
    filehub_file_version_id = COALESCE(fh_version, filehub_file_version_id),
    file_name = p_file_name, file_url = p_storage_path, storage_path = p_storage_path,
    file_size = p_file_size, mime_type = p_mime_type, updated_at = now(), updated_by = caller
  WHERE id = p_attachment_id;
  PERFORM public.log_event(a.company_id, caller, 'task', a.task_id,
    'task.attachment_replaced', jsonb_build_object('attachment_id', p_attachment_id,
    'version_no', (SELECT version_no FROM public.task_attachment_versions WHERE id = legacy_version),
    'file_name', p_file_name));
  RETURN legacy_version;
END;
$function$;

-- Kept submission attachments must carry the exact immutable pointer they
-- had in the prior collection version. New attachments still use the trigger.
CREATE OR REPLACE FUNCTION public.rpc_edit_submission(
  p_submission_id uuid, p_content text,
  p_kept_attachment_ids uuid[] DEFAULT '{}'::uuid[],
  p_new_attachments jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s record; v uuid; n int; v_new_attachment record; caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.task_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND OR s.company_id <> public.my_company_id() THEN RAISE EXCEPTION 'submission not found' USING ERRCODE='P0002'; END IF;
  IF s.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'cannot edit a deleted submission' USING ERRCODE='P0001'; END IF;
  IF s.submitted_by <> caller AND NOT public.has_permission('tasks.manage')
     AND NOT COALESCE((SELECT is_owner FROM public.users WHERE id = caller), false)
  THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(MAX(version_no), 0) + 1 INTO n
  FROM public.task_submission_versions WHERE submission_id = p_submission_id;
  UPDATE public.task_submission_versions SET superseded_at = now()
  WHERE submission_id = p_submission_id AND superseded_at IS NULL;
  INSERT INTO public.task_submission_versions
    (submission_id, company_id, version_no, content, created_by)
  VALUES (p_submission_id, s.company_id, n, p_content, caller) RETURNING id INTO v;

  INSERT INTO public.submission_attachments
    (submission_id, company_id, uploaded_by, file_name, file_url, file_size,
     mime_type, category, storage_path, version_id, filehub_file_id, filehub_file_version_id)
  SELECT a.submission_id, a.company_id, a.uploaded_by, a.file_name, a.file_url,
    a.file_size, a.mime_type, a.category, a.storage_path, v,
    a.filehub_file_id, a.filehub_file_version_id
  FROM public.submission_attachments a
  WHERE a.id = ANY(COALESCE(p_kept_attachment_ids, '{}'::uuid[]))
    AND a.submission_id = p_submission_id;

  IF p_new_attachments IS NOT NULL AND jsonb_array_length(p_new_attachments) > 0 THEN
    FOR v_new_attachment IN SELECT * FROM jsonb_to_recordset(p_new_attachments) AS x(
      file_name text, file_url text, file_size bigint, mime_type text,
      category text, storage_path text, filehub_file_id uuid,
      filehub_file_version_id uuid)
    LOOP
      PERFORM public.filehub_check_upload_limits(v_new_attachment.file_size);
      INSERT INTO public.submission_attachments
        (submission_id, company_id, uploaded_by, file_name, file_url, file_size,
         mime_type, category, storage_path, version_id, filehub_file_id,
         filehub_file_version_id)
      VALUES (p_submission_id, s.company_id, caller, v_new_attachment.file_name, v_new_attachment.file_url,
        v_new_attachment.file_size, v_new_attachment.mime_type, v_new_attachment.category,
        v_new_attachment.storage_path, v, v_new_attachment.filehub_file_id,
        v_new_attachment.filehub_file_version_id);
    END LOOP;
  END IF;
  UPDATE public.task_submissions SET current_version_id = v, content = p_content,
    status = CASE WHEN status IN ('approved','confirmed') THEN 'pending' ELSE status END,
    updated_at = now(), updated_by = caller WHERE id = p_submission_id;
  PERFORM public.log_event(s.company_id, caller, 'task', s.task_id,
    'task.submission_edited', jsonb_build_object('submission_id', p_submission_id, 'version_no', n));
  RETURN v;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_replace_task_attachment(uuid,text,text,bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_edit_submission(uuid,text,uuid[],jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_replace_task_attachment(uuid,text,text,bigint,text) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.rpc_edit_submission(uuid,text,uuid[],jsonb) FROM PUBLIC,anon;

-- New submissions accept explicit FileHub identities from UploadManager.  The
-- legacy metadata-only shape remains valid and is still completed by the
-- filehub_link_task_file trigger.
CREATE OR REPLACE FUNCTION public.rpc_submit_work(
  p_task_id uuid,
  p_content text DEFAULT NULL::text,
  p_assignment_id uuid DEFAULT NULL::uuid,
  p_transition_id uuid DEFAULT NULL::uuid,
  p_attachments jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_submission_id uuid; v_company_id uuid; v_user_id uuid := auth.uid();
  v_current_stage uuid; v_target_stage_id uuid; v_revision_count integer := 0;
  v_att record; v_is_owner boolean; v_task_created_by uuid;
  v_task_manager_id uuid; v_version_id uuid;
BEGIN
  SELECT company_id,current_stage_id,created_by,manager_id
  INTO v_company_id,v_current_stage,v_task_created_by,v_task_manager_id
  FROM public.tasks WHERE id=p_task_id AND deleted_at IS NULL;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_company_id <> public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  v_is_owner := (SELECT COALESCE(is_owner,false) FROM public.users WHERE id=v_user_id);
  IF p_assignment_id IS NULL THEN
    SELECT id INTO p_assignment_id FROM public.task_assignments
    WHERE task_id=p_task_id AND (assignee_user_id=v_user_id OR assignee_team_id IN (
      SELECT team_id FROM public.team_members WHERE user_id=v_user_id AND removed_at IS NULL)) LIMIT 1;
  END IF;
  IF p_assignment_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.task_assignments WHERE id=p_assignment_id AND task_id=p_task_id
      AND (assignee_user_id=v_user_id OR assignee_team_id IN (
        SELECT team_id FROM public.team_members WHERE user_id=v_user_id AND removed_at IS NULL)))
    THEN RAISE EXCEPTION 'Forbidden: Assignment does not belong to user or task.' USING ERRCODE='42501'; END IF;
  ELSIF NOT (v_is_owner OR v_task_manager_id=v_user_id OR v_task_created_by=v_user_id) THEN
    RAISE EXCEPTION 'Forbidden: You must be assigned to this task to submit work.' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(MAX(revision_count)+1,0) INTO v_revision_count FROM public.task_submissions
  WHERE task_id=p_task_id AND (p_assignment_id IS NULL OR assignment_id=p_assignment_id);
  UPDATE public.task_work_sessions SET status='completed',last_heartbeat_at=now()
  WHERE task_id=p_task_id AND user_id=v_user_id AND status='active';
  INSERT INTO public.task_submissions(task_id,company_id,submitted_by,assignment_id,content,stage_id,status,revision_count)
  VALUES(p_task_id,v_company_id,v_user_id,p_assignment_id,p_content,v_current_stage,'pending',v_revision_count)
  RETURNING id INTO v_submission_id;
  INSERT INTO public.task_submission_versions(submission_id,company_id,version_no,content,created_by)
  VALUES(v_submission_id,v_company_id,1,p_content,v_user_id) RETURNING id INTO v_version_id;
  UPDATE public.task_submissions SET current_version_id=v_version_id WHERE id=v_submission_id;
  IF p_attachments IS NOT NULL AND jsonb_array_length(p_attachments)>0 THEN
    FOR v_att IN SELECT * FROM jsonb_to_recordset(p_attachments) AS x(
      file_name text,file_url text,file_size bigint,mime_type text,category text,
      storage_path text,filehub_file_id uuid,filehub_file_version_id uuid)
    LOOP
      PERFORM public.filehub_check_upload_limits(v_att.file_size);
      INSERT INTO public.submission_attachments(
        submission_id,company_id,uploaded_by,file_name,file_url,file_size,mime_type,
        category,storage_path,version_id,filehub_file_id,filehub_file_version_id)
      VALUES(v_submission_id,v_company_id,v_user_id,v_att.file_name,v_att.file_url,
        v_att.file_size,v_att.mime_type,v_att.category,v_att.storage_path,v_version_id,
        v_att.filehub_file_id,v_att.filehub_file_version_id);
    END LOOP;
  END IF;
  IF p_transition_id IS NOT NULL THEN
    SELECT to_stage_id INTO v_target_stage_id FROM public.pipeline_stage_transitions WHERE id=p_transition_id;
    IF v_target_stage_id IS NOT NULL THEN PERFORM public.rpc_advance_stage(p_task_id,v_target_stage_id,v_submission_id); END IF;
  END IF;
  RETURN v_submission_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rpc_submit_work(uuid,text,uuid,uuid,jsonb) TO authenticated;

-- The task-detail payload predates the FileHub pointers. Keep its established
-- collection shape intact and expose the converged identities through a small
-- read RPC that the client can merge by attachment id.
CREATE OR REPLACE FUNCTION public.rpc_task_filehub_attachment_pointers(p_task_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.tasks
  WHERE id = p_task_id AND deleted_at IS NULL;
  IF v_company_id IS NULL OR v_company_id <> public.my_company_id()
     OR NOT public.task_accessible(p_task_id) THEN
    RETURN jsonb_build_object('task_attachments', '[]'::jsonb, 'submission_attachments', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'task_attachments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'bucket', COALESCE(f.bucket, 'task-attachments'),
        'filehub_file_id', a.filehub_file_id,
        'filehub_file_version_id', a.filehub_file_version_id
      ) ORDER BY a.created_at DESC)
      FROM public.task_attachments a
      LEFT JOIN public.filehub_files f ON f.id = a.filehub_file_id
      WHERE a.task_id = p_task_id AND a.deleted_at IS NULL
    ), '[]'::jsonb),
    'submission_attachments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'submission_id', a.submission_id,
        'bucket', COALESCE(f.bucket, 'submission-attachments'),
        'filehub_file_id', a.filehub_file_id,
        'filehub_file_version_id', a.filehub_file_version_id
      ) ORDER BY a.id)
      FROM public.submission_attachments a
      JOIN public.task_submissions s ON s.id = a.submission_id
      LEFT JOIN public.filehub_files f ON f.id = a.filehub_file_id
      WHERE s.task_id = p_task_id AND s.deleted_at IS NULL
        AND a.version_id = s.current_version_id
    ), '[]'::jsonb)
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rpc_task_filehub_attachment_pointers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_task_filehub_attachment_pointers(uuid) TO authenticated;

-- Keep the established brief-add signature/grant.  The trigger creates the
-- FileHub row/version; this RPC records that exact immutable version on the
-- legacy history row as well.
CREATE OR REPLACE FUNCTION public.rpc_add_task_attachments(p_task_id uuid, p_attachments jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t record; item jsonb; new_id uuid; v jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT created_by, manager_id, company_id INTO t FROM public.tasks
  WHERE id = p_task_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found' USING ERRCODE='P0002'; END IF;
  IF t.created_by <> auth.uid() AND (t.manager_id IS NULL OR t.manager_id <> auth.uid())
     AND NOT public.has_permission('tasks.manage')
  THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_attachments) LOOP
    INSERT INTO public.task_attachments
      (task_id, company_id, uploaded_by, file_name, file_url, file_size,
       mime_type, category, storage_path, filehub_file_id, filehub_file_version_id)
    VALUES (p_task_id, t.company_id, auth.uid(), item->>'file_name', item->>'file_url',
      (item->>'file_size')::bigint, item->>'mime_type', item->>'category', item->>'storage_path',
      NULLIF(item->>'filehub_file_id','')::uuid, NULLIF(item->>'filehub_file_version_id','')::uuid)
    RETURNING id INTO new_id;
    INSERT INTO public.task_attachment_versions
      (attachment_id, company_id, version_no, storage_path, file_name, file_size,
       mime_type, created_by, filehub_file_version_id)
    SELECT new_id, t.company_id, 1, a.storage_path, a.file_name, a.file_size,
      a.mime_type, auth.uid(), a.filehub_file_version_id
    FROM public.task_attachments a WHERE a.id = new_id;
    UPDATE public.task_attachments ta SET current_version_id = v.id
    FROM public.task_attachment_versions v
    WHERE v.attachment_id = new_id AND v.version_no = 1 AND ta.id = new_id;
    v := v || jsonb_build_object('id', new_id);
  END LOOP;
  RETURN v;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rpc_add_task_attachments(uuid,jsonb) TO authenticated;

-- Manager-side upload commit for task files. It registers the already-uploaded
-- object without copying bytes; the legacy attachment trigger remains valid
-- for callers that still insert task_attachments with only storage metadata.
CREATE OR REPLACE FUNCTION public.rpc_task_filehub_upload_commit(
  p_task_id uuid, p_storage_path text, p_original_name text, p_mime_type text,
  p_size_bytes bigint, p_content_hash text, p_caption text DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c uuid := public.my_company_id(); u uuid := auth.uid(); f uuid; v uuid; n int;
BEGIN
  IF u IS NULL OR c IS NULL OR NOT public.task_accessible(p_task_id) THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE='P0002';
  END IF;
  IF NOT public.has_permission('tasks.manage') AND NOT EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = p_task_id
      AND (t.created_by = u OR t.manager_id = u
        OR COALESCE((SELECT is_owner FROM public.users WHERE id = u), false)
        OR EXISTS (
          SELECT 1 FROM public.task_assignments ta
          WHERE ta.task_id = t.id
            AND (ta.assignee_user_id = u OR ta.assignee_team_id IN (
              SELECT tm.team_id FROM public.team_members tm
              WHERE tm.user_id = u AND tm.removed_at IS NULL)))) ) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  PERFORM public._rate_limit('file_upload', 1000);
  PERFORM public.filehub_check_upload_limits(p_size_bytes);
  PERFORM public.filehub_advisory_lock(c::text || '|task|' || p_task_id::text);
  SELECT id INTO f FROM public.filehub_files
  WHERE company_id = c AND visibility = 'task' AND task_id = p_task_id
    AND bucket = 'filehub-files' AND storage_path = p_storage_path
    AND deleted_at IS NULL LIMIT 1;
  IF f IS NULL THEN
    INSERT INTO public.filehub_files
      (company_id, uploaded_by, storage_path, bucket, original_name, mime_type,
       size_bytes, content_hash, caption, visibility, task_id)
    VALUES (c, u, p_storage_path, 'filehub-files',
      public.filehub_dedupe_name(p_original_name, 'task', NULL, NULL, p_task_id), p_mime_type,
      p_size_bytes, p_content_hash, p_caption, 'task', p_task_id) RETURNING id INTO f;
    n := 1;
    INSERT INTO public.filehub_file_versions
      (file_id, company_id, version_no, storage_path, bucket, original_name,
       size_bytes, mime_type, content_hash, created_by, batch_id)
    VALUES (f, c, n, p_storage_path, 'filehub-files',
      (SELECT original_name FROM public.filehub_files WHERE id = f),
      p_size_bytes, p_mime_type, p_content_hash, u, p_batch_id) RETURNING id INTO v;
    UPDATE public.filehub_files SET current_version_id = v WHERE id = f;
  ELSE
    SELECT current_version_id INTO v FROM public.filehub_files WHERE id = f;
  END IF;
  RETURN jsonb_build_object('fileId', f, 'fileVersionId', v);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rpc_task_filehub_upload_commit(uuid,text,text,text,bigint,text,text,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_task_filehub_upload_commit(uuid,text,text,text,bigint,text,text,uuid) FROM PUBLIC,anon;

CREATE OR REPLACE FUNCTION public.rpc_task_filehub_replace_file(
  p_target_id uuid, p_task_id uuid, p_storage_path text, p_size_bytes bigint,
  p_content_hash text, p_mime_type text, p_caption text DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c uuid := public.my_company_id(); u uuid := auth.uid(); f record; v uuid; n int; a record;
BEGIN
  IF u IS NULL OR c IS NULL OR NOT public.task_accessible(p_task_id) THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE='P0002';
  END IF;
  IF NOT public.has_permission('tasks.manage') AND NOT EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = p_task_id
      AND (t.created_by = u OR t.manager_id = u
        OR COALESCE((SELECT is_owner FROM public.users WHERE id = u), false))) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  PERFORM public._rate_limit('file_replace', 1000);
  PERFORM public.filehub_check_upload_limits(p_size_bytes);
  PERFORM public.filehub_advisory_lock(c::text || '|task|' || p_task_id::text);
  SELECT * INTO f FROM public.filehub_files WHERE id = p_target_id
    AND company_id = c AND visibility = 'task' AND task_id = p_task_id
    AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'File not found.' USING ERRCODE='P0002'; END IF;
  SELECT COALESCE(MAX(version_no), 0) + 1 INTO n
  FROM public.filehub_file_versions WHERE file_id = f.id;
  UPDATE public.filehub_file_versions SET superseded_at = now()
  WHERE file_id = f.id AND superseded_at IS NULL;
  INSERT INTO public.filehub_file_versions
    (file_id, company_id, version_no, storage_path, bucket, original_name,
     size_bytes, mime_type, content_hash, created_by, batch_id)
  VALUES (f.id, c, n, p_storage_path, 'filehub-files', f.original_name,
    p_size_bytes, p_mime_type, p_content_hash, u, p_batch_id) RETURNING id INTO v;
  UPDATE public.filehub_files SET current_version_id = v, storage_path = p_storage_path,
    size_bytes = p_size_bytes, mime_type = p_mime_type, content_hash = p_content_hash,
    caption = COALESCE(NULLIF(trim(COALESCE(p_caption, '')), ''), caption),
    updated_at = now(), updated_by = u WHERE id = f.id;

  FOR a IN SELECT id, company_id, file_name, file_size, mime_type
    FROM public.task_attachments WHERE filehub_file_id = f.id AND task_id = p_task_id FOR UPDATE
  LOOP
    SELECT COALESCE(MAX(version_no), 0) + 1 INTO n
    FROM public.task_attachment_versions WHERE attachment_id = a.id;
    UPDATE public.task_attachment_versions SET superseded_at = now()
    WHERE attachment_id = a.id AND superseded_at IS NULL;
    INSERT INTO public.task_attachment_versions
      (attachment_id, company_id, version_no, storage_path, file_name, file_size,
       mime_type, created_by, filehub_file_version_id)
    VALUES (a.id, a.company_id, n, p_storage_path, a.file_name, p_size_bytes,
      p_mime_type, u, v);
    UPDATE public.task_attachments SET filehub_file_version_id = v,
      storage_path = p_storage_path, file_url = p_storage_path,
      file_size = p_size_bytes, mime_type = p_mime_type, updated_at = now(), updated_by = u
    WHERE id = a.id;
  END LOOP;
  RETURN jsonb_build_object('fileId', f.id, 'fileVersionId', v);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rpc_task_filehub_replace_file(uuid,uuid,text,bigint,text,text,text,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_task_filehub_replace_file(uuid,uuid,text,bigint,text,text,text,uuid) FROM PUBLIC,anon;

-- Expand/contract fallback for a legacy brief row that has not received its
-- FileHub pointer yet. The already-uploaded bytes are committed once through
-- the task FileHub RPC, then the attachment/version pointers are converged in
-- the same transaction; no second bucket or upload path is introduced.
CREATE OR REPLACE FUNCTION public.rpc_task_attachment_filehub_replace(
  p_attachment_id uuid, p_task_id uuid, p_file_name text, p_storage_path text,
  p_size_bytes bigint, p_content_hash text, p_mime_type text,
  p_caption text DEFAULT NULL, p_batch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE a record; t record; commit_result jsonb; file_id uuid; version_id uuid;
  legacy_version_id uuid; next_no int; caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.task_attachments
  WHERE id = p_attachment_id AND task_id = p_task_id FOR UPDATE;
  IF NOT FOUND OR a.company_id <> public.my_company_id() OR a.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'attachment not found' USING ERRCODE='P0002';
  END IF;
  SELECT created_by, manager_id INTO t FROM public.tasks
  WHERE id = p_task_id AND deleted_at IS NULL;
  IF NOT FOUND OR (t.created_by <> caller AND (t.manager_id IS NULL OR t.manager_id <> caller)
     AND NOT public.has_permission('tasks.manage')
     AND NOT COALESCE((SELECT is_owner FROM public.users WHERE id = caller), false))
  THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;

  commit_result := public.rpc_task_filehub_upload_commit(
    p_task_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes,
    p_content_hash, p_caption, p_batch_id);
  file_id := (commit_result->>'fileId')::uuid;
  version_id := (commit_result->>'fileVersionId')::uuid;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO next_no
  FROM public.task_attachment_versions WHERE attachment_id = p_attachment_id;
  UPDATE public.task_attachment_versions SET superseded_at = now()
  WHERE attachment_id = p_attachment_id AND superseded_at IS NULL;
  INSERT INTO public.task_attachment_versions
    (attachment_id, company_id, version_no, storage_path, file_name, file_size,
     mime_type, created_by, filehub_file_version_id)
  VALUES (p_attachment_id, a.company_id, next_no, p_storage_path, p_file_name,
          p_size_bytes, p_mime_type, caller, version_id)
  RETURNING id INTO legacy_version_id;
  UPDATE public.task_attachments SET current_version_id = legacy_version_id,
    file_name = p_file_name, file_url = p_storage_path, storage_path = p_storage_path,
    file_size = p_size_bytes, mime_type = p_mime_type,
    filehub_file_id = file_id, filehub_file_version_id = version_id,
    updated_at = now(), updated_by = caller
  WHERE id = p_attachment_id;
  RETURN jsonb_build_object('fileId', file_id, 'fileVersionId', version_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rpc_task_attachment_filehub_replace(uuid,uuid,text,text,bigint,text,text,text,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_task_attachment_filehub_replace(uuid,uuid,text,text,bigint,text,text,text,uuid) FROM PUBLIC,anon;
