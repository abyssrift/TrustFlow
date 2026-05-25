-- Fix rpc_create_company_and_link: was using UPDATE which silently does nothing
-- if the caller's public.users row was deleted (e.g. cascade from company delete).
-- Changed to UPSERT so the profile row is always created/updated atomically.

CREATE OR REPLACE FUNCTION public.rpc_create_company_and_link(p_company_name text, p_slug text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_company_id    UUID;
  v_user_id       UUID := auth.uid();
  v_user_email    TEXT;
  v_owner_role_id UUID;
  v_final_slug    TEXT;
BEGIN
  IF p_slug IS NULL OR p_slug = '' THEN
    v_final_slug := REGEXP_REPLACE(LOWER(p_company_name), '[^a-z0-9]+', '-', 'g');
    v_final_slug := TRIM(BOTH '-' FROM v_final_slug);
    IF EXISTS (SELECT 1 FROM public.companies WHERE slug = v_final_slug) THEN
      v_final_slug := v_final_slug || '-' || SUBSTR(MD5(RANDOM()::TEXT), 1, 4);
    END IF;
  ELSE v_final_slug := p_slug; END IF;

  INSERT INTO public.companies (name, slug) VALUES (p_company_name, v_final_slug) RETURNING id INTO v_company_id;

  -- Fetch email from auth so we can upsert the profile even if it was deleted
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- UPSERT: handles both new profiles and orphaned accounts whose row was cascade-deleted
  INSERT INTO public.users (id, email, company_id, is_owner, is_active)
  VALUES (v_user_id, v_user_email, v_company_id, TRUE, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET company_id = EXCLUDED.company_id,
        is_owner   = TRUE,
        is_active  = TRUE;

  SELECT id INTO v_owner_role_id FROM public.roles WHERE name = 'Owner' AND company_id IS NULL AND is_system = TRUE LIMIT 1;
  IF v_owner_role_id IS NULL THEN
    INSERT INTO public.roles (name, description, color, is_system, is_default)
    VALUES ('Owner', 'Platform owner (system) role', NULL, TRUE, FALSE)
    RETURNING id INTO v_owner_role_id;
  END IF;

  INSERT INTO public.user_roles (user_id, role_id, company_id)
  VALUES (v_user_id, v_owner_role_id, v_company_id)
  ON CONFLICT DO NOTHING;

  RETURN v_company_id;
END;
$function$;
