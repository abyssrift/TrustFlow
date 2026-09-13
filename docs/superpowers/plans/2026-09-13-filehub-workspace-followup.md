# FileHub Workspace Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project workspace uploads and Browse discovery use one target-aware, canonical FileHub explorer without duplicating storage or access rules.

**Architecture:** Extend the existing upload manager and composer with a project destination union. Additive database projection/RPC changes expose project/origin/path/canonical identities and route project access through `fn_project_accessible`. Shared explorer primitives are presentation-only; Project Files owns mutations and Browse owns federated read-only discovery.

**Tech Stack:** React Native/React Native Web, TypeScript, Supabase/Postgres imperative migrations, FileHub RPCs, `MultiViewList`, `FilterPanel`, `UploadManagerContext`.

## Global Constraints

- `UploadManagerContext` is the only upload and FileHub commit path.
- Project visibility is governed by `fn_project_accessible`.
- Preserve client standing folders, sealed project deliverables, task submission collection versioning, FileHub versions, soft-delete, activity, ACL, and upload conflict handling.
- Do not add a second storage bucket, uploader, versioning system, or unnecessary byte copy.
- Use `Popup`/`DraggableSheet`, not raw React Native `Modal`.
- Use `MultiViewList` for uniform collections and `FilterPanel` primitives for filters.
- Provide equivalent desktop, mobile-web, and native outcomes; test approximately 1400px, 1000px, and 390px.

---

### Task 1: Project-aware Browse projection and ACL

**Files:**
- Create: migration from `supabase migration new filehub_project_browse_projection`
- Create: `supabase/checks/check_filehub_project_browse.sql`

**Interfaces:**
- Preserve `rpc_filehub_browse` parameters and add optional `p_origins text[] DEFAULT NULL`.
- Expose `project_id`, `workspace_folder_id`, `workspace_path`, `origin`, `canonical_file_id`, and `canonical_version_id` in Browse rows.
- Project ACL must call `fn_project_accessible(project_id)`.

- [ ] Recreate the current `files_index`, `filehub_file_accessible(uuid)`, and `rpc_filehub_browse(...)` definitions in one rerunnable additive migration, preserving security definer search paths, grants, pagination, soft-delete, and existing sources.
- [ ] Derive project workspace metadata from the FileHub folder/project contract and task/submission canonical identity from pointer columns.
- [ ] Add SQL checks for project projection, origin filtering, canonical alias identity, and unauthorized project exclusion.
- [ ] Apply the migration twice locally and run the new check plus related FileHub/project checks.

### Task 2: Shared explorer mode and presentation primitives

**Files:**
- Create: `components/filehub/explorer/ExplorerTypes.ts`
- Create: `components/filehub/explorer/ExplorerBreadcrumbs.tsx`
- Create: `components/filehub/explorer/ExplorerCollection.tsx`
- Create: `components/filehub/explorer/ExplorerDetailPane.tsx`
- Create: `components/filehub/explorer/ExplorerUploadAction.tsx`
- Create: `lib/fileExplorerMode.ts`
- Create: `lib/fileExplorerMode.check.ts`

**Interfaces:**
- Export the `ExplorerMode` union and closed-by-default capability derivation.
- Collection delegates to `MultiViewList`; filtering remains caller-owned.
- Upload action accepts the target-aware upload destination and does not write bytes itself.

- [ ] Add pure mode/capability checks first and run them with `tsx`.
- [ ] Implement the shared primitives with tokenized styles, responsive tap targets, and no new modal/list implementation.
- [ ] Run Babel parsing on the new TSX files and the pure checks.

### Task 3: Target-aware decoupled uploader

**Files:**
- Modify: `lib/uploadTargetNormalization.ts`
- Modify: `lib/uploadTargetNormalization.check.ts`
- Modify: `lib/uploadHelpers.ts`
- Modify: `contexts/UploadManagerContext.tsx`
- Modify: `components/filehub/UploadComposerModal.tsx`
- Modify: `components/filehub/UploadComposerModal.web.tsx`
- Modify: `components/filehub/UploadComposerModal.check.ts`
- Modify: `app/_layout.tsx`

**Interfaces:**
- Add the `UploadDestination` union without breaking direct/broadcast/group callers.
- Project destinations resolve only within authorized project workspace folders and continue through `startUpload`.

- [ ] Add pure normalization cases for valid project destinations and rejection of arbitrary-folder escape.
- [ ] Extend web and native composer entry points; native must not redirect a project upload to global FileHub.
- [ ] Preserve duplicate/name-conflict, cancellation, progress, and completion behavior through the manager.
- [ ] Run upload checks and Babel parsing for all changed uploader files.

### Task 4: Browse filters and shared explorer adoption

**Files:**
- Modify: `components/intelligence/FileHubBrowse.tsx`
- Modify: `components/intelligence/FileHubDetailPane.tsx`
- Modify: `components/intelligence/filehubShared.ts`
- Create: `components/intelligence/FileHubBrowse.check.ts`

**Interfaces:**
- Consume the shared explorer primitives and the expanded Browse row contract.
- Add controlled Project and Origin filters that compose with search/type/category.
- Browse is read-mostly; “Open in project workspace” is shown only for validated project/folder/file identity.

- [ ] Replace hand-built filter controls with `FilterPanel`, `FilterDropdown`, and `FilterChipGroup`.
- [ ] Render project/path/origin and grouped alias context without representing aliases as duplicate bytes.
- [ ] Remove Browse mutation controls and add the validated deep link.
- [ ] Run focused checks and Babel parsing.

### Task 5: Project Files adoption and deep link

**Files:**
- Modify: `components/projects/ProjectFilesTab.tsx`
- Modify: `app/projects/[id].tsx`
- Modify: `lib/projectFileHubNormalization.ts`
- Modify: `lib/projectFileHubNormalization.check.ts`
- Create: `components/projects/ProjectFilesTab.check.ts`

**Interfaces:**
- Project Files opens the target-aware composer with the selected workspace folder.
- URL parameters `folder` and `file` are validated against the returned workspace tree before selection.

- [ ] Replace the inline DocumentPicker route with the shared composer entry while preserving existing project RPC mutations and read-only standing/deliverable strips.
- [ ] Consume shared explorer primitives without moving mutation authority into Browse.
- [ ] Apply and validate project deep-link parameters and add normalization tests.
- [ ] Run focused checks, Babel parsing, and responsive/native walkthroughs.

### Task 6: Integration and verification

**Files:**
- Modify only files required by integration review; preserve unrelated dirty work.

- [ ] Inspect the complete diff and verify each issue acceptance criterion.
- [ ] Run `git diff --check`, `graphify update .`, focused SQL/pure/Babel checks, and `npm run verify:agent`.
- [ ] Drive the flows at ~1400px, ~1000px, ~390px, and native where available.
- [ ] Update #428, #429, #430, and #412 with commit and validation results.

