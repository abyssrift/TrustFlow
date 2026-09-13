# Project FileHub Workspace Design

Date: 2026-09-13
Scope: GitHub issue #412 and child issues #420, #421, #422, and #423.

## Decision

Linking a folder to a project means attaching one project-scoped FileHub
workspace root to that project. It does not mean mounting arbitrary FileHub
folders as reusable shortcuts.

The project has three deliberately separate file surfaces:

1. The project workspace is editable and uses FileHub hierarchy, versions,
   activity, access control, upload handling, and soft-delete/restore.
2. Client standing files are client-owned and persist across projects. They are
   surfaced in the project as read-only references.
3. The sealed deliverable is a separate project-scoped root. Stage harvesting
   continues to create pointer rows to the same storage objects and preserves
   immutable folder versions.

Same-project project roots may be adopted only as an explicit migration or
recovery operation. Direct, broadcast, group, standing, and other-project
folders cannot become project workspace shortcuts.

## Goals and non-goals

Goals:

- Give every project a lazily-created editable workspace root.
- Keep `fn_project_accessible` as the only project visibility predicate.
- Keep all uploads on `UploadManagerContext` and the canonical FileHub commit
  and version path.
- Keep task submission collection versions authoritative while each attachment
  points to an immutable FileHub file/version.
- Preserve existing client standing folders and sealed deliverables without
  changing their ownership or lifecycle.
- Make migrations additive, idempotent, and safe to run again.
- Make physical storage deletion reference-aware for shared pointers.

Non-goals:

- No second storage bucket, uploader, or versioning system.
- No arbitrary folder shortcut ACL model.
- No removal of legacy task/submission buckets or source tables in this epic.
- No manual deliverable editing or upload path.

## Data model

Add a nullable `projects.workspace_folder_id` foreign key to
`filehub_folders(id)` with `ON DELETE SET NULL`.

Add `filehub_folders.project_root_kind`, nullable for nested folders and
non-project folders, with values `workspace` or `deliverable`. The value is
valid only for a root project folder (`scope = 'project'`, `project_id IS NOT
NULL`, and `parent_id IS NULL`). Add a unique live-root index per
`(project_id, project_root_kind)` and validate the two project root pointers
against company, project, scope, and root kind.

Existing deliverable roots are backfilled as `deliverable`. Workspace creation
locks the project row and uses the unique index as the race-safe idempotency
boundary. A soft-deleted workspace is not silently restored by `ensure`.

Nested project folders and project files must remain in the same company,
project, and project scope as their workspace or deliverable ancestry. Root
folders cannot be moved, nested, or repurposed.

Add nullable `filehub_file_version_id` foreign keys to
`task_attachment_versions` and `submission_attachments`. The existing
`submission_attachments.version_id` remains the collection membership pointer
for `task_submission_versions`; the new column identifies immutable FileHub
content and is not a replacement for collection versioning.

## RPC contracts

`rpc_project_ensure_workspace_folder(p_project_id uuid) returns uuid`

- Requires authentication, project viewing, and the project-file mutation
  capability.
- Validates the project through `fn_project_accessible` and the caller's
  company.
- Locks the project row, returns the live workspace root if present, otherwise
  creates exactly one project-scoped root and stores its id.
- Returns the same not-found response for inaccessible and nonexistent
  projects.

`rpc_project_files(p_project_id uuid) returns jsonb`

Retains its existing standing and deliverable keys and adds a typed workspace
section containing the workspace root, visible folders, visible files,
capabilities, version identifiers, and activity/deep-link identifiers. It
remains a project-gated read and never broadens access through FileHub.

Project folder/file operations either extend the existing FileHub RPCs with
project-aware arguments or use thin project wrappers that call shared internal
helpers. They must preserve FileHub's existing dedupe, name-conflict,
hierarchy, version, activity, and soft-delete semantics.

Project upload commits carry `project_id` and a project destination. They use
the existing `filehub-files` bucket and create the FileHub file and v1 in one
transaction. Replacement creates a new immutable FileHub version and keeps
the stable file id.

Authorization is explicit at every security-definer boundary:

- Read: authenticated, FileHub view permission, and `fn_project_accessible`.
- Mutation: authenticated, FileHub view permission, project edit capability,
  and `fn_project_accessible`.
- Sharing remains subject to the existing FileHub share permission.
- Project files never fall through to broadcast/group/direct permission logic.

## Attachment convergence

New brief and submission bytes are uploaded through `UploadManagerContext`.
The manager returns the FileHub file and current-version identity needed by the
source RPCs. The source tables remain edge/collection tables and retain their
legacy denormalized fields for compatibility.

Brief behavior:

- New brief files create FileHub v1 and a brief pointer.
- Brief replacement uploads once, creates a new FileHub version, and records
  the matching immutable version in brief history.
- Existing brief rows and legacy bucket objects remain readable through the
  pointer fallback during rollout.

Submission behavior:

- New submission attachments create FileHub v1 and retain the existing
  `task_submission_versions` collection version.
- Editing a submission pointer-copies kept attachments without re-uploading
  bytes and records both the FileHub file and immutable version pointers.
- Restoring a submission version changes collection membership only; it never
  creates or deletes physical bytes.

## Lifecycle and purge safety

Soft-delete remains the first operation for files and folders. Archive/restore
must preserve root ids and version history. A physical `(bucket,
storage_path)` is purgeable only when no live or historical FileHub row,
task-attachment version, submission attachment, or sealed deliverable
reference remains. Removal failures and uncertain reference checks fail closed.

## UI shape

The Project Files tab becomes a project-scoped FileHub workspace controller.
Desktop uses a tree/list/detail layout, intermediate widths reduce to a
two-pane layout, and mobile uses folder drill-in and detail navigation. The
same controller and RPC layer serve all layouts. Standing files expose only
read/deep-link actions; deliverables remain sealed and read-only.

## Delivery order

1. Workspace schema, integrity helpers, access rules, and RPCs.
2. Brief/submission pointer and version convergence.
3. Project Files workspace UI and UploadManager integration.
4. Security, lifecycle, migration, purge, and responsive regression checks.

Each phase must pass its focused SQL and repository checks before the next
phase is considered integrated.
