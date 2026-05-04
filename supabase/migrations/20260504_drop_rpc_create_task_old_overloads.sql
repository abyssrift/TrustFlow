-- Drop stale rpc_create_task overloads left behind by prior CREATE OR REPLACE calls
-- with different signatures. PostgREST resolves RPCs by name; multiple overloads
-- with different param counts cause an ambiguity error and close the connection.
DROP FUNCTION IF EXISTS public.rpc_create_task(
  text, text, text, timestamptz, uuid, uuid, uuid, text, bigint
);

DROP FUNCTION IF EXISTS public.rpc_create_task(
  text, text, text, timestamptz, uuid, uuid, uuid, text, bigint, text
);
