-- 20260801_project_deliverable.sql
-- Issue #174 (Projects Phase 4, plan §6 / §10) -- seal a project's output as
-- an immutable FileHub folder version.
--
-- ── What this reuses, not reinvents ──────────────────────────────────────────
-- * Harvest = a version snapshot via FileHub's EXISTING folder versioning
--   (filehub_file_versions.batch_id -> folder v1..vN, 20260730133142 /
--   20260730133225 -- applied to this local stack as prerequisite groundwork,
--   see the note at the bottom of this file). No counter column, no new
--   versioning mechanism.
-- * projects.deliverable_folder_id / clients.standing_folder_id follow the
--   SAME shape as portfolios.standing_folder_id
--   (20260801_spreadsheet_intake_portfolio_folder.sql): a nullable FK to
--   filehub_folders, created lazily, get-or-create via rpc_filehub_folder_create
--   where a client-side create is needed (the standing folder), or an inline
--   equivalent for the trigger-driven deliverable folder (a trigger cannot
--   depend on the CALLER holding filehub:view -- see fn_project_ensure_
--   deliverable_folder below).
-- * Visibility is a one-value EXTENSION of the existing FileHub visibility
--   model, exactly mirroring how 'task' was added for #143/#151: a new
--   'project' value on filehub_files.visibility + filehub_folders.scope, each
--   gated by fn_project_accessible() -- the SAME predicate #186 wired into
--   every other project read path. A sealed deliverable can therefore never
--   become a way to read a file its viewer could not already reach via the
--   project itself.
--
-- ── The harvest mechanism ─────────────────────────────────────────────────────
-- Per-stage toggle: pipeline_stages.harvests_to_deliverable, alongside the
-- existing requires_submission / requires_attachments / child_inherits_submission.
-- Enforced by a TRIGGER on tasks (AFTER UPDATE OF current_stage_id), not by an
-- RPC -- plan §13.2 already established this exact lesson for stage history
-- ("a rule written in prose that the database does not enforce") and it
-- applies identically here: tasks move stage via drag-drop UPDATEs, RPCs, and
-- bulk paths, and harvest must fire from all of them alike.
--
-- Output = the task's most recent non-deleted submission's attachments
-- (submission_attachments, the work actually delivered) -- NOT task_attachments
-- (the brief/input). Each promoted file becomes its OWN filehub_files row in
-- the deliverable folder (visibility='project'), pointing at the SAME
-- storage_path as the source (no bytes copied, matching Model B), with its own
-- filehub_file_versions row carrying a fresh batch_id. That is what makes
-- immutability free: a later change to the task's file is a NEW submission
-- attachment with a NEW storage_path, so the earlier harvested row is never
-- touched, and the folder's version count (count(distinct batch_id)) advances
-- by exactly one harvest event, which is the "sealed as a version" semantic.
-- A re-harvest of an UNCHANGED file (same folder/storage_path/bucket) is a
-- no-op -- no duplicate rows pile up from moving a task in and out of the
-- stage.

-- ── 1. projects.deliverable_folder_id (mirrors clients.standing_folder_id) ──
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS deliverable_folder_id UUID REFERENCES public.filehub_folders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.projects.deliverable_folder_id IS
  'FileHub folder holding this project''s sealed output (issue #174, plan §6). Per-project, one year -- distinct from clients.standing_folder_id, which persists across years. Created lazily by fn_project_ensure_deliverable_folder on first harvest.';

-- ── 2. Per-stage harvest toggle, alongside the existing three ────────────────
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS harvests_to_deliverable BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.pipeline_stages.harvests_to_deliverable IS
  'Issue #174. Tasks entering this stage promote their latest submission''s attachments into their project''s sealed deliverable folder. Enforced by trg_tasks_harvest_deliverable, not by any single RPC -- must fire regardless of which write path moved the task.';

