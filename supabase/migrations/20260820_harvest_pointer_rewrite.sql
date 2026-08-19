-- Issue #284, Phase 2: rewrite the harvest path onto pointers.
--
-- Full plan: C:\Users\j\.claude\plans\recursive-skipping-treasure.md
-- Phase 1 (20260819_harvest_rules_schema.sql) shipped harvest_rules/
-- harvested_files as schema only -- fn_harvest_task_output and the
-- stage-entry trigger still wrote a duplicate filehub_files/filehub_
-- file_versions row (the bug #284 exists to fix). This migration cuts
-- both over to harvested_files pointer rows and rewires rpc_project_files
-- to read through the pointer table instead of the old duplicate rows.
--
-- Destination-resolution correction (see plan, "Phase 2" section, added
-- before this migration was written): harvest_rules.destination_folder_id
-- is an explicit OVERRIDE, not the default. NULL (today's only reachable
-- case -- no RPC creates a rule with a destination yet, that's Phase 3)
-- resolves dynamically per the harvesting task's OWN project via
-- fn_project_ensure_deliverable_folder, exactly preserving today's
-- per-project behaviour -- a single folder per RULE would wrongly funnel
-- every project sharing a pipeline into one shared folder.
--
-- Footgun already burned on this exact codebase (20260802_drop_stale_
-- stage_rpc_overloads.sql): CREATE OR REPLACE FUNCTION with a DIFFERENT
-- argument list does not replace, it ADDS an overload, which then breaks
-- every caller with "ambiguous function call". fn_harvest_task_output
-- changes from 1 arg to 2 -- the old 1-arg signature is DROPPED explicitly
-- below, not left to rot as a second overload.

-- ============================================================
-- Section 1: fn_project_ensure_deliverable_folder -- soft-delete guard
-- ============================================================
-- Same signature as today (CREATE OR REPLACE is safe here, no overload
-- risk) -- body-only fix. Previously blindly trusted a cached
-- deliverable_folder_id forever, even after the folder was soft-deleted --
-- the exact bug fn_ensure_harvest_destination_folder (Phase 1) was written
-- to avoid. Since Phase 2 makes fn_harvest_task_output call back into this
-- function on every dynamic-fallback harvest, fixing it here stops the
-- redesign from re-importing the bug it was partly meant to eliminate.
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
    v_deleted_at TIMESTAMPTZ;
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
        SELECT deleted_at INTO v_deleted_at FROM public.filehub_folders WHERE id = v_folder_id;
        -- Only trust the cache while the folder is still live -- a dead
        -- (soft-deleted) cached id falls through to create a replacement.
        IF v_deleted_at IS NULL THEN
            RETURN v_folder_id;
        END IF;
    END IF;

    INSERT INTO public.filehub_folders (company_id, name, created_by, parent_id, scope, project_id)
    VALUES (v_company_id, v_name, auth.uid(), NULL, 'project', p_project_id)
    RETURNING id INTO v_folder_id;

    UPDATE public.projects SET deliverable_folder_id = v_folder_id WHERE id = p_project_id;

    RETURN v_folder_id;
END;
$$;

-- ============================================================
-- Section 2: fn_harvest_task_output -- rewritten onto pointers
-- ============================================================
-- MUST drop the old 1-arg signature first -- CREATE OR REPLACE with a
-- different arg list adds an overload instead of replacing (see file
-- header). Nothing else in the schema calls the 1-arg form (only the
-- trigger function below did, and that's rewritten in the same migration),
-- so this drop is safe.
DROP FUNCTION IF EXISTS public.fn_harvest_task_output(uuid);

CREATE FUNCTION public.fn_harvest_task_output(p_task_id UUID, p_harvest_rule_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task        RECORD;
    v_rule_dest   UUID;
    v_folder_id   UUID;
    v_submission  UUID;
    v_actor       UUID := auth.uid();
    r             RECORD;
BEGIN
    SELECT id, company_id, project_id INTO v_task
    FROM public.tasks
    WHERE id = p_task_id AND deleted_at IS NULL;

    IF NOT FOUND OR v_task.project_id IS NULL THEN
        RETURN; -- not attached to a project: nothing to promote
    END IF;

    SELECT destination_folder_id INTO v_rule_dest
    FROM public.harvest_rules
    WHERE id = p_harvest_rule_id;

    IF NOT FOUND THEN
        RETURN; -- rule vanished/bad id -- nothing to harvest to
    END IF;

    IF v_rule_dest IS NOT NULL THEN
        -- Explicit override path -- nothing can set this yet (no RPC until
        -- Phase 3), but implemented correctly for when one exists.
        v_folder_id := v_rule_dest;
    ELSE
        -- The only reachable path today: dynamically resolve THIS TASK'S
        -- OWN project's deliverable folder. One pipeline can serve many
        -- projects -- a folder cached on the rule would be wrong.
        v_folder_id := public.fn_project_ensure_deliverable_folder(v_task.project_id);
    END IF;

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
        RETURN; -- nothing submitted yet -- silent no-op
    END IF;

    FOR r IN
        SELECT sf.current_version_id AS version_id
        FROM public.submission_attachments sa
        JOIN public.filehub_files sf ON sf.id = sa.filehub_file_id
        WHERE sa.submission_id = v_submission
          AND sf.deleted_at IS NULL
          AND sf.current_version_id IS NOT NULL
    LOOP
        -- The entire idempotency mechanism: a pointer at this (folder,
        -- version) pair either doesn't exist yet (inserted) or already
        -- does (no-op) -- no manual EXISTS/CONTINUE check needed.
        INSERT INTO public.harvested_files (
            harvest_rule_id, source_file_version_id, destination_folder_id,
            source_task_id, company_id, harvested_by
        ) VALUES (
            p_harvest_rule_id, r.version_id, v_folder_id,
            p_task_id, v_task.company_id, v_actor
        )
        ON CONFLICT (destination_folder_id, source_file_version_id) DO NOTHING;
    END LOOP;
END;
$$;

-- ============================================================
-- Section 3: stage-entry trigger -- fan out to every matching active rule
-- ============================================================
-- Trigger definition itself (AFTER UPDATE OF current_stage_id, same WHEN
-- clause) is unchanged -- only the function body. Was: check the single
-- pipeline_stages.harvests_to_deliverable boolean, harvest once. Now: loop
-- over every currently-active, currently-matching harvest_rules row for
-- this exact stage+pipeline and harvest to EACH one. A task matching more
-- than one active rule harvests to every one of them -- explicit user
-- decision (fan-out, not a single priority winner).
CREATE OR REPLACE FUNCTION public.fn_trg_harvest_task_on_stage_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT hr.id
        FROM public.harvest_rules hr
        WHERE hr.condition_type = 'stage_entry'
          AND hr.source_stage_id = NEW.current_stage_id
          AND hr.is_active = TRUE
          AND hr.pipeline_id = NEW.pipeline_id
    LOOP
        PERFORM public.fn_harvest_task_output(NEW.id, r.id);
    END LOOP;
    RETURN NEW;
END;
$$;

-- ============================================================
-- Section 4: defensive backfill -- pipeline_stages.harvests_to_deliverable
-- rows get an equivalent harvest_rules row
-- ============================================================
-- Confirmed via direct prod query before writing this: 0 rows match today
-- on this repo's actual data. Pure defensive correctness for any other
-- environment where a stage still has the old toggle set -- without this,
-- such a stage would silently stop harvesting the moment this migration
-- lands, since the trigger no longer reads harvests_to_deliverable at all.
-- destination_folder_id stays NULL so the new rule uses the exact same
-- dynamic per-project fallback the stage already relies on today.
-- pipeline_stages.harvests_to_deliverable itself is NOT dropped -- inert,
-- no-longer-read dead schema, deliberate scope boundary (rpc_update_stage/
-- rpc_add_stage still reference it and are out of scope for this phase).
INSERT INTO public.harvest_rules (company_id, pipeline_id, source_stage_id, condition_type, destination_folder_id, created_by)
SELECT p.company_id, ps.pipeline_id, ps.id, 'stage_entry', NULL, NULL
FROM public.pipeline_stages ps
JOIN public.pipelines p ON p.id = ps.pipeline_id
WHERE ps.harvests_to_deliverable = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.harvest_rules hr
    WHERE hr.source_stage_id = ps.id AND hr.condition_type = 'stage_entry'
  );

-- ============================================================
-- Section 5: rpc_project_files -- read deliverable content through
-- harvested_files instead of duplicate filehub_files rows
-- ============================================================
-- Same signature (CREATE OR REPLACE safe). deliverable_files now
-- reconstructs the same JSON shape by joining harvested_files ->
-- filehub_file_versions (the source version row a pointer references) --
-- field names/shape kept identical so the frontend Files tab
-- (components/projects/ProjectFilesTab.tsx) needs zero changes.
--
-- deliverable_versions can no longer call rpc_filehub_folder_versions --
-- that RPC derives "one version = one batch_id" from filehub_file_versions
-- rows living IN the folder via folder_id, which harvested content no
-- longer does (harvested rows are pointers in harvested_files, not real
-- filehub_files rows in that folder). Since fn_harvest_task_output runs
-- inside one transaction per stage-move event, now() is constant for that
-- whole transaction -- so ALL harvested_files rows inserted by one harvest
-- event (even across multiple fan-out rules firing for the same task move)
-- share the exact same harvested_at. Grouping by harvested_at is therefore
-- the direct replacement for "group by batch_id" -- one harvest event = one
-- version, mirroring the old mechanism's unit exactly.
--
-- files_added/files_replaced: mirrors version_no=1 vs >1 from the old
-- mechanism -- a harvested_files row is "added" if no EARLIER harvested_at
-- row in the same folder already harvested a different version of the same
-- underlying source file (filehub_file_versions.file_id); otherwise it's a
-- "replaced" (a newer version of a file already harvested here before).
--
-- Deviation from the old shape, called out rather than silently changed:
-- files_touched/live_files collapse to the same count (files_touched) --
-- harvested_files rows have no "superseded" lifecycle of their own (unlike
-- the old mechanism's filehub_file_versions.superseded_at), so there is no
-- distinct "live" subset to report; in practice the old mechanism's
-- live_files was also always equal to files_touched for harvest-created
-- rows (each harvest always created a brand-new file, never a version_no>1
-- on an existing one, so nothing in that path was ever superseded either).
-- batch_id becomes the group's harvested_at timestamp (as text) rather than
-- a real batch_id UUID -- harvested_files has no batch_id column, and the
-- frontend only ever uses this field as a React list key, never displays
-- or parses it as a UUID.
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
            'id', hf.id, 'name', fv.original_name, 'mime_type', fv.mime_type,
            'size_bytes', fv.size_bytes, 'bucket', fv.bucket, 'storage_path', fv.storage_path,
            'created_at', hf.harvested_at
        ) ORDER BY hf.harvested_at DESC), '[]'::jsonb)
        INTO v_deliverable_files
        FROM public.harvested_files hf
        JOIN public.filehub_file_versions fv ON fv.id = hf.source_file_version_id
        WHERE hf.destination_folder_id = v_project.deliverable_folder_id;

        WITH h AS (
            SELECT hf.harvested_at, hf.harvested_by, fv.file_id AS source_file_id
            FROM public.harvested_files hf
            JOIN public.filehub_file_versions fv ON fv.id = hf.source_file_version_id
            WHERE hf.destination_folder_id = v_project.deliverable_folder_id
        ),
        flagged AS (
            SELECT h.*,
                   NOT EXISTS (
                       SELECT 1 FROM h h2
                       WHERE h2.source_file_id = h.source_file_id AND h2.harvested_at < h.harvested_at
                   ) AS is_added
            FROM h
        ),
        b AS (
            SELECT harvested_at AS created_at,
                   count(*)                                       AS files_touched,
                   count(*) FILTER (WHERE is_added)                AS files_added,
                   count(*) FILTER (WHERE NOT is_added)             AS files_replaced,
                   (array_agg(harvested_by ORDER BY harvested_at))[1] AS harvested_by
            FROM flagged
            GROUP BY harvested_at
        ),
        s AS (
            SELECT b.*, row_number() OVER (ORDER BY created_at) AS seq FROM b
        ),
        eff AS (
            SELECT COALESCE(max(seq), 0) AS effective_seq FROM s
        )
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'batch_id',       s.created_at::text,
            'seq',            s.seq,
            'created_at',     s.created_at,
            'files_touched',  s.files_touched,
            'files_added',    s.files_added,
            'files_replaced', s.files_replaced,
            'live_files',     s.files_touched,
            'is_effective',   (s.seq = eff.effective_seq),
            'actor',          jsonb_build_object(
                                  'id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url)
        ) ORDER BY s.seq DESC), '[]'::jsonb)
        INTO v_deliverable_versions
        FROM s
        CROSS JOIN eff
        LEFT JOIN public.users u ON u.id = s.harvested_by;
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

