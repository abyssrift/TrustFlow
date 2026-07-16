# TrustFlow — Features & Issue Tracker

Running list of ideas, issues, and improvements. Organized by area.
Priority tags kept where originally noted: (High) / (Medium) / (Future).

---

## 🐛 Bugs (broken right now)

- ~~ON native mobile, clicking an excel sheet in the task brief doesnt open it internally in the app, it just redirects you to the link to download it~~ **FIXED (2026-07-14):** the Task Brief now opens spreadsheets / PDFs / Word docs / text inline in-app via `FilePreviewModal` (same viewer FileHub uses) instead of bouncing to a download; only truly non-previewable files (zip/video/audio) still download. In `components/task-detail/TaskBriefPanel.tsx`. _Note: EvidencePanel / submission attachments may still be download-only — verify separately if desired._

---

## ✅ Tasks & Pipelines
- Standardization: Standardize all time units across the frontend and ensure graphs reflect appropriate, consistent time units. (High)

- Task Reversal/Leading: Ability for managers to revert or override task states to correct workflow errors. (Medium)

- Shared Tasks: Define a system for cross-pipeline cooperation. (Medium)

- show which time effort sessions belong to whom, when and any relevant data we record on the task UI itself.

---

## 🗂️ Kanban & Views

- Calendar Integration: Visualize tasks in a calendar view to provide a clearer timeline. (a way to change the view from kanban board to calendar in a nice animation, allowing users to organize their thoughts.) (Medium)

- Kanban board: Create better high-level views to prevent users from feeling overwhelmed by too many tasks at once. (Requires thinking it throughly, we need a detailed plan, will take multiple days and weeks of development) (Medium)

- add a sidebar on kanban board like the sidebar on the other side to show everyone who has access to the pipeline as well as other pipeline relative information, the sidebar is always collapsed and only a slight small line is visible on the right, which is connected to a small circular bump at the top where if you hover, the sidebar expands and shows.

- allow also users to write personel notes in that sidebar, just things they wanna lookout for, that note system should be like the windows notes application, where you can open multiple notes and view only one, the others stay at the top at a nice selector, modern, sleek and elegant

---

## 📁 FileHub (files, folders, sharing)

- Mobile File Handling: Detect OS and stream direct media extensions (images, PDFs, videos) instead of forcing .zip downloads. (High)

- Selection and bulk actions are not inclusive of folders, i want windows explorer like interactions.

- Dragging a file to a folder while selecting multiple should drag them all to the folder. and show that its dragging all of them

- ~~Give the Folder properties like files, where we can view properties on the right when we click on it.~~ **DONE — desktop (2026-07-14):** folder rows now have an ⓘ button that opens a `FolderDetailPanel` on the right (name, location, subfolder count, Open/Rename/Delete), mirroring the file `DetailPanel`. Clicking the folder still navigates in. In `components/intelligence/_filehub_desktop.tsx`. _Follow-up: mobile (`_filehub_adaptive.tsx`) still has no folder properties sheet — folders only have rename/delete. Add a folder sheet there for parity if wanted._

- Filehub can also be for links too, not just files/folders, just general resources that the team can share for each project

- allowing files to be shareable by a one click link and somehow allow for some kind of security ish thing, the link should be auto generatable by filehub, and have a limited expiry date, and RLS policies and similar, that way team members can share links outside the platform easily.

- **DONE & DEPLOYED — folder share links (2026-07-14):** folders can be shared with a one-click expiring public link, mirroring files. Built: migration `20260716_filehub_folder_share_links.sql` (extends `filehub_share_links` to target a file OR folder + `rpc_filehub_folder_share_link_create/_list`, revoke is shared); edge function `filehub-share-resolve` now resolves a folder token into signed URLs for all files in it; `createFolderShareLink`/`listFolderShareLinks` in FileHubContext; a **Share Link** button in the desktop `FolderDetailPanel` (reuses `ShareLinkModal`); and the public `/share/[token]` page renders a folder's file list with per-file downloads.
  - ✅ **Deployed to prod (project wbvgufqfgbvbinjrdzlg):** migration applied (file_id now nullable, `folder_id` + one-target check constraint + both RPCs verified live); `filehub-share-resolve` redeployed as v2 (verify_jwt=false preserved) and smoke-tested (bogus token → clean 404). Soft-deleted folders are excluded (create RPC + resolver both guard `deleted_at IS NULL` — the live folders table has soft-delete, unlike the original phase-1 migration).
  - **Still TODO from the "massive ecosystem" vision:** download-permission on/off toggle; multi-select share (share several files/folders at once, to multiple people); nested-subfolder contents in the shared view (currently only files directly in the folder); log sharing as a file/folder activity; mobile (`_filehub_adaptive.tsx`) folder share UI.

