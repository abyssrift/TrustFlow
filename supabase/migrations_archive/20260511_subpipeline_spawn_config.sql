-- =====================================================================
-- Subpipeline Spawn Configuration
-- Adds per-stage settings controlling how child tasks inherit from parent.
-- =====================================================================

-- Add spawn config column to pipeline_stages
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS child_inherits_submission BOOLEAN NOT NULL DEFAULT FALSE;

-- ── RPC: rpc_update_stage_spawn_config ──────────────────────────────
-- Updates spawn inheritance settings for a stage that has a linked pipeline.
-- Validates the stage belongs to the caller's company via the parent pipeline.
CREATE OR REPLACE FUNCTION public.rpc_update_stage_spawn_config(
  p_stage_id                  UUID,
  p_child_inherits_submission BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  v_company_id := public.my_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Verify the stage belongs to a pipeline owned by this company
  IF NOT EXISTS (
    SELECT 1
    FROM   public.pipeline_stages ps
    JOIN   public.pipelines p ON p.id = ps.pipeline_id
    WHERE  ps.id = p_stage_id
      AND  p.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'stage not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pipeline_stages
  SET    child_inherits_submission = p_child_inherits_submission
  WHERE  id = p_stage_id;
END;
$$;
