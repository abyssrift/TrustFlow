-- Immutable company-owned snapshots of the onboarding decision and its
-- semantic catalog provenance.

CREATE TABLE IF NOT EXISTS public.company_onboarding_profiles (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  revision                        integer NOT NULL CHECK (revision > 0),
  size_band                       text NOT NULL CHECK (size_band IN ('solo', 'small', 'growing', 'scaling')),
  operating_models                text[] NOT NULL CHECK (cardinality(operating_models) > 0),
  answers                         jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  resolved_profile                jsonb NOT NULL CHECK (jsonb_typeof(resolved_profile) = 'object'),
  applied_catalog_installations   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applied_catalog_installations) = 'array'),
  idempotency_key                 uuid NOT NULL,
  completed_by                    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, revision),
  UNIQUE (company_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_onboarding_profiles_current
  ON public.company_onboarding_profiles (company_id, completed_at DESC, revision DESC);
CREATE INDEX IF NOT EXISTS idx_company_onboarding_profiles_company
  ON public.company_onboarding_profiles (company_id, revision DESC);

CREATE TABLE IF NOT EXISTS public.company_onboarding_profile_catalog_entries (
  profile_id       uuid NOT NULL REFERENCES public.company_onboarding_profiles(id) ON DELETE CASCADE,
  catalog_key      text NOT NULL,
  catalog_version  integer NOT NULL,
  catalog_role     text NOT NULL CHECK (catalog_role IN ('size_band', 'operating_model_overlay')),
  ordinal          integer NOT NULL CHECK (ordinal > 0),
  PRIMARY KEY (profile_id, catalog_key, catalog_version),
  UNIQUE (profile_id, ordinal),
  FOREIGN KEY (catalog_key, catalog_version)
    REFERENCES public.platform_catalog_entries(catalog_key, version)
);

CREATE INDEX IF NOT EXISTS idx_company_onboarding_profile_catalog_key
  ON public.company_onboarding_profile_catalog_entries (catalog_key, catalog_version);

CREATE OR REPLACE FUNCTION public.fn_company_onboarding_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  RAISE EXCEPTION 'onboarding profiles are immutable snapshots';
END;
$function$;

DROP TRIGGER IF EXISTS company_onboarding_profile_immutable_trg
  ON public.company_onboarding_profiles;
CREATE TRIGGER company_onboarding_profile_immutable_trg
  BEFORE UPDATE OR DELETE ON public.company_onboarding_profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_company_onboarding_profile_guard();

ALTER TABLE public.company_onboarding_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_onboarding_profile_catalog_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_onboarding_profiles_read ON public.company_onboarding_profiles;
CREATE POLICY company_onboarding_profiles_read
  ON public.company_onboarding_profiles FOR SELECT TO authenticated
  USING (company_onboarding_profiles.company_id = public.my_company_id());

DROP POLICY IF EXISTS company_onboarding_profile_catalog_read ON public.company_onboarding_profile_catalog_entries;
CREATE POLICY company_onboarding_profile_catalog_read
  ON public.company_onboarding_profile_catalog_entries FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.company_onboarding_profiles p
     WHERE p.id = company_onboarding_profile_catalog_entries.profile_id
       AND p.company_id = public.my_company_id()
  ));

REVOKE ALL ON public.company_onboarding_profiles,
               public.company_onboarding_profile_catalog_entries
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.company_onboarding_profiles,
               public.company_onboarding_profile_catalog_entries
  TO authenticated;

REVOKE ALL ON FUNCTION public.fn_company_onboarding_profile_guard() FROM PUBLIC, anon, authenticated;
