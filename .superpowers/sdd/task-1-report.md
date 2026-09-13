# Task 1 handoff — FileHub project Browse projection

## Implementation

Added a rerunnable migration that rebuilds `files_index` with workspace rows and the requested project/path/origin/canonical columns. Workspace paths are derived from the live project workspace-folder tree; project files are admitted through `fn_project_accessible`. Task brief and submission rows retain their existing source rows and now expose their `filehub_file_id` / `filehub_file_version_id` pointers as canonical identity. The shared `filehub_file_accessible(uuid)` predicate now includes the project branch while preserving uploader, broadcast, direct, group, and task branches. `rpc_filehub_browse` keeps the existing nine arguments/callers, adds trailing `p_origins text[] DEFAULT NULL`, preserves filters, pagination, soft-delete, facets, security-definer `search_path`, and authenticated-only grants.

## Exact files

- `supabase/migrations/20260913130503_filehub_project_browse_projection.sql`
- `supabase/checks/check_filehub_project_browse.sql`

## TDD RED/GREEN evidence

- RED: before implementation, the new check failed at `files_index is missing Browse projection column workspace_folder_id`.
- GREEN: after implementation, the focused check completed with `OK: project-aware FileHub Browse projection and ACL contract is present`.

## Commands/results

- `npx supabase --help`, `npx supabase migration --help`, `npx supabase --version` → CLI 2.110.0; `supabase` shell command was unavailable, so the repository-local `npx` CLI was used.
- `npx supabase migration new filehub_project_browse_projection` → created the migration.
- Applied the migration twice to `supabase_db_TrustFlow` with `psql -v ON_ERROR_STOP=1 -f -` → both passed.
- Ran the focused check, `check_project_workspace_contract.sql`, and `check_filehub_task_submission_convergence.sql` → all passed and rolled back.
- Signature/grant inspection → exact 10-argument Browse function; `anon_exec=false`, `auth_exec=true`; `filehub_file_accessible(uuid)` likewise authenticated-only.
- `git diff --check` → passed (only pre-existing dirty-file line-ending warnings); `graphify update .` → completed.

## Self-review / concerns

No React files or unrelated dirty files were changed. No live authenticated fixture data was available for an end-to-end caller impersonation assertion, so the check validates the projection/function definitions and current-row invariants rather than fabricating data. The final acceptance/integration decision remains with Sol.
