-- Narrow bootstrap repair for the FileHub storage bucket and its three policies.
-- The original phase1 migration is not replayed: its RPCs and unrelated policies
-- already exist, so this migration repairs only the drifted storage bootstrap.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('filehub-files', 'filehub-files', false, 524288000, NULL)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "filehub_storage_select" ON storage.objects;
CREATE POLICY "filehub_storage_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'filehub-files'
        AND auth.uid() IS NOT NULL
        AND split_part(name, '/', 1) = public.my_company_id()::text
    );

DROP POLICY IF EXISTS "filehub_storage_insert" ON storage.objects;
CREATE POLICY "filehub_storage_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'filehub-files'
        AND auth.uid() IS NOT NULL
        AND split_part(name, '/', 1) = public.my_company_id()::text
    );

DROP POLICY IF EXISTS "filehub_storage_delete" ON storage.objects;
CREATE POLICY "filehub_storage_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'filehub-files'
        AND EXISTS (
            SELECT 1
            FROM public.filehub_files f
            WHERE f.storage_path = storage.objects.name
              AND f.uploaded_by = auth.uid()
        )
    );
