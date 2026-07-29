


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."pipeline_transition_type" AS ENUM (
    'success',
    'revision',
    'failure',
    'neutral'
);


ALTER TYPE "public"."pipeline_transition_type" OWNER TO "postgres";


CREATE TYPE "public"."transition_outcome_type" AS ENUM (
    'success',
    'revision',
    'failure',
    'neutral'
);


ALTER TYPE "public"."transition_outcome_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_can_manage_billing"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select is_owner from public.users where id = auth.uid()), false)
      or public.has_permission('company.billing');
$$;


ALTER FUNCTION "public"."_can_manage_billing"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_can_manage_retention"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select is_owner from public.users where id = auth.uid()), false)
      or public.has_permission('company.settings')
      or public.has_permission('role.manage');
$$;


ALTER FUNCTION "public"."_can_manage_retention"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_company_file_size_limit"("p_company_id" "uuid") RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN (bp.limits->>'max_file_bytes') IS NULL THEN -1
        ELSE (bp.limits->>'max_file_bytes')::bigint
      END
      FROM public.company_billing cb
      JOIN public.billing_plans bp ON bp.code = cb.plan_code
      WHERE cb.company_id = p_company_id
    ),
    10485760  -- 10 MB default (free plan) if no billing row
  );
$$;


ALTER FUNCTION "public"."_company_file_size_limit"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_company_member_limit"("p_company_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN (bp.limits->>'max_members') IS NULL THEN -1
        ELSE (bp.limits->>'max_members')::int
      END
      FROM public.company_billing cb
      JOIN public.billing_plans bp ON bp.code = cb.plan_code
      WHERE cb.company_id = p_company_id
    ),
    5  -- default: free plan cap, if no billing row
  );
$$;


ALTER FUNCTION "public"."_company_member_limit"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_company_pipeline_limit"("p_company_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN (bp.limits->>'max_pipelines') IS NULL THEN -1
        ELSE (bp.limits->>'max_pipelines')::int
      END
      FROM public.company_billing cb
      JOIN public.billing_plans bp ON bp.code = cb.plan_code
      WHERE cb.company_id = p_company_id
    ),
    3
  );
$$;


ALTER FUNCTION "public"."_company_pipeline_limit"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_company_storage_limit"("p_company_id" "uuid") RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN (bp.limits->>'max_storage_bytes') IS NULL THEN -1
        ELSE (bp.limits->>'max_storage_bytes')::bigint
      END
      FROM public.company_billing cb
      JOIN public.billing_plans bp ON bp.code = cb.plan_code
      WHERE cb.company_id = p_company_id
    ),
    524288000
  );
$$;


ALTER FUNCTION "public"."_company_storage_limit"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_enforce_member_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_limit   int;
  v_current int;
BEGIN
  -- only act when user is joining a company (company_id being set for first time)
  IF NEW.company_id IS NULL OR OLD.company_id = NEW.company_id THEN
    RETURN NEW;
  END IF;

  v_limit := public._company_member_limit(NEW.company_id);
  IF v_limit = -1 THEN RETURN NEW; END IF;  -- unlimited plan

  SELECT COUNT(*) INTO v_current
  FROM public.users
  WHERE company_id = NEW.company_id AND deleted_at IS NULL AND id != NEW.id;

  IF v_current >= v_limit THEN
    RAISE EXCEPTION 'Member limit reached (% of % seats). Upgrade your plan to add more members.',
      v_current, v_limit;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_enforce_member_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_enforce_pipeline_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_limit   int;
  v_current int;
BEGIN
  v_limit := public._company_pipeline_limit(NEW.company_id);
  IF v_limit = -1 THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_current
  FROM public.pipelines
  WHERE company_id = NEW.company_id AND deleted_at IS NULL;

  IF v_current >= v_limit THEN
    RAISE EXCEPTION 'Pipeline limit reached (% of % pipelines). Upgrade your plan to create more.',
      v_current, v_limit;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_enforce_pipeline_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_filehub_storage_tracker"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_delta bigint;
BEGIN
  IF COALESCE(NEW.visibility, OLD.visibility) = 'task' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_delta := COALESCE(NEW.size_bytes, 0);
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.deleted_at IS NULL THEN
      v_delta := -COALESCE(OLD.size_bytes, 0);
    ELSE
      v_delta := 0;
    END IF;
  ELSE
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_delta := -COALESCE(NEW.size_bytes, 0);
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_delta := COALESCE(NEW.size_bytes, 0);
    ELSE
      v_delta := COALESCE(NEW.size_bytes, 0) - COALESCE(OLD.size_bytes, 0);
    END IF;
  END IF;

  IF v_delta <> 0 THEN
    UPDATE public.company_billing
    SET storage_used_bytes = GREATEST(0, storage_used_bytes + v_delta)
    WHERE company_id = COALESCE(NEW.company_id, OLD.company_id);
  END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."_filehub_storage_tracker"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_internal_restore_task_archive"("p_archive_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_archive   RECORD;
    v_task      JSONB;
    v_task_id   UUID;
    v_parent_id UUID;
    v_sub       JSONB;
    v_kin       UUID;
BEGIN
    SELECT * INTO v_archive
    FROM public.archives
    WHERE id = p_archive_id AND entity_type = 'task';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task archive not found: %', p_archive_id;
    END IF;

    v_task    := v_archive.snapshot->'task';
    v_task_id := (v_task->>'id')::UUID;

    IF v_archive.restored_at IS NOT NULL THEN
        RETURN v_task_id;
    END IF;

    IF EXISTS (SELECT 1 FROM public.tasks WHERE id = v_task_id) THEN
        RETURN v_task_id;
    END IF;

    -- #159: parent must exist before a subtask can be inserted.
    v_parent_id := NULLIF(v_task->>'parent_task_id', '')::UUID;
    IF v_parent_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = v_parent_id) THEN
        SELECT id INTO v_kin
        FROM public.archives
        WHERE entity_type = 'task'
          AND company_id = v_archive.company_id
          AND restored_at IS NULL
          AND (snapshot->'task'->>'id')::UUID = v_parent_id;

        IF v_kin IS NULL THEN
            RAISE EXCEPTION
                'Cannot restore "%": its parent task is neither active nor in the archive.',
                v_archive.metadata->>'title';
        END IF;

        PERFORM public._internal_restore_task_archive(v_kin);

        -- Restoring the ancestor sweeps its descendants, which includes us.
        IF EXISTS (SELECT 1 FROM public.tasks WHERE id = v_task_id) THEN
            RETURN v_task_id;
        END IF;
    END IF;

    INSERT INTO public.tasks
        SELECT (jsonb_populate_record(NULL::public.tasks, v_task)).*;

    INSERT INTO public.task_assignments
        SELECT (jsonb_populate_record(NULL::public.task_assignments, a)).*
        FROM jsonb_array_elements(v_archive.snapshot->'assignments') AS a;

    INSERT INTO public.task_comments
        SELECT (jsonb_populate_record(NULL::public.task_comments, c)).*
        FROM jsonb_array_elements(v_archive.snapshot->'comments') AS c;

    INSERT INTO public.task_attachments
        SELECT (jsonb_populate_record(NULL::public.task_attachments, at)).*
        FROM jsonb_array_elements(v_archive.snapshot->'attachments') AS at;

    INSERT INTO public.pipeline_stage_history
        SELECT (jsonb_populate_record(NULL::public.pipeline_stage_history, h)).*
        FROM jsonb_array_elements(v_archive.snapshot->'history') AS h;

    INSERT INTO public.task_work_sessions
        SELECT (jsonb_populate_record(NULL::public.task_work_sessions, ws)).*
        FROM jsonb_array_elements(v_archive.snapshot->'work_sessions') AS ws;

    -- #157. Sessions first: manual entries carry session_id.
    INSERT INTO public.task_manual_time_entries
        SELECT (jsonb_populate_record(NULL::public.task_manual_time_entries, mt)).*
        FROM jsonb_array_elements(
            COALESCE(v_archive.snapshot->'manual_time_entries', '[]'::jsonb)) AS mt;

    FOR v_sub IN SELECT * FROM jsonb_array_elements(v_archive.snapshot->'submissions') LOOP
        INSERT INTO public.task_submissions
            SELECT (jsonb_populate_record(NULL::public.task_submissions, v_sub->'submission')).*;
        INSERT INTO public.submission_attachments
            SELECT (jsonb_populate_record(NULL::public.submission_attachments, sa)).*
            FROM jsonb_array_elements(v_sub->'attachments') AS sa;
    END LOOP;

    UPDATE public.archives
    SET restored_at = now(), restored_by = auth.uid()
    WHERE id = p_archive_id;

    PERFORM public.log_event(
        v_archive.company_id, auth.uid(), 'task', v_task_id, 'task.restored', v_archive.metadata
    );

    -- #159: bring the children back with the parent.
    FOR v_kin IN
        SELECT id FROM public.archives
        WHERE entity_type = 'task'
          AND company_id = v_archive.company_id
          AND restored_at IS NULL
          AND (snapshot->'task'->>'parent_task_id')::UUID = v_task_id
    LOOP
        PERFORM public._internal_restore_task_archive(v_kin);
    END LOOP;

    RETURN v_task_id;
END;
$$;


ALTER FUNCTION "public"."_internal_restore_task_archive"("p_archive_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_is_platform_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE email = (auth.jwt() ->> 'email')
  )
$$;


ALTER FUNCTION "public"."_is_platform_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_rate_limit"("p_action" "text", "p_max" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid        := auth.uid();
  v_window  timestamptz := date_trunc('minute', now());
  v_count   int;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.rate_limit_buckets (user_id, action, window_start, count)
  VALUES (v_user_id, p_action, v_window, 1)
  ON CONFLICT (user_id, action, window_start)
  DO UPDATE SET count = rate_limit_buckets.count + 1
  RETURNING count INTO v_count;

  IF v_count > p_max THEN
    RAISE EXCEPTION 'Too many requests. Please wait a moment and try again.';
  END IF;
END;
$$;


ALTER FUNCTION "public"."_rate_limit"("p_action" "text", "p_max" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_rate_limit_pipeline_create"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM public._rate_limit('create_pipeline', 10);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_rate_limit_pipeline_create"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_recursive_child_tasks"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Delete children when parent is deleted
  DELETE FROM public.tasks 
  WHERE parent_task_id = OLD.id;
  
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."cleanup_recursive_child_tasks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."file_mime_class"("p_mime" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  SELECT CASE
    WHEN p_mime IS NULL THEN 'other'
    WHEN p_mime LIKE 'image/%' THEN 'image'
    WHEN p_mime LIKE 'video/%' THEN 'video'
    WHEN p_mime LIKE 'audio/%' THEN 'audio'
    WHEN p_mime = 'application/pdf' THEN 'pdf'
    WHEN p_mime LIKE '%wordprocessing%' OR p_mime LIKE '%msword%'
      OR p_mime = 'text/plain' OR p_mime LIKE 'text/%' THEN 'doc'
    WHEN p_mime LIKE '%spreadsheet%' OR p_mime LIKE '%excel%'
      OR p_mime = 'text/csv' THEN 'sheet'
    WHEN p_mime LIKE '%zip%' OR p_mime LIKE '%compressed%'
      OR p_mime LIKE '%tar%' OR p_mime LIKE '%rar%' OR p_mime LIKE '%7z%' THEN 'archive'
    ELSE 'other'
  END;
$$;


ALTER FUNCTION "public"."file_mime_class"("p_mime" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."filehub_dedupe_name"("p_name" "text", "p_visibility" "text", "p_group_id" "uuid", "p_folder_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_base       TEXT;
    v_ext        TEXT;
    v_dot        INT;
    v_candidate  TEXT;
    v_n          INT := 0;
    v_clash      BOOLEAN;
BEGIN
    v_dot := length(p_name) - position('.' IN reverse(p_name)) + 1;
    IF position('.' IN reverse(p_name)) > 0 AND v_dot > 1 THEN
        v_base := left(p_name, v_dot - 1);
        v_ext  := substring(p_name FROM v_dot);
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
              )
        ) INTO v_clash;

        EXIT WHEN NOT v_clash;

        v_n := v_n + 1;
        v_candidate := v_base || ' (' || v_n || ')' || v_ext;
    END LOOP;

    RETURN v_candidate;
END;
$$;


ALTER FUNCTION "public"."filehub_dedupe_name"("p_name" "text", "p_visibility" "text", "p_group_id" "uuid", "p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."filehub_file_accessible"("p_file_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."filehub_file_accessible"("p_file_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."filehub_files_search_tsv_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.search_tsv :=
      setweight(to_tsvector('english', coalesce(NEW.original_name,'')),                'A')
   || setweight(to_tsvector('english', coalesce(NEW.caption,'')),                      'B')
   || setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags,' '),'')),    'C');
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."filehub_files_search_tsv_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."filehub_link_task_file"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_bucket   text;
  v_task_id  uuid;
  v_uploader uuid;
  v_existing uuid;
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

  -- Reuse an existing pointer for the same object (kept-attachment pointer-copy
  -- in rpc_edit_submission, or an idempotent re-run) instead of duplicating.
  SELECT id INTO v_existing
  FROM public.filehub_files
  WHERE company_id = NEW.company_id AND bucket = v_bucket
    AND storage_path = NEW.storage_path AND visibility = 'task'
  LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO public.filehub_files (
      company_id, uploaded_by, storage_path, bucket, original_name,
      mime_type, size_bytes, visibility, task_id, created_at
    ) VALUES (
      NEW.company_id, v_uploader, NEW.storage_path, v_bucket, NEW.file_name,
      NEW.mime_type, COALESCE(NEW.file_size, 0), 'task', v_task_id, COALESCE(NEW.created_at, now())
    ) RETURNING id INTO v_existing;
  END IF;

  NEW.filehub_file_id := v_existing;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."filehub_link_task_file"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."filehub_sync_submission_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.filehub_files ff SET deleted_at = NEW.deleted_at
    FROM public.submission_attachments a
    WHERE a.submission_id = NEW.id AND a.filehub_file_id = ff.id AND ff.deleted_at IS NULL;
    RETURN NEW;
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    UPDATE public.filehub_files ff SET deleted_at = NULL
    FROM public.submission_attachments a
    WHERE a.submission_id = NEW.id AND a.filehub_file_id = ff.id
      AND a.version_id IS NOT DISTINCT FROM NEW.current_version_id;
    RETURN NEW;
  END IF;

  IF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id AND NEW.deleted_at IS NULL THEN
    UPDATE public.filehub_files ff SET deleted_at = now()
    FROM public.submission_attachments a
    WHERE a.submission_id = NEW.id AND a.filehub_file_id = ff.id
      AND a.version_id IS DISTINCT FROM NEW.current_version_id AND ff.deleted_at IS NULL;

    UPDATE public.filehub_files ff SET deleted_at = NULL
    FROM public.submission_attachments a
    WHERE a.submission_id = NEW.id AND a.filehub_file_id = ff.id
      AND a.version_id IS NOT DISTINCT FROM NEW.current_version_id AND ff.deleted_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."filehub_sync_submission_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."filehub_sync_task_attachment_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.filehub_file_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.filehub_files
       SET deleted_at = NEW.deleted_at
     WHERE id = NEW.filehub_file_id AND deleted_at IS NULL;
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    UPDATE public.filehub_files
       SET deleted_at = NULL
     WHERE id = NEW.filehub_file_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."filehub_sync_task_attachment_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_auto_create_notification_preferences"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_auto_create_notification_preferences"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_auto_stop_timers_on_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.current_stage_id IS DISTINCT FROM NEW.current_stage_id THEN
    -- This is a trigger on the tasks table. 
    -- It can't easily calculate business hours here without knowing which user to stop for.
    -- Better: we stop ANY active timers for this task.
    UPDATE public.task_work_sessions
    SET 
      completed_at = NOW(),
      status = 'completed',
      total_seconds_spent = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
    WHERE task_id = NEW.id AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_auto_stop_timers_on_transition"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_backfill_session_duration"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.total_seconds_spent := GREATEST(
        1,
        EXTRACT(EPOCH FROM (
            COALESCE(NEW.completed_at, NEW.last_heartbeat_at, now()) - NEW.started_at
        ))::int
    );
    IF NEW.completed_at IS NULL THEN
        NEW.completed_at := COALESCE(NEW.last_heartbeat_at, now());
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_backfill_session_duration"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_calculate_business_duration"("p_start" timestamp with time zone, "p_end" timestamp with time zone) RETURNS interval
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_total_sec BIGINT := 0;
    v_current   TIMESTAMPTZ;
    v_day_start TIMESTAMPTZ;
    v_day_end   TIMESTAMPTZ;
    v_work_start TIME := '09:00:00';
    v_work_end   TIME := '17:00:00';
BEGIN
    IF p_start IS NULL OR p_end IS NULL OR p_start >= p_end THEN
        RETURN '0 seconds'::INTERVAL;
    END IF;

    v_current := p_start;

    -- Iterate through days
    WHILE v_current < p_end LOOP
        -- Check if current day is Sun (0) to Thu (4)
        -- In Postgres EXTRACT(DOW) is 0 (Sun) to 6 (Sat)
        IF EXTRACT(DOW FROM v_current) <= 4 THEN
            -- Define work boundaries for this day
            v_day_start := date_trunc('day', v_current) + v_work_start;
            v_day_end   := date_trunc('day', v_current) + v_work_end;

            -- Calculate effective overlap
            -- Intersection of [v_current, p_end] and [v_day_start, v_day_end]
            DECLARE
                v_eff_start TIMESTAMPTZ := GREATEST(v_current, v_day_start);
                v_eff_end   TIMESTAMPTZ := LEAST(p_end, v_day_end);
            BEGIN
                IF v_eff_start < v_eff_end THEN
                    v_total_sec := v_total_sec + EXTRACT(EPOCH FROM (v_eff_end - v_eff_start));
                END IF;
            END;
        END IF;

        -- Jump to next day 09:00
        v_current := date_trunc('day', v_current + interval '1 day') + v_work_start;
    END LOOP;

    RETURN (v_total_sec || ' seconds')::INTERVAL;
END;
$$;


ALTER FUNCTION "public"."fn_calculate_business_duration"("p_start" timestamp with time zone, "p_end" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_check_all_reporting_cycles"("p_user_id" "uuid", "p_new_reports_to" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_current_id UUID := p_new_reports_to;
    v_depth      INT := 0;
BEGIN
    WHILE v_current_id IS NOT NULL AND v_depth < 50 LOOP
        IF v_current_id = p_user_id THEN
            RETURN TRUE; -- Cycle found
        END IF;
        
        SELECT reports_to INTO v_current_id 
        FROM public.users 
        WHERE id = v_current_id;
        
        v_depth := v_depth + 1;
    END LOOP;
    
    RETURN FALSE; -- No cycle
END;
$$;


ALTER FUNCTION "public"."fn_check_all_reporting_cycles"("p_user_id" "uuid", "p_new_reports_to" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_check_overdue_tasks"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_task RECORD;
BEGIN
  -- task.due_soon: due in the next 24 hours, not yet completed
  FOR v_task IN
    SELECT t.id, t.pipeline_id, t.due_date,
           ta.assignee_user_id
    FROM   public.tasks t
    LEFT JOIN LATERAL (
      SELECT assignee_user_id
      FROM   public.task_assignments
      WHERE  task_id = t.id
        AND  assignee_user_id IS NOT NULL
      LIMIT 1
    ) ta ON TRUE
    WHERE  t.deleted_at IS NULL
      AND  t.status NOT IN ('completed', 'cancelled')
      AND  t.due_date BETWEEN now() AND now() + INTERVAL '24 hours'
      -- Not already emitted today
      AND  NOT EXISTS (
        SELECT 1 FROM public.notification_events ne
        WHERE  ne.event_type = 'task.due_soon'
          AND  ne.entity_id  = t.id
          AND  ne.created_at >= CURRENT_DATE::TIMESTAMPTZ
      )
  LOOP
    PERFORM public.fn_emit_notification_event(
      'task.due_soon',
      'task',
      v_task.id,
      NULL,
      jsonb_build_object(
        'task_id',     v_task.id,
        'pipeline_id', v_task.pipeline_id,
        'assignee_id', v_task.assignee_user_id,
        'due_at',      v_task.due_date
      )
    );
  END LOOP;

  -- task.overdue: past due, not completed, not already emitted today
  FOR v_task IN
    SELECT t.id, t.pipeline_id, t.due_date,
           ta.assignee_user_id
    FROM   public.tasks t
    LEFT JOIN LATERAL (
      SELECT assignee_user_id
      FROM   public.task_assignments
      WHERE  task_id = t.id
        AND  assignee_user_id IS NOT NULL
      LIMIT 1
    ) ta ON TRUE
    WHERE  t.deleted_at IS NULL
      AND  t.status NOT IN ('completed', 'cancelled')
      AND  t.due_date < now()
      AND  t.due_date > now() - INTERVAL '30 days'
      AND  NOT EXISTS (
        SELECT 1 FROM public.notification_events ne
        WHERE  ne.event_type = 'task.overdue'
          AND  ne.entity_id  = t.id
          AND  ne.created_at >= CURRENT_DATE::TIMESTAMPTZ
      )
  LOOP
    PERFORM public.fn_emit_notification_event(
      'task.overdue',
      'task',
      v_task.id,
      NULL,
      jsonb_build_object(
        'task_id',     v_task.id,
        'pipeline_id', v_task.pipeline_id,
        'assignee_id', v_task.assignee_user_id,
        'due_at',      v_task.due_date
      )
    );
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."fn_check_overdue_tasks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_emit_notification_event"("p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_actor_id" "uuid", "p_payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.notification_events
    (event_type, entity_type, entity_id, actor_id, payload)
  VALUES
    (p_event_type, p_entity_type, p_entity_id, p_actor_id, p_payload);
END;
$$;


ALTER FUNCTION "public"."fn_emit_notification_event"("p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_actor_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_flush_all_pipeline_snapshots"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_pipeline RECORD;
  v_today    date := CURRENT_DATE;
BEGIN
  FOR v_pipeline IN
    SELECT DISTINCT pipeline_id
    FROM public.pipeline_stage_history
    WHERE transitioned_at >= now() - interval '7 days'
  LOOP
    PERFORM public.rpc_flush_pipeline_snapshot(
      v_pipeline.pipeline_id, 'week',  date_trunc('week',  v_today)::date);
    PERFORM public.rpc_flush_pipeline_snapshot(
      v_pipeline.pipeline_id, 'month', date_trunc('month', v_today)::date);
    PERFORM public.rpc_flush_pipeline_snapshot(
      v_pipeline.pipeline_id, 'year',  date_trunc('year',  v_today)::date);
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."fn_flush_all_pipeline_snapshots"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_flush_all_user_snapshots"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user RECORD;
  v_today date := CURRENT_DATE;
BEGIN
  FOR v_user IN
    SELECT DISTINCT u.id
    FROM public.users u
    JOIN public.team_members tm ON tm.user_id = u.id
    WHERE u.id IN (
      -- Users with recent work sessions or task completions (active in last 7 days)
      SELECT DISTINCT user_id FROM public.task_work_sessions
      WHERE started_at >= now() - interval '7 days'
      UNION
      SELECT DISTINCT ta.assignee_user_id FROM public.task_assignments ta
      JOIN public.tasks t ON t.id = ta.task_id
      WHERE t.completed_at >= now() - interval '7 days'
    )
  LOOP
    -- Flush current partial periods for each granularity
    PERFORM public.rpc_flush_user_snapshot(
      v_user.id, 'week',  date_trunc('week',  v_today)::date);
    PERFORM public.rpc_flush_user_snapshot(
      v_user.id, 'month', date_trunc('month', v_today)::date);
    PERFORM public.rpc_flush_user_snapshot(
      v_user.id, 'year',  date_trunc('year',  v_today)::date);
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."fn_flush_all_user_snapshots"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_generate_join_code"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_code TEXT;
  v_exists BOOLEAN;
BEGIN
  LOOP
    -- Generate a 6-digit random code
    v_code := upper(substring(md5(random()::text) from 1 for 6));
    -- Check uniqueness
    SELECT EXISTS (SELECT 1 FROM public.companies WHERE join_code = v_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_code;
END;
$$;


ALTER FUNCTION "public"."fn_generate_join_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_handle_task_handshake"("p_child_task_id" "uuid", "p_terminal_stage_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_parent_task_id UUID;
  v_parent_stage_id UUID;
  v_target_stage_id UUID;
  v_company_id UUID;
BEGIN
  -- Get context
  SELECT parent_task_id, company_id INTO v_parent_task_id, v_company_id
  FROM public.tasks
  WHERE id = p_child_task_id;

  IF v_parent_task_id IS NULL THEN
    RETURN; -- Not a sub-task
  END IF;

  -- Find the current stage of the parent
  SELECT current_stage_id INTO v_parent_stage_id
  FROM public.tasks
  WHERE id = v_parent_task_id;

  -- Find if there is a linked outcome for this terminal stage
  SELECT parent_target_stage_id INTO v_target_stage_id
  FROM public.pipeline_linked_outcomes
  WHERE parent_stage_id = v_parent_stage_id
    AND child_terminal_stage_id = p_terminal_stage_id
    AND company_id = v_company_id;

  -- If a match is found, advance the parent stage
  IF v_target_stage_id IS NOT NULL THEN
    PERFORM public.rpc_advance_stage(v_parent_task_id, v_target_stage_id);
  END IF;
END;
$$;


ALTER FUNCTION "public"."fn_handle_task_handshake"("p_child_task_id" "uuid", "p_terminal_stage_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_has_permission"("p_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.user_roles ur
    JOIN   public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN   public.permissions p       ON p.id = rp.permission_id
    WHERE  ur.user_id    = auth.uid()
      AND  ur.revoked_at IS NULL
      AND  p.key         = p_key

    UNION ALL

    SELECT 1
    FROM   public.team_members tm
    JOIN   public.team_roles tr        ON tr.team_id = tm.team_id
    JOIN   public.role_permissions rp  ON rp.role_id = tr.role_id
    JOIN   public.permissions p        ON p.id = rp.permission_id
    WHERE  tm.user_id    = auth.uid()
      AND  tm.removed_at IS NULL
      AND  p.key         = p_key
  );
$$;


ALTER FUNCTION "public"."fn_has_permission"("p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_invoke_filehub_orphan_sweep"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/filehub-orphan-sweep';
  v_secret TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'filehub_orphan_sweep_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  PERFORM net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_secret, '')
    ),
    timeout_milliseconds := 30000
  );
END;
$$;


ALTER FUNCTION "public"."fn_invoke_filehub_orphan_sweep"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_invoke_purge_filehub_bin"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/purge-filehub-bin';
  v_secret TEXT := '';
BEGIN
  DELETE FROM public.filehub_folders
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - interval '15 days';

  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'purge_filehub_bin_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  PERFORM net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_secret, '')
    ),
    timeout_milliseconds := 30000
  );
END;
$$;


ALTER FUNCTION "public"."fn_invoke_purge_filehub_bin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_invoke_purge_filehub_versions"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/purge-filehub-versions';
  v_secret TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'purge_filehub_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  PERFORM net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_secret, '')
    ),
    timeout_milliseconds := 30000
  );
END;
$$;


ALTER FUNCTION "public"."fn_invoke_purge_filehub_versions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_pick_assignee"("p_pipeline_id" "uuid", "p_exclude_task_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("pool_id" "uuid", "user_id" "uuid", "team_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_assignment_mode TEXT;
  v_pool_type       TEXT;
  v_margin          CONSTANT NUMERIC := 1.15;
BEGIN
  SELECT p.assignment_mode, p.assignment_pool_type
  INTO v_assignment_mode, v_pool_type
  FROM public.pipelines p
  WHERE p.id = p_pipeline_id;

  IF v_assignment_mode IS NULL OR v_assignment_mode = 'manual' THEN
    RETURN;
  END IF;

  IF v_assignment_mode = 'round_robin' THEN
    RETURN QUERY
    WITH pool AS (
      SELECT pap.id AS pool_id, pap.member_user_id, pap.member_team_id, pap.last_assigned_at
      FROM public.pipeline_assignment_pool pap
      LEFT JOIN public.users u  ON u.id  = pap.member_user_id
      LEFT JOIN public.teams tm ON tm.id = pap.member_team_id
      WHERE pap.pipeline_id = p_pipeline_id
        AND pap.is_withdrawn = false
        AND ((v_pool_type = 'users' AND pap.member_user_id IS NOT NULL AND u.deleted_at IS NULL)
          OR (v_pool_type = 'teams' AND pap.member_team_id IS NOT NULL AND tm.deleted_at IS NULL))
    )
    SELECT pool.pool_id, pool.member_user_id, pool.member_team_id
    FROM pool
    ORDER BY last_assigned_at ASC NULLS FIRST,
             member_user_id ASC NULLS LAST, member_team_id ASC NULLS LAST
    LIMIT 1;
    RETURN;
  END IF;

  RETURN QUERY
  WITH pool AS (
    SELECT pap.id AS pool_id, pap.member_user_id, pap.member_team_id, pap.last_assigned_at
    FROM public.pipeline_assignment_pool pap
    LEFT JOIN public.users u  ON u.id  = pap.member_user_id
    LEFT JOIN public.teams tm ON tm.id = pap.member_team_id
    WHERE pap.pipeline_id = p_pipeline_id
      AND pap.is_withdrawn = false
      AND ((v_pool_type = 'users' AND pap.member_user_id IS NOT NULL AND u.deleted_at IS NULL)
        OR (v_pool_type = 'teams' AND pap.member_team_id IS NOT NULL AND tm.deleted_at IS NULL))
  ),
  points AS (
    SELECT pool.pool_id,
      COALESCE(SUM(CASE WHEN ps2.id IS NOT NULL THEN t2.weight ELSE 0 END), 0) AS weight_points
    FROM pool
    LEFT JOIN public.task_assignments ta2
      ON (pool.member_user_id IS NOT NULL AND ta2.assignee_user_id = pool.member_user_id)
      OR (pool.member_team_id IS NOT NULL AND ta2.assignee_team_id = pool.member_team_id)
    LEFT JOIN public.tasks t2
      ON t2.id = ta2.task_id AND t2.completed_at >= now() - interval '30 days'
    LEFT JOIN public.pipeline_stages ps2
      ON ps2.id = t2.current_stage_id AND ps2.terminal_type = 'success'
    GROUP BY pool.pool_id
  ),
  hours AS (
    SELECT pool.pool_id,
      COALESCE(SUM(ws.total_seconds_spent), 0) / 3600.0 AS active_hours
    FROM pool
    LEFT JOIN public.task_work_sessions ws
      ON ws.status = 'completed'
      AND ws.started_at >= now() - interval '30 days'
      AND (
        (pool.member_user_id IS NOT NULL AND ws.user_id = pool.member_user_id)
        OR (pool.member_team_id IS NOT NULL AND ws.user_id IN (
              SELECT tm2.user_id FROM public.team_members tm2
              WHERE tm2.team_id = pool.member_team_id AND tm2.removed_at IS NULL))
      )
    GROUP BY pool.pool_id
  ),
  scored AS (
    SELECT pool.pool_id, pool.member_user_id, pool.member_team_id, pool.last_assigned_at,
      COALESCE(points.weight_points, 0) AS weight_points,
      CASE WHEN COALESCE(hours.active_hours, 0) > 0
           THEN COALESCE(points.weight_points, 0) / hours.active_hours
           ELSE NULL END AS productivity
    FROM pool
    LEFT JOIN points ON points.pool_id = pool.pool_id
    LEFT JOIN hours  ON hours.pool_id  = pool.pool_id
  ),
  pool_avgs AS (
    SELECT AVG(weight_points) AS avg_points, AVG(productivity) AS avg_prod FROM scored
  )
  SELECT s.pool_id, s.member_user_id, s.member_team_id
  FROM scored s, pool_avgs a
  WHERE s.weight_points < a.avg_points
    AND s.productivity IS NOT NULL
    AND s.productivity >= a.avg_prod * v_margin
  ORDER BY s.productivity DESC, s.weight_points ASC, s.last_assigned_at ASC NULLS FIRST,
           s.member_user_id ASC NULLS LAST, s.member_team_id ASC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH pool AS (
    SELECT pap.id AS pool_id, pap.member_user_id, pap.member_team_id, pap.last_assigned_at
    FROM public.pipeline_assignment_pool pap
    LEFT JOIN public.users u  ON u.id  = pap.member_user_id
    LEFT JOIN public.teams tm ON tm.id = pap.member_team_id
    WHERE pap.pipeline_id = p_pipeline_id
      AND pap.is_withdrawn = false
      AND ((v_pool_type = 'users' AND pap.member_user_id IS NOT NULL AND u.deleted_at IS NULL)
        OR (v_pool_type = 'teams' AND pap.member_team_id IS NOT NULL AND tm.deleted_at IS NULL))
  ),
  active_counts AS (
    SELECT pool.pool_id, pool.member_user_id, pool.member_team_id, pool.last_assigned_at,
      COUNT(s3.id) AS active_count
    FROM pool
    LEFT JOIN public.task_assignments ta3
      ON (pool.member_user_id IS NOT NULL AND ta3.assignee_user_id = pool.member_user_id)
      OR (pool.member_team_id IS NOT NULL AND ta3.assignee_team_id = pool.member_team_id)
    LEFT JOIN public.tasks ts
      ON ts.id = ta3.task_id AND ts.pipeline_id = p_pipeline_id
      AND ts.deleted_at IS NULL AND (p_exclude_task_id IS NULL OR ts.id != p_exclude_task_id)
    LEFT JOIN public.pipeline_stages s3
      ON s3.id = ts.current_stage_id AND s3.is_terminal = false
    GROUP BY pool.pool_id, pool.member_user_id, pool.member_team_id, pool.last_assigned_at
  )
  SELECT active_counts.pool_id, active_counts.member_user_id, active_counts.member_team_id
  FROM active_counts
  ORDER BY active_count ASC, last_assigned_at ASC NULLS FIRST,
           member_user_id ASC NULLS LAST, member_team_id ASC NULLS LAST
  LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."fn_pick_assignee"("p_pipeline_id" "uuid", "p_exclude_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_resolve_effective_manager"("p_user_id" "uuid", "p_current_depth" integer DEFAULT 0, "p_max_depth" integer DEFAULT 3) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_reports_to   UUID;
  v_status       TEXT;
  v_actor_id     UUID := auth.uid();
BEGIN
  -- 1: Max Depth Protection
  IF p_current_depth >= p_max_depth THEN
    RETURN p_user_id; 
  END IF;

  -- 2: Fetch Current State
  SELECT reports_to, work_status INTO v_reports_to, v_status FROM public.users WHERE id = p_user_id;
  
  -- 3: Neutrality Check + Availability
  -- If land on current actor (self-review) AND they are not at the very top, climb higher.
  IF (p_user_id = v_actor_id OR v_status != 'available') AND v_reports_to IS NOT NULL THEN
    RETURN public.fn_resolve_effective_manager(v_reports_to, p_current_depth + 1, p_max_depth);
  END IF;

  -- 4: Return resolved manager
  RETURN p_user_id;
END;
$$;


ALTER FUNCTION "public"."fn_resolve_effective_manager"("p_user_id" "uuid", "p_current_depth" integer, "p_max_depth" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_simulate_report_processing"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- This simulate the "Background Processing" start
    UPDATE public.reporting_jobs
    SET status = 'processing',
        updated_at = NOW()
    WHERE id = NEW.id;

    -- In a real scenario, an Edge Function would do this.
    -- For this demo, we auto-complete with a mock PDF link.
    UPDATE public.reporting_jobs
    SET status = 'completed',
        file_url = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = NEW.id;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_simulate_report_processing"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sweep_pending_notification_events"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_event  RECORD;
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/process-notification-event';
  v_secret TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'process_notification_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  FOR v_event IN
    SELECT *
    FROM   public.notification_events
    WHERE  processed_at IS NULL
      AND  created_at < now() - INTERVAL '30 seconds'
    ORDER BY created_at
    LIMIT 50
  LOOP
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'type',       'INSERT',
                   'table',      'notification_events',
                   'schema',     'public',
                   'record',     row_to_json(v_event)::JSONB,
                   'old_record', NULL
                 ),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || COALESCE(v_secret, '')
      ),
      timeout_milliseconds := 5000
    );
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."fn_sweep_pending_notification_events"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sweep_stale_work_sessions"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_closed RECORD;
BEGIN
    FOR v_closed IN
        UPDATE public.task_work_sessions tws
        SET status = 'completed',
            completed_at = tws.last_heartbeat_at,
            total_seconds_spent = GREATEST(
                1,
                EXTRACT(EPOCH FROM (
                    CASE WHEN COALESCE(ps.use_business_hours, false)
                         THEN public.fn_calculate_business_duration(tws.started_at, tws.last_heartbeat_at)
                         ELSE tws.last_heartbeat_at - tws.started_at
                    END
                ))::int
            ),
            notes = CASE
                        WHEN tws.notes LIKE '%[auto-closed: stale]%' THEN tws.notes
                        ELSE COALESCE(tws.notes, '') || ' [auto-closed: stale]'
                    END
        FROM public.tasks t
        LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
        WHERE t.id = tws.task_id
          AND tws.status = 'active'
          AND (
            tws.last_heartbeat_at < now() - interval '8 hours'
            OR tws.started_at < now() - interval '6 hours'
          )
        RETURNING tws.user_id, tws.task_id, t.title AS task_title, tws.total_seconds_spent
    LOOP
        PERFORM public.rpc_notify_timer_auto_stopped(
            v_closed.task_id,
            v_closed.task_title,
            v_closed.total_seconds_spent,
            v_closed.user_id
        );
    END LOOP;
END;
$$;


ALTER FUNCTION "public"."fn_sweep_stale_work_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_task_file_accessible"("p_task_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_company   uuid := public.my_company_id();
  v_task      record;
  v_cfg       jsonb;
  v_preset    text;
  v_assignees boolean;
  v_reviewers boolean;
BEGIN
  SELECT t.id, t.created_by, t.manager_id, t.pipeline_id, t.category
    INTO v_task
  FROM public.tasks t
  WHERE t.id = p_task_id
    AND t.deleted_at IS NULL
    AND t.company_id = v_company;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Floor: owner / creator / manager, plus the bypass permission, always.
  IF COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = v_uid), false)
     OR v_task.created_by = v_uid
     OR v_task.manager_id = v_uid
     OR public.has_permission('filehub:view_all_files') THEN
    RETURN true;
  END IF;

  -- Pipeline policy, with an optional per-category override.
  SELECT p.file_visibility INTO v_cfg FROM public.pipelines p WHERE p.id = v_task.pipeline_id;
  v_cfg := COALESCE(v_cfg, '{"preset":"task_members"}'::jsonb);
  IF v_task.category IS NOT NULL
     AND jsonb_typeof(v_cfg -> 'categories') = 'object'
     AND (v_cfg -> 'categories') ? v_task.category THEN
    v_cfg := v_cfg -> 'categories' -> v_task.category;
  END IF;

  -- Expand preset → effective flags.
  v_preset := COALESCE(v_cfg ->> 'preset', 'custom');
  IF v_preset = 'company' THEN
    RETURN true;  -- any company member (task already confirmed same-company above)
  ELSIF v_preset = 'task_members' THEN
    v_assignees := true;  v_reviewers := true;
  ELSIF v_preset = 'submitters_reviewers' THEN
    v_assignees := false; v_reviewers := true;
  ELSE  -- custom
    v_assignees := COALESCE((v_cfg ->> 'assignees')::boolean, false);
    v_reviewers := COALESCE((v_cfg ->> 'reviewers')::boolean, false);
  END IF;

  -- Task assignees (direct user or via team).
  IF v_assignees AND EXISTS (
    SELECT 1 FROM public.task_assignments ta
    WHERE ta.task_id = v_task.id
      AND ( ta.assignee_user_id = v_uid
            OR ta.assignee_team_id IN (
              SELECT tm.team_id FROM public.team_members tm
              WHERE tm.user_id = v_uid AND tm.removed_at IS NULL
            ) )
  ) THEN
    RETURN true;
  END IF;

  -- Submission reviewers.
  IF v_reviewers AND public.has_permission('submission.review') THEN
    RETURN true;
  END IF;

  -- Explicit people.
  IF jsonb_typeof(v_cfg -> 'users') = 'array' AND (v_cfg -> 'users') ? v_uid::text THEN
    RETURN true;
  END IF;

  -- Roles (direct or team-inherited), mirroring has_permission's role sourcing.
  IF jsonb_typeof(v_cfg -> 'roles') = 'array' THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = v_uid AND ur.revoked_at IS NULL
        AND (v_cfg -> 'roles') ? ur.role_id::text
    ) OR EXISTS (
      SELECT 1 FROM public.team_members tm
      JOIN public.team_roles tr ON tr.team_id = tm.team_id
      WHERE tm.user_id = v_uid AND tm.removed_at IS NULL
        AND (v_cfg -> 'roles') ? tr.role_id::text
    ) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;


ALTER FUNCTION "public"."fn_task_file_accessible"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_tr_validate_reporting_line"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF NEW.reports_to IS NOT NULL AND public.fn_check_all_reporting_cycles(NEW.id, NEW.reports_to) THEN
        RAISE EXCEPTION 'Circular reporting detected. A user cannot report to their own subordinate.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_tr_validate_reporting_line"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_trg_dispatch_notification_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_url     TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/process-notification-event';
  v_payload JSONB;
  v_secret  TEXT := '';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'process_notification_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  v_payload := jsonb_build_object(
    'type',       'INSERT',
    'table',      'notification_events',
    'schema',     'public',
    'record',     row_to_json(NEW)::JSONB,
    'old_record', NULL
  );

  PERFORM net.http_post(
    url     := v_url,
    body    := v_payload,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_secret, '')
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_trg_dispatch_notification_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_trg_task_assignments_notify"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_pipeline_id UUID;
BEGIN
  IF NEW.assignee_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pipeline_id INTO v_pipeline_id
  FROM   public.tasks
  WHERE  id = NEW.task_id;

  PERFORM public.fn_emit_notification_event(
    'task.assigned',
    'task',
    NEW.task_id,
    NEW.assigned_by,
    jsonb_build_object(
      'task_id',     NEW.task_id,
      'pipeline_id', v_pipeline_id,
      'assignee_id', NEW.assignee_user_id,
      'assigned_by', NEW.assigned_by
    )
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_trg_task_assignments_notify"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_trg_task_comments_notify"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_mention           TEXT;
  v_mentioned_user_id UUID;
BEGIN
  -- Skip system-generated comments
  IF NEW.is_system THEN
    RETURN NEW;
  END IF;

  -- task.commented
  PERFORM public.fn_emit_notification_event(
    'task.commented',
    'task',
    NEW.task_id,
    NEW.author_id,
    jsonb_build_object(
      'task_id',      NEW.task_id,
      'comment_id',   NEW.id,
      'commented_by', NEW.author_id
    )
  );

  -- task.mentioned — one event per @mentioned user found in content
  FOR v_mention IN
    SELECT DISTINCT m[1]
    FROM   regexp_matches(NEW.content, '@([A-Za-z0-9_.]+)', 'g') AS m
  LOOP
    -- Match by display_name (spaces collapsed or underscored)
    SELECT id INTO v_mentioned_user_id
    FROM   public.users
    WHERE  LOWER(REPLACE(COALESCE(display_name, full_name, ''), ' ', '_')) = LOWER(v_mention)
       OR  LOWER(REPLACE(COALESCE(display_name, full_name, ''), ' ', ''))  = LOWER(v_mention)
    LIMIT 1;

    IF FOUND THEN
      PERFORM public.fn_emit_notification_event(
        'task.mentioned',
        'task',
        NEW.task_id,
        NEW.author_id,
        jsonb_build_object(
          'task_id',           NEW.task_id,
          'comment_id',        NEW.id,
          'mentioned_user_id', v_mentioned_user_id,
          'mentioned_by',      NEW.author_id
        )
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_trg_task_comments_notify"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_trg_tasks_notify_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM public.fn_emit_notification_event(
    'task.created',
    'task',
    NEW.id,
    NEW.created_by,
    jsonb_build_object(
      'task_id',    NEW.id,
      'pipeline_id', NEW.pipeline_id,
      'stage_id',   NEW.current_stage_id,
      'created_by', NEW.created_by
    )
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_trg_tasks_notify_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_trg_tasks_notify_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_stage_name TEXT;
  v_actor_id   UUID := auth.uid(); -- NULL for system/cron operations
BEGIN
  -- Stage transition
  IF OLD.current_stage_id IS DISTINCT FROM NEW.current_stage_id
     AND NEW.current_stage_id IS NOT NULL
  THEN
    SELECT name INTO v_stage_name
    FROM   public.pipeline_stages
    WHERE  id = NEW.current_stage_id;

    PERFORM public.fn_emit_notification_event(
      'task.stage_transition',
      'task',
      NEW.id,
      v_actor_id,
      jsonb_build_object(
        'task_id',       NEW.id,
        'pipeline_id',   NEW.pipeline_id,
        'from_stage_id', OLD.current_stage_id,
        'to_stage_id',   NEW.current_stage_id,
        'stage_tag',     LOWER(REPLACE(COALESCE(v_stage_name, ''), ' ', '_'))
      )
    );
  END IF;

  -- Status changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.fn_emit_notification_event(
      'task.status_changed',
      'task',
      NEW.id,
      v_actor_id,
      jsonb_build_object(
        'task_id',     NEW.id,
        'pipeline_id', NEW.pipeline_id,
        'from_status', OLD.status,
        'to_status',   NEW.status
      )
    );

    -- Completed
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
      PERFORM public.fn_emit_notification_event(
        'task.completed',
        'task',
        NEW.id,
        v_actor_id,
        jsonb_build_object(
          'task_id',      NEW.id,
          'pipeline_id',  NEW.pipeline_id,
          'completed_by', v_actor_id
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_trg_tasks_notify_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_update_archive_search_vector"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.metadata->>'title', '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.metadata->>'pipeline_name', '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.entity_type, '')), 'C');
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_update_archive_search_vector"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_user_has_permission"("p_user_id" "uuid", "p_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user_id AND ur.revoked_at IS NULL AND p.key = p_key
    UNION ALL
    SELECT 1 FROM public.team_members tm
    JOIN public.team_roles tr ON tr.team_id = tm.team_id
    JOIN public.role_permissions rp ON rp.role_id = tr.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE tm.user_id = p_user_id AND tm.removed_at IS NULL AND p.key = p_key
  );
$$;


ALTER FUNCTION "public"."fn_user_has_permission"("p_user_id" "uuid", "p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_permissions"() RETURNS TABLE("key" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- Role-based permissions
  SELECT DISTINCT p.key
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions p       ON p.id = rp.permission_id
  WHERE ur.user_id    = auth.uid()
    AND ur.revoked_at IS NULL

  UNION

  -- Team-inherited permissions
  SELECT DISTINCT p.key
  FROM public.team_members tm
  JOIN public.team_roles tr       ON tr.team_id = tm.team_id
  JOIN public.role_permissions rp ON rp.role_id = tr.role_id
  JOIN public.permissions p       ON p.id = rp.permission_id
  WHERE tm.user_id    = auth.uid()
    AND tm.removed_at IS NULL

  UNION

  -- Owner fallback: is_owner flag always grants the full Owner role permission set
  SELECT DISTINCT p.key
  FROM public.users u
  JOIN public.roles r              ON r.name = 'Owner' AND r.company_id IS NULL AND r.is_system = TRUE
  JOIN public.role_permissions rp  ON rp.role_id = r.id
  JOIN public.permissions p        ON p.id = rp.permission_id
  WHERE u.id       = auth.uid()
    AND u.is_owner = TRUE;
$$;


ALTER FUNCTION "public"."get_my_permissions"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_my_permissions"() IS 'Returns all active permission keys for the current user. Call once on login and cache.';



CREATE OR REPLACE FUNCTION "public"."get_my_roles"() RETURNS TABLE("id" "uuid", "name" "text", "color" "text", "is_system" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT r.id, r.name, r.color, r.is_system
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = auth.uid()
    AND ur.revoked_at IS NULL
    AND r.deleted_at IS NULL

  UNION

  SELECT DISTINCT r.id, r.name, r.color, r.is_system
  FROM public.team_members tm
  JOIN public.team_roles tr ON tr.team_id = tm.team_id
  JOIN public.roles r ON r.id = tr.role_id
  WHERE tm.user_id = auth.uid()
    AND tm.removed_at IS NULL
    AND r.deleted_at IS NULL;
$$;


ALTER FUNCTION "public"."get_my_roles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_server_time"() RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT NOW();
$$;


ALTER FUNCTION "public"."get_server_time"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_invite        public.invitations%ROWTYPE;
  v_company_id    UUID;
BEGIN
  SELECT * INTO v_invite
  FROM public.invitations
  WHERE email      = NEW.email
    AND status     = 'pending'
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_company_id := v_invite.company_id;
    INSERT INTO public.users (id, company_id, email, full_name, is_owner)
    VALUES (NEW.id, v_company_id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), FALSE);
    
    IF v_invite.role_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role_id, company_id, assigned_by)
      VALUES (NEW.id, v_invite.role_id, v_company_id, v_invite.invited_by);
    ELSE
      INSERT INTO public.user_roles (user_id, role_id, company_id, assigned_by)
      SELECT NEW.id, r.id, v_company_id, v_invite.invited_by
      FROM   public.roles r
      WHERE  (r.company_id = v_company_id OR r.company_id IS NULL)
        AND  r.is_default  = TRUE
        AND  r.deleted_at  IS NULL
      ORDER BY r.company_id NULLS LAST
      LIMIT 1;
    END IF;
    UPDATE public.invitations SET status = 'accepted', accepted_at = NOW() WHERE id = v_invite.id;
  ELSE
    INSERT INTO public.users (id, company_id, email, full_name, is_owner)
    VALUES (NEW.id, NULL, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), FALSE);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_new_user"() IS 'Auto-provisions company, user profile and role on new auth.users insert. Never blocks sign-up.';



CREATE OR REPLACE FUNCTION "public"."has_permission"("permission_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    -- Directly assigned roles
    SELECT 1
    FROM   public.user_roles ur
    JOIN   public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN   public.permissions p       ON p.id = rp.permission_id
    WHERE  ur.user_id    = auth.uid()
      AND  ur.revoked_at IS NULL
      AND  p.key         = permission_key
  )
  OR
  EXISTS (
    -- Roles inherited from teams
    SELECT 1
    FROM   public.team_members tm
    JOIN   public.team_roles tr    ON tr.team_id = tm.team_id
    JOIN   public.role_permissions rp ON rp.role_id = tr.role_id
    JOIN   public.permissions p       ON p.id = rp.permission_id
    WHERE  tm.user_id    = auth.uid()
      AND  tm.removed_at IS NULL
      AND  p.key         = permission_key
  )
  OR
  -- Owners always return TRUE for every permission
  EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND is_owner = TRUE
  );
$$;


ALTER FUNCTION "public"."has_permission"("permission_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_permission"("permission_key" "text") IS 'Returns TRUE if the current user has the given permission key, or is a company owner.';



CREATE OR REPLACE FUNCTION "public"."internal_stop_task_sessions"("p_task_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.task_work_sessions
  SET 
    status = 'completed',
    completed_at = NOW(),
    total_seconds_spent = CASE 
      WHEN status = 'active' THEN total_seconds_spent + (EXTRACT(EPOCH FROM (NOW() - started_at)))::INTEGER 
      ELSE total_seconds_spent 
    END
  WHERE task_id = p_task_id AND status IN ('active', 'paused');
END;
$$;


ALTER FUNCTION "public"."internal_stop_task_sessions"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_in_my_scope"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Global access for Owners/Supervisors
    IF (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE 
       OR public.has_permission('admin.access') THEN
        RETURN TRUE;
    END IF;

    -- Manage access: Is the target user in a team I manage?
    RETURN EXISTS (
        SELECT 1 FROM public.team_members tm
        JOIN public.teams t ON tm.team_id = t.id
        WHERE tm.user_id = p_user_id
          AND t.manager_id = auth.uid()
    );
END;
$$;


ALTER FUNCTION "public"."is_in_my_scope"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_event"("p_company_id" "uuid", "p_user_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_event_type" "text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.activity_events
    (company_id, user_id, entity_type, entity_id, event_type, metadata)
  VALUES
    (p_company_id, p_user_id, p_entity_type, p_entity_id, p_event_type, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."log_event"("p_company_id" "uuid", "p_user_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_event_type" "text", "p_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_event"("p_company_id" "uuid", "p_user_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_event_type" "text", "p_metadata" "jsonb") IS 'Safe wrapper for inserting activity events.';



CREATE OR REPLACE FUNCTION "public"."my_company_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."my_company_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."my_company_id"() IS 'Cached lookup for the current user''s company_id.';



CREATE OR REPLACE FUNCTION "public"."reporting_jobs_search_tsv_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.search_tsv :=
      setweight(to_tsvector('english', coalesce(replace(NEW.report_type,'_',' '),'')), 'A')
   || setweight(to_tsvector('english', coalesce(NEW.parameters::text,'')),             'C');
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."reporting_jobs_search_tsv_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_add_stage"("p_pipeline_id" "uuid", "p_name" "text", "p_color" "text" DEFAULT '#6B7280'::"text", "p_description" "text" DEFAULT NULL::"text", "p_is_initial" boolean DEFAULT false, "p_is_terminal" boolean DEFAULT false, "p_terminal_type" "text" DEFAULT NULL::"text", "p_requires_submission" boolean DEFAULT false, "p_requires_timer" boolean DEFAULT false, "p_use_business_hours" boolean DEFAULT false, "p_ui_metadata" "jsonb" DEFAULT '{"x": 0, "y": 0}'::"jsonb", "p_min_timer_seconds" integer DEFAULT 300, "p_submission_mode" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID;
    v_user_id    UUID := auth.uid();
    v_pos        INTEGER;
    v_new_id     UUID;
BEGIN
    SELECT p.company_id INTO v_company_id
    FROM public.pipelines p
    WHERE p.id = p_pipeline_id AND p.deleted_at IS NULL;

    IF v_company_id IS NULL THEN RAISE EXCEPTION 'Pipeline not found'; END IF;
    IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
        OR public.has_permission('pipeline.edit')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    IF p_min_timer_seconds < 0 THEN
        RAISE EXCEPTION 'min_timer_seconds must be >= 0';
    END IF;

    IF p_is_initial = TRUE THEN
        UPDATE public.pipeline_stages SET is_initial = FALSE
        WHERE pipeline_id = p_pipeline_id AND is_initial = TRUE;
    END IF;

    SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos
    FROM public.pipeline_stages WHERE pipeline_id = p_pipeline_id;

    INSERT INTO public.pipeline_stages (
        pipeline_id, name, color, description, position,
        is_initial, is_terminal, terminal_type,
        requires_submission, submission_mode, requires_timer, use_business_hours,
        ui_metadata, min_timer_seconds
    )
    VALUES (
        p_pipeline_id, p_name, p_color, p_description, v_pos,
        p_is_initial, p_is_terminal, p_terminal_type,
        p_requires_submission, p_submission_mode, p_requires_timer, p_use_business_hours,
        p_ui_metadata, p_min_timer_seconds
    )
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;


ALTER FUNCTION "public"."rpc_add_stage"("p_pipeline_id" "uuid", "p_name" "text", "p_color" "text", "p_description" "text", "p_is_initial" boolean, "p_is_terminal" boolean, "p_terminal_type" "text", "p_requires_submission" boolean, "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_ui_metadata" "jsonb", "p_min_timer_seconds" integer, "p_submission_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_add_stage_action"("p_stage_id" "uuid", "p_action_type" "text", "p_label" "text", "p_icon" "text" DEFAULT NULL::"text", "p_style" "text" DEFAULT 'neutral'::"text", "p_required_role" "text" DEFAULT 'any'::"text", "p_requires_timer" boolean DEFAULT false, "p_use_business_hours" boolean DEFAULT false, "p_precondition" "text" DEFAULT NULL::"text", "p_transition_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_new_id UUID;
  v_pos    INTEGER;
BEGIN
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos 
  FROM public.pipeline_stage_actions WHERE stage_id = p_stage_id;

  INSERT INTO public.pipeline_stage_actions (
    stage_id, action_type, label, icon, style, required_role,
    requires_timer, use_business_hours, precondition, transition_id, position
  )
  VALUES (
    p_stage_id, p_action_type, p_label, p_icon, p_style, p_required_role,
    p_requires_timer, p_use_business_hours, p_precondition, p_transition_id, v_pos
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;


ALTER FUNCTION "public"."rpc_add_stage_action"("p_stage_id" "uuid", "p_action_type" "text", "p_label" "text", "p_icon" "text", "p_style" "text", "p_required_role" "text", "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_precondition" "text", "p_transition_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_add_task_attachments"("p_task_id" "uuid", "p_attachments" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."rpc_add_task_attachments"("p_task_id" "uuid", "p_attachments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_add_task_comment"("p_task_id" "uuid", "p_content" "text", "p_parent_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_comment_id  UUID;
  v_is_owner    BOOLEAN;
  v_is_assigned BOOLEAN;
  v_is_creator  BOOLEAN;
  v_is_manager  BOOLEAN;
BEGIN
  -- Fetch task
  SELECT company_id INTO v_company_id
  FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Permission check
  v_is_owner   := (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE;
  v_is_creator := EXISTS (SELECT 1 FROM public.tasks WHERE id = p_task_id AND created_by = v_user_id);
  v_is_manager := EXISTS (SELECT 1 FROM public.tasks WHERE id = p_task_id AND manager_id = v_user_id);
  v_is_assigned := EXISTS (
    SELECT 1 FROM public.task_assignments
    WHERE task_id = p_task_id AND (
      assignee_user_id = v_user_id
      OR assignee_team_id IN (SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL)
    )
  );

  IF NOT (v_is_owner OR v_is_creator OR v_is_manager OR v_is_assigned OR public.has_permission('task.comment')) THEN
    RAISE EXCEPTION 'Insufficient permissions to comment on this task';
  END IF;

  -- Validate parent comment if provided
  IF p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.task_comments WHERE id = p_parent_id AND task_id = p_task_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Parent comment not found or belongs to different task';
    END IF;
  END IF;

  -- Insert comment
  INSERT INTO public.task_comments (task_id, company_id, author_id, content, parent_id)
  VALUES (p_task_id, v_company_id, v_user_id, p_content, p_parent_id)
  RETURNING id INTO v_comment_id;

  -- Log event
  PERFORM public.log_event(
    v_company_id, v_user_id, 'task', p_task_id, 'task.comment_added',
    jsonb_build_object('comment_id', v_comment_id, 'is_reply', p_parent_id IS NOT NULL)
  );

  RETURN v_comment_id;
END;
$$;


ALTER FUNCTION "public"."rpc_add_task_comment"("p_task_id" "uuid", "p_content" "text", "p_parent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_add_transition"("p_from_stage_id" "uuid", "p_to_stage_id" "uuid", "p_label" "text" DEFAULT 'Advance'::"text", "p_required_permission" "text" DEFAULT NULL::"text", "p_transition_type" "text" DEFAULT 'neutral'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id    UUID;
  v_user_id       UUID := auth.uid();
  v_transition_id UUID;
  v_from_pipe     UUID;
  v_to_pipe       UUID;
  v_action_id     UUID;
  v_action_style  TEXT;
  v_db_type       transition_outcome_type;
  v_permission    TEXT;
BEGIN
  -- 1. Validate stages belong to the same pipeline
  SELECT p.company_id, ps.pipeline_id INTO v_company_id, v_from_pipe
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id
  WHERE ps.id = p_from_stage_id;

  SELECT pipeline_id INTO v_to_pipe
  FROM public.pipeline_stages WHERE id = p_to_stage_id;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Source stage not found'; END IF;
  IF v_from_pipe != v_to_pipe THEN RAISE EXCEPTION 'Stages must belong to the same pipeline'; END IF;
  IF p_from_stage_id = p_to_stage_id THEN RAISE EXCEPTION 'Cannot create self-loop transition'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  -- 2. Normalise type: accept UI labels (warning/danger) or DB enum values
  v_db_type := CASE
    WHEN p_transition_type = 'warning' THEN 'revision'
    WHEN p_transition_type = 'danger'  THEN 'failure'
    WHEN p_transition_type IN ('success','revision','failure','neutral') THEN p_transition_type
    ELSE 'neutral'
  END::transition_outcome_type;

  -- 3. Normalise permission: empty string → NULL (avoids FK check on '')
  v_permission := NULLIF(TRIM(COALESCE(p_required_permission, '')), '');

  -- 4. Create transition
  INSERT INTO public.pipeline_stage_transitions (
    from_stage_id, to_stage_id, label, required_permission, transition_type
  )
  VALUES (
    p_from_stage_id, p_to_stage_id, p_label, v_permission, v_db_type
  )
  RETURNING id INTO v_transition_id;

  -- 5. Map type to action button style
  v_action_style := CASE v_db_type
    WHEN 'success'  THEN 'success'
    WHEN 'revision' THEN 'warning'
    WHEN 'failure'  THEN 'danger'
    ELSE 'neutral'
  END;

  -- 6. Auto-create the corresponding stage action (the clickable button on the task)
  INSERT INTO public.pipeline_stage_actions (
    stage_id, action_type, label, transition_id, style, required_role, position
  )
  VALUES (
    p_from_stage_id,
    'advance',
    p_label,
    v_transition_id,
    v_action_style,
    'any',
    (SELECT COALESCE(MAX(position), 0) + 1 FROM public.pipeline_stage_actions WHERE stage_id = p_from_stage_id)
  )
  RETURNING id INTO v_action_id;

  RETURN v_transition_id;
END;
$$;


ALTER FUNCTION "public"."rpc_add_transition"("p_from_stage_id" "uuid", "p_to_stage_id" "uuid", "p_label" "text", "p_required_permission" "text", "p_transition_type" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_add_transition"("p_from_stage_id" "uuid", "p_to_stage_id" "uuid", "p_label" "text", "p_required_permission" "text", "p_transition_type" "text") IS 'Creates a transition edge between two stages.';



CREATE OR REPLACE FUNCTION "public"."rpc_advance_stage"("p_task_id" "uuid", "p_to_stage_id" "uuid", "p_submission_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id                UUID;
  v_user_id                   UUID := auth.uid();
  v_current_stage             UUID;
  v_from_stage_name           TEXT;
  v_to_stage_name             TEXT;
  v_pipeline_id                UUID;
  v_target_pipe_id            UUID;
  v_requires_sub              BOOLEAN;
  v_requires_att              BOOLEAN;
  v_is_terminal               BOOLEAN;
  v_linked_pipe                UUID;
  v_child_inherits_submission BOOLEAN;
  v_reassign_on_entry          BOOLEAN;
  v_sub_content                TEXT;
  v_att_count                  INTEGER;
  v_child_id                   UUID;
  v_src_sub_id                 UUID;
  v_new_sub_id                 UUID;
  v_child_initial_stage        UUID;
BEGIN
  -- 1. Context & Authorization
  SELECT company_id, current_stage_id, pipeline_id
  INTO   v_company_id, v_current_stage, v_pipeline_id
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;

  -- Only enforce authorization check if v_user_id is not null (system operations are allowed)
  IF v_user_id IS NOT NULL AND v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 2. Requirement Enforcement
  -- Scope the requirement to the current stage, not the target stage.
  -- Skip enforcement for system/cron operations (where v_user_id IS NULL)
  SELECT requires_submission, requires_attachments INTO v_requires_sub, v_requires_att
  FROM public.pipeline_stages WHERE id = v_current_stage;

  IF v_user_id IS NOT NULL AND (COALESCE(v_requires_sub, FALSE) = TRUE OR COALESCE(v_requires_att, FALSE) = TRUE) THEN
    SELECT content INTO v_sub_content
    FROM public.task_submissions
    WHERE task_id = p_task_id
      AND stage_id = v_current_stage
      AND status IN ('pending', 'approved')
    ORDER BY submitted_at DESC LIMIT 1;

    SELECT COUNT(*) INTO v_att_count
    FROM public.submission_attachments
    WHERE submission_id IN (
      SELECT id FROM public.task_submissions
      WHERE task_id = p_task_id
        AND stage_id = v_current_stage
        AND status IN ('pending', 'approved')
    );

    IF COALESCE(v_requires_sub, FALSE) = TRUE AND (v_sub_content IS NULL OR btrim(v_sub_content) = '') AND v_att_count = 0 THEN
      RAISE EXCEPTION 'Stage advancement blocked: Mandatory evidence missing (Text or Attachments required).';
    END IF;

    IF COALESCE(v_requires_att, FALSE) = TRUE AND v_att_count = 0 THEN
      RAISE EXCEPTION 'Stage advancement blocked: Mandatory attachments missing.';
    END IF;
  END IF;

  -- 3. Transition path validation
  SELECT pipeline_id INTO v_target_pipe_id FROM public.pipeline_stages WHERE id = p_to_stage_id;

  -- Only validate transition paths for non-owner users. Skip for system/cron context.
  IF v_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND is_owner = TRUE) THEN
    IF v_pipeline_id = v_target_pipe_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.pipeline_stage_transitions
        WHERE from_stage_id = v_current_stage AND to_stage_id = p_to_stage_id
      ) THEN
        RAISE EXCEPTION 'Invalid stage transition path';
      END IF;
    END IF;
  END IF;

  -- 4. Update Task
  UPDATE public.tasks
  SET    current_stage_id = p_to_stage_id,
         pipeline_id      = v_target_pipe_id,
         updated_at       = NOW()
  WHERE  id = p_task_id;

  -- 5. History
  SELECT name INTO v_from_stage_name FROM public.pipeline_stages WHERE id = v_current_stage;
  SELECT name INTO v_to_stage_name   FROM public.pipeline_stages WHERE id = p_to_stage_id;

  INSERT INTO public.pipeline_stage_history (
    task_id, company_id, pipeline_id, from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name, submission_id
  )
  VALUES (
    p_task_id, v_company_id, v_target_pipe_id, v_current_stage, p_to_stage_id,
    v_user_id, v_from_stage_name, v_to_stage_name, p_submission_id
  );

  -- 6. Post-Transition Hooks
  SELECT linked_pipeline_id, child_inherits_submission, reassign_on_entry
  INTO   v_linked_pipe, v_child_inherits_submission, v_reassign_on_entry
  FROM   public.pipeline_stages
  WHERE  id = p_to_stage_id;

  IF v_linked_pipe IS NOT NULL THEN
    SELECT public.spawn_recursive_task(p_task_id, v_linked_pipe) INTO v_child_id;

    -- Inherit parent submission into child if flag is set
    IF v_child_inherits_submission = TRUE AND v_child_id IS NOT NULL THEN
      -- Resolve source submission: explicit > most recent for this task
      v_src_sub_id := p_submission_id;
      IF v_src_sub_id IS NULL THEN
        SELECT id INTO v_src_sub_id
        FROM   public.task_submissions
        WHERE  task_id = p_task_id
          AND  status IN ('pending', 'approved')
        ORDER  BY submitted_at DESC
        LIMIT  1;
      END IF;

      IF v_src_sub_id IS NOT NULL THEN
        -- Resolve the child's initial stage
        SELECT id INTO v_child_initial_stage
        FROM   public.pipeline_stages
        WHERE  pipeline_id = v_linked_pipe AND is_initial = TRUE
        LIMIT  1;

        -- Copy submission to child
        INSERT INTO public.task_submissions (
          task_id, company_id, submitted_by,
          content, stage_id, status, revision_count
        )
        SELECT
          v_child_id,
          company_id,
          submitted_by,
          content,
          COALESCE(v_child_initial_stage, stage_id),
          'pending',
          1
        FROM public.task_submissions
        WHERE id = v_src_sub_id
        RETURNING id INTO v_new_sub_id;

        -- Copy attachments
        IF v_new_sub_id IS NOT NULL THEN
          INSERT INTO public.submission_attachments (
            submission_id, company_id, uploaded_by,
            file_name, file_url, file_size, mime_type, category, storage_path
          )
          SELECT
            v_new_sub_id,
            company_id,
            uploaded_by,
            file_name, file_url, file_size, mime_type, category, storage_path
          FROM public.submission_attachments
          WHERE submission_id = v_src_sub_id;
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT is_terminal INTO v_is_terminal FROM public.pipeline_stages WHERE id = p_to_stage_id;
  IF v_is_terminal = TRUE THEN
    PERFORM public.fn_handle_task_handshake(p_task_id, p_to_stage_id);
  END IF;

  -- 7. Assignment automation: re-route this task if the destination stage opted in.
  IF v_reassign_on_entry = TRUE THEN
    PERFORM public.rpc_auto_assign_task(p_task_id, 'reassign');
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_advance_stage"("p_task_id" "uuid", "p_to_stage_id" "uuid", "p_submission_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_am_i_platform_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public._is_platform_admin()
$$;


ALTER FUNCTION "public"."rpc_am_i_platform_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_archive_project"("p_project_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_project_record RECORD;
    v_task_id UUID;
    v_caller_company_id UUID;
    v_target_company_id UUID;
    v_archive_id UUID;
    v_snapshot JSONB;
    v_involved_users UUID[];
BEGIN
    -- 1. Security Check
    SELECT company_id INTO v_caller_company_id FROM public.users WHERE id = auth.uid();
    SELECT company_id INTO v_target_company_id FROM public.projects WHERE id = p_project_id;
    
    IF v_caller_company_id IS NULL OR v_target_company_id IS NULL OR v_caller_company_id != v_target_company_id THEN
        RAISE EXCEPTION 'Security Breach: Unauthorized archival attempt.' USING ERRCODE = '42501';
    END IF;

    -- 2. Permission Check
    IF NOT (SELECT is_owner FROM public.users WHERE id = auth.uid()) 
       AND NOT public.has_permission('archive:create') 
       AND NOT public.has_permission('archive.restore') THEN
        RAISE EXCEPTION 'Access Denied: Insufficient permissions.';
    END IF;

    -- 3. Fetch Project
    SELECT * INTO v_project_record FROM public.projects WHERE id = p_project_id;

    -- 4. Aggregate Involved Users from all child tasks
    v_involved_users := ARRAY(
        SELECT DISTINCT user_id FROM (
            SELECT assignee_user_id AS user_id FROM public.task_assignments ta JOIN public.tasks t ON t.id = ta.task_id WHERE t.project_id = p_project_id AND assignee_user_id IS NOT NULL
            UNION
            SELECT author_id FROM public.task_comments tc JOIN public.tasks t ON t.id = tc.task_id WHERE t.project_id = p_project_id
            UNION
            SELECT submitted_by FROM public.task_submissions ts JOIN public.tasks t ON t.id = ts.task_id WHERE t.project_id = p_project_id
        ) u
    );

    -- 5. Recursive Archival of Child Tasks (Bottom-Up)
    -- We MUST archive children before parents to avoid ON DELETE CASCADE deleting children 
    -- before they can be snapshotted.
    LOOP
        SELECT id INTO v_task_id
        FROM public.tasks
        WHERE project_id = p_project_id
          AND id NOT IN (
              SELECT parent_task_id 
              FROM public.tasks 
              WHERE parent_task_id IS NOT NULL AND project_id = p_project_id
          )
        LIMIT 1;
        
        EXIT WHEN v_task_id IS NULL;
        
        PERFORM public.rpc_archive_task(v_task_id);
    END LOOP;

    -- 6. Snapshot Project
    v_snapshot := jsonb_build_object(
        'project', to_jsonb(v_project_record)
    );

    -- 7. Insert into Archive Box
    INSERT INTO public.archives (company_id, entity_type, entity_id, snapshot, metadata, archived_by)
    VALUES (
        v_caller_company_id, 
        'project', 
        p_project_id, 
        v_snapshot, 
        jsonb_build_object(
            'title', v_project_record.name,
            'involved_user_ids', v_involved_users
        ), 
        auth.uid()
    )
    RETURNING id INTO v_archive_id;

    -- 8. Remove from operation
    DELETE FROM public.projects WHERE id = p_project_id;

    -- 9. Audit Log
    PERFORM public.log_event(v_caller_company_id, auth.uid(), 'project', p_project_id, 'project.archived', v_snapshot);

    RETURN v_archive_id;
END;
$$;


ALTER FUNCTION "public"."rpc_archive_project"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_archive_task"("p_task_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_task_record       RECORD;
    v_snapshot          JSONB;
    v_metadata          JSONB;
    v_caller_company_id UUID;
    v_target_company_id UUID;
    v_involved_users    UUID[];
    v_archive_id        UUID;
    v_file              RECORD;
    v_assigned_user     UUID;
    v_completed_at      TIMESTAMPTZ;
    v_child_id          UUID;
    v_blocker           RECORD;
BEGIN
    SELECT company_id INTO v_caller_company_id FROM public.users WHERE id = auth.uid();
    SELECT company_id INTO v_target_company_id FROM public.tasks WHERE id = p_task_id;

    IF v_caller_company_id IS NULL OR v_target_company_id IS NULL
       OR v_caller_company_id != v_target_company_id THEN
        RAISE EXCEPTION 'Security Breach: Unauthorized archival attempt.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.has_permission('archive:create')
       AND NOT public.has_permission('pipeline.edit') THEN
        RAISE EXCEPTION 'Access Denied: Insufficient permissions.';
    END IF;

    -- #160: hold the task row for the rest of the transaction. rpc_start_work
    -- and rpc_resume_session take the same lock, so a timer cannot appear
    -- between the guard below and the DELETE at the end, and two concurrent
    -- archives of the same task serialise instead of both writing an archive.
    PERFORM 1 FROM public.tasks WHERE id = p_task_id FOR UPDATE;

    SELECT * INTO v_task_record FROM public.tasks WHERE id = p_task_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task no longer exists.' USING ERRCODE = 'P0002';
    END IF;

    -- Someone is actively working this task: refuse, and say who and where.
    -- The 30s grace window covers a timer stopped moments ago whose client is
    -- still syncing. ('completed' is the real stopped state -- the old code
    -- tested 'stopped', which never matches.)
    SELECT ws.id AS session_id, ws.last_heartbeat_at,
           COALESCE(u.display_name, u.full_name, u.email, 'Someone') AS who
      INTO v_blocker
      FROM public.task_work_sessions ws
      LEFT JOIN public.users u ON u.id = ws.user_id
     WHERE ws.task_id = p_task_id
       AND (ws.status = 'active'
            OR (ws.status = 'completed' AND ws.completed_at > now() - interval '30 seconds'))
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Concurrency Lock: % has an active timer on "%". Stop the timer before archiving.',
            v_blocker.who, v_task_record.title
            USING ERRCODE = '55006',
                  DETAIL = jsonb_build_object(
                      'session_id',  v_blocker.session_id,
                      'task_id',     p_task_id,
                      'task_title',  v_task_record.title,
                      'holder',      v_blocker.who,
                      -- Keep in sync with IDLE_MS in lib/sessionPresence.ts.
                      'is_stale',    v_blocker.last_heartbeat_at < now() - interval '90 seconds'
                  )::text;
    END IF;

    -- Archive the subtree bottom-up FIRST. Without this the DELETE below fires
    -- trg_tasks_recursive_delete and hard-deletes these children unarchived.
    -- Recursion re-runs the guards above for every descendant, so an active
    -- timer anywhere below aborts the whole transaction.
    FOR v_child_id IN
        SELECT id FROM public.tasks WHERE parent_task_id = p_task_id
    LOOP
        PERFORM public.rpc_archive_task(v_child_id);
    END LOOP;

    v_snapshot := jsonb_build_object(
        'task',         to_jsonb(v_task_record),
        'assignments',  (SELECT COALESCE(jsonb_agg(to_jsonb(a)),  '[]'::jsonb)
                         FROM public.task_assignments a WHERE task_id = p_task_id),
        'comments',     (SELECT COALESCE(jsonb_agg(to_jsonb(c)),  '[]'::jsonb)
                         FROM public.task_comments c WHERE task_id = p_task_id),
        'attachments',  (SELECT COALESCE(jsonb_agg(to_jsonb(at)), '[]'::jsonb)
                         FROM public.task_attachments at WHERE task_id = p_task_id),
        'submissions',  (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'submission',  to_jsonb(s),
                    'attachments', (SELECT COALESCE(jsonb_agg(to_jsonb(sa)), '[]'::jsonb)
                                    FROM public.submission_attachments sa
                                    WHERE submission_id = s.id)
                )
            ), '[]'::jsonb) FROM public.task_submissions s WHERE task_id = p_task_id
        ),
        'history',       (SELECT COALESCE(jsonb_agg(to_jsonb(h)),  '[]'::jsonb)
                          FROM public.pipeline_stage_history h WHERE task_id = p_task_id),
        'work_sessions', (SELECT COALESCE(jsonb_agg(to_jsonb(ws)), '[]'::jsonb)
                          FROM public.task_work_sessions ws WHERE task_id = p_task_id),
        -- #157: cascade-deleted with the task and unrecoverable without this.
        'manual_time_entries', (SELECT COALESCE(jsonb_agg(to_jsonb(mt)), '[]'::jsonb)
                          FROM public.task_manual_time_entries mt WHERE task_id = p_task_id)
    );

    v_involved_users := ARRAY(
        SELECT DISTINCT user_id FROM (
            SELECT assignee_user_id AS user_id FROM public.task_assignments
            WHERE task_id = p_task_id AND assignee_user_id IS NOT NULL
            UNION
            SELECT author_id FROM public.task_comments WHERE task_id = p_task_id
            UNION
            SELECT submitted_by FROM public.task_submissions WHERE task_id = p_task_id
        ) u
    );

    v_metadata := jsonb_build_object(
        'title',            v_task_record.title,
        'original_id',      p_task_id,
        'pipeline_id',      v_task_record.pipeline_id,
        'project_id',       v_task_record.project_id,
        'parent_task_id',   v_task_record.parent_task_id,
        'involved_user_ids', v_involved_users
    );

    -- -- FLUSH ANALYTICS SNAPSHOTS (while task is still live in all tables) --
    -- Use completed_at if terminal, else now() as the period anchor.
    v_completed_at := COALESCE(v_task_record.completed_at, now());

    FOR v_assigned_user IN
        SELECT DISTINCT assignee_user_id
        FROM public.task_assignments
        WHERE task_id = p_task_id AND assignee_user_id IS NOT NULL
    LOOP
        PERFORM public.rpc_flush_user_snapshot(
            v_assigned_user, 'week',  date_trunc('week',  v_completed_at)::date);
        PERFORM public.rpc_flush_user_snapshot(
            v_assigned_user, 'month', date_trunc('month', v_completed_at)::date);
        PERFORM public.rpc_flush_user_snapshot(
            v_assigned_user, 'year',  date_trunc('year',  v_completed_at)::date);
    END LOOP;

    IF v_task_record.pipeline_id IS NOT NULL THEN
        PERFORM public.rpc_flush_pipeline_snapshot(
            v_task_record.pipeline_id, 'week',  date_trunc('week',  v_completed_at)::date);
        PERFORM public.rpc_flush_pipeline_snapshot(
            v_task_record.pipeline_id, 'month', date_trunc('month', v_completed_at)::date);
        PERFORM public.rpc_flush_pipeline_snapshot(
            v_task_record.pipeline_id, 'year',  date_trunc('year',  v_completed_at)::date);
    END IF;
    -- -- END ANALYTICS FLUSH --------------------------------------------------

    INSERT INTO public.archives
        (company_id, entity_type, entity_id, snapshot, metadata, archived_by)
    VALUES
        (v_caller_company_id, 'task', p_task_id, v_snapshot, v_metadata, auth.uid())
    RETURNING id INTO v_archive_id;

    -- Queue storage-backed files for archival
    FOR v_file IN (
        SELECT storage_path AS path FROM public.task_attachments
        WHERE task_id = p_task_id AND storage_path IS NOT NULL
        UNION
        SELECT sa.storage_path AS path
        FROM public.submission_attachments sa
        JOIN public.task_submissions s ON s.id = sa.submission_id
        WHERE s.task_id = p_task_id AND sa.storage_path IS NOT NULL
    ) LOOP
        INSERT INTO public.storage_archive_queue (company_id, file_path, action)
        VALUES (v_caller_company_id, v_file.path, 'archive');
    END LOOP;

    DELETE FROM public.tasks WHERE id = p_task_id;

    RETURN v_archive_id;
END;
$$;


ALTER FUNCTION "public"."rpc_archive_task"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_assign_task"("p_task_id" "uuid", "p_target_user_id" "uuid" DEFAULT NULL::"uuid", "p_target_team_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_assign_id  UUID;
BEGIN
  SELECT company_id INTO v_company_id 
  FROM public.tasks 
  WHERE id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or deleted';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.has_permission('tasks.assign') THEN
    RAISE EXCEPTION 'Insufficient permissions to assign tasks';
  END IF;

  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assignee_team_id, assigned_by)
  VALUES (p_task_id, v_company_id, p_target_user_id, p_target_team_id, v_user_id)
  RETURNING id INTO v_assign_id;

  PERFORM public.log_event(v_company_id, v_user_id, 'task', p_task_id, 'task.assigned',
    jsonb_build_object('target_user', p_target_user_id, 'target_team', p_target_team_id));

  RETURN v_assign_id;
END;
$$;


ALTER FUNCTION "public"."rpc_assign_task"("p_task_id" "uuid", "p_target_user_id" "uuid", "p_target_team_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_assign_team_roles"("p_team_id" "uuid", "p_role_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role_id UUID;
  v_company_id UUID;
BEGIN
  v_company_id := public.my_company_id();

  IF NOT ( (SELECT is_owner FROM public.users WHERE id = auth.uid()) OR public.has_permission('role.manage') ) THEN
    RAISE EXCEPTION 'Access Denied';
  END IF;

  -- Clear current team roles
  DELETE FROM public.team_roles WHERE team_id = p_team_id AND company_id = v_company_id;

  -- Assign new roles
  IF p_role_ids IS NOT NULL AND array_length(p_role_ids, 1) > 0 THEN
    FOREACH v_role_id IN ARRAY p_role_ids
    LOOP
      INSERT INTO public.team_roles (team_id, role_id, company_id, assigned_by)
      VALUES (p_team_id, v_role_id, v_company_id, auth.uid());
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_assign_team_roles"("p_team_id" "uuid", "p_role_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_assign_user_roles"("p_user_id" "uuid", "p_role_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role_id UUID;
  v_company_id UUID;
BEGIN
  v_company_id := public.my_company_id();

  IF NOT ( (SELECT is_owner FROM public.users WHERE id = auth.uid()) OR public.has_permission('role.manage') ) THEN
    RAISE EXCEPTION 'Access Denied';
  END IF;

  -- Clear active and re-insert
  UPDATE public.user_roles 
  SET revoked_at = NOW(), revoked_by = auth.uid()
  WHERE user_id = p_user_id AND company_id = v_company_id AND revoked_at IS NULL;

  IF p_role_ids IS NOT NULL AND array_length(p_role_ids, 1) > 0 THEN
    FOREACH v_role_id IN ARRAY p_role_ids
    LOOP
      INSERT INTO public.user_roles (user_id, role_id, company_id, assigned_by)
      VALUES (p_user_id, v_role_id, v_company_id, auth.uid())
      ON CONFLICT (user_id, role_id, company_id) DO UPDATE 
      SET revoked_at = NULL, revoked_by = NULL, assigned_by = auth.uid(), assigned_at = NOW();
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_assign_user_roles"("p_user_id" "uuid", "p_role_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_assign_user_teams"("p_user_id" "uuid", "p_team_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_team_id UUID;
  v_company_id UUID;
BEGIN
  v_company_id := public.my_company_id();

  IF NOT ( (SELECT is_owner FROM public.users WHERE id = auth.uid()) OR public.has_permission('role.manage') OR public.has_permission('team:manage_members') ) THEN
    RAISE EXCEPTION 'Access Denied';
  END IF;

  -- Soft remove from all current teams in company
  UPDATE public.team_members
  SET removed_at = NOW()
  WHERE user_id = p_user_id AND company_id = v_company_id AND removed_at IS NULL;

  -- Add to new teams
  IF p_team_ids IS NOT NULL AND array_length(p_team_ids, 1) > 0 THEN
    FOREACH v_team_id IN ARRAY p_team_ids
    LOOP
      INSERT INTO public.team_members (user_id, team_id, company_id, added_by)
      VALUES (p_user_id, v_team_id, v_company_id, auth.uid())
      ON CONFLICT (user_id, team_id) DO UPDATE
      SET removed_at = NULL, added_by = auth.uid(), joined_at = NOW();
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_assign_user_teams"("p_user_id" "uuid", "p_team_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_auto_assign_task"("p_task_id" "uuid", "p_mode" "text" DEFAULT 'fill_if_empty'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_task            RECORD;
  v_assignment_mode TEXT;
  v_pool_type       TEXT;
  v_actor           UUID;
  v_winner_pool_id  UUID;
  v_winner_user_id  UUID;
  v_winner_team_id  UUID;
BEGIN
  IF p_mode NOT IN ('fill_if_empty', 'reassign') THEN
    RAISE EXCEPTION 'p_mode must be ''fill_if_empty'' or ''reassign''';
  END IF;

  SELECT t.id, t.company_id, t.pipeline_id, t.created_by
  INTO v_task
  FROM public.tasks t
  WHERE t.id = p_task_id AND t.deleted_at IS NULL;

  IF v_task.id IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL AND v_task.company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT p.assignment_mode, p.assignment_pool_type
  INTO v_assignment_mode, v_pool_type
  FROM public.pipelines p
  WHERE p.id = v_task.pipeline_id;

  IF v_assignment_mode IS NULL OR v_assignment_mode = 'manual' THEN
    RETURN;
  END IF;

  IF p_mode = 'fill_if_empty' AND EXISTS (
    SELECT 1 FROM public.task_assignments WHERE task_id = p_task_id
  ) THEN
    RETURN;
  END IF;

  IF p_mode = 'reassign' THEN
    DELETE FROM public.task_assignments WHERE task_id = p_task_id;
  END IF;

  v_actor := COALESCE(auth.uid(), v_task.created_by);

  SELECT fp.pool_id, fp.user_id, fp.team_id
  INTO v_winner_pool_id, v_winner_user_id, v_winner_team_id
  FROM public.fn_pick_assignee(v_task.pipeline_id, p_task_id) fp;

  IF v_winner_pool_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assignee_team_id, assigned_by)
  VALUES (p_task_id, v_task.company_id, v_winner_user_id, v_winner_team_id, v_actor);

  UPDATE public.pipeline_assignment_pool
  SET last_assigned_at = now()
  WHERE id = v_winner_pool_id;

  PERFORM public.log_event(
    v_task.company_id, v_actor, 'task', p_task_id, 'task.auto_assigned',
    jsonb_build_object(
      'mode', v_assignment_mode, 'pool_type', v_pool_type,
      'assignee_user_id', v_winner_user_id, 'assignee_team_id', v_winner_team_id,
      'trigger', p_mode
    )
  );
END;
$$;


ALTER FUNCTION "public"."rpc_auto_assign_task"("p_task_id" "uuid", "p_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_billing_overview"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company         uuid := public.my_company_id();
  v_billing         public.company_billing%rowtype;
  v_seats           int;
  v_pipeline_count  int;
  v_limits          jsonb;
  v_member_limit    int;
  v_pipeline_limit  int;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'No company context'; END IF;
  IF NOT public._can_manage_billing() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT * INTO v_billing FROM public.company_billing WHERE company_id = v_company;
  IF NOT FOUND THEN
    v_billing.company_id         := v_company;
    v_billing.plan_code          := 'free';
    v_billing.status             := 'active';
    v_billing.seats              := 1;
    v_billing.storage_used_bytes := 0;
  END IF;

  SELECT COUNT(*) INTO v_seats FROM public.users WHERE company_id = v_company AND deleted_at IS NULL;
  SELECT COUNT(*) INTO v_pipeline_count FROM public.pipelines WHERE company_id = v_company AND deleted_at IS NULL;

  SELECT COALESCE(bp.limits, '{}') INTO v_limits
  FROM public.billing_plans bp WHERE bp.code = v_billing.plan_code;

  v_member_limit   := public._company_member_limit(v_company);
  v_pipeline_limit := public._company_pipeline_limit(v_company);

  RETURN jsonb_build_object(
    'billing', jsonb_build_object(
      'plan_code',           v_billing.plan_code,
      'status',              v_billing.status,
      'seats',               v_billing.seats,
      'active_members',      v_seats,
      'member_limit',        CASE WHEN v_member_limit   = -1 THEN NULL ELSE v_member_limit   END,
      'storage_used_bytes',  v_billing.storage_used_bytes,
      'pipeline_count',      v_pipeline_count,
      'pipeline_limit',      CASE WHEN v_pipeline_limit = -1 THEN NULL ELSE v_pipeline_limit END,
      'external_provider',   v_billing.external_provider,
      'current_period_end',  v_billing.current_period_end,
      'trial_ends_at',       v_billing.trial_ends_at,
      'connected',           v_billing.external_subscription_id IS NOT NULL
    ),
    'limits', v_limits,
    'plans', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'code',        p.code,
               'name',        p.name,
               'description', p.description,
               'price_cents', p.price_cents,
               'currency',    p.currency,
               'interval',    p.interval,
               'per_seat',    p.per_seat,
               'features',    p.features,
               'limits',      p.limits
             ) ORDER BY p.sort_order)
      FROM public.billing_plans p WHERE p.is_active = true
    ), '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_billing_overview"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_check_plan_limit"("p_resource" "text" DEFAULT 'members'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company uuid := public.my_company_id();
  v_current int;
  v_limit   int;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'No company context'; END IF;

  IF p_resource = 'members' THEN
    SELECT COUNT(*) INTO v_current
    FROM public.users WHERE company_id = v_company AND deleted_at IS NULL;
    v_limit := public._company_member_limit(v_company);

  ELSIF p_resource = 'pipelines' THEN
    SELECT COUNT(*) INTO v_current
    FROM public.pipelines WHERE company_id = v_company AND deleted_at IS NULL;
    v_limit := public._company_pipeline_limit(v_company);

  ELSE
    RAISE EXCEPTION 'Unknown resource: %', p_resource;
  END IF;

  RETURN jsonb_build_object(
    'resource', p_resource,
    'current',  v_current,
    'limit',    CASE WHEN v_limit = -1 THEN NULL ELSE v_limit END,
    'allowed',  v_limit = -1 OR v_current < v_limit
  );
END;
$$;


ALTER FUNCTION "public"."rpc_check_plan_limit"("p_resource" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_claim_pending_invitation"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_user_email TEXT;
  v_invite     public.invitations%ROWTYPE;
BEGIN
  SELECT email INTO v_user_email FROM public.users WHERE id = v_user_id;
  SELECT * INTO v_invite FROM public.invitations WHERE email = v_user_email AND status = 'pending' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    UPDATE public.users SET company_id = v_invite.company_id, is_owner = FALSE WHERE id = v_user_id;
    IF v_invite.role_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role_id, company_id, assigned_by) VALUES (v_user_id, v_invite.role_id, v_invite.company_id, v_invite.invited_by);
    END IF;
    UPDATE public.invitations SET status = 'accepted', accepted_at = NOW() WHERE id = v_invite.id;
    RETURN v_invite.company_id;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."rpc_claim_pending_invitation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_claim_task"("p_task_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_task_exists boolean;
  v_is_assigned boolean;
BEGIN
  v_company_id := public.my_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found or not associated with a company.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE id = p_task_id AND company_id = v_company_id AND deleted_at IS NULL
  ) INTO v_task_exists;

  IF NOT v_task_exists THEN
    RAISE EXCEPTION 'Task not found or does not belong to your company.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.task_assignments
    WHERE task_id = p_task_id
    AND assignee_user_id IS NOT NULL
  ) INTO v_is_assigned;

  IF v_is_assigned THEN
    RAISE EXCEPTION 'Task is already claimed by another user.';
  END IF;

  DELETE FROM public.task_assignments
  WHERE task_id = p_task_id
  AND assignee_user_id IS NULL
  AND assignee_team_id IS NULL;

  INSERT INTO public.task_assignments (
    task_id, company_id, assignee_user_id, assigned_by
  ) VALUES (
    p_task_id, v_company_id, v_user_id, v_user_id
  );

  PERFORM public.log_event(
    v_company_id, v_user_id, 'task', p_task_id, 'task.claimed',
    jsonb_build_object('assignee_id', v_user_id)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_claim_task"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_compare_personnel"("p_user_ids" "uuid"[], "p_from" "date", "p_to" "date", "p_salaries" "jsonb" DEFAULT '{}'::"jsonb") RETURNS TABLE("user_id" "uuid", "full_name" "text", "avatar_url" "text", "weight_points" bigint, "active_seconds" bigint, "active_hours" numeric, "estimated_seconds" numeric, "completed_tasks" bigint, "failed_tasks" bigint, "revision_count" bigint, "on_time_tasks" bigint, "on_time_rate" numeric, "timer_efficiency" numeric, "daily_rate_usd" numeric, "working_days" integer, "total_cost_usd" numeric, "cost_per_point" numeric, "points_per_hour" numeric, "activity_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_company_id   uuid;
  v_working_days int;
  v_to_ts        timestamptz;
BEGIN
  IF NOT public.has_permission('analytics.compare') THEN
    RAISE EXCEPTION 'Access Denied: analytics.compare required.';
  END IF;

  SELECT my_company_id() INTO v_company_id;
  v_working_days := (p_to - p_from) + 1;
  v_to_ts        := (p_to + interval '1 day')::timestamptz;

  RETURN QUERY
  WITH user_live AS (
    SELECT
      ta.assignee_user_id                                              AS uid,
      SUM(CASE WHEN ps.terminal_type = 'success' THEN t.weight ELSE 0 END)
                                                                       AS weight_pts,
      SUM(CASE WHEN ps.terminal_type = 'success' THEN 1         ELSE 0 END)
                                                                       AS completed,
      SUM(CASE WHEN ps.terminal_type = 'failure' THEN 1         ELSE 0 END)
                                                                       AS failed,
      SUM(COALESCE(t.estimated_hours, 0) * 3600)                       AS est_secs,
      SUM(CASE WHEN t.due_date IS NOT NULL
               AND t.completed_at <= t.due_date THEN 1 ELSE 0 END)    AS on_time
    FROM public.task_assignments ta
    JOIN public.tasks t            ON t.id  = ta.task_id
    JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE ta.assignee_user_id = ANY(p_user_ids)
      AND t.company_id    = v_company_id
      AND ps.is_terminal  = true
      AND t.completed_at >= p_from::timestamptz
      AND t.completed_at <  v_to_ts
    GROUP BY ta.assignee_user_id
  ),
  user_archived AS (
    SELECT
      uid_inner.u                                                      AS uid,
      SUM(CASE
        WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
             (SELECT ps_inner.id FROM public.pipeline_stages ps_inner WHERE ps_inner.terminal_type = 'success')
        THEN (ar.snapshot->'task'->>'weight')::bigint ELSE 0 END)     AS weight_pts,
      SUM(CASE
        WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
             (SELECT ps_inner.id FROM public.pipeline_stages ps_inner WHERE ps_inner.terminal_type = 'success')
        THEN 1 ELSE 0 END)                                             AS completed,
      SUM(CASE
        WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
             (SELECT ps_inner.id FROM public.pipeline_stages ps_inner WHERE ps_inner.terminal_type = 'failure')
        THEN 1 ELSE 0 END)                                             AS failed,
      SUM(COALESCE((ar.snapshot->'task'->>'estimated_hours')::numeric, 0) * 3600)
                                                                       AS est_secs,
      SUM(CASE
        WHEN ar.snapshot->'task'->>'due_date' IS NOT NULL
         AND (ar.snapshot->'task'->>'completed_at')::timestamptz
              <= (ar.snapshot->'task'->>'due_date')::timestamptz
        THEN 1 ELSE 0 END)                                             AS on_time
    FROM public.archives ar,
         unnest(p_user_ids) AS uid_inner(u)
    WHERE ar.company_id  = v_company_id
      AND ar.entity_type = 'task'
      AND ar.metadata    @> jsonb_build_object('involved_user_ids', jsonb_build_array(uid_inner.u))
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_from::timestamptz
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_to_ts
    GROUP BY uid_inner.u
  ),
  user_sessions AS (
    SELECT
      ws.user_id                                                       AS uid,
      SUM(ws.total_seconds_spent)::bigint                              AS active_secs
    FROM public.task_work_sessions ws
    WHERE ws.user_id   = ANY(p_user_ids)
      AND ws.company_id = v_company_id
      AND ws.status     = 'completed'
      AND ws.started_at >= p_from::timestamptz
      AND ws.started_at <  v_to_ts
    GROUP BY ws.user_id
  ),
  archived_sessions AS (
    SELECT
      (ws_el->>'user_id')::uuid                                        AS uid,
      SUM((ws_el->>'total_seconds_spent')::bigint)::bigint             AS active_secs
    FROM public.archives ar,
         jsonb_array_elements(ar.snapshot->'work_sessions') AS ws_el
    WHERE ar.company_id  = v_company_id
      AND ar.entity_type = 'task'
      AND (ws_el->>'user_id')::uuid = ANY(p_user_ids)
      AND ws_el->>'status' = 'completed'
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_from::timestamptz
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_to_ts
    GROUP BY (ws_el->>'user_id')::uuid
  ),
  user_revisions AS (
    SELECT
      ts.submitted_by                                                  AS uid,
      SUM(ts.revision_count)::bigint                                   AS rev_count
    FROM public.task_submissions ts
    WHERE ts.submitted_by = ANY(p_user_ids)
      AND ts.company_id   = v_company_id
      AND ts.submitted_at >= p_from::timestamptz
      AND ts.submitted_at <  v_to_ts
    GROUP BY ts.submitted_by
  ),
  archived_revisions AS (
    SELECT
      (sub_el->'submission'->>'submitted_by')::uuid                    AS uid,
      SUM((sub_el->'submission'->>'revision_count')::integer)::bigint  AS rev_count
    FROM public.archives ar,
         jsonb_array_elements(ar.snapshot->'submissions') AS sub_el
    WHERE ar.company_id  = v_company_id
      AND ar.entity_type = 'task'
      AND (sub_el->'submission'->>'submitted_by')::uuid = ANY(p_user_ids)
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_from::timestamptz
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_to_ts
    GROUP BY (sub_el->'submission'->>'submitted_by')::uuid
  ),
  user_ops AS (
    SELECT
      ae.user_id                                                       AS uid,
      COUNT(ae.id)::bigint                                             AS op_count
    FROM public.activity_events ae
    WHERE ae.user_id     = ANY(p_user_ids)
      AND ae.company_id  = v_company_id
      AND ae.created_at >= p_from::timestamptz
      AND ae.created_at <  v_to_ts
    GROUP BY ae.user_id
  ),
  combined AS (
    SELECT
      u_final.id                                                       AS uid,
      u_final.full_name,
      u_final.avatar_url,
      COALESCE(ul.weight_pts,  0) + COALESCE(ua.weight_pts,  0)      AS weight_points,
      COALESCE(ul.completed,   0) + COALESCE(ua.completed,   0)      AS completed_tasks,
      COALESCE(ul.failed,      0) + COALESCE(ua.failed,      0)      AS failed_tasks,
      COALESCE(ul.est_secs,    0) + COALESCE(ua.est_secs,    0)      AS estimated_seconds,
      COALESCE(ul.on_time,     0) + COALESCE(ua.on_time,     0)      AS on_time_tasks,
      COALESCE(us.active_secs, 0) + COALESCE(asr.active_secs, 0)    AS active_seconds,
      COALESCE(ur.rev_count,   0) + COALESCE(arvr.rev_count,  0)    AS revision_count,
      COALESCE(uo.op_count,    0)                                      AS op_count
    FROM public.users u_final
    LEFT JOIN user_live       ul   ON ul.uid   = u_final.id
    LEFT JOIN user_archived   ua   ON ua.uid   = u_final.id
    LEFT JOIN user_sessions   us   ON us.uid   = u_final.id
    LEFT JOIN archived_sessions asr ON asr.uid = u_final.id
    LEFT JOIN user_revisions  ur   ON ur.uid   = u_final.id
    LEFT JOIN archived_revisions arvr ON arvr.uid = u_final.id
    LEFT JOIN user_ops        uo   ON uo.uid   = u_final.id
    WHERE u_final.id = ANY(p_user_ids)
      AND u_final.company_id = v_company_id
  )
  SELECT
    c.uid                                                              AS user_id,
    c.full_name,
    c.avatar_url,
    c.weight_points::bigint,
    c.active_seconds::bigint,
    ROUND(c.active_seconds::numeric / 3600, 2)                        AS active_hours,
    c.estimated_seconds::numeric                                       AS estimated_seconds,
    c.completed_tasks::bigint,
    c.failed_tasks::bigint,
    c.revision_count::bigint,
    c.on_time_tasks::bigint,
    CASE WHEN (c.completed_tasks + c.failed_tasks) > 0
         THEN ROUND(c.on_time_tasks::numeric
                    / (c.completed_tasks + c.failed_tasks) * 100, 1)
         ELSE NULL END                                                 AS on_time_rate,
    CASE WHEN c.estimated_seconds > 0
         THEN ROUND(c.active_seconds::numeric / c.estimated_seconds * 100, 1)
         ELSE NULL END                                                 AS timer_efficiency,
    (p_salaries->>(c.uid::text))::numeric                             AS daily_rate_usd,
    v_working_days,
    CASE WHEN (p_salaries->>(c.uid::text))::numeric IS NOT NULL
         THEN ROUND((p_salaries->>(c.uid::text))::numeric * v_working_days, 2)
         ELSE NULL END                                                 AS total_cost_usd,
    CASE
      WHEN c.weight_points > 0
       AND (p_salaries->>(c.uid::text))::numeric IS NOT NULL
      THEN ROUND(
        (p_salaries->>(c.uid::text))::numeric * v_working_days
        / c.weight_points::numeric, 4)
      ELSE NULL END                                                    AS cost_per_point,
    CASE WHEN c.active_seconds > 0
         THEN ROUND(c.weight_points::numeric
                    / (c.active_seconds::numeric / 3600), 4)
         ELSE NULL END                                                 AS points_per_hour,
    c.op_count::bigint                                                 AS activity_count
  FROM combined c
  ORDER BY c.weight_points DESC;
END;
$$;


ALTER FUNCTION "public"."rpc_compare_personnel"("p_user_ids" "uuid"[], "p_from" "date", "p_to" "date", "p_salaries" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_complete_onboarding"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.users
     set onboarded_at = now()
   where id = auth.uid()
     and onboarded_at is null;
$$;


ALTER FUNCTION "public"."rpc_complete_onboarding"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_create_automation"("p_pipeline_id" "uuid", "p_source_stage_id" "uuid", "p_target_stage_id" "uuid", "p_condition_type" "text", "p_check_interval_minutes" integer DEFAULT 60, "p_priority" integer DEFAULT 0, "p_params" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id    UUID;
  v_user_id       UUID := auth.uid();
  v_automation_id UUID;
  v_key           TEXT;
  v_value         TEXT;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.pipelines WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Pipeline not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF p_condition_type NOT IN ('overdue', 'idle', 'due_soon') THEN
    RAISE EXCEPTION 'Invalid condition type: %', p_condition_type;
  END IF;

  INSERT INTO public.pipeline_automations (
    pipeline_id, source_stage_id, target_stage_id,
    condition_type, check_interval_minutes, priority, is_active,
    company_id
  )
  VALUES (
    p_pipeline_id, p_source_stage_id, p_target_stage_id,
    p_condition_type, p_check_interval_minutes, p_priority, TRUE,
    v_company_id
  )
  RETURNING id INTO v_automation_id;

  FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_params)
  LOOP
    INSERT INTO public.pipeline_automation_params (automation_id, key, value)
    VALUES (v_automation_id, v_key, v_value);
  END LOOP;

  RETURN v_automation_id;
END;
$$;


ALTER FUNCTION "public"."rpc_create_automation"("p_pipeline_id" "uuid", "p_source_stage_id" "uuid", "p_target_stage_id" "uuid", "p_condition_type" "text", "p_check_interval_minutes" integer, "p_priority" integer, "p_params" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_create_automation"("p_pipeline_id" "uuid", "p_source_stage_id" "uuid", "p_target_stage_id" "uuid", "p_condition_type" "text", "p_check_interval_minutes" integer, "p_priority" integer, "p_params" "jsonb") IS 'Creates an automation rule with params.';



CREATE OR REPLACE FUNCTION "public"."rpc_create_company_and_link"("p_company_name" "text", "p_slug" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id    uuid;
  v_user_id       uuid := auth.uid();
  v_user_email    text;
  v_owner_role_id uuid;
  v_final_slug    text;
  v_pipeline_id   uuid;
BEGIN
  IF p_slug IS NULL OR p_slug = '' THEN
    v_final_slug := REGEXP_REPLACE(LOWER(p_company_name), '[^a-z0-9]+', '-', 'g');
    v_final_slug := TRIM(BOTH '-' FROM v_final_slug);
    IF EXISTS (SELECT 1 FROM public.companies WHERE slug = v_final_slug) THEN
      v_final_slug := v_final_slug || '-' || SUBSTR(MD5(RANDOM()::TEXT), 1, 4);
    END IF;
  ELSE v_final_slug := p_slug; END IF;

  INSERT INTO public.companies (name, slug) VALUES (p_company_name, v_final_slug) RETURNING id INTO v_company_id;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  INSERT INTO public.users (id, email, company_id, is_owner, is_active)
  VALUES (v_user_id, v_user_email, v_company_id, TRUE, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET company_id = EXCLUDED.company_id,
        is_owner   = TRUE,
        is_active  = TRUE;

  SELECT id INTO v_owner_role_id FROM public.roles WHERE name = 'Owner' AND company_id IS NULL AND is_system = TRUE LIMIT 1;
  IF v_owner_role_id IS NULL THEN
    INSERT INTO public.roles (name, description, color, is_system, is_default)
    VALUES ('Owner', 'Platform owner (system) role', NULL, TRUE, FALSE)
    RETURNING id INTO v_owner_role_id;
  END IF;

  INSERT INTO public.user_roles (user_id, role_id, company_id)
  VALUES (v_user_id, v_owner_role_id, v_company_id)
  ON CONFLICT DO NOTHING;

  -- Seed a default pipeline so new workspaces aren't empty
  INSERT INTO public.pipelines (company_id, name, description, is_default, created_by, visibility_permissions)
  VALUES (v_company_id, 'Main Workflow', 'Default pipeline for your workspace', TRUE, v_user_id, '{}')
  RETURNING id INTO v_pipeline_id;

  INSERT INTO public.pipeline_stages (pipeline_id, name, color, position, is_initial, is_terminal, terminal_type)
  VALUES
    (v_pipeline_id, 'Backlog',     '#6B7280', 1, TRUE,  FALSE, NULL),
    (v_pipeline_id, 'In Progress', '#3B82F6', 2, FALSE, FALSE, NULL),
    (v_pipeline_id, 'In Review',   '#F59E0B', 3, FALSE, FALSE, NULL),
    (v_pipeline_id, 'Done',        '#10B981', 4, FALSE, TRUE,  'success');

  RETURN v_company_id;
END;
$$;


ALTER FUNCTION "public"."rpc_create_company_and_link"("p_company_name" "text", "p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_create_notification_rule"("p_name" "text", "p_description" "text", "p_event_type" "text", "p_conditions" "jsonb", "p_recipient_strategies" "text"[], "p_recipient_config" "jsonb", "p_channels_override" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_rule_id UUID;
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notification_rules
    (name, description, event_type, conditions,
     recipient_strategies, recipient_config, channels_override, created_by)
  VALUES
    (p_name, p_description, p_event_type,
     COALESCE(p_conditions, '{}'),
     p_recipient_strategies,
     COALESCE(p_recipient_config, '{}'),
     p_channels_override,
     auth.uid())
  RETURNING id INTO v_rule_id;

  RETURN v_rule_id;
END;
$$;


ALTER FUNCTION "public"."rpc_create_notification_rule"("p_name" "text", "p_description" "text", "p_event_type" "text", "p_conditions" "jsonb", "p_recipient_strategies" "text"[], "p_recipient_config" "jsonb", "p_channels_override" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_create_pipeline"("p_name" "text", "p_description" "text" DEFAULT NULL::"text", "p_stages" "jsonb" DEFAULT '[]'::"jsonb", "p_transitions" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_pipeline_id   UUID;
  v_company_id    UUID;
  v_user_id       UUID := auth.uid();
  v_stage         JSONB;
  v_transition    JSONB;
  v_stage_map     JSONB := '{}';
  v_stage_id      UUID;
  v_from_stage    UUID;
  v_to_stage      UUID;
  v_initial_count INTEGER;
BEGIN
  v_company_id := public.my_company_id();

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.create')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create pipelines';
  END IF;

  IF jsonb_array_length(p_stages) < 1 THEN
    RAISE EXCEPTION 'A pipeline must have at least one stage';
  END IF;

  SELECT COUNT(*) INTO v_initial_count
  FROM jsonb_array_elements(p_stages) AS s
  WHERE (s->>'is_initial')::BOOLEAN = TRUE;

  IF v_initial_count != 1 THEN
    RAISE EXCEPTION 'A pipeline must have exactly one initial stage';
  END IF;

  INSERT INTO public.pipelines (company_id, name, description, created_by)
  VALUES (v_company_id, p_name, p_description, v_user_id)
  RETURNING id INTO v_pipeline_id;

  FOR v_stage IN SELECT * FROM jsonb_array_elements(p_stages)
  LOOP
    INSERT INTO public.pipeline_stages (
      pipeline_id, name, color, position,
      is_initial, is_terminal, terminal_type, requires_submission
    )
    VALUES (
      v_pipeline_id,
      v_stage->>'name',
      v_stage->>'color',
      (v_stage->>'position')::INTEGER,
      COALESCE((v_stage->>'is_initial')::BOOLEAN, FALSE),
      COALESCE((v_stage->>'is_terminal')::BOOLEAN, FALSE),
      NULLIF(v_stage->>'terminal_type', ''),
      COALESCE((v_stage->>'requires_submission')::BOOLEAN, FALSE)
    )
    RETURNING id INTO v_stage_id;

    v_stage_map := v_stage_map || jsonb_build_object(v_stage->>'position', v_stage_id);
  END LOOP;

  FOR v_transition IN SELECT * FROM jsonb_array_elements(p_transitions)
  LOOP
    v_from_stage := (v_stage_map->>(v_transition->>'from_position'))::UUID;
    v_to_stage   := (v_stage_map->>(v_transition->>'to_position'))::UUID;

    IF v_from_stage IS NULL OR v_to_stage IS NULL THEN
      RAISE EXCEPTION 'Transition references invalid stage position: from=%, to=%',
        v_transition->>'from_position', v_transition->>'to_position';
    END IF;

    INSERT INTO public.pipeline_stage_transitions (
      from_stage_id, to_stage_id, label, required_permission
    )
    VALUES (
      v_from_stage,
      v_to_stage,
      COALESCE(v_transition->>'label', 'Advance'),
      NULLIF(v_transition->>'required_permission', '')
    );
  END LOOP;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'pipeline', v_pipeline_id, 'pipeline.created',
    jsonb_build_object('name', p_name, 'stage_count', jsonb_array_length(p_stages))
  );

  RETURN v_pipeline_id;
END;
$$;


ALTER FUNCTION "public"."rpc_create_pipeline"("p_name" "text", "p_description" "text", "p_stages" "jsonb", "p_transitions" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_create_pipeline"("p_name" "text", "p_description" "text" DEFAULT NULL::"text", "p_stages" "jsonb" DEFAULT '[]'::"jsonb", "p_transitions" "jsonb" DEFAULT '[]'::"jsonb", "p_visibility_permissions" "text"[] DEFAULT '{}'::"text"[], "p_task_visibility_mode" "text" DEFAULT 'all'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_pipeline_id  UUID;
  v_company_id   UUID;
  v_user_id      UUID := auth.uid();
  v_stage        JSONB;
  v_transition   JSONB;
  v_stage_map    JSONB := '{}';
  v_stage_id     UUID;
  v_from_stage   UUID;
  v_to_stage     UUID;
  v_initial_count INTEGER;
BEGIN
  v_company_id := public.my_company_id();

  -- Permission check
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.create')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create pipelines';
  END IF;

  -- Validate task_visibility_mode
  IF p_task_visibility_mode NOT IN ('all', 'assigned_only') THEN
    RAISE EXCEPTION 'Invalid task_visibility_mode: must be all or assigned_only';
  END IF;

  -- Validate at least one stage
  IF jsonb_array_length(p_stages) < 1 THEN
    RAISE EXCEPTION 'A pipeline must have at least one stage';
  END IF;

  -- Validate exactly one initial stage
  SELECT COUNT(*) INTO v_initial_count
  FROM jsonb_array_elements(p_stages) AS s
  WHERE (s->>'is_initial')::BOOLEAN = TRUE;

  IF v_initial_count != 1 THEN
    RAISE EXCEPTION 'A pipeline must have exactly one initial stage (is_initial: true)';
  END IF;

  -- Create the pipeline
  INSERT INTO public.pipelines (
    company_id, name, description, created_by, 
    visibility_permissions, task_visibility_mode
  )
  VALUES (
    v_company_id, p_name, p_description, v_user_id,
    COALESCE(p_visibility_permissions, '{}'),
    COALESCE(p_task_visibility_mode, 'all')
  )
  RETURNING id INTO v_pipeline_id;

  -- Create stages
  FOR v_stage IN SELECT * FROM jsonb_array_elements(p_stages)
  LOOP
    INSERT INTO public.pipeline_stages (
      pipeline_id, name, color, position,
      is_initial, is_terminal, terminal_type, requires_submission
    )
    VALUES (
      v_pipeline_id,
      v_stage->>'name',
      v_stage->>'color',
      (v_stage->>'position')::INTEGER,
      COALESCE((v_stage->>'is_initial')::BOOLEAN, FALSE),
      COALESCE((v_stage->>'is_terminal')::BOOLEAN, FALSE),
      NULLIF(v_stage->>'terminal_type', ''),
      COALESCE((v_stage->>'requires_submission')::BOOLEAN, FALSE)
    )
    RETURNING id INTO v_stage_id;

    v_stage_map := v_stage_map || jsonb_build_object(v_stage->>'position', v_stage_id);
  END LOOP;

  -- Create transitions
  FOR v_transition IN SELECT * FROM jsonb_array_elements(p_transitions)
  LOOP
    v_from_stage := (v_stage_map->>(v_transition->>'from_position'))::UUID;
    v_to_stage   := (v_stage_map->>(v_transition->>'to_position'))::UUID;

    IF v_from_stage IS NULL OR v_to_stage IS NULL THEN
      RAISE EXCEPTION 'Transition references invalid stage position';
    END IF;

    INSERT INTO public.pipeline_stage_transitions (
      from_stage_id, to_stage_id, label, required_permission
    )
    VALUES (
      v_from_stage,
      v_to_stage,
      COALESCE(v_transition->>'label', 'Advance'),
      NULLIF(v_transition->>'required_permission', '')
    );
  END LOOP;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'pipeline', v_pipeline_id, 'pipeline.created',
    jsonb_build_object('name', p_name, 'visibility', p_visibility_permissions, 'mode', p_task_visibility_mode)
  );

  RETURN v_pipeline_id;
END;
$$;


ALTER FUNCTION "public"."rpc_create_pipeline"("p_name" "text", "p_description" "text", "p_stages" "jsonb", "p_transitions" "jsonb", "p_visibility_permissions" "text"[], "p_task_visibility_mode" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "color" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "pipeline_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "expiry_date" timestamp with time zone,
    "is_featured" boolean DEFAULT false,
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'closed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


COMMENT ON TABLE "public"."projects" IS 'Groups tasks into logical projects. Optionally linked to a default pipeline.';



CREATE OR REPLACE FUNCTION "public"."rpc_create_project"("p_name" "text", "p_color" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_expiry_date" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_status" "text" DEFAULT 'active'::"text") RETURNS "public"."projects"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_company_id UUID;
  v_user_id UUID;
  v_project RECORD;
BEGIN
  v_company_id := public.my_company_id();
  v_user_id := auth.uid();

  -- Permission check
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('project.create')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create projects.';
  END IF;

  -- Validate input
  IF TRIM(COALESCE(p_name, '')) = '' THEN
    RAISE EXCEPTION 'Project name is required.';
  END IF;

  -- Create project
  INSERT INTO public.projects (company_id, name, color, description, expiry_date, status, created_by, created_at, updated_at)
  VALUES (v_company_id, TRIM(p_name), p_color, p_description, p_expiry_date, p_status, v_user_id, now(), now())
  RETURNING * INTO v_project;

  -- Audit log
  PERFORM public.log_event(v_company_id, v_user_id, 'project', v_project.id, 'project.created',
    jsonb_build_object('name', v_project.name));

  RETURN v_project;
END;
$$;


ALTER FUNCTION "public"."rpc_create_project"("p_name" "text", "p_color" "text", "p_description" "text", "p_expiry_date" timestamp with time zone, "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_create_role"("p_name" "text", "p_description" "text", "p_color" "text", "p_permissions" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role_id UUID;
  v_company_id UUID;
  v_perm_id UUID;
BEGIN
  v_company_id := public.my_company_id();
  
  -- Auth Check
  IF NOT ( (SELECT is_owner FROM public.users WHERE id = auth.uid()) OR public.has_permission('role.manage') ) THEN
    RAISE EXCEPTION 'Access Denied';
  END IF;

  -- Create Role
  INSERT INTO public.roles (company_id, name, description, color, created_by)
  VALUES (v_company_id, p_name, p_description, p_color, auth.uid())
  RETURNING id INTO v_role_id;

  -- Attach Permissions
  IF p_permissions IS NOT NULL AND array_length(p_permissions, 1) > 0 THEN
    FOREACH v_perm_id IN ARRAY p_permissions
    LOOP
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_role_id, v_perm_id);
    END LOOP;
  END IF;

  RETURN v_role_id;
END;
$$;


ALTER FUNCTION "public"."rpc_create_role"("p_name" "text", "p_description" "text", "p_color" "text", "p_permissions" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_create_task"("p_title" "text", "p_description" "text" DEFAULT NULL::"text", "p_priority" "text" DEFAULT 'medium'::"text", "p_due_date" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_pipeline_id" "uuid" DEFAULT NULL::"uuid", "p_project_id" "uuid" DEFAULT NULL::"uuid", "p_manager_id" "uuid" DEFAULT NULL::"uuid", "p_category" "text" DEFAULT NULL::"text", "p_weight" bigint DEFAULT 1, "p_visibility_permission" "text" DEFAULT NULL::"text", "p_start_date" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_estimated_hours" numeric DEFAULT NULL::numeric) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_task_id           UUID;
  v_company_id        UUID;
  v_user_id           UUID := auth.uid();
  v_initial_stage     UUID;
  v_initial_name      TEXT;
  v_resolved_pipeline UUID;
BEGIN
  v_company_id := public.my_company_id();

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('task.create')
    OR public.has_permission('system.view_all_data')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create tasks';
  END IF;

  PERFORM public._rate_limit('create_task', 60);

  v_resolved_pipeline := p_pipeline_id;

  IF v_resolved_pipeline IS NULL AND p_project_id IS NOT NULL THEN
    SELECT pipeline_id INTO v_resolved_pipeline
    FROM   public.projects
    WHERE  id = p_project_id AND company_id = v_company_id;
  END IF;

  IF v_resolved_pipeline IS NULL THEN
    SELECT id INTO v_resolved_pipeline
    FROM   public.pipelines
    WHERE  company_id = v_company_id AND is_default = TRUE AND deleted_at IS NULL
    LIMIT  1;
  END IF;

  IF v_resolved_pipeline IS NOT NULL THEN
    SELECT id, name INTO v_initial_stage, v_initial_name
    FROM   public.pipeline_stages
    WHERE  pipeline_id = v_resolved_pipeline AND is_initial = TRUE
    LIMIT  1;
  END IF;

  INSERT INTO public.tasks (
    company_id, title, description, priority, due_date,
    created_by, manager_id, project_id,
    pipeline_id, current_stage_id,
    status, category, weight,
    visibility_permission, start_date, estimated_hours
  ) VALUES (
    v_company_id, p_title, p_description, p_priority, p_due_date,
    v_user_id, COALESCE(p_manager_id, v_user_id), p_project_id,
    v_resolved_pipeline, v_initial_stage,
    COALESCE(v_initial_name, 'open'), p_category, LEAST(10, GREATEST(1, COALESCE(p_weight, 1))),
    p_visibility_permission, p_start_date, p_estimated_hours
  ) RETURNING id INTO v_task_id;

  IF v_initial_stage IS NOT NULL THEN
    INSERT INTO public.pipeline_stage_history (
      task_id, company_id, pipeline_id,
      from_stage_id, to_stage_id,
      transitioned_by, from_stage_name, to_stage_name
    ) VALUES (
      v_task_id, v_company_id, v_resolved_pipeline,
      NULL, v_initial_stage,
      v_user_id, NULL, v_initial_name
    );
  END IF;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'task', v_task_id, 'task.created',
    jsonb_build_object(
      'title',                 p_title,
      'priority',              p_priority,
      'pipeline',              v_resolved_pipeline,
      'visibility_permission', p_visibility_permission,
      'start_date',            p_start_date,
      'estimated_hours',       p_estimated_hours
    )
  );

  RETURN v_task_id;
END;
$$;


ALTER FUNCTION "public"."rpc_create_task"("p_title" "text", "p_description" "text", "p_priority" "text", "p_due_date" timestamp with time zone, "p_pipeline_id" "uuid", "p_project_id" "uuid", "p_manager_id" "uuid", "p_category" "text", "p_weight" bigint, "p_visibility_permission" "text", "p_start_date" timestamp with time zone, "p_estimated_hours" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_create_team"("p_name" "text", "p_description" "text", "p_color" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_team_id uuid;
  v_company_id uuid;
BEGIN
  v_company_id := my_company_id();
  
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'User has no company association';
  END IF;

  INSERT INTO teams (
    company_id,
    name,
    description,
    color,
    created_by
  )
  VALUES (
    v_company_id,
    p_name,
    p_description,
    p_color,
    auth.uid()
  )
  RETURNING id INTO v_team_id;

  RETURN v_team_id;
END;
$$;


ALTER FUNCTION "public"."rpc_create_team"("p_name" "text", "p_description" "text", "p_color" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_delete_automation"("p_automation_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
BEGIN
  SELECT p.company_id INTO v_company_id
  FROM public.pipeline_automations a
  JOIN public.pipelines p ON p.id = a.pipeline_id
  WHERE a.id = p_automation_id;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Automation not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- Params cascade via FK
  DELETE FROM public.pipeline_automations WHERE id = p_automation_id;
END;
$$;


ALTER FUNCTION "public"."rpc_delete_automation"("p_automation_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_delete_automation"("p_automation_id" "uuid") IS 'Deletes an automation rule and its params.';



CREATE OR REPLACE FUNCTION "public"."rpc_delete_company"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_is_owner    BOOLEAN;
BEGIN
  -- Get user info
  SELECT company_id, is_owner INTO v_company_id, v_is_owner 
  FROM public.users WHERE id = v_user_id;

  -- Security check
  IF v_company_id IS NULL OR v_is_owner IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized. Only workspace owners can disband the workspace.';
  END IF;

  -- 1. Soft delete the company
  UPDATE public.companies 
  SET    deleted_at = NOW(),
         updated_at = NOW()
  WHERE  id = v_company_id;

  -- 2. Unlink ALL users from this company (Disbanding)
  UPDATE public.users 
  SET    company_id = NULL,
         is_owner   = FALSE
  WHERE  company_id = v_company_id;

  -- 3. Clean up roles for all users in that company
  DELETE FROM public.user_roles 
  WHERE company_id = v_company_id;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."rpc_delete_company"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_delete_linked_outcome"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
BEGIN
  v_company_id := public.my_company_id();

  DELETE FROM public.pipeline_linked_outcomes
  WHERE id = p_id AND company_id = v_company_id;
END;
$$;


ALTER FUNCTION "public"."rpc_delete_linked_outcome"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_delete_notification_rule"("p_rule_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.notification_rules
  WHERE id = p_rule_id;
END;
$$;


ALTER FUNCTION "public"."rpc_delete_notification_rule"("p_rule_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_delete_pipeline"("p_pipeline_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_blocker    RECORD;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.pipelines
  WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.delete')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- #158: same active-timer guard rpc_archive_task uses, applied board-wide.
  SELECT COALESCE(u.display_name, u.full_name, u.email, 'Someone') AS who,
         t.title AS task_title
    INTO v_blocker
    FROM public.task_work_sessions ws
    JOIN public.tasks t  ON t.id = ws.task_id
    LEFT JOIN public.users u ON u.id = ws.user_id
   WHERE t.pipeline_id = p_pipeline_id
     AND t.deleted_at IS NULL
     AND ws.status = 'active'
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Concurrency Lock: % has an active timer on "%". Stop it before deleting this board.',
      v_blocker.who, v_blocker.task_title;
  END IF;

  UPDATE public.tasks
  SET deleted_at = NOW()
  WHERE pipeline_id = p_pipeline_id AND deleted_at IS NULL;

  UPDATE public.pipelines
  SET deleted_at = NOW(), is_default = FALSE, updated_at = NOW()
  WHERE id = p_pipeline_id;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'pipeline', p_pipeline_id, 'pipeline.deleted',
    jsonb_build_object('pipeline_id', p_pipeline_id)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_delete_pipeline"("p_pipeline_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_delete_pipeline"("p_pipeline_id" "uuid") IS 'Soft-deletes a pipeline. Blocks if active tasks exist.';



CREATE OR REPLACE FUNCTION "public"."rpc_delete_stage"("p_stage_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id  UUID;
  v_pipeline_id UUID;
  v_user_id     UUID := auth.uid();
  v_task_count  INTEGER;
BEGIN
  SELECT p.company_id, ps.pipeline_id INTO v_company_id, v_pipeline_id
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id
  WHERE ps.id = p_stage_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Stage not found';
  END IF;
  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- Block if tasks are in this stage
  SELECT COUNT(*) INTO v_task_count
  FROM public.tasks
  WHERE current_stage_id = p_stage_id AND deleted_at IS NULL;

  IF v_task_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete stage with % active tasks', v_task_count;
  END IF;

  -- Cascade deletes transitions via FK, then delete stage
  DELETE FROM public.pipeline_stages WHERE id = p_stage_id;

  -- Reorder remaining stages
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS new_pos
    FROM public.pipeline_stages
    WHERE pipeline_id = v_pipeline_id
  )
  UPDATE public.pipeline_stages ps
  SET position = r.new_pos
  FROM ranked r
  WHERE ps.id = r.id;
END;
$$;


ALTER FUNCTION "public"."rpc_delete_stage"("p_stage_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_delete_stage"("p_stage_id" "uuid") IS 'Deletes a stage and reorders remaining. Blocks if tasks exist.';



CREATE OR REPLACE FUNCTION "public"."rpc_delete_stage_action"("p_action_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to edit pipeline actions';
  END IF;

  DELETE FROM public.pipeline_stage_actions WHERE id = p_action_id;
END;
$$;


ALTER FUNCTION "public"."rpc_delete_stage_action"("p_action_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_delete_submission"("p_submission_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_submission   RECORD;
  v_caller_id    UUID := auth.uid();
  v_manager_id   UUID;
  v_deleter_name TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT submitted_by, task_id, company_id INTO v_submission
  FROM   public.task_submissions
  WHERE  id = p_submission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'submission not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_submission.submitted_by <> v_caller_id
    AND NOT has_permission('tasks.manage')
    AND NOT (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_caller_id)
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- Soft delete: attachments + storage bytes intentionally kept for recovery (B2)
  UPDATE public.task_submissions
  SET    deleted_at = now(), deleted_by = v_caller_id
  WHERE  id = p_submission_id AND deleted_at IS NULL;

  IF FOUND THEN
    PERFORM public.log_event(
      v_submission.company_id, v_caller_id, 'task', v_submission.task_id,
      'task.submission_deleted', jsonb_build_object('submission_id', p_submission_id)
    );

    -- Notify the task manager (actor is auto-excluded by the dispatcher)
    SELECT manager_id INTO v_manager_id FROM public.tasks WHERE id = v_submission.task_id;
    IF v_manager_id IS NOT NULL THEN
      SELECT full_name INTO v_deleter_name FROM public.users WHERE id = v_caller_id;
      PERFORM public.fn_emit_notification_event(
        'task.submission_deleted', 'task', v_submission.task_id, v_caller_id,
        jsonb_build_object(
          'submission_id',   p_submission_id,
          'task_id',         v_submission.task_id,
          'manager_id',      v_manager_id,
          'deleted_by_name', v_deleter_name
        )
      );
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_delete_submission"("p_submission_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_delete_task_attachment"("p_attachment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_att       RECORD;
  v_task      RECORD;
  v_caller_id UUID := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, task_id, company_id, file_name, deleted_at
  INTO   v_att
  FROM   public.task_attachments
  WHERE  id = p_attachment_id
  FOR UPDATE;

  IF NOT FOUND OR v_att.company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'attachment not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_att.deleted_at IS NOT NULL THEN
    RETURN; -- already deleted: no-op
  END IF;

  SELECT created_by, manager_id INTO v_task
  FROM   public.tasks WHERE id = v_att.task_id;

  IF v_task.created_by <> v_caller_id
    AND (v_task.manager_id IS NULL OR v_task.manager_id <> v_caller_id)
    AND NOT has_permission('tasks.manage')
    AND NOT (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_caller_id)
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- Storage bytes intentionally kept — that's what makes recovery possible.
  UPDATE public.task_attachments
  SET    deleted_at = now(), deleted_by = v_caller_id
  WHERE  id = p_attachment_id AND deleted_at IS NULL;

  PERFORM public.log_event(
    v_att.company_id, v_caller_id, 'task', v_att.task_id,
    'task.attachment_deleted',
    jsonb_build_object('attachment_id', p_attachment_id, 'file_name', v_att.file_name)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_delete_task_attachment"("p_attachment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_delete_task_comment"("p_comment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_author_id  UUID;
  v_company_id UUID;
  v_task_id    UUID;
BEGIN
  SELECT author_id, company_id, task_id INTO v_author_id, v_company_id, v_task_id
  FROM public.task_comments WHERE id = p_comment_id AND deleted_at IS NULL;

  IF v_author_id IS NULL THEN
    RAISE EXCEPTION 'Comment not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Only author or owner can delete
  IF v_author_id != v_user_id AND NOT ((SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE) THEN
    RAISE EXCEPTION 'Only the comment author or company owner can delete comments';
  END IF;

  UPDATE public.task_comments SET deleted_at = now() WHERE id = p_comment_id;

  PERFORM public.log_event(v_company_id, v_user_id, 'task', v_task_id, 'task.comment_deleted', jsonb_build_object('comment_id', p_comment_id));
END;
$$;


ALTER FUNCTION "public"."rpc_delete_task_comment"("p_comment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_delete_transition"("p_transition_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Cascade-delete all actions linked to this transition
  DELETE FROM public.pipeline_stage_actions
  WHERE transition_id = p_transition_id;

  -- Delete the transition itself
  DELETE FROM public.pipeline_stage_transitions
  WHERE id = p_transition_id;
END;
$$;


ALTER FUNCTION "public"."rpc_delete_transition"("p_transition_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_delete_transition"("p_transition_id" "uuid") IS 'Removes a transition edge.';



CREATE OR REPLACE FUNCTION "public"."rpc_edit_submission"("p_submission_id" "uuid", "p_content" "text", "p_kept_attachment_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_new_attachments" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

  -- Kept attachments: pointer copy onto the new version — same storage_path, no re-upload.
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
  -- reviewed_by/reviewed_at/review_notes intentionally kept — they belong to
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
$$;


ALTER FUNCTION "public"."rpc_edit_submission"("p_submission_id" "uuid", "p_content" "text", "p_kept_attachment_ids" "uuid"[], "p_new_attachments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_execute_stage_action"("p_task_id" "uuid", "p_action_id" "uuid", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id              UUID    := auth.uid();
    v_company_id           UUID;
    v_task                 RECORD;
    v_action               RECORD;
    v_is_owner             BOOLEAN;
    v_is_assigned          BOOLEAN;
    v_is_manager           BOOLEAN;
    v_is_creator           BOOLEAN;
    v_sub_id               UUID;
    v_assignment_id        UUID;
    v_stage_requires_timer BOOLEAN;
    v_stage_is_initial     BOOLEAN;
    v_min_timer_seconds    INTEGER;
    v_total_seconds        INTEGER;
    v_manual_entry_status  TEXT;
    v_is_advancement       BOOLEAN;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
    IF v_task IS NULL THEN RAISE EXCEPTION 'Task not found or deleted'; END IF;

    v_company_id := v_task.company_id;
    IF v_company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized: task belongs to a different company';
    END IF;

    SELECT * INTO v_action FROM public.pipeline_stage_actions WHERE id = p_action_id AND is_active = TRUE;
    IF v_action IS NULL THEN RAISE EXCEPTION 'Action not found or inactive'; END IF;
    IF v_action.stage_id != v_task.current_stage_id THEN
        RAISE EXCEPTION 'Action does not belong to the task''s current stage';
    END IF;

    v_is_owner   := (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE;
    v_is_creator := v_task.created_by = v_user_id;
    v_is_manager := v_task.manager_id = v_user_id;

    SELECT id INTO v_assignment_id
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND (
        assignee_user_id = v_user_id
        OR assignee_team_id IN (
            SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
        )
      )
    LIMIT 1;
    v_is_assigned := v_assignment_id IS NOT NULL;

    IF NOT v_is_owner THEN
        CASE v_action.required_role
            WHEN 'any'      THEN NULL;
            WHEN 'assignee' THEN IF NOT v_is_assigned THEN RAISE EXCEPTION 'Only assigned users can perform this action'; END IF;
            WHEN 'manager'  THEN IF NOT v_is_manager  THEN RAISE EXCEPTION 'Only the task manager can perform this action'; END IF;
            WHEN 'reviewer' THEN
                IF NOT (v_is_manager OR public.has_permission('submission.review')) THEN
                    RAISE EXCEPTION 'Only reviewers can perform this action';
                END IF;
            WHEN 'creator'  THEN IF NOT v_is_creator  THEN RAISE EXCEPTION 'Only the task creator can perform this action'; END IF;
            ELSE IF NOT public.has_permission(v_action.required_role) THEN
                RAISE EXCEPTION 'Missing required permission: %', v_action.required_role;
            END IF;
        END CASE;
    END IF;

    IF v_action.precondition IS NOT NULL THEN
        CASE v_action.precondition
            WHEN 'has_pending_submission' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending') THEN
                    RAISE EXCEPTION 'Precondition failed: no pending submission exists';
                END IF;
            WHEN 'no_pending_submission' THEN
                IF EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending') THEN
                    RAISE EXCEPTION 'Precondition failed: a pending submission already exists';
                END IF;
            WHEN 'is_assigned' THEN
                IF NOT v_is_assigned THEN RAISE EXCEPTION 'Precondition failed: you must be assigned to this task'; END IF;
            WHEN 'has_approved_submission' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'approved') THEN
                    RAISE EXCEPTION 'Precondition failed: no approved submission exists';
                END IF;
            WHEN 'has_attachment' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_attachments WHERE task_id = p_task_id) THEN
                    RAISE EXCEPTION 'Precondition failed: task has no attachments';
                END IF;
            WHEN 'all_subtasks_complete' THEN
                IF EXISTS (
                    SELECT 1 FROM public.tasks child
                    WHERE child.parent_task_id = p_task_id AND child.deleted_at IS NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM public.pipeline_stages ps
                          WHERE ps.id = child.current_stage_id AND ps.is_terminal = TRUE AND ps.terminal_type = 'success'
                      )
                ) THEN
                    RAISE EXCEPTION 'Precondition failed: not all subtasks are completed';
                END IF;
            ELSE NULL;
        END CASE;
    END IF;

    -- Timer gate fires ONLY on advancement actions (not submissions, not reviews).
    -- Advancement = action_type 'advance', 'custom', or 'start_task' (these
    -- directly call rpc_advance_stage). Submit_work just persists evidence;
    -- review actions are the reviewer's path.
    v_is_advancement := v_action.action_type IN ('advance', 'custom', 'start_task');

    SELECT COALESCE(ps.requires_timer, false),
           COALESCE(ps.is_initial, false),
           COALESCE(ps.min_timer_seconds, 300)
    INTO v_stage_requires_timer, v_stage_is_initial, v_min_timer_seconds
    FROM public.pipeline_stages ps WHERE ps.id = v_task.current_stage_id;

    IF v_stage_requires_timer
       AND NOT v_stage_is_initial
       AND v_is_assigned
       AND v_min_timer_seconds > 0
       AND v_is_advancement
    THEN
        SELECT COALESCE(SUM(
            CASE
                WHEN status = 'completed' THEN COALESCE(total_seconds_spent, 0)
                WHEN status = 'active'    THEN EXTRACT(EPOCH FROM (now() - started_at))::INTEGER
                ELSE 0
            END
        ), 0) INTO v_total_seconds
        FROM public.task_work_sessions
        WHERE task_id  = p_task_id
          AND user_id  = v_user_id
          AND stage_id = v_task.current_stage_id;

        IF v_total_seconds < v_min_timer_seconds THEN
            SELECT approval_status INTO v_manual_entry_status
            FROM public.task_manual_time_entries
            WHERE task_id = p_task_id AND stage_id = v_task.current_stage_id AND user_id = v_user_id
            ORDER BY logged_at DESC
            LIMIT 1;

            IF v_manual_entry_status IS NULL OR v_manual_entry_status = 'rejected' THEN
                RAISE EXCEPTION 'LOW_TIMER_TIME: Less than the required minimum time was logged for this stage. Please declare your actual work hours before proceeding.'
                USING ERRCODE = 'P0001';
            ELSIF v_manual_entry_status = 'pending' THEN
                RAISE EXCEPTION 'TIME_APPROVAL_PENDING: Your time declaration is awaiting manager approval. The stage will advance automatically once approved.'
                USING ERRCODE = 'P0001';
            END IF;
        END IF;
    END IF;

    CASE v_action.action_type
        WHEN 'start_task' THEN
            IF v_action.transition_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'start_task');

        WHEN 'submit_work' THEN
            v_sub_id := public.rpc_submit_work(p_task_id, COALESCE(p_payload->>'content', ''),
                v_assignment_id, v_action.transition_id, COALESCE(p_payload->'attachments', '[]'::jsonb));
            RETURN jsonb_build_object('success', true, 'action', 'submit_work', 'submission_id', v_sub_id);

        WHEN 'advance' THEN
            IF v_action.transition_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'advance');

        WHEN 'review_approve' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'approved', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_approve');

        WHEN 'review_reject' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'rejected', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_reject');

        WHEN 'review_revise' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'needs_revision', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_revise');

        WHEN 'start_timer' THEN
            INSERT INTO public.task_work_sessions (task_id, user_id, company_id, stage_id, status)
            VALUES (p_task_id, v_user_id, v_company_id, v_task.current_stage_id, 'active') ON CONFLICT DO NOTHING;
            PERFORM public.log_event(v_company_id, v_user_id, 'task', p_task_id, 'task.timer_started',
                jsonb_build_object('action_id', p_action_id));
            RETURN jsonb_build_object('success', true, 'action', 'start_timer');

        WHEN 'assign_user' THEN
            IF p_payload->>'assign_user_id' IS NOT NULL THEN
                INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
                VALUES (p_task_id, v_company_id, (p_payload->>'assign_user_id')::UUID, v_user_id)
                ON CONFLICT DO NOTHING;
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'assign_user');

        WHEN 'custom' THEN
            IF v_action.transition_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'custom');

        ELSE RAISE EXCEPTION 'Unknown action type: %', v_action.action_type;
    END CASE;
END;
$$;


ALTER FUNCTION "public"."rpc_execute_stage_action"("p_task_id" "uuid", "p_action_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_all_tags"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_rows JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object('tag', tag, 'count', cnt)
        ORDER BY cnt DESC, tag ASC
    ), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT t AS tag, COUNT(*)::int AS cnt
        FROM public.filehub_files f, unnest(f.tags) t
        WHERE f.deleted_at IS NULL AND f.company_id = public.my_company_id()
        GROUP BY t
    ) sub;
    RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_all_tags"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_analytics"("p_days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id    UUID := public.my_company_id();
    v_since         TIMESTAMPTZ;
    v_totals        JSONB;
    v_top_senders   JSONB;
    v_top_receivers JSONB;
    v_channels      JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view File Hub analytics.';
    END IF;

    v_since := CASE
        WHEN p_days IS NULL OR p_days <= 0 THEN NULL
        ELSE now() - make_interval(days => p_days)
    END;

    SELECT jsonb_build_object(
        'files_sent',      COUNT(*),
        'total_bytes',     COALESCE(SUM(f.size_bytes), 0),
        'direct_files',    COUNT(*) FILTER (WHERE f.visibility = 'direct'),
        'broadcast_files', COUNT(*) FILTER (WHERE f.visibility = 'broadcast'),
        'group_files',     COUNT(*) FILTER (WHERE f.visibility = 'group')
    )
    INTO v_totals
    FROM public.filehub_files f
    WHERE f.company_id = v_company_id
      AND f.deleted_at IS NULL
      AND f.visibility <> 'task'
      AND (v_since IS NULL OR f.created_at >= v_since);

    SELECT v_totals || jsonb_build_object(
        'recipients_reached', COUNT(DISTINCT r.user_id),
        'read_rate', CASE
            WHEN COUNT(*) = 0 THEN NULL
            ELSE ROUND(COUNT(*) FILTER (WHERE r.read_at IS NOT NULL)::numeric / COUNT(*), 3)
        END
    )
    INTO v_totals
    FROM public.filehub_recipients r
    JOIN public.filehub_files f ON f.id = r.file_id
    WHERE f.company_id = v_company_id
      AND f.deleted_at IS NULL
      AND (v_since IS NULL OR f.created_at >= v_since);

    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_top_senders
    FROM (
        SELECT
            jsonb_build_object(
                'user_id',    u.id,
                'full_name',  u.full_name,
                'avatar_url', u.avatar_url,
                'files',      COUNT(*),
                'bytes',      COALESCE(SUM(f.size_bytes), 0)
            ) AS row,
            COUNT(*)                       AS files,
            COALESCE(SUM(f.size_bytes), 0) AS bytes
        FROM public.filehub_files f
        JOIN public.users u ON u.id = f.uploaded_by
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility <> 'task'
          AND (v_since IS NULL OR f.created_at >= v_since)
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY files DESC, bytes DESC
        LIMIT 5
    ) t;

    WITH receipts AS (
        SELECT r.user_id, f.size_bytes
        FROM public.filehub_recipients r
        JOIN public.filehub_files f ON f.id = r.file_id
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility = 'direct'
          AND (v_since IS NULL OR f.created_at >= v_since)
        UNION ALL
        SELECT gm.user_id, f.size_bytes
        FROM public.filehub_files f
        JOIN public.filehub_group_members gm ON gm.group_id = f.group_id
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility = 'group'
          AND gm.user_id <> f.uploaded_by
          AND (v_since IS NULL OR f.created_at >= v_since)
    )
    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_top_receivers
    FROM (
        SELECT
            jsonb_build_object(
                'user_id',        u.id,
                'full_name',      u.full_name,
                'avatar_url',     u.avatar_url,
                'files_received', COUNT(*),
                'bytes',          COALESCE(SUM(rc.size_bytes), 0)
            ) AS row,
            COUNT(*)                        AS files,
            COALESCE(SUM(rc.size_bytes), 0) AS bytes
        FROM receipts rc
        JOIN public.users u ON u.id = rc.user_id
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY files DESC, bytes DESC
        LIMIT 5
    ) t;

    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_channels
    FROM (
        SELECT
            jsonb_build_object(
                'channel', c.label,
                'kind',    c.kind,
                'files',   c.files,
                'bytes',   c.bytes
            ) AS row,
            c.files,
            c.bytes
        FROM (
            SELECT 'Direct Messages'::text AS label, 'direct'::text AS kind,
                   COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes
            FROM public.filehub_files
            WHERE company_id = v_company_id AND deleted_at IS NULL AND visibility = 'direct'
              AND (v_since IS NULL OR created_at >= v_since)
            HAVING COUNT(*) > 0
            UNION ALL
            SELECT 'Company Broadcast', 'broadcast',
                   COUNT(*), COALESCE(SUM(size_bytes), 0)
            FROM public.filehub_files
            WHERE company_id = v_company_id AND deleted_at IS NULL AND visibility = 'broadcast'
              AND (v_since IS NULL OR created_at >= v_since)
            HAVING COUNT(*) > 0
            UNION ALL
            SELECT g.name, 'group',
                   COUNT(*), COALESCE(SUM(f.size_bytes), 0)
            FROM public.filehub_files f
            JOIN public.filehub_groups g ON g.id = f.group_id
            WHERE f.company_id = v_company_id AND f.deleted_at IS NULL AND f.visibility = 'group'
              AND (v_since IS NULL OR f.created_at >= v_since)
            GROUP BY g.id, g.name
        ) c
        ORDER BY c.files DESC, c.bytes DESC
        LIMIT 12
    ) t;

    RETURN jsonb_build_object(
        'range_days',    COALESCE(p_days, 0),
        'generated_at',  now(),
        'totals',        COALESCE(v_totals, '{}'::jsonb),
        'top_senders',   COALESCE(v_top_senders, '[]'::jsonb),
        'top_receivers', COALESCE(v_top_receivers, '[]'::jsonb),
        'channels',      COALESCE(v_channels, '[]'::jsonb)
    );
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_analytics"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_analytics"("p_from" "date", "p_to" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id    UUID := public.my_company_id();
    v_since         TIMESTAMPTZ := p_from::timestamptz;
    v_until         TIMESTAMPTZ := (p_to + 1)::timestamptz;
    v_totals        JSONB;
    v_top_senders   JSONB;
    v_top_receivers JSONB;
    v_channels      JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view File Hub analytics.';
    END IF;

    SELECT jsonb_build_object(
        'files_sent',      COUNT(*),
        'total_bytes',     COALESCE(SUM(f.size_bytes), 0),
        'direct_files',    COUNT(*) FILTER (WHERE f.visibility = 'direct'),
        'broadcast_files', COUNT(*) FILTER (WHERE f.visibility = 'broadcast'),
        'group_files',     COUNT(*) FILTER (WHERE f.visibility = 'group')
    )
    INTO v_totals
    FROM public.filehub_files f
    WHERE f.company_id = v_company_id
      AND f.deleted_at IS NULL
      AND f.visibility <> 'task'
      AND f.created_at >= v_since AND f.created_at < v_until;

    SELECT v_totals || jsonb_build_object(
        'recipients_reached', COUNT(DISTINCT r.user_id),
        'read_rate', CASE
            WHEN COUNT(*) = 0 THEN NULL
            ELSE ROUND(COUNT(*) FILTER (WHERE r.read_at IS NOT NULL)::numeric / COUNT(*), 3)
        END
    )
    INTO v_totals
    FROM public.filehub_recipients r
    JOIN public.filehub_files f ON f.id = r.file_id
    WHERE f.company_id = v_company_id
      AND f.deleted_at IS NULL
      AND f.created_at >= v_since AND f.created_at < v_until;

    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_top_senders
    FROM (
        SELECT
            jsonb_build_object(
                'user_id',    u.id,
                'full_name',  u.full_name,
                'avatar_url', u.avatar_url,
                'files',      COUNT(*),
                'bytes',      COALESCE(SUM(f.size_bytes), 0)
            ) AS row,
            COUNT(*)                       AS files,
            COALESCE(SUM(f.size_bytes), 0) AS bytes
        FROM public.filehub_files f
        JOIN public.users u ON u.id = f.uploaded_by
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility <> 'task'
          AND f.created_at >= v_since AND f.created_at < v_until
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY files DESC, bytes DESC
        LIMIT 5
    ) t;

    WITH receipts AS (
        SELECT r.user_id, f.size_bytes
        FROM public.filehub_recipients r
        JOIN public.filehub_files f ON f.id = r.file_id
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility = 'direct'
          AND f.created_at >= v_since AND f.created_at < v_until
        UNION ALL
        SELECT gm.user_id, f.size_bytes
        FROM public.filehub_files f
        JOIN public.filehub_group_members gm ON gm.group_id = f.group_id
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility = 'group'
          AND gm.user_id <> f.uploaded_by
          AND f.created_at >= v_since AND f.created_at < v_until
    )
    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_top_receivers
    FROM (
        SELECT
            jsonb_build_object(
                'user_id',        u.id,
                'full_name',      u.full_name,
                'avatar_url',     u.avatar_url,
                'files_received', COUNT(*),
                'bytes',          COALESCE(SUM(rc.size_bytes), 0)
            ) AS row,
            COUNT(*)                        AS files,
            COALESCE(SUM(rc.size_bytes), 0) AS bytes
        FROM receipts rc
        JOIN public.users u ON u.id = rc.user_id
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY files DESC, bytes DESC
        LIMIT 5
    ) t;

    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_channels
    FROM (
        SELECT
            jsonb_build_object(
                'channel', c.label,
                'kind',    c.kind,
                'files',   c.files,
                'bytes',   c.bytes
            ) AS row,
            c.files,
            c.bytes
        FROM (
            SELECT 'Direct Messages'::text AS label, 'direct'::text AS kind,
                   COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes
            FROM public.filehub_files
            WHERE company_id = v_company_id AND deleted_at IS NULL AND visibility = 'direct'
              AND created_at >= v_since AND created_at < v_until
            HAVING COUNT(*) > 0

            UNION ALL
            SELECT 'Company Broadcast', 'broadcast',
                   COUNT(*), COALESCE(SUM(size_bytes), 0)
            FROM public.filehub_files
            WHERE company_id = v_company_id AND deleted_at IS NULL AND visibility = 'broadcast'
              AND created_at >= v_since AND created_at < v_until
            HAVING COUNT(*) > 0

            UNION ALL
            SELECT g.name, 'group',
                   COUNT(*), COALESCE(SUM(f.size_bytes), 0)
            FROM public.filehub_files f
            JOIN public.filehub_groups g ON g.id = f.group_id
            WHERE f.company_id = v_company_id AND f.deleted_at IS NULL AND f.visibility = 'group'
              AND f.created_at >= v_since AND f.created_at < v_until
            GROUP BY g.id, g.name
        ) c
        ORDER BY c.files DESC, c.bytes DESC
        LIMIT 12
    ) t;

    RETURN jsonb_build_object(
        'range_days',    (p_to - p_from) + 1,
        'generated_at',  now(),
        'totals',        COALESCE(v_totals, '{}'::jsonb),
        'top_senders',   COALESCE(v_top_senders, '[]'::jsonb),
        'top_receivers', COALESCE(v_top_receivers, '[]'::jsonb),
        'channels',      COALESCE(v_channels, '[]'::jsonb)
    );
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_analytics"("p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_bin_empty_authorize"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
BEGIN
    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'No company context';
    END IF;

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('filehub:bin_empty')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to empty the Bin.';
    END IF;

    RETURN v_company_id;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_bin_empty_authorize"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_bin_list"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
    v_rows       JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view File Hub.';
    END IF;

    SELECT COALESCE(jsonb_agg(row_payload ORDER BY trashed_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT
            f.deleted_at AS trashed_at,
            jsonb_build_object(
                'id',            f.id,
                'item_type',     'file',
                'original_name', f.original_name,
                'mime_type',     f.mime_type,
                'size_bytes',    f.size_bytes,
                'caption',       f.caption,
                'visibility',    f.visibility,
                'storage_path',  f.storage_path,
                'bucket',        f.bucket,
                'tags',          f.tags,
                'created_at',    f.created_at,
                'folder',        CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader',      jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url),
                'trash_type',    'deleted',
                'trashed_at',    f.deleted_at,
                'expires_at',    f.deleted_at + interval '15 days'
            ) AS row_payload
        FROM public.filehub_files f
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        LEFT JOIN public.users u            ON u.id  = f.uploaded_by
        WHERE f.company_id   = v_company_id
          AND f.uploaded_by  = v_user_id
          AND f.deleted_at IS NOT NULL
          AND f.deleted_at  > now() - interval '15 days'
          AND f.visibility <> 'task'

        UNION ALL

        SELECT
            r.archived_at AS trashed_at,
            jsonb_build_object(
                'id',            f.id,
                'item_type',     'file',
                'original_name', f.original_name,
                'mime_type',     f.mime_type,
                'size_bytes',    f.size_bytes,
                'caption',       f.caption,
                'visibility',    f.visibility,
                'storage_path',  f.storage_path,
                'bucket',        f.bucket,
                'tags',          f.tags,
                'created_at',    f.created_at,
                'folder',        CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader',      jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url),
                'trash_type',    'hidden',
                'trashed_at',    r.archived_at,
                'expires_at',    r.archived_at + interval '15 days'
            ) AS row_payload
        FROM public.filehub_recipients r
        JOIN public.filehub_files f         ON f.id = r.file_id
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        LEFT JOIN public.users u            ON u.id  = f.uploaded_by
        WHERE r.user_id = v_user_id
          AND r.archived_at IS NOT NULL
          AND r.archived_at  > now() - interval '15 days'
          AND f.company_id  = v_company_id

        UNION ALL

        SELECT
            fo.deleted_at AS trashed_at,
            jsonb_build_object(
                'id',            fo.id,
                'item_type',     'folder',
                'original_name', fo.name,
                'mime_type',     NULL,
                'size_bytes',    0,
                'caption',       NULL,
                'visibility',    NULL,
                'storage_path',  NULL,
                'bucket',        NULL,
                'tags',          '{}'::text[],
                'created_at',    fo.created_at,
                'folder',        CASE WHEN fo.parent_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', p.id, 'name', p.name) END,
                'uploader',      jsonb_build_object('id', cu.id, 'full_name', cu.full_name, 'avatar_url', cu.avatar_url),
                'trash_type',    'deleted',
                'trashed_at',    fo.deleted_at,
                'expires_at',    fo.deleted_at + interval '15 days'
            ) AS row_payload
        FROM public.filehub_folders fo
        LEFT JOIN public.filehub_folders p ON p.id = fo.parent_id
        LEFT JOIN public.users cu          ON cu.id = fo.created_by
        WHERE fo.company_id = v_company_id
          AND fo.deleted_at IS NOT NULL
          AND fo.deleted_at > now() - interval '15 days'
    ) src;

    RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_bin_list"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_browse"("p_query" "text" DEFAULT NULL::"text", "p_sources" "text"[] DEFAULT NULL::"text"[], "p_project_id" "uuid" DEFAULT NULL::"uuid", "p_category" "text" DEFAULT NULL::"text", "p_type" "text" DEFAULT NULL::"text", "p_before" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 60, "p_file_id" "uuid" DEFAULT NULL::"uuid", "p_include_facets" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company uuid := public.my_company_id();
  v_q       text := trim(COALESCE(p_query, ''));
  v_limit   int  := LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
  v_items   jsonb;
  v_facets  jsonb := NULL;
  v_pool    int;
BEGIN
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'has_more', false, 'facets', NULL);
  END IF;

  IF p_file_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT fi.source, fi.file_id, fi.bucket, fi.storage_path, fi.file_name,
             fi.mime_type, fi.size_bytes, fi.category, fi.uploaded_by, fi.created_at,
             fi.task_id, fi.submission_id, fi.folder_id, fi.group_id, fi.visibility,
             fi.project_id,
             (SELECT p.name FROM public.projects p WHERE p.id = fi.project_id) AS project_name,
             fi.task_category,
             CASE WHEN fi.task_id IS NOT NULL
                  THEN (SELECT t.title FROM public.tasks t WHERE t.id = fi.task_id) END AS task_title
      FROM public.files_index fi
      WHERE fi.company_id = v_company AND fi.file_id = p_file_id
        AND CASE WHEN fi.source = 'filehub' THEN public.filehub_file_accessible(fi.file_id)
                 ELSE public.fn_task_file_accessible(fi.task_id) END
    ) x;
    RETURN jsonb_build_object('items', v_items, 'has_more', false, 'facets', NULL);
  END IF;

  WITH pool AS (
    SELECT fi.*
    FROM public.files_index fi
    WHERE fi.company_id = v_company
      AND (p_sources IS NULL OR fi.source = ANY (p_sources))
      AND (p_project_id IS NULL OR fi.project_id = p_project_id)
      AND (p_category IS NULL OR fi.category = p_category OR fi.task_category = p_category)
      AND (p_type IS NULL OR public.file_mime_class(fi.mime_type) = p_type)
      AND (p_before IS NULL OR fi.created_at < p_before)
      AND (
        v_q = ''
        OR fi.file_name ILIKE '%' || v_q || '%'
        OR (fi.source = 'filehub' AND EXISTS (
          SELECT 1 FROM public.filehub_files ff
          WHERE ff.id = fi.file_id
            AND (ff.caption ILIKE '%' || v_q || '%'
                 OR array_to_string(ff.tags, ' ') ILIKE '%' || v_q || '%')
        ))
      )
    ORDER BY fi.created_at DESC
    LIMIT v_limit * 3
  ),
  acc AS (
    SELECT c.source, c.file_id, c.bucket, c.storage_path, c.file_name,
           c.mime_type, c.size_bytes, c.category, c.uploaded_by, c.created_at,
           c.task_id, c.submission_id, c.folder_id, c.group_id, c.visibility,
           c.project_id,
           (SELECT p.name FROM public.projects p WHERE p.id = c.project_id) AS project_name,
           c.task_category,
           CASE WHEN c.task_id IS NOT NULL
                THEN (SELECT t.title FROM public.tasks t WHERE t.id = c.task_id) END AS task_title
    FROM pool c
    WHERE CASE WHEN c.source = 'filehub' THEN public.filehub_file_accessible(c.file_id)
               ELSE public.fn_task_file_accessible(c.task_id) END
    ORDER BY c.created_at DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM acc a), '[]'::jsonb),
    (SELECT count(*) FROM pool)
  INTO v_items, v_pool;

  IF p_include_facets THEN
    WITH accessible AS (
      SELECT fi.*
      FROM public.files_index fi
      WHERE fi.company_id = v_company
        AND (p_sources IS NULL OR fi.source = ANY (p_sources))
        AND CASE WHEN fi.source = 'filehub' THEN public.filehub_file_accessible(fi.file_id)
                 ELSE public.fn_task_file_accessible(fi.task_id) END
    )
    SELECT jsonb_build_object(
      'projects', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pid, 'name', pname, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
        FROM (
          SELECT a.project_id AS pid,
                 (SELECT p.name FROM public.projects p WHERE p.id = a.project_id) AS pname,
                 count(*) AS cnt
          FROM accessible a
          WHERE a.project_id IS NOT NULL
          GROUP BY a.project_id
        ) pf
      ),
      'categories', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('category', cat, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
        FROM (
          SELECT COALESCE(a.task_category, a.category) AS cat, count(*) AS cnt
          FROM accessible a
          WHERE COALESCE(a.task_category, a.category) IS NOT NULL
          GROUP BY COALESCE(a.task_category, a.category)
        ) cf
      ),
      'types', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('type', typ, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
        FROM (
          SELECT public.file_mime_class(a.mime_type) AS typ, count(*) AS cnt
          FROM accessible a
          GROUP BY public.file_mime_class(a.mime_type)
        ) tf
      )
    ) INTO v_facets;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'has_more', v_pool >= v_limit * 3,
    'facets', v_facets
  );
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_browse"("p_query" "text", "p_sources" "text"[], "p_project_id" "uuid", "p_category" "text", "p_type" "text", "p_before" timestamp with time zone, "p_limit" integer, "p_file_id" "uuid", "p_include_facets" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_check_duplicate"("p_content_hash" "text", "p_folder_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_rows JSONB;
BEGIN
    IF p_content_hash IS NULL OR length(p_content_hash) = 0 THEN
        RETURN '[]'::jsonb;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',            f.id,
        'original_name', f.original_name,
        'size_bytes',    f.size_bytes,
        'created_at',    f.created_at,
        'uploader_name', u.full_name
    )), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_files f
    LEFT JOIN public.users u ON u.id = f.uploaded_by
    WHERE f.company_id = v_company_id
      AND f.content_hash = p_content_hash
      AND f.folder_id IS NOT DISTINCT FROM p_folder_id
      AND f.deleted_at IS NULL
    LIMIT 5;
    RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_check_duplicate"("p_content_hash" "text", "p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_check_name_conflict"("p_name" "text", "p_visibility" "text", "p_group_id" "uuid" DEFAULT NULL::"uuid", "p_folder_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_row        JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
        'id',            f.id,
        'original_name', f.original_name,
        'uploader_name', u.full_name,
        'size_bytes',    f.size_bytes,
        'created_at',    f.created_at
    )
    INTO v_row
    FROM public.filehub_files f
    LEFT JOIN public.users u ON u.id = f.uploaded_by
    WHERE f.deleted_at IS NULL
      AND f.company_id = v_company_id
      AND lower(trim(f.original_name)) = lower(trim(p_name))
      AND (
          (p_visibility = 'group'     AND f.visibility = 'group'
               AND f.group_id = p_group_id
               AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
          OR (p_visibility = 'broadcast' AND f.visibility = 'broadcast'
               AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
          OR (p_visibility = 'direct'    AND f.visibility = 'direct'
               AND f.uploaded_by = v_user_id
               AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
      )
    ORDER BY f.created_at DESC
    LIMIT 1;

    RETURN v_row;  -- NULL if no conflict
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_check_name_conflict"("p_name" "text", "p_visibility" "text", "p_group_id" "uuid", "p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_delete"("p_file_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
    UPDATE public.filehub_files
    SET deleted_at = now()
    WHERE id = p_file_id AND uploaded_by = v_user_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found or you are not the uploader.';
    END IF;
END; $$;


ALTER FUNCTION "public"."rpc_filehub_delete"("p_file_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_delete_tag"("p_tag" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_count INT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    UPDATE public.filehub_files
    SET tags = array_remove(tags, p_tag)
    WHERE company_id = public.my_company_id()
      AND deleted_at IS NULL
      AND p_tag = ANY(tags);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_delete_tag"("p_tag" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_file_activity"("p_file_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_rows JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',         a.id,
            'action',     a.action,
            'metadata',   a.metadata,
            'created_at', a.created_at,
            'user',       jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url)
        ) ORDER BY a.created_at DESC
    ), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_activity a
    JOIN public.users u ON u.id = a.user_id
    WHERE a.file_id = p_file_id AND a.company_id = public.my_company_id();
    RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_file_activity"("p_file_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_file_move"("p_file_id" "uuid", "p_folder_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id     UUID := public.my_company_id();
    v_user_id        UUID := auth.uid();
    v_visibility     TEXT;
    v_group_id       UUID;
    v_uploaded_by    UUID;
    v_expected_scope TEXT;
BEGIN
    SELECT visibility, group_id, uploaded_by INTO v_visibility, v_group_id, v_uploaded_by
    FROM public.filehub_files
    WHERE id = p_file_id AND company_id = v_company_id AND deleted_at IS NULL;

    IF v_visibility IS NULL THEN
        RAISE EXCEPTION 'File not found or you are not the uploader.';
    END IF;

    IF NOT (
        v_uploaded_by = v_user_id
        OR (v_visibility = 'group' AND public.has_permission('filehub:group_override_manage'))
    ) THEN
        RAISE EXCEPTION 'File not found or you are not the uploader.';
    END IF;

    v_expected_scope := CASE WHEN v_visibility = 'group' THEN 'group' WHEN v_visibility = 'broadcast' THEN 'broadcast' ELSE 'direct' END;

    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_folder_id AND company_id = v_company_id
          AND scope = v_expected_scope
          AND group_id IS NOT DISTINCT FROM v_group_id
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Folder does not belong to this file''s context.';
    END IF;

    UPDATE public.filehub_files
    SET folder_id = p_folder_id
    WHERE id = p_file_id AND company_id = v_company_id AND deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_file_move"("p_file_id" "uuid", "p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_file_versions"("p_file_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_rows JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF NOT public.filehub_file_accessible(p_file_id) THEN
        RAISE EXCEPTION 'File not found or not accessible.';
    END IF;

    WITH maxno AS (
        SELECT COALESCE(MAX(version_no), 0) AS max_no
        FROM public.filehub_file_versions WHERE file_id = p_file_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',               v.id,
            'version_no',       v.version_no,
            'original_name',    v.original_name,
            'size_bytes',       v.size_bytes,
            'mime_type',        v.mime_type,
            'storage_path',     v.storage_path,
            'bucket',           v.bucket,
            'created_at',       v.created_at,
            'superseded_at',    v.superseded_at,
            'is_current',       (v.superseded_at IS NULL),
            'pinned',           v.pinned,
            'is_stale_restore', (v.superseded_at IS NULL AND v.version_no < maxno.max_no),
            'expires_at',       CASE WHEN v.superseded_at IS NULL THEN NULL
                                      ELSE v.superseded_at + interval '30 days' END,
            'uploader',         jsonb_build_object(
                                    'id',         u.id,
                                    'full_name',  u.full_name,
                                    'avatar_url', u.avatar_url
                                 )
        ) ORDER BY v.version_no DESC
    ), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_file_versions v
    CROSS JOIN maxno
    LEFT JOIN public.users u ON u.id = v.created_by
    WHERE v.file_id = p_file_id;

    RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_file_versions"("p_file_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_folder_create"("p_name" "text", "p_parent_id" "uuid" DEFAULT NULL::"uuid", "p_scope" "text" DEFAULT 'direct'::"text", "p_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_name       TEXT := trim(p_name);
    v_id         UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;

    IF p_scope NOT IN ('direct', 'broadcast', 'group') THEN
        RAISE EXCEPTION 'Invalid folder scope.';
    END IF;

    IF (p_scope = 'group') <> (p_group_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Channel folders require a group; other scopes must not have one.';
    END IF;

    IF p_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_groups WHERE id = p_group_id AND company_id = v_company_id
    ) THEN
        RAISE EXCEPTION 'Channel not found in this company.';
    END IF;

    IF p_parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_parent_id AND company_id = v_company_id
          AND scope = p_scope AND group_id IS NOT DISTINCT FROM p_group_id
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Parent folder does not exist in this scope.';
    END IF;

    SELECT id INTO v_id
    FROM public.filehub_folders
    WHERE company_id = v_company_id
      AND parent_id IS NOT DISTINCT FROM p_parent_id
      AND scope = p_scope
      AND group_id IS NOT DISTINCT FROM p_group_id
      AND name = v_name
      AND deleted_at IS NULL;

    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;

    INSERT INTO public.filehub_folders (company_id, name, created_by, parent_id, scope, group_id)
    VALUES (v_company_id, v_name, v_user_id, p_parent_id, p_scope, p_group_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_folder_create"("p_name" "text", "p_parent_id" "uuid", "p_scope" "text", "p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_folder_delete"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_now        TIMESTAMPTZ := now();
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_id AND company_id = v_company_id AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Folder not found.';
    END IF;

    WITH RECURSIVE subtree AS (
        SELECT id FROM public.filehub_folders WHERE id = p_id
        UNION ALL
        SELECT f.id FROM public.filehub_folders f JOIN subtree s ON f.parent_id = s.id
    )
    UPDATE public.filehub_files
    SET deleted_at = v_now
    WHERE folder_id IN (SELECT id FROM subtree)
      AND company_id = v_company_id
      AND deleted_at IS NULL;

    WITH RECURSIVE subtree AS (
        SELECT id FROM public.filehub_folders WHERE id = p_id
        UNION ALL
        SELECT f.id FROM public.filehub_folders f JOIN subtree s ON f.parent_id = s.id
    )
    UPDATE public.filehub_folders
    SET deleted_at = v_now
    WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_folder_delete"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_folder_move"("p_id" "uuid", "p_new_parent_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_name       TEXT;
    v_scope      TEXT;
    v_group_id   UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;

    IF p_id = p_new_parent_id THEN
        RAISE EXCEPTION 'A folder cannot be moved into itself.';
    END IF;

    SELECT name, scope, group_id INTO v_name, v_scope, v_group_id
    FROM public.filehub_folders WHERE id = p_id AND company_id = v_company_id AND deleted_at IS NULL;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Folder not found.';
    END IF;

    IF p_new_parent_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_folders
            WHERE id = p_new_parent_id AND company_id = v_company_id
              AND scope = v_scope AND group_id IS NOT DISTINCT FROM v_group_id
              AND deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Destination folder not found in this scope.';
        END IF;

        IF EXISTS (
            WITH RECURSIVE descendants AS (
                SELECT id FROM public.filehub_folders WHERE parent_id = p_id
                UNION ALL
                SELECT f.id FROM public.filehub_folders f JOIN descendants d ON f.parent_id = d.id
            )
            SELECT 1 FROM descendants WHERE id = p_new_parent_id
        ) THEN
            RAISE EXCEPTION 'Cannot move a folder into its own subfolder.';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE company_id = v_company_id
          AND id <> p_id
          AND name = v_name
          AND parent_id IS NOT DISTINCT FROM p_new_parent_id
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'A folder named "%" already exists there.', v_name;
    END IF;

    UPDATE public.filehub_folders SET parent_id = p_new_parent_id WHERE id = p_id;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_folder_move"("p_id" "uuid", "p_new_parent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_folder_rename"("p_id" "uuid", "p_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_company_id UUID := public.my_company_id();
BEGIN
    UPDATE public.filehub_folders SET name = trim(p_name)
    WHERE id = p_id AND company_id = v_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Folder not found.'; END IF;
END; $$;


ALTER FUNCTION "public"."rpc_filehub_folder_rename"("p_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_folder_restore"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_deleted_at TIMESTAMPTZ;
    v_parent_id  UUID;
BEGIN
    SELECT deleted_at, parent_id INTO v_deleted_at, v_parent_id
    FROM public.filehub_folders
    WHERE id = p_id AND company_id = v_company_id
      AND deleted_at IS NOT NULL AND deleted_at > now() - interval '15 days';
    IF v_deleted_at IS NULL THEN
        RAISE EXCEPTION 'Folder not found in Bin, or the 15-day restore window has expired.';
    END IF;

    WITH RECURSIVE subtree AS (
        SELECT id FROM public.filehub_folders WHERE id = p_id
        UNION ALL
        SELECT f.id FROM public.filehub_folders f JOIN subtree s ON f.parent_id = s.id
    )
    UPDATE public.filehub_files
    SET deleted_at = NULL
    WHERE folder_id IN (SELECT id FROM subtree)
      AND company_id = v_company_id
      AND deleted_at = v_deleted_at;

    WITH RECURSIVE subtree AS (
        SELECT id FROM public.filehub_folders WHERE id = p_id
        UNION ALL
        SELECT f.id FROM public.filehub_folders f JOIN subtree s ON f.parent_id = s.id
    )
    UPDATE public.filehub_folders
    SET deleted_at = NULL
    WHERE id IN (SELECT id FROM subtree)
      AND deleted_at = v_deleted_at;

    IF v_parent_id IS NOT NULL THEN
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM public.filehub_folders
            WHERE id = v_parent_id AND company_id = v_company_id
            UNION ALL
            SELECT f.id, f.parent_id FROM public.filehub_folders f
            JOIN ancestors a ON f.id = a.parent_id
            WHERE f.company_id = v_company_id
        )
        UPDATE public.filehub_folders
        SET deleted_at = NULL
        WHERE id IN (SELECT id FROM ancestors) AND deleted_at IS NOT NULL;
    END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_folder_restore"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_folder_share_link_create"("p_folder_id" "uuid", "p_expires_in_hours" integer DEFAULT 168) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_token      TEXT;
    v_expires_at TIMESTAMPTZ;
    v_id         UUID;
BEGIN
    IF p_expires_in_hours NOT BETWEEN 1 AND 720 THEN
        RAISE EXCEPTION 'Expiry must be between 1 hour and 30 days.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_folder_id AND company_id = v_company_id AND created_by = v_user_id
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Folder not found or you are not its owner.';
    END IF;

    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_expires_at := now() + (p_expires_in_hours || ' hours')::interval;

    INSERT INTO public.filehub_share_links (folder_id, company_id, token, created_by, expires_at)
    VALUES (p_folder_id, v_company_id, v_token, v_user_id, v_expires_at)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires_at);
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_folder_share_link_create"("p_folder_id" "uuid", "p_expires_in_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_folder_share_link_list"("p_folder_id" "uuid") RETURNS TABLE("id" "uuid", "token" "text", "created_at" timestamp with time zone, "expires_at" timestamp with time zone, "revoked_at" timestamp with time zone, "view_count" integer, "last_viewed_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT id, token, created_at, expires_at, revoked_at, view_count, last_viewed_at
    FROM public.filehub_share_links
    WHERE folder_id = p_folder_id AND created_by = auth.uid()
    ORDER BY created_at DESC;
$$;


ALTER FUNCTION "public"."rpc_filehub_folder_share_link_list"("p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_group_add_member"("p_group_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
BEGIN
    IF NOT (
        EXISTS (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = v_user_id)
        OR public.has_permission('filehub:group_override_manage')
    ) THEN RAISE EXCEPTION 'You are not a member of this group.'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_groups WHERE id = p_group_id AND company_id = v_company_id
    ) THEN RAISE EXCEPTION 'Group not found.'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = p_user_id AND company_id = v_company_id
    ) THEN RAISE EXCEPTION 'User is not a member of your company.'; END IF;

    INSERT INTO public.filehub_group_members (group_id, user_id, role, added_by)
    VALUES (p_group_id, p_user_id, 'member', v_user_id)
    ON CONFLICT DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_group_add_member"("p_group_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_group_create"("p_name" "text", "p_description" "text" DEFAULT NULL::"text", "p_avatar_color" "text" DEFAULT '#6366f1'::"text", "p_member_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_group_id   UUID;
    v_mid        UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN RAISE EXCEPTION 'Insufficient permissions.'; END IF;
    IF p_name IS NULL OR length(trim(p_name)) = 0 THEN RAISE EXCEPTION 'Group name is required.'; END IF;
    INSERT INTO public.filehub_groups (company_id, name, description, avatar_color, created_by)
    VALUES (v_company_id, trim(p_name), NULLIF(trim(coalesce(p_description,'')), ''), p_avatar_color, v_user_id)
    RETURNING id INTO v_group_id;
    INSERT INTO public.filehub_group_members (group_id, user_id, role, added_by)
    VALUES (v_group_id, v_user_id, 'admin', v_user_id);
    FOREACH v_mid IN ARRAY COALESCE(p_member_ids, '{}') LOOP
        IF v_mid <> v_user_id AND EXISTS (
            SELECT 1 FROM public.users WHERE id = v_mid AND company_id = v_company_id
        ) THEN
            INSERT INTO public.filehub_group_members (group_id, user_id, role, added_by)
            VALUES (v_group_id, v_mid, 'member', v_user_id) ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
    RETURN v_group_id;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_group_create"("p_name" "text", "p_description" "text", "p_avatar_color" "text", "p_member_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_group_delete"("p_group_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id     UUID := auth.uid();
    v_company_id  UUID := public.my_company_id();
    v_caller_role TEXT;
    v_is_override BOOLEAN := false;
    v_now         TIMESTAMPTZ := now();
BEGIN
    SELECT role INTO v_caller_role FROM public.filehub_group_members
    WHERE group_id = p_group_id AND user_id = v_user_id;

    IF v_caller_role IS NULL THEN
        v_is_override := public.has_permission('filehub:group_override_manage')
            AND EXISTS (SELECT 1 FROM public.filehub_groups g WHERE g.id = p_group_id AND g.company_id = v_company_id);
    END IF;

    IF v_caller_role IS DISTINCT FROM 'admin' AND NOT v_is_override THEN
        RAISE EXCEPTION 'Only channel admins can delete this channel.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.filehub_groups WHERE id = p_group_id AND company_id = v_company_id) THEN
        RAISE EXCEPTION 'Channel not found.';
    END IF;

    UPDATE public.filehub_files
    SET deleted_at = v_now
    WHERE group_id = p_group_id AND company_id = v_company_id AND deleted_at IS NULL;

    UPDATE public.filehub_folders
    SET deleted_at = v_now
    WHERE group_id = p_group_id AND company_id = v_company_id AND deleted_at IS NULL;

    DELETE FROM public.filehub_groups WHERE id = p_group_id AND company_id = v_company_id;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_group_delete"("p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_group_list"("p_override" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
    v_use_override BOOLEAN := p_override AND (
        public.has_permission('filehub:group_override') OR public.has_permission('filehub:group_override_manage')
    );
    v_rows       JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',           g.id,
            'name',         g.name,
            'description',  g.description,
            'avatar_color', g.avatar_color,
            'my_role',      gm_me.role,
            'is_override',  gm_me.role IS NULL,
            'member_count', (SELECT COUNT(*) FROM public.filehub_group_members gmc WHERE gmc.group_id = g.id),
            'members', (
                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url
                )), '[]'::jsonb)
                FROM (
                    SELECT gml.user_id FROM public.filehub_group_members gml
                    WHERE gml.group_id = g.id ORDER BY gml.joined_at LIMIT 4
                ) sub JOIN public.users u ON u.id = sub.user_id
            ),
            'file_count',    (SELECT COUNT(*) FROM public.filehub_files f WHERE f.group_id = g.id AND f.deleted_at IS NULL),
            'last_activity', (SELECT MAX(f.created_at) FROM public.filehub_files f WHERE f.group_id = g.id AND f.deleted_at IS NULL)
        )
        ORDER BY (SELECT MAX(fa.created_at) FROM public.filehub_files fa WHERE fa.group_id = g.id AND fa.deleted_at IS NULL) DESC NULLS LAST, g.name
    ), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_groups g
    LEFT JOIN public.filehub_group_members gm_me ON gm_me.group_id = g.id AND gm_me.user_id = v_user_id
    WHERE g.company_id = v_company_id
      AND (gm_me.user_id IS NOT NULL OR v_use_override);

    RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_group_list"("p_override" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_group_list_files"("p_group_id" "uuid", "p_search" "text" DEFAULT NULL::"text", "p_tag" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
    v_search     TEXT := NULLIF(trim(coalesce(p_search, '')), '');
    v_rows       JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    IF NOT (
        EXISTS (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = v_user_id)
        OR public.has_permission('filehub:group_override')
        OR public.has_permission('filehub:group_override_manage')
    ) THEN
        RAISE EXCEPTION 'You are not a member of this group.';
    END IF;

    SELECT COALESCE(jsonb_agg(row_payload ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT
            f.created_at,
            jsonb_build_object(
                'id',             f.id,
                'original_name',  f.original_name,
                'mime_type',      f.mime_type,
                'size_bytes',     f.size_bytes,
                'content_hash',   f.content_hash,
                'caption',        f.caption,
                'visibility',     f.visibility,
                'storage_path',   f.storage_path,
                'bucket',         f.bucket,
                'tags',           f.tags,
                'created_at',     f.created_at,
                'group_id',       f.group_id,
                'folder_id',      f.folder_id,
                'folder',         CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader',       jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url),
                'recipient_state', NULL::jsonb,
                'recipients',     NULL::jsonb,
                'recipient_count', 0
            ) AS row_payload
        FROM public.filehub_files f
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        JOIN public.users u ON u.id = f.uploaded_by
        WHERE f.deleted_at IS NULL
          AND f.group_id = p_group_id
          AND f.visibility = 'group'
          AND f.company_id = v_company_id
          AND (v_search IS NULL
               OR f.original_name ILIKE '%' || v_search || '%'
               OR f.caption       ILIKE '%' || v_search || '%'
               OR EXISTS (SELECT 1 FROM unnest(f.tags) t WHERE t ILIKE '%' || v_search || '%'))
          AND (p_tag IS NULL OR p_tag = ANY(f.tags))
    ) src;

    RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_group_list_files"("p_group_id" "uuid", "p_search" "text", "p_tag" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_group_members"("p_group_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_rows    JSONB;
BEGIN
    IF NOT (
        EXISTS (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = v_user_id)
        OR (
            (public.has_permission('filehub:group_override') OR public.has_permission('filehub:group_override_manage'))
            AND EXISTS (SELECT 1 FROM public.filehub_groups g WHERE g.id = p_group_id AND g.company_id = public.my_company_id())
        )
    ) THEN
        RAISE EXCEPTION 'You are not a member of this group.';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',        u.id,
        'full_name', u.full_name,
        'avatar_url',u.avatar_url,
        'role',      gm.role,
        'joined_at', gm.joined_at
    ) ORDER BY gm.role DESC, gm.joined_at), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_group_members gm
    JOIN public.users u ON u.id = gm.user_id
    WHERE gm.group_id = p_group_id;

    RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_group_members"("p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_group_remove_member"("p_group_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id     UUID := auth.uid();
    v_caller_role TEXT;
    v_is_override BOOLEAN := false;
BEGIN
    SELECT role INTO v_caller_role FROM public.filehub_group_members
    WHERE group_id = p_group_id AND user_id = v_user_id;

    IF v_caller_role IS NULL THEN
        v_is_override := public.has_permission('filehub:group_override_manage')
            AND EXISTS (SELECT 1 FROM public.filehub_groups g WHERE g.id = p_group_id AND g.company_id = public.my_company_id());
        IF NOT v_is_override THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
    END IF;

    IF p_user_id <> v_user_id AND v_caller_role IS DISTINCT FROM 'admin' AND NOT v_is_override THEN
        RAISE EXCEPTION 'Only group admins can remove other members.';
    END IF;

    IF p_user_id = v_user_id AND v_caller_role = 'admin'
       AND NOT EXISTS (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id <> p_user_id AND role = 'admin')
       AND EXISTS     (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id <> p_user_id)
    THEN
        RAISE EXCEPTION 'You are the only admin. Promote another member before leaving.';
    END IF;

    DELETE FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_group_remove_member"("p_group_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_group_rename"("p_group_id" "uuid", "p_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id     UUID := auth.uid();
    v_company_id  UUID := public.my_company_id();
    v_caller_role TEXT;
    v_is_override BOOLEAN := false;
    v_name        TEXT := trim(p_name);
BEGIN
    IF v_name IS NULL OR length(v_name) = 0 THEN
        RAISE EXCEPTION 'Channel name is required.';
    END IF;

    SELECT role INTO v_caller_role FROM public.filehub_group_members
    WHERE group_id = p_group_id AND user_id = v_user_id;

    IF v_caller_role IS NULL THEN
        v_is_override := public.has_permission('filehub:group_override_manage')
            AND EXISTS (SELECT 1 FROM public.filehub_groups g WHERE g.id = p_group_id AND g.company_id = v_company_id);
    END IF;

    IF v_caller_role IS DISTINCT FROM 'admin' AND NOT v_is_override THEN
        RAISE EXCEPTION 'Only channel admins can rename this channel.';
    END IF;

    UPDATE public.filehub_groups SET name = v_name WHERE id = p_group_id AND company_id = v_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Channel not found.';
    END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_group_rename"("p_group_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_list"("p_mode" "text", "p_search" "text" DEFAULT NULL::"text", "p_folder_id" "uuid" DEFAULT NULL::"uuid", "p_tag" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_rows       JSONB;
    v_search     TEXT := NULLIF(trim(coalesce(p_search,'')), '');
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view File Hub.';
    END IF;
    IF p_mode NOT IN ('inbox','sent','broadcast') THEN
        RAISE EXCEPTION 'Invalid mode: %', p_mode;
    END IF;

    SELECT COALESCE(jsonb_agg(row_payload ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT
            f.created_at,
            jsonb_build_object(
                'id',             f.id,
                'original_name',  f.original_name,
                'mime_type',      f.mime_type,
                'size_bytes',     f.size_bytes,
                'content_hash',   f.content_hash,
                'caption',        f.caption,
                'visibility',     f.visibility,
                'storage_path',   f.storage_path,
                'bucket',         f.bucket,
                'tags',           f.tags,
                'created_at',     f.created_at,
                'current_version_id', f.current_version_id,
                'version_count',  (SELECT count(*) FROM public.filehub_file_versions v WHERE v.file_id = f.id),
                'is_stale_restore', COALESCE((
                    SELECT v.version_no < (SELECT MAX(v2.version_no) FROM public.filehub_file_versions v2 WHERE v2.file_id = f.id)
                    FROM public.filehub_file_versions v
                    WHERE v.id = f.current_version_id
                ), false),
                'folder', CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader', jsonb_build_object(
                    'id',         u.id,
                    'full_name',  u.full_name,
                    'avatar_url', u.avatar_url
                ),
                'recipient_state', CASE
                    WHEN p_mode = 'inbox' THEN jsonb_build_object(
                        'read_at',     r.read_at,
                        'archived_at', r.archived_at
                    )
                    ELSE NULL
                END,
                'recipients', CASE
                    WHEN p_mode = 'sent' THEN COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'user_id',    ru.id,
                            'full_name',  ru.full_name,
                            'avatar_url', ru.avatar_url,
                            'read_at',    rr.read_at
                        ))
                        FROM public.filehub_recipients rr
                        JOIN public.users ru ON ru.id = rr.user_id
                        WHERE rr.file_id = f.id
                    ), '[]'::jsonb)
                    ELSE NULL
                END,
                'recipient_count', (
                    SELECT COUNT(*) FROM public.filehub_recipients rc WHERE rc.file_id = f.id
                )
            ) AS row_payload
        FROM public.filehub_files f
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        LEFT JOIN public.users u            ON u.id  = f.uploaded_by
        LEFT JOIN public.filehub_recipients r
            ON r.file_id = f.id AND r.user_id = v_user_id
        WHERE f.deleted_at IS NULL
          AND f.company_id = v_company_id
          AND (
              (p_mode = 'inbox'     AND f.visibility = 'direct' AND r.user_id IS NOT NULL AND r.archived_at IS NULL)
              OR
              (p_mode = 'sent'      AND f.uploaded_by = v_user_id AND f.visibility = 'direct')
              OR
              (p_mode = 'broadcast' AND f.visibility = 'broadcast' AND r.archived_at IS NULL)
          )
          AND (v_search IS NOT NULL OR f.folder_id IS NOT DISTINCT FROM p_folder_id)
          AND (p_tag       IS NULL OR p_tag = ANY (f.tags))
          AND (
              v_search IS NULL
              OR f.original_name ILIKE '%' || v_search || '%'
              OR f.caption       ILIKE '%' || v_search || '%'
              OR EXISTS (SELECT 1 FROM unnest(f.tags) t WHERE t ILIKE '%' || v_search || '%')
          )
    ) src;

    RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_list"("p_mode" "text", "p_search" "text", "p_folder_id" "uuid", "p_tag" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_log_activity"("p_file_id" "uuid", "p_action" "text", "p_metadata" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    INSERT INTO public.filehub_activity (company_id, file_id, user_id, action, metadata)
    VALUES (public.my_company_id(), p_file_id, auth.uid(), p_action, p_metadata);
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_log_activity"("p_file_id" "uuid", "p_action" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_log_activity_by_path"("p_bucket" "text", "p_storage_path" "text", "p_action" "text", "p_metadata" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."rpc_filehub_log_activity_by_path"("p_bucket" "text", "p_storage_path" "text", "p_action" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_mark_all_read"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    UPDATE public.filehub_recipients
    SET read_at = COALESCE(read_at, now())
    WHERE user_id = auth.uid()
      AND read_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_mark_all_read"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_mark_read"("p_file_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
    UPDATE public.filehub_recipients
    SET read_at = COALESCE(read_at, now())
    WHERE file_id = p_file_id AND user_id = v_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'You are not a recipient of this file.';
    END IF;
END; $$;


ALTER FUNCTION "public"."rpc_filehub_mark_read"("p_file_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_mark_scope_seen"("p_scope" "text", "p_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user UUID := auth.uid();
BEGIN
    IF p_scope NOT IN ('broadcast', 'group') THEN
        RAISE EXCEPTION 'Invalid scope: %', p_scope;
    END IF;
    IF (p_scope = 'group') <> (p_group_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Channel scope requires a group_id; broadcast must not have one.';
    END IF;

    INSERT INTO public.filehub_seen (user_id, scope, group_id, last_seen_at)
    VALUES (v_user, p_scope, p_group_id, now())
    ON CONFLICT (user_id, scope, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET last_seen_at = now();
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_mark_scope_seen"("p_scope" "text", "p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_overview"("p_recent_limit" integer DEFAULT 12) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company uuid := public.my_company_id();
  v_user    uuid := auth.uid();
  v_limit   int  := LEAST(GREATEST(COALESCE(p_recent_limit, 12), 1), 50);
  v_recent  jsonb;
  v_assigned jsonb;
  v_stats   jsonb;
BEGIN
  IF v_company IS NULL OR NOT public.has_permission('filehub:view') THEN
    RETURN jsonb_build_object('recent_files', '[]'::jsonb,
                              'recently_assigned', '[]'::jsonb,
                              'stats', '{}'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.last_opened_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT * FROM (
      SELECT DISTINCT ON (fa.file_id)
        fa.file_id, f.original_name, f.mime_type, f.size_bytes, f.bucket,
        f.storage_path, f.caption, f.visibility, f.group_id, f.folder_id,
        fa.created_at AS last_opened_at
      FROM public.filehub_activity fa
      JOIN public.filehub_files f
        ON f.id = fa.file_id AND f.deleted_at IS NULL AND f.company_id = v_company
      WHERE fa.user_id = v_user AND fa.action IN ('view', 'download')
      ORDER BY fa.file_id, fa.created_at DESC
    ) d
    WHERE public.filehub_file_accessible(d.file_id)
    ORDER BY d.last_opened_at DESC
    LIMIT v_limit
  ) r;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.assigned_at DESC), '[]'::jsonb)
  INTO v_assigned
  FROM (
    SELECT DISTINCT ON (fi.file_id)
      fi.source, fi.file_id, fi.file_name, fi.mime_type, fi.size_bytes, fi.bucket,
      fi.storage_path, fi.task_id, t.title AS task_title, fi.project_id,
      (SELECT p.name FROM public.projects p WHERE p.id = fi.project_id) AS project_name,
      fi.task_category, ta.assigned_at
    FROM public.files_index fi
    JOIN public.task_assignments ta ON ta.task_id = fi.task_id
    JOIN public.tasks t ON t.id = fi.task_id AND t.deleted_at IS NULL
    WHERE fi.company_id = v_company
      AND fi.source IN ('submission', 'task_brief')
      AND (
        ta.assignee_user_id = v_user
        OR ta.assignee_team_id IN (
          SELECT tm.team_id FROM public.team_members tm
          WHERE tm.user_id = v_user AND tm.removed_at IS NULL
        )
      )
      AND public.fn_task_file_accessible(fi.task_id)
    ORDER BY fi.file_id, ta.assigned_at DESC
    LIMIT v_limit * 4
  ) r;
  v_assigned := (
    SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'assigned_at') DESC), '[]'::jsonb)
    FROM (SELECT e FROM jsonb_array_elements(v_assigned) e
          ORDER BY (e->>'assigned_at') DESC LIMIT v_limit) s
  );

  SELECT jsonb_build_object(
    'files_7d', (SELECT count(*) FROM public.filehub_files
                 WHERE company_id = v_company AND deleted_at IS NULL AND visibility <> 'task'
                   AND created_at > now() - interval '7 days'),
    'bytes_7d', (SELECT COALESCE(sum(size_bytes), 0) FROM public.filehub_files
                 WHERE company_id = v_company AND deleted_at IS NULL AND visibility <> 'task'
                   AND created_at > now() - interval '7 days'),
    'inbox_unread', public.rpc_filehub_unread_count(),
    'my_channels', (SELECT count(*) FROM public.filehub_group_members
                    WHERE user_id = v_user)
  ) INTO v_stats;

  RETURN jsonb_build_object('recent_files', v_recent, 'recently_assigned', v_assigned, 'stats', v_stats);
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_overview"("p_recent_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_pin_version"("p_version_id" "uuid", "p_pinned" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_version    public.filehub_file_versions%ROWTYPE;
    v_file       public.filehub_files%ROWTYPE;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;

    SELECT * INTO v_version
    FROM public.filehub_file_versions
    WHERE id = p_version_id AND company_id = v_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Version not found.';
    END IF;

    SELECT * INTO v_file
    FROM public.filehub_files
    WHERE id = v_version.file_id AND company_id = v_company_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found.';
    END IF;

    -- Same permission checks as replace_file / restore_version.
    IF v_file.visibility = 'group' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_group_members
            WHERE group_id = v_file.group_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
    ELSIF v_file.visibility = 'broadcast' THEN
        IF NOT public.has_permission('filehub:broadcast') THEN
            RAISE EXCEPTION 'You do not have permission to pin versions of broadcast files.';
        END IF;
    ELSIF v_file.visibility = 'direct' THEN
        IF v_file.uploaded_by <> v_user_id THEN
            RAISE EXCEPTION 'Only the owner can pin versions of a direct file.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported visibility: %', v_file.visibility;
    END IF;

    UPDATE public.filehub_file_versions SET pinned = p_pinned WHERE id = p_version_id;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_pin_version"("p_version_id" "uuid", "p_pinned" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_pointer_id"("p_source" "text", "p_source_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."rpc_filehub_pointer_id"("p_source" "text", "p_source_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_recipient_hide"("p_file_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    UPDATE public.filehub_recipients
    SET archived_at = now()
    WHERE file_id = p_file_id AND user_id = v_user_id AND archived_at IS NULL;

    IF FOUND THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.filehub_recipients WHERE file_id = p_file_id AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'You are not a recipient of this file, or it is already hidden.';
    END IF;

    IF public.filehub_file_accessible(p_file_id)
       AND NOT EXISTS (SELECT 1 FROM public.filehub_files WHERE id = p_file_id AND uploaded_by = v_user_id)
    THEN
        INSERT INTO public.filehub_recipients (file_id, user_id, archived_at)
        VALUES (p_file_id, v_user_id, now());
        RETURN;
    END IF;

    RAISE EXCEPTION 'You are not a recipient of this file, or it is already hidden.';
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_recipient_hide"("p_file_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_rename_tag"("p_old" "text", "p_new" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_count INT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    p_new := lower(trim(regexp_replace(p_new, '\s+', '-', 'g')));
    IF p_new = '' THEN RAISE EXCEPTION 'Tag name cannot be empty.'; END IF;
    UPDATE public.filehub_files
    SET tags = array_replace(tags, p_old, p_new)
    WHERE company_id = public.my_company_id()
      AND deleted_at IS NULL
      AND p_old = ANY(tags);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_rename_tag"("p_old" "text", "p_new" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_replace_file"("p_target_id" "uuid", "p_storage_path" "text", "p_size_bytes" bigint, "p_content_hash" "text", "p_mime_type" "text", "p_caption" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id    UUID   := public.my_company_id();
    v_user_id       UUID   := auth.uid();
    v_file          public.filehub_files%ROWTYPE;
    v_next_no       INT;
    v_version_id    UUID;
    v_size_limit    BIGINT;
    v_storage_limit BIGINT;
    v_storage_used  BIGINT;
    v_net_delta     BIGINT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;

    PERFORM public._rate_limit('file_replace', 1000);

    IF p_storage_path IS NULL OR length(trim(p_storage_path)) = 0 THEN
        RAISE EXCEPTION 'Storage path is required.';
    END IF;

    v_size_limit := public._company_file_size_limit(v_company_id);
    IF v_size_limit <> -1 AND p_size_bytes > v_size_limit THEN
        RAISE EXCEPTION 'File too large for your plan (% MB limit). Upgrade to upload larger files.',
            round(v_size_limit::numeric / 1048576);
    END IF;

    SELECT * INTO v_file
    FROM public.filehub_files
    WHERE id = p_target_id AND company_id = v_company_id AND deleted_at IS NULL;

    IF NOT FOUND THEN RAISE EXCEPTION 'File not found.'; END IF;

    v_net_delta := p_size_bytes - COALESCE(v_file.size_bytes, 0);
    IF v_net_delta > 0 THEN
        v_storage_limit := public._company_storage_limit(v_company_id);
        IF v_storage_limit <> -1 THEN
            SELECT COALESCE(storage_used_bytes, 0) INTO v_storage_used
            FROM public.company_billing WHERE company_id = v_company_id FOR UPDATE;
            IF (COALESCE(v_storage_used, 0) + v_net_delta) > v_storage_limit THEN
                RAISE EXCEPTION 'Storage quota exceeded (% MB of % MB used). Upgrade your plan.',
                    round(COALESCE(v_storage_used, 0)::numeric / 1048576),
                    round(v_storage_limit::numeric / 1048576);
            END IF;
        END IF;
    END IF;

    IF v_file.visibility = 'group' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_group_members
            WHERE group_id = v_file.group_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
    ELSIF v_file.visibility = 'broadcast' THEN
        IF NOT public.has_permission('filehub:broadcast') THEN
            RAISE EXCEPTION 'You do not have permission to replace broadcast files.';
        END IF;
    ELSIF v_file.visibility = 'direct' THEN
        IF v_file.uploaded_by <> v_user_id THEN
            RAISE EXCEPTION 'Only the owner can replace a direct file.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported visibility: %', v_file.visibility;
    END IF;

    SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next_no
    FROM public.filehub_file_versions WHERE file_id = p_target_id;

    UPDATE public.filehub_file_versions
    SET superseded_at = now()
    WHERE file_id = p_target_id AND superseded_at IS NULL;

    INSERT INTO public.filehub_file_versions (
        file_id, company_id, version_no, storage_path, bucket,
        original_name, size_bytes, mime_type, content_hash, created_by, superseded_at
    ) VALUES (
        p_target_id, v_company_id, v_next_no, p_storage_path, 'filehub-files',
        v_file.original_name, p_size_bytes, p_mime_type, p_content_hash, v_user_id, NULL
    ) RETURNING id INTO v_version_id;

    UPDATE public.filehub_files
    SET current_version_id = v_version_id,
        storage_path       = p_storage_path,
        size_bytes         = p_size_bytes,
        mime_type          = p_mime_type,
        content_hash       = p_content_hash,
        caption            = COALESCE(NULLIF(trim(coalesce(p_caption, '')), ''), caption),
        updated_at         = now(),
        updated_by         = v_user_id
    WHERE id = p_target_id;

    RETURN v_version_id;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_replace_file"("p_target_id" "uuid", "p_storage_path" "text", "p_size_bytes" bigint, "p_content_hash" "text", "p_mime_type" "text", "p_caption" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_restore"("p_file_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
    v_folder_id  UUID;
BEGIN
    UPDATE public.filehub_files
    SET deleted_at = NULL
    WHERE id = p_file_id
      AND uploaded_by = v_user_id
      AND deleted_at IS NOT NULL
      AND deleted_at > now() - interval '15 days'
      AND visibility <> 'task'
    RETURNING folder_id INTO v_folder_id;

    IF FOUND THEN
        IF v_folder_id IS NOT NULL THEN
            WITH RECURSIVE ancestors AS (
                SELECT id, parent_id FROM public.filehub_folders
                WHERE id = v_folder_id AND company_id = v_company_id
                UNION ALL
                SELECT f.id, f.parent_id FROM public.filehub_folders f
                JOIN ancestors a ON f.id = a.parent_id
                WHERE f.company_id = v_company_id
            )
            UPDATE public.filehub_folders
            SET deleted_at = NULL
            WHERE id IN (SELECT id FROM ancestors) AND deleted_at IS NOT NULL;
        END IF;
        RETURN;
    END IF;

    UPDATE public.filehub_recipients
    SET archived_at = NULL
    WHERE file_id = p_file_id
      AND user_id = v_user_id
      AND archived_at IS NOT NULL
      AND archived_at > now() - interval '15 days';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found in Bin, or the 15-day restore window has expired.';
    END IF;

    SELECT folder_id INTO v_folder_id FROM public.filehub_files WHERE id = p_file_id;
    IF v_folder_id IS NOT NULL THEN
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM public.filehub_folders
            WHERE id = v_folder_id AND company_id = v_company_id
            UNION ALL
            SELECT f.id, f.parent_id FROM public.filehub_folders f
            JOIN ancestors a ON f.id = a.parent_id
            WHERE f.company_id = v_company_id
        )
        UPDATE public.filehub_folders
        SET deleted_at = NULL
        WHERE id IN (SELECT id FROM ancestors) AND deleted_at IS NOT NULL;
    END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_restore"("p_file_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_restore_version"("p_version_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_file_id    UUID;
    v_file       public.filehub_files%ROWTYPE;
    v_version    public.filehub_file_versions%ROWTYPE;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;

    SELECT * INTO v_version
    FROM public.filehub_file_versions
    WHERE id = p_version_id AND company_id = v_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Version not found.';
    END IF;
    v_file_id := v_version.file_id;

    SELECT * INTO v_file
    FROM public.filehub_files
    WHERE id = v_file_id AND company_id = v_company_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found.';
    END IF;

    IF v_file.visibility = 'group' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_group_members
            WHERE group_id = v_file.group_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
    ELSIF v_file.visibility = 'broadcast' THEN
        IF NOT public.has_permission('filehub:broadcast') THEN
            RAISE EXCEPTION 'You do not have permission to restore broadcast files.';
        END IF;
    ELSIF v_file.visibility = 'direct' THEN
        IF v_file.uploaded_by <> v_user_id THEN
            RAISE EXCEPTION 'Only the owner can restore a direct file.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported visibility: %', v_file.visibility;
    END IF;

    IF v_version.superseded_at IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.filehub_file_versions
    SET superseded_at = now()
    WHERE file_id = v_file_id AND superseded_at IS NULL AND id <> p_version_id;

    UPDATE public.filehub_file_versions
    SET superseded_at = NULL
    WHERE id = p_version_id;

    UPDATE public.filehub_files
    SET current_version_id = p_version_id,
        storage_path       = v_version.storage_path,
        original_name      = v_version.original_name,
        size_bytes         = v_version.size_bytes,
        mime_type          = v_version.mime_type,
        content_hash       = v_version.content_hash,
        updated_at         = now(),
        updated_by         = v_user_id
    WHERE id = v_file_id;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_restore_version"("p_version_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_share_link_create"("p_file_id" "uuid", "p_expires_in_hours" integer DEFAULT 168) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_token      TEXT;
    v_expires_at TIMESTAMPTZ;
    v_id         UUID;
BEGIN
    IF p_expires_in_hours NOT BETWEEN 1 AND 720 THEN
        RAISE EXCEPTION 'Expiry must be between 1 hour and 30 days.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_files
        WHERE id = p_file_id AND company_id = v_company_id AND uploaded_by = v_user_id AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'File not found or you are not the uploader.';
    END IF;

    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_expires_at := now() + (p_expires_in_hours || ' hours')::interval;

    INSERT INTO public.filehub_share_links (file_id, company_id, token, created_by, expires_at)
    VALUES (p_file_id, v_company_id, v_token, v_user_id, v_expires_at)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires_at);
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_share_link_create"("p_file_id" "uuid", "p_expires_in_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_share_link_list"("p_file_id" "uuid") RETURNS TABLE("id" "uuid", "token" "text", "created_at" timestamp with time zone, "expires_at" timestamp with time zone, "revoked_at" timestamp with time zone, "view_count" integer, "last_viewed_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT id, token, created_at, expires_at, revoked_at, view_count, last_viewed_at
    FROM public.filehub_share_links
    WHERE file_id = p_file_id AND created_by = auth.uid()
    ORDER BY created_at DESC;
$$;


ALTER FUNCTION "public"."rpc_filehub_share_link_list"("p_file_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_share_link_revoke"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    UPDATE public.filehub_share_links
    SET revoked_at = now()
    WHERE id = p_id AND created_by = auth.uid() AND revoked_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Share link not found or already revoked.';
    END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_share_link_revoke"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_tag_suggestions"("p_prefix" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 12) RETURNS "text"[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_company_id UUID := public.my_company_id(); v_prefix TEXT := lower(trim(coalesce(p_prefix,''))); v_tags TEXT[];
BEGIN
    SELECT array_agg(t ORDER BY t)
    INTO v_tags
    FROM (
        SELECT DISTINCT unnest(f.tags) AS t
        FROM public.filehub_files f
        WHERE f.company_id = v_company_id AND f.deleted_at IS NULL
    ) all_tags
    WHERE v_prefix = '' OR t LIKE v_prefix || '%'
    LIMIT GREATEST(p_limit, 1);
    RETURN COALESCE(v_tags, '{}'::text[]);
END; $$;


ALTER FUNCTION "public"."rpc_filehub_tag_suggestions"("p_prefix" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_unread_count"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user       UUID := auth.uid();
    v_company    UUID := public.my_company_id();
    v_direct     INT;
    v_broadcast  INT;
    v_group      INT;
    v_bcast_seen TIMESTAMPTZ;
BEGIN
    SELECT COUNT(*) INTO v_direct
    FROM   public.filehub_recipients r
    JOIN   public.filehub_files f ON f.id = r.file_id
    WHERE  r.user_id = v_user
      AND  r.read_at IS NULL
      AND  f.deleted_at IS NULL;

    SELECT last_seen_at INTO v_bcast_seen
    FROM   public.filehub_seen
    WHERE  user_id = v_user AND scope = 'broadcast';

    SELECT COUNT(*) INTO v_broadcast
    FROM   public.filehub_files f
    WHERE  f.company_id = v_company
      AND  f.visibility = 'broadcast'
      AND  f.deleted_at IS NULL
      AND  f.uploaded_by <> v_user
      AND  (v_bcast_seen IS NULL OR f.created_at > v_bcast_seen);

    SELECT COUNT(*) INTO v_group
    FROM   public.filehub_files f
    JOIN   public.filehub_group_members m
           ON m.group_id = f.group_id AND m.user_id = v_user
    LEFT JOIN public.filehub_seen s
           ON s.user_id = v_user AND s.scope = 'group' AND s.group_id = f.group_id
    WHERE  f.visibility = 'group'
      AND  f.deleted_at IS NULL
      AND  f.company_id = v_company
      AND  f.uploaded_by <> v_user
      AND  (s.last_seen_at IS NULL OR f.created_at > s.last_seen_at);

    RETURN (v_direct + v_broadcast + v_group)::INT;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_unread_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_filehub_upload_commit"("p_storage_path" "text", "p_visibility" "text", "p_recipient_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_folder_id" "uuid" DEFAULT NULL::"uuid", "p_tags" "text"[] DEFAULT '{}'::"text"[], "p_caption" "text" DEFAULT NULL::"text", "p_original_name" "text" DEFAULT NULL::"text", "p_mime_type" "text" DEFAULT NULL::"text", "p_size_bytes" bigint DEFAULT 0, "p_content_hash" "text" DEFAULT NULL::"text", "p_replaces_file_id" "uuid" DEFAULT NULL::"uuid", "p_group_id" "uuid" DEFAULT NULL::"uuid", "p_rel_dir" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id     UUID   := public.my_company_id();
    v_user_id        UUID   := auth.uid();
    v_file_id        UUID;
    v_version_id     UUID;
    v_clean_tags     TEXT[];
    v_final_name     TEXT;
    v_size_limit     BIGINT;
    v_storage_limit  BIGINT;
    v_storage_used   BIGINT;
    v_target_folder  UUID   := p_folder_id;
    v_scope          TEXT;
    v_folder_group   UUID;
    v_parent         UUID;
    v_child          UUID;
    v_seg            TEXT;
    v_lock_key       BIGINT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;

    PERFORM public._rate_limit('file_upload', 1000);

    IF p_visibility NOT IN ('direct', 'broadcast', 'group') THEN
        RAISE EXCEPTION 'Invalid visibility: %', p_visibility;
    END IF;
    IF p_visibility = 'broadcast' AND NOT public.has_permission('filehub:broadcast') THEN
        RAISE EXCEPTION 'You do not have permission to broadcast files.';
    END IF;
    IF p_visibility = 'direct' AND (p_recipient_ids IS NULL OR cardinality(p_recipient_ids) = 0) THEN
        RAISE EXCEPTION 'Direct sends require at least one recipient.';
    END IF;
    IF p_visibility = 'group' THEN
        IF p_group_id IS NULL THEN
            RAISE EXCEPTION 'Group uploads require a group_id.';
        END IF;
        IF NOT (
            EXISTS (
                SELECT 1 FROM public.filehub_group_members
                WHERE group_id = p_group_id AND user_id = v_user_id
            )
            OR public.has_permission('filehub:group_override_manage')
        ) THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_groups
            WHERE id = p_group_id AND company_id = v_company_id
        ) THEN
            RAISE EXCEPTION 'Group not found.';
        END IF;
    END IF;

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

    IF p_original_name IS NULL OR length(trim(p_original_name)) = 0 THEN
        RAISE EXCEPTION 'Original filename is required.';
    END IF;
    IF p_storage_path IS NULL OR length(trim(p_storage_path)) = 0 THEN
        RAISE EXCEPTION 'Storage path is required.';
    END IF;
    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_folder_id AND company_id = v_company_id AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Folder does not exist in this company.';
    END IF;

    IF p_rel_dir IS NOT NULL AND length(trim(p_rel_dir)) > 0
       AND p_folder_id IS NOT NULL
       AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_folder_id
          AND company_id = v_company_id
          AND scope = p_visibility
          AND group_id IS NOT DISTINCT FROM (CASE WHEN p_visibility = 'group' THEN p_group_id ELSE NULL END)
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Target folder does not exist in this scope.';
    END IF;
    IF p_visibility = 'direct' AND EXISTS (
        SELECT 1 FROM unnest(p_recipient_ids) rid
        WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = rid AND u.company_id = v_company_id)
    ) THEN
        RAISE EXCEPTION 'One or more recipients are not members of your company.';
    END IF;

    IF p_rel_dir IS NOT NULL AND length(trim(p_rel_dir)) > 0 THEN
        v_scope        := p_visibility;
        v_folder_group := CASE WHEN v_scope = 'group' THEN p_group_id ELSE NULL END;
        v_parent       := p_folder_id;
        FOREACH v_seg IN ARRAY regexp_split_to_array(trim(p_rel_dir), '/') LOOP
            v_seg := trim(v_seg);
            CONTINUE WHEN length(v_seg) = 0;

            SELECT id INTO v_child
            FROM public.filehub_folders
            WHERE company_id = v_company_id
              AND parent_id IS NOT DISTINCT FROM v_parent
              AND scope = v_scope
              AND group_id IS NOT DISTINCT FROM v_folder_group
              AND name = v_seg
              AND deleted_at IS NULL;

            IF v_child IS NULL THEN
                INSERT INTO public.filehub_folders (company_id, name, created_by, parent_id, scope, group_id)
                VALUES (v_company_id, v_seg, v_user_id, v_parent, v_scope, v_folder_group)
                ON CONFLICT DO NOTHING
                RETURNING id INTO v_child;

                IF v_child IS NULL THEN
                    SELECT id INTO v_child
                    FROM public.filehub_folders
                    WHERE company_id = v_company_id
                      AND parent_id IS NOT DISTINCT FROM v_parent
                      AND scope = v_scope
                      AND group_id IS NOT DISTINCT FROM v_folder_group
                      AND name = v_seg
                      AND deleted_at IS NULL;
                END IF;

                IF v_child IS NULL THEN
                    RAISE EXCEPTION 'Cannot create folder "%" here — a folder with that name already exists at this level.', v_seg;
                END IF;
            END IF;

            v_parent := v_child;
        END LOOP;
        v_target_folder := v_parent;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT lower(trim(t))) FILTER (WHERE length(trim(t)) > 0), '{}')
    INTO v_clean_tags FROM unnest(COALESCE(p_tags, '{}')) AS t;

    v_lock_key := hashtextextended(
        v_company_id::text
          || '|' || p_visibility
          || '|' || COALESCE((CASE WHEN p_visibility = 'group'  THEN p_group_id END)::text, '-')
          || '|' || COALESCE((CASE WHEN p_visibility = 'direct' THEN v_user_id  END)::text, '-')
          || '|' || COALESCE(v_target_folder::text, '-'),
        0
    );
    PERFORM pg_advisory_xact_lock(v_lock_key);

    v_final_name := public.filehub_dedupe_name(
        p_original_name, p_visibility, p_group_id, v_target_folder
    );

    INSERT INTO public.filehub_files (
        company_id, uploaded_by, storage_path, bucket, original_name, mime_type,
        size_bytes, content_hash, caption, visibility, folder_id, tags, replaces_file_id, group_id,
        updated_at, updated_by
    ) VALUES (
        v_company_id, v_user_id, p_storage_path, 'filehub-files', v_final_name, p_mime_type,
        p_size_bytes, p_content_hash, NULLIF(trim(coalesce(p_caption, '')), ''),
        p_visibility, v_target_folder, v_clean_tags, p_replaces_file_id,
        CASE WHEN p_visibility = 'group' THEN p_group_id ELSE NULL END,
        now(), v_user_id
    ) RETURNING id INTO v_file_id;

    INSERT INTO public.filehub_file_versions (
        file_id, company_id, version_no, storage_path, bucket,
        original_name, size_bytes, mime_type, content_hash, created_by, superseded_at
    ) VALUES (
        v_file_id, v_company_id, 1, p_storage_path, 'filehub-files',
        v_final_name, p_size_bytes, p_mime_type, p_content_hash, v_user_id, NULL
    ) RETURNING id INTO v_version_id;

    UPDATE public.filehub_files SET current_version_id = v_version_id WHERE id = v_file_id;

    IF p_visibility = 'direct' THEN
        INSERT INTO public.filehub_recipients (file_id, user_id)
        SELECT v_file_id, rid FROM unnest(p_recipient_ids) AS rid
        WHERE rid <> v_user_id
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_file_id;
END;
$$;


ALTER FUNCTION "public"."rpc_filehub_upload_commit"("p_storage_path" "text", "p_visibility" "text", "p_recipient_ids" "uuid"[], "p_folder_id" "uuid", "p_tags" "text"[], "p_caption" "text", "p_original_name" "text", "p_mime_type" "text", "p_size_bytes" bigint, "p_content_hash" "text", "p_replaces_file_id" "uuid", "p_group_id" "uuid", "p_rel_dir" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_files_search"("p_query" "text", "p_sources" "text"[] DEFAULT NULL::"text"[], "p_task_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company uuid := public.my_company_id();
  v_q       text := trim(COALESCE(p_query, ''));
  v_limit   int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_result  jsonb;
BEGIN
  IF v_company IS NULL OR v_q = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source',        r.source,
    'file_id',       r.file_id,
    'bucket',        r.bucket,
    'storage_path',  r.storage_path,
    'file_name',     r.file_name,
    'mime_type',     r.mime_type,
    'size_bytes',    r.size_bytes,
    'category',      r.category,
    'uploaded_by',   r.uploaded_by,
    'created_at',    r.created_at,
    'task_id',       r.task_id,
    'submission_id', r.submission_id,
    'task_title',    CASE WHEN r.task_id IS NOT NULL
                          THEN (SELECT t.title FROM public.tasks t WHERE t.id = r.task_id)
                     END,
    'folder_id',     r.folder_id,
    'group_id',      r.group_id,
    'visibility',    r.visibility
  ) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT c.*
    FROM (
      SELECT fi.*
      FROM public.files_index fi
      WHERE fi.company_id = v_company
        AND (p_sources IS NULL OR fi.source = ANY (p_sources))
        AND (p_task_id IS NULL OR fi.task_id = p_task_id)
        AND (
          fi.file_name ILIKE '%' || v_q || '%'
          OR (fi.source = 'filehub' AND EXISTS (
            SELECT 1 FROM public.filehub_files ff
            WHERE ff.id = fi.file_id
              AND (
                ff.caption ILIKE '%' || v_q || '%'
                OR array_to_string(ff.tags, ' ') ILIKE '%' || v_q || '%'
              )
          ))
        )
      ORDER BY fi.created_at DESC
      -- ponytail: over-fetch 3x so access filtering can still fill p_limit;
      -- heuristic, fine at ~120 files — revisit with pg_trgm when tables hit ~10k+.
      LIMIT v_limit * 3
    ) c
    WHERE CASE
      WHEN c.source = 'filehub' THEN public.filehub_file_accessible(c.file_id)
      ELSE public.task_accessible(c.task_id)
    END
    ORDER BY c.created_at DESC
    LIMIT v_limit
  ) r;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."rpc_files_search"("p_query" "text", "p_sources" "text"[], "p_task_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_flush_pipeline_hours_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_period_end    DATE;
  v_seconds       BIGINT := 0;
  v_live_seconds  BIGINT := 0;
  v_arch_seconds  BIGINT := 0;
  v_company_id    UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.pipelines WHERE id = p_pipeline_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  v_period_end := (p_period_start + ('1 ' || p_period_type)::INTERVAL)::DATE;

  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ws.last_heartbeat_at - ws.started_at))), 0)::BIGINT
    INTO v_live_seconds
    FROM public.task_work_sessions ws
    JOIN public.tasks t ON t.id = ws.task_id
   WHERE t.pipeline_id  = p_pipeline_id
     AND ws.started_at >= p_period_start::timestamptz
     AND ws.started_at  < v_period_end::timestamptz
     AND ws.last_heartbeat_at >= ws.started_at;

  SELECT COALESCE(SUM(
           GREATEST(
             EXTRACT(EPOCH FROM (
               (sess->>'last_heartbeat_at')::timestamptz - (sess->>'started_at')::timestamptz
             )),
             0
           )
         ), 0)::BIGINT
    INTO v_arch_seconds
    FROM public.archives ar
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(ar.snapshot->'work_sessions', '[]'::jsonb)
    ) AS sess
   WHERE ar.company_id  = v_company_id
     AND ar.entity_type = 'task'
     AND (ar.snapshot->'task'->>'pipeline_id') = p_pipeline_id::text
     AND (sess->>'started_at')::timestamptz >= p_period_start::timestamptz
     AND (sess->>'started_at')::timestamptz  < v_period_end::timestamptz;

  v_seconds := v_live_seconds + v_arch_seconds;

  INSERT INTO public.analytics_snapshots (company_id, snapshot_type, subject_id, period_type, period_start, data, computed_at)
  VALUES (
    v_company_id,
    'pipeline_hours',
    p_pipeline_id,
    p_period_type,
    p_period_start,
    jsonb_build_object('active_seconds', v_seconds),
    NOW()
  )
  ON CONFLICT (company_id, snapshot_type, subject_id, period_type, period_start)
  DO UPDATE SET data = EXCLUDED.data, computed_at = EXCLUDED.computed_at;
END;
$$;


ALTER FUNCTION "public"."rpc_flush_pipeline_hours_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_flush_pipeline_points_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_period_end   DATE;
  v_points       BIGINT := 0;
  v_live_points  BIGINT := 0;
  v_arch_points  BIGINT := 0;
  v_company_id   UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.pipelines WHERE id = p_pipeline_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  v_period_end := (p_period_start + ('1 ' || p_period_type)::INTERVAL)::DATE;

  -- Live tasks completed in this period
  SELECT COALESCE(SUM(t.weight), 0)::BIGINT
    INTO v_live_points
    FROM public.tasks t
   WHERE t.pipeline_id  = p_pipeline_id
     AND t.completed_at >= p_period_start::timestamptz
     AND t.completed_at  < v_period_end::timestamptz;

  -- Archived tasks completed in this period (same pattern as rpc_flush_pipeline_snapshot)
  SELECT COALESCE(SUM((ar.snapshot->'task'->>'weight')::numeric), 0)::BIGINT
    INTO v_arch_points
    FROM public.archives ar
   WHERE ar.company_id  = v_company_id
     AND ar.entity_type = 'task'
     AND (ar.snapshot->'task'->>'pipeline_id') = p_pipeline_id::text
     AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_period_start::timestamptz
     AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_period_end::timestamptz;

  v_points := v_live_points + v_arch_points;

  INSERT INTO public.analytics_snapshots (company_id, snapshot_type, subject_id, period_type, period_start, data, computed_at)
  VALUES (
    v_company_id,
    'pipeline_points',
    p_pipeline_id,
    p_period_type,
    p_period_start,
    jsonb_build_object('weight_points', v_points),
    NOW()
  )
  ON CONFLICT (company_id, snapshot_type, subject_id, period_type, period_start)
  DO UPDATE SET data = EXCLUDED.data, computed_at = EXCLUDED.computed_at;
END;
$$;


ALTER FUNCTION "public"."rpc_flush_pipeline_points_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_flush_pipeline_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id   uuid;
  v_period_end   date;
  v_entered      bigint := 0;
  v_succeeded    bigint := 0;
  v_failed       bigint := 0;
  v_in_progress  bigint := 0;
  v_stage_dwell  jsonb  := '{}';
  v_d_entered    bigint;
  v_d_succeeded  bigint;
  v_d_failed     bigint;
  v_stage_rec    RECORD;
BEGIN
  SELECT company_id INTO v_company_id FROM public.pipelines WHERE id = p_pipeline_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  v_period_end := (p_period_start + ('1 ' || p_period_type)::interval)::date;

  -- ── TASKS ENTERED (initial transition) ────────────────────────────────────
  SELECT COUNT(DISTINCT task_id)
  INTO v_d_entered
  FROM public.pipeline_stage_history
  WHERE pipeline_id   = p_pipeline_id
    AND from_stage_id IS NULL
    AND transitioned_at >= p_period_start::timestamptz
    AND transitioned_at <  v_period_end::timestamptz;

  v_entered := v_d_entered;

  -- Archived tasks that entered this pipeline in the period
  SELECT COUNT(*)
  INTO v_d_entered
  FROM public.archives ar,
       jsonb_array_elements(ar.snapshot->'history') AS h_el
  WHERE ar.company_id  = v_company_id
    AND ar.entity_type = 'task'
    AND (ar.snapshot->'task'->>'pipeline_id') = p_pipeline_id::text
    AND h_el->>'from_stage_id' IS NULL
    AND (h_el->>'transitioned_at')::timestamptz >= p_period_start::timestamptz
    AND (h_el->>'transitioned_at')::timestamptz <  v_period_end::timestamptz;

  v_entered := v_entered + v_d_entered;

  -- ── TERMINAL TASKS (live) ────────────────────────────────────────────────
  SELECT
    COALESCE(SUM(CASE WHEN ps.terminal_type = 'success' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ps.terminal_type = 'failure' THEN 1 ELSE 0 END), 0)
  INTO v_d_succeeded, v_d_failed
  FROM public.tasks t
  JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
  WHERE t.pipeline_id  = p_pipeline_id
    AND ps.is_terminal = true
    AND t.completed_at >= p_period_start::timestamptz
    AND t.completed_at <  v_period_end::timestamptz;

  v_succeeded := v_d_succeeded;
  v_failed    := v_d_failed;

  -- Terminal archived tasks
  SELECT
    v_succeeded + COALESCE(SUM(CASE
      WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
           (SELECT id FROM public.pipeline_stages WHERE terminal_type = 'success')
      THEN 1 ELSE 0 END), 0),
    v_failed + COALESCE(SUM(CASE
      WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
           (SELECT id FROM public.pipeline_stages WHERE terminal_type = 'failure')
      THEN 1 ELSE 0 END), 0)
  INTO v_succeeded, v_failed
  FROM public.archives ar
  WHERE ar.company_id  = v_company_id
    AND ar.entity_type = 'task'
    AND (ar.snapshot->'task'->>'pipeline_id') = p_pipeline_id::text
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_period_start::timestamptz
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_period_end::timestamptz;

  -- In-progress (live, non-terminal)
  SELECT COUNT(*)
  INTO v_in_progress
  FROM public.tasks t
  JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
  WHERE t.pipeline_id   = p_pipeline_id
    AND ps.is_terminal  = false;

  -- ── STAGE DWELL ──────────────────────────────────────────────────────────
  -- Combines live pipeline_stage_history + archived history arrays.
  -- LEAD gives exit time per task; filter to entries that started in the period.
  FOR v_stage_rec IN
    WITH live_transitions AS (
      SELECT
        to_stage_id                                                   AS stage_id,
        transitioned_at                                               AS entered_at,
        LEAD(transitioned_at) OVER (
          PARTITION BY task_id ORDER BY transitioned_at
        )                                                             AS exited_at
      FROM public.pipeline_stage_history
      WHERE pipeline_id = p_pipeline_id
    ),
    archived_transitions AS (
      SELECT
        (h_el->>'to_stage_id')::uuid                                 AS stage_id,
        (h_el->>'transitioned_at')::timestamptz                      AS entered_at,
        LEAD((h_el->>'transitioned_at')::timestamptz) OVER (
          PARTITION BY ar.entity_id ORDER BY (h_el->>'transitioned_at')::timestamptz
        )                                                             AS exited_at
      FROM public.archives ar,
           jsonb_array_elements(ar.snapshot->'history') AS h_el
      WHERE ar.company_id  = v_company_id
        AND ar.entity_type = 'task'
        AND (ar.snapshot->'task'->>'pipeline_id') = p_pipeline_id::text
    ),
    all_dwell AS (
      SELECT stage_id, EXTRACT(EPOCH FROM (exited_at - entered_at))::bigint AS dwell_seconds
      FROM live_transitions
      WHERE exited_at IS NOT NULL
        AND entered_at >= p_period_start::timestamptz
        AND entered_at <  v_period_end::timestamptz
      UNION ALL
      SELECT stage_id, EXTRACT(EPOCH FROM (exited_at - entered_at))::bigint AS dwell_seconds
      FROM archived_transitions
      WHERE exited_at IS NOT NULL
        AND entered_at >= p_period_start::timestamptz
        AND entered_at <  v_period_end::timestamptz
    )
    SELECT
      ps.id::text                                                     AS stage_id,
      ps.name                                                         AS stage_name,
      AVG(d.dwell_seconds)::bigint                                    AS avg_seconds,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.dwell_seconds)::bigint
                                                                      AS median_seconds,
      COUNT(d.dwell_seconds)::bigint                                  AS sample_count
    FROM all_dwell d
    JOIN public.pipeline_stages ps ON ps.id = d.stage_id
    GROUP BY ps.id, ps.name
  LOOP
    v_stage_dwell := v_stage_dwell || jsonb_build_object(
      v_stage_rec.stage_id,
      jsonb_build_object(
        'stage_name',     v_stage_rec.stage_name,
        'avg_seconds',    v_stage_rec.avg_seconds,
        'median_seconds', v_stage_rec.median_seconds,
        'sample_count',   v_stage_rec.sample_count
      )
    );
  END LOOP;

  -- ── UPSERT ────────────────────────────────────────────────────────────────
  INSERT INTO public.analytics_snapshots
    (company_id, snapshot_type, subject_id, period_type, period_start, data, computed_at)
  VALUES (
    v_company_id, 'pipeline_performance', p_pipeline_id, p_period_type, p_period_start,
    jsonb_build_object(
      'tasks_entered',     v_entered,
      'tasks_succeeded',   v_succeeded,
      'tasks_failed',      v_failed,
      'tasks_in_progress', v_in_progress,
      'stage_dwell',       v_stage_dwell
    ),
    now()
  )
  ON CONFLICT (company_id, snapshot_type, subject_id, period_type, period_start)
  DO UPDATE SET
    data        = EXCLUDED.data,
    computed_at = now();
END;
$$;


ALTER FUNCTION "public"."rpc_flush_pipeline_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_flush_user_snapshot"("p_user_id" "uuid", "p_period_type" "text", "p_period_start" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id      uuid;
  v_period_end      date;
  v_weight_pts      bigint  := 0;
  v_active_secs     bigint  := 0;
  v_est_secs        numeric := 0;
  v_completed       bigint  := 0;
  v_failed          bigint  := 0;
  v_revision_cnt    bigint  := 0;
  v_on_time         bigint  := 0;
  v_within_budget   bigint  := 0;
  v_over_budget     bigint  := 0;
  v_d_weight        bigint;
  v_d_completed     bigint;
  v_d_failed        bigint;
  v_d_est           numeric;
  v_d_on_time       bigint;
  v_d_within        bigint;
  v_d_over          bigint;
  v_d_secs          bigint;
  v_d_rev           bigint;
BEGIN
  SELECT company_id INTO v_company_id FROM public.users WHERE id = p_user_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  v_period_end := (p_period_start + ('1 ' || p_period_type)::interval)::date;

  -- ── LIVE TASKS ────────────────────────────────────────────────────────────
  SELECT
    COALESCE(SUM(CASE WHEN ps.terminal_type = 'success' THEN t.weight ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ps.terminal_type = 'success' THEN 1         ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ps.terminal_type = 'failure' THEN 1         ELSE 0 END), 0),
    COALESCE(SUM(COALESCE(t.estimated_hours, 0) * 3600), 0),
    COALESCE(SUM(CASE WHEN t.due_date IS NOT NULL
                       AND t.completed_at <= t.due_date THEN 1 ELSE 0 END), 0)
  INTO v_d_weight, v_d_completed, v_d_failed, v_d_est, v_d_on_time
  FROM public.tasks t
  JOIN public.task_assignments ta
    ON ta.task_id = t.id AND ta.assignee_user_id = p_user_id
  JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
  WHERE t.company_id   = v_company_id
    AND ps.is_terminal = true
    AND t.completed_at >= p_period_start::timestamptz
    AND t.completed_at <  v_period_end::timestamptz;

  v_weight_pts := v_d_weight;
  v_completed  := v_d_completed;
  v_failed     := v_d_failed;
  v_est_secs   := v_d_est;
  v_on_time    := v_d_on_time;

  -- within/over budget for live completed tasks
  SELECT
    COALESCE(SUM(CASE
      WHEN ps.terminal_type = 'success'
       AND t.estimated_hours IS NOT NULL AND t.estimated_hours > 0
       AND COALESCE(ws_agg.spent_secs, 0) <= t.estimated_hours * 3600
      THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN ps.terminal_type = 'success'
       AND t.estimated_hours IS NOT NULL AND t.estimated_hours > 0
       AND COALESCE(ws_agg.spent_secs, 0) > t.estimated_hours * 3600
      THEN 1 ELSE 0 END), 0)
  INTO v_d_within, v_d_over
  FROM public.tasks t
  JOIN public.task_assignments ta
    ON ta.task_id = t.id AND ta.assignee_user_id = p_user_id
  JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
  LEFT JOIN (
    SELECT task_id, SUM(total_seconds_spent) AS spent_secs
    FROM public.task_work_sessions
    WHERE user_id = p_user_id AND status = 'completed'
    GROUP BY task_id
  ) ws_agg ON ws_agg.task_id = t.id
  WHERE t.company_id   = v_company_id
    AND ps.is_terminal = true
    AND t.completed_at >= p_period_start::timestamptz
    AND t.completed_at <  v_period_end::timestamptz;

  v_within_budget := v_d_within;
  v_over_budget   := v_d_over;

  -- Live work sessions
  SELECT COALESCE(SUM(ws.total_seconds_spent), 0)
  INTO v_d_secs
  FROM public.task_work_sessions ws
  WHERE ws.user_id    = p_user_id
    AND ws.company_id = v_company_id
    AND ws.status     = 'completed'
    AND ws.started_at >= p_period_start::timestamptz
    AND ws.started_at <  v_period_end::timestamptz;

  v_active_secs := v_d_secs;

  -- Live revisions
  SELECT COALESCE(SUM(ts.revision_count), 0)
  INTO v_d_rev
  FROM public.task_submissions ts
  WHERE ts.submitted_by  = p_user_id
    AND ts.company_id    = v_company_id
    AND ts.submitted_at >= p_period_start::timestamptz
    AND ts.submitted_at <  v_period_end::timestamptz;

  v_revision_cnt := v_d_rev;

  -- ── ARCHIVED TASKS ────────────────────────────────────────────────────────
  SELECT
    COALESCE(SUM(CASE
      WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
           (SELECT id FROM public.pipeline_stages WHERE terminal_type = 'success')
      THEN (ar.snapshot->'task'->>'weight')::bigint ELSE 0
    END), 0),
    COALESCE(SUM(CASE
      WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
           (SELECT id FROM public.pipeline_stages WHERE terminal_type = 'success')
      THEN 1 ELSE 0
    END), 0),
    COALESCE(SUM(CASE
      WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
           (SELECT id FROM public.pipeline_stages WHERE terminal_type = 'failure')
      THEN 1 ELSE 0
    END), 0),
    COALESCE(SUM(COALESCE((ar.snapshot->'task'->>'estimated_hours')::numeric, 0) * 3600), 0),
    COALESCE(SUM(CASE
      WHEN ar.snapshot->'task'->>'due_date' IS NOT NULL
       AND (ar.snapshot->'task'->>'completed_at')::timestamptz
            <= (ar.snapshot->'task'->>'due_date')::timestamptz
      THEN 1 ELSE 0
    END), 0)
  INTO v_d_weight, v_d_completed, v_d_failed, v_d_est, v_d_on_time
  FROM public.archives ar
  WHERE ar.company_id  = v_company_id
    AND ar.entity_type = 'task'
    AND ar.metadata    @> jsonb_build_object('involved_user_ids', jsonb_build_array(p_user_id))
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_period_start::timestamptz
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_period_end::timestamptz;

  v_weight_pts := v_weight_pts + v_d_weight;
  v_completed  := v_completed  + v_d_completed;
  v_failed     := v_failed     + v_d_failed;
  v_est_secs   := v_est_secs   + v_d_est;
  v_on_time    := v_on_time    + v_d_on_time;

  -- within/over budget for archived tasks
  SELECT
    COALESCE(SUM(CASE
      WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
           (SELECT id FROM public.pipeline_stages WHERE terminal_type = 'success')
       AND (ar.snapshot->'task'->>'estimated_hours')::numeric IS NOT NULL
       AND (ar.snapshot->'task'->>'estimated_hours')::numeric > 0
       AND COALESCE(ws_spent.spent_secs, 0)
            <= (ar.snapshot->'task'->>'estimated_hours')::numeric * 3600
      THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
           (SELECT id FROM public.pipeline_stages WHERE terminal_type = 'success')
       AND (ar.snapshot->'task'->>'estimated_hours')::numeric IS NOT NULL
       AND (ar.snapshot->'task'->>'estimated_hours')::numeric > 0
       AND COALESCE(ws_spent.spent_secs, 0)
            > (ar.snapshot->'task'->>'estimated_hours')::numeric * 3600
      THEN 1 ELSE 0 END), 0)
  INTO v_d_within, v_d_over
  FROM public.archives ar
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM((ws_el->>'total_seconds_spent')::bigint), 0) AS spent_secs
    FROM jsonb_array_elements(ar.snapshot->'work_sessions') AS ws_el
    WHERE (ws_el->>'user_id')::uuid = p_user_id
      AND ws_el->>'status' = 'completed'
  ) ws_spent ON TRUE
  WHERE ar.company_id  = v_company_id
    AND ar.entity_type = 'task'
    AND ar.metadata    @> jsonb_build_object('involved_user_ids', jsonb_build_array(p_user_id))
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_period_start::timestamptz
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_period_end::timestamptz;

  v_within_budget := v_within_budget + v_d_within;
  v_over_budget   := v_over_budget   + v_d_over;

  -- Archived work sessions
  SELECT COALESCE(SUM((ws_el->>'total_seconds_spent')::bigint), 0)
  INTO v_d_secs
  FROM public.archives ar,
       jsonb_array_elements(ar.snapshot->'work_sessions') AS ws_el
  WHERE ar.company_id  = v_company_id
    AND ar.entity_type = 'task'
    AND ar.metadata    @> jsonb_build_object('involved_user_ids', jsonb_build_array(p_user_id))
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_period_start::timestamptz
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_period_end::timestamptz
    AND (ws_el->>'user_id')::uuid = p_user_id
    AND ws_el->>'status' = 'completed'
    AND (ws_el->>'started_at')::timestamptz >= p_period_start::timestamptz
    AND (ws_el->>'started_at')::timestamptz <  v_period_end::timestamptz;

  v_active_secs := v_active_secs + v_d_secs;

  -- Archived revisions
  SELECT COALESCE(SUM((sub_el->'submission'->>'revision_count')::integer), 0)
  INTO v_d_rev
  FROM public.archives ar,
       jsonb_array_elements(ar.snapshot->'submissions') AS sub_el
  WHERE ar.company_id  = v_company_id
    AND ar.entity_type = 'task'
    AND ar.metadata    @> jsonb_build_object('involved_user_ids', jsonb_build_array(p_user_id))
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_period_start::timestamptz
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_period_end::timestamptz
    AND (sub_el->'submission'->>'submitted_by')::uuid = p_user_id
    AND (sub_el->'submission'->>'submitted_at')::timestamptz >= p_period_start::timestamptz
    AND (sub_el->'submission'->>'submitted_at')::timestamptz <  v_period_end::timestamptz;

  v_revision_cnt := v_revision_cnt + v_d_rev;

  -- ── UPSERT ────────────────────────────────────────────────────────────────
  INSERT INTO public.analytics_snapshots
    (company_id, snapshot_type, subject_id, period_type, period_start, data, computed_at)
  VALUES (
    v_company_id, 'user_performance', p_user_id, p_period_type, p_period_start,
    jsonb_build_object(
      'weight_points',       v_weight_pts,
      'active_seconds',      v_active_secs,
      'estimated_seconds',   v_est_secs,
      'completed_tasks',     v_completed,
      'failed_tasks',        v_failed,
      'revision_count',      v_revision_cnt,
      'on_time_tasks',       v_on_time,
      'within_budget_tasks', v_within_budget,
      'over_budget_tasks',   v_over_budget
    ),
    now()
  )
  ON CONFLICT (company_id, snapshot_type, subject_id, period_type, period_start)
  DO UPDATE SET
    data        = EXCLUDED.data,
    computed_at = now();
END;
$$;


ALTER FUNCTION "public"."rpc_flush_user_snapshot"("p_user_id" "uuid", "p_period_type" "text", "p_period_start" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_force_stop_session"("p_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_session            RECORD;
    v_caller_company_id  UUID;
    v_use_bus            BOOLEAN;
    v_duration_sec       INTEGER;
BEGIN
    SELECT company_id INTO v_caller_company_id FROM public.users WHERE id = auth.uid();

    IF NOT public.has_permission('archive:create')
       AND NOT public.has_permission('pipeline.edit') THEN
        RAISE EXCEPTION 'Access Denied: Insufficient permissions.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_session FROM public.task_work_sessions
    WHERE id = p_session_id AND status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found or already stopped.' USING ERRCODE = 'P0002';
    END IF;

    IF v_session.company_id != v_caller_company_id THEN
        RAISE EXCEPTION 'Security Breach: cross-company force-stop attempt.' USING ERRCODE = '42501';
    END IF;

    -- Only a stale heartbeat may be force-stopped -- never a session that's
    -- still genuinely pulsing. Keep in sync with IDLE_MS in lib/sessionPresence.ts.
    IF v_session.last_heartbeat_at >= now() - interval '90 seconds' THEN
        RAISE EXCEPTION 'Concurrency Lock: this timer is still active -- cannot force-stop a live session.'
            USING ERRCODE = '55006';
    END IF;

    SELECT s.use_business_hours INTO v_use_bus
    FROM public.tasks t
    JOIN public.pipeline_stages s ON t.current_stage_id = s.id
    WHERE t.id = v_session.task_id;

    IF COALESCE(v_use_bus, FALSE) THEN
        v_duration_sec := COALESCE(EXTRACT(EPOCH FROM public.fn_calculate_business_duration(
            v_session.started_at, v_session.last_heartbeat_at))::INTEGER, 0);
    ELSE
        v_duration_sec := COALESCE(EXTRACT(EPOCH FROM
            (v_session.last_heartbeat_at - v_session.started_at))::INTEGER, 0);
    END IF;
    v_duration_sec := GREATEST(v_duration_sec, 1);

    UPDATE public.task_work_sessions
    SET status              = 'completed',
        completed_at        = v_session.last_heartbeat_at,
        total_seconds_spent = v_duration_sec,
        notes = CASE
                    WHEN notes LIKE '%[force-stopped]%' THEN notes
                    ELSE COALESCE(notes, '') || ' [force-stopped]'
                END
    WHERE id = v_session.id;

    -- Same notification the 8h sweep sends on an inactivity close -- this is
    -- the same thing happening sooner, by a person instead of the timer.
    PERFORM public.rpc_notify_timer_auto_stopped(
        v_session.task_id,
        (SELECT title FROM public.tasks WHERE id = v_session.task_id),
        v_duration_sec,
        v_session.user_id
    );

    RETURN jsonb_build_object(
        'status',     'force_stopped',
        'session_id', v_session.id,
        'task_id',    v_session.task_id,
        'duration',   v_duration_sec
    );
END;
$$;


ALTER FUNCTION "public"."rpc_force_stop_session"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_generate_trial_code"("p_plan_code" "text", "p_duration_hours" integer, "p_max_redemptions" integer DEFAULT 1, "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_code text;
  v_id   uuid;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_plans WHERE code = p_plan_code AND is_active = true) THEN
    RAISE EXCEPTION 'Unknown plan: %', p_plan_code;
  END IF;
  IF p_duration_hours < 1 OR p_duration_hours > 17520 THEN
    RAISE EXCEPTION 'Duration must be between 1 and 17520 hours.';
  END IF;

  v_code := upper(format('TF-%s-%sH-%s',
    p_plan_code, p_duration_hours,
    left(replace(gen_random_uuid()::text, '-', ''), 4)
  ));

  INSERT INTO public.trial_codes (code, plan_code, duration_hours, max_redemptions, expires_at, created_by, notes)
  VALUES (v_code, p_plan_code, p_duration_hours, p_max_redemptions, p_expires_at, auth.uid(), p_notes)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('code', v_code, 'id', v_id);
END;
$$;


ALTER FUNCTION "public"."rpc_generate_trial_code"("p_plan_code" "text", "p_duration_hours" integer, "p_max_redemptions" integer, "p_expires_at" timestamp with time zone, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_active_task_counts"("p_pipeline_id" "uuid", "p_type" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_type = 'user' THEN
        SELECT jsonb_agg(row_to_json(t))
        INTO v_result
        FROM (
            SELECT 
                u.id, 
                COUNT(ts.id) as count
            FROM public.users u
            LEFT JOIN public.task_assignments ta ON u.id = ta.assignee_user_id
            LEFT JOIN public.tasks ts ON ta.task_id = ts.id AND ts.pipeline_id = p_pipeline_id
            LEFT JOIN public.pipeline_stages s ON ts.current_stage_id = s.id AND s.is_terminal = false
            WHERE u.deleted_at IS NULL
            GROUP BY u.id
        ) t;
    ELSIF p_type = 'team' THEN
        SELECT jsonb_agg(row_to_json(t))
        INTO v_result
        FROM (
            SELECT 
                tm.id, 
                COUNT(ts.id) as count
            FROM public.teams tm
            LEFT JOIN public.task_assignments ta ON tm.id = ta.assignee_team_id
            LEFT JOIN public.tasks ts ON ta.task_id = ts.id AND ts.pipeline_id = p_pipeline_id
            LEFT JOIN public.pipeline_stages s ON ts.current_stage_id = s.id AND s.is_terminal = false
            WHERE tm.deleted_at IS NULL
            GROUP BY tm.id
        ) t;
    END IF;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."rpc_get_active_task_counts"("p_pipeline_id" "uuid", "p_type" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."archives" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"(),
    "archived_by" "uuid",
    "search_vector" "tsvector",
    "restored_at" timestamp with time zone,
    "restored_by" "uuid",
    CONSTRAINT "archives_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['task'::"text", 'project'::"text", 'report'::"text"])))
);


ALTER TABLE "public"."archives" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_archives"("p_entity_type" "text" DEFAULT NULL::"text", "p_search" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."archives"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT * FROM public.archives
    WHERE company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
      AND public.has_permission('archive.view')
      AND (p_entity_type IS NULL OR entity_type = p_entity_type)
      AND (p_search IS NULL OR (
          search_vector @@ websearch_to_tsquery('english', p_search) OR
          metadata->>'title' ILIKE '%' || p_search || '%'
      ))
    ORDER BY archived_at DESC;
$$;


ALTER FUNCTION "public"."rpc_get_archives"("p_entity_type" "text", "p_search" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_invitation_by_email"("p_email" "text") RETURNS TABLE("company_name" "text", "invited_by_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.name as company_name,
        u.full_name as invited_by_name
    FROM public.invitations i
    JOIN public.companies c ON i.company_id = c.id
    LEFT JOIN public.users u ON i.invited_by = u.id
    WHERE i.email = p_email
      AND i.status = 'pending'
      AND i.expires_at > NOW()
    ORDER BY i.created_at DESC
    LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."rpc_get_invitation_by_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_my_pending_time_approvals"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',               e.id,
        'declared_minutes', e.declared_minutes,
        'reason',           e.reason,
        'flag_reason',      e.flag_reason,
        'logged_at',        e.logged_at,
        'task_id',          e.task_id,
        'task_title',       t.title,
        'worker',           jsonb_build_object(
          'id',         u.id,
          'full_name',  u.full_name,
          'avatar_url', u.avatar_url
        )
      )
      ORDER BY e.logged_at DESC
    )
    FROM public.task_manual_time_entries e
    JOIN public.tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
    JOIN public.users u ON u.id = e.user_id
    WHERE e.approval_status = 'pending'
      AND t.manager_id = v_user_id
  ), '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."rpc_get_my_pending_time_approvals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_organizational_audit"("p_pipeline_id" "uuid" DEFAULT NULL::"uuid", "p_days" integer DEFAULT 30, "p_team_id" "uuid" DEFAULT NULL::"uuid", "p_worker_id" "uuid" DEFAULT NULL::"uuid", "p_priority" "text" DEFAULT NULL::"text", "p_project_id" "uuid" DEFAULT NULL::"uuid", "p_date_start" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_date_end" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_auth_user_id" "uuid" DEFAULT NULL::"uuid", "p_include_time_metrics" boolean DEFAULT true, "p_include_advanced" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_start_date TIMESTAMPTZ;
  v_end_date   TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_result     JSONB;
BEGIN
  v_company_id := COALESCE(
    public.my_company_id(),
    (SELECT company_id FROM public.users WHERE id = p_auth_user_id)
  );
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'User does not belong to any company';
  END IF;

  IF p_date_start IS NOT NULL AND p_date_end IS NOT NULL THEN
    v_start_date := p_date_start;
    v_end_date   := p_date_end;
  ELSE
    v_end_date   := NOW();
    v_start_date := v_end_date - (p_days || ' days')::INTERVAL;
  END IF;
  v_prev_start := v_start_date - (v_end_date - v_start_date);

  WITH
  base_tasks AS (
    SELECT
      t.id, t.title, t.pipeline_id, t.project_id, t.current_stage_id,
      t.created_at, t.completed_at, t.priority,
      t.due_date, t.estimated_hours, t.start_date,
      ps.name AS stage_name, ps.position AS stage_position, ps.terminal_type
    FROM public.tasks t
    JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.company_id  = v_company_id
      AND t.deleted_at  IS NULL
      AND t.created_at  >= v_start_date
      AND t.created_at  <= v_end_date
      AND (p_pipeline_id IS NULL OR t.pipeline_id  = p_pipeline_id)
      AND (p_project_id  IS NULL OR t.project_id   = p_project_id)
      AND (p_priority    IS NULL OR t.priority      = p_priority)
      AND (p_team_id IS NULL OR EXISTS (
            SELECT 1 FROM public.task_assignments ta
            WHERE ta.task_id = t.id AND ta.assignee_team_id = p_team_id))
      AND (p_worker_id IS NULL OR EXISTS (
            SELECT 1 FROM public.task_assignments ta
            WHERE ta.task_id = t.id AND ta.assignee_user_id = p_worker_id))
  ),
  task_rev_flag AS (
    SELECT ts.task_id,
      MAX(CASE WHEN ts.status IN ('needs_revision', 'rejected') THEN 1 ELSE 0 END) AS had_revision
    FROM public.task_submissions ts
    WHERE ts.company_id = v_company_id
    GROUP BY ts.task_id
  ),
  cur_kpi AS (
    SELECT
      COUNT(bt.id) AS throughput,
      COALESCE(ROUND(COUNT(CASE WHEN bt.terminal_type = 'success' THEN 1 END)::NUMERIC /
        NULLIF(COUNT(bt.id), 0) * 100, 2), 0) AS success_rate,
      COALESCE(ROUND(AVG(CASE WHEN bt.terminal_type IS NOT NULL AND bt.completed_at IS NOT NULL
               THEN EXTRACT(EPOCH FROM (bt.completed_at - bt.created_at)) / 60 ELSE NULL END), 2), 0) AS avg_lead_time_minutes,
      COALESCE(ROUND(SUM(COALESCE(trf.had_revision, 0))::NUMERIC /
        NULLIF(COUNT(bt.id), 0) * 100, 2), 0) AS revision_rate
    FROM base_tasks bt
    LEFT JOIN task_rev_flag trf ON trf.task_id = bt.id
  ),
  prev_kpi AS (
    SELECT
      COUNT(DISTINCT t.id) AS throughput,
      COALESCE(ROUND(COUNT(DISTINCT CASE WHEN ps.terminal_type = 'success' THEN t.id END)::NUMERIC /
        NULLIF(COUNT(DISTINCT t.id), 0) * 100, 2), 0) AS success_rate,
      COALESCE(ROUND(AVG(CASE WHEN ps.terminal_type IS NOT NULL AND t.completed_at IS NOT NULL
               THEN EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 60 ELSE NULL END), 2), 0) AS avg_lead_time_minutes,
      COALESCE(ROUND(COUNT(DISTINCT CASE WHEN ts.revision_count > 0 THEN t.id END)::NUMERIC /
        NULLIF(COUNT(DISTINCT t.id), 0) * 100, 2), 0) AS revision_rate
    FROM public.tasks t
    JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    LEFT JOIN public.task_submissions ts ON ts.task_id = t.id
    WHERE t.company_id = v_company_id AND t.deleted_at IS NULL
      AND t.created_at >= v_prev_start AND t.created_at < v_start_date
      AND (p_pipeline_id IS NULL OR t.pipeline_id = p_pipeline_id)
  ),
  adv_kpi AS (
    SELECT
      COALESCE(ROUND(COUNT(CASE WHEN bt.terminal_type = 'success' THEN 1 END)::NUMERIC /
        NULLIF(COUNT(bt.id), 0) * 100, 1), 0) AS flow_ratio,
      COALESCE(ROUND(COUNT(DISTINCT CASE WHEN COALESCE(trf.had_revision, 0) = 0 THEN bt.id END)::NUMERIC /
        NULLIF(COUNT(bt.id), 0) * 100, 1), 0) AS first_pass_yield
    FROM base_tasks bt
    LEFT JOIN task_rev_flag trf ON trf.task_id = bt.id
  ),
  stage_transitions AS (
    SELECT psh.task_id, psh.to_stage_id AS stage_id, psh.to_stage_name AS stage_name,
      psh.transitioned_at AS entered_at,
      LEAD(psh.transitioned_at) OVER (PARTITION BY psh.task_id ORDER BY psh.transitioned_at) AS exited_at
    FROM public.pipeline_stage_history psh
    WHERE psh.company_id = v_company_id
      AND (p_pipeline_id IS NULL OR psh.pipeline_id = p_pipeline_id)
  ),
  stage_dur_agg AS (
    SELECT ps.id AS stage_id, ps.name AS stage_name, ps.position, pip.name AS pipeline_name,
      COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(st.exited_at, NOW()) - st.entered_at)) / 86400)::NUMERIC, 2), 0) AS avg_duration_days
    FROM public.pipeline_stages ps
    JOIN public.pipelines pip ON pip.id = ps.pipeline_id AND pip.company_id = v_company_id AND pip.deleted_at IS NULL
    LEFT JOIN stage_transitions st ON st.stage_id = ps.id AND st.entered_at >= v_start_date AND st.entered_at <= v_end_date
    WHERE (p_pipeline_id IS NULL OR ps.pipeline_id = p_pipeline_id)
    GROUP BY ps.id, ps.name, ps.position, pip.name
  ),
  funnel_counts AS (
    SELECT ps.id AS stage_id, ps.name AS stage_name, ps.position, pip.name AS pipeline_name, COUNT(bt.id) AS task_count
    FROM public.pipeline_stages ps
    JOIN public.pipelines pip ON pip.id = ps.pipeline_id AND pip.company_id = v_company_id AND pip.deleted_at IS NULL
    LEFT JOIN base_tasks bt ON bt.current_stage_id = ps.id
    WHERE (p_pipeline_id IS NULL OR ps.pipeline_id = p_pipeline_id)
    GROUP BY ps.id, ps.name, ps.position, pip.name
  ),
  funnel_final AS (
    SELECT fc.stage_name, fc.pipeline_name, fc.position, fc.task_count,
      COALESCE(ROUND(fc.task_count::NUMERIC / NULLIF((SELECT SUM(task_count) FROM funnel_counts), 0), 4), 0) AS completion_rate
    FROM funnel_counts fc
  ),
  stage_avg_dwell AS (
    SELECT stage_id,
      AVG(EXTRACT(EPOCH FROM (exited_at - entered_at))) AS avg_seconds,
      COUNT(*) AS n
    FROM stage_transitions
    WHERE exited_at IS NOT NULL AND EXTRACT(EPOCH FROM (exited_at - entered_at)) >= 300
    GROUP BY stage_id
  ),
  latest_stage_entry AS (
    SELECT DISTINCT ON (psh.task_id) psh.task_id, psh.to_stage_id AS stage_id, psh.transitioned_at AS entered_at
    FROM public.pipeline_stage_history psh
    WHERE psh.company_id = v_company_id
    ORDER BY psh.task_id, psh.transitioned_at DESC
  ),
  pipeline_stage_counts AS (
    SELECT ps.pipeline_id, COUNT(*) AS total_stages
    FROM public.pipeline_stages ps
    WHERE ps.terminal_type IS NULL
    GROUP BY ps.pipeline_id
  ),
  sla_candidates AS (
    SELECT bt.id, bt.title AS task_number, bt.pipeline_id, bt.stage_name, bt.stage_position,
      bt.due_date, bt.estimated_hours, le.entered_at AS stage_entered_at,
      EXTRACT(EPOCH FROM (NOW() - le.entered_at)) AS elapsed_in_stage,
      sad.avg_seconds AS cur_stage_avg,
      sad.n AS cur_stage_n
    FROM base_tasks bt
    JOIN latest_stage_entry le ON le.task_id = bt.id AND le.stage_id = bt.current_stage_id
    LEFT JOIN stage_avg_dwell sad ON sad.stage_id = bt.current_stage_id
    WHERE bt.terminal_type IS NULL
      AND (bt.due_date IS NOT NULL OR bt.estimated_hours IS NOT NULL)
  ),
  downstream_remaining AS (
    SELECT sc.id AS task_id,
      COALESCE(SUM(COALESCE(sad.avg_seconds, 0)), 0) AS downstream_seconds,
      COUNT(ps_all.id) AS downstream_count
    FROM sla_candidates sc
    LEFT JOIN public.pipeline_stages ps_all
      ON ps_all.pipeline_id = sc.pipeline_id AND ps_all.position > sc.stage_position AND ps_all.terminal_type IS NULL
    LEFT JOIN stage_avg_dwell sad ON sad.stage_id = ps_all.id
    GROUP BY sc.id
  ),
  task_logged AS (
    SELECT tws.task_id, SUM(tws.total_seconds_spent) AS logged_seconds
    FROM public.task_work_sessions tws
    JOIN sla_candidates sc ON sc.id = tws.task_id
    GROUP BY tws.task_id
  ),
  sla_scored AS (
    SELECT sc.id, sc.task_number, sc.stage_name, sc.due_date, sc.cur_stage_avg,
      CASE
        WHEN sc.cur_stage_avg > 0 AND COALESCE(sc.cur_stage_n, 0) >= 5
        THEN sc.elapsed_in_stage / (sc.cur_stage_avg * 1.5) * 100
             * CASE
                 WHEN sc.due_date IS NULL OR sc.due_date <= NOW() THEN 1.0
                 ELSE GREATEST(0.4, LEAST(1.0,
                   1 - (EXTRACT(EPOCH FROM (sc.due_date - NOW())) / 86400) / 30.0))
               END
        ELSE NULL END AS stall_pct,
      CASE
        WHEN sc.due_date IS NULL  THEN NULL
        WHEN sc.due_date <= NOW() THEN 999
        ELSE (COALESCE(dr.downstream_seconds, 0)
              + GREATEST(COALESCE(sc.cur_stage_avg, 0) - sc.elapsed_in_stage, 0))
             / NULLIF(EXTRACT(EPOCH FROM (sc.due_date - NOW())), 0) * 100
      END AS deadline_pct,
      CASE
        WHEN sc.estimated_hours IS NULL OR sc.estimated_hours <= 0 THEN NULL
        ELSE (COALESCE(tl.logged_seconds, 0) / (sc.estimated_hours * 3600))
             / NULLIF((psc.total_stages - dr.downstream_count)::NUMERIC / NULLIF(psc.total_stages, 0), 0) * 100
      END AS effort_pct
    FROM sla_candidates sc
    LEFT JOIN downstream_remaining  dr  ON dr.task_id = sc.id
    LEFT JOIN task_logged           tl  ON tl.task_id = sc.id
    LEFT JOIN pipeline_stage_counts psc ON psc.pipeline_id = sc.pipeline_id
  ),
  sla_capped AS (
    SELECT ss.*,
      LEAST(COALESCE(ss.stall_pct,    -1), 85) AS stall_c,
      LEAST(COALESCE(ss.deadline_pct, -1), 99) AS deadline_c,
      LEAST(COALESCE(ss.effort_pct,   -1), 99) AS effort_c
    FROM sla_scored ss
  ),
  sla_risks AS (
    SELECT sc.id, sc.task_number, sc.stage_name, sc.due_date,
      ROUND(GREATEST(sc.stall_c, sc.deadline_c, sc.effort_c))::bigint AS risk_percent,
      CASE
        WHEN sc.deadline_pct IS NOT NULL AND sc.deadline_c >= sc.stall_c AND sc.deadline_c >= sc.effort_c THEN 'deadline'
        WHEN sc.effort_pct IS NOT NULL AND sc.effort_c >= sc.stall_c THEN 'over_budget'
        ELSE 'stalled'
      END AS reason,
      ROUND(sc.cur_stage_avg)::bigint AS avg_seconds
    FROM sla_capped sc
    WHERE GREATEST(sc.stall_c, sc.deadline_c, sc.effort_c) >= 75
    ORDER BY
      risk_percent DESC,
      GREATEST(COALESCE(sc.stall_pct, -1), COALESCE(sc.deadline_pct, -1), COALESCE(sc.effort_pct, -1)) DESC
    LIMIT 10
  ),
  worker_eng AS (
    SELECT u.full_name, u.avatar_url, COUNT(ae.id) AS action_count
    FROM public.users u
    JOIN public.activity_events ae ON ae.user_id = u.id AND ae.company_id = v_company_id
      AND ae.created_at >= v_start_date AND ae.created_at <= v_end_date
    WHERE u.company_id = v_company_id
    GROUP BY u.id, u.full_name, u.avatar_url
    HAVING COUNT(ae.id) > 0
  ),
  quality_wkr AS (
    SELECT u.full_name, u.avatar_url, COUNT(DISTINCT bt.id) AS total_tasks,
      COALESCE(ROUND(COUNT(DISTINCT CASE WHEN trf.had_revision = 1 THEN bt.id END)::NUMERIC /
        NULLIF(COUNT(DISTINCT bt.id), 0) * 100, 1), 0) AS revision_rate
    FROM public.users u
    JOIN public.task_assignments ta ON ta.assignee_user_id = u.id AND ta.company_id = v_company_id
    JOIN base_tasks bt ON bt.id = ta.task_id
    LEFT JOIN task_rev_flag trf ON trf.task_id = bt.id
    WHERE u.company_id = v_company_id
    GROUP BY u.id, u.full_name, u.avatar_url
    HAVING COUNT(DISTINCT bt.id) > 0
  ),
  worker_time_agg AS (
    SELECT u.id AS user_id, u.full_name, u.avatar_url, COUNT(DISTINCT bt.id) AS task_count,
      COALESCE(ROUND(SUM(tws.total_seconds_spent)::NUMERIC / 3600, 2), 0) AS total_hours,
      COALESCE(ROUND(CASE WHEN COUNT(DISTINCT bt.id) > 0
          THEN SUM(tws.total_seconds_spent)::NUMERIC / 3600 / COUNT(DISTINCT bt.id) ELSE 0 END, 2), 0) AS avg_hours_per_task,
      COALESCE(ROUND(COUNT(DISTINCT CASE WHEN trf.had_revision = 1 THEN bt.id END)::NUMERIC /
        NULLIF(COUNT(DISTINCT bt.id), 0) * 100, 1), 0) AS revision_rate
    FROM public.users u
    JOIN public.task_assignments ta ON u.id = ta.assignee_user_id AND ta.company_id = v_company_id
    JOIN base_tasks bt ON bt.id = ta.task_id
    LEFT JOIN public.task_work_sessions tws ON tws.task_id = bt.id AND tws.user_id = u.id
    LEFT JOIN task_rev_flag trf ON trf.task_id = bt.id
    WHERE u.company_id = v_company_id
    GROUP BY u.id, u.full_name, u.avatar_url
    HAVING COUNT(DISTINCT bt.id) > 0
  )

  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'company_name', (SELECT name FROM public.companies WHERE id = v_company_id),
      'report_period', jsonb_build_object('start', v_start_date, 'end', v_end_date),
      'filters_applied', jsonb_build_object(
        'pipeline', p_pipeline_id, 'team', p_team_id, 'worker', p_worker_id,
        'priority', p_priority, 'project', p_project_id)
    ),
    'current', (SELECT jsonb_build_object('throughput', ck.throughput, 'success_rate', ck.success_rate,
        'avg_lead_time_minutes', ck.avg_lead_time_minutes, 'revision_rate', ck.revision_rate) FROM cur_kpi ck),
    'comparison', (SELECT jsonb_build_object('throughput', pk.throughput, 'success_rate', pk.success_rate,
        'avg_lead_time_minutes', pk.avg_lead_time_minutes, 'revision_rate', pk.revision_rate) FROM prev_kpi pk),
    'radar_advanced', (SELECT jsonb_build_object('flow_ratio', ak.flow_ratio, 'first_pass_yield', ak.first_pass_yield,
        'automation_offload_rate', 0) FROM adv_kpi ak),
    'stage_duration_analysis', (SELECT jsonb_agg(jsonb_build_object('stage_name', sda.stage_name,
        'pipeline_name', sda.pipeline_name, 'avg_duration_days', sda.avg_duration_days)
        ORDER BY sda.pipeline_name, sda.position) FROM stage_dur_agg sda),
    'conversion_by_stage', (SELECT jsonb_agg(jsonb_build_object('stage_name', ff.stage_name,
        'pipeline_name', ff.pipeline_name, 'task_count', ff.task_count, 'completion_rate', ff.completion_rate)
        ORDER BY ff.pipeline_name, ff.position) FROM funnel_final ff),
    'sla_risks', (SELECT jsonb_agg(jsonb_build_object('id', sr.id, 'task_number', sr.task_number,
        'stage_name', sr.stage_name, 'risk_percent', sr.risk_percent, 'reason', sr.reason,
        'due_date', sr.due_date, 'avg_seconds', sr.avg_seconds)) FROM sla_risks sr),
    'worker_engagement', (SELECT jsonb_agg(jsonb_build_object('full_name', we.full_name, 'avatar_url', we.avatar_url,
        'action_count', we.action_count) ORDER BY we.action_count DESC) FROM worker_eng we),
    'quality_by_worker', (SELECT jsonb_agg(jsonb_build_object('full_name', qw.full_name, 'avatar_url', qw.avatar_url,
        'revision_rate', qw.revision_rate, 'total_tasks', qw.total_tasks) ORDER BY qw.revision_rate ASC) FROM quality_wkr qw),
    'worker_time_metrics', CASE WHEN p_include_time_metrics THEN (
      SELECT jsonb_agg(jsonb_build_object('user_id', wta.user_id, 'full_name', wta.full_name, 'avatar_url', wta.avatar_url,
        'task_count', wta.task_count, 'total_hours', wta.total_hours, 'avg_hours_per_task', wta.avg_hours_per_task,
        'revision_rate', wta.revision_rate) ORDER BY wta.total_hours DESC) FROM worker_time_agg wta) ELSE NULL END,
    'cost_metrics', CASE WHEN p_include_advanced THEN (
      SELECT jsonb_build_object('total_hours', COALESCE(ROUND(SUM(tws.total_seconds_spent)::NUMERIC / 3600, 2), 0),
        'avg_cost_per_task', COALESCE(ROUND(SUM(tws.total_seconds_spent)::NUMERIC / 3600 /
          NULLIF(COUNT(DISTINCT t.id), 0) * 50, 2), 0), 'task_count', COUNT(DISTINCT t.id))
      FROM public.tasks t
      LEFT JOIN public.task_work_sessions tws ON tws.task_id = t.id
      WHERE t.company_id = v_company_id AND t.deleted_at IS NULL
        AND t.created_at >= v_start_date AND t.created_at <= v_end_date
        AND (p_pipeline_id IS NULL OR t.pipeline_id = p_pipeline_id)) ELSE NULL END
  ) INTO v_result;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."rpc_get_organizational_audit"("p_pipeline_id" "uuid", "p_days" integer, "p_team_id" "uuid", "p_worker_id" "uuid", "p_priority" "text", "p_project_id" "uuid", "p_date_start" timestamp with time zone, "p_date_end" timestamp with time zone, "p_auth_user_id" "uuid", "p_include_time_metrics" boolean, "p_include_advanced" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_personal_pulse"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id       uuid := auth.uid();
  v_daily_pts     bigint;
  v_monthly_pts   bigint;
  v_real_sec      bigint;
  v_flap          float;
BEGIN
  -- Weight points: tasks assigned to this user that reached a success terminal today
  SELECT COALESCE(SUM(t.weight), 0)
  INTO v_daily_pts
  FROM public.tasks t
  JOIN public.task_assignments ta ON ta.task_id = t.id AND ta.assignee_user_id = v_user_id
  JOIN public.pipeline_stages  ps ON ps.id = t.current_stage_id
  WHERE ps.terminal_type = 'success'
    AND t.completed_at  >= date_trunc('day', now());

  -- Weight points for this month
  SELECT COALESCE(SUM(t.weight), 0)
  INTO v_monthly_pts
  FROM public.tasks t
  JOIN public.task_assignments ta ON ta.task_id = t.id AND ta.assignee_user_id = v_user_id
  JOIN public.pipeline_stages  ps ON ps.id = t.current_stage_id
  WHERE ps.terminal_type = 'success'
    AND t.completed_at  >= date_trunc('month', now());

  -- Active seconds today: completed sessions + any currently running session
  SELECT
    COALESCE(SUM(total_seconds_spent), 0)
    + COALESCE(SUM(
        CASE WHEN status = 'active'
             THEN EXTRACT(EPOCH FROM (now() - started_at))::int
             ELSE 0 END
      ), 0)
  INTO v_real_sec
  FROM public.task_work_sessions
  WHERE user_id    = v_user_id
    AND created_at >= date_trunc('day', now());

  -- Flap rate: avg stage transitions per task over last 30 days (from the view)
  SELECT COALESCE(revision_rate, 0.0)
  INTO v_flap
  FROM public.view_user_performance
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'daily_points',          v_daily_pts,
    'monthly_points',        v_monthly_pts,
    'active_seconds_today',  v_real_sec,
    'flap_rate_score',       ROUND(v_flap::numeric, 2),
    'is_working',            EXISTS (
      SELECT 1 FROM public.task_work_sessions
      WHERE user_id = v_user_id AND status = 'active'
    )
  );
END;
$$;


ALTER FUNCTION "public"."rpc_get_personal_pulse"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_pipeline_hours_series"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer DEFAULT 12) RETURNS TABLE("period_label" "text", "period_start" "date", "active_hours" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_current_start DATE;
  v_ps            DATE;
  v_snap_age      INTERVAL;
  i               INT;
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;

  v_current_start := date_trunc(p_period_type, CURRENT_DATE)::DATE;

  FOR i IN 0 .. p_n_periods - 1 LOOP
    v_ps       := (v_current_start - (i * ('1 ' || p_period_type)::INTERVAL))::DATE;
    v_snap_age := CASE WHEN i = 0 THEN INTERVAL '15 minutes' ELSE INTERVAL '9999 days' END;

    IF NOT EXISTS (
      SELECT 1 FROM public.analytics_snapshots s
       WHERE s.snapshot_type = 'pipeline_hours'
         AND s.subject_id    = p_pipeline_id
         AND s.period_type   = p_period_type
         AND s.period_start  = v_ps
         AND s.computed_at   > now() - v_snap_age
    ) THEN
      PERFORM public.rpc_flush_pipeline_hours_snapshot(p_pipeline_id, p_period_type, v_ps);
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                                       AS period_label,
    gs.ps                                                                     AS period_start,
    ROUND(COALESCE((snap.data->>'active_seconds')::NUMERIC, 0) / 3600.0, 2)   AS active_hours
  FROM
    generate_series(0, p_n_periods - 1) AS gs_i(i),
    LATERAL (
      SELECT (v_current_start - (gs_i.i * ('1 ' || p_period_type)::INTERVAL))::DATE AS ps
    ) AS gs
  LEFT JOIN public.analytics_snapshots snap
    ON  snap.snapshot_type = 'pipeline_hours'
    AND snap.subject_id    = p_pipeline_id
    AND snap.period_type   = p_period_type
    AND snap.period_start  = gs.ps
  ORDER BY gs_i.i;
END;
$$;


ALTER FUNCTION "public"."rpc_get_pipeline_hours_series"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_pipeline_members"("p_pipeline_id" "uuid") RETURNS TABLE("id" "uuid", "full_name" "text", "email" "text", "avatar_url" "text", "is_owner" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_roles      TEXT[];  -- visibility_permissions stores role UUIDs as text
BEGIN
  SELECT p.company_id, p.visibility_permissions
  INTO   v_company_id, v_roles
  FROM   public.pipelines p
  WHERE  p.id = p_pipeline_id AND p.deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT DISTINCT u.id, u.full_name, u.email, u.avatar_url, u.is_owner
  FROM   public.users u
  WHERE  u.company_id = v_company_id
    AND  u.deleted_at IS NULL
    AND (
      u.is_owner = TRUE
      OR v_roles IS NULL
      OR array_length(v_roles, 1) IS NULL           -- open gate → everyone in company
      OR public.fn_user_has_permission(u.id, 'system.view_all_data')  -- admin override (mirrors RLS)
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = u.id AND ur.company_id = v_company_id
          AND ur.revoked_at IS NULL AND ur.role_id::text = ANY(v_roles)
      )
    )
  ORDER BY u.full_name NULLS LAST;
END;
$$;


ALTER FUNCTION "public"."rpc_get_pipeline_members"("p_pipeline_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_pipeline_points_range"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date", "p_buckets" integer DEFAULT 12) RETURNS TABLE("bucket_start" timestamp with time zone, "bucket_end" timestamp with time zone, "weight_points" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_t0 TIMESTAMPTZ := p_from::timestamptz;
  v_t1 TIMESTAMPTZ := (p_to + 1)::timestamptz;
  v_nb INT := LEAST(GREATEST(COALESCE(p_buckets, 12), 1), 60);
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;
  IF v_t1 <= v_t0 THEN RETURN; END IF;

  SELECT company_id INTO v_company_id FROM public.pipelines WHERE id = p_pipeline_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH pts AS (
    SELECT t.completed_at AS ts, COALESCE(t.weight, 0)::numeric AS w
    FROM public.tasks t
    WHERE t.pipeline_id = p_pipeline_id
      AND t.completed_at >= v_t0 AND t.completed_at < v_t1
    UNION ALL
    SELECT (ar.snapshot->'task'->>'completed_at')::timestamptz,
           COALESCE((ar.snapshot->'task'->>'weight')::numeric, 0)
    FROM public.archives ar
    WHERE ar.company_id  = v_company_id
      AND ar.entity_type = 'task'
      AND (ar.snapshot->'task'->>'pipeline_id') = p_pipeline_id::text
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= v_t0
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_t1
  ),
  bucketed AS (
    SELECT width_bucket(EXTRACT(EPOCH FROM ts), EXTRACT(EPOCH FROM v_t0), EXTRACT(EPOCH FROM v_t1), v_nb) AS b, w
    FROM pts
  )
  SELECT
    v_t0 + (v_t1 - v_t0) * (gs.i - 1) / v_nb AS bucket_start,
    v_t0 + (v_t1 - v_t0) * gs.i / v_nb       AS bucket_end,
    COALESCE(SUM(bk.w), 0)::BIGINT           AS weight_points
  FROM generate_series(1, v_nb) AS gs(i)
  LEFT JOIN bucketed bk ON bk.b = gs.i
  GROUP BY gs.i
  ORDER BY gs.i;
END;
$$;


ALTER FUNCTION "public"."rpc_get_pipeline_points_range"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date", "p_buckets" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_pipeline_points_series"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer DEFAULT 12) RETURNS TABLE("period_label" "text", "period_start" "date", "weight_points" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_current_start DATE;
  v_ps            DATE;
  v_snap_age      INTERVAL;
  i               INT;
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;

  v_current_start := date_trunc(p_period_type, CURRENT_DATE)::DATE;

  -- Lazy-flush: current period every 15 min, closed periods once forever
  FOR i IN 0 .. p_n_periods - 1 LOOP
    v_ps       := (v_current_start - (i * ('1 ' || p_period_type)::INTERVAL))::DATE;
    v_snap_age := CASE WHEN i = 0 THEN INTERVAL '15 minutes' ELSE INTERVAL '9999 days' END;

    IF NOT EXISTS (
      SELECT 1 FROM public.analytics_snapshots s
       WHERE s.snapshot_type = 'pipeline_points'
         AND s.subject_id    = p_pipeline_id
         AND s.period_type   = p_period_type
         AND s.period_start  = v_ps
         AND s.computed_at   > now() - v_snap_age
    ) THEN
      PERFORM public.rpc_flush_pipeline_points_snapshot(p_pipeline_id, p_period_type, v_ps);
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                               AS period_label,
    gs.ps                                                             AS period_start,
    COALESCE((snap.data->>'weight_points')::NUMERIC::BIGINT, 0)       AS weight_points
  FROM
    generate_series(0, p_n_periods - 1) AS gs_i(i),
    LATERAL (
      SELECT (v_current_start - (gs_i.i * ('1 ' || p_period_type)::INTERVAL))::DATE AS ps
    ) AS gs
  LEFT JOIN public.analytics_snapshots snap
    ON  snap.snapshot_type = 'pipeline_points'
    AND snap.subject_id    = p_pipeline_id
    AND snap.period_type   = p_period_type
    AND snap.period_start  = gs.ps
  ORDER BY gs_i.i;
END;
$$;


ALTER FUNCTION "public"."rpc_get_pipeline_points_series"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_pipeline_stage_dwell"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date") RETURNS TABLE("stage_id" "uuid", "stage_name" "text", "stage_position" integer, "is_terminal" boolean, "terminal_type" "text", "avg_seconds" bigint, "median_seconds" bigint, "p75_seconds" bigint, "sample_count" bigint, "reversal_count" bigint, "is_bottleneck" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH transitions AS (
    SELECT
      psh.task_id,
      psh.to_stage_id,
      psh.transitioned_at,
      LEAD(psh.transitioned_at) OVER (
        PARTITION BY psh.task_id ORDER BY psh.transitioned_at
      ) AS next_at
    FROM public.pipeline_stage_history psh
    WHERE psh.pipeline_id = p_pipeline_id
  ),
  dwell_times AS (
    -- Each entry into a stage: duration ends at next transition or NOW().
    -- Include if the dwell overlaps the requested window.
    SELECT
      to_stage_id                                                             AS s_id,
      EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - transitioned_at))::NUMERIC AS duration
    FROM transitions
    WHERE to_stage_id IS NOT NULL
      AND transitioned_at::DATE <= p_to
      AND COALESCE(next_at, NOW())::DATE >= p_from
      AND EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - transitioned_at)) > 0
  ),
  stage_stats AS (
    SELECT
      ps.id,
      ps.name,
      ps.position,
      ps.is_terminal,
      ps.terminal_type,
      COALESCE(AVG(dt.duration), 0)::BIGINT                                           AS avg_sec,
      COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.duration), 0)::BIGINT  AS median_sec,
      COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY dt.duration), 0)::BIGINT AS p75_sec,
      COUNT(dt.duration)::BIGINT                                                       AS sample_cnt,
      (SELECT COUNT(*)
       FROM   public.pipeline_stage_history psh2
       JOIN   public.pipeline_stages ps_from ON ps_from.id = psh2.from_stage_id
       JOIN   public.pipeline_stages ps_to   ON ps_to.id   = psh2.to_stage_id
       WHERE  psh2.pipeline_id  = p_pipeline_id
         AND  psh2.to_stage_id  = ps.id
         AND  ps_to.position    < ps_from.position
         AND  psh2.transitioned_at::DATE BETWEEN p_from AND p_to
      )::BIGINT                                                                        AS reversal_cnt
    FROM public.pipeline_stages ps
    LEFT JOIN dwell_times dt ON dt.s_id = ps.id
    WHERE ps.pipeline_id = p_pipeline_id
    GROUP BY ps.id, ps.name, ps.position, ps.is_terminal, ps.terminal_type
  ),
  pipeline_avg AS (
    SELECT AVG(NULLIF(avg_sec, 0)) AS avg_all
    FROM   stage_stats
  )
  SELECT
    ss.id,
    ss.name,
    ss.position,
    ss.is_terminal,
    ss.terminal_type,
    ss.avg_sec,
    ss.median_sec,
    ss.p75_sec,
    ss.sample_cnt,
    ss.reversal_cnt,
    (ss.avg_sec > 0
      AND pa.avg_all IS NOT NULL
      AND ss.avg_sec > pa.avg_all * 1.5
    )::BOOLEAN AS is_bottleneck
  FROM stage_stats ss
  CROSS JOIN pipeline_avg pa
  ORDER BY ss.position ASC;
END;
$$;


ALTER FUNCTION "public"."rpc_get_pipeline_stage_dwell"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_pipeline_throughput"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer DEFAULT 12) RETURNS TABLE("period_label" "text", "period_start" "date", "tasks_entered" bigint, "tasks_succeeded" bigint, "tasks_failed" bigint, "success_rate" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_current_start DATE;
  v_ps            DATE;
  v_snap_age      INTERVAL;
  i               INT;
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;

  v_current_start := date_trunc(p_period_type, CURRENT_DATE)::DATE;

  -- Lazy-flush: current period refreshes every 15 minutes; past periods hydrate once.
  FOR i IN 0 .. p_n_periods - 1 LOOP
    v_ps       := (v_current_start - (i * ('1 ' || p_period_type)::INTERVAL))::DATE;
    v_snap_age := CASE WHEN i = 0 THEN INTERVAL '15 minutes' ELSE INTERVAL '9999 days' END;

    IF NOT EXISTS (
      SELECT 1 FROM public.analytics_snapshots s
      WHERE s.snapshot_type = 'pipeline_performance'
        AND s.subject_id    = p_pipeline_id
        AND s.period_type   = p_period_type
        AND s.period_start  = v_ps
        AND s.computed_at   > NOW() - v_snap_age
    ) THEN
      PERFORM public.rpc_flush_pipeline_snapshot(p_pipeline_id, p_period_type, v_ps);
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                               AS period_label,
    gs.ps                                                             AS period_start,
    COALESCE((snap.data->>'tasks_entered')::NUMERIC::BIGINT,    0)   AS tasks_entered,
    COALESCE((snap.data->>'tasks_succeeded')::NUMERIC::BIGINT,  0)   AS tasks_succeeded,
    COALESCE((snap.data->>'tasks_failed')::NUMERIC::BIGINT,     0)   AS tasks_failed,
    CASE
      WHEN COALESCE((snap.data->>'tasks_succeeded')::NUMERIC, 0)
         + COALESCE((snap.data->>'tasks_failed')::NUMERIC,    0) = 0 THEN NULL
      ELSE ROUND(
        (snap.data->>'tasks_succeeded')::NUMERIC /
        NULLIF(
          (snap.data->>'tasks_succeeded')::NUMERIC +
          (snap.data->>'tasks_failed')::NUMERIC, 0
        ) * 100, 1
      )
    END                                                               AS success_rate
  FROM
    generate_series(0, p_n_periods - 1) AS gs_i(i),
    LATERAL (
      SELECT (v_current_start - (gs_i.i * ('1 ' || p_period_type)::INTERVAL))::DATE AS ps
    ) AS gs
  LEFT JOIN public.analytics_snapshots snap
    ON  snap.snapshot_type = 'pipeline_performance'
    AND snap.subject_id    = p_pipeline_id
    AND snap.period_type   = p_period_type
    AND snap.period_start  = gs.ps
  ORDER BY gs_i.i;
END;
$$;


ALTER FUNCTION "public"."rpc_get_pipeline_throughput"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_pipeline_throughput_range"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date", "p_buckets" integer DEFAULT 12) RETURNS TABLE("bucket_start" timestamp with time zone, "bucket_end" timestamp with time zone, "tasks_succeeded" bigint, "tasks_failed" bigint, "success_rate" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_t0 TIMESTAMPTZ := p_from::timestamptz;
  v_t1 TIMESTAMPTZ := (p_to + 1)::timestamptz; -- inclusive end date
  v_nb INT := LEAST(GREATEST(COALESCE(p_buckets, 12), 1), 60);
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;
  IF v_t1 <= v_t0 THEN RETURN; END IF;

  SELECT company_id INTO v_company_id FROM public.pipelines WHERE id = p_pipeline_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH term AS (
    -- Live tasks sitting in a terminal stage, completed inside the range
    SELECT t.completed_at AS ts, ps.terminal_type AS ttype
    FROM public.tasks t
    JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.pipeline_id = p_pipeline_id
      AND ps.is_terminal = true
      AND t.completed_at >= v_t0 AND t.completed_at < v_t1
    UNION ALL
    -- Archived tasks (same semantics as rpc_flush_pipeline_snapshot)
    SELECT (ar.snapshot->'task'->>'completed_at')::timestamptz,
           ps.terminal_type
    FROM public.archives ar
    LEFT JOIN public.pipeline_stages ps
      ON ps.id = (ar.snapshot->'task'->>'current_stage_id')::uuid
    WHERE ar.company_id  = v_company_id
      AND ar.entity_type = 'task'
      AND (ar.snapshot->'task'->>'pipeline_id') = p_pipeline_id::text
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= v_t0
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_t1
  ),
  bucketed AS (
    SELECT width_bucket(EXTRACT(EPOCH FROM ts), EXTRACT(EPOCH FROM v_t0), EXTRACT(EPOCH FROM v_t1), v_nb) AS b,
           ttype
    FROM term
  )
  SELECT
    v_t0 + (v_t1 - v_t0) * (gs.i - 1) / v_nb  AS bucket_start,
    v_t0 + (v_t1 - v_t0) * gs.i / v_nb        AS bucket_end,
    COUNT(*) FILTER (WHERE bk.ttype = 'success')::BIGINT AS tasks_succeeded,
    COUNT(*) FILTER (WHERE bk.ttype = 'failure')::BIGINT AS tasks_failed,
    CASE
      WHEN COUNT(*) FILTER (WHERE bk.ttype IN ('success','failure')) = 0 THEN NULL
      ELSE ROUND(
        COUNT(*) FILTER (WHERE bk.ttype = 'success')::NUMERIC /
        COUNT(*) FILTER (WHERE bk.ttype IN ('success','failure')) * 100, 1)
    END AS success_rate
  FROM generate_series(1, v_nb) AS gs(i)
  LEFT JOIN bucketed bk ON bk.b = gs.i
  GROUP BY gs.i
  ORDER BY gs.i;
END;
$$;


ALTER FUNCTION "public"."rpc_get_pipeline_throughput_range"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date", "p_buckets" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_project_stats"("p_project_ids" "uuid"[]) RETURNS TABLE("project_id" "uuid", "total_tasks" bigint, "completed_tasks" bigint, "overdue_tasks" bigint, "completion_rate" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id                                                               AS p_id,
        COUNT(t.id)::BIGINT                                                AS t_total,
        COUNT(CASE WHEN ps.is_terminal = TRUE AND ps.terminal_type = 'success' THEN 1 END)::BIGINT AS t_comp,
        COUNT(CASE WHEN t.due_date < NOW() AND (ps.is_terminal = FALSE OR ps.terminal_type != 'success') THEN 1 END)::BIGINT AS t_over,
        CASE 
            WHEN COUNT(t.id) > 0 THEN 
                ROUND((COUNT(CASE WHEN ps.is_terminal = TRUE AND ps.terminal_type = 'success' THEN 1 END)::NUMERIC / COUNT(t.id)::NUMERIC) * 100, 2)
            ELSE 0 
        END                                                                AS c_rate
    FROM public.projects p
    LEFT JOIN public.tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
    LEFT JOIN public.pipeline_stages ps ON t.current_stage_id = ps.id
    WHERE p.id = ANY(p_project_ids)
    GROUP BY p.id;
END;
$$;


ALTER FUNCTION "public"."rpc_get_project_stats"("p_project_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_projects"("p_include_archived" boolean DEFAULT false) RETURNS SETOF "public"."projects"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_company_id UUID;
BEGIN
  v_company_id := public.my_company_id();

  RETURN QUERY
  SELECT * FROM public.projects
  WHERE company_id = v_company_id
  AND (p_include_archived OR status != 'archived')
  AND deleted_at IS NULL
  ORDER BY is_featured DESC, name ASC;
END;
$$;


ALTER FUNCTION "public"."rpc_get_projects"("p_include_archived" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_targets_status"() RETURNS TABLE("id" "uuid", "stage_id" "uuid", "stage_name" "text", "pipeline_name" "text", "target_type" "text", "target_value" integer, "current_value" bigint, "status" "text", "deadline" timestamp with time zone, "created_at" timestamp with time zone, "completed_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
#variable_conflict use_column
DECLARE
    v_company_id UUID;
BEGIN
    SELECT company_id INTO v_company_id FROM public.users WHERE id = auth.uid();
    IF v_company_id IS NULL THEN RETURN; END IF;

    RETURN QUERY
    WITH target_progress AS (
        SELECT
            pst.id,
            pst.stage_id,
            ps.name as stage_name,
            p.name as pipeline_name,
            pst.target_type,
            pst.target_quantity as target_value,
            pst.target_deadline as deadline,
            pst.created_at,
            pst.completed_at,
            (
                SELECT COUNT(*)
                FROM public.pipeline_stage_history psh
                WHERE psh.to_stage_id = pst.stage_id
                  AND psh.company_id = v_company_id
                  AND psh.transitioned_at >= pst.created_at
                  AND (pst.target_deadline IS NULL OR psh.transitioned_at <= pst.target_deadline)
            ) as current_volume
        FROM public.pipeline_stage_targets pst
        JOIN public.pipeline_stages ps ON ps.id = pst.stage_id
        JOIN public.pipelines p ON p.id = ps.pipeline_id
        WHERE pst.company_id = v_company_id
    )
    SELECT
        tp.id,
        tp.stage_id,
        tp.stage_name,
        tp.pipeline_name,
        tp.target_type,
        tp.target_value,
        tp.current_volume as current_value,
        CASE
            WHEN tp.current_volume >= tp.target_value THEN 'hit'
            WHEN tp.deadline IS NOT NULL AND NOW() > tp.deadline THEN 'expired'
            ELSE 'active'
        END as status,
        tp.deadline,
        tp.created_at,
        tp.completed_at
    FROM target_progress tp;
END;
$$;


ALTER FUNCTION "public"."rpc_get_targets_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_task_details"("p_task_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_task                   RECORD;
  v_user_id                UUID := auth.uid();
  v_pipeline               JSONB;
  v_current_stage          JSONB;
  v_all_stages             JSONB;
  v_transitions            JSONB;
  v_creator                JSONB;
  v_manager                JSONB;
  v_assignments            JSONB;
  v_stage_history          JSONB;
  v_submissions            JSONB;
  v_comments               JSONB;
  v_work_sessions          JSONB;
  v_activity               JSONB;
  v_stats                  JSONB;
  v_permissions            JSONB;
  v_can_view_hist          BOOLEAN;
  v_stage_actions          JSONB;
  v_task_attachments       JSONB;
  v_pending_time_approvals JSONB;
  v_my_manual_time_entry   JSONB;
  v_is_owner               BOOLEAN;
  v_is_assigned            BOOLEAN;
  v_is_manager             BOOLEAN;
  v_is_creator             BOOLEAN;
BEGIN
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
  IF v_task IS NULL THEN RETURN NULL; END IF;
  IF v_task.company_id != public.my_company_id() THEN RETURN NULL; END IF;

  v_is_owner   := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
  v_is_creator := v_task.created_by = v_user_id;
  v_is_manager := v_task.manager_id = v_user_id;
  v_is_assigned := EXISTS (
    SELECT 1 FROM public.task_assignments ta
    WHERE ta.task_id = p_task_id
      AND (
        ta.assignee_user_id = v_user_id
        OR ta.assignee_team_id IN (
            SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
        )
      )
  );

  IF NOT (
    v_is_owner OR v_is_creator OR v_is_manager OR v_is_assigned
    OR public.has_permission('task.view_detail')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description)
  INTO v_pipeline FROM public.pipelines p WHERE p.id = v_task.pipeline_id;

  SELECT jsonb_build_object(
    'id', ps.id, 'name', ps.name, 'color', ps.color,
    'position', ps.position, 'is_initial', ps.is_initial,
    'is_terminal', ps.is_terminal, 'terminal_type', ps.terminal_type,
    'requires_submission', ps.requires_submission,
    'submission_mode', ps.submission_mode,
    'requires_timer', ps.requires_timer,
    'requires_attachments', ps.requires_attachments,
    'min_timer_seconds', ps.min_timer_seconds,
    'linked_pipeline_id', ps.linked_pipeline_id,
    'linked_pipeline', CASE WHEN ps.linked_pipeline_id IS NOT NULL THEN
      (SELECT jsonb_build_object('id', lp.id, 'name', lp.name) FROM public.pipelines lp WHERE lp.id = ps.linked_pipeline_id)
    ELSE NULL END
  )
  INTO v_current_stage
  FROM public.pipeline_stages ps WHERE ps.id = v_task.current_stage_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id', ps.id, 'name', ps.name, 'color', ps.color, 'position', ps.position,
                       'is_initial', ps.is_initial, 'is_terminal', ps.is_terminal, 'terminal_type', ps.terminal_type,
                       'requires_submission', ps.requires_submission, 'submission_mode', ps.submission_mode, 'requires_attachments', ps.requires_attachments,
                       'requires_timer', ps.requires_timer, 'min_timer_seconds', ps.min_timer_seconds,
                       'linked_pipeline_id', ps.linked_pipeline_id)
    ORDER BY ps.position
  ), '[]'::jsonb)
  INTO v_all_stages
  FROM public.pipeline_stages ps WHERE ps.pipeline_id = v_task.pipeline_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'to_stage_id', t.to_stage_id,
      'to_stage_name', ps.name, 'to_stage_color', ps.color,
      'label', t.label, 'transition_type', t.transition_type,
      'required_permission', t.required_permission
    )
  ), '[]'::jsonb)
  INTO v_transitions
  FROM public.pipeline_stage_transitions t
  JOIN public.pipeline_stages ps ON ps.id = t.to_stage_id
  WHERE t.from_stage_id = v_task.current_stage_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id, 'action_type', a.action_type, 'label', a.label, 'icon', a.icon,
      'style', a.style, 'required_role', a.required_role, 'precondition', a.precondition,
      'transition_id', a.transition_id, 'position', a.position, 'requires_timer', a.requires_timer,
      'can_perform', CASE
        WHEN v_is_owner THEN TRUE
        WHEN a.required_role = 'any' THEN TRUE
        WHEN a.required_role = 'assignee' AND v_is_assigned THEN TRUE
        WHEN a.required_role = 'manager' AND v_is_manager THEN TRUE
        WHEN a.required_role = 'reviewer' AND (v_is_manager OR public.has_permission('submission.review')) THEN TRUE
        WHEN a.required_role = 'creator' AND v_is_creator THEN TRUE
        WHEN public.has_permission(a.required_role) THEN TRUE
        ELSE FALSE END,
      'precondition_met', CASE
        WHEN a.precondition IS NULL THEN TRUE
        WHEN a.precondition = 'has_pending_submission' THEN EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending' AND deleted_at IS NULL)
        WHEN a.precondition = 'no_pending_submission' THEN NOT EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending' AND deleted_at IS NULL)
        WHEN a.precondition = 'is_assigned' THEN v_is_assigned
        WHEN a.precondition = 'has_approved_submission' THEN EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'approved' AND deleted_at IS NULL)
        WHEN a.precondition = 'has_attachment' THEN EXISTS (SELECT 1 FROM public.task_attachments WHERE task_id = p_task_id AND deleted_at IS NULL)
        WHEN a.precondition = 'all_subtasks_complete' THEN NOT EXISTS (
          SELECT 1 FROM public.tasks child
          WHERE child.parent_task_id = p_task_id AND child.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.pipeline_stages ps WHERE ps.id = child.current_stage_id AND ps.is_terminal = TRUE AND ps.terminal_type = 'success')
        )
        ELSE FALSE END
    ) ORDER BY a.position
  ), '[]'::jsonb)
  INTO v_stage_actions
  FROM public.pipeline_stage_actions a
  WHERE a.stage_id = v_task.current_stage_id AND a.is_active = TRUE;

  SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url, 'email', u.email)
  INTO v_creator FROM public.users u WHERE u.id = v_task.created_by;

  IF v_task.manager_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url, 'email', u.email)
    INTO v_manager FROM public.users u WHERE u.id = v_task.manager_id;
  ELSE
    v_manager := 'null'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ta.id,
      'user', CASE WHEN ta.assignee_user_id IS NOT NULL THEN
        (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = ta.assignee_user_id)
      ELSE NULL END,
      'team', CASE WHEN ta.assignee_team_id IS NOT NULL THEN
        (SELECT jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color,
          'members', (SELECT jsonb_agg(jsonb_build_object('user_id', tm.user_id)) FROM public.team_members tm WHERE tm.team_id = t.id AND tm.removed_at IS NULL)
        ) FROM public.teams t WHERE t.id = ta.assignee_team_id)
      ELSE NULL END,
      'assigned_at', ta.assigned_at
    )
  ), '[]'::jsonb)
  INTO v_assignments FROM public.task_assignments ta WHERE ta.task_id = p_task_id;

  v_can_view_hist := v_is_owner OR v_is_creator OR v_is_manager OR v_is_assigned OR public.has_permission('task.view_history');

  IF v_can_view_hist THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', h.id,
        'from_stage_name', (SELECT name FROM public.pipeline_stages WHERE id = h.from_stage_id),
        'to_stage_name', (SELECT name FROM public.pipeline_stages WHERE id = h.to_stage_id),
        'transitioned_by', (SELECT jsonb_build_object('full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = h.transitioned_by),
        'transitioned_at', h.transitioned_at, 'is_reversal', h.is_reversal, 'submission_id', h.submission_id
      ) ORDER BY h.transitioned_at DESC
    ), '[]'::jsonb)
    INTO v_stage_history FROM public.pipeline_stage_history h WHERE h.task_id = p_task_id;
  ELSE
    v_stage_history := '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id, 'content', s.content, 'status', s.status, 'revision_count', s.revision_count,
      'submitted_at', s.submitted_at, 'reviewed_at', s.reviewed_at, 'review_notes', s.review_notes,
      'submitted_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = s.submitted_by),
      'reviewed_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = s.reviewed_by),
      'stage_name', (SELECT name FROM public.pipeline_stages WHERE id = s.stage_id),
      'version_count', (SELECT COUNT(*) FROM public.task_submission_versions v WHERE v.submission_id = s.id),
      'current_version_id', s.current_version_id,
      'attachments', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'file_url', a.file_url,
          'mime_type', a.mime_type, 'category', a.category, 'file_size', a.file_size, 'storage_path', a.storage_path))
         FROM public.submission_attachments a WHERE a.submission_id = s.id AND a.version_id = s.current_version_id),
        '[]'::jsonb
      )
    ) ORDER BY s.submitted_at DESC
  ), '[]'::jsonb)
  INTO v_submissions FROM public.task_submissions s WHERE s.task_id = p_task_id AND s.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id, 'file_name', a.file_name, 'file_url', a.file_url,
      'storage_path', a.storage_path, 'file_size', a.file_size,
      'mime_type', a.mime_type, 'category', a.category,
      'uploaded_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = a.uploaded_by),
      'created_at', a.created_at,
      'version_count', (SELECT COUNT(*) FROM public.task_attachment_versions v WHERE v.attachment_id = a.id),
      'current_version_id', a.current_version_id
    ) ORDER BY a.created_at DESC
  ), '[]'::jsonb)
  INTO v_task_attachments FROM public.task_attachments a WHERE a.task_id = p_task_id AND a.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', c.id, 'content', c.content, 'parent_id', c.parent_id, 'is_system', c.is_system,
      'author', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = c.author_id),
      'created_at', c.created_at
    ) ORDER BY c.created_at ASC
  ), '[]'::jsonb)
  INTO v_comments FROM public.task_comments c WHERE c.task_id = p_task_id AND c.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ws.id,
      'user_name', (SELECT u.full_name FROM public.users u WHERE u.id = ws.user_id),
      'user_id', ws.user_id, 'stage_id', ws.stage_id, 'status', ws.status,
      'total_seconds_spent', ws.total_seconds_spent, 'started_at', ws.started_at,
      'last_heartbeat_at', ws.last_heartbeat_at,
      'avatar_url', (SELECT u.avatar_url FROM public.users u WHERE u.id = ws.user_id)
    )
  ), '[]'::jsonb)
  INTO v_work_sessions FROM public.task_work_sessions ws WHERE ws.task_id = p_task_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id', ae.id, 'event_type', ae.event_type,
      'user_name', (SELECT u.full_name FROM public.users u WHERE u.id = ae.user_id),
      'metadata', ae.metadata, 'created_at', ae.created_at
    ) ORDER BY ae.created_at DESC
  ), '[]'::jsonb)
  INTO v_activity FROM public.activity_events ae WHERE ae.entity_type = 'task' AND ae.entity_id = p_task_id;

  SELECT jsonb_build_object(
    'total_transitions', (SELECT COUNT(*) FROM public.pipeline_stage_history WHERE task_id = p_task_id),
    'approval_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'approved'),
    'revision_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'needs_revision'),
    'rejection_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'rejected'),
    'pending_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending'),
    'deleted_submission_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND deleted_at IS NOT NULL),
    'deleted_attachment_count', (SELECT COUNT(*) FROM public.task_attachments WHERE task_id = p_task_id AND deleted_at IS NOT NULL),
    'total_time_spent_seconds', COALESCE((SELECT SUM(total_seconds_spent) FROM public.task_work_sessions WHERE task_id = p_task_id), 0),
    'days_in_pipeline', EXTRACT(DAY FROM (now() - v_task.created_at))::INT
  ) INTO v_stats;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', e.id, 'declared_minutes', e.declared_minutes, 'reason', e.reason,
      'flag_reason', e.flag_reason, 'logged_at', e.logged_at,
      'approval_status', e.approval_status, 'rejection_reason', e.rejection_reason,
      'user', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = e.user_id)
    )
  ), '[]'::jsonb)
  INTO v_pending_time_approvals
  FROM public.task_manual_time_entries e
  WHERE e.task_id = p_task_id AND e.stage_id = v_task.current_stage_id AND e.approval_status = 'pending'
    AND (v_is_owner OR v_is_manager OR v_is_creator OR public.has_permission('task.manage'));

  SELECT jsonb_build_object(
    'id', e.id, 'declared_minutes', e.declared_minutes, 'is_flagged', e.is_flagged,
    'approval_status', e.approval_status, 'rejection_reason', e.rejection_reason
  )
  INTO v_my_manual_time_entry
  FROM public.task_manual_time_entries e
  WHERE e.task_id = p_task_id AND e.stage_id = v_task.current_stage_id AND e.user_id = v_user_id;

  v_permissions := jsonb_build_object(
    'can_edit', v_is_owner OR v_is_creator OR v_is_manager OR public.has_permission('task.edit'),
    'can_assign', v_is_owner OR v_is_manager OR public.has_permission('task.assign'),
    'can_submit', v_is_assigned,
    'can_review', v_is_owner OR v_is_manager OR public.has_permission('submission.review'),
    'can_view_history', v_can_view_hist, 'can_comment', TRUE,
    'can_advance', v_is_owner OR v_is_manager OR v_is_assigned OR public.has_permission('task.advance'),
    'can_delete', v_is_owner OR public.has_permission('task.delete'),
    'is_owner', v_is_owner, 'is_assigned', v_is_assigned,
    'is_manager', v_is_manager, 'is_creator', v_is_creator
  );

  RETURN jsonb_build_object(
    'task', to_jsonb(v_task), 'pipeline', v_pipeline,
    'current_stage', v_current_stage, 'all_stages', v_all_stages,
    'available_transitions', v_transitions, 'stage_actions', v_stage_actions,
    'creator', v_creator, 'manager', v_manager, 'assignments', v_assignments,
    'stage_history', v_stage_history, 'submissions', v_submissions, 'comments', v_comments,
    'work_sessions', v_work_sessions, 'activity', v_activity, 'stats', v_stats,
    'permissions', v_permissions, 'task_attachments', v_task_attachments,
    'pending_time_approvals', COALESCE(v_pending_time_approvals, '[]'::jsonb),
    'my_manual_time_entry', COALESCE(v_my_manual_time_entry, 'null'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_get_task_details"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_user_company_history"("p_user_id" "uuid") RETURNS TABLE("company_id" "uuid", "company_name" "text", "company_slug" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT c.id, c.name, c.slug
  FROM public.analytics_snapshots s
  JOIN public.companies c ON c.id = s.company_id
  WHERE s.snapshot_type = 'user_performance'
    AND s.subject_id    = p_user_id
  ORDER BY c.name;
$$;


ALTER FUNCTION "public"."rpc_get_user_company_history"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_user_performance_series"("p_user_id" "uuid", "p_period_type" "text", "p_n_periods" integer DEFAULT 12) RETURNS TABLE("period_label" "text", "period_start" timestamp with time zone, "weight_points" bigint, "active_seconds" bigint, "completed_tasks" bigint, "failed_tasks" bigint, "on_time_tasks" bigint, "revision_count" bigint, "estimated_seconds" bigint, "is_current_period" boolean, "within_budget_tasks" bigint, "over_budget_tasks" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_current_start DATE;
  v_ps            DATE;
  v_snap_age      INTERVAL;
  i               INT;
BEGIN
  v_current_start := date_trunc(p_period_type, CURRENT_DATE)::DATE;

  -- Lazy-flush: keep the current period fresh; hydrate missing past periods once.
  FOR i IN 0 .. p_n_periods - 1 LOOP
    v_ps       := (v_current_start - (i * ('1 ' || p_period_type)::INTERVAL))::DATE;
    -- Current period: re-flush if snapshot is older than 5 minutes.
    -- Past periods: flush once if snapshot is absent (they never change after close).
    v_snap_age := CASE WHEN i = 0 THEN INTERVAL '5 minutes' ELSE INTERVAL '9999 days' END;

    IF NOT EXISTS (
      SELECT 1 FROM public.analytics_snapshots s
      WHERE s.snapshot_type = 'user_performance'
        AND s.subject_id    = p_user_id
        AND s.period_type   = p_period_type
        AND s.period_start  = v_ps
        AND s.computed_at   > NOW() - v_snap_age
    ) THEN
      PERFORM public.rpc_flush_user_snapshot(p_user_id, p_period_type, v_ps);
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                                        AS period_label,
    gs.ps::TIMESTAMPTZ                                                         AS period_start,
    COALESCE((snap.data->>'weight_points')::NUMERIC::BIGINT,      0)          AS weight_points,
    COALESCE((snap.data->>'active_seconds')::NUMERIC::BIGINT,     0)          AS active_seconds,
    COALESCE((snap.data->>'completed_tasks')::NUMERIC::BIGINT,    0)          AS completed_tasks,
    COALESCE((snap.data->>'failed_tasks')::NUMERIC::BIGINT,       0)          AS failed_tasks,
    COALESCE((snap.data->>'on_time_tasks')::NUMERIC::BIGINT,      0)          AS on_time_tasks,
    COALESCE((snap.data->>'revision_count')::NUMERIC::BIGINT,     0)          AS revision_count,
    COALESCE((snap.data->>'estimated_seconds')::NUMERIC::BIGINT,  0)          AS estimated_seconds,
    gs.ps = v_current_start                                                    AS is_current_period,
    COALESCE((snap.data->>'within_budget_tasks')::NUMERIC::BIGINT, 0)         AS within_budget_tasks,
    COALESCE((snap.data->>'over_budget_tasks')::NUMERIC::BIGINT,   0)         AS over_budget_tasks
  FROM
    generate_series(0, p_n_periods - 1) AS gs_i(i),
    LATERAL (
      SELECT (v_current_start - (gs_i.i * ('1 ' || p_period_type)::INTERVAL))::DATE AS ps
    ) AS gs
  LEFT JOIN public.analytics_snapshots snap
    ON  snap.snapshot_type = 'user_performance'
    AND snap.subject_id    = p_user_id
    AND snap.period_type   = p_period_type
    AND snap.period_start  = gs.ps
  ORDER BY gs_i.i;
END;
$$;


ALTER FUNCTION "public"."rpc_get_user_performance_series"("p_user_id" "uuid", "p_period_type" "text", "p_n_periods" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_user_performance_series"("p_user_id" "uuid", "p_period_type" "text", "p_n_periods" integer DEFAULT 12, "p_company_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("period_label" "text", "period_start" timestamp with time zone, "weight_points" bigint, "active_seconds" bigint, "completed_tasks" bigint, "failed_tasks" bigint, "on_time_tasks" bigint, "revision_count" bigint, "estimated_seconds" bigint, "is_current_period" boolean, "within_budget_tasks" bigint, "over_budget_tasks" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_current_start  DATE;
  v_user_company   UUID;
  v_ps             DATE;
  v_snap_age       INTERVAL;
  i                INT;
BEGIN
  v_current_start := date_trunc(p_period_type, CURRENT_DATE)::DATE;
  SELECT company_id INTO v_user_company FROM public.users WHERE id = p_user_id;

  FOR i IN 0 .. p_n_periods - 1 LOOP
    v_ps       := (v_current_start - (i * ('1 ' || p_period_type)::INTERVAL))::DATE;
    v_snap_age := CASE WHEN i = 0 THEN INTERVAL '5 minutes' ELSE INTERVAL '9999 days' END;

    IF v_user_company IS NOT NULL AND (p_company_id IS NULL OR p_company_id = v_user_company) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.analytics_snapshots s
        WHERE s.snapshot_type = 'user_performance'
          AND s.subject_id    = p_user_id
          AND s.period_type   = p_period_type
          AND s.period_start  = v_ps
          AND s.company_id    = v_user_company
          AND s.computed_at   > NOW() - v_snap_age
      ) THEN
        PERFORM public.rpc_flush_user_snapshot(p_user_id, p_period_type, v_ps);
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                                              AS period_label,
    gs.ps::TIMESTAMPTZ                                                               AS period_start,
    COALESCE(SUM((snap.data->>'weight_points')::NUMERIC),     0)::BIGINT            AS weight_points,
    COALESCE(SUM((snap.data->>'active_seconds')::NUMERIC),    0)::BIGINT            AS active_seconds,
    COALESCE(SUM((snap.data->>'completed_tasks')::NUMERIC),   0)::BIGINT            AS completed_tasks,
    COALESCE(SUM((snap.data->>'failed_tasks')::NUMERIC),      0)::BIGINT            AS failed_tasks,
    COALESCE(SUM((snap.data->>'on_time_tasks')::NUMERIC),     0)::BIGINT            AS on_time_tasks,
    COALESCE(SUM((snap.data->>'revision_count')::NUMERIC),    0)::BIGINT            AS revision_count,
    COALESCE(SUM((snap.data->>'estimated_seconds')::NUMERIC), 0)::BIGINT            AS estimated_seconds,
    gs.ps = v_current_start                                                          AS is_current_period,
    COALESCE(SUM((snap.data->>'within_budget_tasks')::NUMERIC), 0)::BIGINT          AS within_budget_tasks,
    COALESCE(SUM((snap.data->>'over_budget_tasks')::NUMERIC),   0)::BIGINT          AS over_budget_tasks
  FROM
    generate_series(0, p_n_periods - 1) AS gs_i(i),
    LATERAL (
      SELECT (v_current_start - (gs_i.i * ('1 ' || p_period_type)::INTERVAL))::DATE AS ps
    ) AS gs
  LEFT JOIN public.analytics_snapshots snap
    ON  snap.snapshot_type = 'user_performance'
    AND snap.subject_id    = p_user_id
    AND snap.period_type   = p_period_type
    AND snap.period_start  = gs.ps
    AND (p_company_id IS NULL OR snap.company_id = p_company_id)
  GROUP BY gs_i.i, gs.ps, v_current_start
  ORDER BY gs_i.i;
END;
$$;


ALTER FUNCTION "public"."rpc_get_user_performance_series"("p_user_id" "uuid", "p_period_type" "text", "p_n_periods" integer, "p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_user_performance_summary"("p_user_id" "uuid", "p_from" "date", "p_to" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id      uuid;
  v_weight_pts      bigint  := 0;
  v_active_secs     bigint  := 0;
  v_est_secs        numeric := 0;
  v_completed       bigint  := 0;
  v_failed          bigint  := 0;
  v_revision_cnt    bigint  := 0;
  v_on_time         bigint  := 0;
  v_d_weight        bigint;
  v_d_completed     bigint;
  v_d_failed        bigint;
  v_d_est           numeric;
  v_d_on_time       bigint;
  v_d_secs          bigint;
  v_d_rev           bigint;
BEGIN
  IF auth.uid() <> p_user_id
     AND NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;

  SELECT company_id INTO v_company_id FROM public.users WHERE id = p_user_id;
  IF v_company_id IS NULL THEN RETURN '{}'; END IF;

  -- Live terminal tasks for this user in the window
  SELECT
    COALESCE(SUM(CASE WHEN ps.terminal_type = 'success' THEN t.weight ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ps.terminal_type = 'success' THEN 1         ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ps.terminal_type = 'failure' THEN 1         ELSE 0 END), 0),
    COALESCE(SUM(COALESCE(t.estimated_hours, 0) * 3600), 0),
    COALESCE(SUM(CASE WHEN t.due_date IS NOT NULL
                       AND t.completed_at <= t.due_date THEN 1 ELSE 0 END), 0)
  INTO v_d_weight, v_d_completed, v_d_failed, v_d_est, v_d_on_time
  FROM public.tasks t
  JOIN public.task_assignments ta ON ta.task_id = t.id AND ta.assignee_user_id = p_user_id
  JOIN public.pipeline_stages ps  ON ps.id = t.current_stage_id
  WHERE t.company_id   = v_company_id
    AND ps.is_terminal = true
    AND t.completed_at >= p_from::timestamptz
    AND t.completed_at <  p_to::timestamptz;

  v_weight_pts := v_d_weight;  v_completed := v_d_completed;
  v_failed     := v_d_failed;  v_est_secs  := v_d_est;  v_on_time := v_d_on_time;

  SELECT COALESCE(SUM(ws.total_seconds_spent), 0)
  INTO v_d_secs
  FROM public.task_work_sessions ws
  WHERE ws.user_id    = p_user_id AND ws.company_id = v_company_id
    AND ws.status     = 'completed'
    AND ws.started_at >= p_from::timestamptz AND ws.started_at < p_to::timestamptz;
  v_active_secs := v_d_secs;

  SELECT COALESCE(SUM(ts.revision_count), 0)
  INTO v_d_rev
  FROM public.task_submissions ts
  WHERE ts.submitted_by  = p_user_id AND ts.company_id = v_company_id
    AND ts.submitted_at >= p_from::timestamptz AND ts.submitted_at < p_to::timestamptz;
  v_revision_cnt := v_d_rev;

  -- Archived tasks in the window
  SELECT
    COALESCE(SUM(CASE
      WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
           (SELECT id FROM public.pipeline_stages WHERE terminal_type = 'success')
      THEN (ar.snapshot->'task'->>'weight')::bigint ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
           (SELECT id FROM public.pipeline_stages WHERE terminal_type = 'success')
      THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN (ar.snapshot->'task'->>'current_stage_id')::uuid IN
           (SELECT id FROM public.pipeline_stages WHERE terminal_type = 'failure')
      THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(COALESCE((ar.snapshot->'task'->>'estimated_hours')::numeric, 0) * 3600), 0),
    COALESCE(SUM(CASE
      WHEN ar.snapshot->'task'->>'due_date' IS NOT NULL
       AND (ar.snapshot->'task'->>'completed_at')::timestamptz
            <= (ar.snapshot->'task'->>'due_date')::timestamptz
      THEN 1 ELSE 0 END), 0)
  INTO v_d_weight, v_d_completed, v_d_failed, v_d_est, v_d_on_time
  FROM public.archives ar
  WHERE ar.company_id  = v_company_id AND ar.entity_type = 'task'
    AND ar.metadata    @> jsonb_build_object('involved_user_ids', jsonb_build_array(p_user_id))
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_from::timestamptz
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  p_to::timestamptz;

  v_weight_pts := v_weight_pts + v_d_weight;  v_completed := v_completed + v_d_completed;
  v_failed     := v_failed     + v_d_failed;  v_est_secs  := v_est_secs  + v_d_est;
  v_on_time    := v_on_time    + v_d_on_time;

  SELECT v_active_secs + COALESCE(SUM((ws_el->>'total_seconds_spent')::bigint), 0)
  INTO v_active_secs
  FROM public.archives ar,
       jsonb_array_elements(ar.snapshot->'work_sessions') AS ws_el
  WHERE ar.company_id  = v_company_id AND ar.entity_type = 'task'
    AND ar.metadata    @> jsonb_build_object('involved_user_ids', jsonb_build_array(p_user_id))
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_from::timestamptz
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  p_to::timestamptz
    AND (ws_el->>'user_id')::uuid = p_user_id
    AND ws_el->>'status' = 'completed';

  SELECT v_revision_cnt + COALESCE(SUM((sub_el->'submission'->>'revision_count')::integer), 0)
  INTO v_revision_cnt
  FROM public.archives ar,
       jsonb_array_elements(ar.snapshot->'submissions') AS sub_el
  WHERE ar.company_id  = v_company_id AND ar.entity_type = 'task'
    AND ar.metadata    @> jsonb_build_object('involved_user_ids', jsonb_build_array(p_user_id))
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_from::timestamptz
    AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  p_to::timestamptz
    AND (sub_el->'submission'->>'submitted_by')::uuid = p_user_id;

  RETURN jsonb_build_object(
    'weight_points',       v_weight_pts,
    'active_seconds',      v_active_secs,
    'estimated_seconds',   v_est_secs,
    'completed_tasks',     v_completed,
    'failed_tasks',        v_failed,
    'revision_count',      v_revision_cnt,
    'on_time_tasks',       v_on_time,
    'timer_efficiency',
      CASE WHEN v_est_secs > 0
           THEN ROUND((v_active_secs::numeric / v_est_secs) * 100, 1)
           ELSE NULL END,
    'on_time_rate',
      CASE WHEN (v_completed + v_failed) > 0
           THEN ROUND((v_on_time::numeric / (v_completed + v_failed)) * 100, 1)
           ELSE NULL END
  );
END;
$$;


ALTER FUNCTION "public"."rpc_get_user_performance_summary"("p_user_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_global_search"("p_terms" "text", "p_types" "text"[] DEFAULT NULL::"text"[], "p_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_to" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 40, "p_date_field" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company uuid := public.my_company_id();
  v_terms text := trim(COALESCE(p_terms, ''));
  v_has boolean := v_terms <> '';
  v_tsq tsquery;
  v_like text := '%' || v_terms || '%';
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 40), 1), 200);
  v_field text := CASE WHEN p_date_field IN ('due','completed','created') THEN p_date_field ELSE 'created' END;
  v_result jsonb;
BEGIN
  IF v_company IS NULL OR (NOT v_has AND p_from IS NULL AND p_to IS NULL) THEN
    RETURN '[]'::jsonb;
  END IF;
  IF v_has THEN
    v_tsq := websearch_to_tsquery('english', v_terms);
    IF v_tsq IS NOT NULL AND v_tsq::text <> '' THEN
      v_tsq := to_tsquery('english', regexp_replace(v_tsq::text, '''([^'']+)''', '''\1'':*', 'g'));
    END IF;
  END IF;
  WITH candidates AS (
    SELECT 'task'::text AS type, t.id, t.title AS title,
           CASE WHEN v_has THEN ts_headline('english', coalesce(t.description, t.title), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=14,MinWords=4')
                ELSE left(coalesce(t.description,''), 120) END AS snippet,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND t.search_tsv @@ v_tsq THEN ts_rank(t.search_tsv, v_tsq)
                ELSE 0.05 * word_similarity(v_terms, t.title) END AS score,
           t.created_at, t.id AS task_id, 'task'::text AS acl,
           CASE v_field WHEN 'due' THEN t.due_date WHEN 'completed' THEN t.completed_at ELSE t.created_at END AS eff_date
    FROM public.tasks t
    WHERE t.company_id = v_company AND t.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND t.search_tsv @@ v_tsq) OR word_similarity(v_terms, t.title) >= 0.45)
    UNION ALL
    SELECT 'report', r.id, initcap(replace(r.report_type,'_',' ')),
           CASE WHEN v_has THEN ts_headline('english', coalesce(r.parameters::text,''), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=12,MinWords=3')
                ELSE r.status END,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND r.search_tsv @@ v_tsq THEN ts_rank(r.search_tsv, v_tsq)
                ELSE 0.04 END,
           r.created_at, NULL::uuid, 'report', r.created_at
    FROM public.reporting_jobs r
    WHERE r.company_id = v_company
      AND (NOT v_has OR (v_tsq IS NOT NULL AND r.search_tsv @@ v_tsq) OR replace(r.report_type,'_',' ') ILIKE v_like)
    UNION ALL
    SELECT 'comment', c.id, left(c.content, 60),
           CASE WHEN v_has THEN ts_headline('english', coalesce(c.content,''), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=16,MinWords=4')
                ELSE left(c.content, 120) END,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND c.search_tsv @@ v_tsq THEN ts_rank(c.search_tsv, v_tsq)
                ELSE 0.04 END,
           c.created_at, c.task_id, 'task', c.created_at
    FROM public.task_comments c
    WHERE c.company_id = v_company AND c.deleted_at IS NULL
      AND (NOT v_has OR (v_tsq IS NOT NULL AND c.search_tsv @@ v_tsq) OR c.content ILIKE v_like)
    UNION ALL
    SELECT 'file', f.id, f.original_name,
           CASE WHEN v_has THEN ts_headline('english', coalesce(f.caption, f.original_name), COALESCE(v_tsq, plainto_tsquery('english', v_terms)), 'MaxFragments=1,MaxWords=12,MinWords=3')
                ELSE coalesce(f.caption,'') END,
           CASE WHEN NOT v_has THEN 0::real
                WHEN v_tsq IS NOT NULL AND f.search_tsv @@ v_tsq THEN ts_rank(f.search_tsv, v_tsq)
                ELSE 0.05 * word_similarity(v_terms, f.original_name) END,
           f.created_at, NULL::uuid, 'filehub', f.created_at
    FROM public.filehub_files f
    WHERE f.company_id = v_company AND f.deleted_at IS NULL AND f.visibility <> 'task'
      AND (NOT v_has OR (v_tsq IS NOT NULL AND f.search_tsv @@ v_tsq) OR word_similarity(v_terms, f.original_name) >= 0.45)
    UNION ALL
    SELECT 'file', fi.file_id, fi.file_name, fi.file_name, 0.03::real, fi.created_at, fi.task_id, 'task', fi.created_at
    FROM public.files_index fi
    WHERE fi.company_id = v_company AND fi.source IN ('submission','task_brief') AND (NOT v_has OR fi.file_name ILIKE v_like)
    UNION ALL
    SELECT 'person', u.id, COALESCE(u.full_name, u.display_name, u.email),
           NULLIF(concat_ws(' · ', NULLIF(u.job_title,''), NULLIF(u.department,'')), ''),
           GREATEST(
             CASE WHEN u.full_name ILIKE v_like OR u.display_name ILIKE v_like OR u.email ILIKE v_like THEN 0.6 ELSE 0 END,
             0.4 * word_similarity(v_terms, coalesce(u.full_name, ''))
           )::real,
           u.created_at, NULL::uuid, 'person', u.created_at
    FROM public.users u
    WHERE u.company_id = v_company AND u.deleted_at IS NULL AND v_has
      AND (u.full_name ILIKE v_like OR u.display_name ILIKE v_like OR u.email ILIKE v_like
           OR u.job_title ILIKE v_like OR u.department ILIKE v_like OR word_similarity(v_terms, coalesce(u.full_name, '')) >= 0.45)
  ),
  filtered AS (
    SELECT * FROM candidates c
    WHERE (p_types IS NULL OR c.type = ANY (p_types))
      AND (p_from IS NULL OR c.eff_date >= p_from) AND (p_to IS NULL OR c.eff_date <= p_to)
    ORDER BY c.score DESC, c.created_at DESC
    LIMIT v_limit * 3
  ),
  allowed AS (
    SELECT * FROM filtered f
    WHERE CASE f.acl
      WHEN 'task' THEN f.task_id IS NOT NULL AND public.task_list_visible(f.task_id)
      WHEN 'filehub' THEN public.filehub_file_accessible(f.id)
      WHEN 'report' THEN public.has_permission('report.view') OR COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = auth.uid()), FALSE)
      WHEN 'person' THEN public.has_permission('user.view_all') OR public.has_permission('role.manage')
      ELSE FALSE
    END
    ORDER BY f.score DESC, f.created_at DESC
    LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type', a.type, 'id', a.id, 'title', a.title, 'snippet', a.snippet,
    'score', a.score, 'created_at', a.created_at, 'task_id', a.task_id
  ) ORDER BY a.score DESC, a.created_at DESC), '[]'::jsonb)
  INTO v_result FROM allowed a;
  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."rpc_global_search"("p_terms" "text", "p_types" "text"[], "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_limit" integer, "p_date_field" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_heartbeat_work"("p_session_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.task_work_sessions
    SET last_heartbeat_at = now()
    WHERE id = p_session_id 
      AND user_id = auth.uid() 
      AND status = 'active'
      AND EXISTS (
          SELECT 1 FROM public.task_participants 
          WHERE task_id = public.task_work_sessions.task_id AND user_id = auth.uid()
      );

    RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."rpc_heartbeat_work"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_import_place_task_stage"("p_task_id" "uuid", "p_stage_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id    UUID := auth.uid();
  v_task       RECORD;
  v_stage_name TEXT;
  v_from_name  TEXT;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('task.create')
    OR public.has_permission('system.view_all_data')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  SELECT id, current_stage_id, pipeline_id, company_id
  INTO   v_task
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_task.id IS NULL OR v_task.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  -- Target stage must belong to this task's pipeline.
  SELECT name INTO v_stage_name
  FROM   public.pipeline_stages
  WHERE  id = p_stage_id AND pipeline_id = v_task.pipeline_id;

  IF v_stage_name IS NULL THEN
    RAISE EXCEPTION 'Stage does not belong to task pipeline';
  END IF;

  IF v_task.current_stage_id IS DISTINCT FROM p_stage_id THEN
    SELECT name INTO v_from_name
    FROM   public.pipeline_stages WHERE id = v_task.current_stage_id;

    UPDATE public.tasks
    SET    current_stage_id = p_stage_id, status = v_stage_name
    WHERE  id = p_task_id;

    INSERT INTO public.pipeline_stage_history (
      task_id, company_id, pipeline_id,
      from_stage_id, to_stage_id,
      transitioned_by, from_stage_name, to_stage_name
    )
    VALUES (
      p_task_id, v_company_id, v_task.pipeline_id,
      v_task.current_stage_id, p_stage_id,
      v_user_id, v_from_name, v_stage_name
    );
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_import_place_task_stage"("p_task_id" "uuid", "p_stage_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_join_company_by_code"("p_join_code" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_company_id    UUID;
  v_user_id       UUID := auth.uid();
  v_last_attempt  TIMESTAMPTZ;
  v_default_role  UUID;
BEGIN
  SELECT last_join_attempt_at INTO v_last_attempt FROM public.users WHERE id = v_user_id;
  IF v_last_attempt IS NOT NULL AND v_last_attempt > NOW() - INTERVAL '10 seconds' THEN
    RAISE EXCEPTION 'Too many join attempts. Please wait 10 seconds.';
  END IF;
  UPDATE public.users SET last_join_attempt_at = NOW() WHERE id = v_user_id;

  SELECT id INTO v_company_id 
  FROM   public.companies 
  WHERE  UPPER(join_code) = UPPER(p_join_code) 
    AND  deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired join code.';
  END IF;

  UPDATE public.users SET company_id = v_company_id, is_owner = FALSE WHERE id = v_user_id;

  SELECT id INTO v_default_role FROM public.roles
  WHERE  (company_id = v_company_id OR company_id IS NULL) AND is_default = TRUE AND deleted_at IS NULL
  ORDER BY company_id NULLS LAST LIMIT 1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role_id, company_id) VALUES (v_user_id, v_default_role, v_company_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_company_id;
END;
$$;


ALTER FUNCTION "public"."rpc_join_company_by_code"("p_join_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_leave_company"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_is_owner    BOOLEAN;
  v_owner_count INT;
BEGIN
  SELECT company_id, is_owner INTO v_company_id, v_is_owner FROM public.users WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RETURN FALSE; END IF;
  IF v_is_owner THEN
    SELECT COUNT(*) INTO v_owner_count FROM public.users WHERE company_id = v_company_id AND is_owner = TRUE;
    IF v_owner_count <= 1 THEN RAISE EXCEPTION 'Cannot leave. You are the last owner.'; END IF;
  END IF;
  UPDATE public.users SET company_id = NULL, is_owner = FALSE WHERE id = v_user_id;
  DELETE FROM public.user_roles WHERE user_id = v_user_id AND company_id = v_company_id;
  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."rpc_leave_company"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_list_deleted_submissions"("p_task_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_task      RECORD;
  v_result    JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, company_id INTO v_task
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF NOT FOUND OR v_task.company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT has_permission('tasks.manage')
    AND NOT (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_caller_id)
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- Same JSONB shape as rpc_get_task_details v_submissions + deleted_at/deleted_by
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id, 'content', s.content, 'status', s.status, 'revision_count', s.revision_count,
      'submitted_at', s.submitted_at, 'reviewed_at', s.reviewed_at, 'review_notes', s.review_notes,
      'submitted_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = s.submitted_by),
      'reviewed_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = s.reviewed_by),
      'stage_name', (SELECT name FROM public.pipeline_stages WHERE id = s.stage_id),
      'attachments', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'file_url', a.file_url,
          'mime_type', a.mime_type, 'category', a.category, 'file_size', a.file_size, 'storage_path', a.storage_path))
         FROM public.submission_attachments a WHERE a.submission_id = s.id AND a.version_id = s.current_version_id),
        '[]'::jsonb
      ),
      'deleted_at', s.deleted_at,
      'deleted_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = s.deleted_by)
    ) ORDER BY s.deleted_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM public.task_submissions s
  WHERE s.task_id = p_task_id AND s.deleted_at IS NOT NULL;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."rpc_list_deleted_submissions"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_list_deleted_task_attachments"("p_task_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_task      RECORD;
  v_result    JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, company_id INTO v_task
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF NOT FOUND OR v_task.company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT has_permission('tasks.manage')
    AND NOT (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_caller_id)
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id, 'file_name', a.file_name, 'file_url', a.file_url,
      'storage_path', a.storage_path, 'file_size', a.file_size,
      'mime_type', a.mime_type, 'category', a.category,
      'uploaded_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = a.uploaded_by),
      'created_at', a.created_at,
      'version_count', (SELECT COUNT(*) FROM public.task_attachment_versions v WHERE v.attachment_id = a.id),
      'current_version_id', a.current_version_id,
      'deleted_at', a.deleted_at,
      'deleted_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = a.deleted_by)
    ) ORDER BY a.deleted_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM public.task_attachments a
  WHERE a.task_id = p_task_id AND a.deleted_at IS NOT NULL;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."rpc_list_deleted_task_attachments"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_list_rule_deliveries"("p_event_type" "text", "p_limit" integer DEFAULT 50) RETURNS TABLE("id" "uuid", "user_id" "uuid", "recipient_name" "text", "title" "text", "body" "text", "channels_sent" "text"[], "read_at" timestamp with time zone, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    n.id,
    n.user_id,
    COALESCE(u.display_name, u.full_name, u.email, 'Unknown user') AS recipient_name,
    n.title,
    n.body,
    n.channels_sent,
    n.read_at,
    n.created_at
  FROM public.notifications n
  LEFT JOIN public.users u ON u.id = n.user_id
  WHERE n.type = p_event_type
  ORDER BY n.created_at DESC
  LIMIT GREATEST(LEAST(p_limit, 200), 1);
END;
$$;


ALTER FUNCTION "public"."rpc_list_rule_deliveries"("p_event_type" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_list_trial_codes"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', tc.id, 'code', tc.code, 'plan_code', tc.plan_code,
      'duration_hours', tc.duration_hours, 'max_redemptions', tc.max_redemptions,
      'redeemed_count', tc.redeemed_count, 'expires_at', tc.expires_at,
      'notes', tc.notes, 'created_at', tc.created_at
    ) ORDER BY tc.created_at DESC)
    FROM public.trial_codes tc
  ), '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."rpc_list_trial_codes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_log_manual_time"("p_task_id" "uuid", "p_stage_id" "uuid", "p_declared_minutes" integer, "p_reason" "text" DEFAULT NULL::"text", "p_transition_id" "uuid" DEFAULT NULL::"uuid", "p_worked_date" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id               UUID    := auth.uid();
    v_task                  RECORD;
    v_company_id            UUID;
    v_is_owner              BOOLEAN;
    v_is_manager            BOOLEAN;
    v_is_assigned           BOOLEAN;
    v_existing_status       TEXT;
    v_is_flagged            BOOLEAN := false;
    v_flag_reason           TEXT    := NULL;
    v_estimated_minutes     NUMERIC;
    v_stage_p95_minutes     NUMERIC;
    v_minutes_since_created NUMERIC;
    v_worked_date           DATE    := COALESCE(p_worked_date, CURRENT_DATE);
BEGIN
    IF p_declared_minutes IS NULL OR p_declared_minutes <= 0 THEN
        RAISE EXCEPTION 'Declared time must be greater than 0 minutes' USING ERRCODE = 'P0001';
    END IF;
    IF p_declared_minutes > 1440 THEN
        RAISE EXCEPTION 'Declared time cannot exceed 24 hours (1440 minutes)' USING ERRCODE = 'P0001';
    END IF;
    IF v_worked_date > CURRENT_DATE THEN
        RAISE EXCEPTION 'Work date cannot be in the future' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
    IF v_task IS NULL THEN
        RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
    END IF;

    v_company_id := v_task.company_id;
    IF v_company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    v_is_owner   := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
    v_is_manager := v_task.manager_id = v_user_id;
    v_is_assigned := EXISTS (
        SELECT 1 FROM public.task_assignments
        WHERE task_id = p_task_id
          AND (
            assignee_user_id = v_user_id
            OR assignee_team_id IN (
                SELECT team_id FROM public.team_members
                WHERE user_id = v_user_id AND removed_at IS NULL
            )
          )
    );

    IF NOT (v_is_assigned OR v_is_manager OR v_is_owner) THEN
        RAISE EXCEPTION 'You are not assigned to this task' USING ERRCODE = '42501';
    END IF;

    -- Race guard: if a pending entry already exists, do not let the same user
    -- overwrite it with a different transition while the manager is reviewing.
    SELECT approval_status INTO v_existing_status
    FROM public.task_manual_time_entries
    WHERE task_id = p_task_id AND stage_id = p_stage_id AND user_id = v_user_id;

    IF v_existing_status = 'pending' THEN
        RAISE EXCEPTION 'A time declaration is already awaiting manager approval for this stage.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Fraud check 1: task estimated_hours
    IF v_task.estimated_hours IS NOT NULL THEN
        v_estimated_minutes := v_task.estimated_hours * 60;
        IF p_declared_minutes > v_estimated_minutes THEN
            v_is_flagged  := true;
            v_flag_reason := format(
                'Declared time (%s min) exceeds task estimate (%s min)',
                p_declared_minutes, v_estimated_minutes::integer
            );
        END IF;
    END IF;

    -- Fraud check 2: stage P95
    IF NOT v_is_flagged THEN
        SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.total_seconds_spent) / 60.0
        INTO v_stage_p95_minutes
        FROM public.task_work_sessions s
        WHERE s.stage_id          = p_stage_id
          AND s.status            = 'completed'
          AND s.total_seconds_spent IS NOT NULL
          AND s.total_seconds_spent > 60;

        IF v_stage_p95_minutes IS NOT NULL AND p_declared_minutes > (v_stage_p95_minutes * 2) THEN
            v_is_flagged  := true;
            v_flag_reason := format(
                'Declared time (%s min) exceeds 2x stage P95 average (%s min)',
                p_declared_minutes, v_stage_p95_minutes::integer
            );
        END IF;
    END IF;

    -- Fraud check 3: temporal plausibility
    v_minutes_since_created := EXTRACT(EPOCH FROM (now() - v_task.created_at)) / 60.0;
    IF p_declared_minutes > v_minutes_since_created THEN
        v_is_flagged  := true;
        v_flag_reason := format(
            'Declared time (%s min) exceeds time since task creation (%s min)',
            p_declared_minutes, v_minutes_since_created::integer
        );
    END IF;

    INSERT INTO public.task_manual_time_entries
        (task_id, stage_id, user_id, company_id, declared_minutes, reason,
         is_flagged, flag_reason, pending_transition_id, worked_date)
    VALUES
        (p_task_id, p_stage_id, v_user_id, v_company_id, p_declared_minutes, p_reason,
         v_is_flagged, v_flag_reason, p_transition_id, v_worked_date)
    ON CONFLICT (task_id, stage_id, user_id) DO UPDATE
        SET declared_minutes      = EXCLUDED.declared_minutes,
            reason                = EXCLUDED.reason,
            is_flagged            = EXCLUDED.is_flagged,
            flag_reason           = EXCLUDED.flag_reason,
            pending_transition_id = EXCLUDED.pending_transition_id,
            worked_date           = EXCLUDED.worked_date,
            logged_at             = now(),
            approval_status       = 'pending',
            rejection_reason      = NULL,
            approved_at           = NULL,
            approved_by           = NULL;

    IF v_is_flagged AND v_task.manager_id IS NOT NULL THEN
        PERFORM public.fn_emit_notification_event(
            'task.manual_time_flagged', 'task', p_task_id, v_user_id,
            jsonb_build_object(
                'declared_minutes', p_declared_minutes,
                'flag_reason',      v_flag_reason,
                'stage_id',         p_stage_id,
                'manager_id',       v_task.manager_id
            )
        );
    END IF;

    PERFORM public.log_event(
        v_company_id, v_user_id, 'task', p_task_id, 'task.manual_time_logged',
        jsonb_build_object(
            'declared_minutes', p_declared_minutes,
            'is_flagged',       v_is_flagged,
            'stage_id',         p_stage_id,
            'worked_date',      v_worked_date
        )
    );

    RETURN jsonb_build_object(
        'success',         true,
        'is_flagged',      v_is_flagged,
        'flag_reason',     v_flag_reason,
        'approval_status', 'pending'
    );
END;
$$;


ALTER FUNCTION "public"."rpc_log_manual_time"("p_task_id" "uuid", "p_stage_id" "uuid", "p_declared_minutes" integer, "p_reason" "text", "p_transition_id" "uuid", "p_worked_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_mark_all_notifications_read"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notifications
  SET    read_at = now()
  WHERE  user_id = auth.uid()
    AND  read_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."rpc_mark_all_notifications_read"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_mark_notification_read"("p_notification_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notifications
  SET    read_at = now()
  WHERE  id      = p_notification_id
    AND  user_id = auth.uid()
    AND  read_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."rpc_mark_notification_read"("p_notification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_my_plan_limits"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT bp.limits
      FROM public.company_billing cb
      JOIN public.billing_plans bp ON bp.code = cb.plan_code
      WHERE cb.company_id = public.my_company_id()
    ),
    '{"max_members": 5, "max_file_bytes": 10485760, "features": []}'::jsonb
  );
$$;


ALTER FUNCTION "public"."rpc_my_plan_limits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_notify_timer_auto_stopped"("p_task_id" "uuid", "p_task_title" "text", "p_duration_seconds" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_hours        INTEGER;
  v_mins         INTEGER;
  v_duration_txt TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  v_hours := p_duration_seconds / 3600;
  v_mins  := (p_duration_seconds % 3600) / 60;

  IF v_hours > 0 THEN
    v_duration_txt := v_hours || 'h ' || v_mins || 'm';
  ELSIF v_mins > 0 THEN
    v_duration_txt := v_mins || 'm';
  ELSE
    v_duration_txt := 'a moment';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data, channels_sent)
  VALUES (
    v_user_id,
    'timer.auto_stopped',
    'Timer stopped due to inactivity',
    'Your timer on "' || COALESCE(p_task_title, 'a task') || '" was stopped after ' || v_duration_txt || ' of inactivity.',
    jsonb_build_object(
      'task_id',          p_task_id,
      'task_title',       COALESCE(p_task_title, ''),
      'duration_seconds', p_duration_seconds
    ),
    ARRAY['in_app']
  );
END;
$$;


ALTER FUNCTION "public"."rpc_notify_timer_auto_stopped"("p_task_id" "uuid", "p_task_title" "text", "p_duration_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_notify_timer_auto_stopped"("p_task_id" "uuid", "p_task_title" "text", "p_duration_seconds" integer, "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id      UUID := COALESCE(p_user_id, auth.uid());
  v_hours        INTEGER;
  v_mins         INTEGER;
  v_duration_txt TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  v_hours := p_duration_seconds / 3600;
  v_mins  := (p_duration_seconds % 3600) / 60;

  IF v_hours > 0 THEN
    v_duration_txt := v_hours || 'h ' || v_mins || 'm';
  ELSIF v_mins > 0 THEN
    v_duration_txt := v_mins || 'm';
  ELSE
    v_duration_txt := 'a moment';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data, channels_sent)
  VALUES (
    v_user_id,
    'timer.auto_stopped',
    'Timer stopped due to inactivity',
    'Your timer on "' || COALESCE(p_task_title, 'a task') || '" was stopped after ' || v_duration_txt || ' of inactivity.',
    jsonb_build_object(
      'task_id',          p_task_id,
      'task_title',       COALESCE(p_task_title, ''),
      'duration_seconds', p_duration_seconds
    ),
    ARRAY['in_app']
  );
END;
$$;


ALTER FUNCTION "public"."rpc_notify_timer_auto_stopped"("p_task_id" "uuid", "p_task_title" "text", "p_duration_seconds" integer, "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_pause_work"("p_task_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  UPDATE public.task_work_sessions
  SET 
    status = 'paused',
    paused_at = NOW(),
    total_seconds_spent = total_seconds_spent + (EXTRACT(EPOCH FROM (NOW() - started_at)))::INTEGER
  WHERE task_id = p_task_id AND user_id = v_user_id AND status = 'active';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active session found to pause.';
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_pause_work"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_ping_task"("p_task_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id      UUID;
  v_user_id         UUID := auth.uid();
  v_task_manager_id UUID;
  v_has_permission  BOOLEAN;
  v_task_title      TEXT;
  v_pinger_name     TEXT;
BEGIN
  SELECT company_id, manager_id, title
  INTO   v_company_id, v_task_manager_id, v_task_title
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  v_has_permission := (
    v_task_manager_id = v_user_id
    OR public.has_permission('task.ping')
    OR (SELECT is_owner FROM public.users WHERE id = v_user_id LIMIT 1)
  );

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'Unauthorized to ping this task';
  END IF;

  SELECT COALESCE(display_name, full_name, 'Someone')
  INTO   v_pinger_name
  FROM   public.users
  WHERE  id = v_user_id;

  -- Activity log entry (drives highlight animation on task detail)
  INSERT INTO public.activity_log (task_id, company_id, user_id, event_type, metadata)
  VALUES (
    p_task_id, v_company_id, v_user_id, 'task_pinged',
    jsonb_build_object('pinged_by', v_user_id, 'pinged_at', NOW())
  );

  -- Realtime delivery rows (one per target; drives sound + live toast)
  INSERT INTO public.task_ping_targets (task_id, company_id, pinged_by, target_user_id)
  SELECT p_task_id, v_company_id, v_user_id, ta.assignee_user_id
  FROM   public.task_assignments ta
  WHERE  ta.task_id = p_task_id
    AND  ta.assignee_user_id IS NOT NULL
    AND  ta.assignee_user_id <> v_user_id;

  -- Persistent in-app notification (one per target; appears in the notification feed)
  INSERT INTO public.notifications (user_id, type, title, body, data, channels_sent)
  SELECT
    ta.assignee_user_id,
    'task.pinged',
    v_pinger_name || ' pinged you',
    'Needs your attention: ' || COALESCE(v_task_title, 'a task'),
    jsonb_build_object(
      'task_id',    p_task_id,
      'task_title', COALESCE(v_task_title, ''),
      'pinged_by',  v_user_id
    ),
    ARRAY['in_app']
  FROM public.task_assignments ta
  WHERE ta.task_id = p_task_id
    AND ta.assignee_user_id IS NOT NULL
    AND ta.assignee_user_id <> v_user_id;
END;
$$;


ALTER FUNCTION "public"."rpc_ping_task"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_pipeline_set_file_visibility"("p_pipeline_id" "uuid", "p_config" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company uuid;
  v_uid     uuid := auth.uid();
  v_preset  text := p_config ->> 'preset';
BEGIN
  SELECT company_id INTO v_company FROM public.pipelines WHERE id = p_pipeline_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Pipeline not found'; END IF;
  IF v_company <> public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF NOT ((SELECT is_owner FROM public.users WHERE id = v_uid) = TRUE
          OR public.has_permission('pipeline.edit')) THEN
    RAISE EXCEPTION 'Insufficient permissions to edit pipelines';
  END IF;

  IF jsonb_typeof(p_config) <> 'object'
     OR v_preset IS NULL
     OR v_preset NOT IN ('task_members', 'submitters_reviewers', 'company', 'custom') THEN
    RAISE EXCEPTION 'Invalid file-visibility config';
  END IF;

  UPDATE public.pipelines
  SET file_visibility = p_config, updated_at = now()
  WHERE id = p_pipeline_id;

  PERFORM public.log_event(
    v_company, v_uid, 'pipeline', p_pipeline_id, 'pipeline.file_visibility_updated',
    jsonb_build_object('preset', v_preset)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_pipeline_set_file_visibility"("p_pipeline_id" "uuid", "p_config" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_activity_timeline"("p_days" integer DEFAULT 30) RETURNS TABLE("day" "date", "tasks_created" bigint, "session_minutes" bigint, "active_users" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH day_series AS (
    SELECT generate_series(
      (NOW() - (p_days * INTERVAL '1 day'))::DATE,
      NOW()::DATE,
      '1 day'::INTERVAL
    )::DATE AS day
  ),
  daily_tasks AS (
    SELECT t.created_at::DATE AS day, COUNT(*) AS cnt
    FROM public.tasks t
    WHERE t.created_at >= NOW() - (p_days * INTERVAL '1 day')
    GROUP BY t.created_at::DATE
  ),
  daily_sessions AS (
    SELECT
      tws.started_at::DATE AS day,
      COALESCE(SUM(EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at)) / 60)::BIGINT, 0) AS mins,
      COUNT(DISTINCT tws.user_id) AS users
    FROM public.task_work_sessions tws
    WHERE tws.started_at >= NOW() - (p_days * INTERVAL '1 day')
    GROUP BY tws.started_at::DATE
  )
  SELECT
    ds.day,
    COALESCE(dt.cnt, 0)    AS tasks_created,
    COALESCE(dws.mins, 0)  AS session_minutes,
    COALESCE(dws.users, 0) AS active_users
  FROM day_series ds
  LEFT JOIN daily_tasks    dt  ON dt.day  = ds.day
  LEFT JOIN daily_sessions dws ON dws.day = ds.day
  ORDER BY ds.day ASC;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_activity_timeline"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_admin_add"("p_email" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'Email is required.';
  END IF;
  INSERT INTO public.platform_admins (email, added_by)
  VALUES (lower(trim(p_email)), auth.jwt() ->> 'email')
  ON CONFLICT (email) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_admin_add"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_admin_remove"("p_email" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  IF (SELECT COUNT(*) FROM public.platform_admins) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last platform admin.';
  END IF;
  DELETE FROM public.platform_admins WHERE email = lower(trim(p_email));
END;
$$;


ALTER FUNCTION "public"."rpc_platform_admin_remove"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_admins_list"() RETURNS TABLE("email" "text", "added_by" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  RETURN QUERY
  SELECT pa.email, pa.added_by, pa.created_at
  FROM public.platform_admins pa
  ORDER BY pa.created_at;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_admins_list"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_companies_overview"("_dummy" boolean DEFAULT NULL::boolean) RETURNS TABLE("id" "uuid", "name" "text", "created_at" timestamp with time zone, "user_count" bigint, "task_count" bigint, "session_minutes_week" bigint, "active_sessions_now" bigint, "last_active_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cu AS (
    SELECT u.company_id, u.id AS user_id
    FROM public.users u
    WHERE u.company_id IS NOT NULL
  ),
  task_counts AS (
    SELECT t.company_id, COUNT(DISTINCT t.id) AS cnt
    FROM public.tasks t
    WHERE t.company_id IS NOT NULL
    GROUP BY t.company_id
  ),
  sessions_week AS (
    SELECT
      cu.company_id,
      COALESCE(SUM(EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at)) / 60)::BIGINT, 0) AS mins,
      MAX(tws.last_heartbeat_at) AS last_at
    FROM public.task_work_sessions tws
    JOIN cu ON cu.user_id = tws.user_id
    WHERE tws.started_at >= NOW() - INTERVAL '7 days'
    GROUP BY cu.company_id
  ),
  sessions_now AS (
    SELECT cu.company_id, COUNT(DISTINCT tws.id) AS cnt
    FROM public.task_work_sessions tws
    JOIN cu ON cu.user_id = tws.user_id
    WHERE tws.status = 'active'
    GROUP BY cu.company_id
  )
  SELECT
    c.id,
    c.name,
    c.created_at,
    COUNT(DISTINCT cu.user_id)   AS user_count,
    COALESCE(tc.cnt, 0)          AS task_count,
    COALESCE(sw.mins, 0)         AS session_minutes_week,
    COALESCE(sn.cnt, 0)          AS active_sessions_now,
    sw.last_at                   AS last_active_at
  FROM public.companies c
  LEFT JOIN cu             ON cu.company_id = c.id
  LEFT JOIN task_counts tc ON tc.company_id = c.id
  LEFT JOIN sessions_week sw ON sw.company_id = c.id
  LEFT JOIN sessions_now  sn ON sn.company_id = c.id
  GROUP BY c.id, c.name, c.created_at, tc.cnt, sw.mins, sw.last_at, sn.cnt
  ORDER BY COALESCE(sw.mins, 0) DESC NULLS LAST;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_companies_overview"("_dummy" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_company_detail"("p_company_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_result JSON;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'company', row_to_json(c.*),
    'members', COALESCE((
      SELECT json_agg(
        json_build_object(
          'id',                   u.id,
          'name',                 COALESCE(u.display_name, u.full_name, au.email),
          'email',                au.email,
          'job_title',            u.job_title,
          'department',           u.department,
          'session_minutes_week', COALESCE((
            SELECT SUM(EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at)) / 60)::INT
            FROM public.task_work_sessions tws
            WHERE tws.user_id = u.id
              AND tws.started_at >= NOW() - INTERVAL '7 days'
          ), 0),
          'is_active', EXISTS(
            SELECT 1 FROM public.task_work_sessions tws2
            WHERE tws2.user_id = u.id AND tws2.status = 'active'
          )
        ) ORDER BY COALESCE(u.full_name, au.email)
      )
      FROM public.users u
      JOIN auth.users au ON au.id = u.id
      WHERE u.company_id = p_company_id
    ), '[]'::JSON),
    'stats', json_build_object(
      'total_tasks', (
        SELECT COUNT(*) FROM public.tasks t
        JOIN public.users u ON u.id = t.manager_id
        WHERE u.company_id = p_company_id
      ),
      'total_session_minutes', COALESCE((
        SELECT SUM(EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at)) / 60)::INT
        FROM public.task_work_sessions tws
        JOIN public.users u ON u.id = tws.user_id
        WHERE u.company_id = p_company_id
      ), 0),
      'active_sessions', (
        SELECT COUNT(*) FROM public.task_work_sessions tws
        JOIN public.users u ON u.id = tws.user_id
        WHERE u.company_id = p_company_id AND tws.status = 'active'
      )
    )
  ) INTO v_result
  FROM public.companies c
  WHERE c.id = p_company_id;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_company_detail"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_company_retention"("p_company_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_settings        public.company_retention_settings%ROWTYPE;
  v_last_active     TIMESTAMPTZ;
  v_days_inactive   INT;
  v_file_count      BIGINT;
  v_session_minutes BIGINT;
  v_file_size_bytes BIGINT;
  v_db_size_bytes   BIGINT;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings
  FROM public.company_retention_settings
  WHERE company_id = p_company_id;

  IF NOT FOUND THEN
    v_settings.company_id            := p_company_id;
    v_settings.inactivity_days       := 90;
    v_settings.warning_interval_days := 10;
    v_settings.user_inactivity_days  := 90;
    v_settings.warnings_enabled      := true;
  END IF;

  SELECT GREATEST(
    COALESCE(MAX(u.last_seen_at), 'epoch'::TIMESTAMPTZ),
    (SELECT created_at FROM public.companies WHERE id = p_company_id)
  ) INTO v_last_active
  FROM public.users u
  WHERE u.company_id = p_company_id AND u.deleted_at IS NULL;

  v_days_inactive := FLOOR(EXTRACT(EPOCH FROM (now() - v_last_active)) / 86400)::INT;

  SELECT COUNT(*), COALESCE(SUM(size_bytes), 0)
  INTO v_file_count, v_file_size_bytes
  FROM public.filehub_files
  WHERE company_id = p_company_id AND deleted_at IS NULL;

  SELECT COALESCE(
    SUM(FLOOR(EXTRACT(EPOCH FROM (last_heartbeat_at - started_at)) / 60)),
    0
  ) INTO v_session_minutes
  FROM public.task_work_sessions
  WHERE company_id = p_company_id AND status = 'completed';

  SELECT (
    (SELECT COALESCE(SUM(pg_column_size(t.*)), 0) FROM public.tasks t WHERE t.company_id = p_company_id)
    + (SELECT COALESCE(SUM(pg_column_size(s.*)), 0) FROM public.task_work_sessions s WHERE s.company_id = p_company_id)
    + (SELECT COALESCE(SUM(pg_column_size(c.*)), 0) FROM public.task_comments c WHERE c.company_id = p_company_id)
    + (SELECT COALESCE(SUM(pg_column_size(f.*)), 0) FROM public.filehub_files f WHERE f.company_id = p_company_id)
    + (SELECT COALESCE(SUM(pg_column_size(u.*)), 0) FROM public.users u WHERE u.company_id = p_company_id AND u.deleted_at IS NULL)
  ) INTO v_db_size_bytes;

  RETURN jsonb_build_object(
    'days_inactive',         v_days_inactive,
    'days_until_purge',      GREATEST(v_settings.inactivity_days - v_days_inactive, 0),
    'inactivity_days',       v_settings.inactivity_days,
    'warning_interval_days', v_settings.warning_interval_days,
    'last_active_at',        v_last_active,
    'status', CASE
      WHEN v_days_inactive >= v_settings.inactivity_days THEN 'overdue'
      WHEN v_days_inactive >= v_settings.inactivity_days - v_settings.warning_interval_days THEN 'warning'
      ELSE 'active'
    END,
    'file_count',      v_file_count,
    'session_minutes', v_session_minutes,
    'file_size_bytes', v_file_size_bytes,
    'db_size_bytes',   v_db_size_bytes
  );
END;
$$;


ALTER FUNCTION "public"."rpc_platform_company_retention"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_delete_company"("p_company_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.users  SET reports_to     = NULL WHERE company_id = p_company_id;
  UPDATE public.teams  SET manager_id     = NULL WHERE company_id = p_company_id;
  UPDATE public.teams  SET parent_team_id = NULL WHERE company_id = p_company_id;

  DELETE FROM public.task_manual_time_entries WHERE company_id = p_company_id;
  DELETE FROM public.user_roles               WHERE company_id = p_company_id;
  DELETE FROM public.team_roles               WHERE company_id = p_company_id;
  DELETE FROM public.team_members             WHERE company_id = p_company_id;
  DELETE FROM public.task_comments            WHERE company_id = p_company_id;
  DELETE FROM public.task_work_sessions       WHERE company_id = p_company_id;
  DELETE FROM public.pipeline_stage_targets   WHERE company_id = p_company_id;
  DELETE FROM public.storage_archive_queue    WHERE company_id = p_company_id;
  DELETE FROM public.archives                 WHERE company_id = p_company_id;

  DELETE FROM public.companies WHERE id = p_company_id;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_delete_company"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_delete_user"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  UPDATE users             SET reports_to  = NULL WHERE reports_to  = p_user_id;
  UPDATE teams             SET manager_id  = NULL WHERE manager_id  = p_user_id;
  UPDATE archives          SET archived_by = NULL WHERE archived_by = p_user_id;
  UPDATE archives          SET restored_by = NULL WHERE restored_by = p_user_id;

  DELETE FROM task_comments      WHERE author_id = p_user_id;
  DELETE FROM task_work_sessions WHERE user_id   = p_user_id;

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_delete_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_extend_retention"("p_company_id" "uuid", "p_inactivity_days" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  p_inactivity_days := LEAST(GREATEST(p_inactivity_days, 7), 3650);

  INSERT INTO public.company_retention_settings AS s
    (company_id, inactivity_days, warning_interval_days, user_inactivity_days, warnings_enabled, updated_by, updated_at)
  VALUES
    (p_company_id, p_inactivity_days, 10, 90, true, auth.uid(), now())
  ON CONFLICT (company_id) DO UPDATE SET
    inactivity_days = EXCLUDED.inactivity_days,
    updated_by      = EXCLUDED.updated_by,
    updated_at      = now();
END;
$$;


ALTER FUNCTION "public"."rpc_platform_extend_retention"("p_company_id" "uuid", "p_inactivity_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_infra_metrics"("p_limit" integer DEFAULT 96) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_db_size          bigint;
  v_active_conn      int;
  v_max_conn         int;
  v_cache_hit        numeric;
  v_total_tables     int;
  v_xact_total       bigint;
  v_prev_xact_total  bigint;
  v_prev_at          timestamptz;
  v_tps              numeric := 0;
  v_secs             numeric;
  v_table_sizes      jsonb;
  v_snapshots        jsonb;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  SELECT pg_database_size(current_database()) INTO v_db_size;

  SELECT count(*)::int INTO v_active_conn
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND state IS NOT NULL
    AND pid != pg_backend_pid();

  SELECT setting::int INTO v_max_conn
  FROM pg_settings WHERE name = 'max_connections';

  SELECT
    CASE WHEN (blks_hit + blks_read) > 0
      THEN round((blks_hit::numeric / (blks_hit + blks_read)) * 100, 2)
      ELSE 100.00
    END
  INTO v_cache_hit
  FROM pg_stat_database
  WHERE datname = current_database();

  SELECT count(*)::int INTO v_total_tables
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

  SELECT (xact_commit + xact_rollback)::bigint INTO v_xact_total
  FROM pg_stat_database
  WHERE datname = current_database();

  SELECT xact_total, captured_at
  INTO v_prev_xact_total, v_prev_at
  FROM platform_infra_snapshots
  ORDER BY captured_at DESC
  LIMIT 1;

  IF v_prev_xact_total IS NOT NULL AND v_prev_at IS NOT NULL
     AND v_xact_total > v_prev_xact_total
  THEN
    v_secs := GREATEST(1, EXTRACT(EPOCH FROM (now() - v_prev_at)));
    v_tps  := round((v_xact_total - v_prev_xact_total)::numeric / v_secs, 2);
  END IF;

  INSERT INTO platform_infra_snapshots
    (db_size_bytes, active_connections, max_connections, cache_hit_ratio, xact_total)
  SELECT v_db_size, v_active_conn, v_max_conn, v_cache_hit, v_xact_total
  WHERE NOT EXISTS (
    SELECT 1 FROM platform_infra_snapshots
    WHERE captured_at > now() - interval '5 minutes'
  );

  DELETE FROM platform_infra_snapshots
  WHERE captured_at < now() - interval '7 days';

  SELECT jsonb_agg(t)
  INTO v_table_sizes
  FROM (
    SELECT jsonb_build_object(
      'name',        relname,
      'size_bytes',  pg_total_relation_size(relid),
      'size_pretty', pg_size_pretty(pg_total_relation_size(relid))
    ) AS t
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 12
  ) sub;

  SELECT jsonb_agg(
    jsonb_build_object(
      'captured_at',        captured_at,
      'db_size_bytes',      db_size_bytes,
      'active_connections', active_connections,
      'cache_hit_ratio',    cache_hit_ratio
    )
    ORDER BY captured_at ASC
  )
  INTO v_snapshots
  FROM (
    SELECT * FROM platform_infra_snapshots
    ORDER BY captured_at DESC
    LIMIT p_limit
  ) s;

  RETURN jsonb_build_object(
    'current', jsonb_build_object(
      'db_size_bytes',      v_db_size,
      'db_size_pretty',     pg_size_pretty(v_db_size),
      'active_connections', v_active_conn,
      'max_connections',    v_max_conn,
      'connection_pct',     CASE WHEN v_max_conn > 0
                              THEN round((v_active_conn::numeric / v_max_conn) * 100, 1)
                              ELSE 0 END,
      'cache_hit_ratio',    v_cache_hit,
      'total_tables',       v_total_tables,
      'tps',                GREATEST(0, v_tps)
    ),
    'snapshots',   COALESCE(v_snapshots,   '[]'::jsonb),
    'table_sizes', COALESCE(v_table_sizes, '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_platform_infra_metrics"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_list_billing_plans"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'code',        p.code,
             'name',        p.name,
             'description', p.description,
             'price_cents', p.price_cents,
             'currency',    p.currency,
             'interval',    p.interval,
             'per_seat',    p.per_seat,
             'sort_order',  p.sort_order,
             'is_active',   p.is_active,
             'features',    p.features,
             'limits',      p.limits
           ) ORDER BY p.sort_order)
    FROM public.billing_plans p
  ), '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."rpc_platform_list_billing_plans"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_live_sessions"("_dummy" boolean DEFAULT NULL::boolean) RETURNS TABLE("session_id" "uuid", "user_id" "uuid", "user_name" "text", "user_email" "text", "company_id" "uuid", "company_name" "text", "task_id" "uuid", "task_title" "text", "started_at" timestamp with time zone, "last_heartbeat_at" timestamp with time zone, "duration_minutes" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    tws.id                                                    AS session_id,
    tws.user_id,
    COALESCE(u.display_name, u.full_name, au.email)           AS user_name,
    au.email                                                  AS user_email,
    u.company_id,
    c.name                                                    AS company_name,
    tws.task_id,
    t.title                                                   AS task_title,
    tws.started_at,
    tws.last_heartbeat_at,
    GREATEST(0, EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at))::INT / 60) AS duration_minutes
  FROM public.task_work_sessions tws
  JOIN  auth.users au  ON au.id  = tws.user_id
  LEFT JOIN public.users u   ON u.id   = tws.user_id
  LEFT JOIN public.companies c ON c.id  = u.company_id
  LEFT JOIN public.tasks t    ON t.id   = tws.task_id
  WHERE tws.status = 'active'
  ORDER BY tws.started_at DESC;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_live_sessions"("_dummy" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_move_user"("p_user_id" "uuid", "p_company_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  UPDATE users SET
    company_id = p_company_id,
    is_owner   = false,
    updated_at = now()
  WHERE id = p_user_id AND deleted_at IS NULL;

  DELETE FROM user_roles WHERE user_id = p_user_id;
  DELETE FROM team_members WHERE user_id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_move_user"("p_user_id" "uuid", "p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_search_users"("p_query" "text" DEFAULT ''::"text", "p_company_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 100) RETURNS TABLE("id" "uuid", "email" "text", "full_name" "text", "display_name" "text", "avatar_url" "text", "phone" "text", "job_title" "text", "department" "text", "is_active" boolean, "is_owner" boolean, "work_status" "text", "company_id" "uuid", "company_name" "text", "created_at" timestamp with time zone, "last_seen_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  RETURN QUERY
  SELECT
    u.id, u.email, u.full_name, u.display_name, u.avatar_url, u.phone,
    u.job_title, u.department, u.is_active, u.is_owner, u.work_status,
    u.company_id, c.name AS company_name, u.created_at, u.last_seen_at
  FROM users u
  LEFT JOIN companies c ON c.id = u.company_id
  WHERE u.deleted_at IS NULL
    AND (
      p_query = ''
      OR u.email        ILIKE '%' || p_query || '%'
      OR u.full_name    ILIKE '%' || p_query || '%'
      OR u.display_name ILIKE '%' || p_query || '%'
    )
    AND (p_company_id IS NULL OR u.company_id = p_company_id)
  ORDER BY u.created_at DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_search_users"("p_query" "text", "p_company_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_update_user"("p_user_id" "uuid", "p_full_name" "text", "p_display_name" "text", "p_phone" "text", "p_job_title" "text", "p_department" "text", "p_work_status" "text", "p_is_active" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;

  UPDATE users SET
    full_name    = NULLIF(TRIM(COALESCE(p_full_name,    '')), ''),
    display_name = NULLIF(TRIM(COALESCE(p_display_name, '')), ''),
    phone        = NULLIF(TRIM(COALESCE(p_phone,        '')), ''),
    job_title    = NULLIF(TRIM(COALESCE(p_job_title,    '')), ''),
    department   = NULLIF(TRIM(COALESCE(p_department,   '')), ''),
    work_status  = NULLIF(TRIM(COALESCE(p_work_status,  '')), ''),
    is_active    = p_is_active,
    updated_at   = now()
  WHERE id = p_user_id AND deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_update_user"("p_user_id" "uuid", "p_full_name" "text", "p_display_name" "text", "p_phone" "text", "p_job_title" "text", "p_department" "text", "p_work_status" "text", "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_upsert_billing_plan"("p_code" "text", "p_name" "text", "p_description" "text", "p_price_cents" integer, "p_currency" "text", "p_interval" "text", "p_per_seat" boolean, "p_sort_order" integer, "p_is_active" boolean, "p_features" "jsonb", "p_limits" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RAISE EXCEPTION 'Plan code is required.';
  END IF;
  IF p_price_cents < 0 THEN
    RAISE EXCEPTION 'Price cannot be negative.';
  END IF;

  INSERT INTO public.billing_plans (code, name, description, price_cents, currency, interval, per_seat, sort_order, is_active, features, limits)
  VALUES (p_code, p_name, p_description, p_price_cents, p_currency, p_interval, p_per_seat, p_sort_order, p_is_active, p_features, p_limits)
  ON CONFLICT (code) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    price_cents = EXCLUDED.price_cents,
    currency    = EXCLUDED.currency,
    interval    = EXCLUDED.interval,
    per_seat    = EXCLUDED.per_seat,
    sort_order  = EXCLUDED.sort_order,
    is_active   = EXCLUDED.is_active,
    features    = EXCLUDED.features,
    limits      = EXCLUDED.limits;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_upsert_billing_plan"("p_code" "text", "p_name" "text", "p_description" "text", "p_price_cents" integer, "p_currency" "text", "p_interval" "text", "p_per_seat" boolean, "p_sort_order" integer, "p_is_active" boolean, "p_features" "jsonb", "p_limits" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_waitlist_list"("p_query" "text" DEFAULT ''::"text", "p_limit" integer DEFAULT 100) RETURNS TABLE("id" "uuid", "email" "text", "company_name" "text", "referral_code" "text", "referred_by_company" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT w.id, w.email, w.company_name, w.referral_code, r.company_name, w.created_at
  FROM public.waitlist_signups w
  LEFT JOIN public.waitlist_signups r ON r.id = w.referred_by_id
  WHERE p_query = '' OR w.email ILIKE '%' || p_query || '%' OR w.company_name ILIKE '%' || p_query || '%'
  ORDER BY w.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
END;
$$;


ALTER FUNCTION "public"."rpc_platform_waitlist_list"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_waitlist_overview"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_total    bigint;
  v_today    bigint;
  v_week     bigint;
  v_referred bigint;
  v_top      jsonb;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.waitlist_signups;
  SELECT count(*) INTO v_today FROM public.waitlist_signups WHERE created_at >= date_trunc('day', now());
  SELECT count(*) INTO v_week FROM public.waitlist_signups WHERE created_at >= now() - interval '7 days';
  SELECT count(*) INTO v_referred FROM public.waitlist_signups WHERE referred_by_id IS NOT NULL;

  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_top
  FROM (
    SELECT
      r.company_name,
      r.referral_code,
      count(w.id) AS referred_count
    FROM public.waitlist_signups r
    JOIN public.waitlist_signups w ON w.referred_by_id = r.id
    GROUP BY r.id, r.company_name, r.referral_code
    ORDER BY count(w.id) DESC
    LIMIT 10
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'today', v_today,
    'this_week', v_week,
    'referred', v_referred,
    'top_referrers', v_top
  );
END;
$$;


ALTER FUNCTION "public"."rpc_platform_waitlist_overview"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_platform_waitlist_timeline"("p_days" integer DEFAULT 30) RETURNS TABLE("day" "date", "signups" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH day_series AS (
    SELECT generate_series(
      (NOW() - (p_days * INTERVAL '1 day'))::DATE,
      NOW()::DATE,
      '1 day'::INTERVAL
    )::DATE AS day
  ),
  daily AS (
    SELECT w.created_at::DATE AS day, COUNT(*) AS cnt
    FROM public.waitlist_signups w
    WHERE w.created_at >= NOW() - (p_days * INTERVAL '1 day')
    GROUP BY w.created_at::DATE
  )
  SELECT ds.day, COALESCE(d.cnt, 0) AS signups
  FROM day_series ds
  LEFT JOIN daily d ON d.day = ds.day
  ORDER BY ds.day ASC;
END;
$$;


ALTER FUNCTION "public"."rpc_platform_waitlist_timeline"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_preview_task_assignee"("p_pipeline_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_mode       TEXT;
  v_pool_type  TEXT;
  v_pool_size  INT;
  v_user_id    UUID;
  v_team_id    UUID;
  v_name       TEXT;
BEGIN
  SELECT company_id, assignment_mode, assignment_pool_type
  INTO v_company_id, v_mode, v_pool_type
  FROM public.pipelines
  WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('mode', 'manual');
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_mode IS NULL OR v_mode = 'manual' THEN
    RETURN jsonb_build_object('mode', 'manual');
  END IF;

  SELECT COUNT(*) INTO v_pool_size
  FROM public.pipeline_assignment_pool pap
  LEFT JOIN public.users u  ON u.id  = pap.member_user_id
  LEFT JOIN public.teams tm ON tm.id = pap.member_team_id
  WHERE pap.pipeline_id = p_pipeline_id
    AND pap.is_withdrawn = false
    AND ((v_pool_type = 'users' AND pap.member_user_id IS NOT NULL AND u.deleted_at IS NULL)
      OR (v_pool_type = 'teams' AND pap.member_team_id IS NOT NULL AND tm.deleted_at IS NULL));

  SELECT fp.user_id, fp.team_id INTO v_user_id, v_team_id
  FROM public.fn_pick_assignee(p_pipeline_id, NULL) fp;

  IF v_user_id IS NOT NULL THEN
    SELECT full_name INTO v_name FROM public.users WHERE id = v_user_id;
  ELSIF v_team_id IS NOT NULL THEN
    SELECT name INTO v_name FROM public.teams WHERE id = v_team_id;
  END IF;

  RETURN jsonb_build_object(
    'mode', v_mode,
    'pool_type', v_pool_type,
    'pool_size', v_pool_size,
    'assignee_user_id', v_user_id,
    'assignee_team_id', v_team_id,
    'assignee_name', v_name
  );
END;
$$;


ALTER FUNCTION "public"."rpc_preview_task_assignee"("p_pipeline_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_process_automations"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_rule RECORD;
  v_task RECORD;
BEGIN
  FOR v_rule IN 
    SELECT * FROM public.pipeline_automations 
    WHERE is_active = TRUE 
    ORDER BY priority DESC, created_at ASC
  LOOP
    FOR v_task IN
      SELECT t.id, t.company_id, t.due_date, t.updated_at
      FROM public.tasks t
      WHERE t.current_stage_id = v_rule.source_stage_id
        AND t.deleted_at IS NULL
      LIMIT 100
    LOOP
      IF v_rule.condition_type = 'overdue' AND v_task.due_date < NOW() THEN
        
        IF (SELECT COUNT(*) FROM public.automation_execution_log 
            WHERE task_id = v_task.id AND automation_id = v_rule.id 
              AND executed_at > NOW() - INTERVAL '1 hour') >= 3 
        THEN
          UPDATE public.pipeline_automations SET is_active = FALSE WHERE id = v_rule.id;
          CONTINUE;
        END IF;

        -- Log Execution with company_id
        INSERT INTO public.automation_execution_log(task_id, automation_id, stage_id, company_id)
        VALUES (v_task.id, v_rule.id, v_rule.target_stage_id, v_task.company_id);

        PERFORM public.rpc_advance_stage(v_task.id, v_rule.target_stage_id);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rpc_process_automations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_project_dashboard"("p_project_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id   UUID := public.my_company_id();
    v_project      JSONB;
    v_totals       JSONB;
    v_by_priority  JSONB;
    v_by_stage     JSONB;
    v_by_category  JSONB;
    v_contributors JSONB;
    v_recent       JSONB;
    v_due_soon     JSONB;
BEGIN
    IF NOT public.has_permission('project.view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view projects.';
    END IF;

    SELECT to_jsonb(x) INTO v_project FROM (
        SELECT p.id, p.name, p.description, p.status, p.expiry_date, p.is_featured, p.created_at
        FROM public.projects p
        WHERE p.id = p_project_id AND p.company_id = v_company_id
    ) x;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Project not found.';
    END IF;

    SELECT jsonb_build_object(
        'total',     COUNT(*),
        'completed', COUNT(*) FILTER (WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)),
        'overdue',   COUNT(*) FILTER (WHERE t.due_date < now() AND NOT COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)),
        'active',    COUNT(*) FILTER (WHERE NOT COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)),
        'completion_rate', CASE WHEN COUNT(*) > 0
            THEN ROUND(COUNT(*) FILTER (WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE))::numeric / COUNT(*) * 100, 1)
            ELSE 0 END,
        'total_weight',     COALESCE(SUM(t.weight), 0),
        'completed_weight', COALESCE(SUM(t.weight) FILTER (WHERE COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)), 0),
        'est_hours',        COALESCE(SUM(t.estimated_hours), 0)
    )
    INTO v_totals
    FROM public.tasks t
    LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.project_id = p_project_id AND t.deleted_at IS NULL;

    SELECT v_totals || jsonb_build_object('tracked_seconds', COALESCE(SUM(ws.total_seconds_spent), 0))
    INTO v_totals
    FROM public.task_work_sessions ws
    JOIN public.tasks t ON t.id = ws.task_id
    WHERE t.project_id = p_project_id AND t.deleted_at IS NULL;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('priority', q.pr, 'count', q.cnt) ORDER BY q.sort_order), '[]'::jsonb)
    INTO v_by_priority
    FROM (
        SELECT COALESCE(t.priority, 'medium') AS pr, COUNT(*) AS cnt,
               CASE COALESCE(t.priority, 'medium')
                   WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END AS sort_order
        FROM public.tasks t
        WHERE t.project_id = p_project_id AND t.deleted_at IS NULL
        GROUP BY COALESCE(t.priority, 'medium')
    ) q;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'stage_id', ps.id, 'name', ps.name, 'color', ps.color, 'position', ps.position,
        'is_terminal', ps.is_terminal, 'terminal_type', ps.terminal_type, 'count', q.cnt
    ) ORDER BY ps.position), '[]'::jsonb)
    INTO v_by_stage
    FROM (
        SELECT t.current_stage_id AS sid, COUNT(*) AS cnt
        FROM public.tasks t
        WHERE t.project_id = p_project_id AND t.deleted_at IS NULL AND t.current_stage_id IS NOT NULL
        GROUP BY t.current_stage_id
    ) q
    JOIN public.pipeline_stages ps ON ps.id = q.sid;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('category', q.cat, 'count', q.cnt) ORDER BY q.cnt DESC), '[]'::jsonb)
    INTO v_by_category
    FROM (
        SELECT COALESCE(NULLIF(trim(t.category), ''), 'Uncategorized') AS cat, COUNT(*) AS cnt
        FROM public.tasks t
        WHERE t.project_id = p_project_id AND t.deleted_at IS NULL
        GROUP BY COALESCE(NULLIF(trim(t.category), ''), 'Uncategorized')
        ORDER BY cnt DESC
        LIMIT 8
    ) q;

    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.secs DESC, t.tasks DESC), '[]'::jsonb)
    INTO v_contributors
    FROM (
        SELECT jsonb_build_object(
                   'user_id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url,
                   'tracked_seconds', COALESCE(SUM(ws.total_seconds_spent), 0),
                   'tasks', COUNT(DISTINCT ws.task_id)
               ) AS row,
               COALESCE(SUM(ws.total_seconds_spent), 0) AS secs,
               COUNT(DISTINCT ws.task_id) AS tasks
        FROM public.task_work_sessions ws
        JOIN public.tasks tk ON tk.id = ws.task_id
        JOIN public.users u  ON u.id = ws.user_id
        WHERE tk.project_id = p_project_id AND tk.deleted_at IS NULL
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY secs DESC, tasks DESC
        LIMIT 6
    ) t;

    SELECT COALESCE(jsonb_agg(r.row ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_recent
    FROM (
        SELECT jsonb_build_object(
                   'id', t.id, 'title', t.title, 'priority', t.priority,
                   'stage_name', ps.name, 'stage_color', ps.color,
                   'due_date', t.due_date, 'created_at', t.created_at,
                   'is_complete', COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)
               ) AS row, t.created_at
        FROM public.tasks t
        LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
        WHERE t.project_id = p_project_id AND t.deleted_at IS NULL
        ORDER BY t.created_at DESC
        LIMIT 8
    ) r;

    SELECT COALESCE(jsonb_agg(r.row ORDER BY r.due_date ASC), '[]'::jsonb)
    INTO v_due_soon
    FROM (
        SELECT jsonb_build_object(
                   'id', t.id, 'title', t.title, 'due_date', t.due_date,
                   'stage_name', ps.name, 'overdue', (t.due_date < now())
               ) AS row, t.due_date
        FROM public.tasks t
        LEFT JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
        WHERE t.project_id = p_project_id AND t.deleted_at IS NULL
          AND t.due_date IS NOT NULL
          AND NOT COALESCE(ps.is_terminal AND ps.terminal_type = 'success', FALSE)
        ORDER BY t.due_date ASC
        LIMIT 5
    ) r;

    RETURN jsonb_build_object(
        'project',      v_project,
        'totals',       COALESCE(v_totals, '{}'::jsonb),
        'by_priority',  COALESCE(v_by_priority, '[]'::jsonb),
        'by_stage',     COALESCE(v_by_stage, '[]'::jsonb),
        'by_category',  COALESCE(v_by_category, '[]'::jsonb),
        'contributors', COALESCE(v_contributors, '[]'::jsonb),
        'recent_tasks', COALESCE(v_recent, '[]'::jsonb),
        'due_soon',     COALESCE(v_due_soon, '[]'::jsonb)
    );
END;
$$;


ALTER FUNCTION "public"."rpc_project_dashboard"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_public_plans"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code',        p.code,
           'name',        p.name,
           'description', p.description,
           'price_cents', p.price_cents,
           'currency',    p.currency,
           'interval',    p.interval,
           'per_seat',    p.per_seat,
           'features',    p.features,
           'limits',      p.limits
         ) ORDER BY p.sort_order), '[]'::jsonb)
  FROM public.billing_plans p
  WHERE p.is_active = true;
$$;


ALTER FUNCTION "public"."rpc_public_plans"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_purge_archives"("p_archive_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_count INT;
BEGIN
    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'No company context';
    END IF;

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('archive.delete')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to delete archives.';
    END IF;

    WITH deleted AS (
        DELETE FROM public.archives
        WHERE id = ANY(p_archive_ids) AND company_id = v_company_id
        RETURNING id
    )
    SELECT count(*) INTO v_count FROM deleted;

    PERFORM public.log_event(v_company_id, auth.uid(), 'archive', NULL, 'archive.purged',
        jsonb_build_object('archive_ids', p_archive_ids, 'count', v_count));

    RETURN jsonb_build_object('deleted_count', v_count);
END;
$$;


ALTER FUNCTION "public"."rpc_purge_archives"("p_archive_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_purge_company"("p_company_id" "uuid", "p_confirm_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_company uuid := public.my_company_id();
  v_name text;
  v_is_owner boolean;
begin
  if v_company is null or p_company_id is distinct from v_company then
    raise exception 'You can only purge your own workspace';
  end if;

  select coalesce(is_owner, false) into v_is_owner from public.users where id = auth.uid();
  if not coalesce(v_is_owner, false) then
    raise exception 'Only the workspace owner can purge the company';
  end if;

  select name into v_name from public.companies where id = p_company_id;
  if v_name is null then raise exception 'Company not found'; end if;
  if p_confirm_name is distinct from v_name then
    raise exception 'Confirmation text does not match the workspace name';
  end if;

  delete from public.task_comments         where company_id = p_company_id;
  delete from public.task_work_sessions     where company_id = p_company_id;
  delete from public.team_members           where company_id = p_company_id;
  delete from public.team_roles             where company_id = p_company_id;
  delete from public.user_roles             where company_id = p_company_id;
  delete from public.pipeline_stage_targets where company_id = p_company_id;
  delete from public.storage_archive_queue  where company_id = p_company_id;
  delete from public.filehub_file_versions  where company_id = p_company_id;
  delete from public.archives               where company_id = p_company_id;

  delete from public.companies where id = p_company_id;

  return jsonb_build_object('purged_company', p_company_id, 'name', v_name);
end;
$$;


ALTER FUNCTION "public"."rpc_purge_company"("p_company_id" "uuid", "p_confirm_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_purge_user"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_company uuid := public.my_company_id();
  v_target public.users%rowtype;
begin
  if v_company is null then raise exception 'No company context'; end if;
  if not public._can_manage_retention() then raise exception 'Not authorized'; end if;

  select * into v_target from public.users where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
  if v_target.company_id is distinct from v_company then raise exception 'User is not in your workspace'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot purge your own account'; end if;
  if coalesce(v_target.is_owner, false) then raise exception 'Cannot purge the workspace owner'; end if;

  update public.teams    set manager_id  = null where manager_id  = p_user_id;
  update public.users    set reports_to  = null where reports_to  = p_user_id;
  update public.archives set archived_by = null where archived_by = p_user_id;
  update public.archives set restored_by = null where restored_by = p_user_id;

  delete from public.task_comments      where author_id = p_user_id;
  delete from public.task_work_sessions where user_id   = p_user_id;

  delete from public.users where id = p_user_id;

  return jsonb_build_object('purged_user', p_user_id, 'email', v_target.email);
end;
$$;


ALTER FUNCTION "public"."rpc_purge_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_redeem_trial_code"("p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company     uuid := public.my_company_id();
  v_user_id     uuid := auth.uid();
  v_code_row    public.trial_codes%rowtype;
  v_trial_ends  timestamptz;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'No company context'; END IF;
  IF NOT public._can_manage_billing() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT * INTO v_code_row FROM public.trial_codes WHERE upper(code) = upper(p_code);
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid trial code.'; END IF;
  IF v_code_row.expires_at IS NOT NULL AND v_code_row.expires_at < now() THEN
    RAISE EXCEPTION 'This trial code has expired.';
  END IF;
  IF v_code_row.max_redemptions IS NOT NULL AND v_code_row.redeemed_count >= v_code_row.max_redemptions THEN
    RAISE EXCEPTION 'This trial code has been fully redeemed.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.trial_code_redemptions WHERE code_id = v_code_row.id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Your workspace has already redeemed this code.';
  END IF;

  v_trial_ends := now() + (v_code_row.duration_hours || ' hours')::interval;

  INSERT INTO public.company_billing (company_id, plan_code, status, trial_ends_at, updated_at)
  VALUES (v_company, v_code_row.plan_code, 'trialing', v_trial_ends, now())
  ON CONFLICT (company_id) DO UPDATE
    SET plan_code = v_code_row.plan_code, status = 'trialing',
        trial_ends_at = v_trial_ends, updated_at = now();

  INSERT INTO public.trial_code_redemptions (code_id, company_id, redeemed_at, trial_ends_at)
  VALUES (v_code_row.id, v_company, now(), v_trial_ends);

  UPDATE public.trial_codes SET redeemed_count = redeemed_count + 1 WHERE id = v_code_row.id;

  INSERT INTO public.billing_events (company_id, type, plan_code, created_by, data)
  VALUES (v_company, 'trial_started', v_code_row.plan_code, v_user_id,
    jsonb_build_object('code', v_code_row.code, 'duration_hours', v_code_row.duration_hours, 'trial_ends_at', v_trial_ends));

  RETURN jsonb_build_object(
    'success', true, 'plan_code', v_code_row.plan_code,
    'trial_ends_at', v_trial_ends, 'duration_hours', v_code_row.duration_hours
  );
END;
$$;


ALTER FUNCTION "public"."rpc_redeem_trial_code"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_remove_push_subscription"("p_device_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE user_id = auth.uid() AND device_id = p_device_id;
END;
$$;


ALTER FUNCTION "public"."rpc_remove_push_subscription"("p_device_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_remove_user_from_company"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_target_user_company_id UUID;
  v_closed INT;
BEGIN
  IF NOT public.has_permission('role.manage') THEN
    RETURN jsonb_build_object('error', 'Permission denied: role.manage required');
  END IF;

  SELECT company_id INTO v_company_id FROM public.users WHERE id = auth.uid();
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No company context found');
  END IF;

  SELECT company_id INTO v_target_user_company_id FROM public.users WHERE id = p_user_id;
  IF v_target_user_company_id IS NULL OR v_target_user_company_id != v_company_id THEN
    RETURN jsonb_build_object('error', 'User not found in this company');
  END IF;

  IF p_user_id = auth.uid() THEN
    RETURN jsonb_build_object('error', 'Cannot remove yourself from the company');
  END IF;

  -- #161: close only THIS user's running timers. internal_stop_task_sessions
  -- is task-scoped and would stop colleagues on the same task too.
  WITH stopped AS (
    UPDATE public.task_work_sessions
    SET status = 'completed',
        completed_at = COALESCE(last_heartbeat_at, now()),
        total_seconds_spent = GREATEST(1, EXTRACT(EPOCH FROM (
            COALESCE(last_heartbeat_at, now()) - started_at))::int)
    WHERE user_id = p_user_id AND status = 'active'
    RETURNING id
  )
  SELECT count(*) INTO v_closed FROM stopped;

  UPDATE public.users
  SET company_id = NULL, updated_at = NOW()
  WHERE id = p_user_id AND company_id = v_company_id;

  RETURN jsonb_build_object('success', true, 'sessions_closed', v_closed);
END;
$$;


ALTER FUNCTION "public"."rpc_remove_user_from_company"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reorder_stage_actions"("p_stage_id" "uuid", "p_action_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_i INTEGER;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to edit pipeline actions';
  END IF;

  FOR v_i IN 1..array_length(p_action_ids, 1) LOOP
    UPDATE public.pipeline_stage_actions
    SET position = v_i
    WHERE id = p_action_ids[v_i] AND stage_id = p_stage_id;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rpc_reorder_stage_actions"("p_stage_id" "uuid", "p_action_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reorder_stages"("p_pipeline_id" "uuid", "p_stage_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_idx        INTEGER := 1;
  v_sid        UUID;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.pipelines WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Pipeline not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- Temporarily set all positions to negative to avoid unique constraint violations
  UPDATE public.pipeline_stages
  SET position = -position
  WHERE pipeline_id = p_pipeline_id;

  FOREACH v_sid IN ARRAY p_stage_ids
  LOOP
    UPDATE public.pipeline_stages
    SET position = v_idx
    WHERE id = v_sid AND pipeline_id = p_pipeline_id;
    v_idx := v_idx + 1;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rpc_reorder_stages"("p_pipeline_id" "uuid", "p_stage_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_reorder_stages"("p_pipeline_id" "uuid", "p_stage_ids" "uuid"[]) IS 'Bulk reorders stages by position array.';



CREATE OR REPLACE FUNCTION "public"."rpc_repair_profile"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id UUID;
    v_email TEXT;
    v_full_name TEXT;
    v_profile_exists BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- Check if profile already exists
    SELECT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id) INTO v_profile_exists;
    IF v_profile_exists THEN
        RETURN jsonb_build_object('success', true, 'message', 'Profile already exists');
    END IF;

    -- Get data from auth.users
    SELECT email, raw_user_meta_data->>'full_name' 
    INTO v_email, v_full_name
    FROM auth.users 
    WHERE id = v_user_id;

    -- Create profile
    INSERT INTO public.users (id, email, full_name, is_owner)
    VALUES (v_user_id, v_email, COALESCE(v_full_name, ''), FALSE)
    ON CONFLICT (id) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'message', 'Profile repaired');
END;
$$;


ALTER FUNCTION "public"."rpc_repair_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_replace_task_attachment"("p_attachment_id" "uuid", "p_storage_path" "text", "p_file_name" "text", "p_file_size" bigint, "p_mime_type" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_att            RECORD;
  v_task           RECORD;
  v_caller_id      UUID := auth.uid();
  v_new_version_id UUID;
  v_new_version_no INT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, task_id, company_id, deleted_at
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

  PERFORM public.log_event(
    v_att.company_id, v_caller_id, 'task', v_att.task_id,
    'task.attachment_replaced',
    jsonb_build_object('attachment_id', p_attachment_id, 'version_no', v_new_version_no, 'file_name', p_file_name)
  );

  RETURN v_new_version_id;
END;
$$;


ALTER FUNCTION "public"."rpc_replace_task_attachment"("p_attachment_id" "uuid", "p_storage_path" "text", "p_file_name" "text", "p_file_size" bigint, "p_mime_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_request_billing_change"("p_plan_code" "text", "p_action" "text" DEFAULT 'subscribe'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company           uuid := public.my_company_id();
  v_plan              public.billing_plans%rowtype;
  v_billing           public.company_billing%rowtype;
  v_members           int;
  v_pipelines         int;
  v_storage           bigint;
  v_new_max_members   int;
  v_new_max_pipelines int;
  v_new_max_storage   bigint;
  v_errors            jsonb := '[]'::jsonb;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'No company context'; END IF;
  IF NOT public._can_manage_billing() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT * INTO v_plan FROM public.billing_plans WHERE code = p_plan_code AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown plan: %', p_plan_code; END IF;

  IF v_plan.code = 'enterprise' THEN
    INSERT INTO public.billing_events (company_id, type, plan_code, created_by, data)
    VALUES (v_company, 'checkout_requested', v_plan.code, auth.uid(), jsonb_build_object('action', p_action));
    RETURN jsonb_build_object(
      'applied',       false,
      'contact_sales', true,
      'plan_code',     v_plan.code,
      'message',       'Contact sales to set up an Enterprise plan.'
    );
  END IF;

  INSERT INTO public.company_billing (company_id) VALUES (v_company) ON CONFLICT (company_id) DO NOTHING;
  SELECT * INTO v_billing FROM public.company_billing WHERE company_id = v_company;

  IF COALESCE(v_billing.plan_code, 'free') = v_plan.code THEN
    RETURN jsonb_build_object('applied', false, 'message', 'Already on this plan.', 'plan_code', v_plan.code);
  END IF;

  v_new_max_members   := CASE WHEN (v_plan.limits->>'max_members')      IS NULL THEN -1 ELSE (v_plan.limits->>'max_members')::int      END;
  v_new_max_pipelines := CASE WHEN (v_plan.limits->>'max_pipelines')     IS NULL THEN -1 ELSE (v_plan.limits->>'max_pipelines')::int     END;
  v_new_max_storage   := CASE WHEN (v_plan.limits->>'max_storage_bytes') IS NULL THEN -1 ELSE (v_plan.limits->>'max_storage_bytes')::bigint END;

  IF v_new_max_members > -1 THEN
    SELECT COUNT(*) INTO v_members FROM public.users WHERE company_id = v_company AND deleted_at IS NULL;
    IF v_members > v_new_max_members THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'resource', 'members', 'current', v_members, 'limit', v_new_max_members,
        'message', format('You have %s members but %s allows %s. Remove members first.', v_members, v_plan.name, v_new_max_members)
      ));
    END IF;
  END IF;

  IF v_new_max_pipelines > -1 THEN
    SELECT COUNT(*) INTO v_pipelines FROM public.pipelines WHERE company_id = v_company AND deleted_at IS NULL;
    IF v_pipelines > v_new_max_pipelines THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'resource', 'pipelines', 'current', v_pipelines, 'limit', v_new_max_pipelines,
        'message', format('You have %s pipelines but %s allows %s. Delete some first.', v_pipelines, v_plan.name, v_new_max_pipelines)
      ));
    END IF;
  END IF;

  IF v_new_max_storage > -1 THEN
    v_storage := COALESCE(v_billing.storage_used_bytes, 0);
    IF v_storage > v_new_max_storage THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'resource', 'storage', 'current_bytes', v_storage, 'limit_bytes', v_new_max_storage,
        'message', format('You are using %s MB but %s allows %s MB. Delete files first.',
                     round(v_storage::numeric / 1048576), v_plan.name, round(v_new_max_storage::numeric / 1048576))
      ));
    END IF;
  END IF;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('applied', false, 'blocked', true, 'plan_code', v_plan.code, 'errors', v_errors);
  END IF;

  UPDATE public.company_billing
  SET plan_code = v_plan.code, status = 'active', trial_ends_at = NULL,
      external_subscription_id = NULL, current_period_end = NULL, updated_at = now()
  WHERE company_id = v_company;

  INSERT INTO public.billing_events (company_id, type, plan_code, created_by, data)
  VALUES (v_company, 'plan_changed', v_plan.code, auth.uid(), jsonb_build_object('action', p_action, 'from', v_billing.plan_code));

  RETURN jsonb_build_object('applied', true, 'plan_code', v_plan.code);
END;
$$;


ALTER FUNCTION "public"."rpc_request_billing_change"("p_plan_code" "text", "p_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_request_report"("p_report_type" "text", "p_parameters" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_job_id     UUID;
  v_company_id UUID;
  v_valid_types TEXT[] := ARRAY[
    'general',
    'performance_audit',
    'worker_comparison',
    'team_comparison',
    'workflow_analysis',
    'user_performance_series',
    'user_performance_summary',
    'pipeline_stage_dwell',
    'pipeline_throughput',
    'personnel_comparison',
    'targets_status',
    'personal_pulse',
    'multi_report',
    'projects'
  ];
BEGIN
  IF NOT (p_report_type = ANY(v_valid_types)) THEN
    RAISE EXCEPTION 'Unknown report type: %. Valid types: %', p_report_type, array_to_string(v_valid_types, ', ');
  END IF;

  v_company_id := public.my_company_id();

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
    OR public.has_permission('report.generate')
    OR public.has_permission('report.view')
    OR public.has_permission('report.export')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to generate reports. Requires report.view or higher.';
  END IF;

  INSERT INTO public.reporting_jobs (company_id, requested_by, report_type, parameters)
  VALUES (v_company_id, auth.uid(), p_report_type, p_parameters)
  RETURNING id INTO v_job_id;

  PERFORM public.log_event(v_company_id, auth.uid(), 'report', v_job_id, 'report.requested', p_parameters);
  RETURN v_job_id;
END;
$$;


ALTER FUNCTION "public"."rpc_request_report"("p_report_type" "text", "p_parameters" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_resolve_handshake_deadlock"("p_parent_task_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id            UUID := auth.uid();
  v_parent             RECORD;
  v_quarantine         JSONB;
  v_child_terminal_id  UUID;
  v_parent_stage_id    UUID;
  v_parent_target      UUID;
BEGIN
  -- 1: Confirm caller is an owner or has override permission
  IF v_user_id IS NOT NULL THEN
    IF NOT (
      (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
      OR public.has_permission('pipeline.manual_override')
    ) THEN
      RAISE EXCEPTION 'Insufficient permissions to resolve handshake deadlock';
    END IF;
  END IF;

  -- 2: Fetch quarantine context from the parent task
  SELECT error_state, quarantine_reason, current_stage_id
  INTO   v_parent
  FROM   public.tasks
  WHERE  id = p_parent_task_id AND deleted_at IS NULL;

  IF v_parent.error_state IS DISTINCT FROM 'handshake_deadlock' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Task is not in handshake_deadlock state');
  END IF;

  v_quarantine        := v_parent.quarantine_reason;
  v_child_terminal_id := (v_quarantine->>'child_terminal_stage_id')::UUID;
  v_parent_stage_id   := v_parent.current_stage_id;

  -- 3: Re-check if the admin has since fixed the mapping
  SELECT parent_target_stage_id INTO v_parent_target
  FROM public.pipeline_linked_outcomes
  WHERE parent_stage_id = v_parent_stage_id
    AND child_terminal_stage_id = v_child_terminal_id;

  IF v_parent_target IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'Outcome mapping still missing in pipeline_linked_outcomes. Fix the pipeline configuration first.'
    );
  END IF;

  -- 4: Mapping found — clear error state and advance parent
  UPDATE public.tasks
  SET error_state = NULL, quarantine_reason = NULL, updated_at = NOW()
  WHERE id = p_parent_task_id;

  PERFORM public.rpc_advance_stage(p_parent_task_id, v_parent_target);

  -- 5: Log the resolution for audit trail
  INSERT INTO public.activity_events (
    company_id, user_id, entity_type, entity_id, event_type, metadata
  )
  SELECT
    company_id, v_user_id, 'task', p_parent_task_id, 'task.handshake_resolved',
    jsonb_build_object(
      'resolved_by',         v_user_id,
      'target_stage_id',     v_parent_target,
      'original_quarantine', v_quarantine
    )
  FROM public.tasks WHERE id = p_parent_task_id;

  RETURN jsonb_build_object('success', true, 'advanced_to_stage', v_parent_target);
END;
$$;


ALTER FUNCTION "public"."rpc_resolve_handshake_deadlock"("p_parent_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_resolve_sub_task"("p_task_id" "uuid", "p_terminal_type" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id     UUID;
  v_user_id        UUID := auth.uid();
  v_pipeline_id    UUID;
  v_terminal_stage UUID;
  v_terminal_name  TEXT;
BEGIN
  -- Fetch context
  SELECT company_id, pipeline_id
  INTO   v_company_id, v_pipeline_id
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Permission Check
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('submission.review')
    OR public.has_permission('task.manage')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to resolve tasks';
  END IF;

  -- Find matching terminal stage
  SELECT id, name INTO v_terminal_stage, v_terminal_name
  FROM   public.pipeline_stages
  WHERE  pipeline_id = v_pipeline_id
    AND  is_terminal = TRUE
    AND  terminal_type = p_terminal_type
  LIMIT 1;

  IF v_terminal_stage IS NULL THEN
    RAISE EXCEPTION 'No terminal stage of type % found for this pipeline', p_terminal_type;
  END IF;

  PERFORM public.rpc_advance_stage(p_task_id, v_terminal_stage);

  PERFORM public.log_event(
    v_company_id, v_user_id, 'task', p_task_id, 'task.resolved',
    jsonb_build_object('terminal_type', p_terminal_type, 'stage_name', v_terminal_name)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_resolve_sub_task"("p_task_id" "uuid", "p_terminal_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_restore_archive"("p_archive_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_archive    RECORD;
    v_task_id    UUID;
    v_company_id UUID;
BEGIN
    v_company_id := public.my_company_id();

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('archive.restore')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to restore from archive.';
    END IF;

    SELECT * INTO v_archive
    FROM public.archives
    WHERE id = p_archive_id AND company_id = v_company_id AND entity_type = 'task';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Archive not found or unauthorized.';
    END IF;

    IF v_archive.restored_at IS NOT NULL THEN
        RAISE EXCEPTION 'This snapshot has already been restored.';
    END IF;

    v_task_id := (v_archive.snapshot->'task'->>'id')::UUID;

    IF EXISTS (SELECT 1 FROM public.tasks WHERE id = v_task_id) THEN
        RAISE EXCEPTION 'A task with this ID already exists in the active pipeline.';
    END IF;

    RETURN public._internal_restore_task_archive(p_archive_id);
END;
$$;


ALTER FUNCTION "public"."rpc_restore_archive"("p_archive_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_restore_project"("p_archive_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_archive          RECORD;
    v_project          JSONB;
    v_project_id       UUID;
    v_company_id       UUID;
    v_task_archive     RECORD;
    v_unrestored_count INT;
    v_previous_count   INT := -1;
BEGIN
    v_company_id := public.my_company_id();

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('archive:create')
        OR public.has_permission('archive.restore')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to restore from archive.';
    END IF;

    SELECT * INTO v_archive
    FROM public.archives
    WHERE id = p_archive_id AND company_id = v_company_id AND entity_type = 'project';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Archive not found or unauthorized.';
    END IF;

    IF v_archive.restored_at IS NOT NULL THEN
        RAISE EXCEPTION 'This snapshot has already been restored.';
    END IF;

    v_project    := v_archive.snapshot->'project';
    v_project_id := (v_project->>'id')::UUID;

    IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id) THEN
        RAISE EXCEPTION 'A project with this ID already exists.';
    END IF;

    -- Restore the project record first
    INSERT INTO public.projects
        SELECT (jsonb_populate_record(NULL::public.projects, v_project)).*;

    -- Restore tasks in topological order (parents before children).
    -- Each loop pass processes all tasks whose parent is already restored.
    -- A deadlock guard exits if no progress is made.
    LOOP
        SELECT COUNT(*) INTO v_unrestored_count
        FROM public.archives
        WHERE company_id = v_company_id
          AND entity_type = 'task'
          AND restored_at IS NULL
          AND (snapshot->'task'->>'project_id') = v_project_id::text;

        EXIT WHEN v_unrestored_count = 0;

        -- Safety: if count didn't decrease, we're stuck (circular ref or orphaned parent)
        IF v_unrestored_count = v_previous_count THEN
            RAISE EXCEPTION
                'Cannot restore project: % task(s) have an unresolvable parent dependency.',
                v_unrestored_count;
        END IF;

        v_previous_count := v_unrestored_count;

        -- Process all tasks that are either top-level OR whose parent is already in tasks table
        FOR v_task_archive IN
            SELECT a.*
            FROM public.archives a
            WHERE a.company_id = v_company_id
              AND a.entity_type = 'task'
              AND a.restored_at IS NULL
              AND (a.snapshot->'task'->>'project_id') = v_project_id::text
              AND (
                  (a.snapshot->'task'->>'parent_task_id') IS NULL
                  OR (a.snapshot->'task'->>'parent_task_id') = ''
                  OR EXISTS (
                      SELECT 1 FROM public.tasks t
                      WHERE t.id = (a.snapshot->'task'->>'parent_task_id')::UUID
                  )
              )
        LOOP
            PERFORM public._internal_restore_task_archive(v_task_archive.id);
        END LOOP;
    END LOOP;

    -- Mark the project archive as restored
    UPDATE public.archives
    SET restored_at = now(), restored_by = auth.uid()
    WHERE id = p_archive_id;

    PERFORM public.log_event(
        v_company_id, auth.uid(), 'project', v_project_id, 'project.restored', v_archive.metadata
    );

    RETURN v_project_id;
END;
$$;


ALTER FUNCTION "public"."rpc_restore_project"("p_archive_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_restore_submission"("p_submission_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_submission RECORD;
  v_caller_id  UUID := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT task_id, company_id INTO v_submission
  FROM   public.task_submissions
  WHERE  id = p_submission_id;

  IF NOT FOUND OR v_submission.company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'submission not found' USING ERRCODE = 'P0002';
  END IF;

  -- Recovery is a management act: tasks.manage OR owner only
  IF NOT has_permission('tasks.manage')
    AND NOT (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_caller_id)
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.task_submissions
  SET    deleted_at = NULL, deleted_by = NULL
  WHERE  id = p_submission_id AND deleted_at IS NOT NULL;

  IF FOUND THEN
    PERFORM public.log_event(
      v_submission.company_id, v_caller_id, 'task', v_submission.task_id,
      'task.submission_restored', jsonb_build_object('submission_id', p_submission_id)
    );
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_restore_submission"("p_submission_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_restore_submission_version"("p_version_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_version    RECORD;
  v_submission RECORD;
  v_caller_id  UUID := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT v.id, v.submission_id, v.version_no, v.content, v.superseded_at
  INTO   v_version
  FROM   public.task_submission_versions v
  WHERE  v.id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'version not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, task_id, company_id, submitted_by, status, deleted_at
  INTO   v_submission
  FROM   public.task_submissions
  WHERE  id = v_version.submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_submission.company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'version not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_submission.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot restore a version of a deleted submission' USING ERRCODE = 'P0001';
  END IF;

  -- Perm as A2 (decision #2)
  IF v_submission.submitted_by <> v_caller_id
    AND NOT has_permission('tasks.manage')
    AND NOT (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_caller_id)
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  IF v_version.superseded_at IS NULL THEN
    RETURN; -- already current: no-op
  END IF;

  -- Pointer move: no new version row, no byte copy (invariant #4)
  UPDATE public.task_submission_versions
  SET    superseded_at = now()
  WHERE  submission_id = v_version.submission_id AND superseded_at IS NULL;

  UPDATE public.task_submission_versions
  SET    superseded_at = NULL
  WHERE  id = p_version_id;

  -- Content changes, so decision #1's re-review rule applies here too.
  UPDATE public.task_submissions
  SET    current_version_id = p_version_id,
         content            = v_version.content,
         status             = CASE WHEN status IN ('approved', 'confirmed') THEN 'pending' ELSE status END,
         updated_at         = now(),
         updated_by         = v_caller_id
  WHERE  id = v_version.submission_id;

  PERFORM public.log_event(
    v_submission.company_id, v_caller_id, 'task', v_submission.task_id,
    'task.submission_version_restored',
    jsonb_build_object('submission_id', v_version.submission_id, 'version_id', p_version_id, 'version_no', v_version.version_no)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_restore_submission_version"("p_version_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_restore_task_attachment"("p_attachment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_att       RECORD;
  v_caller_id UUID := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, task_id, company_id, file_name, deleted_at
  INTO   v_att
  FROM   public.task_attachments
  WHERE  id = p_attachment_id
  FOR UPDATE;

  IF NOT FOUND OR v_att.company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'attachment not found' USING ERRCODE = 'P0002';
  END IF;

  -- Recovery is a management act: tasks.manage OR owner
  IF NOT has_permission('tasks.manage')
    AND NOT (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_caller_id)
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  IF v_att.deleted_at IS NULL THEN
    RETURN; -- not deleted: no-op
  END IF;

  UPDATE public.task_attachments
  SET    deleted_at = NULL, deleted_by = NULL
  WHERE  id = p_attachment_id AND deleted_at IS NOT NULL;

  PERFORM public.log_event(
    v_att.company_id, v_caller_id, 'task', v_att.task_id,
    'task.attachment_restored',
    jsonb_build_object('attachment_id', p_attachment_id, 'file_name', v_att.file_name)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_restore_task_attachment"("p_attachment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_restore_task_attachment_version"("p_version_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_version   RECORD;
  v_att       RECORD;
  v_task      RECORD;
  v_caller_id UUID := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT v.id, v.attachment_id, v.version_no, v.storage_path, v.file_name, v.file_size, v.mime_type, v.superseded_at
  INTO   v_version
  FROM   public.task_attachment_versions v
  WHERE  v.id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'version not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, task_id, company_id, deleted_at
  INTO   v_att
  FROM   public.task_attachments
  WHERE  id = v_version.attachment_id
  FOR UPDATE;

  IF NOT FOUND OR v_att.company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'version not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_att.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot restore a version of a deleted attachment' USING ERRCODE = 'P0001';
  END IF;

  -- Perm as rpc_replace_task_attachment
  SELECT created_by, manager_id INTO v_task
  FROM   public.tasks WHERE id = v_att.task_id;

  IF v_task.created_by <> v_caller_id
    AND (v_task.manager_id IS NULL OR v_task.manager_id <> v_caller_id)
    AND NOT has_permission('tasks.manage')
    AND NOT (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_caller_id)
  THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  IF v_version.superseded_at IS NULL THEN
    RETURN; -- already current: no-op
  END IF;

  -- Pointer move: no new version row, no byte copy (invariant #4)
  UPDATE public.task_attachment_versions
  SET    superseded_at = now()
  WHERE  attachment_id = v_version.attachment_id AND superseded_at IS NULL;

  UPDATE public.task_attachment_versions
  SET    superseded_at = NULL
  WHERE  id = p_version_id;

  UPDATE public.task_attachments
  SET    current_version_id = p_version_id,
         file_name          = v_version.file_name,
         file_url           = v_version.storage_path,
         storage_path       = v_version.storage_path,
         file_size          = v_version.file_size,
         mime_type          = v_version.mime_type,
         updated_at         = now(),
         updated_by         = v_caller_id
  WHERE  id = v_version.attachment_id;

  PERFORM public.log_event(
    v_att.company_id, v_caller_id, 'task', v_att.task_id,
    'task.attachment_version_restored',
    jsonb_build_object('attachment_id', v_version.attachment_id, 'version_id', p_version_id, 'version_no', v_version.version_no)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_restore_task_attachment_version"("p_version_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_resume_session"("p_session_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_session public.task_work_sessions%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

    SELECT * INTO v_session
    FROM public.task_work_sessions
    WHERE id = p_session_id AND user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    -- #160: same task lock as rpc_start_work.
    PERFORM 1 FROM public.tasks WHERE id = v_session.task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This task was archived or deleted. Refresh to see the current board.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_session.status <> 'completed'
       OR COALESCE(v_session.completed_at, v_session.last_heartbeat_at) < now() - interval '2 minutes' THEN
        RAISE EXCEPTION 'Session is not resumable' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = v_session.task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'User is not a participant' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.task_work_sessions
        WHERE user_id = auth.uid() AND status = 'active' AND id <> p_session_id
    ) THEN
        RAISE EXCEPTION 'User already has an active session' USING ERRCODE = '42501';
    END IF;

    UPDATE public.task_work_sessions
    SET status = 'active',
        completed_at = NULL,
        total_seconds_spent = 0,
        last_heartbeat_at = now()
    WHERE id = p_session_id;
END;
$$;


ALTER FUNCTION "public"."rpc_resume_session"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_retention_overview"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_company uuid := public.my_company_id();
  v_settings public.company_retention_settings%rowtype;
  v_last_active timestamptz;
  v_days_inactive int;
  v_result jsonb;
begin
  if v_company is null then raise exception 'No company context'; end if;
  if not public._can_manage_retention() then raise exception 'Not authorized'; end if;

  select * into v_settings from public.company_retention_settings where company_id = v_company;
  if not found then
    v_settings.company_id := v_company;
    v_settings.inactivity_days := 90;
    v_settings.warning_interval_days := 10;
    v_settings.user_inactivity_days := 90;
    v_settings.warnings_enabled := true;
  end if;

  select greatest(
           coalesce(max(u.last_seen_at), 'epoch'::timestamptz),
           (select created_at from public.companies where id = v_company)
         )
    into v_last_active
  from public.users u
  where u.company_id = v_company and u.deleted_at is null;

  v_days_inactive := floor(extract(epoch from (now() - v_last_active)) / 86400)::int;

  select jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company,
      'name', (select name from public.companies where id = v_company),
      'last_active_at', v_last_active,
      'days_inactive', v_days_inactive,
      'inactivity_days', v_settings.inactivity_days,
      'warning_interval_days', v_settings.warning_interval_days,
      'days_until_purge', greatest(v_settings.inactivity_days - v_days_inactive, 0),
      'status', case
                  when v_days_inactive >= v_settings.inactivity_days then 'overdue'
                  when v_days_inactive >= v_settings.inactivity_days - v_settings.warning_interval_days then 'warning'
                  else 'active' end,
      'last_warning_at', (select max(created_at) from public.retention_warnings where company_id = v_company)
    ),
    'settings', jsonb_build_object(
      'inactivity_days', v_settings.inactivity_days,
      'warning_interval_days', v_settings.warning_interval_days,
      'user_inactivity_days', v_settings.user_inactivity_days,
      'warnings_enabled', v_settings.warnings_enabled
    ),
    'inactive_users', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id,
               'full_name', u.full_name,
               'email', u.email,
               'is_owner', u.is_owner,
               'last_seen_at', u.last_seen_at,
               'days_inactive', floor(extract(epoch from (now() - coalesce(u.last_seen_at, u.created_at))) / 86400)::int
             ) order by coalesce(u.last_seen_at, u.created_at) asc)
      from public.users u
      where u.company_id = v_company
        and u.deleted_at is null
        and coalesce(u.last_seen_at, u.created_at) < now() - make_interval(days => v_settings.user_inactivity_days)
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."rpc_retention_overview"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reverse_stage"("p_task_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_current_stage UUID;
  v_prev_stage    UUID;
  v_company_id    UUID;
  v_user_id       UUID := auth.uid();
  v_history_id    UUID;
BEGIN
  SELECT current_stage_id, company_id INTO v_current_stage, v_company_id FROM public.tasks WHERE id = p_task_id;

  IF NOT ((SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE OR public.has_permission('pipeline.reverse')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.pipeline_stage_features WHERE stage_id = v_current_stage AND feature_type = 'ALLOW_REVERSAL') THEN
    RAISE EXCEPTION 'Reversal disabled for this stage';
  END IF;

  SELECT id, from_stage_id INTO v_history_id, v_prev_stage
  FROM public.pipeline_stage_history
  WHERE task_id = p_task_id AND to_stage_id = v_current_stage
    AND is_reversal = FALSE -- Don't reverse back into a reversal
  ORDER BY transitioned_at DESC LIMIT 1;

  IF v_prev_stage IS NULL THEN RAISE EXCEPTION 'No history found'; END IF;

  UPDATE public.tasks SET current_stage_id = v_prev_stage, updated_at = NOW() WHERE id = p_task_id;

  INSERT INTO public.pipeline_stage_history (
    task_id, company_id, pipeline_id, from_stage_id, to_stage_id, transitioned_by, from_stage_name, to_stage_name, is_reversal
  )
  SELECT 
    p_task_id, v_company_id, pipeline_id, v_current_stage, v_prev_stage, v_user_id,
    (SELECT name FROM public.pipeline_stages WHERE id = v_current_stage),
    (SELECT name FROM public.pipeline_stages WHERE id = v_prev_stage),
    TRUE
  FROM public.tasks WHERE id = p_task_id;

  UPDATE public.tasks SET status = 'cancelled' WHERE parent_task_id = p_task_id AND status != 'completed';
END;
$$;


ALTER FUNCTION "public"."rpc_reverse_stage"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_review_by_transition"("p_task_id" "uuid", "p_transition_id" "uuid", "p_notes" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_trans RECORD;
BEGIN
  SELECT * INTO v_trans FROM public.pipeline_stage_transitions WHERE id = p_transition_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transition not found'; END IF;

  PERFORM public.rpc_advance_stage(p_task_id, v_trans.to_stage_id);
  
  PERFORM public.log_event(
    (SELECT company_id FROM public.tasks WHERE id = p_task_id),
    auth.uid(),
    'task',
    p_task_id,
    'task.review_advanced',
    jsonb_build_object('transition_label', v_trans.label, 'notes', p_notes)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_review_by_transition"("p_task_id" "uuid", "p_transition_id" "uuid", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_review_manual_time"("p_entry_id" "uuid", "p_approve" boolean, "p_rejection_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id           UUID := auth.uid();
    v_is_owner          BOOLEAN := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
    v_entry             RECORD;
    v_session_id        UUID;
    v_session_start     TIMESTAMPTZ;
    v_session_end       TIMESTAMPTZ;
    v_target_stage_id   UUID;
BEGIN
    SELECT
        e.id, e.task_id, e.stage_id, e.user_id, e.company_id,
        e.declared_minutes, e.logged_at, e.worked_date, e.approval_status,
        e.pending_transition_id, e.session_id,
        t.created_by AS task_created_by,
        t.manager_id AS task_manager_id,
        t.title      AS task_title
    INTO v_entry
    FROM public.task_manual_time_entries e
    JOIN public.tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
    WHERE e.id = p_entry_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manual time entry not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_entry.company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    IF NOT (
        v_is_owner
        OR v_entry.task_manager_id = v_user_id
        OR v_entry.task_created_by = v_user_id
        OR public.has_permission('task.manage')
    ) THEN
        RAISE EXCEPTION 'Forbidden: only the task manager or company owners can review manual time.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_entry.id::text));

    IF p_approve THEN
        IF v_entry.approval_status = 'approved' THEN
            RETURN jsonb_build_object('success', true, 'approval_status', 'approved', 'session_created', false);
        END IF;

        IF v_entry.approval_status = 'rejected' THEN
            RAISE EXCEPTION 'This manual time entry has already been rejected.' USING ERRCODE = 'P0001';
        END IF;

        v_session_end   := (v_entry.worked_date + v_entry.logged_at::time)::timestamptz;
        v_session_start := v_session_end - make_interval(mins => v_entry.declared_minutes);

        IF v_entry.session_id IS NOT NULL THEN
            UPDATE public.task_work_sessions
            SET started_at           = v_session_start,
                last_heartbeat_at    = v_session_end,
                completed_at         = v_session_end,
                status               = 'completed',
                total_seconds_spent  = v_entry.declared_minutes * 60,
                stage_id             = v_entry.stage_id
            WHERE id = v_entry.session_id
            RETURNING id INTO v_session_id;
        END IF;

        IF v_session_id IS NULL THEN
            INSERT INTO public.task_work_sessions (
                user_id, task_id, company_id, stage_id,
                started_at, last_heartbeat_at, completed_at,
                status, total_seconds_spent
            )
            VALUES (
                v_entry.user_id, v_entry.task_id, v_entry.company_id, v_entry.stage_id,
                v_session_start, v_session_end, v_session_end,
                'completed', v_entry.declared_minutes * 60
            )
            RETURNING id INTO v_session_id;
        END IF;

        UPDATE public.task_manual_time_entries
        SET approval_status  = 'approved',
            rejection_reason = NULL,
            approved_at      = now(),
            approved_by      = v_user_id,
            session_id       = v_session_id
        WHERE id = p_entry_id;

        IF v_entry.pending_transition_id IS NOT NULL THEN
            SELECT to_stage_id INTO v_target_stage_id
            FROM public.pipeline_stage_transitions
            WHERE id = v_entry.pending_transition_id;

            IF v_target_stage_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(v_entry.task_id, v_target_stage_id);
            END IF;
        END IF;

        PERFORM public.fn_emit_notification_event(
            'task.manual_time_approved', 'task', v_entry.task_id, v_user_id,
            jsonb_build_object(
                'task_id',          v_entry.task_id,
                'stage_id',         v_entry.stage_id,
                'entry_id',         v_entry.id,
                'worker_id',        v_entry.user_id,
                'declared_minutes', v_entry.declared_minutes,
                'session_id',       v_session_id,
                'stage_advanced',   v_entry.pending_transition_id IS NOT NULL
            )
        );

        RETURN jsonb_build_object(
            'success',         true,
            'approval_status', 'approved',
            'session_created', true,
            'session_id',      v_session_id,
            'stage_advanced',  v_entry.pending_transition_id IS NOT NULL
        );
    END IF;

    -- Reject path
    IF v_entry.approval_status = 'rejected' THEN
        RETURN jsonb_build_object('success', true, 'approval_status', 'rejected', 'session_created', false);
    END IF;

    UPDATE public.task_manual_time_entries
    SET approval_status  = 'rejected',
        rejection_reason = p_rejection_reason,
        approved_at      = now(),
        approved_by      = v_user_id
    WHERE id = p_entry_id;

    PERFORM public.fn_emit_notification_event(
        'task.manual_time_rejected', 'task', v_entry.task_id, v_user_id,
        jsonb_build_object(
            'task_id',          v_entry.task_id,
            'stage_id',         v_entry.stage_id,
            'entry_id',         v_entry.id,
            'worker_id',        v_entry.user_id,
            'rejection_reason', p_rejection_reason
        )
    );

    RETURN jsonb_build_object('success', true, 'approval_status', 'rejected', 'session_created', false);
END;
$$;


ALTER FUNCTION "public"."rpc_review_manual_time"("p_entry_id" "uuid", "p_approve" boolean, "p_rejection_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_review_submission"("p_submission_id" "uuid", "p_decision" "text", "p_notes" "text" DEFAULT NULL::"text", "p_advance_stage_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id  UUID;
  v_user_id     UUID := auth.uid();
  v_task_id     UUID;
  v_old_status  TEXT;
  v_session_id  UUID;
BEGIN
  -- Permission check + fetch
  SELECT company_id, task_id, status
  INTO   v_company_id, v_task_id, v_old_status
  FROM   public.task_submissions
  WHERE  id = p_submission_id;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Submission not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('submission.review')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to review submissions';
  END IF;

  -- AUTO-STOP TIMER for reviewer
  UPDATE public.task_work_sessions
  SET completed_at = NOW(),
      status = 'completed',
      total_seconds_spent = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
  WHERE task_id = v_task_id AND user_id = v_user_id AND status = 'active';

  -- Update submission
  UPDATE public.task_submissions
  SET
    status         = p_decision,
    reviewed_by    = v_user_id,
    reviewed_at    = NOW(),
    review_notes   = p_notes,
    revision_count = CASE
      WHEN p_decision IN ('needs_revision', 'rejected')
      THEN revision_count + 1
      ELSE revision_count
    END,
    updated_at = NOW()
  WHERE id = p_submission_id;

  -- Advance if approved
  IF p_decision = 'approved' AND p_advance_stage_id IS NOT NULL THEN
    PERFORM public.rpc_advance_stage(v_task_id, p_advance_stage_id, p_submission_id);
  END IF;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'task', v_task_id, 'task.submission_reviewed',
    jsonb_build_object('submission_id', p_submission_id, 'decision', p_decision)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_review_submission"("p_submission_id" "uuid", "p_decision" "text", "p_notes" "text", "p_advance_stage_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_revoke_trial_code"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required.';
  END IF;
  UPDATE public.trial_codes SET expires_at = now() WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trial code not found.'; END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_revoke_trial_code"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_run_retention_warnings"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_co record;
  v_last_active timestamptz;
  v_days int;
  v_warn_threshold int;
  v_last_warn timestamptz;
  v_checked int := 0;
  v_warned int := 0;
  v_recipients int;
begin
  for v_co in
    select c.id, c.name, s.inactivity_days, s.warning_interval_days
    from public.companies c
    join public.company_retention_settings s on s.company_id = c.id
    where c.deleted_at is null and s.warnings_enabled = true
  loop
    v_checked := v_checked + 1;

    select greatest(coalesce(max(u.last_seen_at), 'epoch'::timestamptz),
                    (select created_at from public.companies where id = v_co.id))
      into v_last_active
    from public.users u where u.company_id = v_co.id and u.deleted_at is null;

    v_days := floor(extract(epoch from (now() - v_last_active)) / 86400)::int;
    v_warn_threshold := v_co.inactivity_days - v_co.warning_interval_days;

    if v_days < v_warn_threshold then continue; end if;

    select max(created_at) into v_last_warn from public.retention_warnings where company_id = v_co.id;
    if v_last_warn is not null and v_last_warn >= now() - make_interval(days => v_co.warning_interval_days) then
      continue;
    end if;

    insert into public.notifications (user_id, type, title, body, data)
    select u.id,
           'retention_warning',
           'Workspace inactivity warning',
           'Your workspace "' || v_co.name || '" has been inactive for ' || v_days ||
             ' days and is scheduled for removal in ' || greatest(v_co.inactivity_days - v_days, 0) ||
             ' days. Sign in to keep it active.',
           jsonb_build_object('company_id', v_co.id, 'days_inactive', v_days,
                              'days_until_purge', greatest(v_co.inactivity_days - v_days, 0))
    from public.users u
    where u.company_id = v_co.id and u.deleted_at is null and coalesce(u.is_active, true) = true;

    get diagnostics v_recipients = row_count;

    insert into public.retention_warnings (company_id, scope, days_inactive, days_until_purge, recipients_count)
    values (v_co.id, 'company', v_days, greatest(v_co.inactivity_days - v_days, 0), v_recipients);

    v_warned := v_warned + 1;
  end loop;

  return jsonb_build_object('checked', v_checked, 'warned', v_warned);
end;
$$;


ALTER FUNCTION "public"."rpc_run_retention_warnings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_search_users"("p_query" "text" DEFAULT ''::"text") RETURNS TABLE("id" "uuid", "full_name" "text", "email" "text", "role" "text", "avatar_url" "text", "contribution_points" bigint, "velocity_hours" double precision, "flap_rate" double precision, "tier" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID;
BEGIN
    v_company_id := public.my_company_id();

    IF NOT (
        public.has_permission('user.scan') 
        OR public.has_permission('admin.access')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Personnel intelligence access denied.';
    END IF;

    RETURN QUERY
    SELECT 
        u.id,
        u.full_name,
        u.email,
        COALESCE((
            SELECT string_agg(r.name, ', ')
            FROM public.user_roles ur
            JOIN public.roles r ON ur.role_id = r.id
            WHERE ur.user_id = u.id AND ur.revoked_at IS NULL
        ), 'Member') as role,
        u.avatar_url,
        COALESCE(p.contribution_points, 0)::BIGINT as contribution_points,
        COALESCE(p.avg_active_seconds / 3600.0, 0.0)::DOUBLE PRECISION as velocity_hours,
        COALESCE(p.flap_rate, 1.0)::DOUBLE PRECISION as flap_rate,
        CASE 
            WHEN p.contribution_points > 1000 THEN 'Legendary'
            WHEN p.contribution_points > 500 THEN 'Elite'
            WHEN p.contribution_points > 100 THEN 'Pro'
            ELSE 'Rookie'
        END as tier
    FROM public.users u
    LEFT JOIN public.view_user_performance p ON u.id = p.id
    WHERE u.company_id = v_company_id
      AND (
        p_query = '' 
        OR u.full_name ILIKE ('%' || p_query || '%')
        OR u.email ILIKE ('%' || p_query || '%')
      )
    GROUP BY u.id, u.full_name, u.email, u.avatar_url, p.contribution_points, p.avg_active_seconds, p.flap_rate
    ORDER BY u.full_name ASC;
END;
$$;


ALTER FUNCTION "public"."rpc_search_users"("p_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_set_assignment_pool"("p_pipeline_id" "uuid", "p_member_type" "text", "p_member_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
BEGIN
  IF p_member_type NOT IN ('user', 'team') THEN
    RAISE EXCEPTION 'p_member_type must be ''user'' or ''team''';
  END IF;

  SELECT company_id INTO v_company_id
  FROM public.pipelines
  WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF p_member_type = 'user' THEN
    INSERT INTO public.pipeline_assignment_pool (pipeline_id, company_id, member_user_id)
    SELECT p_pipeline_id, v_company_id, uid
    FROM unnest(p_member_ids) AS uid
    ON CONFLICT (pipeline_id, member_user_id) WHERE member_user_id IS NOT NULL DO NOTHING;

    DELETE FROM public.pipeline_assignment_pool
    WHERE pipeline_id = p_pipeline_id
      AND member_user_id IS NOT NULL
      AND NOT (member_user_id = ANY(p_member_ids));
  ELSE
    INSERT INTO public.pipeline_assignment_pool (pipeline_id, company_id, member_team_id)
    SELECT p_pipeline_id, v_company_id, tid
    FROM unnest(p_member_ids) AS tid
    ON CONFLICT (pipeline_id, member_team_id) WHERE member_team_id IS NOT NULL DO NOTHING;

    DELETE FROM public.pipeline_assignment_pool
    WHERE pipeline_id = p_pipeline_id
      AND member_team_id IS NOT NULL
      AND NOT (member_team_id = ANY(p_member_ids));
  END IF;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'pipeline', p_pipeline_id, 'pipeline.assignment_pool_updated',
    jsonb_build_object('member_type', p_member_type, 'count', COALESCE(array_length(p_member_ids, 1), 0))
  );
END;
$$;


ALTER FUNCTION "public"."rpc_set_assignment_pool"("p_pipeline_id" "uuid", "p_member_type" "text", "p_member_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_set_pool_member_withdrawn"("p_pipeline_id" "uuid", "p_member_type" "text", "p_member_id" "uuid", "p_is_withdrawn" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_rows       INT;
BEGIN
  IF p_member_type NOT IN ('user', 'team') THEN
    RAISE EXCEPTION 'p_member_type must be ''user'' or ''team''';
  END IF;

  SELECT company_id INTO v_company_id
  FROM public.pipelines
  WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF p_member_type = 'user' THEN
    UPDATE public.pipeline_assignment_pool
    SET is_withdrawn = p_is_withdrawn
    WHERE pipeline_id = p_pipeline_id AND member_user_id = p_member_id;
  ELSE
    UPDATE public.pipeline_assignment_pool
    SET is_withdrawn = p_is_withdrawn
    WHERE pipeline_id = p_pipeline_id AND member_team_id = p_member_id;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Pool member not found';
  END IF;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'pipeline', p_pipeline_id,
    CASE WHEN p_is_withdrawn THEN 'pipeline.assignment_pool_member_withdrawn'
         ELSE 'pipeline.assignment_pool_member_reinstated' END,
    jsonb_build_object('member_type', p_member_type, 'member_id', p_member_id)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_set_pool_member_withdrawn"("p_pipeline_id" "uuid", "p_member_type" "text", "p_member_id" "uuid", "p_is_withdrawn" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_simulate_notification_rule"("p_rule_id" "uuid", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_rule          public.notification_rules%ROWTYPE;
  v_strategy      TEXT;
  v_strategy_log  JSONB := '[]'::JSONB;
  v_strategy_ids  UUID[];
  v_all_ids       UUID[] := ARRAY[]::UUID[];
  v_recipients    JSONB;
  v_conditions_ok BOOLEAN := TRUE;
  v_cond_key      TEXT;
  v_task_id       UUID;
  v_pipeline_id   UUID;
  v_field         TEXT;
  v_role_name     TEXT;
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rule FROM public.notification_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rule not found' USING ERRCODE = 'P0002';
  END IF;

  p_payload := COALESCE(p_payload, '{}'::JSONB);

  FOR v_cond_key IN SELECT jsonb_object_keys(v_rule.conditions) LOOP
    IF v_rule.conditions -> v_cond_key IS DISTINCT FROM p_payload -> v_cond_key THEN
      v_conditions_ok := FALSE;
      EXIT;
    END IF;
  END LOOP;

  v_task_id := NULLIF(p_payload ->> 'task_id', '')::UUID;
  v_pipeline_id := NULLIF(p_payload ->> 'pipeline_id', '')::UUID;

  IF v_conditions_ok THEN
    FOREACH v_strategy IN ARRAY v_rule.recipient_strategies LOOP
      v_strategy_ids := ARRAY[]::UUID[];

      IF v_strategy = 'assignee' THEN
        IF v_task_id IS NOT NULL THEN
          SELECT COALESCE(array_agg(DISTINCT assignee_user_id), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   public.task_assignments
          WHERE  task_id = v_task_id
            AND  assignee_user_id IS NOT NULL;
        END IF;

      ELSIF v_strategy = 'task_owner' THEN
        IF v_task_id IS NOT NULL THEN
          SELECT COALESCE(array_agg(created_by), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   public.tasks
          WHERE  id = v_task_id
            AND  created_by IS NOT NULL;
        END IF;

      ELSIF v_strategy = 'watchers' THEN
        IF v_task_id IS NOT NULL THEN
          SELECT COALESCE(array_agg(DISTINCT user_id), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   public.entity_watchers
          WHERE  entity_type = 'task'
            AND  entity_id   = v_task_id;
        END IF;

      ELSIF v_strategy = 'pipeline_members' THEN
        IF v_pipeline_id IS NOT NULL THEN
          WITH pipeline_tasks AS (
            SELECT id FROM public.tasks
            WHERE pipeline_id = v_pipeline_id AND deleted_at IS NULL
          ),
          ids AS (
            SELECT assignee_user_id AS uid
            FROM   public.task_assignments
            WHERE  task_id IN (SELECT id FROM pipeline_tasks)
              AND  assignee_user_id IS NOT NULL
            UNION
            SELECT user_id
            FROM   public.task_participants
            WHERE  task_id IN (SELECT id FROM pipeline_tasks)
          )
          SELECT COALESCE(array_agg(DISTINCT uid), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   ids;
        END IF;

      ELSIF v_strategy = 'role' THEN
        v_role_name := v_rule.recipient_config ->> 'role';
        IF v_role_name IS NOT NULL AND v_role_name <> '' THEN
          SELECT COALESCE(array_agg(DISTINCT ur.user_id), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   public.user_roles ur
          JOIN   public.roles r ON r.id = ur.role_id
          WHERE  r.name = v_role_name
            AND  ur.revoked_at IS NULL;
        END IF;

      ELSIF v_strategy = 'specific_users' THEN
        IF jsonb_typeof(v_rule.recipient_config -> 'user_ids') = 'array'
           AND jsonb_array_length(v_rule.recipient_config -> 'user_ids') > 0 THEN
          SELECT COALESCE(array_agg((value #>> '{}')::UUID), ARRAY[]::UUID[])
          INTO   v_strategy_ids
          FROM   jsonb_array_elements(v_rule.recipient_config -> 'user_ids');
        ELSIF p_payload ? 'mentioned_user_id' THEN
          v_strategy_ids := ARRAY[NULLIF(p_payload ->> 'mentioned_user_id', '')::UUID];
        END IF;

      ELSIF v_strategy = 'payload_user' THEN
        v_field := v_rule.recipient_config ->> 'payload_field';
        IF v_field IS NOT NULL AND p_payload ? v_field THEN
          v_strategy_ids := ARRAY[NULLIF(p_payload ->> v_field, '')::UUID];
        END IF;
      END IF;

      v_strategy_ids := COALESCE(
        ARRAY(SELECT x FROM unnest(v_strategy_ids) AS x WHERE x IS NOT NULL),
        ARRAY[]::UUID[]
      );

      v_strategy_log := v_strategy_log || jsonb_build_object(
        'strategy',       v_strategy,
        'resolved_count', cardinality(v_strategy_ids),
        'user_ids',       COALESCE(to_jsonb(v_strategy_ids), '[]'::JSONB)
      );

      v_all_ids := v_all_ids || v_strategy_ids;
    END LOOP;
  END IF;

  v_all_ids := COALESCE(
    ARRAY(SELECT DISTINCT x FROM unnest(v_all_ids) AS x),
    ARRAY[]::UUID[]
  );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id',      u.id,
      'display_name', COALESCE(u.display_name, u.full_name, u.email, 'Unknown'),
      'email',        u.email
    ) ORDER BY COALESCE(u.display_name, u.full_name, u.email)
  ), '[]'::JSONB)
  INTO v_recipients
  FROM public.users u
  WHERE u.id = ANY(v_all_ids);

  RETURN jsonb_build_object(
    'rule_id',          v_rule.id,
    'event_type',       v_rule.event_type,
    'conditions_match', v_conditions_ok,
    'strategy_log',     v_strategy_log,
    'recipients',       v_recipients,
    'recipient_count',  cardinality(v_all_ids)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_simulate_notification_rule"("p_rule_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_start_work"("p_task_id" "uuid", "p_start_time" timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_session_id        UUID;
    v_company_id        UUID;
    v_stage_id          UUID;
    v_final_start_time  TIMESTAMPTZ := p_start_time;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = p_task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'User is not a participant' USING ERRCODE = '42501';
    END IF;

    -- #160: serialise against an in-flight archive of this task.
    SELECT company_id, current_stage_id
    INTO v_company_id, v_stage_id
    FROM public.tasks WHERE id = p_task_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'This task was archived or deleted. Refresh to see the current board.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_final_start_time > now() + interval '1 minute'
       OR v_final_start_time < now() - interval '5 minutes' THEN
        v_final_start_time := now();
    END IF;

    UPDATE public.task_work_sessions
    SET status = 'completed',
        completed_at = last_heartbeat_at,
        total_seconds_spent = GREATEST(1, EXTRACT(EPOCH FROM (last_heartbeat_at - started_at))::int)
    WHERE user_id = auth.uid() AND status = 'active';

    INSERT INTO public.task_work_sessions (
        task_id, user_id, company_id, stage_id, started_at, status
    )
    VALUES (
        p_task_id, auth.uid(), v_company_id, v_stage_id, v_final_start_time, 'active'
    )
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$;


ALTER FUNCTION "public"."rpc_start_work"("p_task_id" "uuid", "p_start_time" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_stop_work"("p_session_id" "uuid" DEFAULT NULL::"uuid", "p_task_id" "uuid" DEFAULT NULL::"uuid", "p_stopped_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_session         RECORD;
    v_final_stop_time TIMESTAMPTZ;
    v_duration_sec    INTEGER;
    v_company_id      UUID;
    v_stage_id        UUID;
    v_user_id         UUID := auth.uid();
    v_use_bus         BOOLEAN;
BEGIN
    v_final_stop_time := COALESCE(p_stopped_at, now());

    IF p_session_id IS NOT NULL THEN
        SELECT * INTO v_session FROM public.task_work_sessions
        WHERE id = p_session_id AND user_id = v_user_id AND status = 'active'
        LIMIT 1;
    ELSE
        SELECT * INTO v_session FROM public.task_work_sessions
        WHERE task_id = p_task_id AND user_id = v_user_id AND status = 'active'
        ORDER BY started_at DESC LIMIT 1;
    END IF;

    SELECT company_id, current_stage_id
    INTO v_company_id, v_stage_id
    FROM public.tasks WHERE id = COALESCE(p_task_id, v_session.task_id);

    IF v_session.id IS NULL THEN
        INSERT INTO public.task_work_sessions (
            task_id, user_id, company_id, stage_id,
            started_at, last_heartbeat_at, completed_at,
            status, total_seconds_spent
        )
        VALUES (
            p_task_id, v_user_id, v_company_id, v_stage_id,
            v_final_stop_time - interval '1 second', v_final_stop_time, v_final_stop_time,
            'completed', 1
        )
        RETURNING id INTO p_session_id;

        RETURN jsonb_build_object('status', 'recovered', 'session_id', p_session_id, 'duration', 1);
    END IF;

    SELECT s.use_business_hours INTO v_use_bus
    FROM public.tasks t
    JOIN public.pipeline_stages s ON t.current_stage_id = s.id
    WHERE t.id = v_session.task_id;

    IF COALESCE(v_use_bus, FALSE) = TRUE THEN
        v_duration_sec := COALESCE(EXTRACT(EPOCH FROM public.fn_calculate_business_duration(v_session.started_at, v_final_stop_time))::INTEGER, 0);
    ELSE
        v_duration_sec := COALESCE(EXTRACT(EPOCH FROM (v_final_stop_time - v_session.started_at))::INTEGER, 0);
    END IF;

    v_duration_sec := GREATEST(v_duration_sec, 1);

    UPDATE public.task_work_sessions
    SET completed_at        = v_final_stop_time,
        last_heartbeat_at   = v_final_stop_time,
        status              = 'completed',
        total_seconds_spent = v_duration_sec
    WHERE id = v_session.id;

    RETURN jsonb_build_object(
        'status',     'success',
        'session_id', v_session.id,
        'duration',   v_duration_sec,
        'stopped_at', v_final_stop_time
    );
END;
$$;


ALTER FUNCTION "public"."rpc_stop_work"("p_session_id" "uuid", "p_task_id" "uuid", "p_stopped_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_submission_versions"("p_submission_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_submission  RECORD;
  v_task        RECORD;
  v_is_owner    BOOLEAN;
  v_is_assigned BOOLEAN;
  v_result      JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.task_id, s.company_id
  INTO   v_submission
  FROM   public.task_submissions s
  WHERE  s.id = p_submission_id;

  IF NOT FOUND OR v_submission.company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'submission not found' USING ERRCODE = 'P0002';
  END IF;

  -- Perm: can view the parent task (same predicate as rpc_get_task_details)
  SELECT created_by, manager_id INTO v_task
  FROM   public.tasks
  WHERE  id = v_submission.task_id;

  v_is_owner := COALESCE((SELECT is_owner FROM public.users WHERE id = v_caller_id), FALSE);
  v_is_assigned := EXISTS (
    SELECT 1 FROM public.task_assignments ta
    WHERE ta.task_id = v_submission.task_id
      AND (
        ta.assignee_user_id = v_caller_id
        OR ta.assignee_team_id IN (
            SELECT team_id FROM public.team_members WHERE user_id = v_caller_id AND removed_at IS NULL
        )
      )
  );

  IF NOT (
    v_is_owner OR v_task.created_by = v_caller_id OR v_task.manager_id = v_caller_id
    OR v_is_assigned OR public.has_permission('task.view_detail')
  ) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', v.id,
      'version_no', v.version_no,
      'content', v.content,
      'created_at', v.created_at,
      'created_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = v.created_by),
      'is_current', v.superseded_at IS NULL,
      'expires_at', CASE WHEN v.superseded_at IS NOT NULL THEN v.superseded_at + interval '30 days' ELSE NULL END,
      'attachments', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'file_url', a.file_url,
          'mime_type', a.mime_type, 'category', a.category, 'file_size', a.file_size, 'storage_path', a.storage_path))
         FROM public.submission_attachments a WHERE a.version_id = v.id),
        '[]'::jsonb
      )
    ) ORDER BY v.version_no DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM public.task_submission_versions v
  WHERE v.submission_id = p_submission_id;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."rpc_submission_versions"("p_submission_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_submit_work"("p_task_id" "uuid", "p_content" "text" DEFAULT NULL::"text", "p_assignment_id" "uuid" DEFAULT NULL::"uuid", "p_transition_id" "uuid" DEFAULT NULL::"uuid", "p_attachments" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."rpc_submit_work"("p_task_id" "uuid", "p_content" "text", "p_assignment_id" "uuid", "p_transition_id" "uuid", "p_attachments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_task_attachment_versions"("p_attachment_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_att         RECORD;
  v_task        RECORD;
  v_is_owner    BOOLEAN;
  v_is_assigned BOOLEAN;
  v_result      JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, task_id, company_id
  INTO   v_att
  FROM   public.task_attachments
  WHERE  id = p_attachment_id;

  IF NOT FOUND OR v_att.company_id <> public.my_company_id() THEN
    RAISE EXCEPTION 'attachment not found' USING ERRCODE = 'P0002';
  END IF;

  -- Perm: can view the parent task (same predicate as rpc_get_task_details)
  SELECT created_by, manager_id INTO v_task
  FROM   public.tasks
  WHERE  id = v_att.task_id;

  v_is_owner := COALESCE((SELECT is_owner FROM public.users WHERE id = v_caller_id), FALSE);
  v_is_assigned := EXISTS (
    SELECT 1 FROM public.task_assignments ta
    WHERE ta.task_id = v_att.task_id
      AND (
        ta.assignee_user_id = v_caller_id
        OR ta.assignee_team_id IN (
            SELECT team_id FROM public.team_members WHERE user_id = v_caller_id AND removed_at IS NULL
        )
      )
  );

  IF NOT (
    v_is_owner OR v_task.created_by = v_caller_id OR v_task.manager_id = v_caller_id
    OR v_is_assigned OR public.has_permission('task.view_detail')
  ) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', v.id,
      'version_no', v.version_no,
      'file_name', v.file_name,
      'file_size', v.file_size,
      'mime_type', v.mime_type,
      'storage_path', v.storage_path,
      'bucket', v.bucket,
      'created_at', v.created_at,
      'created_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = v.created_by),
      'is_current', v.superseded_at IS NULL,
      'expires_at', CASE WHEN v.superseded_at IS NOT NULL THEN v.superseded_at + interval '30 days' ELSE NULL END
    ) ORDER BY v.version_no DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM public.task_attachment_versions v
  WHERE v.attachment_id = p_attachment_id;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."rpc_task_attachment_versions"("p_attachment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_toggle_notification_rule"("p_rule_id" "uuid", "p_is_active" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.notification_rules
  SET is_active = p_is_active, updated_at = now()
  WHERE id = p_rule_id;
END;
$$;


ALTER FUNCTION "public"."rpc_toggle_notification_rule"("p_rule_id" "uuid", "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_toggle_stage_feature"("p_stage_id" "uuid", "p_feature" "text", "p_is_enabled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Permission check
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF p_is_enabled THEN
    INSERT INTO public.pipeline_stage_features (stage_id, feature_type)
    VALUES (p_stage_id, p_feature)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.pipeline_stage_features 
    WHERE stage_id = p_stage_id AND feature_type = p_feature;
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_toggle_stage_feature"("p_stage_id" "uuid", "p_feature" "text", "p_is_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_toggle_watcher"("p_entity_type" "text", "p_entity_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.entity_watchers
    WHERE user_id    = auth.uid()
      AND entity_type = p_entity_type
      AND entity_id   = p_entity_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.entity_watchers
    WHERE user_id    = auth.uid()
      AND entity_type = p_entity_type
      AND entity_id   = p_entity_id;
    RETURN jsonb_build_object('watching', false);
  ELSE
    INSERT INTO public.entity_watchers (user_id, entity_type, entity_id)
    VALUES (auth.uid(), p_entity_type, p_entity_id);
    RETURN jsonb_build_object('watching', true);
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_toggle_watcher"("p_entity_type" "text", "p_entity_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_touch_last_seen"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.users set last_seen_at = now() where id = auth.uid();
$$;


ALTER FUNCTION "public"."rpc_touch_last_seen"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_automation"("p_automation_id" "uuid", "p_condition_type" "text" DEFAULT NULL::"text", "p_check_interval_minutes" integer DEFAULT NULL::integer, "p_priority" integer DEFAULT NULL::integer, "p_is_active" boolean DEFAULT NULL::boolean, "p_params" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_key        TEXT;
  v_value      TEXT;
BEGIN
  SELECT p.company_id INTO v_company_id
  FROM public.pipeline_automations a
  JOIN public.pipelines p ON p.id = a.pipeline_id
  WHERE a.id = p_automation_id;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Automation not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  UPDATE public.pipeline_automations
  SET
    condition_type         = COALESCE(p_condition_type, condition_type),
    check_interval_minutes = COALESCE(p_check_interval_minutes, check_interval_minutes),
    priority               = COALESCE(p_priority, priority),
    is_active              = COALESCE(p_is_active, is_active),
    failure_count          = CASE WHEN p_is_active = TRUE THEN 0 ELSE failure_count END,
    updated_at             = NOW()
  WHERE id = p_automation_id;

  -- Replace params if provided
  IF p_params IS NOT NULL THEN
    DELETE FROM public.pipeline_automation_params WHERE automation_id = p_automation_id;
    FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_params)
    LOOP
      INSERT INTO public.pipeline_automation_params (automation_id, key, value)
      VALUES (p_automation_id, v_key, v_value);
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_update_automation"("p_automation_id" "uuid", "p_condition_type" "text", "p_check_interval_minutes" integer, "p_priority" integer, "p_is_active" boolean, "p_params" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_update_automation"("p_automation_id" "uuid", "p_condition_type" "text", "p_check_interval_minutes" integer, "p_priority" integer, "p_is_active" boolean, "p_params" "jsonb") IS 'Updates automation rule and optionally replaces params.';



CREATE OR REPLACE FUNCTION "public"."rpc_update_company"("p_name" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_logo_url" "text" DEFAULT NULL::"text", "p_website" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Permission check
  IF NOT public.has_permission('company.edit') THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  -- Get caller's company
  SELECT company_id INTO v_company_id FROM public.users WHERE id = auth.uid();
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No company found');
  END IF;

  -- Update company fields
  UPDATE public.companies SET
    name        = COALESCE(p_name,        name),
    description = COALESCE(p_description, description),
    logo_url    = COALESCE(p_logo_url,    logo_url),
    website     = COALESCE(p_website,     website),
    updated_at  = NOW()
  WHERE id = v_company_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."rpc_update_company"("p_name" "text", "p_description" "text", "p_logo_url" "text", "p_website" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_notification_rule"("p_rule_id" "uuid", "p_name" "text", "p_description" "text", "p_event_type" "text", "p_conditions" "jsonb", "p_recipient_strategies" "text"[], "p_recipient_config" "jsonb", "p_channels_override" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.fn_has_permission('manage_notifications') THEN
    RAISE EXCEPTION 'permission denied: manage_notifications required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.notification_rules
  SET
    name                 = p_name,
    description          = p_description,
    event_type           = p_event_type,
    conditions           = COALESCE(p_conditions, '{}'),
    recipient_strategies = p_recipient_strategies,
    recipient_config     = COALESCE(p_recipient_config, '{}'),
    channels_override    = p_channels_override,
    updated_at           = now()
  WHERE id = p_rule_id;
END;
$$;


ALTER FUNCTION "public"."rpc_update_notification_rule"("p_rule_id" "uuid", "p_name" "text", "p_description" "text", "p_event_type" "text", "p_conditions" "jsonb", "p_recipient_strategies" "text"[], "p_recipient_config" "jsonb", "p_channels_override" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_pipeline"("p_pipeline_id" "uuid", "p_name" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_is_default" boolean DEFAULT NULL::boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
BEGIN
  -- Fetch & validate
  SELECT company_id INTO v_company_id
  FROM public.pipelines
  WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- If setting as default, unset other defaults first
  IF p_is_default = TRUE THEN
    UPDATE public.pipelines
    SET is_default = FALSE
    WHERE company_id = v_company_id AND is_default = TRUE AND id != p_pipeline_id;
  END IF;

  -- Update
  UPDATE public.pipelines
  SET
    name        = COALESCE(p_name, name),
    description = COALESCE(p_description, description),
    is_default  = COALESCE(p_is_default, is_default),
    updated_at  = NOW()
  WHERE id = p_pipeline_id;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'pipeline', p_pipeline_id, 'pipeline.updated',
    jsonb_build_object('name', p_name)
  );
END;
$$;


ALTER FUNCTION "public"."rpc_update_pipeline"("p_pipeline_id" "uuid", "p_name" "text", "p_description" "text", "p_is_default" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rpc_update_pipeline"("p_pipeline_id" "uuid", "p_name" "text", "p_description" "text", "p_is_default" boolean) IS 'Updates pipeline metadata (name, description, is_default).';



CREATE OR REPLACE FUNCTION "public"."rpc_update_pipeline"("p_pipeline_id" "uuid", "p_name" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_is_default" boolean DEFAULT NULL::boolean, "p_visibility_permissions" "text"[] DEFAULT NULL::"text"[], "p_task_visibility_mode" "text" DEFAULT NULL::"text", "p_require_time_approval" boolean DEFAULT NULL::boolean, "p_assignment_mode" "text" DEFAULT NULL::"text", "p_assignment_pool_type" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id UUID;
    v_user_id    UUID := auth.uid();
BEGIN
    SELECT company_id INTO v_company_id
    FROM public.pipelines
    WHERE id = p_pipeline_id AND deleted_at IS NULL;

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Pipeline not found';
    END IF;

    IF v_company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
        OR public.has_permission('pipeline.edit')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to update pipelines';
    END IF;

    IF p_assignment_mode IS NOT NULL AND p_assignment_mode NOT IN ('manual', 'round_robin', 'smart') THEN
        RAISE EXCEPTION 'Invalid assignment_mode';
    END IF;

    IF p_assignment_pool_type IS NOT NULL AND p_assignment_pool_type NOT IN ('users', 'teams') THEN
        RAISE EXCEPTION 'Invalid assignment_pool_type';
    END IF;

    UPDATE public.pipelines
    SET
        name                   = COALESCE(p_name, name),
        description            = COALESCE(p_description, description),
        is_default             = COALESCE(p_is_default, is_default),
        visibility_permissions = COALESCE(p_visibility_permissions, visibility_permissions),
        task_visibility_mode   = COALESCE(p_task_visibility_mode, task_visibility_mode),
        require_time_approval  = COALESCE(p_require_time_approval, require_time_approval),
        assignment_mode        = COALESCE(p_assignment_mode, assignment_mode),
        assignment_pool_type   = COALESCE(p_assignment_pool_type, assignment_pool_type),
        updated_at             = NOW()
    WHERE id = p_pipeline_id;

    PERFORM public.log_event(
        v_company_id, v_user_id, 'pipeline', p_pipeline_id, 'pipeline.updated',
        jsonb_build_object(
            'name', p_name,
            'is_default', p_is_default,
            'require_time_approval', p_require_time_approval,
            'assignment_mode', p_assignment_mode,
            'assignment_pool_type', p_assignment_pool_type
        )
    );
END;
$$;


ALTER FUNCTION "public"."rpc_update_pipeline"("p_pipeline_id" "uuid", "p_name" "text", "p_description" "text", "p_is_default" boolean, "p_visibility_permissions" "text"[], "p_task_visibility_mode" "text", "p_require_time_approval" boolean, "p_assignment_mode" "text", "p_assignment_pool_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_retention_settings"("p_inactivity_days" integer, "p_warning_interval_days" integer, "p_user_inactivity_days" integer, "p_warnings_enabled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null then raise exception 'No company context'; end if;
  if not public._can_manage_retention() then raise exception 'Not authorized'; end if;

  insert into public.company_retention_settings as s
    (company_id, inactivity_days, warning_interval_days, user_inactivity_days, warnings_enabled, updated_by, updated_at)
  values
    (v_company, p_inactivity_days, p_warning_interval_days, p_user_inactivity_days, p_warnings_enabled, auth.uid(), now())
  on conflict (company_id) do update set
    inactivity_days       = excluded.inactivity_days,
    warning_interval_days = excluded.warning_interval_days,
    user_inactivity_days  = excluded.user_inactivity_days,
    warnings_enabled      = excluded.warnings_enabled,
    updated_by            = excluded.updated_by,
    updated_at            = now();
end;
$$;


ALTER FUNCTION "public"."rpc_update_retention_settings"("p_inactivity_days" integer, "p_warning_interval_days" integer, "p_user_inactivity_days" integer, "p_warnings_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_role"("p_role_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_permissions" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role_company_id UUID;
  v_caller_company_id UUID;
  v_perm_id UUID;
BEGIN
  IF NOT public.has_permission('role.manage') THEN
    RAISE EXCEPTION 'Access Denied: Insufficient role management capabilities.';
  END IF;

  SELECT company_id INTO v_role_company_id
  FROM public.roles
  WHERE id = p_role_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target authority record not found.';
  END IF;

  v_caller_company_id := public.my_company_id();

  IF v_role_company_id IS NULL THEN
    IF NOT public.has_permission('role.manage_global') THEN
      RAISE EXCEPTION 'System Protection: Elevated authorization required to modify platform-wide protocols.';
    END IF;
  ELSIF v_role_company_id != v_caller_company_id THEN
    RAISE EXCEPTION 'Scope Violation: Target role belongs to an external operational node.';
  END IF;

  UPDATE public.roles
  SET name = p_name,
      description = p_description,
      color = p_color,
      updated_at = NOW()
  WHERE id = p_role_id;

  DELETE FROM public.role_permissions WHERE role_id = p_role_id;
  
  IF p_permissions IS NOT NULL AND array_length(p_permissions, 1) > 0 THEN
    FOREACH v_perm_id IN ARRAY p_permissions
    LOOP
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (p_role_id, v_perm_id);
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_update_role"("p_role_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_permissions" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_stage"("p_stage_id" "uuid", "p_name" "text" DEFAULT NULL::"text", "p_color" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_is_initial" boolean DEFAULT NULL::boolean, "p_is_terminal" boolean DEFAULT NULL::boolean, "p_terminal_type" "text" DEFAULT NULL::"text", "p_requires_submission" boolean DEFAULT NULL::boolean, "p_requires_timer" boolean DEFAULT NULL::boolean, "p_use_business_hours" boolean DEFAULT NULL::boolean, "p_linked_pipeline_id" "uuid" DEFAULT NULL::"uuid", "p_ui_metadata" "jsonb" DEFAULT NULL::"jsonb", "p_min_timer_seconds" integer DEFAULT NULL::integer, "p_reassign_on_entry" boolean DEFAULT NULL::boolean, "p_submission_mode" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_company_id  UUID;
    v_pipeline_id UUID;
    v_user_id     UUID := auth.uid();
BEGIN
    SELECT p.company_id, ps.pipeline_id
    INTO v_company_id, v_pipeline_id
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = p_stage_id;

    IF v_company_id IS NULL THEN RAISE EXCEPTION 'Stage not found'; END IF;
    IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
        OR public.has_permission('pipeline.edit')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    IF p_min_timer_seconds IS NOT NULL AND p_min_timer_seconds < 0 THEN
        RAISE EXCEPTION 'min_timer_seconds must be >= 0';
    END IF;

    IF p_is_initial = TRUE THEN
        UPDATE public.pipeline_stages SET is_initial = FALSE
        WHERE pipeline_id = v_pipeline_id AND is_initial = TRUE AND id != p_stage_id;
    END IF;

    UPDATE public.pipeline_stages
    SET
        name                = COALESCE(p_name, name),
        color               = COALESCE(p_color, color),
        description         = COALESCE(p_description, description),
        is_initial          = COALESCE(p_is_initial, is_initial),
        is_terminal         = COALESCE(p_is_terminal, is_terminal),
        terminal_type       = COALESCE(p_terminal_type, terminal_type),
        requires_submission = COALESCE(p_requires_submission, requires_submission),
        submission_mode     = COALESCE(p_submission_mode, submission_mode),
        requires_timer      = COALESCE(p_requires_timer, requires_timer),
        use_business_hours  = COALESCE(p_use_business_hours, use_business_hours),
        linked_pipeline_id  = COALESCE(p_linked_pipeline_id, linked_pipeline_id),
        ui_metadata         = COALESCE(p_ui_metadata, ui_metadata),
        min_timer_seconds   = COALESCE(p_min_timer_seconds, min_timer_seconds),
        reassign_on_entry   = COALESCE(p_reassign_on_entry, reassign_on_entry),
        updated_at          = NOW()
    WHERE id = p_stage_id;
END;
$$;


ALTER FUNCTION "public"."rpc_update_stage"("p_stage_id" "uuid", "p_name" "text", "p_color" "text", "p_description" "text", "p_is_initial" boolean, "p_is_terminal" boolean, "p_terminal_type" "text", "p_requires_submission" boolean, "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_linked_pipeline_id" "uuid", "p_ui_metadata" "jsonb", "p_min_timer_seconds" integer, "p_reassign_on_entry" boolean, "p_submission_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_stage_action"("p_action_id" "uuid", "p_label" "text" DEFAULT NULL::"text", "p_icon" "text" DEFAULT NULL::"text", "p_style" "text" DEFAULT NULL::"text", "p_required_role" "text" DEFAULT NULL::"text", "p_precondition" "text" DEFAULT NULL::"text", "p_transition_id" "uuid" DEFAULT NULL::"uuid", "p_requires_timer" boolean DEFAULT NULL::boolean, "p_use_business_hours" boolean DEFAULT NULL::boolean, "p_is_active" boolean DEFAULT NULL::boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.pipeline_stage_actions
  SET
    label = COALESCE(p_label, label),
    icon = COALESCE(p_icon, icon),
    style = COALESCE(p_style, style),
    required_role = COALESCE(p_required_role, required_role),
    precondition = COALESCE(p_precondition, precondition),
    transition_id = COALESCE(p_transition_id, transition_id),
    requires_timer = COALESCE(p_requires_timer, requires_timer),
    use_business_hours = COALESCE(p_use_business_hours, use_business_hours),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = NOW()
  WHERE id = p_action_id;
END;
$$;


ALTER FUNCTION "public"."rpc_update_stage_action"("p_action_id" "uuid", "p_label" "text", "p_icon" "text", "p_style" "text", "p_required_role" "text", "p_precondition" "text", "p_transition_id" "uuid", "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_stage_spawn_config"("p_stage_id" "uuid", "p_child_inherits_submission" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
BEGIN
  v_company_id := public.my_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM   public.pipeline_stages ps
    JOIN   public.pipelines p ON p.id = ps.pipeline_id
    WHERE  ps.id = p_stage_id
      AND  p.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'stage not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pipeline_stages
  SET    child_inherits_submission = p_child_inherits_submission
  WHERE  id = p_stage_id;
END;
$$;


ALTER FUNCTION "public"."rpc_update_stage_spawn_config"("p_stage_id" "uuid", "p_child_inherits_submission" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_task_assignments"("p_task_id" "uuid", "p_user_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_team_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_manager_id UUID;
  v_uid        UUID;
  v_tid        UUID;
BEGIN
  -- 1: Check Permissions
  SELECT company_id, manager_id INTO v_company_id, v_manager_id FROM public.tasks WHERE id = p_task_id;
  
  -- Must be task manager OR company owner
  IF v_user_id != v_manager_id AND NOT (SELECT is_owner FROM public.users WHERE id = v_user_id) THEN
    -- Or if they are a manager of one of target teams? 
    -- For now, keep it simple: Task Manager only.
    RAISE EXCEPTION 'Only the task manager can modify assignments.';
  END IF;

  -- 2: Clear old assignments
  DELETE FROM public.task_assignments WHERE task_id = p_task_id;

  -- 3: Insert User Assignments
  FOREACH v_uid IN ARRAY p_user_ids LOOP
    INSERT INTO public.task_assignments(task_id, company_id, assignee_user_id, assigned_by)
    VALUES (p_task_id, v_company_id, v_uid, v_user_id);
  END LOOP;

  -- 4: Insert Team Assignments
  FOREACH v_tid IN ARRAY p_team_ids LOOP
    INSERT INTO public.task_assignments(task_id, company_id, assignee_team_id, assigned_by)
    VALUES (p_task_id, v_company_id, v_tid, v_user_id);
  END LOOP;

  PERFORM public.log_event(v_company_id, v_user_id, 'task', p_task_id, 'task.assignments_updated', jsonb_build_object('user_count', array_length(p_user_ids, 1), 'team_count', array_length(p_team_ids, 1)));
END;
$$;


ALTER FUNCTION "public"."rpc_update_task_assignments"("p_task_id" "uuid", "p_user_ids" "uuid"[], "p_team_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_task_status"("p_task_id" "uuid", "p_new_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_old_status TEXT;
  v_user_id    UUID := auth.uid();
BEGIN
  SELECT company_id, status INTO v_company_id, v_old_status 
  FROM public.tasks 
  WHERE id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Task not found or deleted';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.has_permission('tasks.update') THEN
    RAISE EXCEPTION 'Insufficient permissions to update tasks';
  END IF;

  IF v_old_status = p_new_status THEN
    RETURN;
  END IF;

  UPDATE public.tasks SET status = p_new_status WHERE id = p_task_id;

  PERFORM public.log_event(v_company_id, v_user_id, 'task', p_task_id, 'task.status_changed',
    jsonb_build_object('old_status', v_old_status, 'new_status', p_new_status));
END;
$$;


ALTER FUNCTION "public"."rpc_update_task_status"("p_task_id" "uuid", "p_new_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_transition"("p_transition_id" "uuid", "p_label" "text" DEFAULT NULL::"text", "p_required_permission" "text" DEFAULT NULL::"text", "p_transition_type" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_db_type   transition_outcome_type;
  v_permission TEXT;
  v_style     TEXT;
BEGIN
  -- Normalise type (accept UI labels or DB enum values)
  IF p_transition_type IS NOT NULL THEN
    v_db_type := CASE
      WHEN p_transition_type = 'warning' THEN 'revision'
      WHEN p_transition_type = 'danger'  THEN 'failure'
      WHEN p_transition_type IN ('success','revision','failure','neutral') THEN p_transition_type
      ELSE 'neutral'
    END::transition_outcome_type;
  END IF;

  -- Normalise permission: treat empty string as "clear the restriction"
  -- Use a sentinel: if the caller explicitly passes '' or NULL we set to NULL,
  -- otherwise keep existing. We distinguish via IS NULL check on the raw param.
  IF p_required_permission IS NOT NULL THEN
    v_permission := NULLIF(TRIM(p_required_permission), '');
  END IF;

  UPDATE public.pipeline_stage_transitions
  SET
    label               = CASE WHEN p_label IS NOT NULL               THEN p_label         ELSE label               END,
    required_permission = CASE WHEN p_required_permission IS NOT NULL  THEN v_permission    ELSE required_permission  END,
    transition_type     = CASE WHEN p_transition_type IS NOT NULL      THEN v_db_type       ELSE transition_type      END
  WHERE id = p_transition_id;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Sync the auto-created stage action so label and style stay consistent
  IF p_label IS NOT NULL OR p_transition_type IS NOT NULL THEN
    v_style := CASE v_db_type
      WHEN 'success'  THEN 'success'
      WHEN 'revision' THEN 'warning'
      WHEN 'failure'  THEN 'danger'
      ELSE 'neutral'
    END;

    UPDATE public.pipeline_stage_actions
    SET
      label      = CASE WHEN p_label IS NOT NULL          THEN p_label  ELSE label  END,
      style      = CASE WHEN p_transition_type IS NOT NULL THEN v_style  ELSE style  END,
      updated_at = NOW()
    WHERE transition_id = p_transition_id;
  END IF;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."rpc_update_transition"("p_transition_id" "uuid", "p_label" "text", "p_required_permission" "text", "p_transition_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_upsert_linked_outcome"("p_parent_stage_id" "uuid", "p_child_terminal_stage_id" "uuid", "p_parent_target_stage_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_id         UUID;
BEGIN
  v_company_id := public.my_company_id();

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to manage pipeline handshakes';
  END IF;

  INSERT INTO public.pipeline_linked_outcomes (
    parent_stage_id, child_terminal_stage_id, parent_target_stage_id, company_id
  )
  VALUES (
    p_parent_stage_id, p_child_terminal_stage_id, p_parent_target_stage_id, v_company_id
  )
  ON CONFLICT (parent_stage_id, child_terminal_stage_id)
  DO UPDATE SET
    parent_target_stage_id = EXCLUDED.parent_target_stage_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."rpc_upsert_linked_outcome"("p_parent_stage_id" "uuid", "p_child_terminal_stage_id" "uuid", "p_parent_target_stage_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_upsert_notification_preferences"("p_email_enabled" boolean, "p_push_mobile_enabled" boolean, "p_push_web_enabled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notification_preferences
    (user_id, email_enabled, push_mobile_enabled, push_web_enabled, updated_at)
  VALUES
    (auth.uid(), p_email_enabled, p_push_mobile_enabled, p_push_web_enabled, now())
  ON CONFLICT (user_id) DO UPDATE SET
    email_enabled       = EXCLUDED.email_enabled,
    push_mobile_enabled = EXCLUDED.push_mobile_enabled,
    push_web_enabled    = EXCLUDED.push_web_enabled,
    updated_at          = now();
END;
$$;


ALTER FUNCTION "public"."rpc_upsert_notification_preferences"("p_email_enabled" boolean, "p_push_mobile_enabled" boolean, "p_push_web_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_upsert_push_subscription"("p_type" "text", "p_token" "text", "p_device_id" "text", "p_platform" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.push_subscriptions
    (user_id, type, token, device_id, platform, last_active_at)
  VALUES
    (auth.uid(), p_type, p_token, p_device_id, p_platform, now())
  ON CONFLICT (user_id, device_id) DO UPDATE SET
    token          = EXCLUDED.token,
    type           = EXCLUDED.type,
    platform       = EXCLUDED.platform,
    last_active_at = now(),
    revoked_at     = NULL;
END;
$$;


ALTER FUNCTION "public"."rpc_upsert_push_subscription"("p_type" "text", "p_token" "text", "p_device_id" "text", "p_platform" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_waitlist_count"() RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select count(*) from public.waitlist_signups;
$$;


ALTER FUNCTION "public"."rpc_waitlist_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_waitlist_join"("p_email" "text", "p_company_name" "text", "p_honeypot" "text" DEFAULT ''::"text", "p_ref_code" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_email          text := lower(trim(p_email));
  v_company        text := nullif(trim(p_company_name), '');
  v_ip             text;
  v_ip_hash        text;
  v_recent         int;
  v_status         text;
  v_count          bigint;
  v_code           text := lower(encode(extensions.gen_random_bytes(4), 'hex'));
  v_referred_by_id uuid;
  v_out_code       text;
  v_rows           int;
begin
  if p_honeypot is not null and p_honeypot <> '' then
    return jsonb_build_object('status', 'created', 'count', null, 'referral_code', null);
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.';
  end if;

  if v_company is null then
    raise exception 'Please enter a company name.';
  end if;

  v_ip := split_part(
    coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
    ',', 1
  );
  v_ip := nullif(trim(v_ip), '');
  v_ip_hash := encode(extensions.digest(coalesce(v_ip, 'unknown'), 'sha256'), 'hex');

  select count(*) into v_recent
  from public.waitlist_signups
  where ip_hash = v_ip_hash
    and created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    raise exception 'Too many requests. Please try again later.';
  end if;

  if p_ref_code is not null and trim(p_ref_code) <> '' then
    select id into v_referred_by_id
    from public.waitlist_signups
    where referral_code = lower(trim(p_ref_code));
  end if;

  insert into public.waitlist_signups (email, company_name, ip_hash, referral_code, referred_by_id)
  values (v_email, v_company, v_ip_hash, v_code, v_referred_by_id)
  on conflict (lower(email)) do nothing
  returning referral_code into v_out_code;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    v_status := 'duplicate';
    select referral_code into v_out_code
    from public.waitlist_signups
    where lower(email) = v_email;
  else
    v_status := 'created';
  end if;

  select count(*) into v_count from public.waitlist_signups;

  return jsonb_build_object('status', v_status, 'count', v_count, 'referral_code', v_out_code);
end;
$_$;


ALTER FUNCTION "public"."rpc_waitlist_join"("p_email" "text", "p_company_name" "text", "p_honeypot" "text", "p_ref_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_import_connections_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_import_connections_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."spawn_recursive_task"("p_parent_task_id" "uuid", "p_pipeline_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_parent      RECORD;
  v_child_id    UUID;
  v_rule        TEXT;
  v_max_depth   INT;
  v_resolved_mgr UUID;
  v_sender_id   UUID := auth.uid();
  v_audit_meta  JSONB;
  v_attempt     INT;
BEGIN
  -- 1: Fetch Context
  SELECT * INTO v_parent FROM public.tasks WHERE id = p_parent_task_id;
  
  -- Calculate Attempt Count
  SELECT COUNT(*) + 1 INTO v_attempt FROM public.tasks WHERE parent_task_id = p_parent_task_id;

  SELECT manager_routing_rule, max_escalation_depth 
  INTO v_rule, v_max_depth 
  FROM public.pipeline_stages 
  WHERE pipeline_id = p_pipeline_id AND is_initial = TRUE
  LIMIT 1;

  -- 2: Resolve Manager
  CASE v_rule
    WHEN 'SENDER_MANAGER' THEN
      v_resolved_mgr := public.fn_resolve_effective_manager(v_sender_id, 0, v_max_depth);
    WHEN 'TEAM_MANAGER' THEN
       v_resolved_mgr := (SELECT manager_id FROM public.teams WHERE id = (SELECT assignee_team_id FROM public.task_assignments WHERE task_id = p_parent_task_id LIMIT 1));
    ELSE
      v_resolved_mgr := v_parent.manager_id;
  END CASE;

  IF v_resolved_mgr IS NULL THEN v_resolved_mgr := v_parent.manager_id; END IF;

  -- 3: Create Task with versioning in title
  INSERT INTO public.tasks (
    company_id, title, description, priority, 
    created_by, manager_id, project_id,
    pipeline_id, parent_task_id,
    category, weight
  )
  VALUES (
    v_parent.company_id,
    '[Attempt #' || v_attempt || '] ' || v_parent.title,
    v_parent.description,
    v_parent.priority,
    v_parent.created_by,
    v_resolved_mgr,
    v_parent.project_id,
    p_pipeline_id,
    p_parent_task_id,
    v_parent.category,
    v_parent.weight
  )
  RETURNING id INTO v_child_id;
  
  -- 4: Stage Update
  UPDATE public.tasks t
  SET current_stage_id = s.id, status = s.name
  FROM public.pipeline_stages s
  WHERE s.pipeline_id = p_pipeline_id AND s.is_initial = TRUE
    AND t.id = v_child_id;

  -- 5: AUDIT LOG
  v_audit_meta := jsonb_build_object(
    'routing_rule', v_rule,
    'parent_task_id', p_parent_task_id,
    'resolved_manager_id', v_resolved_mgr,
    'attempt_number', v_attempt
  );

  PERFORM public.log_event(
    v_parent.company_id,
    v_sender_id,
    'task',
    v_child_id,
    'task.recursive_spawn',
    v_audit_meta
  );

  RETURN v_child_id;
END;
$$;


ALTER FUNCTION "public"."spawn_recursive_task"("p_parent_task_id" "uuid", "p_pipeline_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_recursive_child_tasks"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- We only propagate from PARENTS (parent_task_id IS NULL)
  IF OLD.parent_task_id IS NULL THEN
    
    -- Sync description, priority, and company_id (safety)
    UPDATE public.tasks
    SET 
      description = NEW.description,
      priority = NEW.priority,
      updated_at = NOW()
    WHERE parent_task_id = OLD.id
      -- Only sync if they are DISTINCT to avoid infinite cycles
      AND (description IS DISTINCT FROM NEW.description 
           OR priority IS DISTINCT FROM NEW.priority);
           
    -- Log the sync event if changes occurred
    IF NEW.description IS DISTINCT FROM OLD.description OR NEW.priority IS DISTINCT FROM OLD.priority THEN
      PERFORM public.log_event(
        NEW.company_id,
        NULL, -- System Actor
        'task',
        NEW.id,
        'task:recursive_sync',
        jsonb_build_object('reason', 'Propagated to children')
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_recursive_child_tasks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_stage_submission_mode"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- submission_mode is the source of truth when provided; otherwise derive it
  -- from the legacy boolean (preset/seed inserts that only set requires_submission).
  IF NEW.submission_mode IS NOT NULL THEN
    NEW.requires_submission := (NEW.submission_mode = 'required');
  ELSE
    NEW.submission_mode := CASE WHEN COALESCE(NEW.requires_submission, FALSE) THEN 'required' ELSE 'none' END;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_stage_submission_mode"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_task_status_from_stage"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.current_stage_id IS DISTINCT FROM OLD.current_stage_id THEN
    IF NEW.current_stage_id IS NULL THEN
      NEW.status := 'open';
    ELSE
      SELECT name INTO NEW.status
      FROM   public.pipeline_stages
      WHERE  id = NEW.current_stage_id;

      IF EXISTS (
        SELECT 1 FROM public.pipeline_stages
        WHERE  id = NEW.current_stage_id
          AND  is_terminal = TRUE
          AND  terminal_type = 'success'
      ) THEN
        NEW.completed_at := NOW();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_task_status_from_stage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."task_accessible"("p_task_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = p_task_id
      AND t.deleted_at IS NULL
      AND t.company_id = public.my_company_id()
      AND (
        COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = auth.uid()), FALSE)
        OR t.created_by = auth.uid()
        OR t.manager_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.task_assignments ta
          WHERE ta.task_id = t.id
            AND (
              ta.assignee_user_id = auth.uid()
              OR ta.assignee_team_id IN (
                SELECT tm.team_id FROM public.team_members tm
                WHERE tm.user_id = auth.uid() AND tm.removed_at IS NULL
              )
            )
        )
        OR public.has_permission('task.view_detail')
      )
  );
$$;


ALTER FUNCTION "public"."task_accessible"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."task_comments_search_tsv_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.search_tsv := setweight(to_tsvector('english', coalesce(NEW.content,'')), 'B');
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."task_comments_search_tsv_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."task_list_visible"("p_task_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = p_task_id AND t.deleted_at IS NULL AND t.company_id = public.my_company_id()
      AND (
        public.has_permission('system.view_all_data')
        OR COALESCE((SELECT u.is_owner FROM public.users u WHERE u.id = auth.uid()), FALSE)
        OR EXISTS (
          SELECT 1 FROM public.pipelines p
          WHERE p.id = t.pipeline_id
            AND p.deleted_at IS NULL
            -- pipeline must be visible to the caller (mirrors pipelines_select)
            AND (
              p.visibility_permissions = '{}'::text[]
              OR EXISTS (
                SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = auth.uid()
                  AND ur.company_id = public.my_company_id()
                  AND ur.revoked_at IS NULL
                  AND (ur.role_id)::text = ANY (p.visibility_permissions)
              )
            )
            -- task-level visibility within a pipeline the caller can see
            AND (
              public.has_permission('task.view_all')
              OR public.has_permission('tasks.view_all')
              OR p.task_visibility_mode = 'all'
              OR (p.task_visibility_mode = 'assigned_only' AND (
                   t.created_by = auth.uid() OR t.manager_id = auth.uid()
                   OR EXISTS (
                     SELECT 1 FROM public.task_assignments ta
                     WHERE ta.task_id = t.id
                       AND (ta.assignee_user_id = auth.uid()
                            OR ta.assignee_team_id IN (
                              SELECT tm.team_id FROM public.team_members tm
                              WHERE tm.user_id = auth.uid() AND tm.removed_at IS NULL))
                   )))
            )
        )
        OR (t.pipeline_id IS NULL AND (
              t.created_by = auth.uid() OR t.manager_id = auth.uid()
              OR public.has_permission('task.view_all') OR public.has_permission('tasks.view_all')))
      )
  );
$$;


ALTER FUNCTION "public"."task_list_visible"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tasks_search_tsv_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.search_tsv :=
      setweight(to_tsvector('english', coalesce(NEW.title,'')),       'A')
   || setweight(to_tsvector('english', coalesce(NEW.description,'')), 'B')
   || setweight(to_tsvector('english', coalesce(NEW.category,'')),    'C');
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."tasks_search_tsv_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tr_generate_company_join_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.join_code IS NULL THEN
    NEW.join_code := public.fn_generate_join_code();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."tr_generate_company_join_code"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "event_type" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activity_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."activity_events" IS 'Append-only audit log. Never update or delete rows.';



CREATE TABLE IF NOT EXISTS "public"."activity_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."activity_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."analytics_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "snapshot_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "period_type" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "analytics_snapshots_period_type_check" CHECK (("period_type" = ANY (ARRAY['week'::"text", 'month'::"text", 'year'::"text"]))),
    CONSTRAINT "analytics_snapshots_snapshot_type_check" CHECK (("snapshot_type" = ANY (ARRAY['user_performance'::"text", 'pipeline_performance'::"text", 'pipeline_points'::"text", 'pipeline_hours'::"text"])))
);


ALTER TABLE "public"."analytics_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_execution_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "automation_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "executed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid",
    "stage_id" "uuid"
);


ALTER TABLE "public"."automation_execution_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "plan_code" "text",
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."billing_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_plans" (
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "price_cents" integer DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text" NOT NULL,
    "interval" "text" DEFAULT 'month'::"text" NOT NULL,
    "per_seat" boolean DEFAULT true NOT NULL,
    "features" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "limits" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "billing_plans_interval_check" CHECK (("interval" = ANY (ARRAY['month'::"text", 'year'::"text"])))
);


ALTER TABLE "public"."billing_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "logo_url" "text",
    "industry" "text",
    "country" "text",
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "join_code" "text",
    "description" "text",
    "website" "text"
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


COMMENT ON TABLE "public"."companies" IS 'Root multi-tenant entity. Every table is scoped by company_id.';



CREATE TABLE IF NOT EXISTS "public"."company_billing" (
    "company_id" "uuid" NOT NULL,
    "plan_code" "text" DEFAULT 'free'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "seats" integer DEFAULT 1 NOT NULL,
    "external_provider" "text",
    "external_customer_id" "text",
    "external_subscription_id" "text",
    "current_period_end" timestamp with time zone,
    "trial_ends_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "storage_used_bytes" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "company_billing_status_check" CHECK (("status" = ANY (ARRAY['none'::"text", 'trialing'::"text", 'active'::"text", 'past_due'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."company_billing" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_ping_sounds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "sound_url" "text" NOT NULL,
    "sound_file_name" "text" NOT NULL,
    "file_size_bytes" integer,
    "mime_type" "text" DEFAULT 'audio/mpeg'::"text",
    "uploaded_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."company_ping_sounds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_retention_settings" (
    "company_id" "uuid" NOT NULL,
    "inactivity_days" integer DEFAULT 90 NOT NULL,
    "warning_interval_days" integer DEFAULT 10 NOT NULL,
    "user_inactivity_days" integer DEFAULT 90 NOT NULL,
    "warnings_enabled" boolean DEFAULT true NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "company_retention_settings_inactivity_days_check" CHECK ((("inactivity_days" >= 7) AND ("inactivity_days" <= 3650))),
    CONSTRAINT "company_retention_settings_user_inactivity_days_check" CHECK ((("user_inactivity_days" >= 7) AND ("user_inactivity_days" <= 3650))),
    CONSTRAINT "company_retention_settings_warning_interval_days_check" CHECK ((("warning_interval_days" >= 1) AND ("warning_interval_days" <= 365)))
);


ALTER TABLE "public"."company_retention_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entity_watchers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."entity_watchers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."filehub_activity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "file_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "filehub_activity_action_check" CHECK (("action" = ANY (ARRAY['upload'::"text", 'download'::"text", 'view'::"text", 'delete'::"text", 'share'::"text"])))
);


ALTER TABLE "public"."filehub_activity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."filehub_file_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "version_no" integer NOT NULL,
    "storage_path" "text" NOT NULL,
    "bucket" "text" DEFAULT 'filehub-files'::"text" NOT NULL,
    "original_name" "text" NOT NULL,
    "size_bytes" bigint NOT NULL,
    "mime_type" "text",
    "content_hash" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "superseded_at" timestamp with time zone,
    "pinned" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."filehub_file_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."filehub_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "uploaded_by" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "bucket" "text" DEFAULT 'filehub-files'::"text" NOT NULL,
    "original_name" "text" NOT NULL,
    "mime_type" "text",
    "size_bytes" bigint NOT NULL,
    "content_hash" "text",
    "caption" "text",
    "visibility" "text" NOT NULL,
    "folder_id" "uuid",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "replaces_file_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "group_id" "uuid",
    "current_version_id" "uuid",
    "updated_at" timestamp with time zone,
    "updated_by" "uuid",
    "search_tsv" "tsvector",
    "task_id" "uuid",
    CONSTRAINT "filehub_files_size_bytes_check" CHECK (("size_bytes" >= 0)),
    CONSTRAINT "filehub_files_visibility_check" CHECK (("visibility" = ANY (ARRAY['direct'::"text", 'broadcast'::"text", 'group'::"text", 'task'::"text"])))
);


ALTER TABLE "public"."filehub_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."filehub_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_id" "uuid",
    "scope" "text" DEFAULT 'direct'::"text" NOT NULL,
    "group_id" "uuid",
    "deleted_at" timestamp with time zone,
    CONSTRAINT "filehub_folders_group_scope_chk" CHECK ((("scope" = 'group'::"text") = ("group_id" IS NOT NULL))),
    CONSTRAINT "filehub_folders_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 80))),
    CONSTRAINT "filehub_folders_scope_check" CHECK (("scope" = ANY (ARRAY['direct'::"text", 'broadcast'::"text", 'group'::"text"])))
);


ALTER TABLE "public"."filehub_folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."filehub_group_members" (
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "added_by" "uuid",
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "filehub_group_members_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."filehub_group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."filehub_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "avatar_color" "text" DEFAULT '#6366f1'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "filehub_groups_description_check" CHECK ((("description" IS NULL) OR ("length"("description") <= 300))),
    CONSTRAINT "filehub_groups_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 80)))
);


ALTER TABLE "public"."filehub_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."filehub_recipients" (
    "file_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "read_at" timestamp with time zone,
    "archived_at" timestamp with time zone
);


ALTER TABLE "public"."filehub_recipients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."filehub_seen" (
    "user_id" "uuid" NOT NULL,
    "scope" "text" NOT NULL,
    "group_id" "uuid",
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "filehub_seen_check" CHECK ((("scope" = 'group'::"text") = ("group_id" IS NOT NULL))),
    CONSTRAINT "filehub_seen_scope_check" CHECK (("scope" = ANY (ARRAY['broadcast'::"text", 'group'::"text"])))
);


ALTER TABLE "public"."filehub_seen" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."filehub_share_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_id" "uuid",
    "company_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "view_count" integer DEFAULT 0 NOT NULL,
    "last_viewed_at" timestamp with time zone,
    "folder_id" "uuid",
    CONSTRAINT "filehub_share_links_one_target" CHECK ((((("file_id" IS NOT NULL))::integer + (("folder_id" IS NOT NULL))::integer) = 1))
);


ALTER TABLE "public"."filehub_share_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submission_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "uploaded_by" "uuid",
    "file_name" "text" NOT NULL,
    "file_url" "text" NOT NULL,
    "file_size" bigint,
    "mime_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category" "text",
    "storage_path" "text",
    "version_id" "uuid",
    "filehub_file_id" "uuid"
);


ALTER TABLE "public"."submission_attachments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."submission_attachments"."category" IS 'High-level file classification: image, document, spreadsheet, other.';



CREATE TABLE IF NOT EXISTS "public"."task_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "uploaded_by" "uuid",
    "file_name" "text" NOT NULL,
    "file_url" "text" NOT NULL,
    "file_size" bigint,
    "mime_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category" "text",
    "storage_path" "text",
    "current_version_id" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "updated_at" timestamp with time zone,
    "updated_by" "uuid",
    "filehub_file_id" "uuid"
);


ALTER TABLE "public"."task_attachments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."task_attachments"."category" IS 'High-level file classification: image, document, spreadsheet, other.';



CREATE TABLE IF NOT EXISTS "public"."task_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "assignment_id" "uuid",
    "submitted_by" "uuid" NOT NULL,
    "content" "text",
    "stage_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "revision_count" integer DEFAULT 0 NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_notes" "text",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "current_version_id" "uuid",
    "updated_by" "uuid",
    CONSTRAINT "task_submissions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'needs_revision'::"text", 'rejected'::"text", 'quarantined'::"text"])))
);

ALTER TABLE ONLY "public"."task_submissions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."task_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "due_date" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "pipeline_id" "uuid",
    "current_stage_id" "uuid",
    "project_id" "uuid",
    "manager_id" "uuid",
    "progress" integer DEFAULT 0 NOT NULL,
    "weight" bigint DEFAULT 1 NOT NULL,
    "category" "text",
    "completed_at" timestamp with time zone,
    "is_recurring" boolean DEFAULT false NOT NULL,
    "recurring_pattern" "jsonb",
    "parent_task_id" "uuid",
    "error_state" "text",
    "quarantine_reason" "jsonb",
    "visibility_permission" "text",
    "start_date" timestamp with time zone,
    "estimated_hours" numeric(6,2),
    "search_tsv" "tsvector",
    CONSTRAINT "ck_tasks_priority" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "tasks_progress_check" CHECK ((("progress" >= 0) AND ("progress" <= 100))),
    CONSTRAINT "tasks_weight_1_10" CHECK ((("weight" >= 1) AND ("weight" <= 10)))
);

ALTER TABLE ONLY "public"."tasks" REPLICA IDENTITY FULL;


ALTER TABLE "public"."tasks" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tasks"."error_state" IS 'Machine-readable error classification for pipeline system failures. NULL means healthy. Values: handshake_deadlock, orphaned_child, loop_breaker_tripped.';



COMMENT ON COLUMN "public"."tasks"."quarantine_reason" IS 'Structured diagnostic payload stored when error_state is set. Contains: child_task_id, child_terminal_stage_id, pipeline_id, parent_stage_id, occurred_at.';



CREATE OR REPLACE VIEW "public"."files_index" AS
 SELECT 'filehub'::"text" AS "source",
    "f"."id" AS "file_id",
    "f"."company_id",
    "f"."bucket",
    "f"."storage_path",
    "f"."original_name" AS "file_name",
    "f"."mime_type",
    "f"."size_bytes",
    NULL::"text" AS "category",
    "f"."uploaded_by",
    "f"."created_at",
    NULL::"uuid" AS "task_id",
    NULL::"uuid" AS "submission_id",
    "f"."folder_id",
    "f"."group_id",
    "f"."visibility",
    NULL::"uuid" AS "project_id",
    NULL::"text" AS "task_category"
   FROM "public"."filehub_files" "f"
  WHERE (("f"."deleted_at" IS NULL) AND ("f"."visibility" <> 'task'::"text"))
UNION ALL
 SELECT 'submission'::"text" AS "source",
    "a"."id" AS "file_id",
    "a"."company_id",
    'submission-attachments'::"text" AS "bucket",
    "a"."storage_path",
    "a"."file_name",
    "a"."mime_type",
    "a"."file_size" AS "size_bytes",
    "a"."category",
    "a"."uploaded_by",
    "a"."created_at",
    "s"."task_id",
    "a"."submission_id",
    NULL::"uuid" AS "folder_id",
    NULL::"uuid" AS "group_id",
    NULL::"text" AS "visibility",
    "t"."project_id",
    "t"."category" AS "task_category"
   FROM (("public"."submission_attachments" "a"
     JOIN "public"."task_submissions" "s" ON (("s"."id" = "a"."submission_id")))
     LEFT JOIN "public"."tasks" "t" ON (("t"."id" = "s"."task_id")))
  WHERE (("s"."deleted_at" IS NULL) AND ("a"."version_id" = "s"."current_version_id"))
UNION ALL
 SELECT 'task_brief'::"text" AS "source",
    "a"."id" AS "file_id",
    "a"."company_id",
    'task-attachments'::"text" AS "bucket",
    "a"."storage_path",
    "a"."file_name",
    "a"."mime_type",
    "a"."file_size" AS "size_bytes",
    "a"."category",
    "a"."uploaded_by",
    "a"."created_at",
    "a"."task_id",
    NULL::"uuid" AS "submission_id",
    NULL::"uuid" AS "folder_id",
    NULL::"uuid" AS "group_id",
    NULL::"text" AS "visibility",
    "t"."project_id",
    "t"."category" AS "task_category"
   FROM ("public"."task_attachments" "a"
     LEFT JOIN "public"."tasks" "t" ON (("t"."id" = "a"."task_id")))
  WHERE ("a"."deleted_at" IS NULL);


ALTER VIEW "public"."files_index" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "encrypted_tokens" "text" NOT NULL,
    "instance_url" "text",
    "provider_user_id" "text",
    "provider_display_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "import_connections_provider_check" CHECK (("provider" = ANY (ARRAY['jira'::"text", 'odoo'::"text", 'trello'::"text"])))
);


ALTER TABLE "public"."import_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role_id" "uuid",
    "invited_by" "uuid",
    "token" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


COMMENT ON TABLE "public"."invitations" IS 'Manages invite flow. Trigger reads pending invitations on sign-up.';



COMMENT ON COLUMN "public"."invitations"."token" IS 'Unique token in invite email link. 7-day expiry.';



CREATE TABLE IF NOT EXISTS "public"."notification_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "user_id" "uuid" NOT NULL,
    "email_enabled" boolean DEFAULT true NOT NULL,
    "push_mobile_enabled" boolean DEFAULT true NOT NULL,
    "push_web_enabled" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "event_type" "text" NOT NULL,
    "conditions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "recipient_strategies" "text"[] NOT NULL,
    "recipient_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "channels_override" "jsonb",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "read_at" timestamp with time zone,
    "channels_sent" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text",
    "category" "text" NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


COMMENT ON TABLE "public"."permissions" IS 'Atomic capability keys. Naming convention: {resource}:{action}.';



COMMENT ON COLUMN "public"."permissions"."key" IS 'Unique capability identifier. Never rename after seeding.';



COMMENT ON COLUMN "public"."permissions"."is_system" IS 'System permissions cannot be deleted by users.';



CREATE TABLE IF NOT EXISTS "public"."pipeline_assignment_pool" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pipeline_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "member_user_id" "uuid",
    "member_team_id" "uuid",
    "is_withdrawn" boolean DEFAULT false NOT NULL,
    "last_assigned_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pipeline_assignment_pool_member_xor" CHECK ((("member_user_id" IS NOT NULL) <> ("member_team_id" IS NOT NULL)))
);


ALTER TABLE "public"."pipeline_assignment_pool" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipeline_automation_params" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "automation_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pipeline_automation_params" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipeline_automations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pipeline_id" "uuid" NOT NULL,
    "source_stage_id" "uuid" NOT NULL,
    "target_stage_id" "uuid" NOT NULL,
    "condition_type" "text" NOT NULL,
    "check_interval_minutes" integer DEFAULT 60 NOT NULL,
    "priority" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_run_at" timestamp with time zone,
    "failure_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid",
    CONSTRAINT "ck_automation_interval" CHECK (("check_interval_minutes" >= 1)),
    CONSTRAINT "pipeline_automations_check" CHECK (("source_stage_id" <> "target_stage_id"))
);


ALTER TABLE "public"."pipeline_automations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipeline_linked_outcomes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "parent_stage_id" "uuid" NOT NULL,
    "child_terminal_stage_id" "uuid" NOT NULL,
    "parent_target_stage_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pipeline_linked_outcomes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipeline_stage_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stage_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "icon" "text",
    "style" "text" DEFAULT 'neutral'::"text" NOT NULL,
    "required_role" "text" DEFAULT 'any'::"text" NOT NULL,
    "precondition" "text",
    "transition_id" "uuid",
    "position" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "requires_timer" boolean DEFAULT false,
    "use_business_hours" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_action_type" CHECK (("action_type" = ANY (ARRAY['start_task'::"text", 'submit_work'::"text", 'advance'::"text", 'review_approve'::"text", 'review_reject'::"text", 'review_revise'::"text", 'start_timer'::"text", 'assign_user'::"text", 'custom'::"text"]))),
    CONSTRAINT "chk_precondition" CHECK ((("precondition" IS NULL) OR ("precondition" = ANY (ARRAY['has_pending_submission'::"text", 'no_pending_submission'::"text", 'is_assigned'::"text", 'has_approved_submission'::"text", 'has_attachment'::"text", 'all_subtasks_complete'::"text"])))),
    CONSTRAINT "chk_style" CHECK (("style" = ANY (ARRAY['success'::"text", 'warning'::"text", 'danger'::"text", 'neutral'::"text", 'primary'::"text"])))
);


ALTER TABLE "public"."pipeline_stage_actions" OWNER TO "postgres";


COMMENT ON TABLE "public"."pipeline_stage_actions" IS 'Declarative action registry per pipeline stage. Controls what actions are available, who can perform them, preconditions, and optional linked transitions.';



COMMENT ON COLUMN "public"."pipeline_stage_actions"."requires_timer" IS 'If true, this specific action requires an active work session.';



COMMENT ON COLUMN "public"."pipeline_stage_actions"."use_business_hours" IS 'If true, duration calculation for this specific action uses business hours logic.';



CREATE TABLE IF NOT EXISTS "public"."pipeline_stage_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "pipeline_id" "uuid",
    "from_stage_id" "uuid",
    "to_stage_id" "uuid" NOT NULL,
    "transitioned_by" "uuid",
    "submission_id" "uuid",
    "from_stage_name" "text",
    "to_stage_name" "text",
    "transitioned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_reversal" boolean DEFAULT false
);

ALTER TABLE ONLY "public"."pipeline_stage_history" REPLICA IDENTITY FULL;


ALTER TABLE "public"."pipeline_stage_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."pipeline_stage_history" IS 'Append-only log of every task stage transition. Powers time-in-stage analytics.';



CREATE TABLE IF NOT EXISTS "public"."pipeline_stage_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stage_id" "uuid" NOT NULL,
    "target_active_seconds" integer DEFAULT 3600,
    "target_lifecycle_seconds" integer DEFAULT 86400,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "target_type" "text" DEFAULT 'performance'::"text",
    "target_quantity" integer,
    "target_deadline" timestamp with time zone,
    "company_id" "uuid",
    "status" "text" DEFAULT 'active'::"text",
    "completed_at" timestamp with time zone,
    CONSTRAINT "pipeline_stage_targets_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'expired'::"text"]))),
    CONSTRAINT "pipeline_stage_targets_target_type_check" CHECK (("target_type" = ANY (ARRAY['performance'::"text", 'volume'::"text"])))
);


ALTER TABLE "public"."pipeline_stage_targets" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pipeline_stage_targets"."status" IS 'The lifecycle state of the target: active, completed, or expired.';



COMMENT ON COLUMN "public"."pipeline_stage_targets"."completed_at" IS 'When the target was manually or automatically marked as completed.';



CREATE TABLE IF NOT EXISTS "public"."pipeline_stage_transitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "from_stage_id" "uuid" NOT NULL,
    "to_stage_id" "uuid" NOT NULL,
    "label" "text" DEFAULT 'Advance'::"text" NOT NULL,
    "required_permission" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "transition_type" "public"."transition_outcome_type" DEFAULT 'neutral'::"public"."transition_outcome_type" NOT NULL,
    CONSTRAINT "pipeline_stage_transitions_check" CHECK (("from_stage_id" <> "to_stage_id"))
);


ALTER TABLE "public"."pipeline_stage_transitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipeline_stages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pipeline_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "color" "text",
    "position" integer NOT NULL,
    "is_initial" boolean DEFAULT false NOT NULL,
    "is_terminal" boolean DEFAULT false NOT NULL,
    "terminal_type" "text",
    "requires_submission" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "linked_pipeline_id" "uuid",
    "manager_routing_rule" "text" DEFAULT 'INHERIT'::"text",
    "max_escalation_depth" integer DEFAULT 3,
    "requires_timer" boolean DEFAULT false,
    "use_business_hours" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "ui_metadata" "jsonb" DEFAULT '{"x": 0, "y": 0}'::"jsonb",
    "requires_attachments" boolean DEFAULT false,
    "child_inherits_submission" boolean DEFAULT false NOT NULL,
    "min_timer_seconds" integer DEFAULT 300 NOT NULL,
    "reassign_on_entry" boolean DEFAULT false NOT NULL,
    "submission_mode" "text" NOT NULL,
    CONSTRAINT "pipeline_stages_min_timer_seconds_check" CHECK (("min_timer_seconds" >= 0)),
    CONSTRAINT "pipeline_stages_requires_attachments_check" CHECK ((("requires_attachments" = false) OR ("requires_submission" = true))),
    CONSTRAINT "pipeline_stages_submission_mode_check" CHECK (("submission_mode" = ANY (ARRAY['none'::"text", 'optional'::"text", 'required'::"text"]))),
    CONSTRAINT "pipeline_stages_terminal_type_check" CHECK (("terminal_type" = ANY (ARRAY['success'::"text", 'failure'::"text", NULL::"text"])))
);


ALTER TABLE "public"."pipeline_stages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pipeline_stages"."requires_timer" IS 'If true, task cards will require starting a work session before advancing.';



COMMENT ON COLUMN "public"."pipeline_stages"."use_business_hours" IS 'If true, work sessions for tasks in this stage are filtered by official company hours.';



CREATE TABLE IF NOT EXISTS "public"."pipelines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_default" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "visibility_permissions" "text"[] DEFAULT '{}'::"text"[],
    "task_visibility_mode" "text" DEFAULT 'all'::"text",
    "require_time_approval" boolean DEFAULT true NOT NULL,
    "assignment_mode" "text" DEFAULT 'manual'::"text" NOT NULL,
    "assignment_pool_type" "text" DEFAULT 'users'::"text" NOT NULL,
    "file_visibility" "jsonb" DEFAULT '{"preset": "task_members"}'::"jsonb" NOT NULL,
    CONSTRAINT "pipelines_assignment_mode_check" CHECK (("assignment_mode" = ANY (ARRAY['manual'::"text", 'round_robin'::"text", 'smart'::"text"]))),
    CONSTRAINT "pipelines_assignment_pool_type_check" CHECK (("assignment_pool_type" = ANY (ARRAY['users'::"text", 'teams'::"text"]))),
    CONSTRAINT "pipelines_task_visibility_mode_check" CHECK (("task_visibility_mode" = ANY (ARRAY['all'::"text", 'assigned_only'::"text"])))
);


ALTER TABLE "public"."pipelines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_admins" (
    "email" "text" NOT NULL,
    "added_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."platform_admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_infra_snapshots" (
    "id" bigint NOT NULL,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "db_size_bytes" bigint DEFAULT 0 NOT NULL,
    "active_connections" integer DEFAULT 0 NOT NULL,
    "max_connections" integer DEFAULT 0 NOT NULL,
    "cache_hit_ratio" numeric(5,2) DEFAULT 0 NOT NULL,
    "xact_total" bigint DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."platform_infra_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."platform_infra_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."platform_infra_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."platform_infra_snapshots_id_seq" OWNED BY "public"."platform_infra_snapshots"."id";



CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "token" "text" NOT NULL,
    "device_id" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_active_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "push_subscriptions_platform_check" CHECK (("platform" = ANY (ARRAY['ios'::"text", 'android'::"text", 'web'::"text"]))),
    CONSTRAINT "push_subscriptions_type_check" CHECK (("type" = ANY (ARRAY['expo'::"text", 'web'::"text"])))
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rate_limit_buckets" (
    "user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "count" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."rate_limit_buckets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reporting_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "report_type" "text" DEFAULT 'performance_audit'::"text" NOT NULL,
    "parameters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "file_url" "text",
    "error_log" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_tsv" "tsvector",
    CONSTRAINT "reporting_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."reporting_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."reporting_jobs" IS 'Production-hardened reporting jobs table with RLS enforcement.';



CREATE TABLE IF NOT EXISTS "public"."retention_warnings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "scope" "text" DEFAULT 'company'::"text" NOT NULL,
    "days_inactive" integer NOT NULL,
    "days_until_purge" integer NOT NULL,
    "recipients_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."retention_warnings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "granted_by" "uuid"
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


COMMENT ON TABLE "public"."role_permissions" IS 'M:M join between roles and permissions.';



CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "color" "text",
    "is_system" boolean DEFAULT false NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


COMMENT ON TABLE "public"."roles" IS 'Named collections of permissions. company_id IS NULL = global platform preset.';



COMMENT ON COLUMN "public"."roles"."company_id" IS 'NULL for global preset roles. Set to company ID for company-custom roles.';



COMMENT ON COLUMN "public"."roles"."is_default" IS 'When TRUE, auto-assigned to invited users with no explicit role.';



CREATE TABLE IF NOT EXISTS "public"."storage_archive_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "file_path" "text" NOT NULL,
    "action" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "processed_at" timestamp with time zone,
    CONSTRAINT "storage_archive_queue_action_check" CHECK (("action" = ANY (ARRAY['archive'::"text", 'restore'::"text"]))),
    CONSTRAINT "storage_archive_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."storage_archive_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "assignee_user_id" "uuid",
    "assignee_team_id" "uuid",
    "assigned_by" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ck_task_assignee_present" CHECK ((("assignee_user_id" IS NOT NULL) OR ("assignee_team_id" IS NOT NULL)))
);


ALTER TABLE "public"."task_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_attachment_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "attachment_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "version_no" integer NOT NULL,
    "storage_path" "text",
    "bucket" "text" DEFAULT 'task-attachments'::"text" NOT NULL,
    "file_name" "text",
    "file_size" bigint,
    "mime_type" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "superseded_at" timestamp with time zone
);


ALTER TABLE "public"."task_attachment_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "parent_id" "uuid",
    "is_system" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "search_tsv" "tsvector",
    CONSTRAINT "task_comments_content_check" CHECK (("char_length"("content") > 0))
);

ALTER TABLE ONLY "public"."task_comments" REPLICA IDENTITY FULL;


ALTER TABLE "public"."task_comments" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_comments" IS 'Threaded comments on tasks. Supports unlimited nesting via parent_id.';



CREATE TABLE IF NOT EXISTS "public"."task_manual_time_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "stage_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "declared_minutes" integer NOT NULL,
    "reason" "text",
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_flagged" boolean DEFAULT false NOT NULL,
    "flag_reason" "text",
    "approval_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "rejection_reason" "text",
    "pending_transition_id" "uuid",
    "worked_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "session_id" "uuid",
    CONSTRAINT "task_manual_time_entries_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "task_manual_time_entries_declared_minutes_check" CHECK ((("declared_minutes" > 0) AND ("declared_minutes" <= 1440)))
);

ALTER TABLE ONLY "public"."task_manual_time_entries" REPLICA IDENTITY FULL;


ALTER TABLE "public"."task_manual_time_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_mention_acks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid",
    "user_id" "uuid",
    "company_id" "uuid",
    "acknowledged_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."task_mention_acks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "is_team_lead" boolean DEFAULT false NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "removed_at" timestamp with time zone,
    "added_by" "uuid"
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_members" IS 'M:M user-team membership. removed_at for soft-removal.';



COMMENT ON COLUMN "public"."team_members"."company_id" IS 'Denormalized from teams.company_id for efficient RLS policies.';



COMMENT ON COLUMN "public"."team_members"."is_team_lead" IS 'Display badge only. Does not grant additional permissions.';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid",
    "email" "text" NOT NULL,
    "full_name" "text",
    "display_name" "text",
    "avatar_url" "text",
    "phone" "text",
    "job_title" "text",
    "department" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "is_owner" boolean DEFAULT false NOT NULL,
    "last_seen_at" timestamp with time zone,
    "onboarded_at" timestamp with time zone,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "reports_to" "uuid",
    "work_status" "text" DEFAULT 'available'::"text",
    "last_join_attempt_at" timestamp with time zone,
    CONSTRAINT "ck_users_work_status" CHECK (("work_status" = ANY (ARRAY['available'::"text", 'busy'::"text", 'oof'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON TABLE "public"."users" IS '1:1 with auth.users. Stores public profile. Provisioned via trigger.';



COMMENT ON COLUMN "public"."users"."is_owner" IS 'Company founder flag — bypasses all permission checks within their company.';



CREATE OR REPLACE VIEW "public"."task_participants" AS
 SELECT "t"."id" AS "task_id",
    "u"."id" AS "user_id"
   FROM ("public"."tasks" "t"
     JOIN "public"."users" "u" ON (("t"."company_id" = "u"."company_id")))
  WHERE ("u"."is_owner" = true)
UNION
 SELECT "task_assignments"."task_id",
    "task_assignments"."assignee_user_id" AS "user_id"
   FROM "public"."task_assignments"
  WHERE ("task_assignments"."assignee_user_id" IS NOT NULL)
UNION
 SELECT "ta"."task_id",
    "tm"."user_id"
   FROM ("public"."task_assignments" "ta"
     JOIN "public"."team_members" "tm" ON (("ta"."assignee_team_id" = "tm"."team_id")))
  WHERE ("ta"."assignee_team_id" IS NOT NULL)
UNION
 SELECT "tasks"."id" AS "task_id",
    "tasks"."manager_id" AS "user_id"
   FROM "public"."tasks"
  WHERE ("tasks"."manager_id" IS NOT NULL);


ALTER VIEW "public"."task_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_ping_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "pinged_by" "uuid" NOT NULL,
    "target_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."task_ping_targets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_submission_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "version_no" integer NOT NULL,
    "content" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "superseded_at" timestamp with time zone
);


ALTER TABLE "public"."task_submission_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_work_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paused_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "total_seconds_spent" integer DEFAULT 0,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_heartbeat_at" timestamp with time zone DEFAULT "now"(),
    "stage_id" "uuid",
    CONSTRAINT "task_work_sessions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."task_work_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."team_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "label" "text",
    "color" "text",
    "parent_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "manager_id" "uuid",
    "parent_team_id" "uuid"
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


COMMENT ON TABLE "public"."teams" IS 'Neutral organizational containers. No access-control meaning — management capability is determined by user roles, not team membership.';



COMMENT ON COLUMN "public"."teams"."label" IS 'Optional cosmetic category label e.g. Engineering, Sales, HR. Does not affect permissions.';



CREATE TABLE IF NOT EXISTS "public"."trial_code_redemptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "redeemed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "trial_ends_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."trial_code_redemptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trial_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "plan_code" "text" NOT NULL,
    "duration_hours" integer NOT NULL,
    "max_redemptions" integer,
    "redeemed_count" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone,
    "created_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trial_codes_duration_hours_check" CHECK ((("duration_hours" >= 1) AND ("duration_hours" <= 17520)))
);


ALTER TABLE "public"."trial_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "revoked_by" "uuid"
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_roles" IS 'Assigns roles to users. Multi-role support. revoked_at preserves history.';



CREATE OR REPLACE VIEW "public"."view_task_time_metrics" WITH ("security_invoker"='true') AS
 SELECT "task_id",
    COALESCE("sum"("total_seconds_spent"), (0)::bigint) AS "total_seconds",
    COALESCE("sum"(
        CASE
            WHEN ("user_id" = "auth"."uid"()) THEN "total_seconds_spent"
            ELSE 0
        END), (0)::bigint) AS "my_seconds"
   FROM "public"."task_work_sessions"
  GROUP BY "task_id";


ALTER VIEW "public"."view_task_time_metrics" OWNER TO "postgres";


COMMENT ON VIEW "public"."view_task_time_metrics" IS 'Aggregated time metrics per task, scoped to the current user (my_seconds) and total team (total_seconds).';



CREATE OR REPLACE VIEW "public"."view_user_performance" AS
 WITH "assignee_points" AS (
         SELECT "ta"."assignee_user_id" AS "user_id",
            "t"."company_id",
            "sum"("t"."weight") AS "weight_points",
            "count"("t"."id") AS "completed_tasks",
            "count"(*) FILTER (WHERE (("t"."due_date" IS NOT NULL) AND ("t"."completed_at" <= "t"."due_date"))) AS "on_time_tasks"
           FROM (("public"."task_assignments" "ta"
             JOIN "public"."tasks" "t" ON (("t"."id" = "ta"."task_id")))
             JOIN "public"."pipeline_stages" "ps" ON (("ps"."id" = "t"."current_stage_id")))
          WHERE (("ps"."terminal_type" = 'success'::"text") AND ("t"."completed_at" IS NOT NULL))
          GROUP BY "ta"."assignee_user_id", "t"."company_id"
        ), "work_stats" AS (
         SELECT "ws_1"."user_id",
            "ws_1"."company_id",
            "sum"("ws_1"."total_seconds_spent") AS "total_active_seconds"
           FROM "public"."task_work_sessions" "ws_1"
          WHERE ("ws_1"."status" = 'completed'::"text")
          GROUP BY "ws_1"."user_id", "ws_1"."company_id"
        ), "revision_stats" AS (
         SELECT "ts"."submitted_by" AS "user_id",
            "ts"."company_id",
            "sum"("ts"."revision_count") AS "total_revisions",
            "count"("ts"."id") AS "total_submissions"
           FROM "public"."task_submissions" "ts"
          GROUP BY "ts"."submitted_by", "ts"."company_id"
        )
 SELECT "u"."id",
    "u"."full_name",
    "u"."company_id",
    COALESCE("ap"."weight_points", (0)::numeric) AS "weight_points",
    COALESCE("ap"."completed_tasks", (0)::bigint) AS "completed_tasks",
    COALESCE("ws"."total_active_seconds", (0)::bigint) AS "total_active_seconds",
    COALESCE("rs"."total_revisions", (0)::bigint) AS "total_revisions",
        CASE
            WHEN (COALESCE("ap"."completed_tasks", (0)::bigint) = 0) THEN (1.0)::double precision
            ELSE ((COALESCE("ap"."on_time_tasks", (0)::bigint))::double precision / ("ap"."completed_tasks")::double precision)
        END AS "on_time_rate",
        CASE
            WHEN (COALESCE("rs"."total_submissions", (0)::bigint) = 0) THEN (0.0)::double precision
            ELSE ((COALESCE("rs"."total_revisions", (0)::bigint))::double precision / ("rs"."total_submissions")::double precision)
        END AS "revision_rate"
   FROM ((("public"."users" "u"
     LEFT JOIN "assignee_points" "ap" ON ((("ap"."user_id" = "u"."id") AND ("ap"."company_id" = "u"."company_id"))))
     LEFT JOIN "work_stats" "ws" ON ((("ws"."user_id" = "u"."id") AND ("ws"."company_id" = "u"."company_id"))))
     LEFT JOIN "revision_stats" "rs" ON ((("rs"."user_id" = "u"."id") AND ("rs"."company_id" = "u"."company_id"))));


ALTER VIEW "public"."view_user_performance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."waitlist_signups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "company_name" "text" NOT NULL,
    "ip_hash" "text",
    "referral_code" "text" NOT NULL,
    "referred_by_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."waitlist_signups" OWNER TO "postgres";


ALTER TABLE ONLY "public"."platform_infra_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."platform_infra_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analytics_snapshots"
    ADD CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."archives"
    ADD CONSTRAINT "archives_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_execution_log"
    ADD CONSTRAINT "automation_execution_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_plans"
    ADD CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_join_code_key" UNIQUE ("join_code");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."company_billing"
    ADD CONSTRAINT "company_billing_pkey" PRIMARY KEY ("company_id");



ALTER TABLE ONLY "public"."company_ping_sounds"
    ADD CONSTRAINT "company_ping_sounds_company_id_key" UNIQUE ("company_id");



ALTER TABLE ONLY "public"."company_ping_sounds"
    ADD CONSTRAINT "company_ping_sounds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_retention_settings"
    ADD CONSTRAINT "company_retention_settings_pkey" PRIMARY KEY ("company_id");



ALTER TABLE ONLY "public"."entity_watchers"
    ADD CONSTRAINT "entity_watchers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_watchers"
    ADD CONSTRAINT "entity_watchers_user_id_entity_type_entity_id_key" UNIQUE ("user_id", "entity_type", "entity_id");



ALTER TABLE ONLY "public"."filehub_activity"
    ADD CONSTRAINT "filehub_activity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."filehub_file_versions"
    ADD CONSTRAINT "filehub_file_versions_file_id_version_no_key" UNIQUE ("file_id", "version_no");



ALTER TABLE ONLY "public"."filehub_file_versions"
    ADD CONSTRAINT "filehub_file_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."filehub_files"
    ADD CONSTRAINT "filehub_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."filehub_folders"
    ADD CONSTRAINT "filehub_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."filehub_group_members"
    ADD CONSTRAINT "filehub_group_members_pkey" PRIMARY KEY ("group_id", "user_id");



ALTER TABLE ONLY "public"."filehub_groups"
    ADD CONSTRAINT "filehub_groups_company_id_name_key" UNIQUE ("company_id", "name");



ALTER TABLE ONLY "public"."filehub_groups"
    ADD CONSTRAINT "filehub_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."filehub_recipients"
    ADD CONSTRAINT "filehub_recipients_pkey" PRIMARY KEY ("file_id", "user_id");



ALTER TABLE ONLY "public"."filehub_share_links"
    ADD CONSTRAINT "filehub_share_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_connections"
    ADD CONSTRAINT "import_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_connections"
    ADD CONSTRAINT "import_connections_user_id_provider_instance_url_key" UNIQUE NULLS NOT DISTINCT ("user_id", "provider", "instance_url");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."notification_rules"
    ADD CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_assignment_pool"
    ADD CONSTRAINT "pipeline_assignment_pool_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_automation_params"
    ADD CONSTRAINT "pipeline_automation_params_automation_id_key_key" UNIQUE ("automation_id", "key");



ALTER TABLE ONLY "public"."pipeline_automation_params"
    ADD CONSTRAINT "pipeline_automation_params_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_automations"
    ADD CONSTRAINT "pipeline_automations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_linked_outcomes"
    ADD CONSTRAINT "pipeline_linked_outcomes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_stage_actions"
    ADD CONSTRAINT "pipeline_stage_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_stage_history"
    ADD CONSTRAINT "pipeline_stage_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_stage_targets"
    ADD CONSTRAINT "pipeline_stage_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_stage_transitions"
    ADD CONSTRAINT "pipeline_stage_transitions_from_stage_id_to_stage_id_key" UNIQUE ("from_stage_id", "to_stage_id");



ALTER TABLE ONLY "public"."pipeline_stage_transitions"
    ADD CONSTRAINT "pipeline_stage_transitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_stages"
    ADD CONSTRAINT "pipeline_stages_pipeline_id_name_key" UNIQUE ("pipeline_id", "name");



ALTER TABLE ONLY "public"."pipeline_stages"
    ADD CONSTRAINT "pipeline_stages_pipeline_id_position_key" UNIQUE ("pipeline_id", "position");



ALTER TABLE ONLY "public"."pipeline_stages"
    ADD CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipelines"
    ADD CONSTRAINT "pipelines_company_id_name_key" UNIQUE NULLS NOT DISTINCT ("company_id", "name");



ALTER TABLE ONLY "public"."pipelines"
    ADD CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_admins"
    ADD CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "public"."platform_infra_snapshots"
    ADD CONSTRAINT "platform_infra_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_company_id_name_key" UNIQUE NULLS NOT DISTINCT ("company_id", "name");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_device_id_key" UNIQUE ("user_id", "device_id");



ALTER TABLE ONLY "public"."rate_limit_buckets"
    ADD CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("user_id", "action", "window_start");



ALTER TABLE ONLY "public"."reporting_jobs"
    ADD CONSTRAINT "reporting_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."retention_warnings"
    ADD CONSTRAINT "retention_warnings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_permission_id_key" UNIQUE ("role_id", "permission_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_company_id_name_key" UNIQUE NULLS NOT DISTINCT ("company_id", "name");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."storage_archive_queue"
    ADD CONSTRAINT "storage_archive_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submission_attachments"
    ADD CONSTRAINT "submission_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_assignments"
    ADD CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_attachment_versions"
    ADD CONSTRAINT "task_attachment_versions_attachment_id_version_no_key" UNIQUE ("attachment_id", "version_no");



ALTER TABLE ONLY "public"."task_attachment_versions"
    ADD CONSTRAINT "task_attachment_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_manual_time_entries"
    ADD CONSTRAINT "task_manual_time_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_manual_time_entries"
    ADD CONSTRAINT "task_manual_time_entries_task_id_stage_id_user_id_key" UNIQUE ("task_id", "stage_id", "user_id");



ALTER TABLE ONLY "public"."task_mention_acks"
    ADD CONSTRAINT "task_mention_acks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_mention_acks"
    ADD CONSTRAINT "task_mention_acks_task_id_user_id_key" UNIQUE ("task_id", "user_id");



ALTER TABLE ONLY "public"."task_ping_targets"
    ADD CONSTRAINT "task_ping_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_submission_versions"
    ADD CONSTRAINT "task_submission_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_submission_versions"
    ADD CONSTRAINT "task_submission_versions_submission_id_version_no_key" UNIQUE ("submission_id", "version_no");



ALTER TABLE ONLY "public"."task_submissions"
    ADD CONSTRAINT "task_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_work_sessions"
    ADD CONSTRAINT "task_work_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_user_id_key" UNIQUE ("team_id", "user_id");



ALTER TABLE ONLY "public"."team_roles"
    ADD CONSTRAINT "team_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_roles"
    ADD CONSTRAINT "team_roles_team_id_role_id_key" UNIQUE ("team_id", "role_id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_company_id_name_key" UNIQUE ("company_id", "name");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trial_code_redemptions"
    ADD CONSTRAINT "trial_code_redemptions_code_id_company_id_key" UNIQUE ("code_id", "company_id");



ALTER TABLE ONLY "public"."trial_code_redemptions"
    ADD CONSTRAINT "trial_code_redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trial_codes"
    ADD CONSTRAINT "trial_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."trial_codes"
    ADD CONSTRAINT "trial_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_linked_outcomes"
    ADD CONSTRAINT "unq_linked_outcome" UNIQUE ("parent_stage_id", "child_terminal_stage_id");



ALTER TABLE ONLY "public"."analytics_snapshots"
    ADD CONSTRAINT "uq_analytics_snapshot" UNIQUE ("company_id", "snapshot_type", "subject_id", "period_type", "period_start");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_id_company_id_key" UNIQUE ("user_id", "role_id", "company_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_company_id_key" UNIQUE ("email", "company_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waitlist_signups"
    ADD CONSTRAINT "waitlist_signups_pkey" PRIMARY KEY ("id");



CREATE INDEX "filehub_activity_company_id_idx" ON "public"."filehub_activity" USING "btree" ("company_id");



CREATE INDEX "filehub_activity_file_id_idx" ON "public"."filehub_activity" USING "btree" ("file_id", "created_at" DESC);



CREATE INDEX "filehub_activity_user_recent_idx" ON "public"."filehub_activity" USING "btree" ("user_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_active_target_per_stage" ON "public"."pipeline_stage_targets" USING "btree" ("stage_id", "company_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_active_work_sessions" ON "public"."task_work_sessions" USING "btree" ("task_id", "status") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_activity_company_id" ON "public"."activity_events" USING "btree" ("company_id");



CREATE INDEX "idx_activity_created_at" ON "public"."activity_events" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "idx_activity_entity" ON "public"."activity_events" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_activity_event_type" ON "public"."activity_events" USING "btree" ("event_type");



CREATE INDEX "idx_activity_user_id" ON "public"."activity_events" USING "btree" ("user_id");



CREATE INDEX "idx_analytics_snap_lookup" ON "public"."analytics_snapshots" USING "btree" ("company_id", "snapshot_type", "subject_id", "period_type", "period_start");



CREATE INDEX "idx_analytics_snap_subject" ON "public"."analytics_snapshots" USING "btree" ("subject_id", "period_type", "period_start");



CREATE INDEX "idx_archives_entity_company" ON "public"."archives" USING "btree" ("entity_type", "company_id");



CREATE INDEX "idx_archives_metadata_gin" ON "public"."archives" USING "gin" ("metadata" "jsonb_path_ops");



CREATE INDEX "idx_archives_snapshot_pipeline" ON "public"."archives" USING "btree" (((("snapshot" -> 'task'::"text") ->> 'pipeline_id'::"text")));



CREATE INDEX "idx_auto_log_company" ON "public"."automation_execution_log" USING "btree" ("company_id");



CREATE INDEX "idx_automation_log_task_time" ON "public"."automation_execution_log" USING "btree" ("task_id", "executed_at");



CREATE INDEX "idx_billing_events_company" ON "public"."billing_events" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "idx_companies_is_active" ON "public"."companies" USING "btree" ("is_active") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_companies_slug" ON "public"."companies" USING "btree" ("slug");



CREATE INDEX "idx_filehub_files_company" ON "public"."filehub_files" USING "btree" ("company_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_filehub_files_content_hash" ON "public"."filehub_files" USING "btree" ("company_id", "content_hash") WHERE (("deleted_at" IS NULL) AND ("content_hash" IS NOT NULL));



CREATE INDEX "idx_filehub_files_folder" ON "public"."filehub_files" USING "btree" ("folder_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_filehub_files_group" ON "public"."filehub_files" USING "btree" ("group_id") WHERE (("deleted_at" IS NULL) AND ("group_id" IS NOT NULL));



CREATE INDEX "idx_filehub_files_search_tsv" ON "public"."filehub_files" USING "gin" ("search_tsv");



CREATE INDEX "idx_filehub_files_tags_gin" ON "public"."filehub_files" USING "gin" ("tags");



CREATE INDEX "idx_filehub_files_uploader" ON "public"."filehub_files" USING "btree" ("uploaded_by") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_filehub_files_visibility" ON "public"."filehub_files" USING "btree" ("company_id", "visibility") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_filehub_folders_company" ON "public"."filehub_folders" USING "btree" ("company_id");



CREATE INDEX "idx_filehub_folders_group" ON "public"."filehub_folders" USING "btree" ("group_id") WHERE ("group_id" IS NOT NULL);



CREATE INDEX "idx_filehub_folders_parent" ON "public"."filehub_folders" USING "btree" ("parent_id");



CREATE UNIQUE INDEX "idx_filehub_folders_unique_child" ON "public"."filehub_folders" USING "btree" ("company_id", "parent_id", "name") WHERE (("parent_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE UNIQUE INDEX "idx_filehub_folders_unique_root" ON "public"."filehub_folders" USING "btree" ("company_id", "scope", COALESCE("group_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "name") WHERE (("parent_id" IS NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_filehub_group_members_group" ON "public"."filehub_group_members" USING "btree" ("group_id");



CREATE INDEX "idx_filehub_group_members_user" ON "public"."filehub_group_members" USING "btree" ("user_id");



CREATE INDEX "idx_filehub_groups_company" ON "public"."filehub_groups" USING "btree" ("company_id");



CREATE INDEX "idx_filehub_name_trgm" ON "public"."filehub_files" USING "gin" ("original_name" "public"."gin_trgm_ops");



CREATE INDEX "idx_filehub_recipients_user" ON "public"."filehub_recipients" USING "btree" ("user_id") WHERE ("archived_at" IS NULL);



CREATE UNIQUE INDEX "idx_filehub_seen_uniq" ON "public"."filehub_seen" USING "btree" ("user_id", "scope", COALESCE("group_id", '00000000-0000-0000-0000-000000000000'::"uuid"));



CREATE INDEX "idx_filehub_share_links_file" ON "public"."filehub_share_links" USING "btree" ("file_id");



CREATE INDEX "idx_filehub_share_links_folder" ON "public"."filehub_share_links" USING "btree" ("folder_id");



CREATE UNIQUE INDEX "idx_filehub_share_links_token" ON "public"."filehub_share_links" USING "btree" ("token");



CREATE INDEX "idx_filehub_versions_company" ON "public"."filehub_file_versions" USING "btree" ("company_id");



CREATE INDEX "idx_filehub_versions_file" ON "public"."filehub_file_versions" USING "btree" ("file_id", "version_no");



CREATE INDEX "idx_filehub_versions_purge" ON "public"."filehub_file_versions" USING "btree" ("superseded_at") WHERE ("superseded_at" IS NOT NULL);



CREATE INDEX "idx_infra_snapshots_time" ON "public"."platform_infra_snapshots" USING "btree" ("captured_at" DESC);



CREATE INDEX "idx_invitations_company_id" ON "public"."invitations" USING "btree" ("company_id");



CREATE INDEX "idx_invitations_email" ON "public"."invitations" USING "btree" ("email");



CREATE INDEX "idx_invitations_status" ON "public"."invitations" USING "btree" ("company_id", "status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_invitations_token" ON "public"."invitations" USING "btree" ("token");



CREATE INDEX "idx_log_task_auto" ON "public"."automation_execution_log" USING "btree" ("task_id", "automation_id");



CREATE INDEX "idx_notification_events_type_processed" ON "public"."notification_events" USING "btree" ("event_type", "processed_at");



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC) WHERE ("read_at" IS NULL);



CREATE UNIQUE INDEX "idx_one_active_session_per_user" ON "public"."task_work_sessions" USING "btree" ("user_id") WHERE ("status" = 'active'::"text");



COMMENT ON INDEX "public"."idx_one_active_session_per_user" IS 'Hard enforcement that a user can only have one active work session globally.';



CREATE INDEX "idx_permissions_category" ON "public"."permissions" USING "btree" ("category");



CREATE INDEX "idx_permissions_is_system" ON "public"."permissions" USING "btree" ("is_system");



CREATE INDEX "idx_pipe_auto_company" ON "public"."pipeline_automations" USING "btree" ("company_id");



CREATE UNIQUE INDEX "idx_pipeline_stages_one_initial" ON "public"."pipeline_stages" USING "btree" ("pipeline_id") WHERE ("is_initial" = true);



CREATE INDEX "idx_pipeline_stages_pipeline_id" ON "public"."pipeline_stages" USING "btree" ("pipeline_id");



CREATE INDEX "idx_pipelines_company_id" ON "public"."pipelines" USING "btree" ("company_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_pipelines_one_default" ON "public"."pipelines" USING "btree" ("company_id") WHERE (("is_default" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_projects_company_id" ON "public"."projects" USING "btree" ("company_id");



CREATE INDEX "idx_projects_status" ON "public"."projects" USING "btree" ("company_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_reporting_jobs_search_tsv" ON "public"."reporting_jobs" USING "gin" ("search_tsv");



CREATE INDEX "idx_reporting_pending" ON "public"."reporting_jobs" USING "btree" ("status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_retention_warnings_company" ON "public"."retention_warnings" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "idx_role_permissions_permission_id" ON "public"."role_permissions" USING "btree" ("permission_id");



CREATE INDEX "idx_role_permissions_role_id" ON "public"."role_permissions" USING "btree" ("role_id");



CREATE INDEX "idx_roles_company_id" ON "public"."roles" USING "btree" ("company_id");



CREATE INDEX "idx_roles_is_default" ON "public"."roles" USING "btree" ("company_id", "is_default") WHERE (("is_default" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_roles_is_system" ON "public"."roles" USING "btree" ("is_system");



CREATE INDEX "idx_stage_actions_stage_id" ON "public"."pipeline_stage_actions" USING "btree" ("stage_id");



CREATE INDEX "idx_stage_hist_by_user" ON "public"."pipeline_stage_history" USING "btree" ("transitioned_by", "transitioned_at" DESC);



CREATE INDEX "idx_stage_hist_company_id" ON "public"."pipeline_stage_history" USING "btree" ("company_id", "transitioned_at" DESC);



CREATE INDEX "idx_stage_hist_pipeline_id" ON "public"."pipeline_stage_history" USING "btree" ("pipeline_id", "transitioned_at" DESC);



CREATE INDEX "idx_stage_hist_task_id" ON "public"."pipeline_stage_history" USING "btree" ("task_id");



CREATE INDEX "idx_stage_hist_to_stage" ON "public"."pipeline_stage_history" USING "btree" ("to_stage_id", "transitioned_at" DESC);



CREATE INDEX "idx_stage_transitions_from" ON "public"."pipeline_stage_transitions" USING "btree" ("from_stage_id");



CREATE INDEX "idx_stage_transitions_to" ON "public"."pipeline_stage_transitions" USING "btree" ("to_stage_id");



CREATE INDEX "idx_stg_linked_pipe" ON "public"."pipeline_stages" USING "btree" ("linked_pipeline_id");



CREATE INDEX "idx_sub_attach_company_id" ON "public"."submission_attachments" USING "btree" ("company_id");



CREATE INDEX "idx_sub_attach_submission_id" ON "public"."submission_attachments" USING "btree" ("submission_id");



CREATE INDEX "idx_submission_attachments_version" ON "public"."submission_attachments" USING "btree" ("version_id");



CREATE INDEX "idx_task_ast_company" ON "public"."task_assignments" USING "btree" ("company_id");



CREATE INDEX "idx_task_ast_task_id" ON "public"."task_assignments" USING "btree" ("task_id");



CREATE INDEX "idx_task_ast_team" ON "public"."task_assignments" USING "btree" ("assignee_team_id");



CREATE INDEX "idx_task_ast_user" ON "public"."task_assignments" USING "btree" ("assignee_user_id");



CREATE INDEX "idx_task_attach_company_id" ON "public"."task_attachments" USING "btree" ("company_id");



CREATE INDEX "idx_task_attach_task_id" ON "public"."task_attachments" USING "btree" ("task_id");



CREATE INDEX "idx_task_attachments_task_id" ON "public"."task_attachments" USING "btree" ("task_id");



CREATE INDEX "idx_task_attachments_task_live" ON "public"."task_attachments" USING "btree" ("task_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_task_comments_created" ON "public"."task_comments" USING "btree" ("task_id", "created_at");



CREATE INDEX "idx_task_comments_parent" ON "public"."task_comments" USING "btree" ("parent_id");



CREATE INDEX "idx_task_comments_search_tsv" ON "public"."task_comments" USING "gin" ("search_tsv");



CREATE INDEX "idx_task_comments_task" ON "public"."task_comments" USING "btree" ("task_id");



CREATE INDEX "idx_task_mention_acks_lookup" ON "public"."task_mention_acks" USING "btree" ("task_id", "user_id");



CREATE INDEX "idx_task_ping_targets_target_user" ON "public"."task_ping_targets" USING "btree" ("target_user_id", "created_at" DESC);



CREATE INDEX "idx_task_sub_company_id" ON "public"."task_submissions" USING "btree" ("company_id");



CREATE INDEX "idx_task_sub_status" ON "public"."task_submissions" USING "btree" ("company_id", "status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_task_sub_submitted_by" ON "public"."task_submissions" USING "btree" ("submitted_by");



CREATE INDEX "idx_task_sub_task_id" ON "public"."task_submissions" USING "btree" ("task_id");



CREATE INDEX "idx_task_submissions_task_live" ON "public"."task_submissions" USING "btree" ("task_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_tasks_company_id" ON "public"."tasks" USING "btree" ("company_id");



CREATE INDEX "idx_tasks_created_by" ON "public"."tasks" USING "btree" ("created_by");



CREATE INDEX "idx_tasks_due_date" ON "public"."tasks" USING "btree" ("company_id", "due_date") WHERE (("deleted_at" IS NULL) AND ("due_date" IS NOT NULL));



CREATE INDEX "idx_tasks_error_state" ON "public"."tasks" USING "btree" ("company_id", "error_state") WHERE ("error_state" IS NOT NULL);



CREATE INDEX "idx_tasks_manager_id" ON "public"."tasks" USING "btree" ("manager_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_tasks_parent_id" ON "public"."tasks" USING "btree" ("parent_task_id");



CREATE INDEX "idx_tasks_pipeline_id" ON "public"."tasks" USING "btree" ("pipeline_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_tasks_project_id" ON "public"."tasks" USING "btree" ("project_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_tasks_search_tsv" ON "public"."tasks" USING "gin" ("search_tsv");



CREATE INDEX "idx_tasks_stage_id" ON "public"."tasks" USING "btree" ("current_stage_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_tasks_status" ON "public"."tasks" USING "btree" ("status");



CREATE INDEX "idx_tasks_title_trgm" ON "public"."tasks" USING "gin" ("title" "public"."gin_trgm_ops");



CREATE INDEX "idx_tasks_weight" ON "public"."tasks" USING "btree" ("company_id", "weight" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_tav_company" ON "public"."task_attachment_versions" USING "btree" ("company_id");



CREATE INDEX "idx_tav_superseded" ON "public"."task_attachment_versions" USING "btree" ("superseded_at") WHERE ("superseded_at" IS NOT NULL);



CREATE INDEX "idx_team_members_active" ON "public"."team_members" USING "btree" ("team_id", "user_id") WHERE ("removed_at" IS NULL);



CREATE INDEX "idx_team_members_company_id" ON "public"."team_members" USING "btree" ("company_id");



CREATE INDEX "idx_team_members_team_id" ON "public"."team_members" USING "btree" ("team_id");



CREATE INDEX "idx_team_members_user_id" ON "public"."team_members" USING "btree" ("user_id");



CREATE INDEX "idx_team_roles_company_id" ON "public"."team_roles" USING "btree" ("company_id");



CREATE INDEX "idx_team_roles_role_id" ON "public"."team_roles" USING "btree" ("role_id");



CREATE INDEX "idx_team_roles_team_id" ON "public"."team_roles" USING "btree" ("team_id");



CREATE INDEX "idx_teams_company_id" ON "public"."teams" USING "btree" ("company_id");



CREATE INDEX "idx_teams_is_active" ON "public"."teams" USING "btree" ("company_id", "is_active") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_teams_parent_id" ON "public"."teams" USING "btree" ("parent_id") WHERE ("parent_id" IS NOT NULL);



CREATE INDEX "idx_tsv_company" ON "public"."task_submission_versions" USING "btree" ("company_id");



CREATE INDEX "idx_tsv_superseded" ON "public"."task_submission_versions" USING "btree" ("superseded_at") WHERE ("superseded_at" IS NOT NULL);



CREATE INDEX "idx_user_roles_active" ON "public"."user_roles" USING "btree" ("user_id", "company_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "idx_user_roles_company_id" ON "public"."user_roles" USING "btree" ("company_id");



CREATE INDEX "idx_user_roles_role_id" ON "public"."user_roles" USING "btree" ("role_id");



CREATE INDEX "idx_user_roles_user_id" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_users_company_id" ON "public"."users" USING "btree" ("company_id");



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE INDEX "idx_users_full_name_trgm" ON "public"."users" USING "gin" ("full_name" "public"."gin_trgm_ops");



CREATE INDEX "idx_users_is_active" ON "public"."users" USING "btree" ("company_id", "is_active") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_work_sessions_task_stage" ON "public"."task_work_sessions" USING "btree" ("task_id", "stage_id");



CREATE INDEX "pipeline_assignment_pool_pipeline_idx" ON "public"."pipeline_assignment_pool" USING "btree" ("pipeline_id");



CREATE UNIQUE INDEX "pipeline_assignment_pool_team_uq" ON "public"."pipeline_assignment_pool" USING "btree" ("pipeline_id", "member_team_id") WHERE ("member_team_id" IS NOT NULL);



CREATE UNIQUE INDEX "pipeline_assignment_pool_user_uq" ON "public"."pipeline_assignment_pool" USING "btree" ("pipeline_id", "member_user_id") WHERE ("member_user_id" IS NOT NULL);



CREATE INDEX "rate_limit_buckets_window_idx" ON "public"."rate_limit_buckets" USING "btree" ("window_start");



CREATE INDEX "task_assignments_assignee_recent_idx" ON "public"."task_assignments" USING "btree" ("assignee_user_id", "assigned_at" DESC);



CREATE INDEX "tasks_current_stage_id_idx" ON "public"."tasks" USING "btree" ("current_stage_id");



CREATE UNIQUE INDEX "waitlist_signups_email_key" ON "public"."waitlist_signups" USING "btree" ("lower"("email"));



CREATE INDEX "waitlist_signups_ip_created_idx" ON "public"."waitlist_signups" USING "btree" ("ip_hash", "created_at");



CREATE UNIQUE INDEX "waitlist_signups_referral_code_key" ON "public"."waitlist_signups" USING "btree" ("referral_code");



CREATE INDEX "waitlist_signups_referred_by_idx" ON "public"."waitlist_signups" USING "btree" ("referred_by_id");



CREATE OR REPLACE TRIGGER "enforce_member_limit" BEFORE UPDATE OF "company_id" ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."_enforce_member_limit"();



CREATE OR REPLACE TRIGGER "enforce_pipeline_limit" BEFORE INSERT ON "public"."pipelines" FOR EACH ROW EXECUTE FUNCTION "public"."_enforce_pipeline_limit"();



CREATE OR REPLACE TRIGGER "filehub_storage_tracker" AFTER INSERT OR DELETE OR UPDATE OF "size_bytes", "deleted_at" ON "public"."filehub_files" FOR EACH ROW EXECUTE FUNCTION "public"."_filehub_storage_tracker"();



CREATE OR REPLACE TRIGGER "rate_limit_pipeline_create" BEFORE INSERT ON "public"."pipelines" FOR EACH ROW EXECUTE FUNCTION "public"."_rate_limit_pipeline_create"();



CREATE OR REPLACE TRIGGER "set_task_comments_updated_at" BEFORE UPDATE ON "public"."task_comments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "tg_tasks_set_updated_at" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "tr_auto_stop_timer" AFTER UPDATE OF "current_stage_id" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auto_stop_timers_on_transition"();



CREATE OR REPLACE TRIGGER "tr_generate_company_join_code" BEFORE INSERT ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."tr_generate_company_join_code"();



CREATE OR REPLACE TRIGGER "tr_update_archive_search_vector" BEFORE INSERT OR UPDATE ON "public"."archives" FOR EACH ROW EXECUTE FUNCTION "public"."fn_update_archive_search_vector"();



CREATE OR REPLACE TRIGGER "tr_validate_reporting_line" BEFORE INSERT OR UPDATE OF "reports_to" ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."fn_tr_validate_reporting_line"();



CREATE OR REPLACE TRIGGER "trg_auto_notification_preferences" AFTER INSERT ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auto_create_notification_preferences"();



CREATE OR REPLACE TRIGGER "trg_backfill_session_duration" BEFORE UPDATE ON "public"."task_work_sessions" FOR EACH ROW WHEN ((("old"."status" = 'active'::"text") AND ("new"."status" = 'completed'::"text") AND (COALESCE("new"."total_seconds_spent", 0) <= 0))) EXECUTE FUNCTION "public"."fn_backfill_session_duration"();



CREATE OR REPLACE TRIGGER "trg_companies_updated_at" BEFORE UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_dispatch_notification_event" AFTER INSERT ON "public"."notification_events" FOR EACH ROW EXECUTE FUNCTION "public"."fn_trg_dispatch_notification_event"();



CREATE OR REPLACE TRIGGER "trg_filehub_files_search_tsv" BEFORE INSERT OR UPDATE OF "original_name", "caption", "tags" ON "public"."filehub_files" FOR EACH ROW EXECUTE FUNCTION "public"."filehub_files_search_tsv_update"();



CREATE OR REPLACE TRIGGER "trg_filehub_link_task_file" BEFORE INSERT ON "public"."submission_attachments" FOR EACH ROW EXECUTE FUNCTION "public"."filehub_link_task_file"();



CREATE OR REPLACE TRIGGER "trg_filehub_link_task_file" BEFORE INSERT ON "public"."task_attachments" FOR EACH ROW EXECUTE FUNCTION "public"."filehub_link_task_file"();



CREATE OR REPLACE TRIGGER "trg_filehub_sync_attachment_delete" AFTER UPDATE OF "deleted_at" ON "public"."task_attachments" FOR EACH ROW EXECUTE FUNCTION "public"."filehub_sync_task_attachment_delete"();



CREATE OR REPLACE TRIGGER "trg_filehub_sync_submission_delete" AFTER UPDATE OF "deleted_at", "current_version_id" ON "public"."task_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."filehub_sync_submission_delete"();



CREATE OR REPLACE TRIGGER "trg_import_connections_updated_at" BEFORE UPDATE ON "public"."import_connections" FOR EACH ROW EXECUTE FUNCTION "public"."set_import_connections_updated_at"();



CREATE OR REPLACE TRIGGER "trg_pipeline_stage_actions_updated_at" BEFORE UPDATE ON "public"."pipeline_stage_actions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_pipelines_updated_at" BEFORE UPDATE ON "public"."pipelines" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_reporting_jobs_search_tsv" BEFORE INSERT OR UPDATE OF "report_type", "parameters" ON "public"."reporting_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."reporting_jobs_search_tsv_update"();



CREATE OR REPLACE TRIGGER "trg_roles_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sync_stage_submission_mode" BEFORE INSERT OR UPDATE OF "submission_mode", "requires_submission" ON "public"."pipeline_stages" FOR EACH ROW EXECUTE FUNCTION "public"."sync_stage_submission_mode"();



CREATE OR REPLACE TRIGGER "trg_task_assignments_notify" AFTER INSERT ON "public"."task_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."fn_trg_task_assignments_notify"();



CREATE OR REPLACE TRIGGER "trg_task_comments_notify" AFTER INSERT ON "public"."task_comments" FOR EACH ROW EXECUTE FUNCTION "public"."fn_trg_task_comments_notify"();



CREATE OR REPLACE TRIGGER "trg_task_comments_search_tsv" BEFORE INSERT OR UPDATE OF "content" ON "public"."task_comments" FOR EACH ROW EXECUTE FUNCTION "public"."task_comments_search_tsv_update"();



CREATE OR REPLACE TRIGGER "trg_task_submissions_updated_at" BEFORE UPDATE ON "public"."task_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tasks_notify_insert" AFTER INSERT ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_trg_tasks_notify_insert"();



CREATE OR REPLACE TRIGGER "trg_tasks_notify_update" AFTER UPDATE OF "current_stage_id", "status" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_trg_tasks_notify_update"();



CREATE OR REPLACE TRIGGER "trg_tasks_recursive_delete" BEFORE DELETE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_recursive_child_tasks"();



CREATE OR REPLACE TRIGGER "trg_tasks_recursive_sync" AFTER UPDATE OF "description", "priority" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."sync_recursive_child_tasks"();



CREATE OR REPLACE TRIGGER "trg_tasks_search_tsv" BEFORE INSERT OR UPDATE OF "title", "description", "category" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."tasks_search_tsv_update"();



CREATE OR REPLACE TRIGGER "trg_tasks_sync_status" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW WHEN (("new"."current_stage_id" IS DISTINCT FROM "old"."current_stage_id")) EXECUTE FUNCTION "public"."sync_task_status_from_stage"();



CREATE OR REPLACE TRIGGER "trg_teams_updated_at" BEFORE UPDATE ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."analytics_snapshots"
    ADD CONSTRAINT "analytics_snapshots_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."archives"
    ADD CONSTRAINT "archives_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."archives"
    ADD CONSTRAINT "archives_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."archives"
    ADD CONSTRAINT "archives_restored_by_fkey" FOREIGN KEY ("restored_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."automation_execution_log"
    ADD CONSTRAINT "automation_execution_log_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."pipeline_automations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_execution_log"
    ADD CONSTRAINT "automation_execution_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_execution_log"
    ADD CONSTRAINT "automation_execution_log_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_execution_log"
    ADD CONSTRAINT "automation_execution_log_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_billing"
    ADD CONSTRAINT "company_billing_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_billing"
    ADD CONSTRAINT "company_billing_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "public"."billing_plans"("code");



ALTER TABLE ONLY "public"."company_ping_sounds"
    ADD CONSTRAINT "company_ping_sounds_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_ping_sounds"
    ADD CONSTRAINT "company_ping_sounds_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_retention_settings"
    ADD CONSTRAINT "company_retention_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_retention_settings"
    ADD CONSTRAINT "company_retention_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."entity_watchers"
    ADD CONSTRAINT "entity_watchers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_activity"
    ADD CONSTRAINT "filehub_activity_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_activity"
    ADD CONSTRAINT "filehub_activity_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."filehub_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_activity"
    ADD CONSTRAINT "filehub_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_file_versions"
    ADD CONSTRAINT "filehub_file_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."filehub_file_versions"
    ADD CONSTRAINT "filehub_file_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filehub_file_versions"
    ADD CONSTRAINT "filehub_file_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."filehub_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_files"
    ADD CONSTRAINT "filehub_files_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_files"
    ADD CONSTRAINT "filehub_files_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "public"."filehub_file_versions"("id");



ALTER TABLE ONLY "public"."filehub_files"
    ADD CONSTRAINT "filehub_files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."filehub_folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filehub_files"
    ADD CONSTRAINT "filehub_files_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."filehub_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filehub_files"
    ADD CONSTRAINT "filehub_files_replaces_file_id_fkey" FOREIGN KEY ("replaces_file_id") REFERENCES "public"."filehub_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filehub_files"
    ADD CONSTRAINT "filehub_files_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_files"
    ADD CONSTRAINT "filehub_files_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filehub_files"
    ADD CONSTRAINT "filehub_files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filehub_folders"
    ADD CONSTRAINT "filehub_folders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_folders"
    ADD CONSTRAINT "filehub_folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filehub_folders"
    ADD CONSTRAINT "filehub_folders_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."filehub_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_folders"
    ADD CONSTRAINT "filehub_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."filehub_folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_group_members"
    ADD CONSTRAINT "filehub_group_members_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filehub_group_members"
    ADD CONSTRAINT "filehub_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."filehub_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_group_members"
    ADD CONSTRAINT "filehub_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_groups"
    ADD CONSTRAINT "filehub_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_groups"
    ADD CONSTRAINT "filehub_groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filehub_recipients"
    ADD CONSTRAINT "filehub_recipients_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."filehub_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_recipients"
    ADD CONSTRAINT "filehub_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_seen"
    ADD CONSTRAINT "filehub_seen_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."filehub_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_seen"
    ADD CONSTRAINT "filehub_seen_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_share_links"
    ADD CONSTRAINT "filehub_share_links_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_share_links"
    ADD CONSTRAINT "filehub_share_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."filehub_share_links"
    ADD CONSTRAINT "filehub_share_links_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."filehub_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."filehub_share_links"
    ADD CONSTRAINT "filehub_share_links_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."filehub_folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "fk_projects_pipeline_id" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_connections"
    ADD CONSTRAINT "import_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_events"
    ADD CONSTRAINT "notification_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_rules"
    ADD CONSTRAINT "notification_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_assignment_pool"
    ADD CONSTRAINT "pipeline_assignment_pool_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_assignment_pool"
    ADD CONSTRAINT "pipeline_assignment_pool_member_team_id_fkey" FOREIGN KEY ("member_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_assignment_pool"
    ADD CONSTRAINT "pipeline_assignment_pool_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_assignment_pool"
    ADD CONSTRAINT "pipeline_assignment_pool_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_automation_params"
    ADD CONSTRAINT "pipeline_automation_params_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."pipeline_automations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_automations"
    ADD CONSTRAINT "pipeline_automations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_automations"
    ADD CONSTRAINT "pipeline_automations_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_automations"
    ADD CONSTRAINT "pipeline_automations_source_stage_id_fkey" FOREIGN KEY ("source_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_automations"
    ADD CONSTRAINT "pipeline_automations_target_stage_id_fkey" FOREIGN KEY ("target_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_linked_outcomes"
    ADD CONSTRAINT "pipeline_linked_outcomes_child_terminal_stage_id_fkey" FOREIGN KEY ("child_terminal_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_linked_outcomes"
    ADD CONSTRAINT "pipeline_linked_outcomes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_linked_outcomes"
    ADD CONSTRAINT "pipeline_linked_outcomes_parent_stage_id_fkey" FOREIGN KEY ("parent_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_linked_outcomes"
    ADD CONSTRAINT "pipeline_linked_outcomes_parent_target_stage_id_fkey" FOREIGN KEY ("parent_target_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_stage_actions"
    ADD CONSTRAINT "pipeline_stage_actions_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_stage_actions"
    ADD CONSTRAINT "pipeline_stage_actions_transition_id_fkey" FOREIGN KEY ("transition_id") REFERENCES "public"."pipeline_stage_transitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_stage_history"
    ADD CONSTRAINT "pipeline_stage_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_stage_history"
    ADD CONSTRAINT "pipeline_stage_history_from_stage_id_fkey" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pipeline_stage_history"
    ADD CONSTRAINT "pipeline_stage_history_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pipeline_stage_history"
    ADD CONSTRAINT "pipeline_stage_history_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."task_submissions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pipeline_stage_history"
    ADD CONSTRAINT "pipeline_stage_history_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_stage_history"
    ADD CONSTRAINT "pipeline_stage_history_to_stage_id_fkey" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pipeline_stage_history"
    ADD CONSTRAINT "pipeline_stage_history_transitioned_by_fkey" FOREIGN KEY ("transitioned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pipeline_stage_targets"
    ADD CONSTRAINT "pipeline_stage_targets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."pipeline_stage_targets"
    ADD CONSTRAINT "pipeline_stage_targets_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_stage_transitions"
    ADD CONSTRAINT "pipeline_stage_transitions_from_stage_id_fkey" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_stage_transitions"
    ADD CONSTRAINT "pipeline_stage_transitions_required_permission_fkey" FOREIGN KEY ("required_permission") REFERENCES "public"."permissions"("key") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pipeline_stage_transitions"
    ADD CONSTRAINT "pipeline_stage_transitions_to_stage_id_fkey" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_stages"
    ADD CONSTRAINT "pipeline_stages_linked_pipeline_id_fkey" FOREIGN KEY ("linked_pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pipeline_stages"
    ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipelines"
    ADD CONSTRAINT "pipelines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipelines"
    ADD CONSTRAINT "pipelines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rate_limit_buckets"
    ADD CONSTRAINT "rate_limit_buckets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reporting_jobs"
    ADD CONSTRAINT "reporting_jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reporting_jobs"
    ADD CONSTRAINT "reporting_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."retention_warnings"
    ADD CONSTRAINT "retention_warnings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."storage_archive_queue"
    ADD CONSTRAINT "storage_archive_queue_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."submission_attachments"
    ADD CONSTRAINT "submission_attachments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_attachments"
    ADD CONSTRAINT "submission_attachments_filehub_file_id_fkey" FOREIGN KEY ("filehub_file_id") REFERENCES "public"."filehub_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submission_attachments"
    ADD CONSTRAINT "submission_attachments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."task_submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_attachments"
    ADD CONSTRAINT "submission_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submission_attachments"
    ADD CONSTRAINT "submission_attachments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "public"."task_submission_versions"("id");



ALTER TABLE ONLY "public"."task_assignments"
    ADD CONSTRAINT "task_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_assignments"
    ADD CONSTRAINT "task_assignments_assignee_team_id_fkey" FOREIGN KEY ("assignee_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_assignments"
    ADD CONSTRAINT "task_assignments_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_assignments"
    ADD CONSTRAINT "task_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_assignments"
    ADD CONSTRAINT "task_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_attachment_versions"
    ADD CONSTRAINT "task_attachment_versions_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "public"."task_attachments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_attachment_versions"
    ADD CONSTRAINT "task_attachment_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "public"."task_attachment_versions"("id");



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_filehub_file_id_fkey" FOREIGN KEY ("filehub_file_id") REFERENCES "public"."filehub_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."task_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_manual_time_entries"
    ADD CONSTRAINT "task_manual_time_entries_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."task_manual_time_entries"
    ADD CONSTRAINT "task_manual_time_entries_pending_transition_id_fkey" FOREIGN KEY ("pending_transition_id") REFERENCES "public"."pipeline_stage_transitions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_manual_time_entries"
    ADD CONSTRAINT "task_manual_time_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."task_work_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_manual_time_entries"
    ADD CONSTRAINT "task_manual_time_entries_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_manual_time_entries"
    ADD CONSTRAINT "task_manual_time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_manual_time_entries"
    ADD CONSTRAINT "task_manual_time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_mention_acks"
    ADD CONSTRAINT "task_mention_acks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_mention_acks"
    ADD CONSTRAINT "task_mention_acks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_mention_acks"
    ADD CONSTRAINT "task_mention_acks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_ping_targets"
    ADD CONSTRAINT "task_ping_targets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_ping_targets"
    ADD CONSTRAINT "task_ping_targets_pinged_by_fkey" FOREIGN KEY ("pinged_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_ping_targets"
    ADD CONSTRAINT "task_ping_targets_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_ping_targets"
    ADD CONSTRAINT "task_ping_targets_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_submission_versions"
    ADD CONSTRAINT "task_submission_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."task_submission_versions"
    ADD CONSTRAINT "task_submission_versions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."task_submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_submissions"
    ADD CONSTRAINT "task_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."task_assignments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_submissions"
    ADD CONSTRAINT "task_submissions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_submissions"
    ADD CONSTRAINT "task_submissions_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "public"."task_submission_versions"("id");



ALTER TABLE ONLY "public"."task_submissions"
    ADD CONSTRAINT "task_submissions_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."task_submissions"
    ADD CONSTRAINT "task_submissions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_submissions"
    ADD CONSTRAINT "task_submissions_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_submissions"
    ADD CONSTRAINT "task_submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_submissions"
    ADD CONSTRAINT "task_submissions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_submissions"
    ADD CONSTRAINT "task_submissions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."task_work_sessions"
    ADD CONSTRAINT "task_work_sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."task_work_sessions"
    ADD CONSTRAINT "task_work_sessions_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_work_sessions"
    ADD CONSTRAINT "task_work_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_work_sessions"
    ADD CONSTRAINT "task_work_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_current_stage_id_fkey" FOREIGN KEY ("current_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_visibility_permission_fkey" FOREIGN KEY ("visibility_permission") REFERENCES "public"."permissions"("key");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_roles"
    ADD CONSTRAINT "team_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_roles"
    ADD CONSTRAINT "team_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."team_roles"
    ADD CONSTRAINT "team_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_roles"
    ADD CONSTRAINT "team_roles_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_parent_team_id_fkey" FOREIGN KEY ("parent_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."trial_code_redemptions"
    ADD CONSTRAINT "trial_code_redemptions_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "public"."trial_codes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trial_code_redemptions"
    ADD CONSTRAINT "trial_code_redemptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trial_codes"
    ADD CONSTRAINT "trial_codes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."trial_codes"
    ADD CONSTRAINT "trial_codes_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "public"."billing_plans"("code");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_reports_to_fkey" FOREIGN KEY ("reports_to") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."waitlist_signups"
    ADD CONSTRAINT "waitlist_signups_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "public"."waitlist_signups"("id") ON DELETE SET NULL;



CREATE POLICY "Archives are viewable by company members" ON "public"."archives" FOR SELECT USING (("company_id" IN ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Archives can be created by company members" ON "public"."archives" FOR INSERT WITH CHECK (("company_id" IN ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "AssignmentPool: select by company" ON "public"."pipeline_assignment_pool" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "Managers see all manual time entries in company" ON "public"."task_manual_time_entries" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND "public"."has_permission"('task.manage'::"text")));



CREATE POLICY "Owners/Admins can manage teams" ON "public"."teams" USING ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('team.manage'::"text")))) WITH CHECK ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('team.manage'::"text"))));



CREATE POLICY "Users can delete archives of their company" ON "public"."archives" FOR DELETE USING (("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can insert archives for their company" ON "public"."archives" FOR INSERT WITH CHECK (("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can insert into their company's storage queue" ON "public"."storage_archive_queue" FOR INSERT WITH CHECK (("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can insert ping sounds" ON "public"."company_ping_sounds" FOR INSERT TO "authenticated" WITH CHECK ((("company_id" = "public"."my_company_id"()) AND ("public"."has_permission"('task.ping'::"text") OR "public"."has_permission"('admin:notifications'::"text"))));



CREATE POLICY "Users can update ping sounds" ON "public"."company_ping_sounds" FOR UPDATE TO "authenticated" USING (("company_id" = "public"."my_company_id"())) WITH CHECK (("public"."has_permission"('task.ping'::"text") OR "public"."has_permission"('admin:notifications'::"text")));



CREATE POLICY "Users can upsert their own acks" ON "public"."task_mention_acks" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view activity log" ON "public"."activity_log" FOR SELECT TO "authenticated" USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "Users can view archives of their company" ON "public"."archives" FOR SELECT USING (("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can view company ping sounds" ON "public"."company_ping_sounds" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view team memberships in their company" ON "public"."team_members" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "team_members"."team_id") AND ("t"."company_id" = "public"."my_company_id"())))));



CREATE POLICY "Users can view teams in their company" ON "public"."teams" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "Users can view their company's storage queue" ON "public"."storage_archive_queue" FOR SELECT USING (("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can view their own acks" ON "public"."task_mention_acks" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own work sessions" ON "public"."task_work_sessions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users see own manual time entries" ON "public"."task_manual_time_entries" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users see own ping targets" ON "public"."task_ping_targets" FOR SELECT TO "authenticated" USING (("target_user_id" = "auth"."uid"()));



ALTER TABLE "public"."activity_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_events_select_same_company" ON "public"."activity_events" FOR SELECT USING (("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."activity_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."analytics_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."archives" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auto_log_select" ON "public"."automation_execution_log" FOR SELECT USING (true);



ALTER TABLE "public"."automation_execution_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_events_read" ON "public"."billing_events" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



ALTER TABLE "public"."billing_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_plans_read" ON "public"."billing_plans" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "companies_select_own" ON "public"."companies" FOR SELECT USING (("id" = "public"."my_company_id"()));



CREATE POLICY "companies_update_owner" ON "public"."companies" FOR UPDATE USING ((("id" = "public"."my_company_id"()) AND (( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true)));



ALTER TABLE "public"."company_billing" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_billing_read" ON "public"."company_billing" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



ALTER TABLE "public"."company_ping_sounds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_retention_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entity_watchers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "entity_watchers: own rows delete" ON "public"."entity_watchers" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "entity_watchers: own rows insert" ON "public"."entity_watchers" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "entity_watchers: own rows select" ON "public"."entity_watchers" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."filehub_activity" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "filehub_activity_select" ON "public"."filehub_activity" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND "public"."has_permission"('filehub:view'::"text")));



ALTER TABLE "public"."filehub_file_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."filehub_files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "filehub_files_select_visibility" ON "public"."filehub_files" FOR SELECT USING ((("deleted_at" IS NULL) AND ("company_id" = "public"."my_company_id"()) AND (("uploaded_by" = "auth"."uid"()) OR ("visibility" = 'broadcast'::"text") OR (("visibility" = 'direct'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."filehub_recipients" "r"
  WHERE (("r"."file_id" = "filehub_files"."id") AND ("r"."user_id" = "auth"."uid"()))))) OR (("visibility" = 'group'::"text") AND ("group_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."filehub_group_members" "gm"
  WHERE (("gm"."group_id" = "filehub_files"."group_id") AND ("gm"."user_id" = "auth"."uid"()))))) OR (("visibility" = 'task'::"text") AND ("task_id" IS NOT NULL) AND "public"."task_accessible"("task_id")))));



ALTER TABLE "public"."filehub_folders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "filehub_folders_select_company" ON "public"."filehub_folders" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND ("deleted_at" IS NULL)));



ALTER TABLE "public"."filehub_group_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "filehub_group_members_select" ON "public"."filehub_group_members" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."filehub_group_members" "gm2"
  WHERE (("gm2"."group_id" = "filehub_group_members"."group_id") AND ("gm2"."user_id" = "auth"."uid"())))) OR (("public"."has_permission"('filehub:group_override'::"text") OR "public"."has_permission"('filehub:group_override_manage'::"text")) AND (EXISTS ( SELECT 1
   FROM "public"."filehub_groups" "g"
  WHERE (("g"."id" = "filehub_group_members"."group_id") AND ("g"."company_id" = "public"."my_company_id"())))))));



ALTER TABLE "public"."filehub_groups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "filehub_groups_select_members" ON "public"."filehub_groups" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."filehub_group_members" "gm"
  WHERE (("gm"."group_id" = "filehub_groups"."id") AND ("gm"."user_id" = "auth"."uid"())))) OR (("company_id" = "public"."my_company_id"()) AND ("public"."has_permission"('filehub:group_override'::"text") OR "public"."has_permission"('filehub:group_override_manage'::"text")))));



ALTER TABLE "public"."filehub_recipients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "filehub_recipients_select_own_or_sender" ON "public"."filehub_recipients" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."filehub_files" "f"
  WHERE (("f"."id" = "filehub_recipients"."file_id") AND ("f"."uploaded_by" = "auth"."uid"()))))));



ALTER TABLE "public"."filehub_seen" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "filehub_seen_select_own" ON "public"."filehub_seen" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."filehub_share_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "filehub_share_links_select_own" ON "public"."filehub_share_links" FOR SELECT USING (("created_by" = "auth"."uid"()));



CREATE POLICY "filehub_versions_select" ON "public"."filehub_file_versions" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND "public"."has_permission"('filehub:view'::"text")));



ALTER TABLE "public"."import_connections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "import_connections_own_delete" ON "public"."import_connections" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "import_connections_own_insert" ON "public"."import_connections" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "import_connections_own_select" ON "public"."import_connections" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "import_connections_own_update" ON "public"."import_connections" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_insert" ON "public"."invitations" FOR INSERT WITH CHECK ((("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('user:invite'::"text"))));



CREATE POLICY "invitations_select_same_company" ON "public"."invitations" FOR SELECT USING ((("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('user:invite'::"text"))));



CREATE POLICY "invitations_update" ON "public"."invitations" FOR UPDATE USING ((("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('user:invite'::"text"))));



CREATE POLICY "linked_outcomes_modify" ON "public"."pipeline_linked_outcomes" USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "linked_outcomes_select" ON "public"."pipeline_linked_outcomes" FOR SELECT USING (("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."notification_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_preferences: own row select" ON "public"."notification_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "notification_preferences: own row update" ON "public"."notification_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."notification_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_rules: authenticated read" ON "public"."notification_rules" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "notification_rules: manage_notifications delete" ON "public"."notification_rules" FOR DELETE USING ("public"."fn_has_permission"('manage_notifications'::"text"));



CREATE POLICY "notification_rules: manage_notifications insert" ON "public"."notification_rules" FOR INSERT WITH CHECK ("public"."fn_has_permission"('manage_notifications'::"text"));



CREATE POLICY "notification_rules: manage_notifications update" ON "public"."notification_rules" FOR UPDATE USING ("public"."fn_has_permission"('manage_notifications'::"text"));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications: own rows select" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permissions_select_authenticated" ON "public"."permissions" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."pipeline_assignment_pool" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pipeline_automation_params" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pipeline_automation_params_delete" ON "public"."pipeline_automation_params" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."pipeline_automations" "a"
  WHERE (("a"."id" = "pipeline_automation_params"."automation_id") AND ("a"."company_id" = "public"."my_company_id"())))));



CREATE POLICY "pipeline_automation_params_insert" ON "public"."pipeline_automation_params" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."pipeline_automations" "a"
  WHERE (("a"."id" = "pipeline_automation_params"."automation_id") AND ("a"."company_id" = "public"."my_company_id"())))));



CREATE POLICY "pipeline_automation_params_select" ON "public"."pipeline_automation_params" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."pipeline_automations" "a"
  WHERE (("a"."id" = "pipeline_automation_params"."automation_id") AND ("a"."company_id" = "public"."my_company_id"())))));



CREATE POLICY "pipeline_automation_params_update" ON "public"."pipeline_automation_params" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."pipeline_automations" "a"
  WHERE (("a"."id" = "pipeline_automation_params"."automation_id") AND ("a"."company_id" = "public"."my_company_id"())))));



ALTER TABLE "public"."pipeline_automations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pipeline_automations_delete" ON "public"."pipeline_automations" FOR DELETE USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "pipeline_automations_insert" ON "public"."pipeline_automations" FOR INSERT WITH CHECK (("company_id" = "public"."my_company_id"()));



CREATE POLICY "pipeline_automations_select" ON "public"."pipeline_automations" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "pipeline_automations_update" ON "public"."pipeline_automations" FOR UPDATE USING (("company_id" = "public"."my_company_id"()));



ALTER TABLE "public"."pipeline_linked_outcomes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pipeline_stage_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pipeline_stage_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pipeline_stage_targets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pipeline_stage_targets_delete" ON "public"."pipeline_stage_targets" FOR DELETE USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "pipeline_stage_targets_insert" ON "public"."pipeline_stage_targets" FOR INSERT WITH CHECK (("company_id" = "public"."my_company_id"()));



CREATE POLICY "pipeline_stage_targets_select" ON "public"."pipeline_stage_targets" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "pipeline_stage_targets_update" ON "public"."pipeline_stage_targets" FOR UPDATE USING (("company_id" = "public"."my_company_id"()));



ALTER TABLE "public"."pipeline_stage_transitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pipeline_stages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pipeline_stages_delete" ON "public"."pipeline_stages" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."pipelines" "p"
  WHERE (("p"."id" = "pipeline_stages"."pipeline_id") AND ("p"."company_id" = "public"."my_company_id"())))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('pipeline.edit'::"text"))));



CREATE POLICY "pipeline_stages_insert" ON "public"."pipeline_stages" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."pipelines" "p"
  WHERE (("p"."id" = "pipeline_stages"."pipeline_id") AND ("p"."company_id" = "public"."my_company_id"())))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('pipeline.edit'::"text"))));



CREATE POLICY "pipeline_stages_select" ON "public"."pipeline_stages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."pipelines" "p"
  WHERE (("p"."id" = "pipeline_stages"."pipeline_id") AND ("p"."company_id" = "public"."my_company_id"()) AND ("p"."deleted_at" IS NULL)))));



CREATE POLICY "pipeline_stages_update" ON "public"."pipeline_stages" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."pipelines" "p"
  WHERE (("p"."id" = "pipeline_stages"."pipeline_id") AND ("p"."company_id" = "public"."my_company_id"())))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('pipeline.edit'::"text"))));



CREATE POLICY "pipeline_transitions_delete" ON "public"."pipeline_stage_transitions" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM ("public"."pipeline_stages" "ps"
     JOIN "public"."pipelines" "p" ON (("p"."id" = "ps"."pipeline_id")))
  WHERE (("ps"."id" = "pipeline_stage_transitions"."from_stage_id") AND ("p"."company_id" = "public"."my_company_id"())))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('pipeline.edit'::"text"))));



CREATE POLICY "pipeline_transitions_insert" ON "public"."pipeline_stage_transitions" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM ("public"."pipeline_stages" "ps"
     JOIN "public"."pipelines" "p" ON (("p"."id" = "ps"."pipeline_id")))
  WHERE (("ps"."id" = "pipeline_stage_transitions"."from_stage_id") AND ("p"."company_id" = "public"."my_company_id"())))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('pipeline.edit'::"text"))));



CREATE POLICY "pipeline_transitions_select" ON "public"."pipeline_stage_transitions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."pipeline_stages" "ps"
     JOIN "public"."pipelines" "p" ON (("p"."id" = "ps"."pipeline_id")))
  WHERE (("ps"."id" = "pipeline_stage_transitions"."from_stage_id") AND ("p"."company_id" = "public"."my_company_id"()) AND ("p"."deleted_at" IS NULL)))));



ALTER TABLE "public"."pipelines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pipelines_insert" ON "public"."pipelines" FOR INSERT WITH CHECK ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('pipeline.create'::"text"))));



CREATE POLICY "pipelines_select" ON "public"."pipelines" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND ("deleted_at" IS NULL) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('system.view_all_data'::"text") OR ("visibility_permissions" = '{}'::"text"[]) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."company_id" = "public"."my_company_id"()) AND ("ur"."revoked_at" IS NULL) AND (("ur"."role_id")::"text" = ANY ("pipelines"."visibility_permissions"))))))));



CREATE POLICY "pipelines_update" ON "public"."pipelines" FOR UPDATE USING ((("company_id" = "public"."my_company_id"()) AND ("deleted_at" IS NULL) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('pipeline.edit'::"text"))));



ALTER TABLE "public"."platform_admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_insert" ON "public"."projects" FOR INSERT WITH CHECK ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('project.create'::"text"))));



CREATE POLICY "projects_select" ON "public"."projects" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND ("deleted_at" IS NULL)));



CREATE POLICY "projects_update" ON "public"."projects" FOR UPDATE USING ((("company_id" = "public"."my_company_id"()) AND ("deleted_at" IS NULL) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('project.edit'::"text"))));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_subscriptions: own rows select" ON "public"."push_subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "read_own_or_permitted_snapshots" ON "public"."analytics_snapshots" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND ((("snapshot_type" = 'user_performance'::"text") AND ("subject_id" = "auth"."uid"())) OR "public"."has_permission"('analytics.view'::"text"))));



ALTER TABLE "public"."reporting_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reporting_jobs_insert_own_company" ON "public"."reporting_jobs" FOR INSERT TO "authenticated" WITH CHECK ((("company_id" = "public"."my_company_id"()) AND ("requested_by" = "auth"."uid"())));



CREATE POLICY "reporting_jobs_select_own_company" ON "public"."reporting_jobs" FOR SELECT TO "authenticated" USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "reporting_jobs_update_own" ON "public"."reporting_jobs" FOR UPDATE TO "authenticated" USING (("requested_by" = "auth"."uid"()));



CREATE POLICY "ret_settings_read" ON "public"."company_retention_settings" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "ret_warnings_read" ON "public"."retention_warnings" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



ALTER TABLE "public"."retention_warnings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_permissions_delete" ON "public"."role_permissions" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."roles" "r"
  WHERE (("r"."id" = "role_permissions"."role_id") AND ("r"."company_id" = ( SELECT "users"."company_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))) AND ("r"."is_system" = false) AND ("r"."deleted_at" IS NULL)))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('company:settings'::"text"))));



CREATE POLICY "role_permissions_insert" ON "public"."role_permissions" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."roles" "r"
  WHERE (("r"."id" = "role_permissions"."role_id") AND ("r"."company_id" = ( SELECT "users"."company_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))) AND ("r"."is_system" = false) AND ("r"."deleted_at" IS NULL)))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('company:settings'::"text"))));



CREATE POLICY "role_permissions_select" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."roles" "r"
  WHERE (("r"."id" = "role_permissions"."role_id") AND (("r"."company_id" IS NULL) OR ("r"."company_id" = ( SELECT "users"."company_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"())))) AND ("r"."deleted_at" IS NULL)))));



ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_insert" ON "public"."roles" FOR INSERT WITH CHECK ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('company.settings'::"text"))));



CREATE POLICY "roles_select" ON "public"."roles" FOR SELECT USING ((("deleted_at" IS NULL) AND (("company_id" IS NULL) OR ("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))))));



CREATE POLICY "roles_select_same_company" ON "public"."roles" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND ("deleted_at" IS NULL)));



CREATE POLICY "roles_update" ON "public"."roles" FOR UPDATE USING ((("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND ("is_system" = false) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('company:settings'::"text"))));



CREATE POLICY "stage_actions_admin" ON "public"."pipeline_stage_actions" USING (((EXISTS ( SELECT 1
   FROM ("public"."pipeline_stages" "ps"
     JOIN "public"."pipelines" "p" ON (("p"."id" = "ps"."pipeline_id")))
  WHERE (("ps"."id" = "pipeline_stage_actions"."stage_id") AND ("p"."company_id" = "public"."my_company_id"())))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('pipeline.edit'::"text")))) WITH CHECK (((EXISTS ( SELECT 1
   FROM ("public"."pipeline_stages" "ps"
     JOIN "public"."pipelines" "p" ON (("p"."id" = "ps"."pipeline_id")))
  WHERE (("ps"."id" = "pipeline_stage_actions"."stage_id") AND ("p"."company_id" = "public"."my_company_id"())))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('pipeline.edit'::"text"))));



CREATE POLICY "stage_actions_select" ON "public"."pipeline_stage_actions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."pipeline_stages" "ps"
     JOIN "public"."pipelines" "p" ON (("p"."id" = "ps"."pipeline_id")))
  WHERE (("ps"."id" = "pipeline_stage_actions"."stage_id") AND ("p"."company_id" = "public"."my_company_id"())))));



CREATE POLICY "stage_history_select" ON "public"."pipeline_stage_history" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



ALTER TABLE "public"."storage_archive_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submission_attachments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "submission_attachments_select" ON "public"."submission_attachments" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND (("uploaded_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."task_submissions" "ts"
  WHERE (("ts"."id" = "submission_attachments"."submission_id") AND "public"."fn_task_file_accessible"("ts"."task_id")))))));



CREATE POLICY "task_assign_insert_permitted" ON "public"."task_assignments" FOR INSERT TO "authenticated" WITH CHECK (("company_id" = "public"."my_company_id"()));



CREATE POLICY "task_assign_select_permitted" ON "public"."task_assignments" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



ALTER TABLE "public"."task_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_attachment_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_attachment_versions_select" ON "public"."task_attachment_versions" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



ALTER TABLE "public"."task_attachments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_attachments_insert" ON "public"."task_attachments" FOR INSERT WITH CHECK ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('task.edit'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."task_assignments"
  WHERE (("task_assignments"."task_id" = "task_attachments"."task_id") AND ("task_assignments"."assignee_user_id" = "auth"."uid"())))))));



CREATE POLICY "task_attachments_recursive_read" ON "public"."task_attachments" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND (EXISTS ( SELECT 1
   FROM ("public"."tasks" "t"
     JOIN "public"."task_assignments" "ta" ON (("ta"."task_id" = "t"."id")))
  WHERE (("t"."parent_task_id" = "task_attachments"."task_id") AND ("ta"."assignee_user_id" = "auth"."uid"()))))));



CREATE POLICY "task_attachments_select" ON "public"."task_attachments" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND (("uploaded_by" = "auth"."uid"()) OR "public"."fn_task_file_accessible"("task_id"))));



ALTER TABLE "public"."task_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_comments_delete" ON "public"."task_comments" FOR DELETE USING ((("company_id" = "public"."my_company_id"()) AND (("author_id" = "auth"."uid"()) OR (( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true))));



CREATE POLICY "task_comments_insert" ON "public"."task_comments" FOR INSERT WITH CHECK ((("company_id" = "public"."my_company_id"()) AND ("author_id" = "auth"."uid"())));



CREATE POLICY "task_comments_select" ON "public"."task_comments" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND ("deleted_at" IS NULL)));



CREATE POLICY "task_comments_update" ON "public"."task_comments" FOR UPDATE USING ((("author_id" = "auth"."uid"()) AND ("company_id" = "public"."my_company_id"())));



ALTER TABLE "public"."task_manual_time_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_mention_acks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_ping_targets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_submission_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_submission_versions_select" ON "public"."task_submission_versions" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND (EXISTS ( SELECT 1
   FROM "public"."task_submissions" "ts"
  WHERE (("ts"."id" = "task_submission_versions"."submission_id") AND (("ts"."submitted_by" = "auth"."uid"()) OR "public"."has_permission"('submission.review'::"text") OR (( SELECT "users"."is_owner"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"())) = true)))))));



ALTER TABLE "public"."task_submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_submissions_recursive_read" ON "public"."task_submissions" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND (EXISTS ( SELECT 1
   FROM ("public"."tasks" "t"
     JOIN "public"."task_assignments" "ta" ON (("ta"."task_id" = "t"."id")))
  WHERE (("t"."parent_task_id" = "task_submissions"."task_id") AND ("ta"."assignee_user_id" = "auth"."uid"()))))));



CREATE POLICY "task_submissions_select" ON "public"."task_submissions" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND (("submitted_by" = "auth"."uid"()) OR "public"."has_permission"('submission.review'::"text") OR (( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true))));



ALTER TABLE "public"."task_work_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_work_sessions_delete" ON "public"."task_work_sessions" FOR DELETE USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "task_work_sessions_insert" ON "public"."task_work_sessions" FOR INSERT WITH CHECK (("company_id" = "public"."my_company_id"()));



CREATE POLICY "task_work_sessions_select" ON "public"."task_work_sessions" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



CREATE POLICY "task_work_sessions_update" ON "public"."task_work_sessions" FOR UPDATE USING (("company_id" = "public"."my_company_id"()));



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_select_visibility" ON "public"."tasks" FOR SELECT TO "authenticated" USING ((("company_id" = "public"."my_company_id"()) AND ("public"."has_permission"('system.view_all_data'::"text") OR (( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR (EXISTS ( SELECT 1
   FROM "public"."pipelines" "p"
  WHERE (("p"."id" = "tasks"."pipeline_id") AND ("public"."has_permission"('task.view_all'::"text") OR "public"."has_permission"('tasks.view_all'::"text") OR ("p"."task_visibility_mode" = 'all'::"text") OR (("p"."task_visibility_mode" = 'assigned_only'::"text") AND (("tasks"."created_by" = "auth"."uid"()) OR ("tasks"."manager_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."task_assignments" "ta"
          WHERE (("ta"."task_id" = "tasks"."id") AND (("ta"."assignee_user_id" = "auth"."uid"()) OR ("ta"."assignee_team_id" IN ( SELECT "team_members"."team_id"
                   FROM "public"."team_members"
                  WHERE (("team_members"."user_id" = "auth"."uid"()) AND ("team_members"."removed_at" IS NULL)))))))))))))) OR (("pipeline_id" IS NULL) AND (("created_by" = "auth"."uid"()) OR ("manager_id" = "auth"."uid"()) OR "public"."has_permission"('task.view_all'::"text") OR "public"."has_permission"('tasks.view_all'::"text"))))));



CREATE POLICY "tasks_update_editable" ON "public"."tasks" FOR UPDATE TO "authenticated" USING ((("company_id" = "public"."my_company_id"()) AND (COALESCE(( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())), false) OR ("created_by" = "auth"."uid"()) OR ("manager_id" = "auth"."uid"()) OR "public"."has_permission"('task.edit'::"text")))) WITH CHECK ((("company_id" = "public"."my_company_id"()) AND (COALESCE(( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())), false) OR ("created_by" = "auth"."uid"()) OR ("manager_id" = "auth"."uid"()) OR "public"."has_permission"('task.edit'::"text"))));



ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_members_insert" ON "public"."team_members" FOR INSERT WITH CHECK ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('team.manage_members'::"text"))));



CREATE POLICY "team_members_select_same_company" ON "public"."team_members" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND ("removed_at" IS NULL)));



CREATE POLICY "team_members_update" ON "public"."team_members" FOR UPDATE USING ((("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('team:manage_members'::"text"))));



ALTER TABLE "public"."team_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_roles_delete" ON "public"."team_roles" FOR DELETE USING ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('role.manage'::"text"))));



CREATE POLICY "team_roles_insert" ON "public"."team_roles" FOR INSERT WITH CHECK ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('role.manage'::"text"))));



CREATE POLICY "team_roles_select_same_company" ON "public"."team_roles" FOR SELECT USING (("company_id" = "public"."my_company_id"()));



ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teams_insert" ON "public"."teams" FOR INSERT WITH CHECK ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('team.create'::"text"))));



CREATE POLICY "teams_select_same_company" ON "public"."teams" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND ("deleted_at" IS NULL)));



CREATE POLICY "teams_update" ON "public"."teams" FOR UPDATE USING ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('team.edit'::"text"))));



ALTER TABLE "public"."trial_code_redemptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trial_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_roles_insert" ON "public"."user_roles" FOR INSERT WITH CHECK ((("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('user:edit'::"text"))));



CREATE POLICY "user_roles_select_same_company" ON "public"."user_roles" FOR SELECT USING (("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "user_roles_update" ON "public"."user_roles" FOR UPDATE USING ((("company_id" = ( SELECT "users"."company_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND ((( SELECT "users"."is_owner"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('user:edit'::"text"))));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_select_same_company" ON "public"."users" FOR SELECT USING ((("company_id" = "public"."my_company_id"()) AND ("deleted_at" IS NULL)));



CREATE POLICY "users_select_self" ON "public"."users" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "users_update_admin" ON "public"."users" FOR UPDATE USING ((("company_id" = "public"."my_company_id"()) AND ((( SELECT "users_1"."is_owner"
   FROM "public"."users" "users_1"
  WHERE ("users_1"."id" = "auth"."uid"())) = true) OR "public"."has_permission"('user.edit'::"text"))));



CREATE POLICY "users_update_self" ON "public"."users" FOR UPDATE USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."waitlist_signups" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."_can_manage_billing"() TO "anon";
GRANT ALL ON FUNCTION "public"."_can_manage_billing"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_can_manage_billing"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_can_manage_retention"() TO "anon";
GRANT ALL ON FUNCTION "public"."_can_manage_retention"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_can_manage_retention"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_company_file_size_limit"("p_company_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_company_file_size_limit"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_company_file_size_limit"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_company_member_limit"("p_company_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_company_member_limit"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_company_member_limit"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_company_pipeline_limit"("p_company_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_company_pipeline_limit"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_company_pipeline_limit"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_company_storage_limit"("p_company_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_company_storage_limit"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_company_storage_limit"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_enforce_member_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."_enforce_member_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_enforce_member_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_enforce_pipeline_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."_enforce_pipeline_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_enforce_pipeline_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_filehub_storage_tracker"() TO "anon";
GRANT ALL ON FUNCTION "public"."_filehub_storage_tracker"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_filehub_storage_tracker"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."_internal_restore_task_archive"("p_archive_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_internal_restore_task_archive"("p_archive_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_is_platform_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_is_platform_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_rate_limit"("p_action" "text", "p_max" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."_rate_limit"("p_action" "text", "p_max" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_rate_limit"("p_action" "text", "p_max" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."_rate_limit_pipeline_create"() TO "anon";
GRANT ALL ON FUNCTION "public"."_rate_limit_pipeline_create"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_rate_limit_pipeline_create"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_recursive_child_tasks"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_recursive_child_tasks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_recursive_child_tasks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."file_mime_class"("p_mime" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."file_mime_class"("p_mime" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."file_mime_class"("p_mime" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."filehub_dedupe_name"("p_name" "text", "p_visibility" "text", "p_group_id" "uuid", "p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."filehub_dedupe_name"("p_name" "text", "p_visibility" "text", "p_group_id" "uuid", "p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."filehub_dedupe_name"("p_name" "text", "p_visibility" "text", "p_group_id" "uuid", "p_folder_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."filehub_file_accessible"("p_file_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."filehub_file_accessible"("p_file_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."filehub_file_accessible"("p_file_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."filehub_files_search_tsv_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."filehub_files_search_tsv_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."filehub_files_search_tsv_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."filehub_link_task_file"() TO "anon";
GRANT ALL ON FUNCTION "public"."filehub_link_task_file"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."filehub_link_task_file"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."filehub_sync_submission_delete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."filehub_sync_submission_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."filehub_sync_task_attachment_delete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."filehub_sync_task_attachment_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_auto_create_notification_preferences"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_auto_create_notification_preferences"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_auto_create_notification_preferences"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_auto_stop_timers_on_transition"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_auto_stop_timers_on_transition"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_auto_stop_timers_on_transition"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_backfill_session_duration"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_backfill_session_duration"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_backfill_session_duration"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_calculate_business_duration"("p_start" timestamp with time zone, "p_end" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_calculate_business_duration"("p_start" timestamp with time zone, "p_end" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_calculate_business_duration"("p_start" timestamp with time zone, "p_end" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_check_all_reporting_cycles"("p_user_id" "uuid", "p_new_reports_to" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_check_all_reporting_cycles"("p_user_id" "uuid", "p_new_reports_to" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_check_all_reporting_cycles"("p_user_id" "uuid", "p_new_reports_to" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_check_overdue_tasks"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_check_overdue_tasks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_check_overdue_tasks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_emit_notification_event"("p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_actor_id" "uuid", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_emit_notification_event"("p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_actor_id" "uuid", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_emit_notification_event"("p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_actor_id" "uuid", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_flush_all_pipeline_snapshots"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_flush_all_pipeline_snapshots"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_flush_all_pipeline_snapshots"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_flush_all_user_snapshots"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_flush_all_user_snapshots"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_flush_all_user_snapshots"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_generate_join_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_generate_join_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_generate_join_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_handle_task_handshake"("p_child_task_id" "uuid", "p_terminal_stage_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_handle_task_handshake"("p_child_task_id" "uuid", "p_terminal_stage_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_handle_task_handshake"("p_child_task_id" "uuid", "p_terminal_stage_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_has_permission"("p_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_has_permission"("p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_has_permission"("p_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_invoke_filehub_orphan_sweep"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_invoke_filehub_orphan_sweep"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_invoke_filehub_orphan_sweep"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_invoke_purge_filehub_bin"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_invoke_purge_filehub_bin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_invoke_purge_filehub_bin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_invoke_purge_filehub_versions"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_invoke_purge_filehub_versions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_invoke_purge_filehub_versions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_pick_assignee"("p_pipeline_id" "uuid", "p_exclude_task_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_pick_assignee"("p_pipeline_id" "uuid", "p_exclude_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_pick_assignee"("p_pipeline_id" "uuid", "p_exclude_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_pick_assignee"("p_pipeline_id" "uuid", "p_exclude_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_resolve_effective_manager"("p_user_id" "uuid", "p_current_depth" integer, "p_max_depth" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_resolve_effective_manager"("p_user_id" "uuid", "p_current_depth" integer, "p_max_depth" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_resolve_effective_manager"("p_user_id" "uuid", "p_current_depth" integer, "p_max_depth" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_simulate_report_processing"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_simulate_report_processing"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_simulate_report_processing"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_sweep_pending_notification_events"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sweep_pending_notification_events"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sweep_pending_notification_events"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_sweep_stale_work_sessions"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sweep_stale_work_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sweep_stale_work_sessions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_task_file_accessible"("p_task_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_task_file_accessible"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_task_file_accessible"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_tr_validate_reporting_line"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_tr_validate_reporting_line"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_tr_validate_reporting_line"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_trg_dispatch_notification_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_trg_dispatch_notification_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_trg_dispatch_notification_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_trg_task_assignments_notify"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_trg_task_assignments_notify"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_trg_task_assignments_notify"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_trg_task_comments_notify"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_trg_task_comments_notify"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_trg_task_comments_notify"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_trg_tasks_notify_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_trg_tasks_notify_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_trg_tasks_notify_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_trg_tasks_notify_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_trg_tasks_notify_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_trg_tasks_notify_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_update_archive_search_vector"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_update_archive_search_vector"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_update_archive_search_vector"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_user_has_permission"("p_user_id" "uuid", "p_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_user_has_permission"("p_user_id" "uuid", "p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_user_has_permission"("p_user_id" "uuid", "p_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_permissions"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_permissions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_permissions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_roles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_server_time"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_server_time"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_server_time"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_permission"("permission_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_permission"("permission_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permission"("permission_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."internal_stop_task_sessions"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."internal_stop_task_sessions"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."internal_stop_task_sessions"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_in_my_scope"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_in_my_scope"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_in_my_scope"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_event"("p_company_id" "uuid", "p_user_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_event_type" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_event"("p_company_id" "uuid", "p_user_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_event_type" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_event"("p_company_id" "uuid", "p_user_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_event_type" "text", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."my_company_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."my_company_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_company_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reporting_jobs_search_tsv_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."reporting_jobs_search_tsv_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reporting_jobs_search_tsv_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_add_stage"("p_pipeline_id" "uuid", "p_name" "text", "p_color" "text", "p_description" "text", "p_is_initial" boolean, "p_is_terminal" boolean, "p_terminal_type" "text", "p_requires_submission" boolean, "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_ui_metadata" "jsonb", "p_min_timer_seconds" integer, "p_submission_mode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_add_stage"("p_pipeline_id" "uuid", "p_name" "text", "p_color" "text", "p_description" "text", "p_is_initial" boolean, "p_is_terminal" boolean, "p_terminal_type" "text", "p_requires_submission" boolean, "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_ui_metadata" "jsonb", "p_min_timer_seconds" integer, "p_submission_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_add_stage"("p_pipeline_id" "uuid", "p_name" "text", "p_color" "text", "p_description" "text", "p_is_initial" boolean, "p_is_terminal" boolean, "p_terminal_type" "text", "p_requires_submission" boolean, "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_ui_metadata" "jsonb", "p_min_timer_seconds" integer, "p_submission_mode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_add_stage_action"("p_stage_id" "uuid", "p_action_type" "text", "p_label" "text", "p_icon" "text", "p_style" "text", "p_required_role" "text", "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_precondition" "text", "p_transition_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_add_stage_action"("p_stage_id" "uuid", "p_action_type" "text", "p_label" "text", "p_icon" "text", "p_style" "text", "p_required_role" "text", "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_precondition" "text", "p_transition_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_add_stage_action"("p_stage_id" "uuid", "p_action_type" "text", "p_label" "text", "p_icon" "text", "p_style" "text", "p_required_role" "text", "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_precondition" "text", "p_transition_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_add_task_attachments"("p_task_id" "uuid", "p_attachments" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_add_task_attachments"("p_task_id" "uuid", "p_attachments" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_add_task_attachments"("p_task_id" "uuid", "p_attachments" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_add_task_comment"("p_task_id" "uuid", "p_content" "text", "p_parent_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_add_task_comment"("p_task_id" "uuid", "p_content" "text", "p_parent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_add_task_comment"("p_task_id" "uuid", "p_content" "text", "p_parent_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_add_transition"("p_from_stage_id" "uuid", "p_to_stage_id" "uuid", "p_label" "text", "p_required_permission" "text", "p_transition_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_add_transition"("p_from_stage_id" "uuid", "p_to_stage_id" "uuid", "p_label" "text", "p_required_permission" "text", "p_transition_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_add_transition"("p_from_stage_id" "uuid", "p_to_stage_id" "uuid", "p_label" "text", "p_required_permission" "text", "p_transition_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_advance_stage"("p_task_id" "uuid", "p_to_stage_id" "uuid", "p_submission_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_advance_stage"("p_task_id" "uuid", "p_to_stage_id" "uuid", "p_submission_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_advance_stage"("p_task_id" "uuid", "p_to_stage_id" "uuid", "p_submission_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_am_i_platform_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_am_i_platform_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_am_i_platform_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_archive_project"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_archive_project"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_archive_project"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_archive_task"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_archive_task"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_archive_task"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_assign_task"("p_task_id" "uuid", "p_target_user_id" "uuid", "p_target_team_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_assign_task"("p_task_id" "uuid", "p_target_user_id" "uuid", "p_target_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_assign_task"("p_task_id" "uuid", "p_target_user_id" "uuid", "p_target_team_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_assign_team_roles"("p_team_id" "uuid", "p_role_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_assign_team_roles"("p_team_id" "uuid", "p_role_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_assign_team_roles"("p_team_id" "uuid", "p_role_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_assign_user_roles"("p_user_id" "uuid", "p_role_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_assign_user_roles"("p_user_id" "uuid", "p_role_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_assign_user_roles"("p_user_id" "uuid", "p_role_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_assign_user_teams"("p_user_id" "uuid", "p_team_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_assign_user_teams"("p_user_id" "uuid", "p_team_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_assign_user_teams"("p_user_id" "uuid", "p_team_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_auto_assign_task"("p_task_id" "uuid", "p_mode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_auto_assign_task"("p_task_id" "uuid", "p_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_auto_assign_task"("p_task_id" "uuid", "p_mode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_billing_overview"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_billing_overview"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_billing_overview"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_check_plan_limit"("p_resource" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_check_plan_limit"("p_resource" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_check_plan_limit"("p_resource" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_claim_pending_invitation"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_claim_pending_invitation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_claim_pending_invitation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_claim_task"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_claim_task"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_claim_task"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_compare_personnel"("p_user_ids" "uuid"[], "p_from" "date", "p_to" "date", "p_salaries" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_compare_personnel"("p_user_ids" "uuid"[], "p_from" "date", "p_to" "date", "p_salaries" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_compare_personnel"("p_user_ids" "uuid"[], "p_from" "date", "p_to" "date", "p_salaries" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_complete_onboarding"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_complete_onboarding"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_complete_onboarding"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_create_automation"("p_pipeline_id" "uuid", "p_source_stage_id" "uuid", "p_target_stage_id" "uuid", "p_condition_type" "text", "p_check_interval_minutes" integer, "p_priority" integer, "p_params" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_automation"("p_pipeline_id" "uuid", "p_source_stage_id" "uuid", "p_target_stage_id" "uuid", "p_condition_type" "text", "p_check_interval_minutes" integer, "p_priority" integer, "p_params" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_automation"("p_pipeline_id" "uuid", "p_source_stage_id" "uuid", "p_target_stage_id" "uuid", "p_condition_type" "text", "p_check_interval_minutes" integer, "p_priority" integer, "p_params" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_create_company_and_link"("p_company_name" "text", "p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_company_and_link"("p_company_name" "text", "p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_company_and_link"("p_company_name" "text", "p_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_create_notification_rule"("p_name" "text", "p_description" "text", "p_event_type" "text", "p_conditions" "jsonb", "p_recipient_strategies" "text"[], "p_recipient_config" "jsonb", "p_channels_override" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_notification_rule"("p_name" "text", "p_description" "text", "p_event_type" "text", "p_conditions" "jsonb", "p_recipient_strategies" "text"[], "p_recipient_config" "jsonb", "p_channels_override" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_notification_rule"("p_name" "text", "p_description" "text", "p_event_type" "text", "p_conditions" "jsonb", "p_recipient_strategies" "text"[], "p_recipient_config" "jsonb", "p_channels_override" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_create_pipeline"("p_name" "text", "p_description" "text", "p_stages" "jsonb", "p_transitions" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_pipeline"("p_name" "text", "p_description" "text", "p_stages" "jsonb", "p_transitions" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_pipeline"("p_name" "text", "p_description" "text", "p_stages" "jsonb", "p_transitions" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_create_pipeline"("p_name" "text", "p_description" "text", "p_stages" "jsonb", "p_transitions" "jsonb", "p_visibility_permissions" "text"[], "p_task_visibility_mode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_pipeline"("p_name" "text", "p_description" "text", "p_stages" "jsonb", "p_transitions" "jsonb", "p_visibility_permissions" "text"[], "p_task_visibility_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_pipeline"("p_name" "text", "p_description" "text", "p_stages" "jsonb", "p_transitions" "jsonb", "p_visibility_permissions" "text"[], "p_task_visibility_mode" "text") TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_create_project"("p_name" "text", "p_color" "text", "p_description" "text", "p_expiry_date" timestamp with time zone, "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_project"("p_name" "text", "p_color" "text", "p_description" "text", "p_expiry_date" timestamp with time zone, "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_project"("p_name" "text", "p_color" "text", "p_description" "text", "p_expiry_date" timestamp with time zone, "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_create_role"("p_name" "text", "p_description" "text", "p_color" "text", "p_permissions" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_role"("p_name" "text", "p_description" "text", "p_color" "text", "p_permissions" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_role"("p_name" "text", "p_description" "text", "p_color" "text", "p_permissions" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_create_task"("p_title" "text", "p_description" "text", "p_priority" "text", "p_due_date" timestamp with time zone, "p_pipeline_id" "uuid", "p_project_id" "uuid", "p_manager_id" "uuid", "p_category" "text", "p_weight" bigint, "p_visibility_permission" "text", "p_start_date" timestamp with time zone, "p_estimated_hours" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_task"("p_title" "text", "p_description" "text", "p_priority" "text", "p_due_date" timestamp with time zone, "p_pipeline_id" "uuid", "p_project_id" "uuid", "p_manager_id" "uuid", "p_category" "text", "p_weight" bigint, "p_visibility_permission" "text", "p_start_date" timestamp with time zone, "p_estimated_hours" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_task"("p_title" "text", "p_description" "text", "p_priority" "text", "p_due_date" timestamp with time zone, "p_pipeline_id" "uuid", "p_project_id" "uuid", "p_manager_id" "uuid", "p_category" "text", "p_weight" bigint, "p_visibility_permission" "text", "p_start_date" timestamp with time zone, "p_estimated_hours" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_create_team"("p_name" "text", "p_description" "text", "p_color" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_team"("p_name" "text", "p_description" "text", "p_color" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_team"("p_name" "text", "p_description" "text", "p_color" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_delete_automation"("p_automation_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_automation"("p_automation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_automation"("p_automation_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_delete_company"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_company"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_company"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_delete_linked_outcome"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_linked_outcome"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_linked_outcome"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_delete_notification_rule"("p_rule_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_notification_rule"("p_rule_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_notification_rule"("p_rule_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_delete_pipeline"("p_pipeline_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_pipeline"("p_pipeline_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_pipeline"("p_pipeline_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_delete_stage"("p_stage_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_stage"("p_stage_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_stage"("p_stage_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_delete_stage_action"("p_action_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_stage_action"("p_action_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_stage_action"("p_action_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_delete_submission"("p_submission_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_submission"("p_submission_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_submission"("p_submission_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_delete_task_attachment"("p_attachment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_task_attachment"("p_attachment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_task_attachment"("p_attachment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_delete_task_comment"("p_comment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_task_comment"("p_comment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_task_comment"("p_comment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_delete_transition"("p_transition_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_transition"("p_transition_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_transition"("p_transition_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_edit_submission"("p_submission_id" "uuid", "p_content" "text", "p_kept_attachment_ids" "uuid"[], "p_new_attachments" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_edit_submission"("p_submission_id" "uuid", "p_content" "text", "p_kept_attachment_ids" "uuid"[], "p_new_attachments" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_edit_submission"("p_submission_id" "uuid", "p_content" "text", "p_kept_attachment_ids" "uuid"[], "p_new_attachments" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_execute_stage_action"("p_task_id" "uuid", "p_action_id" "uuid", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_execute_stage_action"("p_task_id" "uuid", "p_action_id" "uuid", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_execute_stage_action"("p_task_id" "uuid", "p_action_id" "uuid", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_all_tags"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_all_tags"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_all_tags"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_analytics"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_analytics"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_analytics"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_analytics"("p_from" "date", "p_to" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_analytics"("p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_analytics"("p_from" "date", "p_to" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_bin_empty_authorize"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_bin_empty_authorize"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_bin_empty_authorize"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_bin_list"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_bin_list"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_bin_list"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_filehub_browse"("p_query" "text", "p_sources" "text"[], "p_project_id" "uuid", "p_category" "text", "p_type" "text", "p_before" timestamp with time zone, "p_limit" integer, "p_file_id" "uuid", "p_include_facets" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_filehub_browse"("p_query" "text", "p_sources" "text"[], "p_project_id" "uuid", "p_category" "text", "p_type" "text", "p_before" timestamp with time zone, "p_limit" integer, "p_file_id" "uuid", "p_include_facets" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_browse"("p_query" "text", "p_sources" "text"[], "p_project_id" "uuid", "p_category" "text", "p_type" "text", "p_before" timestamp with time zone, "p_limit" integer, "p_file_id" "uuid", "p_include_facets" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_check_duplicate"("p_content_hash" "text", "p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_check_duplicate"("p_content_hash" "text", "p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_check_duplicate"("p_content_hash" "text", "p_folder_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_check_name_conflict"("p_name" "text", "p_visibility" "text", "p_group_id" "uuid", "p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_check_name_conflict"("p_name" "text", "p_visibility" "text", "p_group_id" "uuid", "p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_check_name_conflict"("p_name" "text", "p_visibility" "text", "p_group_id" "uuid", "p_folder_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_delete"("p_file_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_delete"("p_file_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_delete"("p_file_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_delete_tag"("p_tag" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_delete_tag"("p_tag" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_delete_tag"("p_tag" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_file_activity"("p_file_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_file_activity"("p_file_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_file_activity"("p_file_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_file_move"("p_file_id" "uuid", "p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_file_move"("p_file_id" "uuid", "p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_file_move"("p_file_id" "uuid", "p_folder_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_file_versions"("p_file_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_file_versions"("p_file_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_file_versions"("p_file_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_create"("p_name" "text", "p_parent_id" "uuid", "p_scope" "text", "p_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_create"("p_name" "text", "p_parent_id" "uuid", "p_scope" "text", "p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_create"("p_name" "text", "p_parent_id" "uuid", "p_scope" "text", "p_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_delete"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_delete"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_delete"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_move"("p_id" "uuid", "p_new_parent_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_move"("p_id" "uuid", "p_new_parent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_move"("p_id" "uuid", "p_new_parent_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_rename"("p_id" "uuid", "p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_rename"("p_id" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_rename"("p_id" "uuid", "p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_restore"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_restore"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_restore"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_share_link_create"("p_folder_id" "uuid", "p_expires_in_hours" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_share_link_create"("p_folder_id" "uuid", "p_expires_in_hours" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_share_link_create"("p_folder_id" "uuid", "p_expires_in_hours" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_share_link_list"("p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_share_link_list"("p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_folder_share_link_list"("p_folder_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_group_add_member"("p_group_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_add_member"("p_group_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_add_member"("p_group_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_group_create"("p_name" "text", "p_description" "text", "p_avatar_color" "text", "p_member_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_create"("p_name" "text", "p_description" "text", "p_avatar_color" "text", "p_member_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_create"("p_name" "text", "p_description" "text", "p_avatar_color" "text", "p_member_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_group_delete"("p_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_delete"("p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_delete"("p_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_group_list"("p_override" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_list"("p_override" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_list"("p_override" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_group_list_files"("p_group_id" "uuid", "p_search" "text", "p_tag" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_list_files"("p_group_id" "uuid", "p_search" "text", "p_tag" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_list_files"("p_group_id" "uuid", "p_search" "text", "p_tag" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_group_members"("p_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_members"("p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_members"("p_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_group_remove_member"("p_group_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_remove_member"("p_group_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_remove_member"("p_group_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_group_rename"("p_group_id" "uuid", "p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_rename"("p_group_id" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_group_rename"("p_group_id" "uuid", "p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_list"("p_mode" "text", "p_search" "text", "p_folder_id" "uuid", "p_tag" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_list"("p_mode" "text", "p_search" "text", "p_folder_id" "uuid", "p_tag" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_list"("p_mode" "text", "p_search" "text", "p_folder_id" "uuid", "p_tag" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_log_activity"("p_file_id" "uuid", "p_action" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_log_activity"("p_file_id" "uuid", "p_action" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_log_activity"("p_file_id" "uuid", "p_action" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_filehub_log_activity_by_path"("p_bucket" "text", "p_storage_path" "text", "p_action" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_filehub_log_activity_by_path"("p_bucket" "text", "p_storage_path" "text", "p_action" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_log_activity_by_path"("p_bucket" "text", "p_storage_path" "text", "p_action" "text", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_mark_all_read"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_mark_all_read"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_mark_all_read"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_mark_read"("p_file_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_mark_read"("p_file_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_mark_read"("p_file_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_mark_scope_seen"("p_scope" "text", "p_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_mark_scope_seen"("p_scope" "text", "p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_mark_scope_seen"("p_scope" "text", "p_group_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_filehub_overview"("p_recent_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_filehub_overview"("p_recent_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_overview"("p_recent_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_pin_version"("p_version_id" "uuid", "p_pinned" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_pin_version"("p_version_id" "uuid", "p_pinned" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_pin_version"("p_version_id" "uuid", "p_pinned" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_filehub_pointer_id"("p_source" "text", "p_source_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_filehub_pointer_id"("p_source" "text", "p_source_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_pointer_id"("p_source" "text", "p_source_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_recipient_hide"("p_file_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_recipient_hide"("p_file_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_recipient_hide"("p_file_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_rename_tag"("p_old" "text", "p_new" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_rename_tag"("p_old" "text", "p_new" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_rename_tag"("p_old" "text", "p_new" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_replace_file"("p_target_id" "uuid", "p_storage_path" "text", "p_size_bytes" bigint, "p_content_hash" "text", "p_mime_type" "text", "p_caption" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_replace_file"("p_target_id" "uuid", "p_storage_path" "text", "p_size_bytes" bigint, "p_content_hash" "text", "p_mime_type" "text", "p_caption" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_replace_file"("p_target_id" "uuid", "p_storage_path" "text", "p_size_bytes" bigint, "p_content_hash" "text", "p_mime_type" "text", "p_caption" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_restore"("p_file_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_restore"("p_file_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_restore"("p_file_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_restore_version"("p_version_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_restore_version"("p_version_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_restore_version"("p_version_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_share_link_create"("p_file_id" "uuid", "p_expires_in_hours" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_share_link_create"("p_file_id" "uuid", "p_expires_in_hours" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_share_link_create"("p_file_id" "uuid", "p_expires_in_hours" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_share_link_list"("p_file_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_share_link_list"("p_file_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_share_link_list"("p_file_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_share_link_revoke"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_share_link_revoke"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_share_link_revoke"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_tag_suggestions"("p_prefix" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_tag_suggestions"("p_prefix" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_tag_suggestions"("p_prefix" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_unread_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_unread_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_unread_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_filehub_upload_commit"("p_storage_path" "text", "p_visibility" "text", "p_recipient_ids" "uuid"[], "p_folder_id" "uuid", "p_tags" "text"[], "p_caption" "text", "p_original_name" "text", "p_mime_type" "text", "p_size_bytes" bigint, "p_content_hash" "text", "p_replaces_file_id" "uuid", "p_group_id" "uuid", "p_rel_dir" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_filehub_upload_commit"("p_storage_path" "text", "p_visibility" "text", "p_recipient_ids" "uuid"[], "p_folder_id" "uuid", "p_tags" "text"[], "p_caption" "text", "p_original_name" "text", "p_mime_type" "text", "p_size_bytes" bigint, "p_content_hash" "text", "p_replaces_file_id" "uuid", "p_group_id" "uuid", "p_rel_dir" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_filehub_upload_commit"("p_storage_path" "text", "p_visibility" "text", "p_recipient_ids" "uuid"[], "p_folder_id" "uuid", "p_tags" "text"[], "p_caption" "text", "p_original_name" "text", "p_mime_type" "text", "p_size_bytes" bigint, "p_content_hash" "text", "p_replaces_file_id" "uuid", "p_group_id" "uuid", "p_rel_dir" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_files_search"("p_query" "text", "p_sources" "text"[], "p_task_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_files_search"("p_query" "text", "p_sources" "text"[], "p_task_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_files_search"("p_query" "text", "p_sources" "text"[], "p_task_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_flush_pipeline_hours_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_flush_pipeline_hours_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_flush_pipeline_hours_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_flush_pipeline_points_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_flush_pipeline_points_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_flush_pipeline_points_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_flush_pipeline_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_flush_pipeline_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_flush_pipeline_snapshot"("p_pipeline_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_flush_user_snapshot"("p_user_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_flush_user_snapshot"("p_user_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_flush_user_snapshot"("p_user_id" "uuid", "p_period_type" "text", "p_period_start" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_force_stop_session"("p_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_force_stop_session"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_force_stop_session"("p_session_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_generate_trial_code"("p_plan_code" "text", "p_duration_hours" integer, "p_max_redemptions" integer, "p_expires_at" timestamp with time zone, "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_generate_trial_code"("p_plan_code" "text", "p_duration_hours" integer, "p_max_redemptions" integer, "p_expires_at" timestamp with time zone, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_generate_trial_code"("p_plan_code" "text", "p_duration_hours" integer, "p_max_redemptions" integer, "p_expires_at" timestamp with time zone, "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_active_task_counts"("p_pipeline_id" "uuid", "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_active_task_counts"("p_pipeline_id" "uuid", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_active_task_counts"("p_pipeline_id" "uuid", "p_type" "text") TO "service_role";



GRANT ALL ON TABLE "public"."archives" TO "anon";
GRANT ALL ON TABLE "public"."archives" TO "authenticated";
GRANT ALL ON TABLE "public"."archives" TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_archives"("p_entity_type" "text", "p_search" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_archives"("p_entity_type" "text", "p_search" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_archives"("p_entity_type" "text", "p_search" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_invitation_by_email"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_invitation_by_email"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_invitation_by_email"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_my_pending_time_approvals"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_my_pending_time_approvals"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_my_pending_time_approvals"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_organizational_audit"("p_pipeline_id" "uuid", "p_days" integer, "p_team_id" "uuid", "p_worker_id" "uuid", "p_priority" "text", "p_project_id" "uuid", "p_date_start" timestamp with time zone, "p_date_end" timestamp with time zone, "p_auth_user_id" "uuid", "p_include_time_metrics" boolean, "p_include_advanced" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_organizational_audit"("p_pipeline_id" "uuid", "p_days" integer, "p_team_id" "uuid", "p_worker_id" "uuid", "p_priority" "text", "p_project_id" "uuid", "p_date_start" timestamp with time zone, "p_date_end" timestamp with time zone, "p_auth_user_id" "uuid", "p_include_time_metrics" boolean, "p_include_advanced" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_organizational_audit"("p_pipeline_id" "uuid", "p_days" integer, "p_team_id" "uuid", "p_worker_id" "uuid", "p_priority" "text", "p_project_id" "uuid", "p_date_start" timestamp with time zone, "p_date_end" timestamp with time zone, "p_auth_user_id" "uuid", "p_include_time_metrics" boolean, "p_include_advanced" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_personal_pulse"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_personal_pulse"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_personal_pulse"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_hours_series"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_hours_series"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_hours_series"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_members"("p_pipeline_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_members"("p_pipeline_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_members"("p_pipeline_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_points_range"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date", "p_buckets" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_points_range"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date", "p_buckets" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_points_range"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date", "p_buckets" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_points_series"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_points_series"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_points_series"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_stage_dwell"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_stage_dwell"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_stage_dwell"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_throughput"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_throughput"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_throughput"("p_pipeline_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_throughput_range"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date", "p_buckets" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_throughput_range"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date", "p_buckets" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_pipeline_throughput_range"("p_pipeline_id" "uuid", "p_from" "date", "p_to" "date", "p_buckets" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_project_stats"("p_project_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_project_stats"("p_project_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_project_stats"("p_project_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_projects"("p_include_archived" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_projects"("p_include_archived" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_projects"("p_include_archived" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_targets_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_targets_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_targets_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_task_details"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_task_details"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_task_details"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_user_company_history"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_user_company_history"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_user_company_history"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_user_performance_series"("p_user_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_user_performance_series"("p_user_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_user_performance_series"("p_user_id" "uuid", "p_period_type" "text", "p_n_periods" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_user_performance_series"("p_user_id" "uuid", "p_period_type" "text", "p_n_periods" integer, "p_company_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_user_performance_series"("p_user_id" "uuid", "p_period_type" "text", "p_n_periods" integer, "p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_user_performance_series"("p_user_id" "uuid", "p_period_type" "text", "p_n_periods" integer, "p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_user_performance_summary"("p_user_id" "uuid", "p_from" "date", "p_to" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_user_performance_summary"("p_user_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_user_performance_summary"("p_user_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_global_search"("p_terms" "text", "p_types" "text"[], "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_limit" integer, "p_date_field" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_global_search"("p_terms" "text", "p_types" "text"[], "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_limit" integer, "p_date_field" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_global_search"("p_terms" "text", "p_types" "text"[], "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_limit" integer, "p_date_field" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_heartbeat_work"("p_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_heartbeat_work"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_heartbeat_work"("p_session_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_import_place_task_stage"("p_task_id" "uuid", "p_stage_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_import_place_task_stage"("p_task_id" "uuid", "p_stage_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_import_place_task_stage"("p_task_id" "uuid", "p_stage_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_join_company_by_code"("p_join_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_join_company_by_code"("p_join_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_join_company_by_code"("p_join_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_leave_company"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_leave_company"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_leave_company"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_list_deleted_submissions"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_list_deleted_submissions"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_list_deleted_submissions"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_list_deleted_task_attachments"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_list_deleted_task_attachments"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_list_deleted_task_attachments"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_list_rule_deliveries"("p_event_type" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_list_rule_deliveries"("p_event_type" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_list_rule_deliveries"("p_event_type" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_list_trial_codes"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_list_trial_codes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_list_trial_codes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_log_manual_time"("p_task_id" "uuid", "p_stage_id" "uuid", "p_declared_minutes" integer, "p_reason" "text", "p_transition_id" "uuid", "p_worked_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_log_manual_time"("p_task_id" "uuid", "p_stage_id" "uuid", "p_declared_minutes" integer, "p_reason" "text", "p_transition_id" "uuid", "p_worked_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_log_manual_time"("p_task_id" "uuid", "p_stage_id" "uuid", "p_declared_minutes" integer, "p_reason" "text", "p_transition_id" "uuid", "p_worked_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_mark_all_notifications_read"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_mark_all_notifications_read"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_mark_all_notifications_read"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_mark_notification_read"("p_notification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_mark_notification_read"("p_notification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_mark_notification_read"("p_notification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_my_plan_limits"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_my_plan_limits"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_my_plan_limits"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_notify_timer_auto_stopped"("p_task_id" "uuid", "p_task_title" "text", "p_duration_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_notify_timer_auto_stopped"("p_task_id" "uuid", "p_task_title" "text", "p_duration_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_notify_timer_auto_stopped"("p_task_id" "uuid", "p_task_title" "text", "p_duration_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_notify_timer_auto_stopped"("p_task_id" "uuid", "p_task_title" "text", "p_duration_seconds" integer, "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_notify_timer_auto_stopped"("p_task_id" "uuid", "p_task_title" "text", "p_duration_seconds" integer, "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_notify_timer_auto_stopped"("p_task_id" "uuid", "p_task_title" "text", "p_duration_seconds" integer, "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_pause_work"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_pause_work"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_pause_work"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_ping_task"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_ping_task"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_ping_task"("p_task_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_pipeline_set_file_visibility"("p_pipeline_id" "uuid", "p_config" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_pipeline_set_file_visibility"("p_pipeline_id" "uuid", "p_config" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_pipeline_set_file_visibility"("p_pipeline_id" "uuid", "p_config" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_activity_timeline"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_activity_timeline"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_activity_timeline"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_admin_add"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_admin_add"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_admin_add"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_admin_remove"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_admin_remove"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_admin_remove"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_admins_list"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_admins_list"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_admins_list"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_companies_overview"("_dummy" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_companies_overview"("_dummy" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_companies_overview"("_dummy" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_company_detail"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_company_detail"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_company_detail"("p_company_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_company_retention"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_company_retention"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_company_retention"("p_company_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_delete_company"("p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_delete_company"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_delete_company"("p_company_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_delete_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_delete_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_delete_user"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_extend_retention"("p_company_id" "uuid", "p_inactivity_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_extend_retention"("p_company_id" "uuid", "p_inactivity_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_extend_retention"("p_company_id" "uuid", "p_inactivity_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_infra_metrics"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_infra_metrics"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_infra_metrics"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_list_billing_plans"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_list_billing_plans"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_list_billing_plans"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_live_sessions"("_dummy" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_live_sessions"("_dummy" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_live_sessions"("_dummy" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_move_user"("p_user_id" "uuid", "p_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_move_user"("p_user_id" "uuid", "p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_move_user"("p_user_id" "uuid", "p_company_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_search_users"("p_query" "text", "p_company_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_search_users"("p_query" "text", "p_company_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_search_users"("p_query" "text", "p_company_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_update_user"("p_user_id" "uuid", "p_full_name" "text", "p_display_name" "text", "p_phone" "text", "p_job_title" "text", "p_department" "text", "p_work_status" "text", "p_is_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_update_user"("p_user_id" "uuid", "p_full_name" "text", "p_display_name" "text", "p_phone" "text", "p_job_title" "text", "p_department" "text", "p_work_status" "text", "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_update_user"("p_user_id" "uuid", "p_full_name" "text", "p_display_name" "text", "p_phone" "text", "p_job_title" "text", "p_department" "text", "p_work_status" "text", "p_is_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_upsert_billing_plan"("p_code" "text", "p_name" "text", "p_description" "text", "p_price_cents" integer, "p_currency" "text", "p_interval" "text", "p_per_seat" boolean, "p_sort_order" integer, "p_is_active" boolean, "p_features" "jsonb", "p_limits" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_upsert_billing_plan"("p_code" "text", "p_name" "text", "p_description" "text", "p_price_cents" integer, "p_currency" "text", "p_interval" "text", "p_per_seat" boolean, "p_sort_order" integer, "p_is_active" boolean, "p_features" "jsonb", "p_limits" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_upsert_billing_plan"("p_code" "text", "p_name" "text", "p_description" "text", "p_price_cents" integer, "p_currency" "text", "p_interval" "text", "p_per_seat" boolean, "p_sort_order" integer, "p_is_active" boolean, "p_features" "jsonb", "p_limits" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_waitlist_list"("p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_waitlist_list"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_waitlist_list"("p_query" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_waitlist_overview"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_waitlist_overview"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_waitlist_overview"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_platform_waitlist_timeline"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_platform_waitlist_timeline"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_platform_waitlist_timeline"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_preview_task_assignee"("p_pipeline_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_preview_task_assignee"("p_pipeline_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_preview_task_assignee"("p_pipeline_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_process_automations"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_process_automations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_process_automations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_project_dashboard"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_project_dashboard"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_project_dashboard"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_public_plans"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_public_plans"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_public_plans"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_purge_archives"("p_archive_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_purge_archives"("p_archive_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_purge_archives"("p_archive_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_purge_company"("p_company_id" "uuid", "p_confirm_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_purge_company"("p_company_id" "uuid", "p_confirm_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_purge_company"("p_company_id" "uuid", "p_confirm_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_purge_user"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_purge_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_purge_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_redeem_trial_code"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_redeem_trial_code"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_redeem_trial_code"("p_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_remove_push_subscription"("p_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_remove_push_subscription"("p_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_remove_push_subscription"("p_device_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_remove_user_from_company"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_remove_user_from_company"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_remove_user_from_company"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_reorder_stage_actions"("p_stage_id" "uuid", "p_action_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_reorder_stage_actions"("p_stage_id" "uuid", "p_action_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_reorder_stage_actions"("p_stage_id" "uuid", "p_action_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_reorder_stages"("p_pipeline_id" "uuid", "p_stage_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_reorder_stages"("p_pipeline_id" "uuid", "p_stage_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_reorder_stages"("p_pipeline_id" "uuid", "p_stage_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_repair_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_repair_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_repair_profile"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_replace_task_attachment"("p_attachment_id" "uuid", "p_storage_path" "text", "p_file_name" "text", "p_file_size" bigint, "p_mime_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_replace_task_attachment"("p_attachment_id" "uuid", "p_storage_path" "text", "p_file_name" "text", "p_file_size" bigint, "p_mime_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_replace_task_attachment"("p_attachment_id" "uuid", "p_storage_path" "text", "p_file_name" "text", "p_file_size" bigint, "p_mime_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_request_billing_change"("p_plan_code" "text", "p_action" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_request_billing_change"("p_plan_code" "text", "p_action" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_request_billing_change"("p_plan_code" "text", "p_action" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_request_report"("p_report_type" "text", "p_parameters" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_request_report"("p_report_type" "text", "p_parameters" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_request_report"("p_report_type" "text", "p_parameters" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_resolve_handshake_deadlock"("p_parent_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_resolve_handshake_deadlock"("p_parent_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_resolve_handshake_deadlock"("p_parent_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_resolve_sub_task"("p_task_id" "uuid", "p_terminal_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_resolve_sub_task"("p_task_id" "uuid", "p_terminal_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_resolve_sub_task"("p_task_id" "uuid", "p_terminal_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_restore_archive"("p_archive_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_restore_archive"("p_archive_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_restore_archive"("p_archive_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_restore_project"("p_archive_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_restore_project"("p_archive_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_restore_project"("p_archive_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_restore_submission"("p_submission_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_restore_submission"("p_submission_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_restore_submission"("p_submission_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_restore_submission_version"("p_version_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_restore_submission_version"("p_version_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_restore_submission_version"("p_version_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_restore_task_attachment"("p_attachment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_restore_task_attachment"("p_attachment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_restore_task_attachment"("p_attachment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_restore_task_attachment_version"("p_version_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_restore_task_attachment_version"("p_version_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_restore_task_attachment_version"("p_version_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_resume_session"("p_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_resume_session"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_resume_session"("p_session_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_retention_overview"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_retention_overview"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_retention_overview"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_reverse_stage"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_reverse_stage"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_reverse_stage"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_review_by_transition"("p_task_id" "uuid", "p_transition_id" "uuid", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_review_by_transition"("p_task_id" "uuid", "p_transition_id" "uuid", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_review_by_transition"("p_task_id" "uuid", "p_transition_id" "uuid", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_review_manual_time"("p_entry_id" "uuid", "p_approve" boolean, "p_rejection_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_review_manual_time"("p_entry_id" "uuid", "p_approve" boolean, "p_rejection_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_review_manual_time"("p_entry_id" "uuid", "p_approve" boolean, "p_rejection_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_review_submission"("p_submission_id" "uuid", "p_decision" "text", "p_notes" "text", "p_advance_stage_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_review_submission"("p_submission_id" "uuid", "p_decision" "text", "p_notes" "text", "p_advance_stage_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_review_submission"("p_submission_id" "uuid", "p_decision" "text", "p_notes" "text", "p_advance_stage_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_revoke_trial_code"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_revoke_trial_code"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_revoke_trial_code"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_run_retention_warnings"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_run_retention_warnings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_run_retention_warnings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_search_users"("p_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_search_users"("p_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_search_users"("p_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_set_assignment_pool"("p_pipeline_id" "uuid", "p_member_type" "text", "p_member_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_set_assignment_pool"("p_pipeline_id" "uuid", "p_member_type" "text", "p_member_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_set_assignment_pool"("p_pipeline_id" "uuid", "p_member_type" "text", "p_member_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_set_pool_member_withdrawn"("p_pipeline_id" "uuid", "p_member_type" "text", "p_member_id" "uuid", "p_is_withdrawn" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_set_pool_member_withdrawn"("p_pipeline_id" "uuid", "p_member_type" "text", "p_member_id" "uuid", "p_is_withdrawn" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_set_pool_member_withdrawn"("p_pipeline_id" "uuid", "p_member_type" "text", "p_member_id" "uuid", "p_is_withdrawn" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_simulate_notification_rule"("p_rule_id" "uuid", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_simulate_notification_rule"("p_rule_id" "uuid", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_simulate_notification_rule"("p_rule_id" "uuid", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_start_work"("p_task_id" "uuid", "p_start_time" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_start_work"("p_task_id" "uuid", "p_start_time" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_start_work"("p_task_id" "uuid", "p_start_time" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_stop_work"("p_session_id" "uuid", "p_task_id" "uuid", "p_stopped_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_stop_work"("p_session_id" "uuid", "p_task_id" "uuid", "p_stopped_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_stop_work"("p_session_id" "uuid", "p_task_id" "uuid", "p_stopped_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_submission_versions"("p_submission_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_submission_versions"("p_submission_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_submission_versions"("p_submission_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_submit_work"("p_task_id" "uuid", "p_content" "text", "p_assignment_id" "uuid", "p_transition_id" "uuid", "p_attachments" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_submit_work"("p_task_id" "uuid", "p_content" "text", "p_assignment_id" "uuid", "p_transition_id" "uuid", "p_attachments" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_submit_work"("p_task_id" "uuid", "p_content" "text", "p_assignment_id" "uuid", "p_transition_id" "uuid", "p_attachments" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_task_attachment_versions"("p_attachment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_task_attachment_versions"("p_attachment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_task_attachment_versions"("p_attachment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_toggle_notification_rule"("p_rule_id" "uuid", "p_is_active" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_toggle_notification_rule"("p_rule_id" "uuid", "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_toggle_notification_rule"("p_rule_id" "uuid", "p_is_active" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_toggle_stage_feature"("p_stage_id" "uuid", "p_feature" "text", "p_is_enabled" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_toggle_stage_feature"("p_stage_id" "uuid", "p_feature" "text", "p_is_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_toggle_stage_feature"("p_stage_id" "uuid", "p_feature" "text", "p_is_enabled" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_toggle_watcher"("p_entity_type" "text", "p_entity_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_toggle_watcher"("p_entity_type" "text", "p_entity_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_toggle_watcher"("p_entity_type" "text", "p_entity_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_touch_last_seen"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_touch_last_seen"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_touch_last_seen"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_automation"("p_automation_id" "uuid", "p_condition_type" "text", "p_check_interval_minutes" integer, "p_priority" integer, "p_is_active" boolean, "p_params" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_automation"("p_automation_id" "uuid", "p_condition_type" "text", "p_check_interval_minutes" integer, "p_priority" integer, "p_is_active" boolean, "p_params" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_automation"("p_automation_id" "uuid", "p_condition_type" "text", "p_check_interval_minutes" integer, "p_priority" integer, "p_is_active" boolean, "p_params" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_company"("p_name" "text", "p_description" "text", "p_logo_url" "text", "p_website" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_company"("p_name" "text", "p_description" "text", "p_logo_url" "text", "p_website" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_company"("p_name" "text", "p_description" "text", "p_logo_url" "text", "p_website" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_notification_rule"("p_rule_id" "uuid", "p_name" "text", "p_description" "text", "p_event_type" "text", "p_conditions" "jsonb", "p_recipient_strategies" "text"[], "p_recipient_config" "jsonb", "p_channels_override" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_notification_rule"("p_rule_id" "uuid", "p_name" "text", "p_description" "text", "p_event_type" "text", "p_conditions" "jsonb", "p_recipient_strategies" "text"[], "p_recipient_config" "jsonb", "p_channels_override" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_notification_rule"("p_rule_id" "uuid", "p_name" "text", "p_description" "text", "p_event_type" "text", "p_conditions" "jsonb", "p_recipient_strategies" "text"[], "p_recipient_config" "jsonb", "p_channels_override" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_pipeline"("p_pipeline_id" "uuid", "p_name" "text", "p_description" "text", "p_is_default" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_pipeline"("p_pipeline_id" "uuid", "p_name" "text", "p_description" "text", "p_is_default" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_pipeline"("p_pipeline_id" "uuid", "p_name" "text", "p_description" "text", "p_is_default" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_pipeline"("p_pipeline_id" "uuid", "p_name" "text", "p_description" "text", "p_is_default" boolean, "p_visibility_permissions" "text"[], "p_task_visibility_mode" "text", "p_require_time_approval" boolean, "p_assignment_mode" "text", "p_assignment_pool_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_pipeline"("p_pipeline_id" "uuid", "p_name" "text", "p_description" "text", "p_is_default" boolean, "p_visibility_permissions" "text"[], "p_task_visibility_mode" "text", "p_require_time_approval" boolean, "p_assignment_mode" "text", "p_assignment_pool_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_pipeline"("p_pipeline_id" "uuid", "p_name" "text", "p_description" "text", "p_is_default" boolean, "p_visibility_permissions" "text"[], "p_task_visibility_mode" "text", "p_require_time_approval" boolean, "p_assignment_mode" "text", "p_assignment_pool_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_retention_settings"("p_inactivity_days" integer, "p_warning_interval_days" integer, "p_user_inactivity_days" integer, "p_warnings_enabled" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_retention_settings"("p_inactivity_days" integer, "p_warning_interval_days" integer, "p_user_inactivity_days" integer, "p_warnings_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_retention_settings"("p_inactivity_days" integer, "p_warning_interval_days" integer, "p_user_inactivity_days" integer, "p_warnings_enabled" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_role"("p_role_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_permissions" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_role"("p_role_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_permissions" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_role"("p_role_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_permissions" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_stage"("p_stage_id" "uuid", "p_name" "text", "p_color" "text", "p_description" "text", "p_is_initial" boolean, "p_is_terminal" boolean, "p_terminal_type" "text", "p_requires_submission" boolean, "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_linked_pipeline_id" "uuid", "p_ui_metadata" "jsonb", "p_min_timer_seconds" integer, "p_reassign_on_entry" boolean, "p_submission_mode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_stage"("p_stage_id" "uuid", "p_name" "text", "p_color" "text", "p_description" "text", "p_is_initial" boolean, "p_is_terminal" boolean, "p_terminal_type" "text", "p_requires_submission" boolean, "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_linked_pipeline_id" "uuid", "p_ui_metadata" "jsonb", "p_min_timer_seconds" integer, "p_reassign_on_entry" boolean, "p_submission_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_stage"("p_stage_id" "uuid", "p_name" "text", "p_color" "text", "p_description" "text", "p_is_initial" boolean, "p_is_terminal" boolean, "p_terminal_type" "text", "p_requires_submission" boolean, "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_linked_pipeline_id" "uuid", "p_ui_metadata" "jsonb", "p_min_timer_seconds" integer, "p_reassign_on_entry" boolean, "p_submission_mode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_stage_action"("p_action_id" "uuid", "p_label" "text", "p_icon" "text", "p_style" "text", "p_required_role" "text", "p_precondition" "text", "p_transition_id" "uuid", "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_is_active" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_stage_action"("p_action_id" "uuid", "p_label" "text", "p_icon" "text", "p_style" "text", "p_required_role" "text", "p_precondition" "text", "p_transition_id" "uuid", "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_stage_action"("p_action_id" "uuid", "p_label" "text", "p_icon" "text", "p_style" "text", "p_required_role" "text", "p_precondition" "text", "p_transition_id" "uuid", "p_requires_timer" boolean, "p_use_business_hours" boolean, "p_is_active" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_stage_spawn_config"("p_stage_id" "uuid", "p_child_inherits_submission" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_stage_spawn_config"("p_stage_id" "uuid", "p_child_inherits_submission" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_stage_spawn_config"("p_stage_id" "uuid", "p_child_inherits_submission" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_task_assignments"("p_task_id" "uuid", "p_user_ids" "uuid"[], "p_team_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_task_assignments"("p_task_id" "uuid", "p_user_ids" "uuid"[], "p_team_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_task_assignments"("p_task_id" "uuid", "p_user_ids" "uuid"[], "p_team_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_task_status"("p_task_id" "uuid", "p_new_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_task_status"("p_task_id" "uuid", "p_new_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_task_status"("p_task_id" "uuid", "p_new_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_transition"("p_transition_id" "uuid", "p_label" "text", "p_required_permission" "text", "p_transition_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_transition"("p_transition_id" "uuid", "p_label" "text", "p_required_permission" "text", "p_transition_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_transition"("p_transition_id" "uuid", "p_label" "text", "p_required_permission" "text", "p_transition_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_upsert_linked_outcome"("p_parent_stage_id" "uuid", "p_child_terminal_stage_id" "uuid", "p_parent_target_stage_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_upsert_linked_outcome"("p_parent_stage_id" "uuid", "p_child_terminal_stage_id" "uuid", "p_parent_target_stage_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_upsert_linked_outcome"("p_parent_stage_id" "uuid", "p_child_terminal_stage_id" "uuid", "p_parent_target_stage_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_upsert_notification_preferences"("p_email_enabled" boolean, "p_push_mobile_enabled" boolean, "p_push_web_enabled" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_upsert_notification_preferences"("p_email_enabled" boolean, "p_push_mobile_enabled" boolean, "p_push_web_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_upsert_notification_preferences"("p_email_enabled" boolean, "p_push_mobile_enabled" boolean, "p_push_web_enabled" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_upsert_push_subscription"("p_type" "text", "p_token" "text", "p_device_id" "text", "p_platform" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_upsert_push_subscription"("p_type" "text", "p_token" "text", "p_device_id" "text", "p_platform" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_upsert_push_subscription"("p_type" "text", "p_token" "text", "p_device_id" "text", "p_platform" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_waitlist_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_waitlist_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_waitlist_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_waitlist_join"("p_email" "text", "p_company_name" "text", "p_honeypot" "text", "p_ref_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_waitlist_join"("p_email" "text", "p_company_name" "text", "p_honeypot" "text", "p_ref_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_waitlist_join"("p_email" "text", "p_company_name" "text", "p_honeypot" "text", "p_ref_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_import_connections_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_import_connections_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_import_connections_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."spawn_recursive_task"("p_parent_task_id" "uuid", "p_pipeline_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."spawn_recursive_task"("p_parent_task_id" "uuid", "p_pipeline_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."spawn_recursive_task"("p_parent_task_id" "uuid", "p_pipeline_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_recursive_child_tasks"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_recursive_child_tasks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_recursive_child_tasks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_stage_submission_mode"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_stage_submission_mode"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_stage_submission_mode"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_task_status_from_stage"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_task_status_from_stage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_task_status_from_stage"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."task_accessible"("p_task_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."task_accessible"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."task_accessible"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."task_comments_search_tsv_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."task_comments_search_tsv_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."task_comments_search_tsv_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."task_list_visible"("p_task_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."task_list_visible"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."task_list_visible"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."tasks_search_tsv_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."tasks_search_tsv_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tasks_search_tsv_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tr_generate_company_join_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."tr_generate_company_join_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tr_generate_company_join_code"() TO "service_role";



GRANT ALL ON TABLE "public"."activity_events" TO "anon";
GRANT ALL ON TABLE "public"."activity_events" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_events" TO "service_role";



GRANT ALL ON TABLE "public"."activity_log" TO "anon";
GRANT ALL ON TABLE "public"."activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_log" TO "service_role";



GRANT ALL ON TABLE "public"."analytics_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."analytics_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."analytics_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."automation_execution_log" TO "anon";
GRANT ALL ON TABLE "public"."automation_execution_log" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_execution_log" TO "service_role";



GRANT ALL ON TABLE "public"."billing_events" TO "anon";
GRANT ALL ON TABLE "public"."billing_events" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_events" TO "service_role";



GRANT ALL ON TABLE "public"."billing_plans" TO "anon";
GRANT ALL ON TABLE "public"."billing_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_plans" TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON TABLE "public"."company_billing" TO "anon";
GRANT ALL ON TABLE "public"."company_billing" TO "authenticated";
GRANT ALL ON TABLE "public"."company_billing" TO "service_role";



GRANT ALL ON TABLE "public"."company_ping_sounds" TO "anon";
GRANT ALL ON TABLE "public"."company_ping_sounds" TO "authenticated";
GRANT ALL ON TABLE "public"."company_ping_sounds" TO "service_role";



GRANT ALL ON TABLE "public"."company_retention_settings" TO "anon";
GRANT ALL ON TABLE "public"."company_retention_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."company_retention_settings" TO "service_role";



GRANT ALL ON TABLE "public"."entity_watchers" TO "anon";
GRANT ALL ON TABLE "public"."entity_watchers" TO "authenticated";
GRANT ALL ON TABLE "public"."entity_watchers" TO "service_role";



GRANT ALL ON TABLE "public"."filehub_activity" TO "anon";
GRANT ALL ON TABLE "public"."filehub_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."filehub_activity" TO "service_role";



GRANT ALL ON TABLE "public"."filehub_file_versions" TO "anon";
GRANT ALL ON TABLE "public"."filehub_file_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."filehub_file_versions" TO "service_role";



GRANT ALL ON TABLE "public"."filehub_files" TO "anon";
GRANT ALL ON TABLE "public"."filehub_files" TO "authenticated";
GRANT ALL ON TABLE "public"."filehub_files" TO "service_role";



GRANT ALL ON TABLE "public"."filehub_folders" TO "anon";
GRANT ALL ON TABLE "public"."filehub_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."filehub_folders" TO "service_role";



GRANT ALL ON TABLE "public"."filehub_group_members" TO "anon";
GRANT ALL ON TABLE "public"."filehub_group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."filehub_group_members" TO "service_role";



GRANT ALL ON TABLE "public"."filehub_groups" TO "anon";
GRANT ALL ON TABLE "public"."filehub_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."filehub_groups" TO "service_role";



GRANT ALL ON TABLE "public"."filehub_recipients" TO "anon";
GRANT ALL ON TABLE "public"."filehub_recipients" TO "authenticated";
GRANT ALL ON TABLE "public"."filehub_recipients" TO "service_role";



GRANT ALL ON TABLE "public"."filehub_seen" TO "anon";
GRANT ALL ON TABLE "public"."filehub_seen" TO "authenticated";
GRANT ALL ON TABLE "public"."filehub_seen" TO "service_role";



GRANT ALL ON TABLE "public"."filehub_share_links" TO "anon";
GRANT ALL ON TABLE "public"."filehub_share_links" TO "authenticated";
GRANT ALL ON TABLE "public"."filehub_share_links" TO "service_role";



GRANT ALL ON TABLE "public"."submission_attachments" TO "anon";
GRANT ALL ON TABLE "public"."submission_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."submission_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."task_attachments" TO "anon";
GRANT ALL ON TABLE "public"."task_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."task_submissions" TO "anon";
GRANT ALL ON TABLE "public"."task_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."task_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."files_index" TO "service_role";



GRANT ALL ON TABLE "public"."import_connections" TO "anon";
GRANT ALL ON TABLE "public"."import_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."import_connections" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."notification_events" TO "anon";
GRANT ALL ON TABLE "public"."notification_events" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_events" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."notification_rules" TO "anon";
GRANT ALL ON TABLE "public"."notification_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_rules" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_assignment_pool" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_assignment_pool" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_assignment_pool" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_automation_params" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_automation_params" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_automation_params" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_automations" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_automations" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_automations" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_linked_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_linked_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_linked_outcomes" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_stage_actions" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_stage_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_stage_actions" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_stage_history" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_stage_history" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_stage_history" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_stage_targets" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_stage_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_stage_targets" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_stage_transitions" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_stage_transitions" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_stage_transitions" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_stages" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_stages" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_stages" TO "service_role";



GRANT ALL ON TABLE "public"."pipelines" TO "anon";
GRANT ALL ON TABLE "public"."pipelines" TO "authenticated";
GRANT ALL ON TABLE "public"."pipelines" TO "service_role";



GRANT ALL ON TABLE "public"."platform_admins" TO "anon";
GRANT ALL ON TABLE "public"."platform_admins" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_admins" TO "service_role";



GRANT ALL ON TABLE "public"."platform_infra_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."platform_infra_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_infra_snapshots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."platform_infra_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."platform_infra_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."platform_infra_snapshots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."rate_limit_buckets" TO "anon";
GRANT ALL ON TABLE "public"."rate_limit_buckets" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_limit_buckets" TO "service_role";



GRANT ALL ON TABLE "public"."reporting_jobs" TO "anon";
GRANT ALL ON TABLE "public"."reporting_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."reporting_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."retention_warnings" TO "anon";
GRANT ALL ON TABLE "public"."retention_warnings" TO "authenticated";
GRANT ALL ON TABLE "public"."retention_warnings" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."storage_archive_queue" TO "anon";
GRANT ALL ON TABLE "public"."storage_archive_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."storage_archive_queue" TO "service_role";



GRANT ALL ON TABLE "public"."task_assignments" TO "anon";
GRANT ALL ON TABLE "public"."task_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."task_attachment_versions" TO "anon";
GRANT ALL ON TABLE "public"."task_attachment_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."task_attachment_versions" TO "service_role";



GRANT ALL ON TABLE "public"."task_comments" TO "anon";
GRANT ALL ON TABLE "public"."task_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_comments" TO "service_role";



GRANT ALL ON TABLE "public"."task_manual_time_entries" TO "anon";
GRANT ALL ON TABLE "public"."task_manual_time_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."task_manual_time_entries" TO "service_role";



GRANT ALL ON TABLE "public"."task_mention_acks" TO "anon";
GRANT ALL ON TABLE "public"."task_mention_acks" TO "authenticated";
GRANT ALL ON TABLE "public"."task_mention_acks" TO "service_role";



GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."task_participants" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."task_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."task_participants" TO "service_role";



GRANT ALL ON TABLE "public"."task_ping_targets" TO "anon";
GRANT ALL ON TABLE "public"."task_ping_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."task_ping_targets" TO "service_role";



GRANT ALL ON TABLE "public"."task_submission_versions" TO "anon";
GRANT ALL ON TABLE "public"."task_submission_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."task_submission_versions" TO "service_role";



GRANT ALL ON TABLE "public"."task_work_sessions" TO "anon";
GRANT ALL ON TABLE "public"."task_work_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."task_work_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."team_roles" TO "anon";
GRANT ALL ON TABLE "public"."team_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."team_roles" TO "service_role";



GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



GRANT ALL ON TABLE "public"."trial_code_redemptions" TO "anon";
GRANT ALL ON TABLE "public"."trial_code_redemptions" TO "authenticated";
GRANT ALL ON TABLE "public"."trial_code_redemptions" TO "service_role";



GRANT ALL ON TABLE "public"."trial_codes" TO "anon";
GRANT ALL ON TABLE "public"."trial_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."trial_codes" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."view_task_time_metrics" TO "anon";
GRANT ALL ON TABLE "public"."view_task_time_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."view_task_time_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."view_user_performance" TO "anon";
GRANT ALL ON TABLE "public"."view_user_performance" TO "authenticated";
GRANT ALL ON TABLE "public"."view_user_performance" TO "service_role";



GRANT ALL ON TABLE "public"."waitlist_signups" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







