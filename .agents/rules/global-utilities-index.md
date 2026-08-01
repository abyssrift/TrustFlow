---
trigger: always_on
---

# Global Utilities & Shared Logic Registry
Before writing new utility functions, hooks, or database RPCs, check this registry. If a tool exists here, you MUST use it in your implementation to prevent code duplication.

## Frontend Hooks (`/hooks`)
* **useAuth**: (Example) Returns the current Supabase session user and loading state.
* **useDebounce**: Delays state updates (inputs: value, delay).

## Frontend Utilities (`/lib`)
* **formatDate**: (Example) Converts ISO strings to human-readable format.

## Global UI Components (`/components/ui`)
* **ConfirmModal**: (Global Common) A premium, themed confirmation dialog for sensitive tactical actions (archival, deletion, restoration). Supports danger/warning/info variants.
* **Tooltip** (`components/common/Tooltip.tsx` + `.web.tsx`): Cross-platform hint bubble — hover/focus on web, long-press on native. Portals/Modals out so it never clips. Wrap any control: `<Tooltip label="...">{child}</Tooltip>`. See the Tooltip section in `ux-consistency.md` before using.

## Frontend Positioning Helpers (`/lib`)
* **positionTooltip** (`lib/tooltipPosition.ts`): Pure flip + viewport-clamp placement math shared by both Tooltip variants (inputs: anchor rect, tip size, viewport, preferred side).

## Supabase Database (RPCs & Edge Functions)
* **get_server_time**: Returns the current server timestamp for NTP synchronization.
* **rpc_start_work**: Initiates a work session for a task (inputs: p_task_id, p_start_time).
* **rpc_heartbeat_work**: Updates the heartbeat for an active session (input: p_session_id).
* **rpc_stop_work**: Finalizes a work session with crash-recovery support (inputs: p_session_id, p_task_id, p_stopped_at, [optional] p_started_at).
* **rpc_archive_task**: (Hardened v2) Snapshots and removes a task with strict organizational isolation and storage lifecycle queuing (input: p_task_id).
* **rpc_archive_project**: (Hardened v3 — #179) Archives child tasks bottom-up, then **soft-deletes** the project (`deleted_at`); it no longer hard-DELETEs the row. Refuses while any child task has a running timer, and takes a `FOR UPDATE` lock. Input: p_project_id.
* **rpc_get_archives**: (Enhanced v2) Retrieves archived snapshots with full-text search and type filtering (inputs: p_entity_type, p_search).
* **rpc_restore_archive**: (New) Reconstructs an archived task and its full historical relational data into the active pipeline (input: p_archive_id).
* **rpc_restore_project**: Restores a project and all its archived child tasks (input: p_archive_id). Since #179 it clears `deleted_at` for soft-deleted rows, falling back to insert-from-snapshot for archives written before that change.

### Projects hierarchy (issue #142 — Phases 1–3)
* **rpc_projects_table**: Backs the sortable projects table. Returns 24 columns — stage, **days_in_current_stage**, due/days_remaining, child rollups (tasks_total/tasks_done/weighted_progress), owner, blocked, tracked_seconds and derived estimated_hours. Paginated (`p_limit` clamped 1..500, `p_offset`); filters `p_search`, `p_stage_id`, `p_blocked`. Rollup definitions are copy-matched to `rpc_project_dashboard` so the two can never disagree.
* **rpc_project_dashboard** / **rpc_get_project_stats**: Pre-existing per-project rollups (completion, weighted progress, tracked seconds, by-stage/category, contributors). **Reuse these definitions** for any new project aggregate rather than writing your own.
* **rpc_create_template_from_project**: Snapshots a finished project's task shape into `project_templates.body` (inputs: p_project_id, p_name).
* **rpc_instantiate_template**: Bulk-creates many projects and their tasks from a template in ONE set-based transaction (inputs: p_template_id, p_portfolio jsonb, p_projects jsonb **plural**, p_idempotency_key). Suppresses per-row task notifications via the transaction-local `trustflow.bulk_instantiate` GUC; idempotent on `(company_id, idempotency_key)`.
* **rpc_undo_portfolio_instantiation**: One-call rollback of a bulk instantiation — soft-deletes every project and task carrying that `portfolio_id` (input: p_portfolio_id).
* **rpc_advance_project_stage**: Moves a project between stages with permission + transition-path validation; rejects a stage belonging to a task-kind pipeline (inputs: p_project_id, p_to_stage_id). **Use this, never a raw UPDATE** — history is trigger-written, so a direct UPDATE records history but skips validation.