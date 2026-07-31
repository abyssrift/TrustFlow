-- #172 Projects P2 -- terminology layer.
--
-- One jsonb on companies mapping level names to display labels, so a firm
-- sees "Engagement" and an agency sees "Campaign" over the same schema
-- (plan doc "Project Hierarchy Plan" #142, section 2/4). Additive only.
--
-- Shape: { "project": "Engagement", "task": "Filing", ... } -- keys are the
-- fixed schema levels (client/portfolio/project/task), values are the
-- per-company display label. Missing keys fall back to the default English
-- label in app code; this column only ever overrides.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS terminology_labels JSONB NOT NULL DEFAULT '{}'::jsonb;
