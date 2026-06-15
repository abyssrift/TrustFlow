-- RPC to remove a user from the current company (soft delete via company_id = NULL)
CREATE OR REPLACE FUNCTION public.rpc_remove_user_from_company(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_company_id UUID;
  v_target_user_company_id UUID;
BEGIN
  -- Permission check: user must have role.manage permission
  IF NOT public.has_permission('role.manage') THEN
    RETURN jsonb_build_object('error', 'Permission denied: role.manage required');
  END IF;

  -- Get caller's company
  SELECT company_id INTO v_company_id FROM public.users WHERE id = auth.uid();
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No company context found');
  END IF;

  -- Verify target user is in the same company
  SELECT company_id INTO v_target_user_company_id FROM public.users WHERE id = p_user_id;
  IF v_target_user_company_id IS NULL OR v_target_user_company_id != v_company_id THEN
    RETURN jsonb_build_object('error', 'User not found in this company');
  END IF;

  -- Prevent self-removal
  IF p_user_id = auth.uid() THEN
    RETURN jsonb_build_object('error', 'Cannot remove yourself from the company');
  END IF;

  -- Soft delete: clear company_id for the user
  UPDATE public.users
  SET company_id = NULL, updated_at = NOW()
  WHERE id = p_user_id AND company_id = v_company_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
