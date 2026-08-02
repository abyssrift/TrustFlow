-- Close a privilege escalation introduced by 20260801_rollforward_project.sql.
--
-- THE HOLE
-- That migration made `projects.rolled_forward_from_project_id` an INPUT to
-- access control: filehub_folder_accessible() and filehub_files_select_visibility
-- both grant read on the SOURCE project's files to anyone who can see a project
-- pointing at it. The intent is right — plan §6/#185 say last year's working
-- papers are linked, never copied.
--
-- The mistake was making a client-writable column an access-control input.
-- `projects_update` has no WITH CHECK, and its USING is company-wide (it does
-- NOT call fn_project_accessible — #186 tightened projects_select and left
-- update alone). So any user holding project.edit could point a project they
-- own at ANY project in the company and read its files.
--
-- Reproduced on local before this fix, as a non-owner with project.edit:
--     actor can see the secret project directly?  f
--     secret files visible BEFORE:                0
--     attacker UPDATE affected                    1 row
--     secret files visible AFTER:                 1   <-- escalation
--
-- For a firm holding competing clients that is exactly the disclosure #186
-- exists to prevent, reintroduced through a side door. rpc_rollforward_project
-- DOES check fn_project_accessible on the source — but that check is worthless
-- if the column it writes can be written around it.
--
-- THE FIX
-- Make the RPC the only writer, enforced by the database rather than by
-- convention (plan §13.2's recurring lesson: a rule the database does not
-- enforce is not a rule). A BEFORE UPDATE/INSERT trigger rejects any change to
-- the column unless a transaction-local GUC is set, and only
-- rpc_rollforward_project sets it. Same technique the batch path already uses
-- with `trustflow.bulk_instantiate` — the third argument to set_config MUST be
-- true (transaction-local), or the flag leaks across pooled connections.
--
-- NOT fixed here, deliberately: `projects_update` being company-wide rather
-- than gated by fn_project_accessible is a pre-existing gap that predates
-- rollforward and has a blast radius beyond it. It is filed separately.

CREATE OR REPLACE FUNCTION public.fn_guard_rollforward_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.rolled_forward_from_project_id IS NOT NULL
       AND COALESCE(current_setting('trustflow.rollforward', true), '') <> 'on' THEN
      RAISE EXCEPTION
        'projects.rolled_forward_from_project_id may only be set by rpc_rollforward_project (it grants read access to the source project''s files).'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.rolled_forward_from_project_id IS DISTINCT FROM OLD.rolled_forward_from_project_id
     AND COALESCE(current_setting('trustflow.rollforward', true), '') <> 'on' THEN
    RAISE EXCEPTION
      'projects.rolled_forward_from_project_id may only be set by rpc_rollforward_project (it grants read access to the source project''s files).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_rollforward_link_guard ON public.projects;
CREATE TRIGGER trg_projects_rollforward_link_guard
  BEFORE INSERT OR UPDATE OF rolled_forward_from_project_id ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_rollforward_link();

-- Teach the RPC to raise the flag around its own write. Body-only change:
-- the live definition is dumped and patched rather than retyped, because
-- recreating an RPC from a stale body has silently dropped behaviour in this
-- repo twice (see bug notes on rpc_filehub_group_list_files).
DO $patch$
DECLARE
  v_def TEXT;
  v_needle TEXT := 'UPDATE public.projects SET rolled_forward_from_project_id = p_source_project_id WHERE id = v_project_id;';
  v_replacement TEXT :=
    'PERFORM set_config(''trustflow.rollforward'', ''on'', true);' || E'\n    ' ||
    'UPDATE public.projects SET rolled_forward_from_project_id = p_source_project_id WHERE id = v_project_id;' || E'\n    ' ||
    'PERFORM set_config(''trustflow.rollforward'', ''off'', true);';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc
  WHERE proname = 'rpc_rollforward_project'
    AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rpc_rollforward_project not found — apply 20260801_rollforward_project.sql first';
  END IF;

  IF position(v_needle IN v_def) = 0 THEN
    IF position('trustflow.rollforward' IN v_def) > 0 THEN
      RAISE NOTICE 'rpc_rollforward_project already guards its write; nothing to patch';
      RETURN;
    END IF;
    RAISE EXCEPTION 'could not locate the rolled_forward_from_project_id write in rpc_rollforward_project — refusing to patch blindly';
  END IF;

  EXECUTE replace(v_def, v_needle, v_replacement);
  RAISE NOTICE 'rpc_rollforward_project patched to set trustflow.rollforward around its own write';
END
$patch$;
