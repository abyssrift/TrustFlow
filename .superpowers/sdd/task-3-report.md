# Task 3 report — target-aware decoupled uploader

## Status

Implemented the bounded target-aware uploader package. Existing global FileHub summons retain their native redirect behavior; project summons use the shared UploadManagerContext and project workspace RPC.

## Files changed

- `lib/uploadTargetNormalization.ts`
- `lib/uploadTargetNormalization.check.ts`
- `contexts/UploadManagerContext.tsx`
- `components/filehub/UploadComposerModal.tsx`
- `components/filehub/UploadComposerModal.web.tsx`
- `components/filehub/UploadComposerModal.check.ts`
- `contexts/ModalDispatchContext.tsx`
- `components/common/ModalHost.tsx`

`app/_layout.tsx` already mounted `UploadManagerProvider` around `ModalHost`; no edit was necessary. `lib/uploadHelpers.ts` already provides the native-compatible upload adapter pattern; no edit was necessary.

## TDD

- RED: added project/filehub destination checks first; `npx tsx lib/uploadTargetNormalization.check.ts` failed because `normalizeUploadDestination` did not exist.
- GREEN: added the normalization contract and manager/composer plumbing; pure normalization and composer checks pass.

## Commands

- `npx tsx lib/uploadTargetNormalization.check.ts` — pass.
- `npx tsx components/filehub/UploadComposerModal.check.ts` — pass.
- `node scripts/babelcheck.mjs` for all changed uploader/modal/layout files — pass.
- `git diff --check` — pass.
- `npx tsc --noEmit` — existing unrelated baseline diagnostics only; none point to the scoped files.

## Self-review and concerns

- Project folder choices are populated only from `rpc_project_files.workspace`, and manager normalization rejects a project folder outside the supplied workspace snapshot.
- Native project uploads use `DocumentPicker`, convert assets to `File`, and call `startUpload`; no direct storage write or second bucket/path was introduced.
- Native global summons intentionally preserve the prior `/filehub` route for existing callers.
- Manual native and browser-width walkthroughs were not run in this session; exercise project upload at native, web 1400px, 1000px, and 390px before final acceptance.

## Reviewer fix pass (2026-09-13)

- Project `normalizeUploadDestination` now requires a non-empty authorization snapshot, a non-null folder id, and membership in that snapshot. FileHub and task normalization remain unchanged.
- Native and web project composers validate the requested folder against `rpc_project_files` workspace folders, reset stale ids to the real workspace root, and refuse to launch with an invalid id. The manager continues receiving the loaded `scopedFolders` snapshot.
- Web project mode now hides audience controls, recipient picker, and top-level destination selection while global direct/broadcast/group behavior remains intact.
- Composer checks now cover ModalDispatchContext/ModalHost destination propagation and native/web stale-folder guards. ModalHost comments now describe the provider arrangement accurately.

## Fresh verification

- `npx tsx lib/uploadTargetNormalization.check.ts` — pass.
- `npx tsx components/filehub/UploadComposerModal.check.ts` — pass.
- `node scripts/babelcheck.mjs lib/uploadTargetNormalization.ts lib/uploadTargetNormalization.check.ts contexts/UploadManagerContext.tsx components/filehub/UploadComposerModal.tsx components/filehub/UploadComposerModal.web.tsx components/filehub/UploadComposerModal.check.ts contexts/ModalDispatchContext.tsx components/common/ModalHost.tsx app/_layout.tsx` — pass.
- `git diff --check` — pass; unrelated dirty files preserved.
- Full suite and manual native/browser walkthroughs were not run per bounded worker scope and user instruction.
