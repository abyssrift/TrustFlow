# Smart clipboard / drag-drop QoL — Plan (issue #319)

**Status:** Phases 1–4 + 3.5 implemented (uncommitted, 2026-08-31). Phase 5 deferred.
tsc error count unchanged (163→163); `useWebDnd.smartpaste.check.ts` /
`useWebDnd.dragactive.check.ts` / `useWebDnd.filedrop.check.ts` all pass.
Needs a real-browser walkthrough (see Verification) before close.

Phase 3.5 shipped: global `isDragActive` signal on `useFileDrop` +
`components/common/FileDropOverlay.tsx` (the FileHub overlay, extracted). Every
mounted drop zone breathes at half amplitude the moment an OS file drag enters
the window, escalating to the full FileHub pulse on hover. `useDropPulse` now
gates on `useReducedMotion()`. Adopted in FileHub desktop, both Tasks screens,
and the task composer (upgraded from a 2px border tint).

**Goal:** pasting (Ctrl+V) or dragging content into task + file surfaces routes to the
right create/upload flow with content pre-filled / pre-attached. Reduce clicks.

**Scope (from the issue):** task creation/edit modals, `app/(tabs)/tasks.tsx`,
`app/(tabs)/filehub.tsx`, and adjacent task/file create-upload surfaces. Not a
global app-wide smart-paste router — that is explicitly out of scope (YAGNI).

---

## What already exists — reuse, do not reinvent

- `hooks/useWebDnd.ts`
  - `useFileDrop(onFiles: (files: File[]) => void, enabled = true) => { ref, isOver }`
    — web-only OS-file drop, recurses folders, stamps `webkitRelativePath`.
    Already consumed by `CreateTaskModal.web.tsx`, `TaskBriefPanel.tsx`,
    `StageActions.tsx`, `_filehub_desktop.tsx` (screen + modal),
    `SpreadsheetImportSheet.tsx`. **It ignores dropped text / non-file images.**
  - `useDropPulse(active) => { iconScale, glowOpacity }` — shared drop affordance.
- `lib/pasteImage.ts`
  - `fileToStaged(file: File): PastedFile` → `{ id, uri, name, size, type }`
  - `getPastedImageFile(): Promise<PastedFile | null>` (clipboard image via expo-clipboard)
  - `PastedFile` shape is identical to `StagedBriefFile` / the submission staged shape.
- `components/common/ClipboardControls.tsx` — Copy/Paste text buttons, already on
  task title / category / description in both `CreateTaskModal` variants.
- `contexts/TaskCreationContext.tsx` — `draft` + `setDraft(Partial<TaskDraft>)`,
  `briefFiles: StagedBriefFile[]` + `setBriefFiles`, inline `createTask()` upload.
  `TaskCreationProvider` already wraps `_tasks_desktop.tsx` and `_tasks_adaptive.tsx`.
- `contexts/UploadManagerContext.tsx` — `startUpload(job) => jobId`; **web-only**
  (mounted `app/_layout.web.tsx`), takes **`File[]` only**. Used by FileHub desktop +
  `ProjectFilesTab`. Task creation does NOT use it (bespoke inline upload).
- `_filehub_desktop.tsx:482` — `UploadModal` seeds `draft.files` from an
  `initialFiles` prop via effect. This is the "open modal pre-attached" pattern to copy.
- Existing modal keydown seams: `CreateTaskModal.web.tsx` (~L259, Cmd/Ctrl+Enter),
  `EditTaskModal.web.tsx` (~L124). The natural place to add a `paste` listener.

## Gaps this plan closes

1. No `paste` event listener anywhere in the app — paste is button-only today.
2. `useFileDrop` discards dropped selected-text and inline (non-file) images.
3. `_tasks_desktop.tsx` / `_tasks_adaptive.tsx` have no paste/drop handling, and
   `CreateTaskModal` cannot be opened pre-seeded.
4. FileHub desktop has drop but no paste.
5. All of the above is web-only; native parity story needed.

