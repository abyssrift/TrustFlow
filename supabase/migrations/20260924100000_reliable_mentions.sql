-- ====================================================================
-- #461 — reliable, company-scoped, access-aware @mentions
--
-- Before: the picker inserted "@John Smith" as plain text and
-- fn_trg_task_comments_notify regexed '@([A-Za-z0-9_.]+)' (stops at the
-- space) then looked the word up in public.users with NO company filter
-- and LIMIT 1 -> multi-word names never notified, and "@john" could
-- notify a user in another company (leaking the task title).
--
-- After:
--   * task_comments.mentioned_user_ids (uuid[]) is the single source of
--     truth for highlight, the task-list "@" badge and notifications.
--   * A BEFORE trigger sanitizes that column on every write path (the RPC
--     and any direct INSERT/UPDATE the RLS policies allow): distinct,
--     same company as the comment, active, not the author, and able to see
--     the task (task_visible_to).
--   * fn_trg_task_comments_notify emits task.mentioned per stored id. The
--     name regex is gone.
--   * fn_emit_notification_event stamps payload.company_id from the entity
--     when the emitter didn't. Task/project events never carried it, so the
--     edge function only matched legacy company_id-null rules and companies
--     bootstrapped with company-owned rules (20260913070306) got no task
--     notifications. It also scopes the edge function's `role` strategy,
--     which queried user_roles across every company without it.
--   * task_visible_to(task, user) holds the predicate that task_list_visible
--     used to inline for auth.uid(); task_list_visible is now a wrapper.
--   * rpc_task_mentionable_users(task) feeds the picker.
-- ====================================================================

-- 1. Structured mentions ---------------------------------------------------
ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_task_comments_mentioned_user_ids
  ON public.task_comments USING gin (mentioned_user_ids);

-- 2. Task visibility for an arbitrary user ---------------------------------
-- Same predicate as 20260718_fix_task_list_visible_pipeline_visibility.sql,
-- with auth.uid() -> p_user_id. The auth.uid()-bound helpers are swapped for
-- their explicit-user equivalents:
--   my_company_id()   -> users.company_id of p_user_id
--   has_permission(k) -> fn_user_has_permission(p_user_id, k)
-- has_permission() also returns TRUE for owners; fn_user_has_permission()
-- does not. That is equivalent here because is_owner is its own top-level
-- OR branch, so every has_permission() call only matters for non-owners.
CREATE OR REPLACE FUNCTION public.task_visible_to(p_task_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    JOIN public.users me ON me.id = p_user_id
    WHERE t.id = p_task_id AND t.deleted_at IS NULL AND t.company_id = me.company_id
      AND (
        public.fn_user_has_permission(p_user_id, 'system.view_all_data')
        OR COALESCE(me.is_owner, FALSE)
        OR EXISTS (
          SELECT 1 FROM public.pipelines p
          WHERE p.id = t.pipeline_id
            AND p.deleted_at IS NULL
            -- layer 1: pipeline must be visible to the user (mirrors pipelines_select)
            AND (
              p.visibility_permissions = '{}'::text[]
              OR EXISTS (
                SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = p_user_id
                  AND ur.company_id = me.company_id
                  AND ur.revoked_at IS NULL
                  AND (ur.role_id)::text = ANY (p.visibility_permissions)
              )
            )
            -- layer 2: task-level visibility within a pipeline the user can see
            AND (
              public.fn_user_has_permission(p_user_id, 'task.view_all')
              OR public.fn_user_has_permission(p_user_id, 'tasks.view_all')
              OR p.task_visibility_mode = 'all'
              OR (p.task_visibility_mode = 'assigned_only' AND (
                   t.created_by = p_user_id OR t.manager_id = p_user_id
                   OR EXISTS (
                     SELECT 1 FROM public.task_assignments ta
                     WHERE ta.task_id = t.id
                       AND (ta.assignee_user_id = p_user_id
                            OR ta.assignee_team_id IN (
                              SELECT tm.team_id FROM public.team_members tm
                              WHERE tm.user_id = p_user_id AND tm.removed_at IS NULL))
                   )))
            )
        )
        OR (t.pipeline_id IS NULL AND (
              t.created_by = p_user_id OR t.manager_id = p_user_id
              OR public.fn_user_has_permission(p_user_id, 'task.view_all')
              OR public.fn_user_has_permission(p_user_id, 'tasks.view_all')))
      )
  );
