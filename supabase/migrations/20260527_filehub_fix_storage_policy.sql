-- 20260527_filehub_fix_storage_policy.sql
-- Fix: StorageApiError "The database schema is invalid or incompatible"
--
-- Root cause: the original filehub_storage_select policy did a cross-schema
-- JOIN from storage.objects → public.filehub_files. Supabase Storage evaluates
-- storage policies in its own internal schema context and cannot resolve JOINs
-- to public tables, causing createSignedUrl to fail with the schema error.
--
-- Fix: replace with a path-based company-isolation check. The storage path is
-- always "{company_id}/{file_id}/{filename}", so we can gate on the first
-- path segment matching the caller's company. File-level access control is
-- already enforced by RLS on filehub_files and the SECURITY DEFINER RPCs.

DROP POLICY IF EXISTS "filehub_storage_select" ON storage.objects;

CREATE POLICY "filehub_storage_select" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'filehub-files'
        AND auth.uid() IS NOT NULL
        AND split_part(name, '/', 1) = public.my_company_id()::text
    );
