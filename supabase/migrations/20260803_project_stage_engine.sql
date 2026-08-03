-- ====================================================================
-- Issue #142 Phase 12 — projects get the pipeline ENGINE, not just a
-- stage column.  Plan: docs/PROJECT_HIERARCHY_PLAN.md §20.
--
-- SCOPE (§20.4, decided): automations and notifications ONLY.
--   NOT gates (requires_submission / requires_timer / preconditions),
--   NOT stage action buttons, NOT review-by-transition.  Those stay
--   deferred and the pipeline editor stops offering them for
--   subject_kind='project' in the same change (§20.6).
--
-- Nothing here adds a pipeline concept to projects.  Projects already
-- have pipeline_id / current_stage_id / trigger-written
-- project_stage_history (Phase 2).  The only question was what FIRES on
-- a stage change, and the answer is two things.
-- ====================================================================


-- ────────────────────────────────────────────────────────────────────
-- 1. WHO HEARS ABOUT A PROJECT STAGE CHANGE
-- ────────────────────────────────────────────────────────────────────
-- DECISION, stated explicitly because §20 asks for it:
--
--   Recipients = every user in the project's company for whom
--   fn_project_accessible(project) is TRUE.
--
-- In practice that resolves to: the project OWNER, anyone ASSIGNED a
-- task in it (directly or through a team), and every holder of
-- project.view_all — because those are exactly fn_project_accessible's
-- three branches.  The actor who moved the stage is dropped later by
-- process-notification-event (step 3 of that function), same as every
-- other event type; this function does not special-case them.
--
-- WHY IT IS WRITTEN THIS WAY.  §13.14 says one predicate, and the
-- fifth call site does not get to become a sixth definition.  A boolean
-- predicate cannot be inverted into a set, so this enumerates a
-- CANDIDATE set and then filters it through the real predicate,
-- evaluated as each candidate.  The candidate set is deliberately the
-- widest possible one (the whole company) so that it can never be the
-- thing that decides access — it is a generator, not a rule.  If
-- fn_project_accessible tightens tomorrow, this follows for free.
--
-- ponytail: O(company users) fn_project_accessible calls per stage
-- move.  Fine for a firm-sized tenant and for an hourly automation
-- sweep; if a large tenant makes this hot, add a cheap WIDER pre-filter
-- to the candidate query (owner / has an assignment / holds
-- project.view_all) — never a narrower one, and never a second copy of
-- the predicate.
CREATE OR REPLACE FUNCTION public.fn_project_stage_notify_recipients(p_project_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Saved so the caller's transaction is left exactly as we found it.
  -- set_config(..., is_local := true) lasts to end of transaction, and
  -- this runs inside somebody else's statement.
  v_prev_claims TEXT := current_setting('request.jwt.claims', true);
  v_prev_sub    TEXT := current_setting('request.jwt.claim.sub', true);
  v_candidates  uuid[];
  v_uid         uuid;
  v_out         uuid[] := '{}';
BEGIN
  SELECT COALESCE(array_agg(u.id), '{}')
  INTO   v_candidates
  FROM   public.users u
  WHERE  u.deleted_at IS NULL
    AND  u.is_active
    AND  u.company_id = (
           SELECT p.company_id FROM public.projects p
           WHERE p.id = p_project_id AND p.deleted_at IS NULL
         );

  FOREACH v_uid IN ARRAY v_candidates LOOP
    -- auth.uid() coalesces request.jwt.claim.sub (legacy) with
    -- request.jwt.claims->>'sub'; both have to move or the legacy one
    -- wins and every candidate is evaluated as the real caller.
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    PERFORM set_config(
      'request.jwt.claims',
      json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
      true
    );
    IF public.fn_project_accessible(p_project_id) THEN
      v_out := v_out || v_uid;
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
  PERFORM set_config('request.jwt.claims',    COALESCE(v_prev_claims, ''), true);

  RETURN v_out;
END;
$$;


-- ────────────────────────────────────────────────────────────────────
-- 2. THE TRIGGER — mirrors fn_trg_tasks_notify_update
-- ────────────────────────────────────────────────────────────────────
-- Notifications in this app are trigger-based, not inline:
-- fn_emit_notification_event is the one entry point and
-- process-notification-event resolves recipients from
-- notification_rules.  So this is ONE trigger calling the same entry
-- point, not a second notification path.
--
-- Recipients ride in the payload rather than being resolved by the Edge
-- Function, because the "never notify someone who cannot see the
-- project" guarantee has to be enforced next to fn_project_accessible
-- (which is auth.uid()-bound and unreachable from a service-role
-- client) — and because that is what makes it provable from SQL.
-- The Edge Function consumes them with the payload_users strategy.
CREATE OR REPLACE FUNCTION public.fn_trg_projects_notify_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_name TEXT;
  v_actor_id   UUID := auth.uid();  -- NULL for system/cron operations
BEGIN
  -- Same suppression rpc_instantiate_template uses for per-task
  -- notifications: a bulk batch emits one event, not one per row.
  IF current_setting('trustflow.bulk_instantiate', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_stage_name
  FROM   public.pipeline_stages
  WHERE  id = NEW.current_stage_id;

  PERFORM public.fn_emit_notification_event(
    'project.stage_transition',
    'project',
    NEW.id,
    v_actor_id,
    jsonb_build_object(
      'project_id',         NEW.id,
      'project_name',       NEW.name,
      'pipeline_id',        NEW.pipeline_id,
      'from_stage_id',      OLD.current_stage_id,
      'to_stage_id',        NEW.current_stage_id,
      'stage_tag',          LOWER(REPLACE(COALESCE(v_stage_name, ''), ' ', '_')),
      'recipient_user_ids', to_jsonb(public.fn_project_stage_notify_recipients(NEW.id))
    )
  );

  RETURN NEW;
END;
$$;

-- WHEN clause copied from trg_projects_stage_history so the event and
-- the history row can never disagree about what counts as a move.
DROP TRIGGER IF EXISTS trg_projects_notify_stage ON public.projects;
CREATE TRIGGER trg_projects_notify_stage
  AFTER UPDATE OF current_stage_id ON public.projects
  FOR EACH ROW
  WHEN (NEW.current_stage_id IS DISTINCT FROM OLD.current_stage_id
        AND NEW.current_stage_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_trg_projects_notify_stage();


-- ────────────────────────────────────────────────────────────────────
-- 3. THE RULE — same seed shape as 20260515_notification_fixes.sql
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT id INTO v_owner_id FROM public.users WHERE is_owner = TRUE LIMIT 1;
  IF v_owner_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.notification_rules
    (name, description, event_type, conditions,
     recipient_strategies, recipient_config, is_active, created_by)
  SELECT
    'Project Stage Moved',
    'Notify everyone who can see a project when it moves to a new stage. '
    || 'Recipients are resolved in the database by fn_project_accessible '
    || 'and carried in the event payload.',
    'project.stage_transition', '{}',
    ARRAY['payload_users'],
    '{"payload_field": "recipient_user_ids"}'::JSONB,
    TRUE, v_owner_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_rules
    WHERE event_type = 'project.stage_transition'
  );
END;
$$;


-- ────────────────────────────────────────────────────────────────────
-- 4. AUTOMATIONS FOR PROJECT STAGES
-- ────────────────────────────────────────────────────────────────────
-- pipeline_automations needs NO change: it keys on pipeline_id +
-- source_stage_id + target_stage_id, and projects use the same
-- pipelines / pipeline_stages tables (subject_kind distinguishes them).
-- rpc_create/update/delete_automation are already subject-agnostic.
-- Verified against the live definitions before relying on it.
--
-- automation_execution_log DOES need one: task_id is NOT NULL with an
-- FK to tasks, and it backs the circuit breaker (3 fires in an hour
-- disables the automation).  Dropping that guard for projects would be
-- worse than the column.  task_id becomes nullable, project_id joins
-- it, and a CHECK keeps exactly one populated.
ALTER TABLE public.automation_execution_log
  ADD COLUMN IF NOT EXISTS project_id uuid
    REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.automation_execution_log
  ALTER COLUMN task_id DROP NOT NULL;

ALTER TABLE public.automation_execution_log
  DROP CONSTRAINT IF EXISTS ck_auto_log_one_subject;
ALTER TABLE public.automation_execution_log
  ADD CONSTRAINT ck_auto_log_one_subject
  CHECK ((task_id IS NULL) <> (project_id IS NULL));

CREATE INDEX IF NOT EXISTS idx_automation_log_project_time
  ON public.automation_execution_log (project_id, executed_at)
  WHERE project_id IS NOT NULL;


-- What "automations" means here, plainly: rpc_process_automations
-- understands exactly ONE condition_type, 'overdue'.  There is no rules
-- engine.  Extending it to projects means "a project that has sat in a
-- stage past its due date moves on" — that is the whole feature.
-- (rpc_create_automation also accepts 'idle' and 'due_soon'; neither
-- has ever been implemented, for tasks either.  Out of scope here, but
-- it is the same §20.6 silent-no-op sin one level down.)
--
-- Overdue for a project reads projects.due_date, the same column
-- rpc_projects_table's days_remaining uses — the task branch reads
-- tasks.due_date.  Same condition, subject's own column.
--
-- No new signature: rpc_process_automations() takes no arguments, so
-- CREATE OR REPLACE cannot mint an overload here.  Asserted at the end.
CREATE OR REPLACE FUNCTION public.rpc_process_automations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule    RECORD;
  v_task    RECORD;
  v_project RECORD;
BEGIN
  FOR v_rule IN
    SELECT a.*, p.subject_kind
    FROM   public.pipeline_automations a
    JOIN   public.pipelines p ON p.id = a.pipeline_id
    WHERE  a.is_active = TRUE
      AND  p.deleted_at IS NULL
    ORDER BY a.priority DESC, a.created_at ASC
  LOOP
    IF v_rule.subject_kind = 'project' THEN
      FOR v_project IN
        SELECT pr.id, pr.company_id, pr.due_date
        FROM   public.projects pr
        WHERE  pr.current_stage_id = v_rule.source_stage_id
          AND  pr.deleted_at IS NULL
        LIMIT 100
      LOOP
        IF v_rule.condition_type = 'overdue' AND v_project.due_date < NOW() THEN

          IF (SELECT COUNT(*) FROM public.automation_execution_log
              WHERE project_id = v_project.id AND automation_id = v_rule.id
                AND executed_at > NOW() - INTERVAL '1 hour') >= 3
          THEN
            UPDATE public.pipeline_automations SET is_active = FALSE WHERE id = v_rule.id;
            CONTINUE;
          END IF;

          INSERT INTO public.automation_execution_log(project_id, automation_id, stage_id, company_id)
          VALUES (v_project.id, v_rule.id, v_rule.target_stage_id, v_project.company_id);

          PERFORM public.rpc_advance_project_stage(v_project.id, v_rule.target_stage_id);
        END IF;
      END LOOP;

    ELSE
      -- Unchanged task branch.
      FOR v_task IN
        SELECT t.id, t.company_id, t.due_date, t.updated_at
        FROM   public.tasks t
        WHERE  t.current_stage_id = v_rule.source_stage_id
          AND  t.deleted_at IS NULL
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

          INSERT INTO public.automation_execution_log(task_id, automation_id, stage_id, company_id)
          VALUES (v_task.id, v_rule.id, v_rule.target_stage_id, v_task.company_id);

          PERFORM public.rpc_advance_stage(v_task.id, v_rule.target_stage_id);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_project_stage_notify_recipients(uuid) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 5. Overload guard — 20260802_drop_stale_stage_rpc_overloads.sql
--    happened because CREATE OR REPLACE with a changed argument list
--    ADDS a signature.  Fail the migration rather than discover it in
--    the editor.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, count(*) AS n
    FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname IN ('rpc_process_automations',
                         'fn_project_stage_notify_recipients',
                         'fn_trg_projects_notify_stage',
                         'rpc_advance_project_stage')
    GROUP BY p.proname
  LOOP
    IF r.n <> 1 THEN
      RAISE EXCEPTION 'MIGRATION FAILED: % has % signatures, expected exactly 1', r.proname, r.n;
    END IF;
  END LOOP;
END;
$$;
