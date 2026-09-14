# Portable File Explorer and Inspector Design

**Date:** 2026-09-14  
**Scope:** TrustFlow issue #411 and the approved follow-up for Project Files/FileHub parity  
**Status:** Approved direction; implementation pending written-spec review

## Goal

Give Project Files the useful FileHub browsing and inspection experience—layout choices, richer file details, preview/fullscreen behavior, versions, and activity—without duplicating FileHub code or collapsing distinct file domains into one generic service.

The first implementation covers only:

- FileHub Browse.
- Project Files.

Tasks and Archives may adopt the primitives later through their own adapters. They are not part of this migration.

## Design decision

Use a composition-first shell plus the existing collection engine:

1. `MultiViewList` remains the collection engine for layouts, selection, pagination, scrolling, and item interaction.
2. `ExplorerCollection` remains a transparent FileHub-facing adapter and should expose the complete `MultiViewListProps<T>` contract rather than maintaining a reduced, drifting prop list.
3. Add a narrow `ExplorerInspectorShell` that owns only responsive pane placement and sizing.
4. Keep FileHub and Project Files inspectors as separate domain components. They may share preview presentation primitives, but they retain their own data loading, permissions, metadata, mutations, versions, activity, and actions.

This deliberately avoids a configurable `PortableFileHub` or universal file manager component. The shared layer composes rendered slots; it does not interpret file records or call domain services.

## Shell contract

The shell has a presentation-only contract equivalent to:

```ts
type ExplorerInspectorShellProps = {
  navigation?: React.ReactNode;
  header?: React.ReactNode;
  collection: React.ReactNode;
  inspector?: React.ReactNode;
  mobilePane: 'collection' | 'inspector';
  onRequestCollection: () => void;
  inspectorWidth?: number;
};
```

The shell may own:

- Desktop collection/inspector layout.
- Optional navigation-slot placement.
- Mobile collection-to-inspector drill-in below the responsive breakpoint.
- Pane sizing, overflow, and bounded-height guarantees.
- Generic back/close placement when the corresponding slot is present.

The shell must not own:

- Item types, folders, canonical paths, origins, project IDs, or source identity.
- Filtering, sorting, pagination, selection, deep links, or URL state.
- Capability derivation or authorization decisions.
- Supabase, storage signing, RPCs, routing, uploads, ZIP creation, activity logging, versions, restores, sharing, or deletion.
- Preview-kind detection or viewer lifecycle.

`useFileViewer` continues to own signed URLs and viewer lifecycle. `FilePreview` continues to own preview presentation. The shell receives rendered inspector content only.

## Domain boundaries

### FileHub Browse

`FileHubBrowse` remains responsible for Browse RPCs/cursors, search/filter/source state, canonical identity grouping, bulk selection, ZIP download, URL/detail selection, and construction of the FileHub inspector.

The FileHub inspector retains source-specific behavior:

- Open and download.
- Optional “open in project workspace”.
- Inline preview and fullscreen viewer.
- Details, Versions, and Activity tabs.
- Source, category, task, project, path, origin, canonical alias, and version metadata.
- Existing FileHub version/activity RPCs and permission behavior.

### Project Files

`ProjectFilesTab` remains responsible for project-file RPC envelopes and normalization, folder selection/breadcrumbs/deep links, the working/client/sealed sections, upload dispatch, permission-derived actions, and existing workspace mutations.

The Project inspector should reach FileHub parity where the project domain allows it:

- Inline preview and fullscreen viewer through the existing viewer primitives.
- Open/download actions governed by project capabilities.
- Details, Versions, and Activity tabs.
- General properties such as MIME type, size, added/updated time, project, path, and origin where available.
- Project version downloads and restore behavior through existing project RPCs.

Project-specific metadata and actions remain outside the generic shell.

## File-domain invariants

- **Working files** remain hierarchical project workspace items. Create, rename, move, delete, restore, replace, and upload continue through existing context/RPC/upload paths and only appear when the server-derived capability permits them.
- **Client standing files** remain shared reference material. They may be previewed/downloaded but are read-only from Project Files; they must not be silently copied into the mutable workspace or receive workspace mutation actions.
- **Sealed deliverables** remain immutable snapshots with batch/version provenance. They may be previewed/downloaded and show history, but must not expose workspace mutation or version-restore actions.
- Client and sealed references are not inserted into the mutable workspace collection merely to simplify rendering.
- Capabilities fail closed. Shared UI renders only actions explicitly supplied by the domain owner.
- Denied and nonexistent project results preserve current indistinguishable handling.
- Canonical aliases remain aliases to shared bytes; the shell never infers identity from storage paths.
- Folder/file deep links continue to resolve through project normalization, with stale or inaccessible identifiers falling back safely.

## Selection and interaction semantics

`MultiViewList` remains the source of collection-selection behavior. This migration must preserve the existing selection contract:

