# Portable File Explorer and Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Project Files the FileHub Browse collection and inspection experience through a narrow reusable shell while preserving domain-owned selection, permissions, RPCs, and file semantics.

**Architecture:** Keep `MultiViewList` as the collection engine and make `ExplorerCollection` a transparent adapter over its complete props contract. Add a presentation-only `ExplorerInspectorShell` that composes navigation, collection, and inspector slots responsively. Keep `FileHubDetailPane` and a new Project Files inspector as separate domain-owned components; share only viewer/presentation primitives that already exist.

**Tech Stack:** React Native/Web, TypeScript, Vitest, existing `MultiViewList`, `useFileViewer`, `FilePreview`, `useAlert().showConfirm`, existing FileHub/project RPCs, Babel checks, TrustFlow verification gates.

## Global Constraints

- Work only within issue #411 and its child-issue scope; do not revert or overwrite the existing dirty epic worktree.
- The shared shell must not import Supabase, storage, router, permissions, upload manager, `FileHubContext`, project normalization, or domain record types.
- Keep `MultiViewList` as the collection engine; do not create a second universal collection primitive.
- Keep domain actions outside the generic shell; capabilities fail closed and actions are supplied by the domain owner.
- Preserve FileHub mixed file/folder behavior and existing collection-selection behavior, including Ctrl/Cmd modifier selection, copy/paste, keyboard, long-press, range, and marquee behavior.
- Filtering hides items without silently clearing surviving selected identities. Pagination selects only the loaded/visible collection unless a domain explicitly implements a server-wide operation. Do not clear selection before async results are known.
- Client standing files remain read-only in Project Files. Sealed deliverables remain immutable and cannot expose workspace mutation or restore actions.
- Projects archive through existing archive semantics; no direct deletion is introduced by this work.
- Destructive actions use `useAlert().showConfirm`; partial failures remain explicit and do not silently discard failed IDs.
- Verify desktop around 1400px, intermediate layouts around 1000px, and mobile around 390px.
- Add the canonical developer guide at `docs/PORTABLE_FILE_EXPLORER.md` and link it from `README.md`, `AGENTS.md`, `CLAUDE.md`, and `docs/FILEHUB_UNIFICATION_PLAN.md`.

---

### Task 1: Complete the transparent explorer collection contract

**Files:**
- Modify: `components/filehub/explorer/ExplorerTypes.ts`
- Modify: `components/filehub/explorer/ExplorerCollection.tsx`
- Create: `components/filehub/explorer/ExplorerCollection.test.tsx`
- Create: `components/filehub/explorer/ExplorerCollection.check.ts`

**Interfaces:**
- Consumes: existing `MultiViewListProps<T>` from `components/common/MultiViewList.tsx`.
- Produces: `ExplorerCollectionProps<T> = MultiViewListProps<T>` and an `ExplorerCollection<T>` wrapper that forwards the entire props object unchanged.

- [ ] **Step 1: Write a failing contract test**

Create a Vitest test that renders `ExplorerCollection` with the full collection contract: `items`, `keyExtractor`, `renderCard`, `renderRow`, `columns`, `storageKey`, `defaultMode`, `modes`, `search`, `groupFilter`, `loading`, `status`, `emptyState`, `onItemPress`, selection props, pagination/footer props, sizing/scroll props, and `testIDPrefix`. Assert the wrapped collection renders the supplied test item and invokes the supplied press callback.

The test must import the real `ExplorerCollection` and `MultiViewList`; mock only platform/UI dependencies required by the existing test setup.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run components/filehub/explorer/ExplorerCollection.test.tsx
```

Expected: the test fails because the explorer contract does not yet expose or forward the complete `MultiViewListProps<T>` surface.

- [ ] **Step 3: Implement the transparent adapter**

Define the explorer collection props as the complete `MultiViewListProps<T>` type and keep the component as a direct pass-through:

```tsx
export type ExplorerCollectionProps<T> = MultiViewListProps<T>;

