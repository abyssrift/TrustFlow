-- Draft answers belong to one user and are only writable through the draft
-- RPC. They are resumable state, not company resources.

CREATE TABLE IF NOT EXISTS public.user_onboarding_drafts (
  user_id          uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  branch           text NOT NULL CHECK (branch IN ('join', 'create')),
  step_key         text NOT NULL CHECK (step_key = btrim(step_key) AND step_key <> ''),
  answers          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  idempotency_key  uuid NOT NULL,
  revision         integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  completed_at     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_drafts_updated
  ON public.user_onboarding_drafts (updated_at DESC);

ALTER TABLE public.user_onboarding_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_onboarding_drafts_read ON public.user_onboarding_drafts;
CREATE POLICY user_onboarding_drafts_read
  ON public.user_onboarding_drafts FOR SELECT TO authenticated
  USING (user_onboarding_drafts.user_id = auth.uid());

REVOKE ALL ON public.user_onboarding_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_onboarding_drafts TO authenticated;
