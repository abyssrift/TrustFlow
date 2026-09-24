# Issue #465: context handoff

Written 2026-09-24 by the Claude session that shipped #461. Everything marked **verified** was checked against the production database (`wbvgufqfgbvbinjrdzlg`) or the repo on that date. Everything else is marked as an assumption or an open question. Read `gh issue view 465` first. This doc adds what the issue doesn't say, and corrects one thing the issue understates.

Follow `AGENTS.md` and `.agents/rules/*` as usual. None of this work touches the UI.

---

## 0. What #461 just changed (the baseline)

#461 is merged to `experimental` (`649045f`) and deployed to prod: migration `reliable_mentions` plus edge function `process-notification-event` v20. The migration file is `supabase/migrations/20260924100000_reliable_mentions.sql`. Its check script is `supabase/checks/20260924100000_reliable_mentions_check.sql`, which runs as BEGIN/ROLLBACK and follows the convention for this folder.

What exists now (all **verified** on prod):

- `task_comments.mentioned_user_ids uuid[] NOT NULL DEFAULT '{}'`, with a GIN index.
- `task_visible_to(p_task_id uuid, p_user_id uuid)` is SECURITY DEFINER and executable by service_role only. It holds the visibility rule.
- `task_list_visible(p_task_id uuid)` is now a one-line wrapper: `task_visible_to(p_task_id, auth.uid())`. Its callers include global search (`20260714_global_search_v2.sql`) and whatever else greps up.
- `fn_trg_task_comments_sanitize_mentions` is a BEFORE INSERT / UPDATE OF `mentioned_user_ids` trigger. It filters the ids down to users who are distinct, in the same company, active, not the author, and pass `task_visible_to`, and it turns NULL into `{}`.
- `fn_trg_task_comments_notify` is an AFTER INSERT trigger. It emits `task.commented` once, then `task.mentioned` once per id in `mentioned_user_ids`. The payloads carry `company_id`, `actor_name` and `excerpt`.
- `fn_emit_notification_event` fills in `payload.company_id` from the entity (task, project, portfolio or template) when it's missing. Every notification event goes through this function.
- `rpc_task_mentionable_users(p_task_id)` feeds the `@` picker and filters with `task_visible_to`.
- Edge function step 3b removes any recipient who isn't in the event's company.

---

## 1. Archive restore re-fires notifications. It's worse than the issue says.

### Verified facts

- The restore path is `rpc_restore_archive(p_archive_id)` → `_internal_restore_task_archive(p_archive_id)`. There's also `_internal_restore_project_archive(p_archive_id)`, which probably restores task subtrees through the same function; confirm this.
- The latest body in the repo is in `supabase/migrations/20260728_archive_manual_time_subtree_restore_locks.sql`, starting around line 230. It re-inserts rows with `INSERT … SELECT (jsonb_populate_record(NULL::<table>, x)).*` for `tasks`, `task_assignments`, `task_comments`, `task_attachments`, `pipeline_stage_history`, `task_work_sessions`, `task_manual_time_entries` and (per snapshot keys) `task_submissions`. **Get the live body from prod with `pg_get_functiondef` before editing.** Several functions in this repo have drifted from their migration files.
- Snapshot keys found on prod: `assignments, attachments, comments, history, manual_time_entries, project, submissions, task, work_sessions`.

**Triggers that fire notifications on the restored tables (verified on prod):**

| Table | Trigger | Function | Re-fired on restore |
|---|---|---|---|
| `tasks` | `trg_tasks_notify_insert` | `fn_trg_tasks_notify_insert` | yes, INSERT → likely `task.created` |
| `tasks` | `trg_tasks_notify_update` | `fn_trg_tasks_notify_update` | only if the restore also UPDATEs a task; check |
| `task_assignments` | `trg_task_assignments_notify` | `fn_trg_task_assignments_notify` | yes → likely `task.assigned` to every assignee |
| `task_comments` | `trg_task_comments_notify` | `fn_trg_task_comments_notify` | yes → `task.commented` per comment, plus `task.mentioned` per stored mention |

