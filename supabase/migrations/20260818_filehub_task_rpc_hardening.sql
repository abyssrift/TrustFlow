-- FileHub RPC quality pass (follow-up to #35/#284, see fc4832a and the
-- keen-plotting-platypus plan discussed the same session):
--
--   1. _filehub_storage_tracker: replace the visibility('task')-skip with
--      real per-object dedup (count each distinct stored object once,
--      regardless of how many filehub_files rows point at it), then backfill
--      every company's storage_used_bytes from scratch. This both reverses
--      the old task-attachment exemption (per explicit product decision:
--      everything uploaded to the company should count toward one total)
--      and fixes a second bug found along the way -- fn_harvest_task_output's
--      'project' rows share storage_path with their source 'task' row, so
--      they were being double-counted even under the old exemption.
--   2. filehub_link_task_file / fn_harvest_task_output: RAISE WARNING on the
--      two early-returns that should basically never fire (not the routine
--      "no project"/"no submission yet" ones -- those are normal and would
--      just be log noise).
--   3. filehub_advisory_lock(): extracts the hashtextextended+
--      pg_advisory_xact_lock two-liner (was copy-pasted identically in
--      rpc_filehub_upload_commit, filehub_link_task_file, and
--      fn_harvest_task_output) into one function. Wired into the latter two
--      only, since both are already being replaced here for #1/#2 above --
--      rpc_filehub_upload_commit is deliberately left untouched (large,
--      currently-correct, unmodified-today function; not worth the
--      transcription risk of re-pasting its full body for a cosmetic swap).
--      It should adopt the helper next time it's genuinely touched.
--   4. filehub_check_upload_limits(): the size-limit + storage-quota check
--      rpc_filehub_upload_commit already does, extracted so it can also gate
--      rpc_add_task_attachments / rpc_submit_work / rpc_edit_submission --
--      confirmed by reading each one that they had ZERO size/quota
--      enforcement today, unlike the official FileHub uploader.
--
-- NOT APPLIED to the database as part of this session (local-only) --
-- written for review. Section 1's backfill is the one genuinely
-- consequential piece: it rewrites company_billing.storage_used_bytes for
-- every company today. Before applying, run the `totals` CTE below
-- read-only and diff it against each company's current storage_used_bytes /
-- max_storage_bytes so it's known ahead of time whether this pushes anyone
-- over their limit.

-- ============================================================
-- Section 1: storage tracker -- per-object dedup instead of visibility-skip
-- ============================================================
CREATE OR REPLACE FUNCTION public._filehub_storage_tracker()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_delta      bigint;
  v_company_id uuid := COALESCE(NEW.company_id, OLD.company_id);
  v_shared     boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.filehub_files f
      WHERE f.company_id = NEW.company_id AND f.bucket = NEW.bucket AND f.storage_path = NEW.storage_path
        AND f.deleted_at IS NULL AND f.id <> NEW.id
    ) INTO v_shared;
    v_delta := CASE WHEN v_shared THEN 0 ELSE COALESCE(NEW.size_bytes, 0) END;
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- soft-delete: only subtract if no other live row still references this object
    SELECT EXISTS (
      SELECT 1 FROM public.filehub_files f
      WHERE f.company_id = OLD.company_id AND f.bucket = OLD.bucket AND f.storage_path = OLD.storage_path
        AND f.deleted_at IS NULL AND f.id <> OLD.id
    ) INTO v_shared;
    v_delta := CASE WHEN v_shared THEN 0 ELSE -COALESCE(OLD.size_bytes, 0) END;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    -- restore: only add back if no other live row already covers this object
    SELECT EXISTS (
      SELECT 1 FROM public.filehub_files f
      WHERE f.company_id = NEW.company_id AND f.bucket = NEW.bucket AND f.storage_path = NEW.storage_path
        AND f.deleted_at IS NULL AND f.id <> NEW.id
    ) INTO v_shared;
    v_delta := CASE WHEN v_shared THEN 0 ELSE COALESCE(NEW.size_bytes, 0) END;
  ELSE
    -- in-place size change on an already-live row (e.g. replace) -- unchanged
    -- from before. Doesn't intersect the shared-object case: replace always
    -- issues a fresh storage_path, and only task->project harvest ever
    -- shares one, which never replaces in place.
    v_delta := COALESCE(NEW.size_bytes, 0) - COALESCE(OLD.size_bytes, 0);
  END IF;

  IF v_delta <> 0 THEN
    UPDATE public.company_billing
    SET storage_used_bytes = GREATEST(0, storage_used_bytes + v_delta)
    WHERE company_id = v_company_id;
  END IF;

  RETURN NULL;