$function$;

-- Internal only: lets the caller probe any user's access to any task, so it
-- must not be reachable through PostgREST. SECURITY DEFINER callers
-- (task_list_visible, the mention trigger, rpc_task_mentionable_users) run as
-- the owner and are unaffected.
REVOKE ALL ON FUNCTION public.task_visible_to(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_visible_to(uuid, uuid) TO service_role;

-- Same signature/return type -> in-place replace, existing grants kept.
CREATE OR REPLACE FUNCTION public.task_list_visible(p_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.task_visible_to(p_task_id, auth.uid());
$function$;

-- 3. Sanitize mentioned_user_ids on every write path -----------------------
CREATE OR REPLACE FUNCTION public.fn_trg_task_comments_sanitize_mentions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.mentioned_user_ids := COALESCE((
    SELECT array_agg(DISTINCT u.id)
    FROM unnest(NEW.mentioned_user_ids) AS m(id)
    JOIN public.users u ON u.id = m.id
    WHERE u.company_id = NEW.company_id
      AND u.is_active
      AND u.deleted_at IS NULL
      AND u.id <> NEW.author_id
      AND public.task_visible_to(NEW.task_id, u.id)
  ), '{}'::uuid[]);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_task_comments_sanitize_mentions ON public.task_comments;
CREATE TRIGGER trg_task_comments_sanitize_mentions
  BEFORE INSERT OR UPDATE OF mentioned_user_ids ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_task_comments_sanitize_mentions();

-- 4. rpc_add_task_comment + p_mentioned_user_ids ---------------------------
-- Body is the live one (never tracked in a migration) plus the new column.
-- Signature changes -> drop first, otherwise CREATE OR REPLACE adds a second
-- overload and PostgREST reports an ambiguous function.
DROP FUNCTION IF EXISTS public.rpc_add_task_comment(uuid, text, uuid);

CREATE FUNCTION public.rpc_add_task_comment(
  p_task_id uuid,
  p_content text,
  p_parent_id uuid DEFAULT NULL::uuid,
  p_mentioned_user_ids uuid[] DEFAULT NULL::uuid[]
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_comment_id  UUID;
  v_is_owner    BOOLEAN;
  v_is_assigned BOOLEAN;
  v_is_creator  BOOLEAN;
  v_is_manager  BOOLEAN;
BEGIN
  -- Fetch task
  SELECT company_id INTO v_company_id
  FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Permission check
  v_is_owner   := (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE;
  v_is_creator := EXISTS (SELECT 1 FROM public.tasks WHERE id = p_task_id AND created_by = v_user_id);
  v_is_manager := EXISTS (SELECT 1 FROM public.tasks WHERE id = p_task_id AND manager_id = v_user_id);
  v_is_assigned := EXISTS (
    SELECT 1 FROM public.task_assignments
    WHERE task_id = p_task_id AND (
      assignee_user_id = v_user_id
      OR assignee_team_id IN (SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL)
    )
  );

  IF NOT (v_is_owner OR v_is_creator OR v_is_manager OR v_is_assigned OR public.has_permission('task.comment')) THEN
    RAISE EXCEPTION 'Insufficient permissions to comment on this task';
  END IF;

  -- Validate parent comment if provided
  IF p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.task_comments WHERE id = p_parent_id AND task_id = p_task_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Parent comment not found or belongs to different task';
    END IF;
  END IF;

  -- Insert comment. mentioned_user_ids is sanitized by
  -- trg_task_comments_sanitize_mentions before the row lands.
  INSERT INTO public.task_comments (task_id, company_id, author_id, content, parent_id, mentioned_user_ids)
  VALUES (p_task_id, v_company_id, v_user_id, p_content, p_parent_id, COALESCE(p_mentioned_user_ids, '{}'::uuid[]))
  RETURNING id INTO v_comment_id;

  -- Log event
  PERFORM public.log_event(
    v_company_id, v_user_id, 'task', p_task_id, 'task.comment_added',
    jsonb_build_object('comment_id', v_comment_id, 'is_reply', p_parent_id IS NOT NULL)
  );

  RETURN v_comment_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_add_task_comment(uuid, text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_add_task_comment(uuid, text, uuid, uuid[]) TO authenticated, service_role;

-- 5. Notify trigger: structured mentions, no name regex --------------------
CREATE OR REPLACE FUNCTION public.fn_trg_task_comments_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mentioned_user_id UUID;
  v_actor_name        TEXT;
  v_excerpt           TEXT;
BEGIN
  -- Skip system-generated comments
  IF NEW.is_system THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(display_name, ''), full_name) INTO v_actor_name
  FROM public.users WHERE id = NEW.author_id;

  v_excerpt := btrim(regexp_replace(NEW.content, '\s+', ' ', 'g'));
  IF char_length(v_excerpt) > 100 THEN
    v_excerpt := left(v_excerpt, 100) || '…';
  END IF;

  -- task.commented
  PERFORM public.fn_emit_notification_event(
    'task.commented',
    'task',
    NEW.task_id,
    NEW.author_id,
    jsonb_build_object(
      'task_id',      NEW.task_id,
      'company_id',   NEW.company_id,
      'comment_id',   NEW.id,
      'commented_by', NEW.author_id,
      'actor_name',   v_actor_name,
      'excerpt',      v_excerpt
    )
  );

  -- task.mentioned — one event per sanitized mentioned user id
  FOREACH v_mentioned_user_id IN ARRAY NEW.mentioned_user_ids LOOP
    PERFORM public.fn_emit_notification_event(
      'task.mentioned',
      'task',
      NEW.task_id,
      NEW.author_id,
      jsonb_build_object(
        'task_id',           NEW.task_id,
        'company_id',        NEW.company_id,
        'comment_id',        NEW.id,
        'mentioned_user_id', v_mentioned_user_id,
        'mentioned_by',      NEW.author_id,
        'actor_name',        v_actor_name,
        'excerpt',           v_excerpt
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 6. Company-scope every notification event at the one shared entry point --
CREATE OR REPLACE FUNCTION public.fn_emit_notification_event(p_event_type text, p_entity_type text, p_entity_id uuid, p_actor_id uuid, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload    jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_company_id uuid;
BEGIN
  -- process-notification-event matches company-owned rules only when the
  -- event carries company_id. Resolve it from the entity when the emitter
  -- didn't. IF branches (not one CASE) so each lookup is planned only for
  -- its own entity type.
  IF v_payload->>'company_id' IS NULL THEN
    IF p_entity_type = 'task' THEN
      SELECT company_id INTO v_company_id FROM public.tasks WHERE id = p_entity_id;
    ELSIF p_entity_type = 'project' THEN
      SELECT company_id INTO v_company_id FROM public.projects WHERE id = p_entity_id;
    ELSIF p_entity_type = 'portfolio' THEN
      SELECT company_id INTO v_company_id FROM public.portfolios WHERE id = p_entity_id;
    ELSIF p_entity_type = 'project_template' THEN
      SELECT company_id INTO v_company_id FROM public.project_templates WHERE id = p_entity_id;
    END IF;
    -- ponytail: filehub_file emitters already pass company_id; add a branch
    -- here if a new entity_type starts emitting without it.
    IF v_company_id IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object('company_id', v_company_id);
    END IF;
  END IF;

  INSERT INTO public.notification_events
    (event_type, entity_type, entity_id, actor_id, payload)
  VALUES
    (p_event_type, p_entity_type, p_entity_id, p_actor_id, v_payload);
END;
$function$;

-- 7. Picker source ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_task_mentionable_users(p_task_id uuid)
 RETURNS TABLE (id uuid, full_name text, display_name text, avatar_url text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.task_visible_to(p_task_id, auth.uid()) THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  RETURN QUERY
  SELECT u.id, u.full_name, u.display_name, u.avatar_url
  FROM public.users u
  WHERE u.company_id = (SELECT t.company_id FROM public.tasks t WHERE t.id = p_task_id)
    AND u.is_active
    AND u.deleted_at IS NULL
    AND u.id <> auth.uid()
    AND public.task_visible_to(p_task_id, u.id)
  ORDER BY COALESCE(NULLIF(u.full_name, ''), u.display_name);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_task_mentionable_users(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_task_mentionable_users(uuid) TO authenticated, service_role;
