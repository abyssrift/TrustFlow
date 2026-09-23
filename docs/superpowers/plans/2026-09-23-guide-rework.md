# Contextual Guide Rework — Plan

**Date:** 2026-09-23
**Status:** Owner decisions D1–D4 recorded 2026-09-23; awaiting adversarial review (Codex/Sol)
**Builds on:** [2026-09-20 design spec](../specs/2026-09-20-contextual-guide-checklist-design.md), [2026-09-20 plan](2026-09-20-contextual-guide-checklist.md)

## Why

User feedback: guides "forget where they were" and "end abruptly" once a screen's
guide finishes. An audit of the shipped system found that the infrastructure
(registry, permission-driven eligibility, server-synced resumable progress) is sound,
but the product layer is weak, and there are three outright bugs. This plan fixes the
bugs first, then makes guides point at real UI, then cuts and rewrites the content,
then adds steps that complete when the user actually does the thing.

## Who the guides are for

The target market is small and mid-sized Egyptian businesses that have **never used a CRM or ERP**. That makes guides a core onboarding path, not optional help. Consequences for this plan:

- **Assume no vocabulary.** "Pipeline", "stage", "portfolio" and "workflow" are jargon to this audience. Each guide explains its one key noun in plain words the first time it appears ("A *stage* is a step your work goes through, like *To do → In review → Done*").
- **Short sentences, common words.** Many users will be reading in their second language: at most ~20 words per step body, and no idioms ("catch up", "at a glance", "hand off").
- **Doing beats reading** even more for first-time users, which strengthens Phase 3.
- **Language gap (out of scope, flagged).** The app has no i18n library, no RTL handling, and no locale files; it is English-only. Arabic guides are blocked on app-wide localization. Guide copy already lives only in `GUIDE_REGISTRY`, so keep it there as plain strings (no JSX, no string concatenation) so it can be extracted as-is later.
- **Grow coverage over time.** This rework cuts to a small, high-quality core. More, deeper guides get added per surface afterwards, under the same rules.

## Audit findings (verify each before challenging the plan)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | **No highlight is ever drawn.** `activeAnchor` is measured and exposed, but no component reads it. All 39 steps are floating text, including the 11 that have an `anchorId`. | `grep -rn activeAnchor components app hooks` returns only `contexts/ContextualGuideContext.tsx` | High |
| F2 | **Skip on an in-progress guide breaks cloud sync for the session.** `skipGuide` → `progress.skip` = `markFamiliar` writes `familiar`. The update RPC only allows `familiar` from `not_started`/`familiar`, so it raises; `write()` catches it, calls `applyLocal()`, and sets `fallbackActive: true`. Every later write in that session then goes device-only. It also contradicts the spec ("a skipped In progress guide keeps its current step and remains In progress"). | `hooks/useGuideProgress.ts` (`skip = markFamiliar`, `applyLocal`), `supabase/migrations/20260920110000_user_guide_progress.sql` update RPC `AND (p_status <> 'familiar' OR progress.status IN ('not_started','familiar'))` | High |
| F3 | **Garbled copy.** Two step bodies contain byte `0x92` (Windows-1252 apostrophe) in a UTF-8 file, so users see "file�s" / "team�s". | `lib/contextualGuides.ts` steps `filehub-sharing.sharing` and `workflow-pipelines.list`; `file` reports "Non-ISO extended-ASCII" | Medium |
| F4 | **New users get two intros.** `WelcomeTour` shows a Popup when `onboarded_at` is null, *and* the provider auto-opens the checklist on first load. The provider's marker is in AsyncStorage, so it also re-fires for existing users on every new device/browser. | `components/onboarding/WelcomeTour.tsx`, `ContextualGuideContext.tsx` `CHECKLIST_AUTO_OPEN_KEY` effect | Medium |
| F5 | **Leaving the page kills the guide silently.** The route-mismatch effect clears `activeId` without telling the user. Progress is saved, so relaunching resumes, but nothing says so. | `ContextualGuideContext.tsx` effect on `[pathname, searchParams, activeGuide]` | Medium |
| F6 | **Finishing a guide dead-ended.** *Fixed in the working tree (uncommitted):* the final step now chains into `followingGuide`, and the checklist reopens when none remain. | `ContextualGuideContext.tsx` `followingGuide`, `GuideCoachPanel.tsx` "Next: …" | Done, pending commit |
| F7 | **Content is filler.** 28 of 39 steps have no anchor. Several restate their own title ("Find assigned work — Use the board to see the work that needs your attention"). There are three duplicate pairs on the same route: `tasks`/`task-workflow`, `filehub`/`filehub-sharing`, `team-people`/`team-assignments`. The spec capped guides at 1–2 steps and ≤2 coach marks; every guide shipped with 3 steps. | `lib/contextualGuides.ts` `GUIDE_REGISTRY` | High (product) |
| F8 | **Nothing asks the user to do anything.** Every step is advanced by pressing Next. | `GuideStep` type has no completion condition | High (product) |
| F9 | **Some anchors would be useless even if drawn.** `tasks:board` is `pointer-events-none absolute inset-0`, so a highlight would outline the whole screen. The `top-bar:*` anchors exist only in `.web.tsx` files, so native never has them. | `components/tabs/_tasks_desktop.tsx:1384`, `_tasks_adaptive.tsx:1356`, `TopBar.web.tsx`, `DynamicIsland.web.tsx` | Medium |
| F10 | **Naming collision.** The tutorial is called the "To Do checklist" in an app whose core noun is tasks. | `WelcomeTour.tsx` title/copy, `GuideHost.tsx` launcher label | Low |
| F11 | **The DB hard-codes the catalog.** `_user_guide_progress_final_step` whitelists all 13 ids at v1 with final step 2, plus a synthetic `profile` v2 test fixture. Any merge, rename, or step-count change is a migration. Bumping a version resets that guide to `not_started` for everyone. | Migration `_user_guide_progress_final_step`; `supabase/checks/check_user_guide_progress.sql:57+` | Constraint |

