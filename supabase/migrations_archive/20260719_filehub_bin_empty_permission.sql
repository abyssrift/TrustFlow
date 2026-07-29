-- 20260719_filehub_bin_empty_permission.sql
-- Issue #55: instant-empty button for the FileHub Bin, gated behind a new
-- granular permission seeded onto the Owner + Admin system roles (mirrors
-- 20260705_billing_permission.sql's seeding pattern).
--
-- rpc_filehub_bin_empty_authorize() is the authorization gate the edge
-- function (supabase/functions/purge-filehub-bin) calls before performing an
-- instant, unconditional (no 15-day wait) purge of the caller's OWN
-- company's Bin. Kept as a Postgres RPC rather than reimplemented in Deno so
-- it reuses the existing has_permission()/is_owner machinery instead of a
-- second, divergent permission check living in application code.
INSERT INTO public.permissions (key, label, description, category) VALUES
    ('filehub:bin_empty', 'Empty Bin Instantly', 'Permanently purge every file and folder currently in the company FileHub Bin, bypassing the 15-day grace period.', 'filehub')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.is_system = true
  AND r.name IN ('Owner', 'Admin')
  AND p.key = 'filehub:bin_empty'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.rpc_filehub_bin_empty_authorize()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
BEGIN
    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'No company context';
    END IF;

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('filehub:bin_empty')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to empty the Bin.';
    END IF;

    RETURN v_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_bin_empty_authorize() TO authenticated;
