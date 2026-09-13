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
