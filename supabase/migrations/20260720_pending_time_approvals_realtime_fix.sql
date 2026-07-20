-- ============================================================
-- Fix: manager time-approval island (#70 follow-up)
--
-- 1. rpc_get_my_pending_time_approvals only returned flagged
--    entries, but rpc_log_manual_time requires manager approval
--    for ALL declarations regardless of flag status — non-flagged
--    pending entries were invisible to the manager.
--
-- 2. task_manual_time_entries was never added to the
--    supabase_realtime publication, so the island's
--    postgres_changes subscription never received live updates;
--    only the initial fetch-on-mount ever populated it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_get_my_pending_time_approvals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',               e.id,
        'declared_minutes', e.declared_minutes,
        'reason',           e.reason,
        'flag_reason',      e.flag_reason,
        'logged_at',        e.logged_at,
        'task_id',          e.task_id,
        'task_title',       t.title,
        'worker',           jsonb_build_object(
          'id',         u.id,
          'full_name',  u.full_name,
          'avatar_url', u.avatar_url
        )
      )
      ORDER BY e.logged_at DESC
    )
    FROM public.task_manual_time_entries e
    JOIN public.tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
    JOIN public.users u ON u.id = e.user_id
    WHERE e.approval_status = 'pending'
      AND t.manager_id = v_user_id
  ), '[]'::jsonb);
END;
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.task_manual_time_entries;
