-- Fix "column reference 'id' is ambiguous" in rpc_get_targets_status.
-- In PostgreSQL plpgsql RETURNS TABLE functions, output column names become
-- implicit OUT variables. When the query body joins tables that also have 'id'
-- columns, Postgres can't distinguish the OUT variable from the table column.
-- #variable_conflict use_column tells the plpgsql engine to always prefer
-- the column reference over the local variable in SQL queries.

CREATE OR REPLACE FUNCTION public.rpc_get_targets_status()
RETURNS TABLE (
    id UUID,
    stage_id UUID,
    stage_name TEXT,
    pipeline_name TEXT,
    target_type TEXT,
    target_value INTEGER,
    current_value BIGINT,
    status TEXT,
    deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
#variable_conflict use_column
DECLARE
    v_company_id UUID;
BEGIN
    SELECT company_id INTO v_company_id FROM public.users WHERE id = auth.uid();
    IF v_company_id IS NULL THEN RETURN; END IF;

    RETURN QUERY
    WITH target_progress AS (
        SELECT
            pst.id,
            pst.stage_id,
            ps.name as stage_name,
            p.name as pipeline_name,
            pst.target_type,
            pst.target_quantity as target_value,
            pst.target_deadline as deadline,
            pst.created_at,
            pst.completed_at,
            (
                SELECT COUNT(*)
                FROM public.pipeline_stage_history psh
                WHERE psh.to_stage_id = pst.stage_id
                  AND psh.company_id = v_company_id
                  AND psh.transitioned_at >= pst.created_at
                  AND (pst.target_deadline IS NULL OR psh.transitioned_at <= pst.target_deadline)
            ) as current_volume
        FROM public.pipeline_stage_targets pst
        JOIN public.pipeline_stages ps ON ps.id = pst.stage_id
        JOIN public.pipelines p ON p.id = ps.pipeline_id
        WHERE pst.company_id = v_company_id
    )
    SELECT
        tp.id,
        tp.stage_id,
        tp.stage_name,
        tp.pipeline_name,
        tp.target_type,
        tp.target_value,
        tp.current_volume as current_value,
        CASE
            WHEN tp.current_volume >= tp.target_value THEN 'hit'
            WHEN tp.deadline IS NOT NULL AND NOW() > tp.deadline THEN 'expired'
            ELSE 'active'
        END as status,
        tp.deadline,
        tp.created_at,
        tp.completed_at
    FROM target_progress tp;
END;
$$;