## Principles for the rework

1. **Every step points at something, or it doesn't exist.** The only exception is a single intro card when the page has no data (see P4).
2. **Do, don't read.** A guide's core step completes when the user performs the action. Next remains as an escape hatch.
3. **Fewer, shorter guides.** ≤3 steps per guide, no duplicate guides for one route, and copy never restates its title.
4. **Empty workspaces are the default case.** A new company has no tasks, files, or deadlines. Every guide needs an empty-data path that says "create the first one", not "look at this list".
5. **Never trap the user.** Missed events, permission-hidden controls, and missing anchors all degrade to a readable panel plus Next.
6. **Reuse the existing layers:** progress RPCs, `DeviceEventEmitter` (already used by `FileHubContext`/`TimerContext`), NativeWind `animate-pulse` + `useReducedMotion()` per `.agents/rules/animation-consistency.md` tier 1, and `lib/guidePanelPosition.ts`.

## Phase 0 — Bug fixes (no product decisions needed)

**Status: implemented 2026-09-23** (commit on `experimental`, not pushed). Client-only; no migration.

- **0.1 Skip (F2).** *As built:* Skip writes nothing and launches `followingGuide`; if there isn't one, it just closes. `start()` has already acknowledged the guide and set `in_progress`, so there is nothing to write, and the guide keeps its step and comes back around in the tour. This departs from the draft (acknowledge + close): with chaining, that would have made Skip identical to X. Now **X ends the tour** and **Skip moves past this guide**. Tests: `ContextualGuideContext.test.tsx` "skips without writing progress…", and the `GuideHost.test.tsx` Skip test.
  - *Review fix 1 (Codex, 2026-09-23):* because Skip writes nothing, `followingGuide`'s wrap-around could re-offer a skipped guide, so Skip cycled forever. Guides skipped this session are now kept in memory (`skippedIds`) and excluded from `followingGuide`. The list is cleared when the account or workspace changes, and a guide is removed from it when explicitly relaunched. Skipping the last guide ends at the checklist, the same as finishing. Covered by the two "full tour passes" tests, whose progress mocks update the rows; a mutation check confirmed both fail without the exclusion.
  - *Review fix 2:* `skip`/`markFamiliar` were removed from `useGuideProgress` and the context, so no client path can write `familiar`. Existing `familiar` rows still read and display. The hook test now asserts both methods are gone.
