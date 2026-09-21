-- Remove every historical permissive archive policy. PostgreSQL OR-combines
-- permissive policies, so retaining any company-wide policy bypasses the
-- archive-principal predicate.
DROP POLICY IF EXISTS archives_select_scoped ON public.archives;
DROP POLICY IF EXISTS "Archives are viewable by company members" ON public.archives;
DROP POLICY IF EXISTS "Archives can be created by company members" ON public.archives;
DROP POLICY IF EXISTS "Users can view archives of their company" ON public.archives;
DROP POLICY IF EXISTS "Users can delete archives of their company" ON public.archives;
DROP POLICY IF EXISTS "Users can insert archives for their company" ON public.archives;

CREATE POLICY archives_select_scoped ON public.archives
FOR SELECT TO authenticated
USING (public.fn_archive_accessible(id, 'view'));

REVOKE ALL ON TABLE public.archives FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.archives TO authenticated;
