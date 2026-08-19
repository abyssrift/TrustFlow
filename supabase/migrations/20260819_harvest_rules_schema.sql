-- Issue #284, Phase 1: configurable, pointer-based project deliverable
-- harvesting -- schema + pointer core only (no RPC/UI surface yet).
--
-- Full plan: pointer target is a specific filehub_file_versions row (never
-- the live filehub_files row -- that would silently change a "sealed"
-- deliverable the next time the source gets replaced, the opposite of what
-- #174 built). harvest_rules is a sibling to pipeline_automations (own tiny
-- processor in a later phase), not merged into it -- but both will share the
-- SAME automation_execution_log audit trail, widened here with a nullable
-- harvest_rule_id column.
--
-- This migration ships condition_type restricted to 'stage_entry' only --
-- a faithful, behaviour-preserving port of pipeline_stages.harvests_to_
-- deliverable's exact trigger-fired semantics. 'stage_terminal_success' and
-- 'field_equals' are Phase 3 (need Phase 0's fan-out/scope decisions locked
-- first) and are deliberately NOT allowed by the CHECK constraint below.
--
-- fn_harvest_task_output, trg_tasks_harvest_deliverable, and rpc_project_files
-- are untouched here -- Phase 2 rewrites them onto harvested_files. No RPC
-- for rule CRUD -- Phase 3.

-- ============================================================
-- Section 1: harvest_rules
-- ============================================================
CREATE TABLE public.harvest_rules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pipeline_id             UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  -- NULL = "any stage" -- needed for the future stage_terminal_success
  -- condition, unused (always populated) while only stage_entry is allowed.
  source_stage_id         UUID REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  condition_type          TEXT NOT NULL,
  condition_params        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Nullable: lazily created on first fire by fn_ensure_harvest_destination_folder.
  destination_folder_id   UUID REFERENCES public.filehub_folders(id) ON DELETE SET NULL,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  priority                INTEGER NOT NULL DEFAULT 0,
  -- For future cron use (rpc_process_harvest_rules, Phase 3) -- inert for
  -- v1's trigger-fired-only condition set, mirrors pipeline_automations'
  -- own column + check so a later shared processor needs no new plumbing.
  check_interval_minutes  INTEGER NOT NULL DEFAULT 60,
  last_run_at             TIMESTAMPTZ,
  created_by              UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_harvest_rules_interval CHECK (check_interval_minutes >= 1),
  -- Phase 1: only today's exact behaviour is reachable. Widen this CHECK
  -- (not the column type) when stage_terminal_success/field_equals ship.
  CONSTRAINT ck_harvest_rules_condition_type CHECK (condition_type = 'stage_entry')
);

CREATE INDEX idx_harvest_rules_company ON public.harvest_rules (company_id);
CREATE INDEX idx_harvest_rules_pipeline ON public.harvest_rules (pipeline_id);
CREATE INDEX idx_harvest_rules_source_stage ON public.harvest_rules (source_stage_id) WHERE source_stage_id IS NOT NULL;

ALTER TABLE public.harvest_rules ENABLE ROW LEVEL SECURITY;

-- Modeled directly on task_pipeline_links (20260805_task_pipeline_links.sql):
-- compose through the referenced entity's OWN RLS rather than re-deriving
-- pipelines' visibility_permissions logic here. pipelines_select already
-- gates on owner/system.view_all_data/empty-visibility/role membership --
-- the EXISTS subquery runs as the querying role, so that policy filters it
-- for us for free.
CREATE POLICY "HarvestRules: select by company" ON public.harvest_rules
  FOR SELECT USING (
    company_id = public.my_company_id()
    AND EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = harvest_rules.pipeline_id)
  );
-- No INSERT/UPDATE/DELETE policy -- all writes go through SECURITY DEFINER
-- RPCs in Phase 3, same convention as task_pipeline_links.

