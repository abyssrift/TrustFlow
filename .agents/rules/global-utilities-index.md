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
* **rpc_archive_project**: (Hardened v2) Recursively archives all tasks and the project itself with organizational isolation (input: p_project_id).
* **rpc_get_archives**: (Enhanced v2) Retrieves archived snapshots with full-text search and type filtering (inputs: p_entity_type, p_search).
* **rpc_restore_archive**: (New) Reconstructs an archived task and its full historical relational data into the active pipeline (input: p_archive_id).
* **rpc_restore_project**: (New) Recursively restores a project and all its archived child tasks (input: p_archive_id).
* **fn_seed_company_default_roles**: (#181) Idempotently clones the global system roles (Personnel/Manager/Admin/Owner) into company-scoped, owner-editable roles with matching permissions (input: p_company_id). No-ops if the company already has any role of its own. Called by `trg_companies_seed_default_roles` (AFTER INSERT ON companies) — this is THE enforcement point for "every company gets a real, assignable role set"; do not re-implement seeding in a new company-creation RPC, call this instead.