- the original ask (kept for reference): allow shareable links to apply for folders as well, same preview style, download permissions on/off, multiple files/folders shareable at once to multiple people, sharing logged as an activity.

---

## 🔔 Notifications & Activity

- Whenever there are new files/new activity happening there should be something showing and a number displayed on the icon in the sidebar.

- Show precise activity on channels, showing who moved what when how, all activities that are related to dragging and such, i want full controls.

---

## 🎨 UX Polish & Feel

- UX polish, i need animations, smoothness, more consistency in all button colors, less out of place spots.

- Combined Timer island + topbar island is super finicky, hovering and what not, needs a new resight and review. (sink alot of time into it, UX is the most important thing now, any added new functionalities are just marginal returns.)

- when a new task is added to a pipeline, would it be possible to play a small nice ding sound when the user isnt looking at the app? (Generally refactoring and adding nice sounds to everything. haptics for native, nice dings for desktop)

---

## 🚀 Onboarding & Workspace Setup

- Default tutorial for starting a new workspace, pipelines, roles, permissions. gotta take user through each screen, explaining what everything does, how to use, why, etc. (Allow for admins to create workspaces, general UX).

---

## 🧪 Quality & Testing

- TESTING, SO MUCH FUCKING TESTING, IN EVERYWAY, SO MANY KINKS, SMALL BUGS, MINOR ISSUES

---

## 📊 Analytics

- Performance tab should allow for day by day comparison

---

## ⚙️ Automation & API (Future Roadmap)

- Task Automation: Implement automatic archival processes.

- Integration/API: Standardize API calls to support cross-pipeline task management and external integrations.

- Adding Routines as a subcategory of automations in pipeline builder, where tasks can be recurring, some specific tasks can be routed differenlty, etc.

---

## 🧱 Web Polish / RNW Parity (Technical Debt — High Priority for "smoothness")

**The problem in plain terms:**
This app is written in React Native, and then a tool called React-Native-Web (RNW) translates that same code so it can run in a browser. Most of the time this works. But a few React Native features have NO real equivalent in a web browser. When RNW hits one of those, it doesn't crash or warn — it just quietly does nothing or renders it wrong. That "quietly wrong" behavior is exactly what makes the web version feel slightly janky to users, even though the app is feature-rich.

We keep fixing these one at a time, in whatever screen they show up in. That's whack-a-mole — the same bug keeps reappearing in a new place. We've hit at least four versions of it already:

| What we used (React Native) | Why it breaks on web |
|---|---|
| `Alert.alert` with multiple buttons | RN pops a native OS dialog. The browser has no such thing, so the whole confirm just silently does nothing — user clicks "delete", nothing happens. |
| Theme color classes inside a `<Modal>` | A Modal renders in a detached corner of the page ("portal") that our color styling doesn't reach, so text/backgrounds fall back to **black**. |
| `DraggableSheet` backdrop | On native, opening a sheet automatically dims everything behind it. On web that dimming doesn't happen, so the sheet looks see-through and floaty. |
| `draggable` / `onDrag*` props | These are RN gesture props. On web they're ignored — drag-and-drop just doesn't fire. |

**The fix (this is NOT a rewrite — do not rip out RNW):**
Instead of fixing each screen, we wrap each leaky feature ONE time in our own safe component, and then force the whole app to use only that wrapper. If the raw broken version can't be reached anymore, the bug physically can't come back.

