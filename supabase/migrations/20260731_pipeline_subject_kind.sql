-- #172 Projects P2 -- pipelines.subject_kind discriminator.
--
-- Lets the existing pipeline/stage engine (pipeline_stages,
-- pipeline_stage_transitions, pipeline_stage_actions, visibility_permissions,
-- file_visibility, automations) define PROJECT lifecycles too, reusing all of
-- it for free instead of building a second engine (plan doc #142 sec 3.2/4).
--
-- DEFAULT 'task' is deliberate: every existing pipeline keeps behaving
-- exactly as it does today. Only pipelines explicitly created as project
-- boards (via a future pipeline-builder option) will carry 'project'.

ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS subject_kind TEXT NOT NULL DEFAULT 'task';

ALTER TABLE public.pipelines
  DROP CONSTRAINT IF EXISTS pipelines_subject_kind_check;

ALTER TABLE public.pipelines
  ADD CONSTRAINT pipelines_subject_kind_check CHECK (subject_kind IN ('task', 'project'));
