# Task 4 report

## Status

Completed the bounded Project Files explorer/inspector parity package. Project RPC and capability handlers remain authoritative in the tab and are passed into the project inspector. Client standing files and sealed deliverables remain separate, readable, and non-mutable.

## Commit ancestry

The previous report listed a nonexistent integration SHA. The actual checkout ancestry used for this package is:

- `763e1d17245b53ac7926e598040e12fd08f7ba64` - initial Task 4 inspector/tests/report
- `d83046b` - Project Files explorer integration
- `f6dae0387f2af61d244969ae21c9b2992b641869` - inspector review fixes
- Baseline implementation commit: `be477c0` (`feat: bring project files to explorer parity`)
- Review-fix commit: `0ef1768` (`fix: close remaining project files review blockers`)
- Follow-up behavior-test commit: `dec8a00` (`test: deepen project files review coverage`)

## RED/GREEN evidence

- RED baseline: the focused tab test failed because it still required the obsolete `capabilities?.restore` spelling; the inspector tests passed.
- GREEN: focused Project Files/inspector tests pass after removing the dead duplicate, updating capability checks, and strengthening parity assertions.

## Exact files

- Added/retained: `components/projects/ProjectFileInspector.tsx`
- Added/retained: `components/projects/ProjectFileInspector.test.tsx`
- Added/retained: `components/projects/ProjectFilesTab.test.tsx`
- Modified: `components/projects/ProjectFilesTab.tsx`
- Modified: `components/projects/ProjectFilesTab.check.ts`
- Modified: `.superpowers/sdd/portable-explorer-task-4-report.md`
- Follow-up-only files: `components/projects/ProjectFileInspector.test.tsx`, `components/projects/ProjectFilesTab.test.tsx`, and this report.
- Task 3 report: not in the Task 4 ownership/range; unchanged and not included.
- No unrelated dirty files were reset, reverted, or staged.

## Capability matrix

- Working files: view-gated preview/download, details, activity, version history, per-version downloads, and restore only when the supplied restore capability is true.
- Tab mutations: create, rename, move, delete, upload, bin access, and restore handlers/UI fail closed on their individual project capabilities.
- Client standing files: readable preview/download only; no workspace mutation or restore.
- Sealed deliverables: readable preview/download/history only; no workspace mutation or restore.
- Generic explorer shell: receives rendered navigation/collection/inspector nodes and does not derive project actions.
- Deep links: existing valid/stale/foreign normalization remains authoritative; mobile inspector back clears only selected-file state.

## Self-review

- Removed the dead `LegacyProjectFileDetail` and `ProjectFileDetail` duplicate from the committed tab.
- Version/activity responses are ignored when the request identity or selected file is stale.
- Image and document teaser paths consume `useFileViewer` signed `signedUrls`/`previewUrls`; fullscreen rendering remains the viewer output.
- Per-version downloads use version storage metadata and remain view-gated.
- Focused tests now assert capability mapping, absence of hard-coded `canView/canVersion`, stale guards, signed preview outputs, and duplicate removal.
- Follow-up tests invoke preview/download/version-download/restore callbacks and assert viewer, storage, confirmation, and RPC arguments; they also cover client/sealed blocks and denied workspace mutation controls.
- The tab test uses narrow shell/collection seams to inspect the real tab's composed props and callbacks; it does not render ExplorerInspectorShell or ExplorerCollection internals.

## Verification

- `npx vitest run components/projects/ProjectFileInspector.test.tsx components/projects/ProjectFilesTab.test.tsx` - PASS (2 files, 6 behavior tests).
- `node scripts/babelcheck.mjs components/projects/ProjectFilesTab.tsx components/projects/ProjectFileInspector.tsx` - PASS.
- `node scripts/babelcheck.mjs components/projects/ProjectFileInspector.test.tsx components/projects/ProjectFilesTab.test.tsx` - PASS.
- `npx tsx components/projects/ProjectFilesTab.check.ts` - PASS.
- `npx tsx lib/projectFileHubNormalization.check.ts` - PASS.
- `git diff --check` for intended files - PASS.
- `npx tsc --noEmit --pretty false` - FAILS on unrelated pre-existing files only: `components/common/DraggableSheet.web.tsx`, `components/pipeline-editor/StageBuilder.web.tsx`, `components/tabs/_tasks_desktop.tsx`, `hooks/useMemberLimit.ts`, `hooks/usePipelineLimit.ts`, and `supabase/_archive/generate-pdf-report-v8/index.ts`; no Task 4 file is reported.

## Concerns

- Browser/manual verification at 1400px and 390px was not run.
- The checkout remains substantially dirty outside this bounded package; those changes were preserved.