-- ============================================================
-- Section 2: harvested_files -- the pointer table
-- ============================================================
CREATE TABLE public.harvested_files (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  harvest_rule_id          UUID NOT NULL REFERENCES public.harvest_rules(id) ON DELETE CASCADE,
  -- Deliberate ON DELETE RESTRICT (not CASCADE, not SET NULL): a harvested
  -- pointer must never silently vanish because someone edited the source's
  -- version history. This is also why purge-filehub-versions/index.ts must
  -- skip any version still referenced here (see Section 4).
  source_file_version_id  UUID NOT NULL REFERENCES public.filehub_file_versions(id) ON DELETE RESTRICT,
  destination_folder_id   UUID NOT NULL REFERENCES public.filehub_folders(id) ON DELETE RESTRICT,
  source_task_id          UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  source_project_id       UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  harvested_by            UUID REFERENCES public.users(id) ON DELETE SET NULL,
  harvested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Same one-subject-populated shape automation_execution_log already uses
  -- informally for task_id/project_id (ck_auto_log_one_subject) -- made a
  -- real CHECK here since this table is written fresh.
  CONSTRAINT ck_harvested_files_one_subject CHECK ((source_task_id IS NULL) <> (source_project_id IS NULL)),
  -- The direct, principled replacement for the storage_path-coincidence
  -- dedup logic in 20260818_filehub_dedupe_unique_indexes.sql /
  -- 20260818_filehub_task_project_dedupe_lock.sql. Those two migrations'
  -- harvest-specific branches become dead code once Phase 2 ships (noted as
  -- superseded here, not ripped out in this pass).
  CONSTRAINT uq_harvested_files_dest_version UNIQUE (destination_folder_id, source_file_version_id)
);

CREATE INDEX idx_harvested_files_rule ON public.harvested_files (harvest_rule_id);
CREATE INDEX idx_harvested_files_company ON public.harvested_files (company_id);
CREATE INDEX idx_harvested_files_task ON public.harvested_files (source_task_id) WHERE source_task_id IS NOT NULL;
CREATE INDEX idx_harvested_files_project ON public.harvested_files (source_project_id) WHERE source_project_id IS NOT NULL;
CREATE INDEX idx_harvested_files_version ON public.harvested_files (source_file_version_id);

ALTER TABLE public.harvested_files ENABLE ROW LEVEL SECURITY;

-- Folder accessibility is the correct floor once this is genuinely FileHub
-- content, not a re-check of task/project visibility (plan, Data model
-- section). Same composition technique as harvest_rules above -- the EXISTS
-- runs under filehub_folders' own "filehub_folders_select_company" policy
-- (company_id = my_company_id() AND deleted_at IS NULL), so a destination
-- folder that's been soft-deleted also stops being visible here for free.
CREATE POLICY "HarvestedFiles: select by folder access" ON public.harvested_files
  FOR SELECT USING (
    company_id = public.my_company_id()
    AND EXISTS (SELECT 1 FROM public.filehub_folders fo WHERE fo.id = harvested_files.destination_folder_id)
  );
-- No INSERT/UPDATE/DELETE policy -- all writes go through SECURITY DEFINER
-- RPCs in Phase 2/3, same convention as task_pipeline_links.

