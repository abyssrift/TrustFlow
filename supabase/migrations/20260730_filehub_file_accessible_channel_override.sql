-- 20260730_filehub_file_accessible_channel_override.sql
-- Bug (two reported symptoms, one cause): an owner/admin browsing a channel
-- they are NOT a member of could SEE its files but every action on one failed —
--   * opening the Versions tab  -> 'File not found or not accessible.'
--                                  (rpc_filehub_file_versions)
--   * Share                     -> 'File not found.'
--                                  (rpc_filehub_share_link_create)
--
-- Cause: rpc_filehub_group_list_files admits a caller via
--     member OR filehub:group_override OR filehub:group_override_manage
-- but filehub_file_accessible()'s 'group' branch only ever checked real
-- membership. So the list handed back 10 files and the shared accessibility
-- predicate answered false on all 10. Measured against prod for the owner
-- account: files_listed = 10, filehub_file_accessible = false.
--
-- filehub:group_override is literally "Browse Any Channel (View Only)", so the
-- predicate was the side that was wrong, not the list. Fixing it in the ONE
-- shared function repairs every caller at once rather than per-RPC:
--   filehub_can_share_file, rpc_filehub_browse, rpc_filehub_file_versions,
--   rpc_filehub_overview, rpc_filehub_recipient_hide,
--   rpc_filehub_share_link_create, rpc_filehub_share_link_revoke,
--   rpc_files_search, rpc_global_search
-- (all nine were silently under-reporting for override holders; only the two
-- the user happened to click surfaced an error.)
--
-- NOT widened: the 'direct' branch. A 1:1 send between two other people stays
-- private to sender + recipients even for an owner — that's a mailbox, not a
-- shared channel, and neither the list RPCs nor the table RLS expose it. The
-- override permissions are about channels, and this change keeps them that way.
--
-- Owners need no special case: has_permission() already returns true on every
-- key for users.is_owner, so the two checks below cover them.
--
-- Body is otherwise verbatim from 20260727_filehub_unify_phase1_schema.sql;
-- the ONLY change is the two added OR'd permission checks on the group branch,
-- which brings it in line with filehub_folder_accessible (20260730) and with
-- rpc_filehub_group_list_files.
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
              OR (f.visibility = 'group' AND f.group_id IS NOT NULL AND (
                     EXISTS (
                         SELECT 1 FROM public.filehub_group_members gm
                         WHERE gm.group_id = f.group_id AND gm.user_id = auth.uid()
                     )
                     -- Added: match what rpc_filehub_group_list_files admits.
                     OR public.has_permission('filehub:group_override')
                     OR public.has_permission('filehub:group_override_manage')
                 ))
              OR (f.visibility = 'task' AND f.task_id IS NOT NULL AND public.fn_task_file_accessible(f.task_id))
          )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.filehub_file_accessible(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filehub_file_accessible(UUID) TO authenticated;

-- ── Self-check: the exact reported case, against real rows ───────────────────
-- Impersonates via request.jwt.claims, so it asserts the real auth path rather
-- than a hand-rolled boolean. Picks an owner who is NOT a member of the channel
-- the file lives in, which is precisely the configuration that broke.
DO $$
DECLARE
    v_file  UUID;
    v_group UUID;
    v_owner UUID;
    v_listed INT;
    v_acc    BOOLEAN;
BEGIN
    -- A group file whose channel has at least one non-member owner.
    SELECT f.id, f.group_id INTO v_file, v_group
    FROM public.filehub_files f
    WHERE f.visibility = 'group' AND f.group_id IS NOT NULL AND f.deleted_at IS NULL
    LIMIT 1;

    IF v_file IS NULL THEN
        RAISE NOTICE 'no group files present; skipping runtime assertion';
        RETURN;
    END IF;

    SELECT u.id INTO v_owner
    FROM public.users u
    WHERE u.is_owner
      AND u.company_id = (SELECT company_id FROM public.filehub_files WHERE id = v_file)
      AND NOT EXISTS (
          SELECT 1 FROM public.filehub_group_members gm
          WHERE gm.group_id = v_group AND gm.user_id = u.id
      )
    LIMIT 1;

    IF v_owner IS NULL THEN
        RAISE NOTICE 'no non-member owner for this channel; skipping runtime assertion';
        RETURN;
    END IF;

    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

    v_listed := jsonb_array_length(public.rpc_filehub_group_list_files(v_group));
    v_acc    := public.filehub_file_accessible(v_file);

    -- The invariant that was violated: if the channel list shows you files,
    -- the accessibility predicate must agree about them.
    ASSERT v_listed > 0, 'override owner should see channel files in the list';
    ASSERT v_acc, format(
        'filehub_file_accessible must agree with the list (listed %s files, accessible=%s)',
        v_listed, v_acc);

    -- And the gate that depends on it must now resolve too.
    ASSERT public.filehub_can_share_file(v_file),
        'an owner should be able to share a channel file they can browse';

    RAISE NOTICE 'channel-override accessibility assertions passed';
END $$;
