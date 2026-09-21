-- Per-person, per-company guide progress. Guide rows are keyed by stable guide
-- identity, never by the set of guides currently eligible to a user.
CREATE TABLE IF NOT EXISTS public.user_guide_progress (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  guide_id text NOT NULL CHECK (guide_id = btrim(guide_id) AND guide_id <> ''),
  guide_version integer NOT NULL CHECK (guide_version > 0),
  status text NOT NULL CHECK (status IN ('not_started', 'in_progress', 'done', 'familiar')),
  current_step integer NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  first_eligible_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id, guide_id),
  CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  CHECK (first_eligible_at <= updated_at),
  CHECK (acknowledged_at IS NULL OR (acknowledged_at >= first_eligible_at AND acknowledged_at <= updated_at)),
  CHECK (completed_at IS NULL OR (completed_at >= first_eligible_at AND completed_at <= updated_at)),
  CHECK (status NOT IN ('familiar', 'done') OR acknowledged_at IS NOT NULL)
);

-- This file was previously applied in an uncommitted state. Upgrade its
-- account-only table in place and retain every row for users with a company.
ALTER TABLE public.user_guide_progress ADD COLUMN IF NOT EXISTS company_id uuid;
UPDATE public.user_guide_progress AS progress
   SET company_id = users.company_id
  FROM public.users
 WHERE users.id = progress.user_id AND progress.company_id IS NULL;
ALTER TABLE public.user_guide_progress ALTER COLUMN company_id SET NOT NULL;