END;
$$;

-- Backfill: recompute from scratch rather than patch a delta onto an already
-- wrong number (old exemption undercounted task bytes; harvest overcounted
-- project bytes). One row per distinct live (company_id, bucket, storage_path).
WITH distinct_objects AS (
  SELECT DISTINCT ON (company_id, bucket, storage_path)
         company_id, size_bytes
  FROM public.filehub_files
  WHERE deleted_at IS NULL
  ORDER BY company_id, bucket, storage_path, created_at ASC
),
totals AS (
  SELECT company_id, SUM(size_bytes) AS total_bytes
  FROM distinct_objects
  GROUP BY company_id
)
UPDATE public.company_billing cb
SET storage_used_bytes = GREATEST(0, COALESCE(t.total_bytes, 0))
FROM totals t
WHERE cb.company_id = t.company_id;

-- Companies with zero live filehub_files rows: zero out rather than leave stale.
UPDATE public.company_billing cb
SET storage_used_bytes = 0
WHERE storage_used_bytes <> 0
  AND NOT EXISTS (SELECT 1 FROM public.filehub_files f WHERE f.company_id = cb.company_id AND f.deleted_at IS NULL);

-- ============================================================
-- Section 2: shared advisory-lock helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.filehub_advisory_lock(p_scope TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_scope, 0));
END;
$$;

-- ============================================================
-- Section 3: filehub_link_task_file -- lock helper + anomaly logging
-- ============================================================
CREATE OR REPLACE FUNCTION public.filehub_link_task_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bucket     text;
  v_task_id    uuid;
  v_uploader   uuid;
  v_existing   uuid;
  v_final_name text;
BEGIN
  IF NEW.storage_path IS NULL OR NEW.filehub_file_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'task_attachments' THEN
    v_bucket   := 'task-attachments';
    v_task_id  := NEW.task_id;
    v_uploader := COALESCE(NEW.uploaded_by, (SELECT created_by FROM public.tasks WHERE id = NEW.task_id));
  ELSE  -- submission_attachments
    v_bucket := 'submission-attachments';
    SELECT s.task_id, COALESCE(NEW.uploaded_by, s.submitted_by)
      INTO v_task_id, v_uploader
    FROM public.task_submissions s
    WHERE s.id = NEW.submission_id;
  END IF;

  -- Fail safe: no uploader or task -> don't block the insert, just skip
  -- linking. Should basically never happen (every attachment insert should
  -- resolve both) -- worth knowing about if it ever does.
  IF v_uploader IS NULL OR v_task_id IS NULL THEN
    RAISE WARNING 'filehub_link_task_file: could not resolve uploader/task for % row % (task_id=%, uploader=%)',
      TG_TABLE_NAME, NEW.id, v_task_id, v_uploader;
    RETURN NEW;
  END IF;

  -- Serialize reuse-check-then-insert within this task's scope (mirrors
  -- rpc_filehub_upload_commit's lock around filehub_dedupe_name). Without
  -- it, two attachment inserts landing close together for the same task
  -- both see "not found" and both insert -- the exact bug behind #35's 30
  -- duplicate rows.
  PERFORM public.filehub_advisory_lock(NEW.company_id::text || '|task|' || v_task_id::text);

  -- Reuse an existing pointer for the same object (kept-attachment pointer-copy
  -- in rpc_edit_submission, or an idempotent re-run) instead of duplicating.
  SELECT id INTO v_existing
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
      NEW.mime_type, COALESCE(NEW.file_size, 0), 'task', v_task_id, COALESCE(NEW.created_at, now())
    ) RETURNING id INTO v_existing;
  END IF;

  NEW.filehub_file_id := v_existing;
  RETURN NEW;
END;
$function$;

