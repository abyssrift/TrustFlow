# TrustFlow — Features & Issue Tracker

Running list of ideas, issues, and improvements. Organized by area.
Priority tags kept where originally noted: (High) / (Medium) / (Future).

---

## 🐛 Bugs (broken right now)

- ON native mobile, clicking an excel sheet in the task brief doesnt open it internally in the app, it just redirects you to the link to download it, which i hope we can add a redirect link to re take you to the app without making it annoying. (maybe get download permissions? i wanna make the download experience seamless for users.)

- the clickableopacity of the folders is much smaller than files for some reason.

---

## ✅ Tasks & Pipelines

- Implement manual card reordering (drag-and-drop) to manage high-volume task lists. (High)

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

- the file too large to load thing should be for 500 KB for mobile, and way higher for desktop, because desktop can get way bigger files.

- Selection and bulk actions are not inclusive of folders, i want windows explorer like interactions.

- Dragging a file to a folder while selecting multiple should drag them all to the folder. and show that its dragging all of them

- Give the Folder properties like files, where we can view properties on the right when we click on it.

- Filehub can also be for links too, not just files/folders, just general resources that the team can share for each project

- allowing files to be shareable by a one click link and somehow allow for some kind of security ish thing, the link should be auto generatable by filehub, and have a limited expiry date, and RLS policies and similar, that way team members can share links outside the platform easily.

- the shareable links are nice, i also hope to allow the shareable looks to apply for folders as well, and have the same preview style as normal files/folders. i want a massive ecosystem for this share system. including download permissions on and off etc, multiple files and folders can be shareable, at once, to multiple people, sharing should be added as an activity to that file.

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