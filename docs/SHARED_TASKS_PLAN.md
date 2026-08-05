# Shared Tasks: cross-pipeline visibility (issue #23)

## Scope decision

The issue text supports two very different builds: a task "participating in"
multiple pipelines (independent progress per pipeline) vs. a task merely
"visible to" other pipelines. We chose **visible-only**: a task keeps exactly
one owning `pipeline_id`/`current_stage_id` (unchanged), and can additionally
be linked onto other task-kind pipelines as a read-only reference so another
team can see it's relevant to them, without duplicating it.

This is deliberately smaller than a full multi-pipeline participation model,
which would require replacing `tasks.pipeline_id`/`current_stage_id` with a
join table carrying independent per-pipeline stage state, rewriting RLS and
every board query, and auditing every place that reads those two columns.

## What this is not

- Not `spawn_recursive_task` (a stage's `linked_pipeline_id` triggering a
  brand-new child task row with copied submission/attachments) — that's
  duplication, the exact problem #23 complains about.
- Not `rpc_move_task_pipeline` — that relocates a task's one true home,
  it doesn't add a second one.

## Design

### Data model
`task_pipeline_links (id, task_id, pipeline_id, company_id, linked_by, created_at)`,
unique on `(task_id, pipeline_id)`. RLS: `SELECT` scoped to company, no
write policies — all writes go through the RPCs below (same convention as
`pipeline_assignment_pool`).

### RPCs
- `rpc_link_task_to_pipeline(p_task_id, p_pipeline_id)` — requires
  `is_owner`/creator/manager/`task.edit` on the task; rejects linking to the
  task's own pipeline, to a pipeline outside the company, or to a
  project-kind pipeline (task-kind only, matching the issue's "Pipelines /
  Stages" area).
- `rpc_unlink_task_from_pipeline(p_task_id, p_pipeline_id)` — same
  authorization.

### UI (this PR)
`LinkedPipelinesPanel.tsx` in the task detail view (both `[id].tsx` and
`[id].web.tsx`, desktop-sidebar and mobile-stacked branches) — list linked
pipelines, add via a picker (task-kind pipelines only, excluding the task's
own and already-linked ones), remove, gated on `permissions.can_edit`.
Realtime-subscribed like the rest of `TaskDetailContext`.

### UI (follow-up, not in this PR)
Showing the linked task as a card on the *other* pipeline's board. Both
`_tasks_adaptive.tsx` and `_tasks_desktop.tsx` are large, separately
implemented, and built around a `BoardSnapshot` prefetch/caching system for
instant board-switching — threading linked-task data through both safely is
its own focused piece of work, tracked separately rather than rushed into
this PR.

### Testing
`supabase/checks/20260805_task_pipeline_links_check.sql` — asserts a
non-editor is rejected, self-pipeline and project-pipeline links are
rejected, a valid link succeeds and is idempotent on relink, and unlink
removes the row.
