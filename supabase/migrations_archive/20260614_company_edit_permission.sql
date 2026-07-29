-- Add missing columns to companies table for profile customization
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS website TEXT;

-- Add new permission for editing company profile
INSERT INTO public.permissions (key, label, description, category)
VALUES ('company.edit', 'Edit Company Profile', 'Update company name, logo, description, and website.', 'company')
ON CONFLICT (key) DO NOTHING;

-- Seed the permission onto system admin roles
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.is_system = TRUE AND r.name ILIKE '%admin%'
  AND p.key = 'company.edit'
ON CONFLICT DO NOTHING;

-- RPC to update company profile (must have company.edit permission)
CREATE OR REPLACE FUNCTION public.rpc_update_company(
  p_name        TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_logo_url    TEXT DEFAULT NULL,
  p_website     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Permission check
  IF NOT public.has_permission('company.edit') THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  -- Get caller's company
  SELECT company_id INTO v_company_id FROM public.users WHERE id = auth.uid();
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No company found');
  END IF;

  -- Update company fields
  UPDATE public.companies SET
    name        = COALESCE(p_name,        name),
    description = COALESCE(p_description, description),
    logo_url    = COALESCE(p_logo_url,    logo_url),
    website     = COALESCE(p_website,     website),
    updated_at  = NOW()
  WHERE id = v_company_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