-- ── 3. filehub_folders: a 'project' scope, mirroring 'group' ─────────────────
ALTER TABLE public.filehub_folders
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.filehub_folders DROP CONSTRAINT IF EXISTS filehub_folders_scope_check;
ALTER TABLE public.filehub_folders ADD CONSTRAINT filehub_folders_scope_check
  CHECK (scope = ANY (ARRAY['direct'::text, 'broadcast'::text, 'group'::text, 'project'::text]));

ALTER TABLE public.filehub_folders DROP CONSTRAINT IF EXISTS filehub_folders_project_scope_chk;
ALTER TABLE public.filehub_folders ADD CONSTRAINT filehub_folders_project_scope_chk
  CHECK ((scope = 'project') = (project_id IS NOT NULL));

-- The existing root-uniqueness index only disambiguated by group_id. A
-- project-scope folder is keyed by project_id the same way a group folder is
-- keyed by group_id -- without this, two projects that happen to share a
-- display name (or a project and an unrelated broadcast folder) would collide
-- on (company_id, scope, name) at the root.
DROP INDEX IF EXISTS public.idx_filehub_folders_unique_root;
CREATE UNIQUE INDEX idx_filehub_folders_unique_root
  ON public.filehub_folders (company_id, scope, COALESCE(group_id, project_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
  WHERE parent_id IS NULL AND deleted_at IS NULL;

-- filehub_folder_accessible (20260730122954) only knew about direct/broadcast/
-- group. Body-only extension, same function, same signature -- every caller
-- (rpc_filehub_folder_versions, rpc_filehub_folder_restore_batch, the share-link
-- RPCs) gets project-folder support for free, no call site touched.
CREATE OR REPLACE FUNCTION public.filehub_folder_accessible(p_folder_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.filehub_folders fo
        WHERE fo.id = p_folder_id
          AND fo.deleted_at IS NULL
          AND fo.company_id = public.my_company_id()
          AND (
              fo.created_by = auth.uid()
              OR fo.scope = 'broadcast'
              OR (fo.scope = 'group' AND fo.group_id IS NOT NULL AND (
                     EXISTS (
                         SELECT 1 FROM public.filehub_group_members gm
                         WHERE gm.group_id = fo.group_id AND gm.user_id = auth.uid()
                     )
                     OR public.has_permission('filehub:group_override')
                     OR public.has_permission('filehub:group_override_manage')
                 ))
              OR (fo.scope = 'project' AND fo.project_id IS NOT NULL
                  AND public.fn_project_accessible(fo.project_id))
          )
    );
$$;

-- ── 4. filehub_files: a 'project' visibility value, mirroring 'task' ─────────
ALTER TABLE public.filehub_files
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.filehub_files DROP CONSTRAINT IF EXISTS filehub_files_visibility_check;
ALTER TABLE public.filehub_files ADD CONSTRAINT filehub_files_visibility_check
  CHECK (visibility = ANY (ARRAY['direct'::text, 'broadcast'::text, 'group'::text, 'task'::text, 'project'::text]));

-- Pre-existing latent bug found while wiring the 'project' branch in below:
-- filehub_files_select_visibility's 'direct' branch does an inline
-- EXISTS(...FROM filehub_recipients...), and filehub_recipients' OWN policy
-- (filehub_recipients_select_own_or_sender) does an inline
-- EXISTS(...FROM filehub_files...) right back -- a two-table RLS cycle.
-- Postgres's recursion guard trips on THIS at query-plan time regardless of
-- which visibility branch a given row actually matches (the whole policy
-- expression is rewritten up front), so ANY raw `SELECT ... FROM
-- filehub_files` under RLS -- 'project' rows included -- currently errors
-- with "infinite recursion detected in policy for relation filehub_files".
-- Never hit before because every real read goes through a SECURITY DEFINER
-- RPC (rpc_filehub_list, rpc_filehub_browse, ...), which bypasses RLS
-- entirely via BYPASSRLS ownership -- this check is the first thing to run a
-- raw table SELECT under `authenticated` against a 'direct'-capable qual.
-- Fixed at the root using the SAME technique task_accessible /
-- fn_project_accessible / filehub_folder_accessible already exist for: wrap
-- the cross-table check in a SECURITY DEFINER STABLE function so the nested
-- query runs as the (BYPASSRLS) owner and never re-enters filehub_files'
-- own policy.
CREATE OR REPLACE FUNCTION public.fn_filehub_is_direct_recipient(p_file_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.filehub_recipients r
        WHERE r.file_id = p_file_id AND r.user_id = auth.uid()
    );
$$;

-- Same latent-recursion class, second instance: filehub_group_members_select
-- self-joins its OWN table (gm2), and Postgres's rewriter still has to expand
-- that while planning filehub_files' 'group' branch (which queries
-- filehub_group_members) -- "infinite recursion detected in policy for
-- relation filehub_group_members" on the exact same raw-SELECT path. Same
-- fix, same reasoning: run the membership check as the BYPASSRLS owner so
-- filehub_group_members' own policy never has to be evaluated from here.
CREATE OR REPLACE FUNCTION public.fn_filehub_is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.filehub_group_members gm
        WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid()
    );