- **0.2 Encoding (F3).** Replace both `0x92` bytes with `'`. Add an assertion to `lib/contextualGuides.test.ts` that all registry copy matches `/^[\x20-\x7E—’]*$/`, so a wrong-codepage paste fails CI.
- **0.3 One intro (F4).** Keep `WelcomeTour`: its marker is server-side (`onboarded_at`), and its "continue" already opens the checklist. Delete the provider's AsyncStorage auto-open effect and `CHECKLIST_AUTO_OPEN_KEY`. Update the GuideHost tests that seed that key.
- **0.4 Suspend instead of kill (F5).** On route mismatch, move the guide to `suspendedId` instead of dropping it. While a guide is suspended, the `?` launcher shows a dot and relabels itself "Resume *<title>* guide". Pressing it calls `launchGuide(suspendedId)`, which already navigates back and resumes at the stored step. `closeGuide` / `skipGuide` / completion clear `suspendedId`. The spec already allows "close or suspend".
- **0.5 Commit F6** with its test (`GuideHost.test.tsx` "continues into the next unfinished guide…").

## Phase 1 — Make pointing real (F1, F9)

- **1.1 `GuideSpotlight`.** Rendered by `GuideCoachMark(.web).tsx` inside the existing overlay: an absolutely positioned, `pointerEvents="none"` rounded border at `activeAnchor`, padded 4px, in `border-brand-primary`. Pulse with `animate-pulse`, suppressed when `useReducedMotion()`. No backdrop dim; guides stay non-modal per the spec. Use theme colours through `useThemeColors` inline styles, not token classes (see memory: token classes go black inside overlays on web).
- **1.2 Stay accurate.** Remeasure on step change and anchor registration (both exist), on `useWindowDimensions` change, and on web on scroll (one `document` capture-phase listener, rAF-throttled, attached only while a guide is active). If the rect is outside the viewport, on web call `scrollIntoView({ block: 'center' })` on the resolved DOM node (`resolveDomNode` pattern from `StageTransitionFX.tsx`) and then remeasure. On native, fall back to panel-only mode.
- **1.3 Card placement.** Desktop: the card stays top-right unless it overlaps the rect, in which case it moves bottom-right. Mobile (<768 web + native): dock the card at the bottom, above the tab bar, using the existing `launcherBottom` value so it never covers top-of-screen targets. Keep it a compact card rather than a sheet: a sheet would hide the thing being pointed at, which is why Path B's "sheet" is the wrong call here. This is a deliberate spec deviation.
- **1.4 Fix bad anchors.** Retarget `tasks:board` to the column-header row (not `inset-0`). For `top-bar`, make the guide desktop-web-only via eligibility (`isMobile` is already in `GuideEligibilityContext`) until mobile shell anchors exist.
- **1.5 Anchor parity check.** A `.check.ts` (repo convention, e.g. `TaskCardActions.forwardUndo.check.ts`) asserting that every `anchorId` in the registry appears as `<GuideAnchor id="…">` in both the desktop and adaptive variant of its screen, or is explicitly listed as single-variant.

Exit criterion: every existing anchored step visibly highlights its target at 1400 / 1000 / 390 px and on native, and a stale rect never leaves a detached outline after resize or scroll.

## Phase 2 — Content rework (F7, F10, F11)

### Proposed catalog

Legend: **→** Next-advanced · **⚡** action-completed (Phase 3; until then it is Next-advanced) · *new* = anchor to add.

| Guide (version) | Steps | Anchors | Notes |
|---|---|---|---|
| `profile` (**v3**) | 1. ⚡ Add your photo and display name | `profile:identity` | Completes on a profile save that sets both. v3, not v2: v2 is the SQL check fixture (F11). |
| `top-bar` (v2) | 1. ⚡ Press Ctrl/⌘ K to jump anywhere · 2. → Activity island catches you up | `top-bar:navigation`, `top-bar:activity` | Desktop web only (1.4). |
| `tasks` (v2) — absorbs `task-workflow` | 1. → Columns are stages · 2. ⚡ Create a task · 3. ⚡ Move it to the next stage | `tasks:board` (retargeted), *new* `tasks:create`, `tasks:move` | In an empty board, step 1 copy reads "Your board is empty — let's add the first task". |
| `deadlines` (v2) | 1. → Everything due, by date · 2. ⚡ Open an item | *new* `deadlines:calendar`, *new* `deadlines:first-item` | With no dated work, a single intro card: "Dates you set on tasks appear here". |
| `projects` (v2) | 1. → Progress at a glance · 2. ⚡ Switch table/board view | *new* `projects:list`, *new* `projects:view-toggle` | |
| `filehub` (v2) — absorbs `filehub-sharing` | 1. → Browse by folder/project · 2. ⚡ Upload a file · 3. ⚡ Open a file for versions & sharing | `filehub:navigation`, `filehub:primary-action`, *new* `filehub:file-row` | Upload completion comes from `UploadManagerContext` (single choke point). |
| `team-people` (v2) — absorbs `team-assignments` | 1. → Find people and teams · 2. → Assign people to teams | `team-people:list`, `team-people:primary-action` | Step 2's anchor only renders for managers; others get panel fallback. |
| `workflow-pipelines` (v2) | 1. → Pick a workflow · 2. ⚡ Add or reorder a stage | `workflow-pipelines:list`, `workflow-pipelines:configuration` | |
| `intelligence` (v2) | 1. → Pick a date range · 2. → Read the trend | *new* `intelligence:range`, *new* `intelligence:chart` | Range picker is the shared one from #139. |

