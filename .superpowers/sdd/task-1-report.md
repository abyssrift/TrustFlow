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

## Reviewer corrections

- Included live project FileHub files beneath both the workspace and sealed deliverable roots in `files_index`; both receive project root/path metadata and remain read-only Browse projections gated by `fn_project_accessible`.
- Strengthened `check_filehub_project_browse.sql` with a transactional `files_index` alias assertion: every task-brief/submission canonical version pointer must resolve to the same canonical file. It also structurally asserts Browse's project-origin ACL branch and the retained project branch in `filehub_file_accessible`, avoiding fabricated auth fixtures.
- Fresh verification: migration applied twice with `psql -v ON_ERROR_STOP=1`; focused Browse check, project workspace contract check, and task/submission convergence check all passed and rolled back.

## Follow-up reviewer correction

- Project-tree projection now carries `root_kind`; live files under the sealed deliverable root are included with `origin='deliverable'`, while workspace files remain `origin='workspace'`. The existing project ACL and read-only Browse behavior are unchanged, and `p_origins` accepts either value.
- The focused check now creates valid throwaway project/folder/file/version rows from existing users, switches to `SET LOCAL ROLE authenticated`, impersonates a user that must fail `fn_project_accessible`, executes the real `rpc_filehub_browse`, and rolls back all settings/data. It fails closed when the database cannot provide both required actors.
- Fresh results: the migration applied twice successfully with `ON_ERROR_STOP=1`. The focused check failed closed because the local seeded schema has owners only and no same-company non-owner actor; this is the required safe blocker, not a text-scan pass. Related workspace-contract and task/submission-convergence checks passed and rolled back.

## Deterministic ACL correction

- RED: the prior focused check failed closed on the current seed because no same-company non-owner existed.
- GREEN: the fixture now retains the existing same-company owner for valid project/folder/file/version creation and stores `gen_random_uuid()` as `denied_subject`; under `SET LOCAL ROLE authenticated` it proves `fn_project_accessible(v_project)=false`, executes `rpc_filehub_browse` with both `workspace` and `deliverable` origins, and asserts the project is absent. All data/settings roll back.
- Fresh results: migration applied twice with `psql -v ON_ERROR_STOP=1`; focused Browse check passed; project workspace contract and task/submission convergence checks passed. `files_index` currently reports `workspace=1` and `brief=5`; no seeded deliverable row exists, but the projection definition and origin assertions cover it.