export default function ExplorerCollection<T>(props: ExplorerCollectionProps<T>) {
  return <MultiViewList {...props} />;
}
```

Do not add selection, RPC, permission, or file-domain logic here.

- [ ] **Step 4: Add the import/contract check**

`ExplorerCollection.check.ts` must fail if the adapter imports Supabase, `FileHubContext`, permissions, router, storage, upload manager, project normalization, or any domain-specific record type; it must also assert that `ExplorerCollectionProps` is an alias/extension of the complete `MultiViewListProps` contract rather than a reduced duplicate.

- [ ] **Step 5: Run the focused tests and checks**

Run:

```powershell
npx vitest run components/filehub/explorer/ExplorerCollection.test.tsx
npx vitest run components/common/MultiViewList.test.tsx
```

Expected: all focused tests pass with no new warnings.

- [ ] **Step 6: Commit the task**

```powershell
git add components/filehub/explorer/ExplorerTypes.ts components/filehub/explorer/ExplorerCollection.tsx components/filehub/explorer/ExplorerCollection.test.tsx components/filehub/explorer/ExplorerCollection.check.ts
git commit -m "refactor: align explorer collection with multiview list"
```

### Task 2: Add the presentation-only inspector shell

**Files:**
- Create: `components/filehub/explorer/ExplorerInspectorShell.tsx`
- Create: `components/filehub/explorer/ExplorerInspectorShell.test.tsx`
- Create: `components/filehub/explorer/ExplorerInspectorShell.check.ts`

**Interfaces:**
- Consumes: the Task 1 transparent collection adapter and rendered domain slots.
- Produces: `ExplorerInspectorShellProps` with `navigation`, `header`, required `collection`, optional `inspector`, controlled `mobilePane`, `onRequestCollection`, and optional `inspectorWidth`.

- [ ] **Step 1: Write failing shell behavior tests**

Cover these independent behaviors:

1. Collection-only rendering shows collection and optional header/navigation.
2. Desktop rendering shows collection and inspector in separate bounded panes when an inspector is supplied.
3. The inspector is absent without leaving an empty overlay or blocking collection content.
4. Controlled mobile `mobilePane="inspector"` hides collection and shows inspector with an accessible back control; activating back calls `onRequestCollection`.
5. Controlled mobile `mobilePane="collection"` shows collection and not inspector.
6. `inspectorWidth` is applied to the inspector pane without changing domain content.

Use stable `testID`s and real slot nodes; do not test implementation-private CSS class names.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
npx vitest run components/filehub/explorer/ExplorerInspectorShell.test.tsx
```

Expected: failure because the shell does not exist.

- [ ] **Step 3: Implement the shell with no domain imports**

Implement only layout and controlled mobile placement. Use the project’s existing responsive primitives/styles. The shell must preserve bounded pane sizing (`flex: 1`, `minWidth: 0`, and overflow containment where the platform requires it) and must not inspect items, selection, capabilities, URLs, files, or RPC state.

The shell must expose a generic back affordance only for the mobile inspector state and call `onRequestCollection`; it must not clear selection or mutate URL state itself.

- [ ] **Step 4: Add the import-boundary check**

`ExplorerInspectorShell.check.ts` must reject imports of Supabase, contexts, permission helpers, router, storage, uploads, project normalization, `useFileViewer`, `FilePreview`, FileHub/project record types, and domain RPC modules.

- [ ] **Step 5: Run tests and type/Babel checks**

```powershell
npx vitest run components/filehub/explorer/ExplorerInspectorShell.test.tsx
node scripts/babelcheck.mjs components/filehub/explorer/ExplorerInspectorShell.tsx
```

Expected: focused tests pass and Babel exits 0.

- [ ] **Step 6: Commit the task**

```powershell
git add components/filehub/explorer/ExplorerInspectorShell.tsx components/filehub/explorer/ExplorerInspectorShell.test.tsx components/filehub/explorer/ExplorerInspectorShell.check.ts
git commit -m "feat: add responsive explorer inspector shell"
```

### Task 3: Migrate FileHub Browse as the layout canary

**Files:**
- Modify: `components/intelligence/FileHubBrowse.tsx`
- Modify: `components/intelligence/FileHubBrowse.check.ts`
- Create: `components/intelligence/FileHubBrowse.test.tsx`

**Interfaces:**
- Consumes: `ExplorerInspectorShell` from Task 2 and `ExplorerCollection` from Task 1.
- Produces: FileHub Browse renders its existing collection and `FileHubDetailPane` through shell slots while keeping Browse-owned data, selection, filtering, pagination, canonical grouping, and detail state unchanged.

- [ ] **Step 1: Write characterization tests before changing Browse**

Add tests for:

- Current search/filter state and cursor reset/append behavior.
- Stale request rejection.
- Canonical alias grouping and mixed file/folder rendering.
- Bulk selection/ZIP state remaining independent from inspector focus.
- Detail replacement and close/back behavior.
- Mobile inspector back returning to the collection without clearing bulk selection.

Use the existing FileHub test fixtures and RPC mocks. Keep existing RPC parameter assertions intact.

- [ ] **Step 2: Run the new characterization test and verify RED only for the new shell wiring**

```powershell
npx vitest run components/intelligence/FileHubBrowse.test.tsx
```

Expected: the new mobile/shell assertions fail before migration; existing Browse behavior assertions remain informative.

- [ ] **Step 3: Wrap the existing Browse collection and inspector**

