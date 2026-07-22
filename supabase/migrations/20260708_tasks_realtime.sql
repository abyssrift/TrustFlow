-- Make the task board actually realtime.
-- `tasks` and `task_work_sessions` were never in the supabase_realtime
-- publication, so every client subscription on them (desktop board, mobile
-- board, task detail) was a silent no-op: task create/move/edit/delete and
-- timer start/stop never pushed. Add them.
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_work_sessions;

-- DELETE payloads carry only the primary key under default replica identity,
-- but the board count channel reads payload.old.pipeline_id on delete. FULL
-- ships the whole old row so that handler works.
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
