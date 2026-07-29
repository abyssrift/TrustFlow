-- Create kanban-backgrounds storage bucket for user-uploaded board background images
-- Fixes: custom uploads used a transient local file/blob URI (never persisted anywhere durable),
-- so the image broke or reset on next login. Now it's uploaded and referenced by a stable public URL.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection, owner, created_at, updated_at)
VALUES (
  'kanban-backgrounds',
  'kanban-backgrounds',
  true,
  5242880,  -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  false,
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read access for kanban backgrounds" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'kanban-backgrounds')
;

CREATE POLICY "Allow users to upload their own kanban background" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'kanban-backgrounds'
    AND path_tokens[1] = auth.uid()::text
  )
;

CREATE POLICY "Allow users to manage their own kanban background" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'kanban-backgrounds'
    AND path_tokens[1] = auth.uid()::text
  )
;

CREATE POLICY "Allow users to delete their own kanban background" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'kanban-backgrounds'
    AND path_tokens[1] = auth.uid()::text
  )
;
