-- Route the existing client standing-folder consumer through the catalog so
-- the system name and lazy materialization policy have one owner.

CREATE OR REPLACE FUNCTION public.rpc_client_ensure_standing_folder(p_client_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_name       TEXT;
    v_folder_id  UUID;
    v_root       UUID;
    v_leaf       UUID;
BEGIN
    SELECT left(name, 80), standing_folder_id INTO v_name, v_folder_id
      FROM public.clients
     WHERE id = p_client_id
       AND company_id = v_company_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client not found.';
    END IF;
    IF v_folder_id IS NOT NULL THEN
        RETURN v_folder_id;
    END IF;

    v_root := public.rpc_filehub_get_system_folder('Client Files', 'broadcast', NULL);
    v_leaf := public.rpc_filehub_folder_create(v_name, v_root, 'broadcast', NULL, NULL);

    UPDATE public.clients
       SET standing_folder_id = v_leaf
     WHERE id = p_client_id
       AND standing_folder_id IS NULL
    RETURNING standing_folder_id INTO v_folder_id;
    IF v_folder_id IS NULL THEN
        SELECT standing_folder_id INTO v_folder_id
          FROM public.clients
         WHERE id = p_client_id;
    END IF;
    RETURN v_folder_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_client_ensure_standing_folder(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_client_ensure_standing_folder(UUID) TO authenticated;
