
UX & Performance Enhancements (High Priority)
Focusing on speed, mobile usability, and reducing cognitive load.

Mobile File Handling: Detect OS and stream direct media extensions (images, PDFs, videos) instead of forcing .zip downloads.

Task Management Optimization:

Implement manual card reordering (drag-and-drop) to manage high-volume task lists.

Standardization: Standardize all time units across the frontend and ensure graphs reflect appropriate, consistent time units.

Feature Expansion (Medium Priority)
Additions to improve collaboration, documentation, and organizational clarity.

Task Reversal/Leading: Ability for managers to revert or override task states to correct workflow errors.

Organization & Overwhelm Reduction:

Shared Tasks: Define a system for cross-pipeline cooperation.

Calendar Integration: Visualize tasks in a calendar view to provide a clearer timeline. (a way to change the view from kanban board to calendar in a nice animation, allowing users to organize their thoughts.)

Kanban board: Create better high-level views to prevent users from feeling overwhelmed by too many tasks at once. (Requires thinking it throughly, we need a detailed plan, will take multiple days and weeks of development)

Backend & Automation (Future Roadmap)
Supporting the structural growth of the platform.

Task Automation: Implement automatic archival processes.

Integration/API: Standardize API calls to support cross-pipeline task management and external integrations.

add a sidebar on kanban board like the sidebar on the other side to show everyone who has access to the pipeline as well as other pipeline relative information, the sidebar is always collapsed and only a slight small line is visible on the right, which is connected to a small circular bump at the top where if you hover, the sidebar expands and shows.

allow also users to write personel notes in that sidebar, just things they wanna lookout for, that note system should be like the windows notes application, where you can open multiple notes and view only one, the others stay at the top at a nice selector, modern, sleek and elegant

ON native mobile, clicking an excel sheet in the task brief doesnt open it internally in the app, it just redirects you to the link to download it, which i hope we can add a redirect link to re take you to the app without making it annoying. (maybe get download permissions? i wanna make the download experience seamless for users.)

on desktop web, when you click on a file/excel/picture or whatever that requires me to open it via the storage URL in supabase, open it in another tab rather than the app's tab

Adding Routines as a subcategory of automations in pipeline builder, where tasks can be recurring, some specific tasks can be routed differenlty, etc.

allowing files to be shareable by a one click link and somehow allow for some kind of security ish thing, the link should be auto generatable by filehub, and have a limited expiry date, and RLS policies and similar, that way team members can share links outside the platform easily.

folders in the filehub get deleted without being soft deleted first, insane bug!

the file too large to load thing should be for 500 KB for mobile, and way higher for desktop, because desktop can get way bigger files.

Selection and bulk actions are not inclusive of folders, i want windows explorer like interactions.

clicking ctrl and clicking a file should select it. 
Dragging a file to a folder while selecting multiple should drag them all to the folder.

The add new folder button that is in the filehub should be added to the header below the tab switcher rather than take up space in the middle, i want it to be like windows explorer.

Whenever there are new files/new activity happening there should be something showing and a number displayed on the icon in the sidebar.

Top bar looks wonderful, but there are features deeply missing.
1. user's profile picture isnt displayed
2. bar should disappear when users scroll down in the page, appear when users scroll up in the same page. 
3. its look is a bit out of place for the tasks.tsx, it just blocks the background, allow for personalization for changing the color to transparent.
4. Allow users to attach 4 shortcuts at the top if they want, it could be shortcuts to specific pipelines or something similar.
5. Get the searchbar to get up and be running, its very important that we get it working to be able to index everything, files in the filehub, reports, tasks, descriptions, dates, i want a very very smart search bar. capable of recognizing when a user is looking for a task, or a date that something specific happened on, etc. (This one requires excessive planning, skip it if you're an AI looking for quick wins)
6. allow the top bar to be retractable completely, showing only a small tip that lets you pull it back down (not really its just a button)

when a new task is added to a pipeline, would it be possible to play a small nice ding sound when the user isnt looking at the app? (Generally refactoring and adding nice sounds to everything. haptics for native, nice dings for desktop)

Dragging a file into the folder works but dropping it doesnt change anything, i tried it in a channel.

Performance tab should allow for day by day comparison

going back in [id].tsx somehow is broken and re directs me to the dashboard.

the shareable links are nice, i also hope to allow the shareable looks to apply for folders as well, and have the same preview style as normal files/folders. i want a massive ecosystem for this share system. including download permissions on and off etc,

Give the Folder properties like files, where we can view properties on the right when we click on it, also the clickableopacity of the folders is much smaller than files for some reason.








Claude cut off:

You chose the full activity count. That's a real feature — per-user last-seen tracking plus a rewritten count RPC and realtime wiring. Let me set up the plan and build it methodically.

Update Todos

Fix channel file drop no-op

Platform-aware spreadsheet preview size threshold

Bulk selection including folders (Explorer-style) on desktop

Migration: filehub_seen table + mark_scope_seen RPC + rewrite unread_count to full total

Context: markScopeSeen fn + realtime on new files; wire mark-seen on broadcast/channel view

Badge hook: refetch on new broadcast/channel files
Bash
IN
cd "/c/Users/PC/Documents/GitHub/TrustFlow" && f=$(grep -rl "FUNCTION public.rpc_filehub_unread_count" supabase/migrations/ | tail -1); echo "FILE: $f"; sed -n '1,30p' "$f"

OUT
FILE: supabase/migrations/20260527_filehub_phase3_notifications.sql
-- 20260527_filehub_phase3_notifications.sql
-- File Hub Phase 3: QOL + Notification Engine Integration
--
-- 1. rpc_filehub_unread_count — lightweight badge RPC
-- 2. rpc_filehub_upload_commit — emits notification events on file send
-- 3. Seed default notification rules for filehub events

-- ─── 1. UNREAD COUNT RPC ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_filehub_unread_count()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM   public.filehub_recipients r
  JOIN   public.filehub_files f ON f.id = r.file_id
  WHERE  r.user_id  = auth.uid()
    AND  r.read_at  IS NULL
    AND  f.deleted_at IS NULL;
$$;

-- ─── 2. UPLOAD COMMIT WITH NOTIFICATION EVENTS ───────────────────────────────
-- Drop the 12-param version to replace it with notification logic.
DROP FUNCTION IF EXISTS public.rpc_filehub_upload_commit(TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID);

CREATE OR REPLACE FUNCTION public.rpc_filehub_upload_commit(
    p_storage_path     TEXT,
    p_visibility       TEXT,
Grep "emitUnreadCount|filehub:unread-count" (in c:\Users\PC\Documents\GitHub\TrustFlow\contexts\FileHubContext.tsx)
4 lines of output
Read c:\Users\PC\Documents\GitHub\TrustFlow\contexts\FileHubContext.tsx (lines 426-485)
Now I understand the integration points. inboxUnreadCount (direct-only) stays for the Inbox tab label; the badge hook becomes the single source computing the full total via the RPC, refetching on events. Let me write the migration.

Write c:\Users\PC\Documents\GitHub\TrustFlow\supabase\migrations\20260719_filehub_activity_badge.sql
133 lines
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
Claude AI Supabase [apply_migration]CREATE TABLE IF NOT EXISTS public.filehu…
OUT
{"success":true}

You've hit your session limit · resets 2:10am (Africa/Cairo)