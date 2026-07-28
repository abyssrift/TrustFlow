-- FileHub unification (#151/#152 follow-up): the Phase 2 backfill registers task
-- files as filehub_files rows (visibility='task'). Phase 2 guarded files_index
-- and rpc_global_search but MISSED the aggregate readers, so those rows now
-- double-count in FileHub totals (they're already counted via their submission/
-- brief source). Add the same `visibility <> 'task'` guard to:
--   * rpc_filehub_analytics (both overloads) — files_sent / total_bytes / top_senders
--   * rpc_filehub_overview — files_7d / bytes_7d company stats
-- The channel/recipient breakdowns already filter to direct/broadcast/group (or
-- join filehub_recipients, which task files never have), so they need no change.

-- ── rpc_filehub_analytics(p_days) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_analytics(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_company_id    UUID := public.my_company_id();
    v_since         TIMESTAMPTZ;
    v_totals        JSONB;
    v_top_senders   JSONB;
    v_top_receivers JSONB;
    v_channels      JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view File Hub analytics.';
    END IF;

    v_since := CASE
        WHEN p_days IS NULL OR p_days <= 0 THEN NULL
        ELSE now() - make_interval(days => p_days)
    END;

    SELECT jsonb_build_object(
        'files_sent',      COUNT(*),
        'total_bytes',     COALESCE(SUM(f.size_bytes), 0),
        'direct_files',    COUNT(*) FILTER (WHERE f.visibility = 'direct'),
        'broadcast_files', COUNT(*) FILTER (WHERE f.visibility = 'broadcast'),
        'group_files',     COUNT(*) FILTER (WHERE f.visibility = 'group')
    )
    INTO v_totals
    FROM public.filehub_files f
    WHERE f.company_id = v_company_id
      AND f.deleted_at IS NULL
      AND f.visibility <> 'task'
      AND (v_since IS NULL OR f.created_at >= v_since);

    SELECT v_totals || jsonb_build_object(
        'recipients_reached', COUNT(DISTINCT r.user_id),
        'read_rate', CASE
            WHEN COUNT(*) = 0 THEN NULL
            ELSE ROUND(COUNT(*) FILTER (WHERE r.read_at IS NOT NULL)::numeric / COUNT(*), 3)
        END
    )
    INTO v_totals
    FROM public.filehub_recipients r
    JOIN public.filehub_files f ON f.id = r.file_id
    WHERE f.company_id = v_company_id
      AND f.deleted_at IS NULL
      AND (v_since IS NULL OR f.created_at >= v_since);

    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_top_senders
    FROM (
        SELECT
            jsonb_build_object(
                'user_id',    u.id,
                'full_name',  u.full_name,
                'avatar_url', u.avatar_url,
                'files',      COUNT(*),
                'bytes',      COALESCE(SUM(f.size_bytes), 0)
            ) AS row,
            COUNT(*)                       AS files,
            COALESCE(SUM(f.size_bytes), 0) AS bytes
        FROM public.filehub_files f
        JOIN public.users u ON u.id = f.uploaded_by
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility <> 'task'
          AND (v_since IS NULL OR f.created_at >= v_since)
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY files DESC, bytes DESC
        LIMIT 5
    ) t;

    WITH receipts AS (
        SELECT r.user_id, f.size_bytes
        FROM public.filehub_recipients r
        JOIN public.filehub_files f ON f.id = r.file_id
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility = 'direct'
          AND (v_since IS NULL OR f.created_at >= v_since)
        UNION ALL
        SELECT gm.user_id, f.size_bytes
        FROM public.filehub_files f
        JOIN public.filehub_group_members gm ON gm.group_id = f.group_id
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility = 'group'
          AND gm.user_id <> f.uploaded_by
          AND (v_since IS NULL OR f.created_at >= v_since)
    )
    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_top_receivers
    FROM (
        SELECT
            jsonb_build_object(
                'user_id',        u.id,
                'full_name',      u.full_name,
                'avatar_url',     u.avatar_url,
                'files_received', COUNT(*),
                'bytes',          COALESCE(SUM(rc.size_bytes), 0)
            ) AS row,
            COUNT(*)                        AS files,
            COALESCE(SUM(rc.size_bytes), 0) AS bytes
        FROM receipts rc
        JOIN public.users u ON u.id = rc.user_id
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY files DESC, bytes DESC
        LIMIT 5
    ) t;

    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_channels
    FROM (
        SELECT
            jsonb_build_object(
                'channel', c.label,
                'kind',    c.kind,
                'files',   c.files,
                'bytes',   c.bytes
            ) AS row,
            c.files,
            c.bytes
        FROM (
            SELECT 'Direct Messages'::text AS label, 'direct'::text AS kind,
                   COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes
            FROM public.filehub_files
            WHERE company_id = v_company_id AND deleted_at IS NULL AND visibility = 'direct'
              AND (v_since IS NULL OR created_at >= v_since)
            HAVING COUNT(*) > 0
            UNION ALL
            SELECT 'Company Broadcast', 'broadcast',
                   COUNT(*), COALESCE(SUM(size_bytes), 0)
            FROM public.filehub_files
            WHERE company_id = v_company_id AND deleted_at IS NULL AND visibility = 'broadcast'
              AND (v_since IS NULL OR created_at >= v_since)
            HAVING COUNT(*) > 0
            UNION ALL
            SELECT g.name, 'group',
                   COUNT(*), COALESCE(SUM(f.size_bytes), 0)
            FROM public.filehub_files f
            JOIN public.filehub_groups g ON g.id = f.group_id
            WHERE f.company_id = v_company_id AND f.deleted_at IS NULL AND f.visibility = 'group'
              AND (v_since IS NULL OR f.created_at >= v_since)
            GROUP BY g.id, g.name
        ) c
        ORDER BY c.files DESC, c.bytes DESC
        LIMIT 12
    ) t;

    RETURN jsonb_build_object(
        'range_days',    COALESCE(p_days, 0),
        'generated_at',  now(),
        'totals',        COALESCE(v_totals, '{}'::jsonb),
        'top_senders',   COALESCE(v_top_senders, '[]'::jsonb),
        'top_receivers', COALESCE(v_top_receivers, '[]'::jsonb),
        'channels',      COALESCE(v_channels, '[]'::jsonb)
    );
END;
$function$;

-- ── rpc_filehub_analytics(p_from, p_to) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_analytics(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_company_id    UUID := public.my_company_id();
    v_since         TIMESTAMPTZ := p_from::timestamptz;
    v_until         TIMESTAMPTZ := (p_to + 1)::timestamptz;
    v_totals        JSONB;
    v_top_senders   JSONB;
    v_top_receivers JSONB;
    v_channels      JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view File Hub analytics.';
    END IF;

    SELECT jsonb_build_object(
        'files_sent',      COUNT(*),
        'total_bytes',     COALESCE(SUM(f.size_bytes), 0),
        'direct_files',    COUNT(*) FILTER (WHERE f.visibility = 'direct'),
        'broadcast_files', COUNT(*) FILTER (WHERE f.visibility = 'broadcast'),
        'group_files',     COUNT(*) FILTER (WHERE f.visibility = 'group')
    )
    INTO v_totals
    FROM public.filehub_files f
    WHERE f.company_id = v_company_id
      AND f.deleted_at IS NULL
      AND f.visibility <> 'task'
      AND f.created_at >= v_since AND f.created_at < v_until;

    SELECT v_totals || jsonb_build_object(
        'recipients_reached', COUNT(DISTINCT r.user_id),
        'read_rate', CASE
            WHEN COUNT(*) = 0 THEN NULL
            ELSE ROUND(COUNT(*) FILTER (WHERE r.read_at IS NOT NULL)::numeric / COUNT(*), 3)
        END
    )
    INTO v_totals
    FROM public.filehub_recipients r
    JOIN public.filehub_files f ON f.id = r.file_id
    WHERE f.company_id = v_company_id
      AND f.deleted_at IS NULL
      AND f.created_at >= v_since AND f.created_at < v_until;

    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_top_senders
    FROM (
        SELECT
            jsonb_build_object(
                'user_id',    u.id,
                'full_name',  u.full_name,
                'avatar_url', u.avatar_url,
                'files',      COUNT(*),
                'bytes',      COALESCE(SUM(f.size_bytes), 0)
            ) AS row,
            COUNT(*)                       AS files,
            COALESCE(SUM(f.size_bytes), 0) AS bytes
        FROM public.filehub_files f
        JOIN public.users u ON u.id = f.uploaded_by
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility <> 'task'
          AND f.created_at >= v_since AND f.created_at < v_until
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY files DESC, bytes DESC
        LIMIT 5
    ) t;

    WITH receipts AS (
        SELECT r.user_id, f.size_bytes
        FROM public.filehub_recipients r
        JOIN public.filehub_files f ON f.id = r.file_id
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility = 'direct'
          AND f.created_at >= v_since AND f.created_at < v_until
        UNION ALL
        SELECT gm.user_id, f.size_bytes
        FROM public.filehub_files f
        JOIN public.filehub_group_members gm ON gm.group_id = f.group_id
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility = 'group'
          AND gm.user_id <> f.uploaded_by
          AND f.created_at >= v_since AND f.created_at < v_until
    )
    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_top_receivers
    FROM (
        SELECT
            jsonb_build_object(
                'user_id',        u.id,
                'full_name',      u.full_name,
                'avatar_url',     u.avatar_url,
                'files_received', COUNT(*),
                'bytes',          COALESCE(SUM(rc.size_bytes), 0)
            ) AS row,
            COUNT(*)                        AS files,
            COALESCE(SUM(rc.size_bytes), 0) AS bytes
        FROM receipts rc
        JOIN public.users u ON u.id = rc.user_id
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY files DESC, bytes DESC
        LIMIT 5
    ) t;

    SELECT COALESCE(jsonb_agg(t.row ORDER BY t.files DESC, t.bytes DESC), '[]'::jsonb)
    INTO v_channels
    FROM (
        SELECT
            jsonb_build_object(
                'channel', c.label,
                'kind',    c.kind,
                'files',   c.files,
                'bytes',   c.bytes
            ) AS row,
            c.files,
            c.bytes
        FROM (
            SELECT 'Direct Messages'::text AS label, 'direct'::text AS kind,
                   COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes
            FROM public.filehub_files
            WHERE company_id = v_company_id AND deleted_at IS NULL AND visibility = 'direct'
              AND created_at >= v_since AND created_at < v_until
            HAVING COUNT(*) > 0

            UNION ALL
            SELECT 'Company Broadcast', 'broadcast',
                   COUNT(*), COALESCE(SUM(size_bytes), 0)
            FROM public.filehub_files
            WHERE company_id = v_company_id AND deleted_at IS NULL AND visibility = 'broadcast'
              AND created_at >= v_since AND created_at < v_until
            HAVING COUNT(*) > 0

            UNION ALL
            SELECT g.name, 'group',
                   COUNT(*), COALESCE(SUM(f.size_bytes), 0)
            FROM public.filehub_files f
            JOIN public.filehub_groups g ON g.id = f.group_id
            WHERE f.company_id = v_company_id AND f.deleted_at IS NULL AND f.visibility = 'group'
              AND f.created_at >= v_since AND f.created_at < v_until
            GROUP BY g.id, g.name
        ) c
        ORDER BY c.files DESC, c.bytes DESC
        LIMIT 12
    ) t;

    RETURN jsonb_build_object(
        'range_days',    (p_to - p_from) + 1,
        'generated_at',  now(),
        'totals',        COALESCE(v_totals, '{}'::jsonb),
        'top_senders',   COALESCE(v_top_senders, '[]'::jsonb),
        'top_receivers', COALESCE(v_top_receivers, '[]'::jsonb),
        'channels',      COALESCE(v_channels, '[]'::jsonb)
    );
END;
$function$;

-- ── rpc_filehub_overview: guard the company file stats ───────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_overview(p_recent_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.my_company_id();
  v_user    uuid := auth.uid();
  v_limit   int  := LEAST(GREATEST(COALESCE(p_recent_limit, 12), 1), 50);
  v_recent  jsonb;
  v_assigned jsonb;
  v_stats   jsonb;
BEGIN
  IF v_company IS NULL OR NOT public.has_permission('filehub:view') THEN
    RETURN jsonb_build_object('recent_files', '[]'::jsonb,
                              'recently_assigned', '[]'::jsonb,
                              'stats', '{}'::jsonb);
  END IF;

  -- Recently opened spans ALL sources on purpose: task files now log activity
  -- against their pointer, so they belong here (that's the unification unlock).
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.last_opened_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT * FROM (
      SELECT DISTINCT ON (fa.file_id)
        fa.file_id,
        f.original_name,
        f.mime_type,
        f.size_bytes,
        f.bucket,
        f.storage_path,
        f.caption,
        f.visibility,
        f.group_id,
        f.folder_id,
        fa.created_at AS last_opened_at
      FROM public.filehub_activity fa
      JOIN public.filehub_files f
        ON f.id = fa.file_id AND f.deleted_at IS NULL AND f.company_id = v_company
      WHERE fa.user_id = v_user
        AND fa.action IN ('view', 'download')
      ORDER BY fa.file_id, fa.created_at DESC
    ) d
    WHERE public.filehub_file_accessible(d.file_id)
    ORDER BY d.last_opened_at DESC
    LIMIT v_limit
  ) r;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.assigned_at DESC), '[]'::jsonb)
  INTO v_assigned
  FROM (
    SELECT DISTINCT ON (fi.file_id)
      fi.source,
      fi.file_id,
      fi.file_name,
      fi.mime_type,
      fi.size_bytes,
      fi.bucket,
      fi.storage_path,
      fi.task_id,
      t.title AS task_title,
      fi.project_id,
      (SELECT p.name FROM public.projects p WHERE p.id = fi.project_id) AS project_name,
      fi.task_category,
      ta.assigned_at
    FROM public.files_index fi
    JOIN public.task_assignments ta ON ta.task_id = fi.task_id
    JOIN public.tasks t ON t.id = fi.task_id AND t.deleted_at IS NULL
    WHERE fi.company_id = v_company
      AND fi.source IN ('submission', 'task_brief')
      AND (
        ta.assignee_user_id = v_user
        OR ta.assignee_team_id IN (
          SELECT tm.team_id FROM public.team_members tm
          WHERE tm.user_id = v_user AND tm.removed_at IS NULL
        )
      )
    ORDER BY fi.file_id, ta.assigned_at DESC
    LIMIT v_limit * 4
  ) r;
  v_assigned := (
    SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'assigned_at') DESC), '[]'::jsonb)
    FROM (SELECT e FROM jsonb_array_elements(v_assigned) e
          ORDER BY (e->>'assigned_at') DESC LIMIT v_limit) s
  );

  SELECT jsonb_build_object(
    'files_7d', (SELECT count(*) FROM public.filehub_files
                 WHERE company_id = v_company AND deleted_at IS NULL AND visibility <> 'task'
                   AND created_at > now() - interval '7 days'),
    'bytes_7d', (SELECT COALESCE(sum(size_bytes), 0) FROM public.filehub_files
                 WHERE company_id = v_company AND deleted_at IS NULL AND visibility <> 'task'
                   AND created_at > now() - interval '7 days'),
    'inbox_unread', public.rpc_filehub_unread_count(),
    'my_channels', (SELECT count(*) FROM public.filehub_group_members
                    WHERE user_id = v_user)
  ) INTO v_stats;

  RETURN jsonb_build_object(
    'recent_files', v_recent,
    'recently_assigned', v_assigned,
    'stats', v_stats
  );
END;
$function$;