**Removed:** `task-workflow`, `filehub-sharing`, `team-assignments` (merged), and `portfolios` (**decision D1**). Result: 13 guides / 39 steps → 9 guides / 19 steps, with 8 action steps. Copy is written for the final catalog in the PR, not here. The rule is that each body says *why*, and the title says *what*.

**Rename (F10):** "To Do checklist" → "Getting started" in `WelcomeTour`, `GuideHost` labels, `GuideChecklist` header, and tests.

### Persistence migration (ships with Phase 2, blocking)

- A new migration redefines `_user_guide_progress_final_step`:
  - Add the v2/v3 entries with each guide's new final step (`steps.length - 1`).
  - **Drop the v1 entries.** An old client (an open web tab on the previous bundle, or a native 1.0.1 build) that still syncs v1 will get an exception from `rpc_sync_user_guide_progress` for the whole batch and fall back to device-only mode. Accepted because there are no real users yet (owner, 2026-09-23). Revisit this compatibility rule for any catalog change after launch.
  - Move the synthetic fixture from `profile` v2 to `profile` v99 and update `supabase/checks/check_user_guide_progress.sql` (which also hard-codes the catalog at line 57+).
- **Accepted consequence (D2, approved):** the version bump resets these guides to `not_started` for all users (sync RPC `ON CONFLICT … WHERE existing.guide_version < EXCLUDED.guide_version`). There are no real users yet.
- A stale v1 client writing against a v2 row fails the update RPC's `guide_version = p_guide_version` match and falls back to local. That is acceptable degradation; document it and don't engineer around it.
- Rows for removed guides stay orphaned: `filterEligibleProgress` already hides them, and deleting history contradicts the spec.
- Apply to prod only through the normal migration flow. Never `db reset` the local stack (see memory).

## Phase 3 — Action-completed steps (F8)

- **Type:** `GuideStep.completeOn?: GuideActionId`, where `GuideActionId` is a closed union: `'task.created' | 'task.stage_advanced' | 'file.uploaded' | 'file.opened' | 'palette.opened' | 'profile.saved' | 'deadline.opened' | 'projects.view_toggled' | 'pipeline.stage_saved'`.
- **Bus:** `lib/guideActions.ts` exports `emitGuideAction(id)` over `DeviceEventEmitter` (same mechanism `FileHubContext` uses; works on RNW). It is emitted only from success branches, after the RPC returns without error.
- **Consumer:** the provider subscribes only while a guide is active. When the active step's `completeOn` matches, the card shows a ✓ state for ~600 ms, then calls `nextStep()`. Actions performed while no guide is active are ignored: no background tracking.
- **Soft gate (decision D3):** on action steps, Next is relabeled "Skip this step" and stays enabled. A hard gate would trap users whenever an emit is missed, a control is permission-hidden, or the data needed doesn't exist. The reward for doing the action is auto-advance plus the ✓, not being forced.
- **Emission sites** (initial audit; the implementer must re-grep):
  - `task.created`: `contexts/TaskCreationContext.tsx:225`, `:322`; `components/sidebar/search/CommandPalette.web.tsx:549`; `components/tasks/TaskMobilityModal.tsx:454`. Excluded: `app/admin/dev-tools*.tsx`.
  - `task.stage_advanced`: `components/task-detail/TaskCardActions.tsx:299`, `contexts/TaskDetailContext.tsx:460`, and the kanban drag/optimistic mover (locate it; see the Kanban Move Actor work).
  - `file.uploaded`: `UploadManagerContext` job-success transition (one site).
  - The rest are single UI events at their own component.