---

## Phase 1 — `useSmartPaste` hook (web-only)

**File:** add to `hooks/useWebDnd.ts` (same file as `useFileDrop` — same
"web-only, native no-op via `Platform.OS` gate" convention, same `.check.ts` sibling).

```ts
useSmartPaste(
  handlers: {
    onFiles?: (files: File[]) => void;  // clipboard images + real files
    onText?:  (text: string) => void;   // plain text, only when nothing editable is focused
  },
  enabled = true,
): void
```

Behavior:
- `Platform.OS !== 'web'` → no-op (early return). One divergence comment.
- `window.addEventListener('paste', handler)` with cleanup; gated by `enabled`.
- Read `e.clipboardData.items`: collect `kind === 'file'` via `getAsFile()`.
  - If any files and `onFiles` → `onFiles(files)`, `e.preventDefault()`.
    Always intercept files even when a `<textarea>`/`<input>` is focused (a text
    field can't hold an image).
  - Else if `onText` and `getData('text/plain')` is non-empty:
    - If `document.activeElement` is an `input` / `textarea` / `[contenteditable]`
      → **return without `preventDefault`** so the browser does the normal paste
      into the focused field. (This keeps "paste into description" working.)
    - Otherwise → `onText(text)`, `e.preventDefault()`.

**Self-check:** `hooks/useWebDnd.smartpaste.check.ts` (mirror
`useWebDnd.filedrop.check.ts`): assert the clipboard-items parser splits files vs
text, and that a text paste with an editable target is passed through untouched.

> Skipped: dropped-text handling (drag selected text onto a screen). Rare vs
> dropping files, and it would force `useFileDrop`'s signature to change for its 6
> callers. Add as Phase 5 (`useTextDrop` sibling hook) only when someone asks.

---

## Phase 2 — Paste into the open task composer

**File:** `components/tasks/CreateTaskModal.web.tsx`

Next to the existing keydown effect, add:

```ts
useSmartPaste(
  { onFiles: (files) => setBriefFiles(prev => [...prev, ...files.map(fileToStaged)]) },
  visible && !bulkMode && !loading,
);
```

- Only `onFiles` here. Text pasted into the focused title/description field is
  already handled by the browser + the existing `ClipboardControls` buttons —
  no `onText` needed inside an already-open modal.
- Mirrors the callback the modal's existing `useFileDrop` already uses, so
  paste-image and drop-file converge on the same `briefFiles` path.

Native (`CreateTaskModal.tsx`): unchanged — the "Paste Image" button already
exists there.

---

## Phase 3 — Screen-level paste/drop on the Tasks screen → open composer pre-seeded

### 3a. `CreateTaskModal` accepts seed data

**Files:** `components/tasks/CreateTaskModal.web.tsx` (+ `.tsx` for prop parity).

New props:
```ts
initialText?: string | null;              // → draft.title (line 1) + draft.description (rest)
initialFiles?: StagedBriefFile[] | null;  // → briefFiles
```
Seed via an effect that fires when `visible` transitions to `true` (copy the
`_filehub_desktop.tsx:482` `initialFiles` effect pattern): call `setDraft(...)` /
`setBriefFiles(...)` from `TaskCreationContext`. Clear/ignore on close so a
subsequent manual open is blank.

### 3b. Wire the screens

**Files:** `components/tabs/_tasks_desktop.tsx`, `components/tabs/_tasks_adaptive.tsx`
(both already inside `TaskCreationProvider`; native branch of `_tasks_adaptive`
gets no-op hooks automatically).

On the root `View`:
```ts
const { ref: dropRef, isOver } = useFileDrop(
  (files) => { setSeedFiles(files.map(fileToStaged)); openCreate(); },
  !createModalOpen,
);
useSmartPaste(
  {
    onFiles: (files) => { setSeedFiles(files.map(fileToStaged)); openCreate(); },
    onText:  (text)  => { setSeedText(text); openCreate(); },
  },
  !createModalOpen,
);
```
- Drop overlay: reuse `useDropPulse` + the `TaskBriefPanel.tsx:485` overlay
  pattern (dashed-border `Animated.View`, `pointerEvents="none"`; inline style is
  the sanctioned exception for overlays). Match the existing FileHub overlay
  copy/tone (`_filehub_desktop.tsx:3599`).
- Pass `initialText={seedText} initialFiles={seedFiles}` to `<CreateTaskModal>`;
  reset both in the modal's `onClose`.

---

## Phase 4 — FileHub paste parity

**File:** `components/intelligence/_filehub_desktop.tsx`

Beside the existing screen-level `useFileDrop` (~L3590):
```ts
useSmartPaste(
  { onFiles: (files) => { setDroppedFiles(files); setShowUpload(true); } },
  canUpload && !showUpload,
);
```
`onFiles` already yields `File[]` (clipboard images arrive as `File` from
`getAsFile()`), which is exactly what `droppedFiles` → `UploadModal.initialFiles`
→ `UploadManager` already consume. Near-zero new code.

> Skipped: `_filehub_adaptive.tsx` (narrow web) paste. It has a separate upload
> engine keyed on `PickedFile { name,size,uri,type,webFile? }`; adding paste
> means synthesizing a `PickedFile` from a clipboard `File`. Thin usage slice —
> add when narrow-web FileHub paste is actually requested.

---

## Phase 3.5 — global "drag in progress" affordance (shared FileHub overlay)

**Problem:** the drop overlay is hover-gated — it only appears on the one zone the
cursor is already over. Wanted: the instant an OS file drag enters the window,
*every* mounted drop zone shows the affordance (Slack/Notion pattern), escalating
on actual hover.

### 3.5a — global signal in `hooks/useWebDnd.ts`
- Module-level `dragenter`/`dragleave` counter on `window` (install once at module
  scope, same as `lib/webModifierKeys.ts`; `Platform.OS === 'web'` only).
  Increment on `dragenter`, decrement on `dragleave`, reset to 0 on `drop` /
  `dragend`. Only count file drags: `activeDragPayload === null &&
  dataTransfer.types.includes('Files')` (reuse the existing `isFileDrag` guard).
- Expose via a tiny subscribe-store (mirror `activeDragPayload` / `jobsStore`);
  `useFileDrop` gains a **third return field** `isDragActive: boolean`.
  Backward compatible — existing `{ ref, isOver }` destructures unaffected.

### 3.5b — extract the FileHub overlay to a shared component
`components/common/FileDropOverlay.tsx` — lift the markup from
`_filehub_desktop.tsx` (~L3599): `pointerEvents="none"` absolute `inset-0`,
dashed `border-2` `Animated.View`, cloud-upload icon scaled by `useDropPulse`,
`colors.primary` / `colors.card` tokens (inline style = sanctioned overlay
exception).
```ts
<FileDropOverlay active={isDragActive} over={isOver} label="Drop files to upload" />
```
- `active` → render at low intensity (dim border, slow pulse).
- `over` → escalate (solid tint, faster pulse, brighter icon).
- Confirm `useDropPulse` gates on `useReducedMotion()`; if not, add it there.

### 3.5c — adopt it
Replace the inline overlays with `<FileDropOverlay>`:
- `components/intelligence/_filehub_desktop.tsx` (the source pattern)
- `components/tabs/_tasks_desktop.tsx`, `_tasks_adaptive.tsx` (added in Phase 3b)
- `components/tasks/CreateTaskModal.web.tsx` (composer drop zone — check what it
  renders for drop state today; swap to the shared overlay)

> Deferred: `TaskBriefPanel.tsx`, `StageActions.tsx`, FileHub UploadModal inner
> drop zone. Same one-line swap; do when convenient, not speculatively.

---

## Phase 5 (deferred) — dropped text + native screen-level affordance

- `useTextDrop(onText, enabled)` sibling hook in `hooks/useWebDnd.ts`, wired into
  the Tasks screen so dragging selected text opens the composer with the title
  filled. Deferred: dragging text is rare.
- Native Tasks screen: a "Paste image → new task" affordance on the FAB/quick-create
  menu, since native has no OS drag and no bare-Ctrl+V idiom. The functional
  outcome is already reachable (FAB → composer → "Paste Image" button), so this is
  polish, not parity-breaking.

---

## Native / cross-platform (ui-style-guide.md)

- **Path B** (divergent components sharing logic): `useSmartPaste` / `useFileDrop`
  are web-only no-ops on native (existing convention). Each divergence carries a
  one-line comment per `animation-consistency.md`.
- Functional parity today on native: "Paste Image" button + `expo-image-picker` /
  `expo-document-picker` in `CreateTaskModal.tsx` and `TaskBriefPanel.tsx` already
  let a user attach a clipboard image / file to a new or existing task. Phase 5
  closes the last screen-level gap.
- Tap targets on any new affordance ≥ 44×44px.

## Rules compliance checklist

- No `outline-none` / `outlineWidth:0` anywhere; if a drop `View` takes focus use
  `className="focus-ring-none"`.
- State feedback uses `state-info` / `state-success` tokens (or match the existing
  `colors.primary` overlay pattern already used in `TaskBriefPanel`), never raw
  Tailwind color classes.
- Drop affordance uses `useDropPulse` — do **not** add a second `Animated.loop`.
  Verify `useDropPulse` already gates on `useReducedMotion()`; if not, add it there.
- No new dependencies. No CSS grid (flex-wrap only).
- `CreateTaskModal` Popup `maxWidth` (1200) untouched.
- Popup / DraggableSheet wrappers unchanged — this is additive.

## Verification

- `npx tsc --noEmit` at baseline error count.
- `node _babelcheck.js <touched files>`.
- `hooks/useWebDnd.smartpaste.check.ts` passes.
- Manual walkthrough at ~1400px, ~1000px, ~390px (walkthroughs.md):
  1. Tasks screen, nothing focused: Ctrl+V a screenshot → composer opens, image attached.
  2. Tasks screen: Ctrl+V text → composer opens, title (+ description) filled.
  3. Tasks screen: drag a file from Explorer → same as (1), with drop overlay.
  4. Open composer: Ctrl+V screenshot → attaches to `briefFiles`.
  5. Open composer, focus description: Ctrl+V text → normal in-field paste, no hijack.
  6. FileHub desktop: Ctrl+V a file/screenshot → Upload modal opens pre-loaded.
  7. Native: FAB → composer → "Paste Image" still works; no regressions.
- `graphify update .` after implementation.

## Files touched

| Phase | File | Change |
|---|---|---|
| 1 | `hooks/useWebDnd.ts` | new `useSmartPaste` |
| 1 | `hooks/useWebDnd.smartpaste.check.ts` | new self-check |
| 2 | `components/tasks/CreateTaskModal.web.tsx` | `useSmartPaste` for image/file paste |
| 3a | `components/tasks/CreateTaskModal.web.tsx` / `.tsx` | `initialText` / `initialFiles` props + seed effect |
| 3b | `components/tabs/_tasks_desktop.tsx` | screen-level `useFileDrop` + `useSmartPaste` + overlay + seed props |
| 3b | `components/tabs/_tasks_adaptive.tsx` | same (native = no-op hooks) |
| 4 | `components/intelligence/_filehub_desktop.tsx` | screen-level `useSmartPaste` |
| 5 (deferred) | `hooks/useWebDnd.ts`, native Tasks screen | `useTextDrop`, native paste affordance |

## Suggested delegation (one subagent per phase, in order)

1. **Phase 1** — hook + self-check. Self-contained, unblocks the rest.
2. **Phases 2 + 4** — thin wirings into two existing consumers; can share one agent.
3. **Phase 3** — the meatiest: new props + seed effect + two screen files + overlay.
4. Phase 5 only if the user asks.
