-- tasks had RLS enabled with only a SELECT policy (tasks_select_visibility).
-- Client-side `supabase.from('tasks').update(...)` (EditTaskModal) silently
-- affected 0 rows with no error, since no UPDATE policy ever matched.
-- Mirrors the can_edit logic already used server-side in rpc_get_task_detail.

CREATE POLICY tasks_update_editable ON public.tasks
FOR UPDATE
TO authenticated
USING (
  company_id = public.my_company_id()
  AND (
    COALESCE((SELECT is_owner FROM public.users WHERE id = auth.uid()), FALSE)
    OR created_by = auth.uid()
    OR manager_id = auth.uid()
    OR public.has_permission('task.edit')
  )
)
WITH CHECK (
  company_id = public.my_company_id()
  AND (
    COALESCE((SELECT is_owner FROM public.users WHERE id = auth.uid()), FALSE)
    OR created_by = auth.uid()
    OR manager_id = auth.uid()
    OR public.has_permission('task.edit')
  )
);
