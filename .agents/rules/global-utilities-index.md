---
trigger: always_on
---

# Follow the existing pattern. Extend it. Do not invent a parallel one.

**This is the first rule, before anything below it.** When you need a
capability, find how this codebase already does it and use that. If it almost
fits, **improve the existing thing**. Writing your own version — even a cleaner
one — is the wrong answer.

**Why, concretely: the existing pattern already handles the cases you have not
thought of yet.** It has been through real use. Yours has not. Every one of
these was already solved before someone nearly rebuilt it:

| Need | Use | Already handles |
|---|---|---|
| Uploading any file | `contexts/UploadManagerContext.tsx` | duplicate/name-conflict prompts, island progress, cancel, beforeunload guard, FileHub commit, and a ref-backed progress store so 10Hz ticks don't re-render the whole app |
| Creating projects/tasks in bulk | `rpc_instantiate_template` | one notification per batch not one per task, required schedule anchor, no orphan tasks, duplicate-name detection, one-call undo |
| Deciding who may see a project | `fn_project_accessible` | the four `SECURITY DEFINER` readers that bypass RLS entirely |
| Any popup, sheet or modal | `components/common/Popup.tsx` / `DraggableSheet.tsx` | presentation switching, mobile collapse, disabled-action gating |
| A date or date range | `Calendar` | see `ux-consistency.md` |
| Confirming a destructive action | `useAlert().showConfirm` | `Alert.alert` with multiple buttons is a **silent no-op on web** |
| Failure surfacing from non-React `lib/*` | `lib/toast` | `Alert` does nothing there |

A second implementation is not merely duplicate code — **it drifts, and the
drift is silent and usually security- or data-relevant.** #167's board pickers
diverged because each screen decided for itself. A second uploader that also
writes to FileHub would answer "this file already exists" differently from the
manager. Two project-creation paths would disagree about whether a schedule
anchor is required.

**When the existing thing genuinely does not fit:**

1. Prefer a **non-invasive extension** — an *optional* new field, a wrapper, a
   callback supplied by the caller. Optional additions cost existing callers
   nothing.
2. Invasive changes (a required field, changing what a union means, altering a
   shared state shape, touching store/subscription mechanics) need the existing
   call sites checked one by one, and on a widely-used provider they need
   sign-off before you write them.
3. **"It does not fit" is a legitimate finding — report it.** Blocked and
   reported beats shipped and forked. Routing around a shared component by
   quietly writing your own is the specific outcome this rule exists to prevent.

Never delete or weaken a guard you do not understand. If a shared file looks
oddly written, assume it is load-bearing until you have found out why — the
upload manager's progress store looks like it should be React state, and is
deliberately not.

---

# Global Utilities & Shared Logic Registry
Before writing new utility functions, hooks, or database RPCs, check this registry. If a tool exists here, you MUST use it in your implementation to prevent code duplication.

## Frontend Hooks (`/hooks`)
* **useAuth**: (Example) Returns the current Supabase session user and loading state.
* **useDebounce**: Delays state updates (inputs: value, delay).

## Frontend Utilities (`/lib`)
* **formatDate**: (Example) Converts ISO strings to human-readable format.
* **Spreadsheet intake** (issue #188, `lib/imports/spreadsheetMapping.ts` +
  `lib/imports/spreadsheetIntake.ts`): `detectHeaderRow` (finds the table in a
  messy file — banner/logo/blank rows scored out), `proposeColumnMapping`
  (header-text + cell-shape heuristic -> `name`/`client_ref`/
  `client_external_ref`/`start_date`), `buildIntakeRows`, `matchClientByName`
  / `resolveClientMatch` (external_ref first, name second, near-miss ->
  `ambiguous`, per plan §13.3). The mapping module is deliberately
  supabase/xlsx-import-free so its self-check (`spreadsheetIntake.check.ts`)
  runs under plain `npx tsx`; `spreadsheetIntake.ts` is the thin I/O layer
  (`parseSpreadsheetBytes`, `fetchExistingClients`) on top of it. Reuse this
  before writing another "propose a column mapping" or "fuzzy-match a client
  name" anywhere else in the app.

