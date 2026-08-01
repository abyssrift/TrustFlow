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
* **STARTER_TEMPLATES / starterTemplatesBySector** (`lib/starterTemplates.ts`): Curated, code-level library of researched project-template starters (12 sectors, 13 templates, 8-25 tasks each) matching the `project_templates.body` contract. Not database rows — picking one calls `rpc_create_starter_template` to materialize it into a real per-company template. Self-check: `npx tsx lib/starterTemplates.check.ts`.

## Global UI Components (`/components/ui`)
* **ConfirmModal**: (Global Common) A premium, themed confirmation dialog for sensitive tactical actions (archival, deletion, restoration). Supports danger/warning/info variants.
* **Tooltip** (`components/common/Tooltip.tsx` + `.web.tsx`): Cross-platform hint bubble — hover/focus on web, long-press on native. Portals/Modals out so it never clips. Wrap any control: `<Tooltip label="...">{child}</Tooltip>`. See the Tooltip section in `ux-consistency.md` before using.
* **StarterTemplatePickerSheet** (`components/projects/StarterTemplatePickerSheet.tsx`): Browse-by-sector + preview + "Use This Template" picker over `lib/starterTemplates.ts`. Rendered as a sibling Popup (not nested inside another `presentation="auto"` Popup's `overlays` — that prop is centered-only and is dropped in sheet mode). Used from `BulkCreateProjectsSheet` (empty-template dead end) and `ProjectsTable`'s empty state (via `onBrowseStarters`).
* **BulkCreateProjectsSheet** (`components/projects/BulkCreateProjectsSheet.tsx`, issue #182, plan §13.10): two-step wizard in one `Popup presentation="auto"` — step 1 unchanged (template/batch name/paste-names textarea), step 2 is the batch-configuration step: one `CategoryMappingRow` per distinct category the template body uses (board required from `pipelines` where `subject_kind='task'`, RLS-scoped to caller's company; team optional; boards with zero stages shown disabled), a required anchor date + direction picker (`start`/`deadline`, deadline listed first — this domain receives a deadline, not a start date) with Today/Next Monday/End of Quarter presets, and a live debounced call to `rpc_preview_instantiate_template` rendered as the outcome sentence (`N projects · N tasks · N boards · first task X, last Y`) — a preview error doubles as this form's validation feedback. `CategoryMappingRow` is intentionally inline in this file, not extracted — plan §13.11 anticipates a second mount from the future Work tab (#184); promote it then, not speculatively now.

## Frontend Positioning Helpers (`/lib`)
* **positionTooltip** (`lib/tooltipPosition.ts`): Pure flip + viewport-clamp placement math shared by both Tooltip variants (inputs: anchor rect, tip size, viewport, preferred side).

## Supabase Database (RPCs & Edge Functions)
* **get_server_time**: Returns the current server timestamp for NTP synchronization.
* **rpc_start_work**: Initiates a work session for a task (inputs: p_task_id, p_start_time).
* **rpc_heartbeat_work**: Updates the heartbeat for an active session (input: p_session_id).
* **rpc_stop_work**: Finalizes a work session with crash-recovery support (inputs: p_session_id, p_task_id, p_stopped_at, [optional] p_started_at).
* **rpc_archive_task**: (Hardened v2) Snapshots and removes a task with strict organizational isolation and storage lifecycle queuing (input: p_task_id).
* **rpc_archive_project**: (Hardened v2) Recursively archives all tasks and the project itself with organizational isolation (input: p_project_id).
* **rpc_get_archives**: (Enhanced v2) Retrieves archived snapshots with full-text search and type filtering (inputs: p_entity_type, p_search).
* **rpc_restore_archive**: (New) Reconstructs an archived task and its full historical relational data into the active pipeline (input: p_archive_id).
* **rpc_restore_project**: (New) Recursively restores a project and all its archived child tasks (input: p_archive_id).
* **rpc_create_starter_template**: Materializes a `lib/starterTemplates.ts` entry into a real, editable `project_templates` row for the caller's company (inputs: p_name, p_description, p_color, p_body). Mirrors `rpc_create_template_from_project`'s permission check and plain-insert shape — needed because `project_templates` RLS ships no INSERT policy (writes are SECURITY DEFINER RPC only).
* **rpc_instantiate_template** (issue #182, plan §13.10 — signature changed, old 4-arg overload DROPPED): bulk-creates projects+tasks from a template in one set-based transaction (inputs: p_template_id, p_portfolio jsonb {name?, source?, received_at?, manifest?, **target_date REQUIRED** (schedule anchor), **anchor_direction REQUIRED** 'start'|'deadline'}, p_projects jsonb array {name, client_ref?, client_external_ref?, start_date? (per-line anchor override)}, **p_category_mapping jsonb array {category, pipeline_id, assignee_team_id?}** — one row per distinct category the template body uses, p_idempotency_key). Every task gets a real pipeline_id + current_stage_id (mapped pipeline's first stage by position) + due_date — never NULL. Missing anchor/direction, an unmapped category, a mapping row for a category the template doesn't use, or a foreign-company pipeline_id all RAISE (no silent defaults). Back-scheduling (`anchor_direction='deadline'`) computes the span from the same template body via `fn_batch_offset_range`. Use this before writing a new bulk-create path — do NOT build a second one.
* **rpc_preview_instantiate_template** (issue #182, plan §13.10, NEW): read-only companion to rpc_instantiate_template — same inputs minus p_idempotency_key, same resolver/validation, returns `{projects, tasks, boards, first_task_date, last_task_date}` (the outcome, not a row count) so the UI can preview before committing. A successful preview is a promise the commit will also succeed — do not reimplement this math client-side.
* **fn_resolve_batch_category_mapping** / **fn_batch_offset_range** / **fn_resolve_batch_start_date** (internal, called by both RPCs above — not GRANTed to authenticated): the shared category→board/stage/team resolver and forward/back-scheduling date math. Change these, not a copy, if the mapping/scheduling rules need to move.
* **rpc_undo_portfolio_instantiation**: one-call rollback for a bulk-instantiated batch — soft-deletes every task/project carrying `portfolio_id`, then the portfolio itself (input: p_portfolio_id).
* **fn_project_accessible** (`supabase/migrations/20260801_project_visibility.sql`, issue #186): the ONE project-visibility predicate — `owner_id` match, OR assigned a task in it (directly or via team), OR `project.view_all`, all inside a same-company floor. Mirrors `fn_task_file_accessible`'s shape (#163). Wired into FIVE call sites: `projects_select` RLS, `rpc_projects_table`, `rpc_project_dashboard`, `rpc_get_projects`, `rpc_create_template_from_project` — the last one was a `SECURITY DEFINER` reader not in the issue's original list, found by auditing `pg_proc` for every function touching `public.projects`. Before adding a new project-reading RPC or a raw `supabase.from('projects')` call, gate it through this function — SECURITY DEFINER bypasses RLS, so the policy alone does not protect a new RPC. Permission: **`project.view_all`** (dot, not colon — matches the `project.*` namespace, not `filehub:`'s isolated colon convention). Self-check: `supabase/checks/20260801_project_visibility_check.sql`.
