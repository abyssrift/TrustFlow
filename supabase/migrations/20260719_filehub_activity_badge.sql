-- 20260719_filehub_activity_badge.sql
-- Sidebar FileHub badge: was "unread direct sends" only. Broadcasts and channel
-- files create no per-user read state, so they never badged. This turns the
-- badge into a full "new activity" count = unread direct + new broadcasts +
-- new channel files, using a per-user last-seen marker for the two scopes that
-- lack per-recipient rows.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. filehub_seen — per-user "last looked at this scope" marker.
--    Direct sends don't need this (they have filehub_recipients.read_at); only
--    broadcast (one row per user) and group/channel (one row per user+channel).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.filehub_seen (
    user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    scope        TEXT NOT NULL CHECK (scope IN ('broadcast', 'group')),
    group_id     UUID REFERENCES public.filehub_groups(id) ON DELETE CASCADE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((scope = 'group') = (group_id IS NOT NULL))
);

-- One marker per (user, scope, channel). COALESCE folds the NULL group_id of
-- the broadcast scope into a sentinel so the unique index / ON CONFLICT works.
CREATE UNIQUE INDEX IF NOT EXISTS idx_filehub_seen_uniq
    ON public.filehub_seen(user_id, scope, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.filehub_seen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS filehub_seen_select_own ON public.filehub_seen;
CREATE POLICY filehub_seen_select_own ON public.filehub_seen
    FOR SELECT USING (user_id = auth.uid());
-- All writes go through the SECURITY DEFINER RPC below; no write policies.

-- Seed existing users/memberships as "caught up as of now" so the badge doesn't
-- dump the entire back-catalogue of broadcasts/channel files on first load after
-- deploy. Users who join later start with no row (everything is genuinely new to
-- them) and clear it the first time they open the tab/channel.
INSERT INTO public.filehub_seen (user_id, scope, group_id, last_seen_at)
SELECT id, 'broadcast', NULL, now() FROM public.users
ON CONFLICT DO NOTHING;

INSERT INTO public.filehub_seen (user_id, scope, group_id, last_seen_at)
SELECT user_id, 'group', group_id, now() FROM public.filehub_group_members
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. rpc_filehub_mark_scope_seen — call when a user opens Broadcast or a channel.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_mark_scope_seen(
    p_scope    TEXT,
    p_group_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user UUID := auth.uid();
BEGIN
    IF p_scope NOT IN ('broadcast', 'group') THEN
        RAISE EXCEPTION 'Invalid scope: %', p_scope;
    END IF;
    IF (p_scope = 'group') <> (p_group_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Channel scope requires a group_id; broadcast must not have one.';
    END IF;

    INSERT INTO public.filehub_seen (user_id, scope, group_id, last_seen_at)
    VALUES (v_user, p_scope, p_group_id, now())
    ON CONFLICT (user_id, scope, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET last_seen_at = now();
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. rpc_filehub_unread_count — full activity total (direct + broadcast + group).
--    Own uploads never count. Broadcast/channel "new" = created after last-seen
--    (or all, if no marker — a user who has genuinely never looked).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_unread_count()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user       UUID := auth.uid();
    v_company    UUID := public.my_company_id();
    v_direct     INT;
    v_broadcast  INT;
    v_group      INT;
    v_bcast_seen TIMESTAMPTZ;
BEGIN
    -- Direct: unread recipient rows (unchanged semantics).
    SELECT COUNT(*) INTO v_direct
    FROM   public.filehub_recipients r
    JOIN   public.filehub_files f ON f.id = r.file_id
    WHERE  r.user_id = v_user
      AND  r.read_at IS NULL
      AND  f.deleted_at IS NULL;

    -- Broadcast: company broadcasts newer than my last-seen, excluding my own.
    SELECT last_seen_at INTO v_bcast_seen
    FROM   public.filehub_seen
    WHERE  user_id = v_user AND scope = 'broadcast';

    SELECT COUNT(*) INTO v_broadcast
    FROM   public.filehub_files f
    WHERE  f.company_id = v_company
      AND  f.visibility = 'broadcast'
      AND  f.deleted_at IS NULL
      AND  f.uploaded_by <> v_user
      AND  (v_bcast_seen IS NULL OR f.created_at > v_bcast_seen);

    -- Channels: for each channel I'm in, files newer than my per-channel
    -- last-seen, excluding my own.
    SELECT COUNT(*) INTO v_group
    FROM   public.filehub_files f
    JOIN   public.filehub_group_members m
           ON m.group_id = f.group_id AND m.user_id = v_user
    LEFT JOIN public.filehub_seen s
           ON s.user_id = v_user AND s.scope = 'group' AND s.group_id = f.group_id
    WHERE  f.visibility = 'group'
      AND  f.deleted_at IS NULL
      AND  f.company_id = v_company
      AND  f.uploaded_by <> v_user
      AND  (s.last_seen_at IS NULL OR f.created_at > s.last_seen_at);

    RETURN (v_direct + v_broadcast + v_group)::INT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_mark_scope_seen(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_unread_count()             TO authenticated;
