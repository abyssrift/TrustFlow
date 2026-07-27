-- #139: FileHub analytics on a calendar start/end range.
-- Overload of rpc_filehub_analytics taking (p_from, p_to) dates instead of
-- p_days. Same aggregation; window is [p_from, p_to] inclusive. The old
-- p_days signature stays for older clients.

CREATE OR REPLACE FUNCTION public.rpc_filehub_analytics(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    -- ── Totals (file-level) ──────────────────────────────────────────────────
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
      AND f.created_at >= v_since AND f.created_at < v_until;

    -- ── Totals (recipient-level): reach + read rate for direct sends ─────────
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

    -- ── Top 5 senders (by files uploaded) ────────────────────────────────────
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
          AND f.created_at >= v_since AND f.created_at < v_until
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY files DESC, bytes DESC
        LIMIT 5
    ) t;

    -- ── Top 5 receivers (direct recipients + group members) ──────────────────
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

    -- ── Channels ranked by volume ────────────────────────────────────────────
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
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_analytics(DATE, DATE) TO authenticated;
