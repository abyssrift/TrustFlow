# Task Stage Reversal (issue #22)

## Problem

Managers have no way to correct a mistaken stage transition once a task has
moved. Every stage move goes through `rpc_advance_stage`, which only allows
transitions defined in `pipeline_stage_transitions` — a forward-only DAG. The
only bypass is `is_owner`. There is no manager-level "undo the last move."

## What already exists (and is dead)

Two pieces of prior scaffolding exist in the codebase but were never wired
together — this feature completes them rather than starting from scratch:

- `lib/roleTemplates.ts:37` declares a `pipeline.reverse` permission key on
  the "Project Manager" role template. No RPC checks it anywhere.
- `pipeline_stage_history.is_reversal` (boolean) is read and exposed by every
  `rpc_get_task_details`-style query, and `components/task-detail/
  PipelineJourney.tsx:48,60-64` already renders a "REVERSAL" badge when it's
  true. No code ever sets it — it is always false today.

## Scope

- Revert the task to whatever stage it was in **immediately before** its
  current stage (one step back), not an arbitrary-stage override. This
  matches the issue's "correct a mistaken transition" motivation.
- Scoped to same-pipeline history only. If the task's most recent move into
  its current stage was a cross-pipeline move (`rpc_move_task_pipeline`),
  revert is unavailable — out of scope for this issue.
- Authorization: `is_owner` (consistent with `rpc_advance_stage`'s existing
  bypass) OR the `pipeline.reverse` permission.
- A revert does **not** re-run `rpc_advance_stage`'s post-transition hooks
  (`spawn_recursive_task`, `fn_handle_task_handshake`,
  `rpc_auto_assign_task`) — it's correcting a mistake, not a real workflow
  event, so it must not spawn duplicate child tasks or re-fire handshake /
  reassignment logic.

## Design

### `rpc_revert_stage(p_task_id uuid)`

New function, sibling to `rpc_advance_stage` (not a modification of it —
their transition-path and hook logic diverge enough that sharing one
function would need a branch-heavy `p_is_revert` flag threaded through every
step; a separate function is the smaller, more legible diff).

1. Load `company_id`, `current_stage_id`, `pipeline_id` from `tasks` for
   `p_task_id` (`deleted_at IS NULL`). Raise if not found.
2. `auth.uid()`'s company must match the task's company (mirrors
   `rpc_advance_stage` step 1).
3. Authorize: `is_owner = TRUE` OR `public.has_permission('pipeline.reverse')`.
   Raise `Unauthorized` otherwise.
4. Find the previous stage: the most recent `pipeline_stage_history` row
   where `task_id = p_task_id AND to_stage_id = current_stage_id AND
   pipeline_id = task's pipeline_id`, ordered by `transitioned_at DESC`,
   limit 1. Its `from_stage_id` is the revert target.
5. If no such row exists, raise `Cannot revert: no prior stage found for
   this task in its current pipeline`.
6. `UPDATE tasks SET current_stage_id = <previous stage>, updated_at = NOW()`.
   This alone fires the existing `trg_tasks_notify_update` trigger
   (`20260502_notification_engine_phase2.sql:134`), which already emits a
   stage-change notification on any `current_stage_id` update — no new
   notification code needed.
7. Insert a `pipeline_stage_history` row: `from_stage_id = current stage`,
   `to_stage_id = previous stage`, `transitioned_by = auth.uid()`,
   `is_reversal = TRUE`, `submission_id = NULL`.
8. No post-transition hooks are called.

No new tables/columns/migrations for `pipeline_stage_history` or
`roleTemplates.ts` — both already exist. Only new DB object is the function,
added in one migration.

### UI

- `components/task-detail/StageActions.tsx` (and `actionRegistry.ts`): add a
  "Revert" action, gated behind the same client-side permission check used
  for other manager-only actions (`RoleManagerContext`). Shown when the
  task's already-loaded stage history has at least one entry for the current
  pipeline; the RPC remains the source of truth for actual validity (e.g.
  task at its initial stage still gets a clean server error if history is
  stale on the client).
- `TaskCardActions.tsx`: same action surfaced wherever other stage actions
  are surfaced there.
- `contexts/TaskDetailContext.tsx`: new `revertStage(taskId)` method,
  parallel to the existing `advanceStage`, calling the RPC and re-fetching
  task details on success.
- Confirm step before firing (destructive-ish, manager-only action) using
  whatever existing confirm pattern `TaskCardActions.tsx` already uses for
  its other one-click actions — no new modal component.
- No changes needed to `PipelineJourney.tsx` — its "REVERSAL" badge already
  renders off `is_reversal`, it just never had a `true` value to render
  before.

### Error handling

All raised as Postgres exceptions, surfaced client-side as toasts (existing
RPC-error pattern):

- Not authorized → toast, button should already be hidden for these users
  but the RPC is the real gate.
- No previous stage in this pipeline (includes "last move was cross-pipeline"
  and "task is at its initial stage") → toast: nothing to revert to.

### Testing

One script under `supabase/checks/` (matching this repo's existing pattern
rather than a new test framework): as a `pipeline.reverse`-permitted user,
advance a task through two stages, call `rpc_revert_stage`, assert
`current_stage_id` is back to the middle stage and a `pipeline_stage_history`
row with `is_reversal = TRUE` exists; then assert a non-permissioned user's
call is rejected.

## Out of scope (future issues)

- Arbitrary-stage override (jump to any stage, not just one step back).
- Cross-pipeline revert.
- Project-side equivalent (`project_stage_history` / `rpc_advance_project_stage`)
  — this issue is filed under "Tasks / Kanban" only.