-- ============================================================
-- Section 6: migration self-check -- fail loudly, not silently
-- ============================================================
DO $$
DECLARE
  v_harvest_n  INT;
  v_trigger_n  INT;
BEGIN
  -- The exact overload trap this file's header warns about: confirm the
  -- old 1-arg fn_harvest_task_output signature is gone, not living
  -- alongside the new 2-arg one.
  SELECT count(*) INTO v_harvest_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'fn_harvest_task_output';
  IF v_harvest_n <> 1 THEN
    RAISE EXCEPTION 'MIGRATION FAILED: fn_harvest_task_output has % signatures, expected exactly 1 (the 2-arg form)', v_harvest_n;
  END IF;

  ASSERT (
    SELECT pg_get_function_identity_arguments(oid)
    FROM pg_proc WHERE proname = 'fn_harvest_task_output' AND pronamespace = 'public'::regnamespace
  ) = 'p_task_id uuid, p_harvest_rule_id uuid', 'fn_harvest_task_output must be the 2-arg (task_id, harvest_rule_id) form';

  SELECT count(*) INTO v_trigger_n
  FROM pg_trigger WHERE tgname = 'trg_tasks_harvest_deliverable' AND tgrelid = 'public.tasks'::regclass;
  IF v_trigger_n <> 1 THEN
    RAISE EXCEPTION 'MIGRATION FAILED: trg_tasks_harvest_deliverable must exist exactly once, found %', v_trigger_n;
  END IF;

  ASSERT (
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rpc_project_files'
  ) = 1, 'rpc_project_files must have exactly 1 signature';

  RAISE NOTICE '20260820_harvest_pointer_rewrite.sql wiring assertions passed';
END $$;
