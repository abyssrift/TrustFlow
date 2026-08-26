-- 20260818_drop_old_project_create_overloads.sql
--
-- Follow-up to 20260818_append_projects_to_existing_portfolio.sql. That
-- migration's own header claimed "CREATE OR REPLACE FUNCTION with an added
-- trailing DEFAULT param preserves the function's oid/grants" — that claim
-- is wrong. Postgres keys a function's identity on its exact parameter TYPE
-- LIST, not on name + "compatible via defaults", so appending
-- p_portfolio_id / p_existing_portfolio_id created a SECOND overload
-- alongside the original 5-arg one instead of replacing it in place
-- (confirmed via pg_get_function_identity_arguments right after applying).
--
-- Every frontend call site was already updated to always pass the new
-- param, so the narrower-arity originals are unreachable dead code, not a
-- live fallback anyone depends on. Drop them so there is exactly one
-- definition per function name again.

DROP FUNCTION public.rpc_create_project(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT);
DROP FUNCTION public.rpc_instantiate_template(UUID, JSONB, JSONB, JSONB, TEXT);