-- ============================================================
-- Section 4: fn_harvest_task_output -- lock helper + anomaly logging
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_harvest_task_output(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_task       RECORD;
    v_folder_id  UUID;
    v_submission UUID;
    v_actor      UUID := auth.uid();
    v_batch_id   UUID;
    r            RECORD;
    v_new_file   UUID;
    v_version_id UUID;
    v_final_name TEXT;
BEGIN
    SELECT id, company_id, project_id INTO v_task
    FROM public.tasks
    WHERE id = p_task_id AND deleted_at IS NULL;

    IF NOT FOUND OR v_task.project_id IS NULL THEN
        RETURN; -- not attached to a project: nothing to promote (normal, not logged)
    END IF;

    v_folder_id := public.fn_project_ensure_deliverable_folder(v_task.project_id);
    IF v_folder_id IS NULL THEN
        -- Should essentially always succeed -- worth knowing about if it doesn't.
        RAISE WARNING 'fn_harvest_task_output: could not resolve/create deliverable folder for project % (task %)',
          v_task.project_id, p_task_id;
        RETURN;
    END IF;

    -- Output = the task's most recent submission. task_attachments (the
    -- brief) is input, deliberately not harvested.
    SELECT id INTO v_submission
    FROM public.task_submissions
    WHERE task_id = p_task_id AND deleted_at IS NULL
    ORDER BY submitted_at DESC
    LIMIT 1;

    IF v_submission IS NULL THEN
        RETURN; -- nothing submitted yet -- normal, not logged
    END IF;

    v_batch_id := gen_random_uuid();

    -- Serialize reuse-check-then-insert for this project's deliverable
    -- folder (mirrors filehub_link_task_file's lock, above). One
    -- acquisition covers the whole batch in the loop below; advisory xact
    -- locks are reentrant within a transaction.
    PERFORM public.filehub_advisory_lock(v_task.company_id::text || '|project|' || v_folder_id::text);

    FOR r IN
        SELECT sf.storage_path, sf.bucket, sf.original_name, sf.mime_type,
               sf.size_bytes, sf.content_hash, sf.uploaded_by
        FROM public.submission_attachments sa
        JOIN public.filehub_files sf ON sf.id = sa.filehub_file_id
        WHERE sa.submission_id = v_submission
          AND sf.deleted_at IS NULL
    LOOP
        -- Idempotent: re-entering the stage with an unchanged file must not
        -- pile up duplicate rows.
        IF EXISTS (
            SELECT 1 FROM public.filehub_files
            WHERE folder_id = v_folder_id AND visibility = 'project'
              AND storage_path = r.storage_path AND bucket = r.bucket
              AND deleted_at IS NULL
        ) THEN
            CONTINUE;
        END IF;

        v_final_name := public.filehub_dedupe_name(r.original_name, 'project', NULL, v_folder_id);

        INSERT INTO public.filehub_files (
            company_id, uploaded_by, storage_path, bucket, original_name,
            mime_type, size_bytes, content_hash, visibility, folder_id, project_id
        ) VALUES (
            v_task.company_id, COALESCE(v_actor, r.uploaded_by), r.storage_path, r.bucket, v_final_name,
            r.mime_type, r.size_bytes, r.content_hash, 'project', v_folder_id, v_task.project_id
        ) RETURNING id INTO v_new_file;

        INSERT INTO public.filehub_file_versions (
            file_id, company_id, version_no, storage_path, bucket,
            original_name, size_bytes, mime_type, content_hash, created_by, batch_id
        ) VALUES (
            v_new_file, v_task.company_id, 1, r.storage_path, r.bucket,
            v_final_name, r.size_bytes, r.mime_type, r.content_hash,
            COALESCE(v_actor, r.uploaded_by), v_batch_id
        ) RETURNING id INTO v_version_id;

        UPDATE public.filehub_files SET current_version_id = v_version_id WHERE id = v_new_file;
    END LOOP;
END;
$function$;

-- ============================================================
-- Section 5: filehub_check_upload_limits -- shared size/quota gate
-- ============================================================
CREATE OR REPLACE FUNCTION public.filehub_check_upload_limits(p_size_bytes BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company_id    UUID := public.my_company_id();
  v_size_limit    BIGINT;
  v_storage_limit BIGINT;
  v_storage_used  BIGINT;
BEGIN
  v_size_limit := public._company_file_size_limit(v_company_id);
  IF v_size_limit <> -1 AND p_size_bytes > v_size_limit THEN
    RAISE EXCEPTION 'File too large for your plan (% MB limit). Upgrade to upload larger files.',
      round(v_size_limit::numeric / 1048576);
  END IF;

  v_storage_limit := public._company_storage_limit(v_company_id);
  IF v_storage_limit <> -1 THEN
    SELECT COALESCE(storage_used_bytes, 0) INTO v_storage_used
    FROM public.company_billing WHERE company_id = v_company_id FOR UPDATE;
    IF (COALESCE(v_storage_used, 0) + p_size_bytes) > v_storage_limit THEN
      RAISE EXCEPTION 'Storage quota exceeded (% MB of % MB used). Upgrade your plan to add more storage.',
        round(COALESCE(v_storage_used, 0)::numeric / 1048576),
        round(v_storage_limit::numeric / 1048576);
    END IF;
  END IF;
END;
$$;

-- ── rpc_add_task_attachments: + filehub_check_upload_limits per item ────────
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
  v_version_id  UUID;
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
    PERFORM public.filehub_check_upload_limits((v_item->>'file_size')::BIGINT);

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

    -- D1 (Model B): every new brief attachment starts at version 1
    INSERT INTO public.task_attachment_versions (
      attachment_id, company_id, version_no, storage_path, file_name, file_size, mime_type, created_by
    )
    VALUES (
      v_new_id, v_task.company_id, 1,
      v_item->>'storage_path', v_item->>'file_name',
      (v_item->>'file_size')::BIGINT, v_item->>'mime_type', v_caller_id
    )
    RETURNING id INTO v_version_id;

    UPDATE public.task_attachments SET current_version_id = v_version_id WHERE id = v_new_id;

    v_inserted := v_inserted || jsonb_build_object('id', v_new_id);
  END LOOP;

  RETURN v_inserted;
END;
$function$;

-- ── rpc_submit_work: + filehub_check_upload_limits per attachment ───────────
CREATE OR REPLACE FUNCTION public.rpc_submit_work(p_task_id uuid, p_content text DEFAULT NULL::text, p_assignment_id uuid DEFAULT NULL::uuid, p_transition_id uuid DEFAULT NULL::uuid, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_submission_id   UUID;
    v_company_id      UUID;
    v_user_id         UUID    := auth.uid();
    v_current_stage   UUID;
    v_target_stage_id UUID;
    v_revision_count  INTEGER := 0;
    v_att             RECORD;
    v_is_owner        BOOLEAN;
    v_task_created_by UUID;
    v_task_manager_id UUID;
    v_version_id      UUID;
BEGIN
    SELECT company_id, current_stage_id, created_by, manager_id
    INTO   v_company_id, v_current_stage, v_task_created_by, v_task_manager_id
    FROM   public.tasks
    WHERE  id = p_task_id AND deleted_at IS NULL;

    IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
    IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    v_is_owner := (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_user_id);

    IF p_assignment_id IS NULL THEN
        SELECT id INTO p_assignment_id
        FROM public.task_assignments
        WHERE task_id = p_task_id
          AND (
            assignee_user_id = v_user_id
            OR assignee_team_id IN (
                SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
            )
          )
        LIMIT 1;
    END IF;

    IF p_assignment_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.task_assignments
            WHERE id = p_assignment_id AND task_id = p_task_id
              AND (
                assignee_user_id = v_user_id
                OR assignee_team_id IN (
                    SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
                )
              )
        ) THEN
            RAISE EXCEPTION 'Forbidden: Assignment does not belong to user or task.' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF NOT (v_is_owner OR v_task_manager_id = v_user_id OR v_task_created_by = v_user_id) THEN
            RAISE EXCEPTION 'Forbidden: You must be assigned to this task to submit work.' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- First submission gets revision_count=0; each resubmission increments from the previous max.
    SELECT COALESCE(MAX(revision_count) + 1, 0) INTO v_revision_count
    FROM public.task_submissions
    WHERE task_id = p_task_id
      AND (p_assignment_id IS NULL OR assignment_id = p_assignment_id);

    UPDATE public.task_work_sessions
    SET status = 'completed', last_heartbeat_at = now()
    WHERE task_id = p_task_id AND user_id = v_user_id AND status = 'active';

    INSERT INTO public.task_submissions (
        task_id, company_id, submitted_by, assignment_id,
        content, stage_id, status, revision_count
    )
    VALUES (
        p_task_id, v_company_id, v_user_id, p_assignment_id,
        p_content, v_current_stage, 'pending', v_revision_count
    )
    RETURNING id INTO v_submission_id;

    -- A1 (Model B): every new submission starts at version 1
    INSERT INTO public.task_submission_versions (
        submission_id, company_id, version_no, content, created_by
    )
    VALUES (v_submission_id, v_company_id, 1, p_content, v_user_id)
    RETURNING id INTO v_version_id;

    UPDATE public.task_submissions
    SET current_version_id = v_version_id
    WHERE id = v_submission_id;

    IF p_attachments IS NOT NULL AND jsonb_array_length(p_attachments) > 0 THEN
        FOR v_att IN SELECT * FROM jsonb_to_recordset(p_attachments) AS x(
            file_name text, file_url text, file_size bigint,
            mime_type text, category text, storage_path text
        )
        LOOP
            PERFORM public.filehub_check_upload_limits(v_att.file_size);

            INSERT INTO public.submission_attachments (
                submission_id, company_id, uploaded_by,
                file_name, file_url, file_size, mime_type, category, storage_path, version_id
            )
            VALUES (
                v_submission_id, v_company_id, v_user_id,
                v_att.file_name, v_att.file_url, v_att.file_size,
                v_att.mime_type, v_att.category, v_att.storage_path, v_version_id
            );
        END LOOP;
    END IF;

    IF p_transition_id IS NOT NULL THEN
        SELECT to_stage_id INTO v_target_stage_id
        FROM public.pipeline_stage_transitions WHERE id = p_transition_id;
        IF v_target_stage_id IS NOT NULL THEN
            PERFORM public.rpc_advance_stage(p_task_id, v_target_stage_id, v_submission_id);
        END IF;
    END IF;

    RETURN v_submission_id;
END;
$function$;

-- ── rpc_edit_submission: + filehub_check_upload_limits on NEW attachments only ──
-- Kept attachments (pointer-copy of an already-existing row) are untouched --
-- those bytes were already checked when first uploaded.
CREATE OR REPLACE FUNCTION public.rpc_edit_submission(
  p_submission_id uuid,
  p_content text,
  p_kept_attachment_ids uuid[] DEFAULT '{}'::uuid[],
  p_new_attachments jsonb DEFAULT '[]'::jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_submission     RECORD;
  v_caller_id      UUID := auth.uid();
  v_new_version_id UUID;
  v_new_version_no INT;
  v_att            RECORD;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, task_id, company_id, submitted_by, status, deleted_at
  INTO   v_submission
  FROM   public.task_submissions
  WHERE  id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_submission.company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'submission not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_submission.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot edit a deleted submission' USING ERRCODE = 'P0001';
  END IF;

  -- Decision #2: original submitter OR tasks.manage OR owner
  IF v_submission.submitted_by <> v_caller_id
    AND NOT has_permission('tasks.manage')
    AND NOT (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_caller_id)
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_new_version_no
  FROM   public.task_submission_versions
  WHERE  submission_id = p_submission_id;

  UPDATE public.task_submission_versions
  SET    superseded_at = now()
  WHERE  submission_id = p_submission_id AND superseded_at IS NULL;

  INSERT INTO public.task_submission_versions (
    submission_id, company_id, version_no, content, created_by
  )
  VALUES (p_submission_id, v_submission.company_id, v_new_version_no, p_content, v_caller_id)
  RETURNING id INTO v_new_version_id;

  -- Kept attachments: pointer copy onto the new version -- same storage_path, no re-upload.
  -- Old version keeps its own rows untouched.
  INSERT INTO public.submission_attachments (
    submission_id, company_id, uploaded_by,
    file_name, file_url, file_size, mime_type, category, storage_path, version_id
  )
  SELECT a.submission_id, a.company_id, a.uploaded_by,
         a.file_name, a.file_url, a.file_size, a.mime_type, a.category, a.storage_path,
         v_new_version_id
  FROM   public.submission_attachments a
  WHERE  a.id = ANY(COALESCE(p_kept_attachment_ids, '{}'::uuid[]))
    AND  a.submission_id = p_submission_id;

  -- New attachments: same jsonb shape rpc_submit_work accepts (uploaded client-side first)
  IF p_new_attachments IS NOT NULL AND jsonb_array_length(p_new_attachments) > 0 THEN
    FOR v_att IN SELECT * FROM jsonb_to_recordset(p_new_attachments) AS x(
      file_name text, file_url text, file_size bigint,
      mime_type text, category text, storage_path text
    )
    LOOP
      PERFORM public.filehub_check_upload_limits(v_att.file_size);

      INSERT INTO public.submission_attachments (
        submission_id, company_id, uploaded_by,
        file_name, file_url, file_size, mime_type, category, storage_path, version_id
      )
      VALUES (
        p_submission_id, v_submission.company_id, v_caller_id,
        v_att.file_name, v_att.file_url, v_att.file_size,
        v_att.mime_type, v_att.category, v_att.storage_path, v_new_version_id
      );
    END LOOP;
  END IF;

  -- Pointer move + denormalized content sync. Decision #1: editing an
  -- approved/confirmed submission re-enters review (status -> pending).
  -- reviewed_by/reviewed_at/review_notes intentionally kept -- they belong to
  -- the superseded version's review.
  UPDATE public.task_submissions
  SET    current_version_id = v_new_version_id,
         content            = p_content,
         status             = CASE WHEN status IN ('approved', 'confirmed') THEN 'pending' ELSE status END,
         updated_at         = now(),
         updated_by         = v_caller_id
  WHERE  id = p_submission_id;

  PERFORM public.log_event(
    v_submission.company_id, v_caller_id, 'task', v_submission.task_id,
    'task.submission_edited',
    jsonb_build_object('submission_id', p_submission_id, 'version_no', v_new_version_no)
  );

  RETURN v_new_version_id;
END;
$function$;
