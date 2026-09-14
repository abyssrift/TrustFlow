# FileHub Workspace Follow-up Design

## Outcome

Close the remaining workspace integration gaps from #412 by making the existing
decoupled uploader target-aware, projecting project workspace files into the
federated FileHub Browse surface, and sharing the explorer primitives between
project-scoped navigation and global discovery.

The product decision is that “link a folder to a project” means a project-scoped
FileHub workspace/root. It does not mean a shortcut to an arbitrary FileHub
folder. Project workspace access is therefore always governed by
`fn_project_accessible(project_id)` and uploads are constrained to that
project’s workspace hierarchy.

## Contracts

```ts
type UploadDestination =
  | {
      kind: 'filehub';
      visibility: 'direct' | 'broadcast' | 'group';
      folderId?: string | null;
      groupId?: string | null;
    }
  | {
      kind: 'project';
      projectId: string;
      folderId?: string | null;
    };

type ExplorerMode =
  | { kind: 'project-workspace'; projectId: string }
  | {
      kind: 'global-browse';
      projectId?: string;
      origin?: 'workspace' | 'shared' | 'brief' | 'submission';
    };
```

`UploadManagerContext` remains the only byte-upload and FileHub-commit path.
The project destination may select only folders returned by the project
workspace RPC. FileHub direct/broadcast/group callers remain compatible.

Browse rows expose project, workspace path, origin, and canonical FileHub
file/version identity. The display identity is
`canonical_file_id + canonical_version_id`; task brief and submission rows are
aliases/context for that identity, not additional storage objects. Different
versions remain distinct.

## Surfaces and authority

- Project Files is the canonical project-scoped mutation explorer. It keeps the
  client standing area and sealed deliverable separate and protected.
- FileHub Browse is global federated discovery. It is read-mostly and offers
  “Open in project workspace” for project-scoped results.
- Shared explorer primitives own presentation contracts only: breadcrumbs,
  collection density, selected-file detail, version/activity affordances, and
  target-aware upload entry. Callers own filtering and mutation policy.
- No second bucket, uploader, versioning system, or byte-copy migration is
  introduced.

## Security and lifecycle

The Browse projection and RPC retain server-side filtering, soft-delete
exclusions, pagination, and existing FileHub grants. Project rows are admitted
only through `fn_project_accessible`; no second project-access predicate is
created. Existing hierarchy, versions, activity, upload-manager conflict
handling, client standing folders, sealed deliverables, and submission
collection versioning remain intact.

## Responsive behavior

This uses adaptive presentation (Path B): shared state/data contracts are
cross-platform, while the web composer/explorer and native sheet/list renderers
may differ where the interaction model requires it. The implementation must be
driven at approximately 1400px and 1000px desktop widths and 390px mobile web,
plus native coverage for the upload path.