DO $migration$
DECLARE v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.user_guide_progress'::regclass AND contype = 'p'
  LOOP
    EXECUTE format('ALTER TABLE public.user_guide_progress DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;
  FOR v_constraint IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.user_guide_progress'::regclass AND contype = 'c'
       AND (pg_get_constraintdef(oid) ILIKE '%status%'
         OR pg_get_constraintdef(oid) ILIKE '%completed_at%'
         OR pg_get_constraintdef(oid) ILIKE '%first_eligible_at%'
         OR pg_get_constraintdef(oid) ILIKE '%acknowledged_at%')
  LOOP
    EXECUTE format('ALTER TABLE public.user_guide_progress DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;
END;
$migration$;

ALTER TABLE public.user_guide_progress
  ADD CONSTRAINT user_guide_progress_pkey PRIMARY KEY (user_id, company_id, guide_id),
  ADD CONSTRAINT user_guide_progress_status_check
    CHECK (status IN ('not_started', 'in_progress', 'done', 'familiar')),
  ADD CONSTRAINT user_guide_progress_completion_check
    CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  ADD CONSTRAINT user_guide_progress_timestamp_order_check
    CHECK (first_eligible_at <= updated_at
      AND (acknowledged_at IS NULL OR (acknowledged_at >= first_eligible_at AND acknowledged_at <= updated_at))
      AND (completed_at IS NULL OR (completed_at >= first_eligible_at AND completed_at <= updated_at))),
  ADD CONSTRAINT user_guide_progress_acknowledgement_check
    CHECK (status NOT IN ('familiar', 'done') OR acknowledged_at IS NOT NULL);
ALTER TABLE public.user_guide_progress
  DROP CONSTRAINT IF EXISTS user_guide_progress_company_fkey;
ALTER TABLE public.user_guide_progress
  ADD CONSTRAINT user_guide_progress_company_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_user_guide_progress_company_guide
  ON public.user_guide_progress (company_id, guide_id);

CREATE OR REPLACE FUNCTION public.fn_guard_user_guide_progress_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.user_id AND u.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Guide progress user must belong to its company' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS user_guide_progress_company_guard ON public.user_guide_progress;
CREATE TRIGGER user_guide_progress_company_guard
  BEFORE INSERT OR UPDATE OF user_id, company_id ON public.user_guide_progress
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_user_guide_progress_company();

-- Persistence contract metadata only: catalog guide keys and final steps.
-- Profile v2 is a synthetic check fixture for version-reset behavior.
-- This deliberately contains no guide copy or content registry data.
CREATE OR REPLACE FUNCTION public._user_guide_progress_final_step(p_guide_id text, p_guide_version integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN p_guide_version = 1 AND p_guide_id IN (
      'profile', 'top-bar', 'tasks', 'task-workflow', 'deadlines', 'projects',
      'portfolios', 'filehub', 'filehub-sharing', 'team-people',
      'team-assignments', 'workflow-pipelines', 'intelligence'
    ) THEN 2
    -- This version exists only so the SQL check can exercise version reset.
    WHEN p_guide_version = 2 AND p_guide_id = 'profile' THEN 2
    ELSE NULL
  END
$function$;

REVOKE ALL ON FUNCTION public._user_guide_progress_final_step(text, integer) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.user_guide_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_guide_progress_read ON public.user_guide_progress;
CREATE POLICY user_guide_progress_read
  ON public.user_guide_progress FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id AND company_id = public.my_company_id());

REVOKE ALL ON public.user_guide_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_guide_progress TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_sync_user_guide_progress(p_guides jsonb)
RETURNS SETOF public.user_guide_progress
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_company_id uuid := public.my_company_id();
  v_guide record;
  v_guide_id text;
  v_guide_version integer;
BEGIN
  IF v_user_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_guides IS NULL OR jsonb_typeof(p_guides) <> 'array' THEN
    RAISE EXCEPTION 'Guides must be a JSON array';
  END IF;

  FOR v_guide IN SELECT value FROM jsonb_array_elements(p_guides)
  LOOP
    IF jsonb_typeof(v_guide.value) <> 'object'
       OR jsonb_typeof(v_guide.value -> 'guide_id') <> 'string'
       OR jsonb_typeof(v_guide.value -> 'guide_version') <> 'number'
       OR (v_guide.value ->> 'guide_version') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Each guide requires a string guide_id and positive integer guide_version';
    END IF;
    v_guide_id := v_guide.value ->> 'guide_id';
    BEGIN
      v_guide_version := (v_guide.value ->> 'guide_version')::integer;
    EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
      RAISE EXCEPTION 'Guide version is outside the supported integer range';
    END;
    IF v_guide_id IS NULL OR v_guide_id = '' OR v_guide_id <> btrim(v_guide_id) OR v_guide_version <= 0
       OR public._user_guide_progress_final_step(v_guide_id, v_guide_version) IS NULL THEN
      RAISE EXCEPTION 'Guide id/version is not a supported synced guide';
    END IF;

    INSERT INTO public.user_guide_progress AS existing
      (user_id, company_id, guide_id, guide_version, status, current_step, first_eligible_at, acknowledged_at, completed_at, updated_at)
    VALUES (v_user_id, v_company_id, v_guide_id, v_guide_version, 'not_started', 0, now(), NULL, NULL, now())
    ON CONFLICT (user_id, company_id, guide_id) DO UPDATE
      SET guide_version = EXCLUDED.guide_version,
          status = 'not_started',
          current_step = 0,
          first_eligible_at = now(),
          acknowledged_at = NULL,
          completed_at = NULL,
          updated_at = now()
      WHERE existing.guide_version < EXCLUDED.guide_version;
  END LOOP;

  RETURN QUERY
    SELECT progress.*
    FROM public.user_guide_progress AS progress
    WHERE progress.user_id = v_user_id AND progress.company_id = v_company_id
    ORDER BY progress.guide_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_user_guide_progress(
  p_guide_id text,
  p_guide_version integer,
  p_status text,
  p_current_step integer,
  p_acknowledge boolean
)
RETURNS public.user_guide_progress
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_company_id uuid := public.my_company_id();
  v_progress public.user_guide_progress%rowtype;
  v_final_step integer;
BEGIN
  IF v_user_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  v_final_step := public._user_guide_progress_final_step(p_guide_id, p_guide_version);
  IF p_guide_id IS NULL OR p_guide_id = '' OR p_guide_id <> btrim(p_guide_id)
     OR p_guide_version IS NULL OR p_guide_version <= 0 OR v_final_step IS NULL
     OR p_status IS NULL OR p_status NOT IN ('not_started', 'in_progress', 'done', 'familiar')
     OR p_current_step IS NULL OR p_current_step < 0 OR p_current_step > v_final_step
     OR (p_status = 'not_started' AND p_current_step <> 0)
     OR (p_status IN ('in_progress', 'familiar') AND NOT p_acknowledge)
     OR (p_status = 'familiar' AND p_current_step <> 0)
     OR p_acknowledge IS NULL
     OR (p_status = 'done' AND NOT p_acknowledge) THEN
    RAISE EXCEPTION 'Invalid guide progress';
  END IF;

  UPDATE public.user_guide_progress AS progress
     SET status = CASE WHEN progress.status = 'done' THEN 'done' ELSE p_status END,
         current_step = p_current_step,
         acknowledged_at = CASE WHEN p_acknowledge THEN COALESCE(progress.acknowledged_at, now()) ELSE progress.acknowledged_at END,
         completed_at = CASE WHEN progress.status = 'done' OR p_status = 'done' THEN COALESCE(progress.completed_at, now()) ELSE NULL END,
         updated_at = now()
   WHERE progress.user_id = v_user_id AND progress.company_id = v_company_id
     AND progress.guide_id = p_guide_id
     AND progress.guide_version = p_guide_version
     AND (p_status <> 'done' OR p_current_step = v_final_step OR progress.status = 'done')
     AND (p_status <> 'not_started' OR progress.status = 'not_started')
     AND (progress.status <> 'familiar' OR p_status = 'familiar')
     AND (p_status <> 'familiar' OR progress.status IN ('not_started', 'familiar'))
  RETURNING progress.* INTO v_progress;

  IF v_progress.user_id IS NULL THEN
    RAISE EXCEPTION 'Guide progress is missing, stale, or has an invalid lifecycle transition';
  END IF;
  RETURN v_progress;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_sync_user_guide_progress(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_update_user_guide_progress(text, integer, text, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_guard_user_guide_progress_company() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_sync_user_guide_progress(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_user_guide_progress(text, integer, text, integer, boolean) TO authenticated;
