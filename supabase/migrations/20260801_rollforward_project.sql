-- 20260801_rollforward_project.sql
-- Issue #185 (plan §13.13, settling §11) — create next year's engagement from
-- a live project, configurably.
--
-- rpc_rollforward_project(p_source_project_id, p_new_name, p_options) is
-- rpc_create_template_from_project + rpc_instantiate_template COMPOSED, not
-- reimplemented. It:
--   1. Calls rpc_create_template_from_project to snapshot the source
--      project's tasks into a real (but transient) project_templates row.
--      This is what gives rollforward fn_project_accessible gating for free
--      — that RPC already folds "not accessible" into "Project not found."
--      (20260801_project_visibility.sql call site 5), so rollforward never
--      becomes a new way to read a project the caller couldn't already see.
--   2. Strips fields the caller opted out of (assignee_team_id if
--      carry_assignments=false, estimated_hours if carry_estimates=false)
--      from that transient template's body with one UPDATE.
--   3. Resolves p_category_mapping — either auto-derived from the SAME body
--      (carry_mapping=true: reuse the board/team each category already used
--      last year) or required as caller input (carry_mapping=false: fresh
--      mapping, same shape BulkCreateProjectsSheet's step already collects).
--   4. Calls rpc_instantiate_template with that template + a single-row
--      p_projects batch. Every guarantee that RPC already proved — one
--      notification per batch, a required schedule anchor, first-stage
--      resolution, duplicate-name detection naming the offender, portfolio
--      as the undo unit — comes free and cannot drift, because this is the
--      SAME function, not a parallel insert.
--   5. Soft-deletes the transient template row (project_templates_select
--      already filters deleted_at IS NULL) so rollforward never clutters the
--      "Save as Template" / bulk-create template list — the portfolio row's
--      own template_body_snapshot (already written by rpc_instantiate_template)
--      is the permanent record of what was rolled forward, so nothing is lost.
--   6. If carry_files=true, links the new project to the source project via
--      projects.rolled_forward_from_project_id — see the file-linking
--      section below for why this is a REFERENCE, not a copy.
--
-- Explicitly NOT built here (would be an invasive, silent change to shared
-- infrastructure, per the standing "report, don't reinvent" rule):
--   - Person-level (assignee_user_id) assignment carry-forward. The
--     project_templates.body item shape is team-level assignment ONLY, by
--     original design ("no interpolation/template language", plan §4,
--     20260731_project_hierarchy_1_schema.sql) and rpc_instantiate_template's
--     insert never writes assignee_user_id. carry_assignments here carries
--     TEAM assignment only. Extending the shared template item shape and
--     rpc_instantiate_template's insert to also carry direct-user assignment
--     is exactly the kind of shared-RPC change that needs sign-off first —
--     flagged in the issue report, not built silently.

-- ── 1. Company-level defaults, mirroring companies.terminology_labels'
--    shape exactly (20260731_companies_terminology.sql) ─────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS rollforward_defaults JSONB NOT NULL DEFAULT
    '{"carry_assignments": true, "carry_mapping": true, "carry_estimates": true, "carry_files": true}'::jsonb;

COMMENT ON COLUMN public.companies.rollforward_defaults IS
  'Issue #185. Per-company default toggles for rpc_rollforward_project — {carry_assignments, carry_mapping, carry_estimates, carry_files}, all boolean. Overridable per call via p_options. Missing keys fall back to true (the common case per the issue: "some firms clone last year''s engagement wholesale").';

-- ── 2. Provenance + file-link key. ONE column serves both jobs: it is only
--    ever set when carry_files=true, so its presence IS the "carry file
--    references" toggle's effect, not a separate flag that could drift from
--    it. NULL for every project not created by a files-carrying rollforward
--    (100% of existing rows). ──────────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS rolled_forward_from_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_rolled_forward_from ON public.projects (rolled_forward_from_project_id) WHERE rolled_forward_from_project_id IS NOT NULL;

COMMENT ON COLUMN public.projects.rolled_forward_from_project_id IS
  'Issue #185. Set only when rpc_rollforward_project ran with carry_files=true. This is the LINK, not a copy: filehub_folder_accessible / filehub_files_select_visibility (below) grant read access to the SOURCE project''s deliverable folder to anyone who can already see THIS project, through this column — no filehub_files row is ever duplicated. "Last year''s working papers are linked from this year, not copied" (plan §13.13).';

-- ── 3. Extend the two existing accessibility predicates with the rollforward
--    link — body-only CREATE OR REPLACE, same signature, every existing
--    caller (rpc_filehub_folder_versions, rpc_filehub_folder_restore_batch,
--    the share-link RPCs, filehub_files' own RLS) gets this for free, same
--    shape §16's project-scope extension used. The added branch only ever
--    matches a row whose project_id is someone's rolled_forward_from_project_id
--    — i.e. it can ONLY be reached through a rollforward link that already
--    exists, never widens access for any project that never rolled anything
--    forward. ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.filehub_folder_accessible(p_folder_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.filehub_folders fo
        WHERE fo.id = p_folder_id
          AND fo.deleted_at IS NULL
          AND fo.company_id = public.my_company_id()
          AND (
              fo.created_by = auth.uid()
              OR fo.scope = 'broadcast'
              OR (fo.scope = 'group' AND fo.group_id IS NOT NULL AND (
                     EXISTS (
                         SELECT 1 FROM public.filehub_group_members gm
                         WHERE gm.group_id = fo.group_id AND gm.user_id = auth.uid()
                     )
                     OR public.has_permission('filehub:group_override')
                     OR public.has_permission('filehub:group_override_manage')
                 ))
              OR (fo.scope = 'project' AND fo.project_id IS NOT NULL AND (
                     public.fn_project_accessible(fo.project_id)
                     OR EXISTS (
                       SELECT 1 FROM public.projects np
                       WHERE np.rolled_forward_from_project_id = fo.project_id
                         AND public.fn_project_accessible(np.id)
                     )
                 ))
          )
    );
$$;

DROP POLICY IF EXISTS "filehub_files_select_visibility" ON public.filehub_files;
CREATE POLICY "filehub_files_select_visibility" ON public.filehub_files
    FOR SELECT USING (
        deleted_at IS NULL
        AND company_id = public.my_company_id()
        AND (
            uploaded_by = auth.uid()
            OR visibility = 'broadcast'
            OR (visibility = 'direct' AND public.fn_filehub_is_direct_recipient(id))
            OR (visibility = 'group' AND group_id IS NOT NULL AND public.fn_filehub_is_group_member(group_id))
            OR (visibility = 'task' AND task_id IS NOT NULL AND public.task_accessible(task_id))
            OR (visibility = 'project' AND project_id IS NOT NULL AND (
                   public.fn_project_accessible(project_id)
                   OR EXISTS (
                     SELECT 1 FROM public.projects np
                     WHERE np.rolled_forward_from_project_id = project_id
                       AND public.fn_project_accessible(np.id)
                   )
                ))
        )
    );

-- ── 4. rpc_rollforward_project — the composed RPC ───────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_rollforward_project(
  p_source_project_id UUID,
  p_new_name           TEXT,
  p_options            JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id        UUID := public.my_company_id();
  v_user_id           UUID := auth.uid();
  v_defaults          JSONB;
  v_carry_assignments BOOLEAN;
  v_carry_mapping     BOOLEAN;
  v_carry_estimates   BOOLEAN;
  v_carry_files       BOOLEAN;
  v_template          public.project_templates;
  v_source            RECORD;
  v_client            RECORD;
  v_category_mapping  JSONB;
  v_result            JSONB;
  v_portfolio_id      UUID;
  v_project_id        UUID;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('project.create')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to roll forward a project.';
  END IF;

  IF p_new_name IS NULL OR TRIM(p_new_name) = '' THEN
    RAISE EXCEPTION 'A name for the rolled-forward project is required.';
  END IF;

  IF p_options->>'idempotency_key' IS NULL OR TRIM(p_options->>'idempotency_key') = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.';
  END IF;

  -- Same "never defaulted" rule rpc_instantiate_template enforces — a
  -- rollforward is a bulk-instantiate of one, it does not get an exemption.
  IF p_options->>'target_date' IS NULL THEN
    RAISE EXCEPTION 'A schedule anchor is required: set p_options.target_date. This is never defaulted.';
  END IF;
  IF p_options->>'anchor_direction' IS NULL OR p_options->>'anchor_direction' NOT IN ('start', 'deadline') THEN
    RAISE EXCEPTION 'p_options.anchor_direction must be ''start'' or ''deadline''.';
  END IF;

  -- ── Resolve toggles: explicit p_options wins, else the company default,
  -- else true (the issue's stated common case — wholesale clone). ──────────
  SELECT rollforward_defaults INTO v_defaults FROM public.companies WHERE id = v_company_id;
  v_defaults := COALESCE(v_defaults, '{}'::jsonb);

  v_carry_assignments := COALESCE((p_options->>'carry_assignments')::boolean, (v_defaults->>'carry_assignments')::boolean, true);
  v_carry_mapping     := COALESCE((p_options->>'carry_mapping')::boolean,     (v_defaults->>'carry_mapping')::boolean,     true);
  v_carry_estimates   := COALESCE((p_options->>'carry_estimates')::boolean,   (v_defaults->>'carry_estimates')::boolean,   true);
  v_carry_files       := COALESCE((p_options->>'carry_files')::boolean,      (v_defaults->>'carry_files')::boolean,       true);

  -- ── Step 1 of the composition: rpc_create_template_from_project. This is
  -- the SAME function "Save as Template" uses — gated by fn_project_accessible
  -- (call site 5, 20260801_project_visibility.sql), so a caller who cannot
  -- see the source project gets the identical "Project not found." here. A
  -- random suffix keeps the transient name unique; nothing displays it,
  -- since the row is soft-deleted before this function returns. ───────────
  v_template := public.rpc_create_template_from_project(
    p_source_project_id,
    '__rollforward__' || p_source_project_id::text || '__' || gen_random_uuid()::text
  );

  IF jsonb_array_length(v_template.body) = 0 THEN
    RAISE EXCEPTION 'Source project has no tasks to roll forward.';
  END IF;

  -- Re-read the source project + its client for name/client carry-forward
  -- and the file link below. fn_project_accessible was already proven true
  -- by the call above succeeding, so no second gate is needed here.
  SELECT p.id, p.client_id, p.deliverable_folder_id INTO v_source
  FROM public.projects p WHERE p.id = p_source_project_id;

  IF v_source.client_id IS NOT NULL THEN
    SELECT c.name, c.external_ref INTO v_client FROM public.clients c WHERE c.id = v_source.client_id;
  END IF;

  -- ── carry_assignments / carry_estimates: strip the opted-out field from
  -- EVERY body item with one UPDATE. Team assignment is the only assignment
  -- rpc_instantiate_template's insert reads (from the category mapping, not
  -- the body — see file header), so stripping here is defence-in-depth for
  -- clarity; the real enforcement point for "carry team" is the mapping
  -- built below. Estimates DO flow straight from the body's
  -- estimated_hours, so stripping it here is the actual enforcement. ──────
  IF NOT v_carry_estimates THEN
    UPDATE public.project_templates
    SET body = (
      SELECT COALESCE(jsonb_agg(elem - 'estimated_hours'), '[]'::jsonb)
      FROM jsonb_array_elements(v_template.body) AS elem
    )
    WHERE id = v_template.id
    RETURNING body INTO v_template.body;
  END IF;

  -- ── Category mapping: auto-derive from the source project's own
  -- board/team usage per category when carry_mapping=true (that IS "carry
  -- the category->board mapping"), else require the caller's fresh mapping
  -- (same shape/step BulkCreateProjectsSheet already collects). Either way
  -- it flows into the SAME fn_resolve_batch_category_mapping every other
  -- batch path uses, so an unmapped/foreign/stage-less category RAISEs with
  -- the identical, offender-naming message. ────────────────────────────────
  IF v_carry_mapping THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'category', x.category,
             'pipeline_id', x.pipeline_id,
             'assignee_team_id', CASE WHEN v_carry_assignments THEN x.assignee_team_id ELSE NULL END
           )), '[]'::jsonb)
    INTO v_category_mapping
    FROM (
      SELECT DISTINCT ON (COALESCE(item->>'category', ''))
        COALESCE(item->>'category', '')                 AS category,
        NULLIF(item->>'pipeline_id', '')::uuid           AS pipeline_id,
        NULLIF(item->>'assignee_team_id', '')::uuid      AS assignee_team_id
      FROM jsonb_array_elements(v_template.body) AS item
      ORDER BY COALESCE(item->>'category', ''), item->>'pipeline_id' NULLS LAST
    ) x;
  ELSE
    IF p_options->'category_mapping' IS NULL OR jsonb_typeof(p_options->'category_mapping') <> 'array' THEN
      RAISE EXCEPTION 'carry_mapping is false — p_options.category_mapping is required (one row per category, chosen fresh).';
    END IF;
    v_category_mapping := p_options->'category_mapping';
  END IF;

  -- An explicit override always wins even when carry_mapping=true, so "carry
  -- mostly, but move one category to a different board this year" doesn't
  -- require turning the whole toggle off.
  IF p_options->'category_mapping' IS NOT NULL AND jsonb_typeof(p_options->'category_mapping') = 'array' AND v_carry_mapping THEN
    v_category_mapping := p_options->'category_mapping';
  END IF;

  -- ── Step 2 of the composition: rpc_instantiate_template. Single-row batch
  -- — a rollforward is "one project, next year", not a paste of many. Every
  -- hazard fix (notification GUC, idempotency, duplicate-name check, undo)
  -- is this function's, unmodified. ─────────────────────────────────────────
  v_result := public.rpc_instantiate_template(
    v_template.id,
    jsonb_build_object(
      'name', TRIM(p_new_name) || ' (rollforward batch)',
      'source', 'rollforward:' || p_source_project_id::text,
      'target_date', p_options->>'target_date',
      'anchor_direction', p_options->>'anchor_direction'
    ),
    jsonb_build_array(jsonb_build_object(
      'name', TRIM(p_new_name),
      'client_ref', v_client.name,
      'client_external_ref', v_client.external_ref,
      'start_date', NULL
    )),
    v_category_mapping,
    p_options->>'idempotency_key'
  );

  v_portfolio_id := (v_result->>'portfolio_id')::uuid;
  SELECT id INTO v_project_id FROM public.projects WHERE portfolio_id = v_portfolio_id AND deleted_at IS NULL LIMIT 1;

  -- ── carry_files: the link, not a copy. Setting this column is the ENTIRE
  -- mechanism — no filehub_files row is read, inserted, or touched here.
  -- Read access to the source's deliverable folder is a consequence of this
  -- FK plus the two predicate extensions above, resolved at READ time. ────
  IF v_carry_files AND v_project_id IS NOT NULL AND NOT (v_result->>'already_processed')::boolean THEN
    UPDATE public.projects SET rolled_forward_from_project_id = p_source_project_id WHERE id = v_project_id;
  END IF;

  -- ── Cleanup: the transient template was only ever a vehicle for reusing
  -- rpc_instantiate_template's validated body format. Soft-delete so it
  -- never appears in the templates list or a future bulk-create picker. The
  -- portfolio's own template_body_snapshot (written by rpc_instantiate_template)
  -- is the permanent record of exactly what was rolled forward. ───────────
  UPDATE public.project_templates SET deleted_at = now() WHERE id = v_template.id;

  PERFORM public.log_event(v_company_id, v_user_id, 'project', v_project_id, 'project.rolled_forward',
    jsonb_build_object(
      'source_project_id', p_source_project_id,
      'new_project_id', v_project_id,
      'portfolio_id', v_portfolio_id,
      'carry_assignments', v_carry_assignments,
      'carry_mapping', v_carry_mapping,
      'carry_estimates', v_carry_estimates,
      'carry_files', v_carry_files
    ));

  RETURN v_result || jsonb_build_object(
    'project_id', v_project_id,
    'source_project_id', p_source_project_id,
    'carried', jsonb_build_object(
      'assignments', v_carry_assignments,
      'mapping', v_carry_mapping,
      'estimates', v_carry_estimates,
      'files', v_carry_files
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_rollforward_project(UUID, TEXT, JSONB) TO authenticated;

-- ── Wiring self-check (behavioural proof lives in
--    supabase/checks/check_rpc_rollforward_project.sql) ─────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'rollforward_defaults'
  ), 'companies.rollforward_defaults missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'rolled_forward_from_project_id'
  ), 'projects.rolled_forward_from_project_id missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'rpc_rollforward_project' AND pronamespace = 'public'::regnamespace
  ), 'rpc_rollforward_project missing';

  ASSERT public.filehub_folder_accessible(NULL) = false, 'filehub_folder_accessible(NULL) must still be false, not error';

  RAISE NOTICE '20260801_rollforward_project.sql wiring assertions passed';
END $$;