$$;

-- Table-level RLS floor: add the 'project' branch alongside the existing four,
-- gated by the SAME fn_project_accessible() every other project read path
-- uses. Never widens beyond it -- a user who cannot see the project cannot
-- see this row, full stop.
DROP POLICY IF EXISTS "filehub_files_select_visibility" ON public.filehub_files;
CREATE POLICY "filehub_files_select_visibility" ON public.filehub_files
    FOR SELECT USING (
        deleted_at IS NULL
        AND company_id = public.my_company_id()
        AND (
            uploaded_by = auth.uid()
            OR visibility = 'broadcast'
            OR (visibility = 'direct' AND public.fn_filehub_is_direct_recipient(id))
            OR (visibility = 'group' AND group_id IS NOT NULL AND public.fn_filehub_is_group_member(group_id))
            OR (visibility = 'task' AND task_id IS NOT NULL AND public.task_accessible(task_id))
            OR (visibility = 'project' AND project_id IS NOT NULL AND public.fn_project_accessible(project_id))
        )
    );

-- ── 5. Lazy get-or-create of a project's deliverable folder ──────────────────
-- Not rpc_filehub_folder_create: that RPC gates on the CALLER holding
-- filehub:view, which is correct for a person-initiated "attach evidence"
-- click but wrong here -- harvest is triggered by moving a task, and the
-- person doing that should never be blocked from advancing their own task by
-- a FileHub permission they may not hold. Locks the project row so two
-- concurrent harvests can never create two folders for the same project.
CREATE OR REPLACE FUNCTION public.fn_project_ensure_deliverable_folder(p_project_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID;
    v_name       TEXT;
    v_folder_id  UUID;
BEGIN
    SELECT company_id, deliverable_folder_id, left(name, 80)
      INTO v_company_id, v_folder_id, v_name
    FROM public.projects
    WHERE id = p_project_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_folder_id IS NOT NULL THEN
        RETURN v_folder_id;
    END IF;

    INSERT INTO public.filehub_folders (company_id, name, created_by, parent_id, scope, project_id)
    VALUES (v_company_id, v_name, auth.uid(), NULL, 'project', p_project_id)
    RETURNING id INTO v_folder_id;

    UPDATE public.projects SET deliverable_folder_id = v_folder_id WHERE id = p_project_id;

    RETURN v_folder_id;
END;
$$;

-- ── 6. The harvest itself ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_harvest_task_output(p_task_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task       RECORD;
    v_folder_id  UUID;
    v_submission UUID;
    v_actor      UUID := auth.uid();
    v_batch_id   UUID;
    r            RECORD;
    v_new_file   UUID;
    v_version_id UUID;
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

        INSERT INTO public.filehub_files (
            company_id, uploaded_by, storage_path, bucket, original_name,
            mime_type, size_bytes, content_hash, visibility, folder_id, project_id
        ) VALUES (
            v_task.company_id, COALESCE(v_actor, r.uploaded_by), r.storage_path, r.bucket, r.original_name,
            r.mime_type, r.size_bytes, r.content_hash, 'project', v_folder_id, v_task.project_id
        ) RETURNING id INTO v_new_file;

        INSERT INTO public.filehub_file_versions (
            file_id, company_id, version_no, storage_path, bucket,
            original_name, size_bytes, mime_type, content_hash, created_by, batch_id
        ) VALUES (
            v_new_file, v_task.company_id, 1, r.storage_path, r.bucket,
            r.original_name, r.size_bytes, r.mime_type, r.content_hash,
            COALESCE(v_actor, r.uploaded_by), v_batch_id
        ) RETURNING id INTO v_version_id;

        UPDATE public.filehub_files SET current_version_id = v_version_id WHERE id = v_new_file;
    END LOOP;
END;
$$;

-- ── 7. Trigger-enforced, not RPC-enforced (plan §13.2's lesson, applied) ────
CREATE OR REPLACE FUNCTION public.fn_trg_harvest_task_on_stage_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF COALESCE(
        (SELECT harvests_to_deliverable FROM public.pipeline_stages WHERE id = NEW.current_stage_id),
        FALSE
    ) THEN
        PERFORM public.fn_harvest_task_output(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_harvest_deliverable ON public.tasks;
CREATE TRIGGER trg_tasks_harvest_deliverable
    AFTER UPDATE OF current_stage_id ON public.tasks
    FOR EACH ROW
    WHEN (NEW.current_stage_id IS DISTINCT FROM OLD.current_stage_id AND NEW.current_stage_id IS NOT NULL)
    EXECUTE FUNCTION public.fn_trg_harvest_task_on_stage_entry();

-- ── 8. Read path for the Files tab ────────────────────────────────────────────
-- Same denial/non-existence convention as rpc_project_dashboard: a screen-level
-- gate first (project.view), then fn_project_accessible folded into "Project
-- not found." -- never a distinguishable "denied" (that itself discloses the
-- project exists, per plan §13.14).
CREATE OR REPLACE FUNCTION public.rpc_project_files(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_project              RECORD;
    v_deliverable_files    JSONB := '[]'::jsonb;
    v_deliverable_versions JSONB := '[]'::jsonb;
    v_standing_files       JSONB := '[]'::jsonb;
BEGIN
    IF NOT public.has_permission('project.view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view projects.';
    END IF;

    SELECT p.id, p.deliverable_folder_id, p.client_id, c.name AS client_name, c.standing_folder_id
      INTO v_project
    FROM public.projects p
    LEFT JOIN public.clients c ON c.id = p.client_id AND c.deleted_at IS NULL
    WHERE p.id = p_project_id AND p.deleted_at IS NULL
      AND public.fn_project_accessible(p.id);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found.';
    END IF;

    IF v_project.deliverable_folder_id IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', f.id, 'name', f.original_name, 'mime_type', f.mime_type,
            'size_bytes', f.size_bytes, 'bucket', f.bucket, 'storage_path', f.storage_path,
            'created_at', f.created_at
        ) ORDER BY f.created_at DESC), '[]'::jsonb)
        INTO v_deliverable_files
        FROM public.filehub_files f
        WHERE f.folder_id = v_project.deliverable_folder_id AND f.deleted_at IS NULL;

        v_deliverable_versions := public.rpc_filehub_folder_versions(v_project.deliverable_folder_id);
    END IF;

    IF v_project.standing_folder_id IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', f.id, 'name', f.original_name, 'mime_type', f.mime_type,
            'size_bytes', f.size_bytes, 'bucket', f.bucket, 'storage_path', f.storage_path,
            'created_at', f.created_at
        ) ORDER BY f.created_at DESC), '[]'::jsonb)
        INTO v_standing_files
        FROM public.filehub_files f
        WHERE f.folder_id = v_project.standing_folder_id AND f.deleted_at IS NULL;
    END IF;

    RETURN jsonb_build_object(
        'deliverable_folder_id', v_project.deliverable_folder_id,
        'deliverable_files', v_deliverable_files,
        'deliverable_versions', v_deliverable_versions,
        'client_id', v_project.client_id,
        'client_name', v_project.client_name,
        'standing_folder_id', v_project.standing_folder_id,
        'standing_files', v_standing_files
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_project_files(UUID) TO authenticated;

-- ── 9. Client standing folder: lazy get-or-create, same shape as the
--    portfolio one (20260801_spreadsheet_intake_portfolio_folder.sql) ────────
-- Two rpc_filehub_folder_create calls (root then leaf), exactly mirroring
-- BulkCreateProjectsSheet.getOrCreateStandingFolder -- reuses the idempotent
-- RPC rather than a raw INSERT, so folder-name dedup logic never forks.
-- Nested under a dedicated "Client Files" root so a client's folder can never
-- collide with a portfolio-import folder of the same name; two ACTIVE clients
-- sharing a name is already impossible (clients_company_name_key).
CREATE OR REPLACE FUNCTION public.rpc_client_ensure_standing_folder(p_client_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_name       TEXT;
    v_folder_id  UUID;
    v_root       UUID;
    v_leaf       UUID;
BEGIN
    SELECT left(name, 80), standing_folder_id INTO v_name, v_folder_id
    FROM public.clients
    WHERE id = p_client_id AND company_id = v_company_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client not found.';
    END IF;

    IF v_folder_id IS NOT NULL THEN
        RETURN v_folder_id;
    END IF;

    v_root := public.rpc_filehub_folder_create('Client Files', NULL, 'broadcast', NULL);
    v_leaf := public.rpc_filehub_folder_create(v_name, v_root, 'broadcast', NULL);

    UPDATE public.clients
    SET standing_folder_id = v_leaf
    WHERE id = p_client_id AND standing_folder_id IS NULL
    RETURNING standing_folder_id INTO v_folder_id;

    IF v_folder_id IS NULL THEN
        -- Lost a race to a concurrent call -- reuse whichever folder won.
        SELECT standing_folder_id INTO v_folder_id FROM public.clients WHERE id = p_client_id;
    END IF;

    RETURN v_folder_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_client_ensure_standing_folder(UUID) TO authenticated;

-- ── 10. Wire harvests_to_deliverable into the stage editor RPCs ─────────────
-- Without this, the toggle is schema nobody can reach -- exactly the trap
-- plan §13.8 already named ("Phase 2 delivered the stage engine as schema
-- only... nothing in the app can reach any of it"). Bodies dumped verbatim
-- via pg_get_functiondef from the live definitions and edited minimally (one
-- new parameter, one new COALESCE/column each) rather than retyped, per this
-- file's own standing precaution.
CREATE OR REPLACE FUNCTION public.rpc_update_stage(p_stage_id uuid, p_name text DEFAULT NULL::text, p_color text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_is_initial boolean DEFAULT NULL::boolean, p_is_terminal boolean DEFAULT NULL::boolean, p_terminal_type text DEFAULT NULL::text, p_requires_submission boolean DEFAULT NULL::boolean, p_requires_timer boolean DEFAULT NULL::boolean, p_use_business_hours boolean DEFAULT NULL::boolean, p_linked_pipeline_id uuid DEFAULT NULL::uuid, p_ui_metadata jsonb DEFAULT NULL::jsonb, p_min_timer_seconds integer DEFAULT NULL::integer, p_reassign_on_entry boolean DEFAULT NULL::boolean, p_submission_mode text DEFAULT NULL::text, p_harvests_to_deliverable boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        name                     = COALESCE(p_name, name),
        color                    = COALESCE(p_color, color),
        description              = COALESCE(p_description, description),
        is_initial               = COALESCE(p_is_initial, is_initial),
        is_terminal              = COALESCE(p_is_terminal, is_terminal),
        terminal_type            = COALESCE(p_terminal_type, terminal_type),
        requires_submission      = COALESCE(p_requires_submission, requires_submission),
        submission_mode          = COALESCE(p_submission_mode, submission_mode),
        requires_timer           = COALESCE(p_requires_timer, requires_timer),
        use_business_hours       = COALESCE(p_use_business_hours, use_business_hours),
        linked_pipeline_id       = COALESCE(p_linked_pipeline_id, linked_pipeline_id),
        ui_metadata              = COALESCE(p_ui_metadata, ui_metadata),
        min_timer_seconds        = COALESCE(p_min_timer_seconds, min_timer_seconds),
        reassign_on_entry        = COALESCE(p_reassign_on_entry, reassign_on_entry),
        harvests_to_deliverable  = COALESCE(p_harvests_to_deliverable, harvests_to_deliverable),
        updated_at               = NOW()
    WHERE id = p_stage_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_add_stage(p_pipeline_id uuid, p_name text, p_color text DEFAULT '#6B7280'::text, p_description text DEFAULT NULL::text, p_is_initial boolean DEFAULT false, p_is_terminal boolean DEFAULT false, p_terminal_type text DEFAULT NULL::text, p_requires_submission boolean DEFAULT false, p_requires_timer boolean DEFAULT false, p_use_business_hours boolean DEFAULT false, p_ui_metadata jsonb DEFAULT '{"x": 0, "y": 0}'::jsonb, p_min_timer_seconds integer DEFAULT 300, p_submission_mode text DEFAULT NULL::text, p_harvests_to_deliverable boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        ui_metadata, min_timer_seconds, harvests_to_deliverable
    )
    VALUES (
        p_pipeline_id, p_name, p_color, p_description, v_pos,
        p_is_initial, p_is_terminal, p_terminal_type,
        p_requires_submission, p_submission_mode, p_requires_timer, p_use_business_hours,
        p_ui_metadata, p_min_timer_seconds, COALESCE(p_harvests_to_deliverable, false)
    )
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$function$;

-- ── Wiring self-check (the full behavioural proof lives in
--    supabase/checks/check_project_deliverable.sql) ──────────────────────────
DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'deliverable_folder_id'
    ), 'projects.deliverable_folder_id missing';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pipeline_stages' AND column_name = 'harvests_to_deliverable'
    ), 'pipeline_stages.harvests_to_deliverable missing';

    ASSERT (
        SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_tasks_harvest_deliverable' AND tgrelid = 'public.tasks'::regclass
    ) = 1, 'trg_tasks_harvest_deliverable must exist exactly once';

    ASSERT public.filehub_folder_accessible(NULL) = false, 'filehub_folder_accessible(NULL) must be false, not error';

    RAISE NOTICE '20260801_project_deliverable.sql wiring assertions passed';
END $$;

-- ── Local-stack note ──────────────────────────────────────────────────────────
-- This migration depends on filehub_file_versions.batch_id and
-- rpc_filehub_folder_versions / rpc_filehub_folder_restore_batch
-- (20260730133142 / 20260730133225), plus filehub_folder_accessible
-- (20260730122954, extended above). These three files existed in the repo but
-- had NOT actually been applied to this local stack -- confirmed by direct
-- pg_proc/information_schema introspection before writing anything here, and
-- applied via `docker exec -i ... psql -f -` (never `supabase migration up`,
-- per this worktree's hard safety rules) as prerequisite groundwork. The
-- trailing self-check in 20260730133225 asserts against one specific PROD
-- folder id that happens to also exist locally with different history (a
-- coincidental id collision in seed data, not a schema defect) and fails on
-- THIS stack only; every function it defines was confirmed to land correctly
-- despite that.
