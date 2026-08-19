-- Issue #284, Phase 2 follow-up: fn_harvest_task_output must stamp
-- harvested_files.harvested_at with clock_timestamp(), not the column's
-- now() default.
--
-- Bug: harvested_files.harvested_at defaults to now() (set in Phase 1,
-- 20260819_harvest_rules_schema.sql). now() is FROZEN at transaction start
-- in Postgres -- it does not advance between statements in the same
-- transaction, unlike clock_timestamp() which returns the real, advancing
-- wall-clock time on every call. rpc_project_files' deliverable_versions
-- groups harvested_files rows by harvested_at to derive "one harvest event
-- = one version" (see 20260820_harvest_pointer_rewrite.sql Section 5).
-- Two genuinely separate harvest events (e.g. a task re-submits and
-- re-enters the harvesting stage a second time) that happen to land in the
-- SAME database transaction -- easy in a test/check harness, and possible
-- in production if a caller wraps multiple stage moves in one transaction
-- -- got the identical now() value and were wrongly merged into one
-- version group instead of two. Confirmed via check_project_deliverable.sql
-- assertion (4f): expected 2 deliverable-version groups, got 1.
--
-- Fix: compute v_harvested_at := clock_timestamp() ONCE near the top of the
-- function (before the loop over submission attachments) and pass it
-- explicitly into every harvested_files row that ONE call inserts. Computed
-- once, not per-row -- all files harvested by one call (all attachments of
-- one submission, promoted by one rule) are ONE harvest event and must
-- share one timestamp; computing it inside the loop would fragment one
-- event into N single-file "versions", a different and worse bug.
--
-- Same 2-arg signature as the Phase 2 CREATE -- body-only change, no DROP
-- needed (CREATE OR REPLACE is safe when the argument list is unchanged;
-- see the overload footgun this migration's predecessor already warns
-- about in its header).
CREATE OR REPLACE FUNCTION public.fn_harvest_task_output(p_task_id UUID, p_harvest_rule_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task          RECORD;
    v_rule_dest     UUID;
    v_folder_id     UUID;
    v_submission    UUID;
    v_actor         UUID := auth.uid();
    v_harvested_at  TIMESTAMPTZ := clock_timestamp();
    r               RECORD;
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
            source_task_id, company_id, harvested_by, harvested_at
        ) VALUES (
            p_harvest_rule_id, r.version_id, v_folder_id,
            p_task_id, v_task.company_id, v_actor, v_harvested_at
        )
        ON CONFLICT (destination_folder_id, source_file_version_id) DO NOTHING;
    END LOOP;
END;
$$;

-- ============================================================
-- Self-check: signature unchanged, still exactly one overload
-- ============================================================
DO $$
BEGIN
  ASSERT (
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_harvest_task_output'
  ) = 1, 'fn_harvest_task_output must have exactly 1 signature after this fix';

  ASSERT (
    SELECT pg_get_function_identity_arguments(oid)
    FROM pg_proc WHERE proname = 'fn_harvest_task_output' AND pronamespace = 'public'::regnamespace
  ) = 'p_task_id uuid, p_harvest_rule_id uuid', 'fn_harvest_task_output must remain the 2-arg (task_id, harvest_rule_id) form';

  RAISE NOTICE '20260820_harvest_timestamp_fix.sql wiring assertions passed';
END $$;
