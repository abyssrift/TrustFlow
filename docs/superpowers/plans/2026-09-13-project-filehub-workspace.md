# Project FileHub Workspace Execution Plan

Date: 2026-09-13
Design: `docs/superpowers/specs/2026-09-13-project-filehub-workspace-design.md`
Scope: #412, #420, #421, #422, #423 only.

## Working rules

- Keep `experimental` as the integration branch and preserve unrelated work.
- Do not remove legacy attachment tables or buckets in this epic.
- Use `apply_patch` for source edits and `npx supabase migration new` for new
  migrations.
- Every production change begins with a focused failing check/test, then the
  smallest implementation that makes it pass.
- A phase is integrated only after its focused SQL/repository checks pass.

## Phase 1 — #420 workspace contract and RPCs

### Database package

Owner: Sol-directed Luna worker; SQL migrations and SQL checks only.

Files:

- new `supabase/migrations/*project_filehub_workspace*.sql`
- new `supabase/checks/check_project_filehub_workspace.sql`
- extend `supabase/checks/check_project_deliverable.sql` only if required for
  root-kind/backward-compatibility assertions

Work:

1. Add `projects.workspace_folder_id` and
   `filehub_folders.project_root_kind` with rerunnable constraints/indexes.
2. Backfill existing deliverable roots as `deliverable`.
3. Add root-pointer and ancestry integrity checks.
4. Add `rpc_project_ensure_workspace_folder` with project-row locking,
   `fn_project_accessible`, capability checks, and folded not-found behavior.
5. Extend `rpc_project_files` with typed workspace data while retaining the
   standing/deliverable response keys.
6. Add project-aware folder/file mutation helpers or thin wrappers without
   changing existing non-project behavior.
7. Extend project upload/replace/dedupe/conflict paths with project context.

First failing checks must cover: missing workspace root, concurrent/idempotent
creation, invalid root pointers, cross-project/cross-company parents, root
move/repurpose attempts, and inaccessible project reads/writes.

### FileHub model package

Owner: Sol-directed Luna worker; `contexts/FileHubContext.tsx` and shared
FileHub types only.

Work:

- Add project scope and project metadata to FileHub models.
- Add project-aware folder/file/version methods while retaining existing
  direct/broadcast/group methods.
- Keep activity and deep-link identifiers as FileHub ids.

### Phase 1 gate

- Run the new workspace SQL check and `check_project_deliverable.sql`.
- Run migration drift checks.
- Confirm no UI uses the new contract before this gate passes.

## Phase 2 — #422 brief/submission convergence

### Database package

Owner: Sol-directed Luna worker; convergence SQL and checks only.

Files:

- new `supabase/migrations/*task_submission_filehub_convergence*.sql`
- new `supabase/checks/check_task_submission_filehub_convergence.sql`
- relevant existing task/submission checks

Work:

1. Add immutable `filehub_file_version_id` edge references.
2. Make backfills rerunnable and assert every active source row resolves to a
   FileHub file and immutable version.
3. Update brief add/replace/read RPCs to accept and preserve FileHub pointers.
4. Update submission submit/edit/read/restore RPCs to carry FileHub pointers
   while retaining `task_submission_versions` collection semantics.
5. Replace in-place brief mirror mutation with immutable FileHub versioning.
6. Make purge/orphan checks reference-aware for live and historical pointers.

### Client upload package

Owner: Sol-directed Luna worker; upload and task/submission client paths only.

Files:

- `contexts/UploadManagerContext.tsx`
- `contexts/SubmissionContext.tsx`
- `contexts/TaskCreationContext.tsx`
- `components/task-detail/TaskBriefPanel.tsx`
- `contexts/TaskDetailContext.tsx` only for pointer/version model changes

Work:

- Extend the single UploadManager contract to support task/project targets.
- Return committed FileHub file/version identity to callers without creating a
  second upload engine.
- Route task brief creation/replacement and submission creation/edit uploads
  through it.
- Keep legacy object metadata fallback for existing rows.
- Keep submission collection versioning and pointer-copy behavior unchanged.

First failing checks must prove no task/submission client writer bypasses the
manager, new pointers resolve to FileHub versions, kept attachments add no
bytes, and legacy rows remain readable.

### Phase 2 gate

- Run convergence SQL checks and existing task/submission version checks.
- Run focused TypeScript checks for the upload and task paths.
- Verify no new raw `storage.upload` remains in brief/submission writers.

## Phase 3 — #421 Project Files UI

### Shared controller/package

Owner: Sol-directed Luna worker; new project FileHub controller and shared
components only.

Files:

- new `contexts/ProjectFileHubContext.tsx` or equivalent controller
- new shared project FileHub components under `components/projects/`
- `components/intelligence/FileHubDetailPane.tsx` only for reusable project
  FileHub detail/version support

Work:

- Load the typed `rpc_project_files` envelope.
- Navigate workspace folders and preserve deep links.
- Expose create, rename, move, upload, preview, download, version, restore,
  activity, and soft-delete for workspace files only.
- Reuse FileHub detail/version/activity primitives.

### Project tab package

Owner: Sol-directed Luna worker; `components/projects/ProjectFilesTab.tsx` only.

Work:

- Replace the read-only aggregate with the project workspace layout.
- Keep standing files and sealed deliverables visibly and technically
  read-only.
- Use `MultiViewList`, existing popup/sheet patterns, design tokens, and 44px
  touch targets.
- Implement desktop (~1400px), intermediate (~1000px), and mobile (~390px)
  flows.

### Phase 3 gate

- Run TypeScript, Babel, and UI consistency checks.
- Exercise workspace navigation, upload, conflict handling, preview, move,
  replace/version restore, delete/restore, and deep links.
- Confirm standing/deliverable controls never call workspace mutations.

## Phase 4 — #423 verification and integration

Owner: Sol integration/review with bounded verification worker support.

Work:

- Run all SQL checks in transaction/rollback mode where supported.
- Run `node supabase/checks/migration_drift.js`.
- Run `npm test`, `npm run verify:agent`, `npx tsc --noEmit`, and Babel checks
  for changed files.
- Run repository verification gates and inspect the final diff for scope.
- If Docker is available, apply migrations twice to a disposable local DB and
  run the live SQL checks. If not, report the exact unavailable gate.
- Run manual responsive walkthroughs and record any environment limitation.

## Final review checklist

- Changed files are limited to #412/#420–#423.
- Migrations are minimal and rerunnable.
- RPC names, arguments, grants, and security-definer boundaries are listed in
  the final report.
- No second bucket, uploader, or versioning system was introduced.
- Client standing folders and sealed deliverables remain intact.
- Physical bytes are not duplicated and cannot be purged while referenced.
- Graphify is updated after the final source changes.
