-- Create company-logos storage bucket for company profile images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection, owner, created_at, updated_at)
VALUES (
  'company-logos',
  'company-logos',
  true,
  5242880,  -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  false,
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- RLS policy: allow public read access
CREATE POLICY "Public read access" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'company-logos')
;

-- RLS policy: allow authenticated users to upload to their company folder
CREATE POLICY "Allow users to upload to their company folder" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'company-logos'
    AND (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    ) IS NOT NULL
    AND path_tokens[1] = (
      SELECT company_id::text FROM public.users WHERE id = auth.uid()
    )
  )
;

-- RLS policy: allow users to update/delete their company's logos
CREATE POLICY "Allow users to manage their company logos" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'company-logos'
    AND path_tokens[1] = (
      SELECT company_id::text FROM public.users WHERE id = auth.uid()
    )
  )
;

CREATE POLICY "Allow users to delete their company logos" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'company-logos'
    AND path_tokens[1] = (
      SELECT company_id::text FROM public.users WHERE id = auth.uid()
    )
  )
;