- Selection is keyed by stable item identity, not rendered position.
- Search/filtering limits the visible collection but does not silently clear selected items that are temporarily out of view.
- Pagination does not imply that “select all” means every server-side result unless the domain explicitly implements that operation; the default is the currently loaded/visible collection.
- Refreshes reconcile removed identities but do not clear surviving selection before async results are known.
- Collection selection and inspector focus are separate states. Opening an inspector must not mutate bulk selection.
- Nested action buttons stop propagation and do not accidentally select or open their parent item.
- Existing modifier-key behavior, copy/paste handling, keyboard navigation, range selection, long-press behavior, and marquee behavior remain governed by the collection implementation and must not be regressed by the shell.

Domain actions remain responsible for confirmation, partial failure, and async result handling:

- Destructive actions use `useAlert().showConfirm` and existing domain wording/permission checks.
- Selection remains visible while an async mutation is pending and until the result is known.
- Successful items may be reconciled from the returned result; failed items remain selected or are surfaced explicitly according to the existing domain action contract.
- Partial failure must not be represented as an all-success toast or by silently dropping failed IDs.
- Archive/delete/restore semantics are never inferred by the generic UI. Project archive continues through existing archive semantics, and FileHub/project file deletion continues through its existing RPCs.

## Responsive behavior

The shell is responsible for predictable layout at three verification widths:

- **Around 1400px:** navigation, collection, and inspector can coexist with bounded independent scrolling. The inspector does not cover the collection or steal its scroll container.
- **Around 1000px:** panes compress without clipped controls; the inspector remains usable or transitions to the mobile-style drill-in at the established breakpoint.
- **Around 390px:** collection and inspector are separate drill-in states with an obvious back path, touch targets of at least 44px where practical, preserved selection/deep-link state, and no desktop-only row assumptions.

The shell does not decide whether a domain should show a navigation tree, reference strips, sealed history, filters, or bulk toolbar; those remain in the supplied slots.

## Migration order

1. Add characterization tests for current selection, deep links, capabilities, and working/client/sealed action visibility.
2. Make `ExplorerCollection` transparently inherit the full `MultiViewListProps<T>` contract without behavioral changes.
3. Add the dependency-free `ExplorerInspectorShell` and its focused tests.
4. Migrate FileHub Browse first as the lower-risk layout canary. Replace only pane placement while preserving filtering, paging, canonical grouping, bulk selection, detail state, and existing FileHub inspector behavior.
5. Verify desktop and mobile behavior before proceeding.
6. Migrate Project Files by placing its existing navigation/tree, collection, and project inspector into shell slots. Preserve normalization, mutations, upload flow, reference strips, and sealed history.
7. Add Project inspector parity by composing `useFileViewer`/`FilePreview` and reusing existing project version/activity handlers; do not move those handlers into the shell.
8. Extract a shared selection/controller hook only if both consumers demonstrate genuinely identical state transitions after migration. Do not preemptively create one.

## Verification plan

Automated checks:

- Shell tests for collection-only, desktop split-pane, mobile drill-in, inspector close/back, and missing-inspector states.
- Import-boundary checks proving generic explorer files do not import Supabase, `FileHubContext`, permissions, router, storage, upload manager, or project normalization.
- `MultiViewList` mode persistence, bounded scrolling, nested-press propagation, pagination, modifier selection, keyboard, long-press, range, marquee, copy/paste, and mobile-card coverage.
- FileHub Browse characterization tests for filters, cursors, canonical aliases, bulk selection, ZIP/download, and inspector state.
- Project Files tests for valid/stale folder and file deep links, all three file categories, capability visibility, version restore, preview/download, and activity.
- Existing database checks and TrustFlow verification gates for touched files.

Manual walkthrough:

- At approximately 1400px and 1000px: split-pane sizing, independent scrolling, layout mode changes, folder navigation, inspector replacement, filters, pagination, and bulk selection.
- At approximately 390px: collection-to-inspector drill-in, back behavior, touch targets, preserved selection/deep-link state, and no desktop row overflow.
- Verify working-file mutations, client-file read-only behavior, sealed-file history, preview/download, inaccessible project behavior, canonical aliases, confirmation dialogs, and partial-failure handling.

## Risks and mitigations

- **Stale selection after refresh/filter changes:** keep selection keyed by stable identity and reconcile only after results arrive.
- **Duplicated URL state:** keep route/deep-link authority in each domain screen; the shell is controlled and URL-agnostic.
- **Nested press double-firing:** preserve `MultiViewList` propagation guards and add regression tests around item actions.
- **Lost height constraints:** shell tests must assert bounded pane scrolling at desktop widths.
- **Authorization drift:** keep capabilities and RPC calls in domain owners; the shell renders no inferred actions.
- **Universal-component creep:** reject additions that introduce broad action/config registries or domain imports into the shared layer.

## Approval checkpoint

This spec records the approved direction: portable composition and viewer/inspector parity, not a universal FileHub clone. Implementation begins only after this written spec is reviewed and approved.
