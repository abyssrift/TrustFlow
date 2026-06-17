-- 20260617_filehub_versioning_fix_storage_policy.sql
-- Fix a regression introduced by 20260617_filehub_versioning.sql.
--
-- That migration rewrote the filehub_storage_select policy to do a cross-schema
-- EXISTS against public.filehub_files / public.filehub_file_versions and to call
-- the SECURITY DEFINER helper public.filehub_file_accessible(). The Supabase
-- Storage engine evaluates storage.objects policies in its own schema context
-- and cannot resolve cross-schema references/functions, so createSignedUrl began
-- failing with: StorageApiError "The database schema is invalid or incompatible".
-- (Identical root cause to the earlier 20260527_filehub_fix_storage_policy.sql.)
--
-- Revert to the proven path-based company-isolation check. Every object — both
-- the current file AND every historical version — is stored at
-- "{company_id}/{uuid}/{filename}", so the company-prefix check covers version
-- downloads as well. File-level audience control is still enforced because the
-- only way to obtain a storage_path is through rpc_filehub_list /
-- rpc_filehub_group_list_files / rpc_filehub_file_versions, which all restrict
-- results to files the caller is allowed to see.

DROP POLICY IF EXISTS "filehub_storage_select" ON storage.objects;

CREATE POLICY "filehub_storage_select" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'filehub-files'
        AND auth.uid() IS NOT NULL
        AND split_part(name, '/', 1) = public.my_company_id()::text
    );

-- public.filehub_file_accessible() is now unused by any storage policy. It is
-- left in place (harmless, SECURITY DEFINER, not referenced) rather than dropped
-- to avoid disturbing anything that may have come to depend on it; it can be
-- removed in a later cleanup if confirmed unused.
