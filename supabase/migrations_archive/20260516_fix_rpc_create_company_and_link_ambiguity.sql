-- Fix ambiguous RPC_CREATE_COMPANY_AND_LINK overload
-- Drop the jsonb-returning version to resolve ambiguity
-- Keep the uuid-returning version with optional p_slug parameter

DROP FUNCTION IF EXISTS public.rpc_create_company_and_link(p_company_name text);

-- Ensure the uuid-returning version is the only one
CREATE OR REPLACE FUNCTION public.rpc_create_company_and_link(p_company_name text, p_slug text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_company_id    UUID;
  v_user_id       UUID := auth.uid();
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
  UPDATE public.users SET company_id = v_company_id, is_owner = TRUE WHERE id = v_user_id;
  
  SELECT id INTO v_owner_role_id FROM public.roles WHERE name = 'Owner' AND company_id IS NULL AND is_system = TRUE LIMIT 1;
  -- If the platform 'Owner' system role doesn't exist yet, create it so new companies
  -- can reliably inherit the owner assignment.
  IF v_owner_role_id IS NULL THEN
    INSERT INTO public.roles (name, description, color, is_system, is_default)
    VALUES ('Owner', 'Platform owner (system) role', NULL, TRUE, FALSE)
    RETURNING id INTO v_owner_role_id;
  END IF;

  -- Assign the system Owner role to the creating user for the new company
  INSERT INTO public.user_roles (user_id, role_id, company_id)
  VALUES (v_user_id, v_owner_role_id, v_company_id)
  ON CONFLICT DO NOTHING;
  RETURN v_company_id;
END;
$function$;
