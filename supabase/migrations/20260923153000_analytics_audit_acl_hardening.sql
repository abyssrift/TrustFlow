-- Harden the organizational audit RPC ACL after the authorization regression check.
-- The public wrapper is the only supported caller surface; its private delegate
-- must remain unreachable through direct PostgREST function execution.

REVOKE ALL ON FUNCTION public.rpc_get_organizational_audit(
  uuid, integer, uuid, uuid, text, uuid, timestamptz, timestamptz, uuid, boolean, boolean
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_organizational_audit(
  uuid, integer, uuid, uuid, text, uuid, timestamptz, timestamptz, uuid, boolean, boolean
) TO authenticated;

REVOKE ALL ON FUNCTION public._reporting_rpc_get_organizational_audit(
  uuid, integer, uuid, uuid, text, uuid, timestamptz, timestamptz, uuid, boolean, boolean
) FROM PUBLIC, anon, authenticated, service_role;