Replace only the outer layout with the composition:

```tsx
<ExplorerInspectorShell
  header={existingHeader}
  navigation={existingNavigationIfPresent}
  collection={<ExplorerCollection {...existingCollectionProps} />}
  inspector={selectedFile ? <FileHubDetailPane {...existingInspectorProps} /> : undefined}
  mobilePane={selectedFile ? 'inspector' : 'collection'}
  onRequestCollection={() => setSelectedFile(null)}
/>
```

Preserve Browse’s current selection state, filters, pagination/cursors, canonical grouping, bulk download, URL state, and FileHub detail props. Do not move any RPC, permission, storage, or activity logic into the shell.

- [ ] **Step 4: Update checks for the new composition boundary**

Keep existing checks that forbid Browse from acquiring disallowed mutation authority. Add assertions that Browse imports/composes the shell and that detail focus is not coupled to bulk selection.

- [ ] **Step 5: Run focused verification**

```powershell
npx vitest run components/intelligence/FileHubBrowse.test.tsx components/filehub/explorer/ExplorerInspectorShell.test.tsx
node scripts/babelcheck.mjs components/intelligence/FileHubBrowse.tsx
```

Expected: all focused tests pass and Babel exits 0.

- [ ] **Step 6: Commit the task**

```powershell
git add components/intelligence/FileHubBrowse.tsx components/intelligence/FileHubBrowse.check.ts components/intelligence/FileHubBrowse.test.tsx
git commit -m "refactor: compose filehub browse with explorer shell"
```

### Task 4: Migrate Project Files and add project inspector parity

**Files:**
- Modify: `components/projects/ProjectFilesTab.tsx`
- Modify: `components/projects/ProjectFilesTab.check.ts`
- Create: `components/projects/ProjectFileInspector.tsx`
- Create: `components/projects/ProjectFileInspector.test.tsx`
- Create: `components/projects/ProjectFilesTab.test.tsx`
- Modify: `lib/projectFileHubNormalization.check.ts`

**Interfaces:**
- Consumes: Task 1 collection adapter, Task 2 shell, existing `useFileViewer`, `FilePreview`, project version/activity handlers, `FileHubContext`, and project normalization.
- Produces: a Project Files layout with domain-owned navigation/tree, collection, and `ProjectFileInspector`; working/client/sealed capabilities and RPC semantics remain unchanged.

- [ ] **Step 1: Write failing Project Files characterization tests**

Cover:

- Valid folder/file deep links and stale/foreign links falling back safely.
- Working, client standing, and sealed items remaining separate.
- Fail-closed capability visibility for create/rename/move/delete/restore/upload/replace/version.
- Existing upload, folder mutation, delete/restore, and confirmation flows.
- Preview/download behavior and project version/activity loading.
- Restore available only for permitted working versions; client/sealed items never receive workspace mutation or restore actions.
- Refresh retaining surviving selected identities until async results are known.
- Mobile inspector back not clearing bulk selection or deep-link authority.

- [ ] **Step 2: Run the focused tests and verify RED for parity gaps**

```powershell
npx vitest run components/projects/ProjectFilesTab.test.tsx components/projects/ProjectFileInspector.test.tsx
```

Expected: parity tests fail for the missing shared shell/viewer/details behavior, while existing project behavior failures identify regressions separately.

- [ ] **Step 3: Extract the domain-owned `ProjectFileInspector`**

Move the existing project file detail responsibilities into the new component without changing RPC calls: selected file state, preview/download, project versions, restore, activity, permission/capability checks, project path/general properties, and project-specific actions. Compose `useFileViewer` and `FilePreview` for the same inline/fullscreen behavior available in FileHub, including image preview where the project file has a supported image MIME type.

The inspector may expose only actions the selected item’s domain capability permits. It must use existing `useAlert().showConfirm` for destructive or restore confirmations, and it must not clear selection before async results are known.

- [ ] **Step 4: Compose Project Files through the shell**

Place the existing project tree/breadcrumb/navigation in `navigation`, the existing workspace collection in `collection`, and `ProjectFileInspector` in `inspector`. Preserve the workspace storage key and folder navigation authority. Keep client standing files and sealed deliverables in their existing separate sections/strips rather than normalizing them into the mutable workspace collection.

Enable FileHub-compatible layout choices only for the collection where the supplied renderers support them. If a layout mode requires a distinct card renderer, add that renderer in the Project Files domain component; do not pass the compact row renderer as a fake card renderer.

- [ ] **Step 5: Update checks and run focused verification**

```powershell
npx vitest run components/projects/ProjectFilesTab.test.tsx components/projects/ProjectFileInspector.test.tsx
node scripts/babelcheck.mjs components/projects/ProjectFilesTab.tsx components/projects/ProjectFileInspector.tsx
```

