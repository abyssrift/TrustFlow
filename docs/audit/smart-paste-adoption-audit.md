# Smart paste/drag-drop adoption audit (2026-09-05)

Triggered by issue #326, a follow-up to #319 (`docs/SMART_PASTE_DRAGDROP_PLAN.md`),
which shipped `useSmartPaste`/`useFileDrop`/`FileDropOverlay` (all in
`hooks/useWebDnd.ts`) and the "seed effect" pattern (`initialFiles`/`initialText`
props pre-filling a modal from a screen-level paste/drop) for task creation and
FileHub desktop. This is exploration only, per the issue's acceptance criteria
— no code changes in this PR. It surveys every other file-attach or
text-creation surface in the app for the same gap, verifies each one directly
against the current code (not just grep hits), and ranks them by traffic and
effort.

**Already known, re-confirmed here (not new):**
- `components/filehub/UploadComposerModal.web.tsx` (#340's standalone composer)
  — has `useFileDrop` (inner drop zone) but no `initialFiles`/`initialText` prop
  and no `useSmartPaste`. This gap was already reported in a comment on #326;
  confirmed still present as of this audit.

## Ranked findings

| # | Surface | File | Platform | Current support | Effort |
|---|---|---|---|---|---|
| 1 | Edit-task modal text fields | `components/task-detail/EditTaskModal.web.tsx` | web | none | one-line swap |
| 2 | Task-detail brief attachment | `components/task-detail/TaskBriefPanel.tsx` | web | drop only, no paste, no seed | one-line swap |
| 3 | Stage-submission evidence attachment | `components/task-detail/StageActions.tsx` | web | drop only, no paste, no seed | one-line swap |
| 4 | FileHub screen-local `UploadModal` (in-modal paste) | `components/intelligence/_filehub_desktop.tsx` | web | drop-in-modal only; paste only seeds before open | one-line swap |
| 5 | Standalone upload composer (#340) | `components/filehub/UploadComposerModal.web.tsx` | web | drop only, no paste, no seed | new seed props |
| 6 | Project folder create/edit modal | `components/projects/ProjectFolderModal.web.tsx` (+ native `.tsx`) | both | none | one-line swap (description field); full seed treatment is a stretch, no existing entry point |
| 7 | Narrow-web FileHub upload | `components/intelligence/_filehub_adaptive.tsx` | web (narrow) | none (own `PickedFile` picker engine, no shared hooks) | full integration — already flagged as deferred in the #319 plan doc |
| 8 | Kanban background image | `components/kanban/KanbanPersonalizer.tsx` | both | none | new seed props (low priority — infrequently visited settings screen) |

### 1–3, 6: one-line swap detail

These follow the exact pattern already shipped elsewhere in the same file family:

- **`EditTaskModal.web.tsx`** has no `ClipboardControls` on Title/Category/Description,
  even though its sibling `CreateTaskModal.web.tsx` already has them on the same
  three fields. This is the clearest asymmetry found in the audit — same modal
  shape, same fields, one has copy/paste buttons and the other doesn't. The
  #319 plan doc (`docs/SMART_PASTE_DRAGDROP_PLAN.md`) even names this file's
  existing keydown effect (~L120–128) as "the natural place to add a paste
  listener," but phases 1–4 never touched it.
- **`TaskBriefPanel.tsx`** and **`StageActions.tsx`** both already call
  `useFileDrop` (drag-and-drop works), but neither calls `useSmartPaste` —
  Ctrl+V does nothing on either panel today. Adding `useSmartPaste({ onFiles: ... })`
  next to the existing `useFileDrop` call is the same shape of change in both
  files.
- **`_filehub_desktop.tsx`'s screen-local `UploadModal`** has its own
  `modalDropRef` (drop works while the modal is open — the code comment there
  explains why the screen-level drop zone can't reach through the modal), but
  no in-modal `useSmartPaste`: pasting while the modal is already open does
  nothing, unlike the screen-level paste that seeds `initialFiles` before the
  modal opens.
- **`ProjectFolderModal.web.tsx`**'s Description field is a plain `TextInput`
  with no `ClipboardControls`, mirroring the same gap as #1 for the
  project-level equivalent of task description.

### 4–5, 7: already-flagged / bigger surfaces

- `_filehub_adaptive.tsx` (narrow-web FileHub) was explicitly deferred by the
  #319 plan doc itself ("thin usage slice — add when narrow-web FileHub paste
  is actually requested"). It has its own `PickedFile` picker engine
  (`DocumentPicker` + raw input, no `useFileDrop`/`useSmartPaste`), so adopting
  either hook means adapting a clipboard `File` into that shape first — real
  work, not a prop swap. Re-surfaced here since #326 is scoped to "remaining
  surfaces," but the recommendation is unchanged from the plan doc: wait for a
  concrete ask.
- `UploadComposerModal.web.tsx` needs the same `initialFiles`/`initialText` +
  `useSmartPaste` treatment as `_filehub_desktop.tsx`'s `UploadModal` (item 4),
  but the surrounding screen (`components/filehub/*`, this modal's callers via
  ModalHost / command palette / QuickCreateButton / `?type=upload` deep link)
  has no existing screen-level drop/paste handler to seed it from — the seed
  props have to be built from scratch here, not copied from an existing
  effect, hence "new seed props" rather than "one-line swap."

### 8: lower priority

`KanbanPersonalizer.tsx` (background image) is the only settings/personalization
picker in the app that isn't gated behind a fixed-aspect crop step (unlike
`ProfileAvatar.tsx`, `PortfolioEditModal.tsx`, and `CompanyEditSettings.tsx`,
all of which force `allowsEditing`/`aspect:[1,1]` and so wouldn't benefit —
a pasted/dropped file would just skip the crop the flow depends on). Still, it's
an infrequently-visited screen — worth doing only if the maintainer wants full
coverage rather than as a priority item.

## Explicitly out of scope / not adopted

- **Avatar, portfolio cover, and company logo pickers** (`ProfileAvatar.tsx`,
  `components/portfolios/PortfolioEditModal.tsx`, `CompanyEditSettings.tsx`) —
  all three force a fixed-aspect crop UI (`allowsEditing`/`aspect:[1,1]`) that a
  raw pasted/dropped file would bypass entirely. Poor fit for smart paste/drop;
  recommend leaving these on their current `expo-image-picker` flow.
- **Ping-sound pickers** (`WorkspaceSettings.tsx`, `PingSettingsPanel.tsx`) —
  single audio-file (`type: ['audio/*']`) pickers; audio isn't something a user
  pastes or drags in from elsewhere in practice. Also worth a separate look
  independent of this issue: the two are near-duplicate implementations of the
  same "company ping sound" picker and may be worth de-duplicating on their own.
- **`SpreadsheetImportSheet.tsx`** — already on `useFileDrop`/`useDropPulse`
  (known-good, no gap).
- **`ProjectFilesTab.tsx`** — read-only file listing; its own header comment
  states upload intentionally routes through `UploadManagerContext` only, never
  a new path. Not a picker surface.
- **`ProjectBoard.tsx`**'s `onDrop`/`useDropTarget` — in-app kanban card
  reordering (JS drag payload), unrelated to OS file drag-drop.
- **`EvidencePanel.tsx`** — read-only display of existing submission
  attachments, no picker.
- **`CommentsSection.tsx`** — plain-text comment composer; browser-default
  paste already works for text, and comments have no attachment concept at all
  today. Adding paste-to-attach here means building new attachment support for
  comments first, not wiring an existing hook — a materially different (and
  bigger) ask than this issue.
- **`BulkCreateProjectsSheet.tsx`**'s "one project per line" textarea already
  accepts a normal paste directly (it's a plain multiline `TextInput`). A
  screen-level "paste CSV text with nothing open → auto-open this sheet" has no
  existing entry point to hang it off of and would be speculative — not
  recommended.
- No `components/submissions` directory exists in this codebase (submission
  attachment flows live in `StageActions.tsx` and `EvidencePanel.tsx`, both
  covered above).

## Recommendation

Land items 1–4 (all "one-line swap," same pattern already proven in
`CreateTaskModal.web.tsx` / `_filehub_desktop.tsx`'s screen-level handler) as a
single follow-up PR — they're mechanical and low-risk. Items 5–6 are reasonable
second passes. Item 7 stays deferred per the #319 plan doc's own judgment
call, and item 8 is optional. Everything under "explicitly out of scope" should
stay on its current implementation.