So one restore currently sends a "created" notification, an "assigned to you" to each assignee, and a "commented" for **each** comment. With #461, archives taken from now on will also send a "mentioned" for each stored mention. These go out as push and email as well as in-app. Only the mention part is new; the rest predates #461.

**Other triggers on these tables that are not notifications but still matter for a restore** (don't break them, and check whether they *should* run on restore):
- `tasks`: `tr_auto_stop_timer`, `trg_tasks_clear_claim_on_stage_change`, `trg_tasks_harvest_deliverable`, `trg_tasks_recursive_sync`, `trg_tasks_sync_portfolio_id`, `trg_tasks_sync_status`, `trg_tasks_search_tsv`.
- `task_attachments`: `trg_filehub_link_task_file`, `trg_task_attachments_purge_claim_guard`.
- `task_comments`: `trg_task_comments_sanitize_mentions`, which re-checks visibility at restore time. That's desirable. `trg_task_comments_search_tsv`.
- `task_work_sessions`: `trg_backfill_session_duration`.

Out of scope for this issue, but keep them in mind so the fix doesn't disable them.

### Suggested approach (open to challenge)

Mark the transaction during a restore and have the **notification** triggers skip while the mark is set:

```sql
-- in _internal_restore_task_archive (and the project restore, if it doesn't route through it), before the inserts:
PERFORM set_config('app.restoring_archive', 'on', true);   -- transaction-local
-- at the top of each notify trigger function:
IF current_setting('app.restoring_archive', true) = 'on' THEN RETURN NEW; END IF;
```

Alternatives to weigh:
- **`ALTER TABLE … DISABLE TRIGGER`.** Takes an ACCESS EXCLUSIVE lock and affects every session. Reject.
- **Putting the guard in `fn_emit_notification_event`.** One place instead of four. But it would also silence notifications the restore should legitimately send, if any exist. Is there a "task restored" notification anyone wants? Today there isn't.
- **`session_replication_role = replica`.** Disables every trigger, including search_tsv, filehub linking and status sync. Reject.

The guard in `fn_emit_notification_event` is the smallest diff. Choose it only if you confirm that nothing a restore should notify about goes through that function. `task.pinged` and the timer auto-stop insert into `notifications` directly and don't go through it.

### Watch out for the overload trap

Changing a function's signature or return type with `CREATE OR REPLACE` either creates a second overload or fails. `DROP` first and re-GRANT exactly what was granted before. See commit `aa13ff5` for a recent example. Adding a guard line to an unchanged signature is a plain `CREATE OR REPLACE` and keeps the grants.

---

## 2. Project-only task members can't be mentioned, and the two visibility rules have drifted both ways

### Verified facts: there are two rules and they disagree

**The RLS policy `tasks_select_visibility` on prod:**
- **has** a project branch: `pipeline_id IS NULL AND (… OR (project_id IS NOT NULL AND fn_project_accessible(project_id)))`.
- **lacks** the board-level role gate (`pipelines.visibility_permissions` / `user_roles`).

**`task_visible_to` / `task_list_visible`** (from `20260718_fix_task_list_visible_pipeline_visibility.sql`, carried into #461 unchanged):
- **has** the board-level role gate, "layer 1, mirrors pipelines_select".
- **lacks** the project branch.

What that means in practice:
- A board-less project task that a project member can open under RLS won't show up for them in global search. That member also can't be @mentioned on it, and gets an empty picker there themselves.
- The reverse is also possible. RLS may let someone read a task on a board whose roles hide that board from them, while search and mentions (correctly) exclude it. Whether the missing layer in RLS is a hole or deliberate is an **open question**. `pipelines_select` probably blocks the board, but a task row could still be readable by id. Check whether any RLS path exposes such a task.

`fn_project_accessible(p_project_id uuid)` exists on prod and is tied to `auth.uid()`. There is **no** version that takes an explicit user, and `task_visible_to` needs one. The edge function's `payload_users` strategy has a comment explaining that project audiences are resolved in the database at emit time for exactly this reason.

### What to decide (bring this to the user, don't pick silently)

1. **Which rule is authoritative?** The project's memory says to reuse `task_list_visible` and never hand-copy the policy. Now that they differ in both directions, the target is probably the union of the project branch and the board-role gate. That is a security-relevant decision, though, so state it explicitly in the plan.
2. **Should the RLS policy be changed too, or only `task_visible_to`?** Changing RLS widens or narrows direct table reads across the whole app. Changing only `task_visible_to` affects search, the mention picker and mention sanitization.

### Suggested approach

- Add `fn_project_accessible_to(p_project_id uuid, p_user_id uuid)`, the same rule with the user as a parameter. Make `fn_project_accessible(p)` a wrapper that calls `fn_project_accessible_to(p, auth.uid())`, the same pattern #461 used for `task_visible_to`. Look out for `has_permission` inside it: the explicit-user version is `fn_user_has_permission(user, key)`, and it does **not** return true for owners, whereas `has_permission` does. Handle owners explicitly.
- Add the project branch to `task_visible_to` inside the `pipeline_id IS NULL` arm, matching the RLS shape.
- **Verify with a before/after snapshot** (this is how #461 proved no regression):

```sql
-- run before and after; compare md5 + visible_pairs
select count(*) users, md5(string_agg(u.id::text||':'||v.h, ',' order by u.id)) snapshot, sum(v.n) visible_pairs
from public.users u
cross join lateral (select set_config('request.jwt.claim.sub', u.id::text, true),
                           set_config('request.jwt.claims', json_build_object('sub',u.id,'role','authenticated')::text, true)) s(a,b)
cross join lateral (select md5(coalesce(string_agg(t.id::text, ',' order by t.id),'')) h, count(*) n
                    from public.tasks t where s.a is not null and public.task_list_visible(t.id)) v;
```

Prod baseline on 2026-09-24: 20 users, 2644 visible pairs, md5 `a413362499f7d24da0b13dd7378231f0`. After the fix, the only differences allowed are the added (project member, board-less project task) pairs. Produce that diff as a list, not only a hash.

---

## 3. Environment rules (from past incidents; not optional)

- **The main checkout `C:\Users\j\Documents\Github\TrustFlow` is shared with live sessions.** Don't `checkout`, `merge`, `stash` or `reset` there. Work in your own worktree off `origin/experimental`. Agent worktrees can default to `master`, which is far behind, so base explicitly. Merge by pushing `HEAD:experimental` from a detached worktree.
- **Local DB:** `MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres`. **Never** run `supabase db reset`: it restores functions that call prod URLs and breaks local login. The local DB is **behind prod**: no `schema_migrations` rows, and `notification_rules.company_id` is missing. Test logic locally, but check function bodies against prod.
- **The main checkout's `.env` points at PROD.**
- **Prod changes:** apply via Supabase MCP `apply_migration`, only after the user approves. Before applying, take the snapshot in §2 and check `\df` for overloads. After applying, re-run the snapshot and run a live test that raises at the end so it rolls back (#461 did this; see its issue comment).
- **Edge functions** deploy separately. `process-notification-event` on prod is v20 and matches the repo as of `649045f`.
- **Realtime:** use `freshChannel()` from `lib/supabase`, never `supabase.channel()`. Probably irrelevant here.
- Commit-message trailer and issue conventions are in `CLAUDE.md`. Claim #465 (`in-progress` label plus a comment) before starting.

## 4. Definition of done

- [ ] A restore of a task with comments, a mention and assignees emits **zero** new `notification_events` rows. Check `task.created`, `task.assigned`, `task.commented` and `task.mentioned`. Cover the project restore path too.
- [ ] Normal comment, assign and create still emit exactly what they did before.
- [ ] Non-notification triggers still run on restore: search_tsv, filehub link and status sync.
- [ ] The decision on authoritative visibility is recorded in the issue.
- [ ] `task_visible_to` includes project access. The snapshot diff shows only the intended added pairs.
- [ ] A project member can be @mentioned on a board-less project task and receives the notification.
- [ ] Check scripts are in `supabase/checks/` (BEGIN/ROLLBACK, fail with RAISE EXCEPTION, print a PASS line).
- [ ] No new tsc errors. The baseline has 182 pre-existing errors.