Expected: project tests pass, import/capability checks remain green, and Babel exits 0.

- [ ] **Step 6: Commit the task**

```powershell
git add components/projects/ProjectFilesTab.tsx components/projects/ProjectFilesTab.check.ts components/projects/ProjectFileInspector.tsx components/projects/ProjectFileInspector.test.tsx components/projects/ProjectFilesTab.test.tsx lib/projectFileHubNormalization.check.ts
git commit -m "feat: bring project files to explorer parity"
```

### Task 5: Publish the reusable explorer documentation

**Files:**
- Create: `docs/PORTABLE_FILE_EXPLORER.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/FILEHUB_UNIFICATION_PLAN.md`

**Interfaces:**
- Consumes: final public paths and props from Tasks 1–4.
- Produces: a canonical guide future implementation chats can discover before importing or extending an explorer.

- [ ] **Step 1: Write the guide from the settled implementation**

Document:

- When to use `MultiViewList`, `ExplorerCollection`, and `ExplorerInspectorShell`.
- The actual import paths and minimal composition example.
- Selection semantics for filters/pagination and the required Ctrl/Cmd, copy/paste, keyboard, long-press, range, and marquee behaviors.
- How to keep domain actions, permissions, RPCs, viewer lifecycle, versions, activity, and destructive confirmation outside the shell.
- Working/client/sealed boundaries and a new-surface adoption checklist.
- Verification at 1400px, 1000px, and 390px.

- [ ] **Step 2: Add discoverability links**

Add a short “Portable File Explorer” link in each of `README.md`, `AGENTS.md`, `CLAUDE.md`, and `docs/FILEHUB_UNIFICATION_PLAN.md`. Do not duplicate the full guide in those files.

- [ ] **Step 3: Check documentation links and formatting**

```powershell
rg -n "PORTABLE_FILE_EXPLORER|ExplorerInspectorShell|ExplorerCollection" README.md AGENTS.md CLAUDE.md docs/FILEHUB_UNIFICATION_PLAN.md docs/PORTABLE_FILE_EXPLORER.md
git diff --check
```

Expected: every link resolves to the canonical guide and `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Commit the task**

```powershell
git add docs/PORTABLE_FILE_EXPLORER.md README.md AGENTS.md CLAUDE.md docs/FILEHUB_UNIFICATION_PLAN.md
git commit -m "docs: publish portable file explorer guide"
```

### Task 6: Integrated verification and Sol final review

**Files:**
- Review all files changed by Tasks 1–5.
- Do not stage or alter unrelated existing dirty changes.

- [ ] **Step 1: Run the focused regression suite**

```powershell
npx vitest run components/filehub/explorer/ExplorerCollection.test.tsx components/filehub/explorer/ExplorerInspectorShell.test.tsx components/intelligence/FileHubBrowse.test.tsx components/projects/ProjectFilesTab.test.tsx components/projects/ProjectFileInspector.test.tsx components/common/MultiViewList.test.tsx
```

- [ ] **Step 2: Run all repository tests**

```powershell
npm test
```

Record the exact pass/skip/failure counts and distinguish pre-existing baseline failures from regressions.

- [ ] **Step 3: Run static/build gates**

```powershell
npm run check
npm run verify:agent
npm run build:web
```

Run Babel on every changed TypeScript/TSX file if the repository wrapper supports the command; if the Windows wrapper fails due quoting, run the underlying Babel command directly and record both results.

- [ ] **Step 4: Verify the live UI without stopping the dev server**

Use the existing server on `http://localhost:8082` and verify:

- Around 1400px: independent collection/inspector scrolling and layout modes.
- Around 1000px: no clipped toolbar/inspector controls.
- Around 390px: collection-to-inspector drill-in/back behavior and 44px touch targets.
- Ctrl/Cmd-click selection, copy/paste, keyboard navigation, range, long-press, marquee, filtering, pagination, and selection retention while async results are pending.
- FileHub mixed file/folder behavior, Project working/client/sealed boundaries, preview/fullscreen/details/versions/activity, confirmations, and partial-failure messaging.

Do not send Ctrl+C to the dev server; leave it running for the user.

- [ ] **Step 5: Sol final review**

The Sol architect inspects the complete diff, checks the spec line-by-line, confirms no unrelated dirty work was reverted, reviews all test/build output, and issues PASS or BLOCK. If blocked, fix only the reported integration defect, rerun affected gates, and repeat the review.

- [ ] **Step 6: Final handoff**

Report the exact changed files, commits, verification commands/results, any baseline warnings, the live server URL, and any remaining limitations. Do not claim completion without fresh verification evidence.
