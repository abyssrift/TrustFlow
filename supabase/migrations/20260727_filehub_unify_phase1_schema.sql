-- FileHub unification Phase 1 (#143): additive schema + access wiring ONLY.
-- No data is created and no read path changes, so this is fully inert — task
-- files behave exactly as before. It just lays the foundation so a later phase
-- can backfill filehub_files pointer rows (visibility='task') and flip reads.
--
-- Phase 2 (separate migration): idempotent backfill + guard every filehub read
-- path (files_index filehub branch, rpc_global_search, rpc_filehub_analytics)
-- against double-counting task rows + write-through on new task uploads.
-- Phase 3: task-file activity + unified Versions/Activity in the detail pane and
-- the three version UIs. Phase 4: content_hash dedup + purge convergence.

-- 1. New 'task' visibility for pointer rows.
ALTER TABLE public.filehub_files DROP CONSTRAINT IF EXISTS filehub_files_visibility_check;
ALTER TABLE public.filehub_files ADD CONSTRAINT filehub_files_visibility_check
    CHECK (visibility IN ('direct', 'broadcast', 'group', 'task'));

-- 2. Link a pointer row to its task (bytes still live in the task bucket).
ALTER TABLE public.filehub_files
    ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE;

-- 3. Access: a 'task' file is accessible iff the caller can access its task.
CREATE OR REPLACE FUNCTION public.filehub_file_accessible(p_file_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.filehub_files f
        WHERE f.id = p_file_id
          AND f.deleted_at IS NULL
          AND f.company_id = public.my_company_id()
          AND (
              f.uploaded_by = auth.uid()
              OR f.visibility = 'broadcast'
              OR (f.visibility = 'direct' AND EXISTS (
                  SELECT 1 FROM public.filehub_recipients r
                  WHERE r.file_id = f.id AND r.user_id = auth.uid()
              ))
              OR (f.visibility = 'group' AND f.group_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.filehub_group_members gm
                  WHERE gm.group_id = f.group_id AND gm.user_id = auth.uid()
              ))
              OR (f.visibility = 'task' AND f.task_id IS NOT NULL AND public.task_accessible(f.task_id))
          )
    );
$$;

-- 4. Table RLS mirrors the helper — 'task' rows readable via task access.
DROP POLICY IF EXISTS "filehub_files_select_visibility" ON public.filehub_files;
CREATE POLICY "filehub_files_select_visibility" ON public.filehub_files
    FOR SELECT USING (
        deleted_at IS NULL
        AND company_id = public.my_company_id()
        AND (
            uploaded_by = auth.uid()
            OR visibility = 'broadcast'
            OR (visibility = 'direct' AND EXISTS (
                SELECT 1 FROM public.filehub_recipients r
                WHERE r.file_id = filehub_files.id AND r.user_id = auth.uid()
            ))
            OR (visibility = 'group' AND group_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.filehub_group_members gm
                WHERE gm.group_id = filehub_files.group_id AND gm.user_id = auth.uid()
            ))
            OR (visibility = 'task' AND task_id IS NOT NULL AND public.task_accessible(task_id))
        )
    );

-- 5. Pointer columns on the source tables (the join that lets both worlds
--    coexist during rollout). SET NULL so deleting the pointer row is harmless.
ALTER TABLE public.task_attachments
    ADD COLUMN IF NOT EXISTS filehub_file_id uuid REFERENCES public.filehub_files(id) ON DELETE SET NULL;
ALTER TABLE public.submission_attachments
    ADD COLUMN IF NOT EXISTS filehub_file_id uuid REFERENCES public.filehub_files(id) ON DELETE SET NULL;
