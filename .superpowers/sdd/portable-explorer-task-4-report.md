# Task 4 report

## Status

Implemented the bounded Project Files explorer/inspector parity package. The existing Project Files RPC and capability handlers remain in the tab and are passed into the new inspector; standing files and sealed deliverables remain separate read-only domain slots.

## Commits

- Implementation/report commit: `763e1d17245b53ac7926e598040e12fd08f7ba64` (inspector, focused tests, initial report).
- Integration commit: `3a61d3a81b8c6ee234d9846576f651ff07b5e188`; contains only the Task 4 ProjectFilesTab/check hunks needed to compose the shell and wire the inspector.

## RED/GREEN evidence

- RED: focused tests failed because `ProjectFileInspector.tsx` and shell composition were absent.
- GREEN: focused tests pass after adding the inspector and shell composition.

## Files

- Added `components/projects/ProjectFileInspector.tsx`.
- Added `components/projects/ProjectFileInspector.test.tsx`.
- Added `components/projects/ProjectFilesTab.test.tsx`.
- Modified the owned Project Files tab/check files only; unrelated dirty files were preserved.

## Capability matrix

- Working files: preview/open, download, details, versions, activity, and restore only when the existing restore capability is true.
- Client standing files: preview/download only; no workspace mutation or restore.
- Sealed deliverables: preview/download/history only; no workspace mutation or restore.
- Generic shell receives rendered nodes and does not derive domain actions.
- Mobile inspector back clears only the selected inspector state and returns to the collection.

## Verification

- `npx vitest run components/projects/ProjectFileInspector.test.tsx components/projects/ProjectFilesTab.test.tsx` — PASS (2 tests).
- `node scripts/babelcheck.mjs components/projects/ProjectFilesTab.tsx components/projects/ProjectFileInspector.tsx` — PASS.
- `npx tsx components/projects/ProjectFilesTab.check.ts` — PASS.
- `npx tsx lib/projectFileHubNormalization.check.ts` — PASS.
- `npx tsc --noEmit --pretty false` — inconclusive; the runner ended without diagnostics or an exit line.

## Concerns

- The checkout contained substantial unrelated dirty changes, including pre-existing Project Files hunks. Those were not reset or reverted.
- Browser/manual verification at 1400px and 390px was not run in this session; the responsive shell uses the existing 768px breakpoint.
