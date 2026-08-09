-- "Restore default" in the ping sound settings deletes the company's row
-- (the app falls back to the bundled default asset when no row exists).
-- There was no DELETE policy on this table, so that delete would have been
-- silently denied by RLS. Same permission gate as the existing UPDATE policy.

CREATE POLICY "Users can delete ping sounds" ON public.company_ping_sounds
FOR DELETE TO authenticated
USING (
  company_id = public.my_company_id()
  AND (has_permission('task.ping') OR has_permission('admin:notifications'))
);
