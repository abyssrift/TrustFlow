-- ============================================================
-- Fix (#301): pending time approvals invisible to everyone who
-- isn't literally tasks.manager_id.
--
-- rpc_get_my_pending_time_approvals (the query behind BOTH the
-- dashboard widget and the topbar island — components/common/
-- PendingTimeApprovalsWidget.tsx and components/island/
-- IslandTimeApprovalsBridge.web.tsx both call it) only ever
-- listed entries where tasks.manager_id = auth.uid().
--
-- rpc_review_manual_time (the RPC that actually performs the
-- approve/reject) authorizes a much wider set: company owners,
-- the task's manager, the task's CREATOR, or anyone holding
-- task.manage. manager_id is also never set at task creation
-- (CreateTaskModal has no such field — see EditTaskModal for the
-- only place it's ever assigned), so most tasks have no manager
-- at all. Net effect: a pending declaration on a manager-less
-- task was reviewable by its creator or an owner, but neither the
-- widget nor the island ever showed it to them — "component
-- doesn't show up despite being in the layout".
--
-- Fix: match the listing query's authorization to the review
-- RPC's, one function, both callers fixed. Company scoping is
-- added explicitly (t.company_id = my_company_id()) because the
-- old single-column check implicitly scoped itself — manager_id
-- can only ever be a user rpc_review_manual_time already validated
-- as same-company — but is_owner/has_permission do not, so without
-- it an owner would see every company's pending entries.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_get_my_pending_time_approvals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_is_owner BOOLEAN := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
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
      AND t.company_id = public.my_company_id()
      AND (
        v_is_owner
        OR t.manager_id = v_user_id
        OR t.created_by = v_user_id
        OR public.has_permission('task.manage')
      )
  ), '[]'::jsonb);
END;
$$;