## Global UI Components (`/components/ui`)
* **ConfirmModal**: (Global Common) A premium, themed confirmation dialog for sensitive tactical actions (archival, deletion, restoration). Supports danger/warning/info variants.
* **Tooltip** (`components/common/Tooltip.tsx` + `.web.tsx`): Cross-platform hint bubble — hover/focus on web, long-press on native. Portals/Modals out so it never clips. Wrap any control: `<Tooltip label="...">{child}</Tooltip>`. See the Tooltip section in `ux-consistency.md` before using.

## Contexts / Providers (`/contexts`)
Root-level and widely consumed. Use these rather than local state for anything they already own; changes to them are app-wide, so see the first rule at the top of this file.
* **UploadManagerContext** (`contexts/UploadManagerContext.tsx`): **The** upload path for every file in the app. `startUpload(job) => jobId`, `cancelUpload(jobId)`, `activeCount`, `lastCompletedAt` (bump a mounted FileHub screen refreshes on), and `jobsStore` (`subscribe`/`getJob`) with the `useUploadJob` hook. Handles duplicate & name-conflict prompts as `IslandDecision`s (mirrored into `UploadJobState.decisions` so an open modal can render them inline), parallel upload + AbortController cancel, beforeunload guarding, and the FileHub commit (sub-tree get-or-created server-side). **Never write a second uploader or file picker** — extend this. `jobsStore` is deliberately ref-backed, not React state, so ~10Hz progress ticks re-render only the subscriber and not everything under this root provider; do not "simplify" that.
* **IslandContext** (`contexts/IslandContext.tsx`): the dynamic-island activity surface — `publish`/`update`/`remove`, `IslandActivity`, and `IslandDecision` for prompts a background job is parked on (the established mechanism for asking the user about a conflict mid-job).
* **FileHubContext**: FileHub tree/state, incl. `FileHubFolder` used by upload scope snapshots.
* **AlertContext** → `useAlert().showConfirm` for confirmations. `Alert.alert` with multiple buttons is a **silent no-op on web** — never use it.
* **ToastContext** → `useToast()` in React code; non-React `lib/*` code toasts via `lib/toast`'s registered handler instead.
* **TimerContext**: the single work-session timer. A project must never become a timer target.
* Others, same rule — reuse before inventing: `AuthContext`, `ThemeContext`, `NotificationsContext`, `AnalyticsContext`, `PipelineEditorContext`, `TaskCreationContext`, `TaskDetailContext`, `SubmissionContext`, `RoleManagerContext`, `PingHighlightContext`.

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
* **rpc_preview_instantiate_template** / **rpc_instantiate_template** (issue #182/#188, plan §13.10): the ONLY writer for bulk project+task creation from a template — category->board/team mapping, a required schedule anchor, duplicate-name detection, one notification per batch. `rpc_instantiate_template` now also accepts `p_portfolio.standing_folder_id` (issue #188) to record which FileHub folder holds the batch's source file, in the same transaction. **Any bulk-create path (a future importer, a manifest upload, …) must call these, never insert projects/tasks directly** — see `docs/PROJECT_HIERARCHY_PLAN.md` §15.1's "reuse the batch path" rule.
* **rpc_filehub_folder_create**: Idempotent get-or-create of a FileHub folder by `(company_id, parent_id, scope, name)` (inputs: p_name, p_parent_id?, p_scope, p_group_id?). Returns the existing folder's id if one already matches — safe to call on every "attach evidence to X" flow without a pre-check.
* **`/projects/[id]` route (issue #184)**: `app/projects/[id].tsx` — Overview/Work/Files tab shell, tab state in `?tab=` (same `useLocalSearchParams`/`router.setParams` pattern as FileHub's `?tab=`/`?file=`). `contexts/ProjectDetailContext.tsx` fetches `rpc_project_dashboard` once for all three tabs (mirrors `TaskDetailContext.tsx`'s provider-per-route shape); any RPC error is folded into a single `notFound` boolean — never surface it as a distinguishable "denied" message, that discloses the project exists (see #186 / plan §13.14). `components/projects/ProjectHeader.tsx` is the shared name/stage/flags header every tab sits under; it superseded and deleted `ProjectDashboard.tsx` / `ProjectDashboardSheet.tsx` (the two Popups this issue retired) and `ProjectBlockedToggle.tsx` (their blocked-toggle, folded into the flags UI below). `ProjectStagePicker.tsx` and `SaveAsTemplateSheet.tsx` are now mounted by `ProjectHeader.tsx` instead.
* **`useProjectLifecycle(projectId, active)`** (`hooks/useProjectLifecycle.ts`): reads/writes a project's `current_stage_id`/stage, and — since #184 — `flags`/`flag_note` (plan §13.12's fixed set: `blocked` / `awaiting_client` / `at_risk`, exported as `PROJECT_FLAGS`). `setFlags` is the only write path for "is this project blocked" — it keeps the legacy `blocked`/`blocked_reason` columns (still read by `rpc_projects_table`'s badge/sort/filter, untouched by #184) in sync in the same UPDATE, so there are not two independently-editable representations. Migration: `20260801_project_header_flags.sql`.
* **Sealed project deliverable** (issue #174, plan §6 / §13.16, migration `20260801_project_deliverable.sql`): `projects.deliverable_folder_id` (output, per-project/per-year, created lazily) and `clients.standing_folder_id` (input, persists across years). Harvest = a version snapshot via FileHub's EXISTING folder versioning (`filehub_file_versions.batch_id`, `rpc_filehub_folder_versions`) — no new file mechanism, no counter column. `pipeline_stages.harvests_to_deliverable` (alongside `requires_submission`/`requires_attachments`/`child_inherits_submission`) is enforced by a **trigger** (`trg_tasks_harvest_deliverable`, `AFTER UPDATE OF current_stage_id ON tasks`), not an RPC — moves via drag-drop, RPC, or bulk path all fire it alike. `fn_harvest_task_output` promotes the task's LATEST SUBMISSION's attachments (never `task_attachments`, the brief) into the project's folder as new pointer rows at the same `storage_path` (no bytes copied); re-harvesting an unchanged file is a no-op. Visibility is a one-value extension of the existing model — `filehub_files.visibility='project'` / `filehub_folders.scope='project'`, each gated by `fn_project_accessible()`, mirroring exactly how `'task'` was added for #143/#151. **Reachable, not just schema:** `rpc_add_stage`/`rpc_update_stage` accept `p_harvests_to_deliverable`; `StageBuilder.web.tsx`/`StageBuilder.tsx` have a "Seal to Project Deliverable" toggle. Read path: `rpc_project_files(p_project_id)` (deliverable files + `rpc_filehub_folder_versions` + client standing files in one call, same denial convention as `rpc_project_dashboard`), rendered by `components/projects/ProjectFilesTab.tsx`. `rpc_client_ensure_standing_folder(p_client_id)` is the lazy get-or-create for the client folder, nested under a "Client Files" root via the existing `rpc_filehub_folder_create` (same shape as #188's `BulkCreateProjectsSheet.getOrCreateStandingFolder`). **Found and fixed at the root while building this:** `filehub_files`' RLS policy had two latent recursion bugs (`'direct'` branch ↔ `filehub_recipients`'s own policy; `'group'` branch ↔ `filehub_group_members`'s self-join) that error on ANY raw `SELECT` against `filehub_files` under RLS — never hit before because every real read goes through a `SECURITY DEFINER` RPC. Fixed via `fn_filehub_is_direct_recipient`/`fn_filehub_is_group_member`, the same cycle-breaking technique `task_accessible`/`fn_project_accessible` already use. Self-check: `supabase/checks/check_project_deliverable.sql`.
