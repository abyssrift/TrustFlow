-- Issue #339: create a manually-created portfolio through one guarded RPC.

CREATE OR REPLACE FUNCTION public.rpc_create_portfolio(p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id    UUID := auth.uid();
  v_is_owner   BOOLEAN;
  v_portfolio  public.portfolios;
BEGIN
  IF v_user_id IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and company membership are required.';
  END IF;

  SELECT COALESCE(u.is_owner, false)
  INTO v_is_owner
  FROM public.users AS u
  WHERE u.id = v_user_id
    AND u.company_id = v_company_id;

  IF NOT (COALESCE(v_is_owner, false) OR public.has_permission('project.create')) THEN
    RAISE EXCEPTION 'Insufficient permissions to create portfolios.';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Portfolio name is required.';
  END IF;

  INSERT INTO public.portfolios (company_id, name, source, created_by)
  VALUES (v_company_id, btrim(p_name), 'manual', v_user_id)
  RETURNING * INTO v_portfolio;

  RETURN jsonb_build_object(
    'id',         v_portfolio.id,
    'name',       v_portfolio.name,
    'source',     v_portfolio.source,
    'created_at', v_portfolio.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_create_portfolio(TEXT) TO authenticated;

COMMENT ON FUNCTION public.rpc_create_portfolio(TEXT)
  IS 'Create a manual portfolio for the caller''s company when project.create is allowed.';
