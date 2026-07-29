-- Platform-level config that lives outside the `public` schema (storage buckets,
-- pg_cron schedules), so it wasn't captured by the public-schema baseline dump.
-- Mirrors prod as of 2026-07-29.

-- ── Storage buckets ─────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, owner, public, avif_autodetection, file_size_limit, allowed_mime_types, created_at, updated_at, type)
VALUES
  ('avatars', 'avatars', null, true, false, null, null, now(), now(), 'STANDARD'),
  ('company-logos', 'company-logos', null, true, false, 5242880, ARRAY['image/jpeg','image/png','image/gif','image/webp'], now(), now(), 'STANDARD'),
  ('filehub-files', 'filehub-files', null, false, false, 524288000, null, now(), now(), 'STANDARD'),
  ('kanban-backgrounds', 'kanban-backgrounds', null, true, false, 5242880, ARRAY['image/jpeg','image/png','image/gif','image/webp'], now(), now(), 'STANDARD'),
  ('ping-sounds', 'ping-sounds', null, true, false, null, null, now(), now(), 'STANDARD'),
  ('reports', 'reports', null, false, false, 10485760, ARRAY['application/pdf'], now(), now(), 'STANDARD'),
  ('submission-attachments', 'submission-attachments', null, false, false, 52428800, ARRAY['image/jpeg','image/png','image/gif','image/webp','image/svg+xml','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/csv','application/zip','application/x-zip-compressed','video/mp4','video/quicktime','audio/mpeg','audio/wav'], now(), now(), 'STANDARD'),
  ('task-attachments', 'task-attachments', null, false, false, 52428800, ARRAY['image/jpeg','image/png','image/gif','image/webp','image/svg+xml','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/csv','application/zip','application/x-zip-compressed','video/mp4','video/quicktime','audio/mpeg','audio/wav'], now(), now(), 'STANDARD'),
  ('task-submissions', 'task-submissions', null, false, false, null, null, now(), now(), 'STANDARD');

-- ── pg_cron schedules ───────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule('pipeline-heartbeat', '* * * * *',
  $cron$SELECT public.rpc_process_automations()$cron$);

SELECT cron.schedule('notify-overdue-tasks', '0 8 * * *',
  $cron$SELECT public.fn_check_overdue_tasks()$cron$);

SELECT cron.schedule('sweep-pending-notification-events', '*/5 * * * *',
  $cron$SELECT public.fn_sweep_pending_notification_events()$cron$);

SELECT cron.schedule('analytics-flush-users', '0 2 * * *',
  $cron$SELECT public.fn_flush_all_user_snapshots()$cron$);

SELECT cron.schedule('analytics-flush-pipelines', '0 2 * * *',
  $cron$SELECT public.fn_flush_all_pipeline_snapshots()$cron$);

SELECT cron.schedule('purge-filehub-versions-daily', '30 3 * * *',
  $cron$SELECT public.fn_invoke_purge_filehub_versions();$cron$);

SELECT cron.schedule('purge-filehub-bin-daily', '45 3 * * *',
  $cron$SELECT public.fn_invoke_purge_filehub_bin();$cron$);

SELECT cron.schedule('retention-warnings-daily', '0 8 * * *',
  $cron$select public.rpc_run_retention_warnings();$cron$);

SELECT cron.schedule('rate-limit-cleanup', '0 * * * *',
  $cron$DELETE FROM public.rate_limit_buckets WHERE window_start < now() - interval '1 hour'$cron$);

SELECT cron.schedule('trial-expiry-check', '0 6 * * *',
  $cron$
    UPDATE public.company_billing
    SET plan_code     = 'free',
        status        = 'active',
        trial_ends_at = NULL,
        updated_at    = now()
    WHERE status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at < now()
  $cron$);

SELECT cron.schedule('filehub-orphan-sweep-daily', '15 4 * * *',
  $cron$SELECT public.fn_invoke_filehub_orphan_sweep();$cron$);

SELECT cron.schedule('sweep-stale-work-sessions', '*/10 * * * *',
  $cron$SELECT public.fn_sweep_stale_work_sessions()$cron$);
