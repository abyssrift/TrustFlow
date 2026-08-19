-- Local dev gap found while testing today's FileHub hardening: uploading a
-- Task Brief attachment failed with "new row violates row-level security
-- policy". Root cause has nothing to do with today's changes -- the
-- task-attachments / submission-attachments / task-submissions storage
-- buckets have NO INSERT (or UPDATE) policy on storage.objects at all, on
-- this local database. Confirmed via pg_policy: only their SELECT policies
-- exist locally (created by 20260728_file_visibility_phase2b_storage.sql's
-- ALTER POLICY, which requires the policy to pre-exist -- so even that
-- migration only works because *some* baseline CREATE POLICY ran first).
-- That baseline INSERT policy was never captured in any migration file --
-- it only ever existed as a hand-created Studio policy on the hosted
-- project. Local (built from migrations only) never got it.
--
-- This is real IaC drift worth fixing in git regardless of local testing:
-- if the hosted project's storage.objects ever needed rebuilding, these
-- buckets would be write-broken there too. Policy shape mirrors the existing
-- SELECT policies from 20260728_file_visibility_phase2b_storage.sql (path is
-- {company_id}/tasks/{task_id}/... ; task id at foldername[3]) --
-- company-scoped, plus task-accessibility-gated when the path actually
-- points into a task folder.
--
-- Turns out the SELECT policies that 20260728_file_visibility_phase2b_storage.sql
-- ALTERs don't exist locally either (that migration's ALTER POLICY only
-- works because the *original* CREATE POLICY already ran against the hosted
-- project's Studio-managed policy) -- same untracked-baseline gap, so this
-- also creates them directly in their final (already-tightened) form,
-- matching 2b's predicate exactly rather than an intermediate state.
DO $$
DECLARE
  b TEXT;
BEGIN
  FOREACH b IN ARRAY ARRAY['task-attachments', 'submission-attachments', 'task-submissions']
  LOOP
    EXECUTE format($f$
      CREATE POLICY %I ON storage.objects
        FOR INSERT WITH CHECK (
          bucket_id = %L
          AND auth.uid() IS NOT NULL
          AND (storage.foldername(name))[1] = public.my_company_id()::text
          AND (
            (storage.foldername(name))[2] IS DISTINCT FROM 'tasks'
            OR CASE WHEN (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN public.fn_task_file_accessible(((storage.foldername(name))[3])::uuid)
                    ELSE true END
          )
        )
    $f$, b || '_storage_insert', b);

    -- Covers upsert:true (replace flow) landing on an existing path.
    EXECUTE format($f$
      CREATE POLICY %I ON storage.objects
        FOR UPDATE USING (
          bucket_id = %L AND (storage.foldername(name))[1] = public.my_company_id()::text
        ) WITH CHECK (
          bucket_id = %L AND (storage.foldername(name))[1] = public.my_company_id()::text
        )
    $f$, b || '_storage_update', b, b);

    EXECUTE format($f$
      CREATE POLICY %I ON storage.objects
        FOR SELECT USING (
          bucket_id = %L
          AND (storage.foldername(name))[1] = public.my_company_id()::text
          AND (
            (storage.foldername(name))[2] IS DISTINCT FROM 'tasks'
            OR owner = auth.uid()
            OR CASE WHEN (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN public.fn_task_file_accessible(((storage.foldername(name))[3])::uuid)
                    ELSE true END
          )
        )
    $f$, b || '_storage_select', b);
  END LOOP;
END $$;
