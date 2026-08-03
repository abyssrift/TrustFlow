-- Two bugs in rpc_create_company_and_link. Both make a brand-new workspace
-- arrive half-configured, and both were found by auditing the creation path
-- end to end rather than by reading it.
--
-- Audit of a freshly created company, before this migration:
--     roles created                  : 4      ok  (trg_companies_seed_default_roles)
--     role_permissions granted       : 168    ok
--     roles with project.view_all    : 3      ok
--     owner linked to a COMPANY role : 0      BUG A
--     pipeline stages                : 4      ok
--     stage transitions              : 0      BUG B
--     stage action buttons           : 0      BUG B
--
-- BUG A — THE OWNER IS LINKED TO A GLOBAL TEMPLATE ROLE
-- The RPC looks up `roles WHERE name='Owner' AND company_id IS NULL AND
-- is_system` — the GLOBAL TEMPLATE — and writes that role_id into user_roles.
-- Meanwhile trg_companies_seed_default_roles has already copied that template
-- into a real per-company 'Owner' role. So the company owns a correct Owner
-- role that the owner is not a member of, and the owner instead holds a row
-- pointing at a role shared by every company on the platform.
--
-- It is masked today because users.is_owner = TRUE makes has_permission()
-- return true for every key, so nobody notices. It is still wrong, and the
-- failure mode is bad: the role editor shows this user holding "Owner", and
-- editing that role edits the TEMPLATE — changing the permission seed for
-- every company created afterwards, and for every other owner already
-- pointing at it. A per-tenant UI writing to a global row is a tenancy leak
-- waiting for someone to click Save.
--
-- Fix: link the owner to their OWN company's Owner role, seeded by the
-- trigger moments earlier. Fall back to the template only if the trigger did
-- not produce one, so the RPC still cannot leave a company owner-less.
--
-- BUG B — FOUR STAGES AND NO WAY TO MOVE BETWEEN THEM
-- The RPC inserts Backlog/In Progress/In Review/Done and stops. No
-- pipeline_stage_transitions, therefore no pipeline_stage_actions, therefore
-- no action buttons on any task in a new workspace. This is exactly what a
-- user hit on a 'Main Workflow' pipeline: the board renders and nothing can
-- be advanced.
--
-- Confirmed as the difference between the two creation paths: the editor's
-- createPipeline() auto-creates an 'advance' action per transition, and
-- pipelines built there have actions. rpc_create_company_and_link never made
-- transitions, so it never made actions.
--
-- The transitions used here are the app's OWN quick-create preset, copied
-- from components/pipeline-editor/PipelineList.tsx TRANSITION_PRESETS rather
-- than invented:
--     1->2 Start Work, 2->3 Submit for Review, 3->4 Approve,
--     3->2 Request Revision
-- and one 'advance' action per transition, mirroring the shape createPipeline
-- already writes.

CREATE OR REPLACE FUNCTION public.rpc_create_company_and_link(
  p_company_name text,
  p_slug text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_company_id    uuid;
  v_user_id       uuid := auth.uid();
  v_user_email    text;
  v_owner_role_id uuid;
  v_final_slug    text;
  v_pipeline_id   uuid;
  v_stage_ids     uuid[];
  v_trans_id      uuid;
  v_t             RECORD;
BEGIN
  IF p_slug IS NULL OR p_slug = '' THEN
    v_final_slug := REGEXP_REPLACE(LOWER(p_company_name), '[^a-z0-9]+', '-', 'g');
    v_final_slug := TRIM(BOTH '-' FROM v_final_slug);
    IF EXISTS (SELECT 1 FROM public.companies WHERE slug = v_final_slug) THEN
      v_final_slug := v_final_slug || '-' || SUBSTR(MD5(RANDOM()::TEXT), 1, 4);
    END IF;
  ELSE
    v_final_slug := p_slug;
  END IF;

  INSERT INTO public.companies (name, slug) VALUES (p_company_name, v_final_slug)
  RETURNING id INTO v_company_id;
  -- trg_companies_seed_default_roles fires here and copies the template roles
  -- (with their permissions) into this company.

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  INSERT INTO public.users (id, email, company_id, is_owner, is_active)
  VALUES (v_user_id, v_user_email, v_company_id, TRUE, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET company_id = EXCLUDED.company_id,
        is_owner   = TRUE,
        is_active  = TRUE;

  -- BUG A FIX: prefer THIS COMPANY'S Owner role over the global template.
  SELECT id INTO v_owner_role_id
  FROM public.roles
  WHERE company_id = v_company_id AND name = 'Owner' AND deleted_at IS NULL
  LIMIT 1;

  IF v_owner_role_id IS NULL THEN
    SELECT id INTO v_owner_role_id
    FROM public.roles
    WHERE name = 'Owner' AND company_id IS NULL AND is_system = TRUE
    LIMIT 1;
  END IF;

  IF v_owner_role_id IS NULL THEN
    INSERT INTO public.roles (company_id, name, description, color, is_system, is_default)
    VALUES (v_company_id, 'Owner', 'Workspace owner', NULL, FALSE, FALSE)
    RETURNING id INTO v_owner_role_id;
  END IF;

  INSERT INTO public.user_roles (user_id, role_id, company_id)
  VALUES (v_user_id, v_owner_role_id, v_company_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.pipelines (company_id, name, description, is_default, created_by, visibility_permissions)
  VALUES (v_company_id, 'Main Workflow', 'Default pipeline for your workspace', TRUE, v_user_id, '{}')
  RETURNING id INTO v_pipeline_id;

  INSERT INTO public.pipeline_stages (pipeline_id, name, color, position, is_initial, is_terminal, terminal_type)
  VALUES
    (v_pipeline_id, 'Backlog',     '#6B7280', 1, TRUE,  FALSE, NULL),
    (v_pipeline_id, 'In Progress', '#3B82F6', 2, FALSE, FALSE, NULL),
    (v_pipeline_id, 'In Review',   '#F59E0B', 3, FALSE, FALSE, NULL),
    (v_pipeline_id, 'Done',        '#10B981', 4, FALSE, TRUE,  'success');

  -- BUG B FIX: transitions + one advance action each, so the board is usable.
  SELECT array_agg(id ORDER BY position) INTO v_stage_ids
  FROM public.pipeline_stages WHERE pipeline_id = v_pipeline_id;

  FOR v_t IN
    SELECT * FROM (VALUES
      (1, 2, 'Start Work'),
      (2, 3, 'Submit for Review'),
      (3, 4, 'Approve'),
      (3, 2, 'Request Revision')
    ) AS t(from_pos, to_pos, label)
  LOOP
    INSERT INTO public.pipeline_stage_transitions (from_stage_id, to_stage_id, label, transition_type)
    VALUES (v_stage_ids[v_t.from_pos], v_stage_ids[v_t.to_pos], v_t.label, 'neutral')
    RETURNING id INTO v_trans_id;

    INSERT INTO public.pipeline_stage_actions
      (stage_id, action_type, label, style, required_role, position, is_active, transition_id)
    VALUES
      (v_stage_ids[v_t.from_pos], 'advance', v_t.label, 'primary', 'any', 1, TRUE, v_trans_id);
  END LOOP;

  RETURN v_company_id;
END;
$fn$;