- **Drift guard:** a `.check.ts` fails if any non-dev-tools file calling `rpc_create_task` or `rpc_advance_stage` doesn't also call `emitGuideAction`. This is what prevents the "fixed one caller, siblings broken" pattern.
- **Rejected alternative:** server-truth completion ("has this user ever created a task?"). It would detect actions done before the guide, but it needs per-action queries plus a migration, and adds latency to the reward moment. Revisit only if action steps prove confusing for users who already did the thing.

## Phase 4 — Tour flow and checklist polish

- **Up next:** the checklist opens with a single highlighted "Up next: *<followingGuide>*" row and a Continue button above the phase sections. `followingGuide` already exists in context.
- **Progress in the card:** the coach card header shows "Guide 3 of 9 · Step 2 of 3", so the chained tour has a visible end.
- **Chaining stays button-driven:** "Finish and continue to X" is explicit, and X / Skip exit the tour. The tour never auto-launches on login beyond the one `WelcomeTour` intro.
- **Finish moment:** when the last guide completes, the checklist shows one completed state ("You're set up"), then the launcher dot clears. The existing `checklistComplete` auto-hide handles the close.
- **Not doing:** keeping the checklist open beside the coach card. On the right they collide, and docking it left conflicts with the sidebar. The card's "Guide n of m" replaces it.

## Owner decisions (2026-09-23)

- **D1 — approved:** drop the `portfolios` guide for now. Deeper and additional guides get added later, under the same rules.
- **D2 — approved:** one-time progress reset for the rewritten guides; there are no real users yet. This also removes the v1 compatibility requirement (see the migration section).
- **D3 — approved:** soft gate. Action steps auto-advance, and "Skip this step" is always available.
- **D4 — approved:** the `top-bar` guide is desktop-web only until mobile shell anchors exist.

## Verification

- **Unit:** skip keeps `in_progress` and `fallbackActive` false (0.1); registry copy charset (0.2); suspend/resume (0.4); chaining (F6, exists); `completeOn` advances only the matching active step and is ignored with no active guide (3); catalog invariants (every step has an anchor or is the sole intro card, ≤3 steps, final step matches the SQL whitelist).
- **Checks:** anchor parity (1.5), emit drift (3), updated `supabase/checks/check_user_guide_progress.sql`.
- **Repo gates:** targeted vitest, Babel check on touched files, `graphify update .`. Existing unrelated tsc errors in `GuideHost.test.tsx` (`state.searchParams`) and `hooks/useGuideProgress.test.ts` (`familiar`) should be fixed in Phase 0 since those files get touched anyway.
- **Manual walkthrough** at 1400 / 1000 / 390 px web plus native, using a **fresh empty company** and a seeded one. The empty case is the one that matters most and the one least likely to be tested. Reuse the spec's walkthrough list and add: the highlight follows scroll/resize; leaving mid-guide shows Resume; every ⚡ step auto-advances; skipping an in-progress guide keeps cloud sync.
- No "done" claim without driving it in a running app.

## Sequencing

`Phase 0` (ship alone) → `Phase 1` → `Phase 2 + migration` (together; content without highlights is pointless, and the migration must land with the registry) → `Phase 3` → `Phase 4`. Phases 1 and 3 can proceed in parallel once Phase 0 lands; they touch different files apart from `ContextualGuideContext.tsx`, so sequence that file's edits.

## Known risks / where to push

- **measureInWindow vs overlay coordinates on web.** The overlay is `position: fixed`, and RNW's `measureInWindow` is viewport-relative. This should line up, but it is unverified until 1.1 renders.
- **Anchors inside virtualized or horizontally scrolled lists** (`tasks:move` wraps a `HorizontalScroll`) may measure stale after inner scroll. The web scroll listener is capture-phase for that reason; native inner scroll is unhandled (panel fallback).
- **The emit list is an audit, not a guarantee.** The drift check covers two RPCs; the other actions rely on review.
- **Soft gating might make action steps feel optional,** which is the point, but it weakens the "do, don't read" principle. D3 is approved; a challenge needs evidence that first-time users get stuck with the soft gate.
- **The copy rules are only as good as review.** Add a registry test that fails if a step body is over 20 words, or uses a jargon noun (`pipeline|stage|portfolio|workflow`) before the step that defines it.
- **The spec is now deviated from in four places:** ≤2 steps (now ≤3), the desktop checklist as a centered Popup (it is a draggable panel), local fallback on hydration failure (the spec forbids it; shipped anyway, not addressed here), and the mobile sheet (1.3 argues against it). Reviewers should decide whether the spec or the code wins.