1. **`AppModal` wrapper** — one Modal component that injects our theme colors as inline styles (so the "portal" problem can't turn things black), and always renders a proper dimmed backdrop. Every sheet/dialog/modal uses this and only this.
2. **Route all confirms through `useAlert().showConfirm`** — we already have this; the job is to delete every remaining raw `Alert.alert` and use the hook everywhere.
3. **Route all drag-and-drop through `hooks/useWebDnd.ts`** — we already have this too; never touch RN drag props directly again.
4. **Add an ESLint rule (`no-restricted-imports`)** that BANS importing the raw `Alert` and raw `<Modal>`. This is the important part: it makes the broken versions un-importable, so no future code (ours or an AI's) can reintroduce the bug. It becomes impossible to make the mistake, instead of us catching it later.

**Scope:** ~3 wrapper files + 1 ESLint rule + a find-and-replace pass. Small effort, and it's the single highest-leverage thing for making the web app *feel* smooth, because it kills a whole category of papercuts at once instead of one at a time.

**Status (2026-07-14):** `useAlert().showConfirm`, `DraggableSheet` (with `dimBackdrop`), and `hooks/useWebDnd.ts` already exist. `components/common/AppModal.tsx` now added (web-safe centered dialog). Remaining: the ESLint ban — blocked because no ESLint toolchain is set up in the project yet.



I want a new tracked analytic and its respective graph in the UI.

1. Showing what each team/pipeline spent their time within a timeframe, so it would highlight which category of tasks take the most time. (This can also be used to track projects)

The Sidebar on the right still has role access issues, dont forget to fix.


Buttons on files and folders are not consistent, some have animation, some show on hover, some are always there, they're not even the same buttons. lets standardize the buttons by allowing some buttons to be moved to the general header, while some can stay on the file/folder.

Recent Activity tab in the personal performance in profile displays other people's recent activity, should be only for yourself.

We had an instance of a timer somehow breaking, where the recorded time was discarded and somehow removed, we need to make sure this NEVER happens. i wanna fix the bug, and make sure that nothing like this happens, can we get solutions like every 5 mins, timer creates a local backup or something, and once it submits it confirms locally that it finished? that way a stack trace that isnt marked completed means the timer failed somehow??? but i dont want this to affect our beacon and idle detectors too.

**Status (2026-07-15): FIXED + hardened.** Root cause: three RPCs closed sessions without writing `total_seconds_spent` (the field all UI/reports read). Shipped: (1) DB trigger `trg_backfill_session_duration` auto-fills duration on any active→completed close — the whole bug class is now impossible from any code path, current or future; (2) `rpc_start_work` orphan-cleanup anchors duration to `last_heartbeat_at`; (3) hourly pg_cron sweep closes sessions stranded >8h; (4) NEW: `rpc_resume_session` — page reload was silently killing running timers (`stopped_at` column didn't exist + RLS blocked the client update). The 30s server heartbeat already covers the "local backup" idea more durably; no client backup needed. Beacon + idle detectors untouched. Lost 26m52s session restored.hoow

Lets refactor the way the activity is displayed on the task card view in tasks.tsx instead of this vibe coded look green look with name, i want the user's Profile picture, and when you hover over him, a nice animation is shown and you can see relevant data such as their current session, start time of the session, their name, etc.

**Status (2026-07-16): SHIPPED.** `ActiveSessionAvatars` replaces the green "NAME IS ACTIVE" banner everywhere it appeared: both kanban boards (desktop + adaptive, gated on the existing `showAvatars` personalizer) and the task detail header. At rest it's an overlapping avatar stack with one presence dot; on hover the stack fans out and a popover shows each worker's name, session start, live duration, and idle state. Presence rules live in `lib/sessionPresence.ts` (pure, with `lib/sessionPresence.test.ts` — `npx tsx lib/sessionPresence.test.ts`): a heartbeat older than 90s (3 missed 30s pulses) reads as idle/amber, since `useSmartTimer` deliberately stops pulsing while the tab is hidden. Unknown heartbeat → treated as active, never amber. Migration `20260716_task_details_session_presence.sql` adds `avatar_url` + `last_heartbeat_at` to `rpc_get_task_details`' work_sessions payload — the old banner had no avatar and no idle signal, and without this the detail header needed a second query against `task_work_sessions` on every 30s heartbeat. Also removed the now-dead `renderTimerBadge` from TaskCardActions.

Not verified in a running app yet — the presence dot, fan-out animation and popover placement are visual and want a real look, especially the `align="center"` popover in the detail header.

Mobile web layout is missing the navbar, it broke on the prod for some reason , investigate what happened to it and fix it because last time i saw it, it was working. its a bit finicky because we dont know where the bottom edge is for each phone, how do we usually fix this?


Task claiming as an option in team settings. where you can toggle it on/off, if you turn it on, only 1 single member in a team who was assigned a task can claim the task and actually continue in it.

moving from bulk task creation to single or single to bulk deletes what was already written.

if you're uploading a file, even if you close the upload modal it should continue in the background and should be cancellable midway, it should also be shown in the island that exists in the topbar when you hover over it, a big rectangular pill shows with the progres, total files, estimated time etc. handle the island where the timer and the upload can exist together well in the island

Kicking/leaving filehub groups doesnt work, it needs actual work.

Orphan tasks fuck up folder uploads badly, it needs so much more work!


Focus on IOS WEB, for safari, that way ahmed can use it, i need to focus as much as possible on iphone safari.
