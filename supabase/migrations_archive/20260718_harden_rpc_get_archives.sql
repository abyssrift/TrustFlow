-- ====================================================================
-- Harden rpc_get_archives: enforce archive.view server-side
--
-- rpc_get_archives is SECURITY DEFINER (bypasses RLS) but only scoped
-- results to the caller's company.  The archive.view permission was
-- enforced client-side only (TopBar canViewArchives gate before
-- calling the RPC in useGlobalSearch), so a direct RPC call from any
-- authenticated session returned every archived item in the company —
-- including archived tasks the caller never had visibility into.
--
-- Adds the server-side archive.view gate to match the UI, plus STABLE
-- and search_path hardening the original definition lacked.
-- Applied to prod (wbvgufqfgbvbinjrdzlg) 2026-07-18.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_archives(p_entity_type text DEFAULT NULL::text, p_search text DEFAULT NULL::text)
 RETURNS SETOF public.archives
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT * FROM public.archives
    WHERE company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
      AND public.has_permission('archive.view')
      AND (p_entity_type IS NULL OR entity_type = p_entity_type)
      AND (p_search IS NULL OR (
          search_vector @@ websearch_to_tsquery('english', p_search) OR
          metadata->>'title' ILIKE '%' || p_search || '%'
      ))
    ORDER BY archived_at DESC;
$function$;
