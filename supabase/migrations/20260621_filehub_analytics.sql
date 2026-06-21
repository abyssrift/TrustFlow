-- 20260621_filehub_analytics.sql
-- Tier 3 Phase 2: FileHub Analytics Dashboard (company-scoped)
-- One RPC that aggregates File Hub usage for the CALLER'S COMPANY only:
--   • totals       — files sent, total volume, per-channel counts, reach, read rate
--   • top_senders  — top 5 uploaders by file count
--   • top_receivers— top 5 recipients (direct recipients + group members)
--   • channels     — communication channels ranked by volume
--                    (Direct Messages, Company Broadcast, and each Group)
-- Scoped via public.my_company_id(); gated by the filehub:view permission.

CREATE OR REPLACE FUNCTION public.rpc_filehub_analytics(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    -- p_days <= 0 (or NULL) → all-time
    v_since := CASE
        WHEN p_days IS NULL OR p_days <= 0 THEN NULL
        ELSE now() - make_interval(days => p_days)
    END;

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
      AND (v_since IS NULL OR f.created_at >= v_since);

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
      AND (v_since IS NULL OR f.created_at >= v_since);

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
          AND (v_since IS NULL OR f.created_at >= v_since)
        GROUP BY u.id, u.full_name, u.avatar_url
        ORDER BY files DESC, bytes DESC
        LIMIT 5
    ) t;

    -- ── Top 5 receivers (direct recipients + group members) ──────────────────
    WITH receipts AS (
        -- Direct: explicit recipients
        SELECT r.user_id, f.size_bytes
        FROM public.filehub_recipients r
        JOIN public.filehub_files f ON f.id = r.file_id
        WHERE f.company_id = v_company_id
          AND f.deleted_at IS NULL
          AND f.visibility = 'direct'
          AND (v_since IS NULL OR f.created_at >= v_since)
        UNION ALL
        -- Group: every member of the file's group except the uploader
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
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_analytics(INT) TO authenticated;
