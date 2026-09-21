-- Keep catalog seeders and trigger handlers private. Public callers use the
-- authenticated company-creation/bootstrap wrappers only.

REVOKE ALL ON FUNCTION public.fn_seed_company_default_roles(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_fn_seed_company_default_roles() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_fn_seed_company_default_notification_rules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_platform_catalog_entries_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_create_company_and_link(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_company_and_link(text,text) TO authenticated;
