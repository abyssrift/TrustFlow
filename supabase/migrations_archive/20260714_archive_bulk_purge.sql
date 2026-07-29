-- 20260714_archive_bulk_purge.sql
-- Permanently delete archive rows (cold storage), single or bulk.

INSERT INTO public.permissions (key, label, category) VALUES
    ('archive.delete', 'Permanently Delete Archives', 'archives')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.rpc_purge_archives(p_archive_ids UUID[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_count INT;
BEGIN
    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'No company context';
    END IF;

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('archive.delete')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to delete archives.';
    END IF;

    WITH deleted AS (
        DELETE FROM public.archives
        WHERE id = ANY(p_archive_ids) AND company_id = v_company_id
        RETURNING id
    )
    SELECT count(*) INTO v_count FROM deleted;

    PERFORM public.log_event(v_company_id, auth.uid(), 'archive', NULL, 'archive.purged',
        jsonb_build_object('archive_ids', p_archive_ids, 'count', v_count));

    RETURN jsonb_build_object('deleted_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_purge_archives(UUID[]) TO authenticated;
