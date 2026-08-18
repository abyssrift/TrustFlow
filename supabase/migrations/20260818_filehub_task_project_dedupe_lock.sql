-- Issue #35 follow-up (see docs/audit/filehub-write-paths-review.md): the
-- 30 duplicate rows and 3 duplicate-name groups found for #35 all turned out
-- to be visibility='task' -- none came from the official FileHub uploader
-- (rpc_filehub_upload_commit), which already has two protections:
--   1. pg_advisory_xact_lock around its check-then-insert
--   2. filehub_dedupe_name() renaming on a name clash instead of colliding
-- filehub_link_task_file() (the trigger behind every task_attachments /
-- submission_attachments insert -- i.e. task creation briefs, task detail
-- briefs, work submissions, edit-submission, stage-advance, archive/restore)
-- and fn_harvest_task_output() (the project-deliverable harvest) both
-- create filehub_files rows with NEITHER protection: an unlocked
-- check-then-insert and no rename-on-clash at all. This migration gives
-- them the exact same two protections the official path already has, so
-- every existing and future caller of either function is covered without
-- any client-side changes.
--
-- Out of scope here (filed as #284 instead): whether fn_harvest_task_output
-- should create a second row at all vs. a true pointer to the source file.
-- This migration fixes the current design's safety, not its shape.
--
-- NOT APPLIED to the database as part of this session (local-only) --
-- written to the repo for review. Purely additive (new function versions,
-- two new indexes, no backfill/soft-delete) -- lower-risk than #35 to apply
-- once reviewed. Both new indexes need no backfill: checked live
-- (2026-08-18) and there are zero existing within-task name clashes and
-- zero 'project'-visibility rows at all yet.

-- ============================================================
-- Section 1: filehub_dedupe_name -- add 'task' and 'project' branches
-- ============================================================
-- 'task' scope is (company_id, task_id): task attachments never get a
-- folder_id (always NULL), so every task's files sit together at "root" --
-- the natural collision boundary is one task, not the whole company.
-- 'project' scope reuses folder_id like the existing 'broadcast' branch:
-- fn_harvest_task_output always targets one dedicated deliverable folder
-- per project (fn_project_ensure_deliverable_folder), so folder_id alone
-- is already project-scoped -- no separate project_id parameter needed.
CREATE OR REPLACE FUNCTION public.filehub_dedupe_name(
    p_name       TEXT,
    p_visibility TEXT,
    p_group_id   UUID,
    p_folder_id  UUID,
    p_task_id    UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_base       TEXT;   -- name without extension
    v_ext        TEXT;   -- extension including leading dot ('' if none)
    v_dot        INT;
    v_candidate  TEXT;
    v_n          INT := 0;
    v_clash      BOOLEAN;
BEGIN
    -- Split base / extension on the last dot (ignore leading dot of dotfiles).
    v_dot := length(p_name) - position('.' IN reverse(p_name)) + 1;
    IF position('.' IN reverse(p_name)) > 0 AND v_dot > 1 THEN
        v_base := left(p_name, v_dot - 1);
        v_ext  := substring(p_name FROM v_dot);   -- includes the dot
    ELSE
        v_base := p_name;
        v_ext  := '';
    END IF;

    v_candidate := p_name;

    LOOP
        SELECT EXISTS (
            SELECT 1
            FROM public.filehub_files f
            WHERE f.deleted_at IS NULL
              AND f.company_id = v_company_id
              AND lower(trim(f.original_name)) = lower(trim(v_candidate))
              AND (
                  (p_visibility = 'group'     AND f.visibility = 'group'
                       AND f.group_id = p_group_id
                       AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
                  OR (p_visibility = 'broadcast' AND f.visibility = 'broadcast'
                       AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
                  OR (p_visibility = 'direct'    AND f.visibility = 'direct'
                       AND f.uploaded_by = v_user_id
                       AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
                  OR (p_visibility = 'task'      AND f.visibility = 'task'
                       AND f.task_id = p_task_id)
                  OR (p_visibility = 'project'   AND f.visibility = 'project'
                       AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
              )
        ) INTO v_clash;

        EXIT WHEN NOT v_clash;

        v_n := v_n + 1;
        v_candidate := v_base || ' (' || v_n || ')' || v_ext;
    END LOOP;

    RETURN v_candidate;
END;
$$;

-- ============================================================
-- Section 2: filehub_link_task_file -- lock + dedupe before insert
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
  v_lock_key   bigint;
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

  -- Fail safe: no uploader or task → don't block the insert, just skip linking.
  IF v_uploader IS NULL OR v_task_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize reuse-check-then-insert within this task's scope (mirrors
  -- rpc_filehub_upload_commit's lock around filehub_dedupe_name). Without
  -- it, two attachment inserts landing close together for the same task
  -- both see "not found" and both insert -- the exact bug behind #35's 30
  -- duplicate rows.
  v_lock_key := hashtextextended(
      NEW.company_id::text || '|task|' || v_task_id::text,
      0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

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
-- Section 3: fn_harvest_task_output -- lock + dedupe before insert
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
    v_lock_key   BIGINT;
    v_final_name TEXT;
BEGIN
    SELECT id, company_id, project_id INTO v_task
    FROM public.tasks
    WHERE id = p_task_id AND deleted_at IS NULL;

    IF NOT FOUND OR v_task.project_id IS NULL THEN
        RETURN; -- not attached to a project: nothing to promote
    END IF;

    v_folder_id := public.fn_project_ensure_deliverable_folder(v_task.project_id);
    IF v_folder_id IS NULL THEN
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
        RETURN; -- nothing submitted yet -- silent no-op, mirrors rpc_filehub_pointer_id's convention
    END IF;

    v_batch_id := gen_random_uuid();

    -- Serialize reuse-check-then-insert for this project's deliverable
    -- folder (mirrors filehub_link_task_file's lock, above). One
    -- acquisition covers the whole batch in the loop below; advisory xact
    -- locks are reentrant within a transaction.
    v_lock_key := hashtextextended(
        v_task.company_id::text || '|project|' || v_folder_id::text,
        0
    );
    PERFORM pg_advisory_xact_lock(v_lock_key);

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
-- Section 4: matching unique indexes -- enforce it at the DB level too,
-- not just in the two functions above. No backfill needed (see header).
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS filehub_files_name_uq_task
  ON public.filehub_files (company_id, task_id, (lower(trim(original_name))))
  WHERE deleted_at IS NULL AND visibility = 'task';

CREATE UNIQUE INDEX IF NOT EXISTS filehub_files_name_uq_project
  ON public.filehub_files (
    company_id,
    (coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (lower(trim(original_name)))
  )
  WHERE deleted_at IS NULL AND visibility = 'project';