-- ============================================================
-- Section 3: fn_ensure_harvest_destination_folder
-- ============================================================
-- Modeled on fn_project_ensure_deliverable_folder (20260801_project_
-- deliverable.sql): lazy get-or-create, row-locks harvest_rules to avoid
-- duplicate creation under concurrency. UNLIKE that function, this one does
-- NOT blindly trust a cached destination_folder_id -- fn_project_ensure_
-- deliverable_folder has a live bug where a soft-deleted deliverable_
-- folder_id is returned as-is forever. Here, a cached folder is only reused
-- if it's still live (deleted_at IS NULL); otherwise a fresh replacement
-- folder is created and the rule's pointer is repointed at it.
--
-- Destination scope: 'broadcast' (mirrors rpc_client_ensure_standing_folder's
-- root folder) -- a harvest rule is keyed off pipeline_id, not a single
-- project/group, so there's no natural project/group scope to inherit.
-- Named uniquely per rule (name includes the rule id) since filehub_folders'
-- root-uniqueness index has no group_id/project_id to disambiguate broadcast
-- folders by.
CREATE OR REPLACE FUNCTION public.fn_ensure_harvest_destination_folder(p_harvest_rule_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID;
    v_folder_id  UUID;
    v_name       TEXT;
    v_deleted_at TIMESTAMPTZ;
BEGIN
    SELECT hr.company_id, hr.destination_folder_id,
           left('Harvest - ' || p.name || ' (' || left(hr.id::text, 8) || ')', 80)
      INTO v_company_id, v_folder_id, v_name
    FROM public.harvest_rules hr
    JOIN public.pipelines p ON p.id = hr.pipeline_id
    WHERE hr.id = p_harvest_rule_id
    FOR UPDATE OF hr;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_folder_id IS NOT NULL THEN
        SELECT deleted_at INTO v_deleted_at FROM public.filehub_folders WHERE id = v_folder_id;
        -- Only trust the cache while the folder is still live. A dead
        -- (soft-deleted) cached id falls through to create a replacement --
        -- this is the exact bug fn_project_ensure_deliverable_folder has
        -- today, fixed here rather than carried forward.
        IF v_deleted_at IS NULL THEN
            RETURN v_folder_id;
        END IF;
    END IF;

    INSERT INTO public.filehub_folders (company_id, name, created_by, parent_id, scope)
    VALUES (v_company_id, v_name, auth.uid(), NULL, 'broadcast')
    RETURNING id INTO v_folder_id;

    UPDATE public.harvest_rules
    SET destination_folder_id = v_folder_id, updated_at = now()
    WHERE id = p_harvest_rule_id;

    RETURN v_folder_id;
END;
$$;

-- ============================================================
-- Section 4: automation_execution_log -- widen with harvest_rule_id
-- ============================================================
-- Current live shape (confirmed via psql \d + pg_constraint before writing
-- this, not assumed): automation_id is NOT NULL, and the only "one subject"
-- CHECK today is ck_auto_log_one_subject on (task_id, project_id) -- there
-- is NO existing constraint tying automation_id to anything else. Since a
-- harvest-fired log row will have no automation_id at all, automation_id
-- must become nullable, and a NEW CHECK enforces "exactly one of
-- automation_id/harvest_rule_id populated" -- the same shape as
-- ck_auto_log_one_subject, applied to the actor columns instead of the
-- subject columns.
ALTER TABLE public.automation_execution_log
  ALTER COLUMN automation_id DROP NOT NULL;

ALTER TABLE public.automation_execution_log
  ADD COLUMN IF NOT EXISTS harvest_rule_id UUID REFERENCES public.harvest_rules(id) ON DELETE CASCADE;

ALTER TABLE public.automation_execution_log
  DROP CONSTRAINT IF EXISTS ck_auto_log_one_actor;
ALTER TABLE public.automation_execution_log
  ADD CONSTRAINT ck_auto_log_one_actor CHECK ((automation_id IS NULL) <> (harvest_rule_id IS NULL));

CREATE INDEX IF NOT EXISTS idx_automation_log_harvest_rule ON public.automation_execution_log (harvest_rule_id) WHERE harvest_rule_id IS NOT NULL;

-- ============================================================
-- Section 5: purge-filehub-versions FK-safety (plan: "must land in Phase 1,
-- not deferred")
-- ============================================================
-- No new SQL object needed: supabase/functions/purge-filehub-versions/index.ts
-- already queries `harvested_files.source_file_version_id` and excludes
-- those ids from its purge candidate set/delete WHERE clause -- confirmed by
-- reading the file before writing this migration. That exclusion was inert
-- until now (the table didn't exist); Section 2 above is what makes it real.
-- No FK-violation risk once harvested_files starts getting real rows in
-- Phase 2.

-- ============================================================
-- Section 6: migration self-check -- fail loudly, not silently
-- ============================================================
DO $$
DECLARE
  v_n INT;
BEGIN
  ASSERT (SELECT to_regclass('public.harvest_rules')) IS NOT NULL, 'harvest_rules table missing';
  ASSERT (SELECT to_regclass('public.harvested_files')) IS NOT NULL, 'harvested_files table missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'harvest_rules' AND column_name = 'condition_type'
  ), 'harvest_rules.condition_type missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'harvested_files' AND column_name = 'source_file_version_id'
  ), 'harvested_files.source_file_version_id missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'automation_execution_log' AND column_name = 'harvest_rule_id'
  ), 'automation_execution_log.harvest_rule_id missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_harvest_rules_condition_type'
  ), 'ck_harvest_rules_condition_type missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_harvested_files_one_subject'
  ), 'ck_harvested_files_one_subject missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_harvested_files_dest_version'
  ), 'uq_harvested_files_dest_version missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_auto_log_one_actor'
  ), 'ck_auto_log_one_actor missing';

  ASSERT (
    SELECT count(*) FROM pg_policy WHERE polrelid = 'public.harvest_rules'::regclass
  ) = 1, 'harvest_rules must have exactly 1 RLS policy (SELECT-only)';

  ASSERT (
    SELECT count(*) FROM pg_policy WHERE polrelid = 'public.harvested_files'::regclass
  ) = 1, 'harvested_files must have exactly 1 RLS policy (SELECT-only)';

  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'fn_ensure_harvest_destination_folder';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'MIGRATION FAILED: fn_ensure_harvest_destination_folder has % signatures, expected exactly 1', v_n;
  END IF;

  RAISE NOTICE '20260819_harvest_rules_schema.sql wiring assertions passed';
END $$;
