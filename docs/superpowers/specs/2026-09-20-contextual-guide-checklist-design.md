# Contextual Guide Checklist — Phase 1 Design

**Date:** 2026-09-20  
**Status:** Approved for implementation  
**Owner:** TrustFlow Sol architect

## Outcome

Replace the generic, linear `WelcomeTour` with one capability-aware contextual guidance system whose primary launcher is a dynamic **To Do** checklist. The checklist mirrors the app surfaces the current user can actually reach, explains them in product language, routes each selected row to the relevant screen, and launches a concise, skippable in-page guide there.

The final product goal is comprehensive contextual coverage of each meaningful screen, capability, and mechanic that becomes available through current effective access. “Meaningful” means a user-facing workflow, decision, or action worth teaching—not an inventory of every button, field, or decorative control. As access reveals new tabs or screens, their guide rows appear dynamically and preserve all prior completion history.

Phase 1 establishes the surface-driven registry and seeds it with six bounded guide examples:

1. **Profile** — universal.
2. **Top Bar** — universal; covers the calendar, command palette, and activity island as a coherent navigation/productivity area.
3. **Tasks** — shown when the Tasks surface is reachable; covers reaching assigned work and moving work through its workflow.
4. **File Hub** — shown when the File Hub surface is reachable; covers reaching shared files and the primary file action available to the user.
5. **Team & People** — shown when the People/team management surface is reachable; covers finding the team surface and its primary management action.
6. **Workflow & Pipelines** — shown when pipeline configuration is reachable; covers finding workflow configuration and its primary stage/configuration action.

These six entries are the **phase-1 rollout boundary**, not the final coverage boundary. Coverage for other meaningful surfaces and mechanics is deliberately deferred to later rollout phases after the registry, routing, anchoring, persistence, and access-driven visibility patterns are proven. Later entries join the same registry without introducing role-bucket logic or another checklist system.

The system absorbs the existing `WelcomeTour`; it does not create a second tour framework beside it. Existing users can open the checklist manually regardless of their legacy onboarding state.

## Non-goals

- Showing permission keys, role IDs, access matrices, or other granular authorization details to users.
- Changing authorization or granting access. Guides only reflect effective access already calculated by the application.
- Classifying users into role buckets for guide selection.
- Maintaining a second, guide-specific matrix that can drift from navigation visibility.
- Teaching low-level implementation details, internal architecture, or authorization mechanics.
- Building an exhaustive control-by-control inventory; guides focus on meaningful workflows and mechanics.
- Requiring every explanation to have a coach mark; panel fallback is a supported delivery mode.
- Building a separate editorial help center, video library, or searchable documentation product in this phase. Those could complement contextual guides later but are not part of the requested system.
- Replacing the workspace-creation readiness summary. The checklist begins after workspace entry and is a user-level guidance lifecycle.

## Surface eligibility model

### Source of truth

Eligibility is derived from the current user's **effective access** exposed by `AuthContext`, after `permissionsLoaded` is true. `AuthContext` already obtains access produced by direct roles and team-inherited roles through the existing permission RPCs. The guide system must consume that effective result; it must not query role-assignment tables or independently reconstruct access.

The preferred source of truth is the app's existing navigation/destination visibility logic. A guide for a product surface should reference the same stable destination or visibility predicate used by the sidebar, tabs, command palette, or route gate. It must not restate that surface's raw permission expression in checklist UI code.

Guide eligibility has only two forms:

- **Universal:** available to every authenticated user once auth/profile state is ready.
- **Surface-driven:** available only while the corresponding app surface is visible and reachable under current effective access.

No screen, checklist row, tooltip, error, analytics label, or persisted guide record may expose raw permission names. No role-bucket type is derived or persisted.

### Eligibility derivation

- While authentication or effective access is unresolved, eligibility is unresolved and only a loading state is rendered.
- Universal guide entries become eligible after authenticated profile state is ready.
- Surface guide entries resolve through the shared destination-visibility source used by navigation.
- A guide whose destination is absent from current navigation and not otherwise reachable is omitted.

If an existing surface does not yet expose a reusable visibility predicate, implementation may extract one product-level selector and adopt it in both navigation and the guide registry. Presentation components must not contain permission-key arrays or duplicate authorization logic.

### Effective-access change behavior

The checklist is derived, not copied into component state. When `AuthContext` refreshes effective access after a role, team-assignment, plan, or other access change:

1. Re-evaluate every registered surface using shared navigation visibility.
2. Keep universal rows and all completion records unchanged.
3. Add rows for newly reachable surfaces.
4. Hide rows for surfaces that are no longer reachable.
5. Preserve hidden rows' stored completion records; eligibility changes affect visibility, not history.

Promotion is one example of this general behavior: newly unlocked tabs/screens add their guide rows; existing reachable rows are not replaced wholesale. If access later changes back, a re-eligible surface reappears with its prior completion status. A guide that becomes ineligible while open closes safely and returns the user to the checklist with a neutral “This guide is not currently available” message.

## Checklist experience

### Primary launch surface

The To Do checklist is the primary guide launcher, not a secondary Help menu. It is available from the authenticated application shell on desktop and mobile and opens through the standard `Popup` adaptive contract:

- Desktop web: a concise centered checklist panel.
- Mobile web and native: a touch-friendly sheet with at least 44×44 px interactive rows.

For a user whose `profile.onboarded_at` is null, the checklist introduction opens once after the user reaches an eligible authenticated app screen. Dismissing or acknowledging this introduction completes the existing legacy onboarding marker through `rpc_complete_onboarding`. It does not mark individual guides complete.

For users whose `onboarded_at` is already populated, the checklist remains manually summonable. This preserves the legacy marker as “first-run introduction acknowledged” while moving all durable guide progress to versioned per-guide completion.

### Row behavior

Each visible row shows product-oriented title, one-sentence outcome, completion state, optional **New** badge, and a primary action. The visible progress states are:

- **Not started** — no step has been completed for the current guide version.
- **In progress** — at least one step has been acknowledged; launch resumes at the stored current step.
- **Done** — the final step was acknowledged for the current guide version.

**Skip for now** closes the active guide and acknowledges its New badge, but never writes Done. A skipped Not started guide remains Not started; a skipped In progress guide keeps its current step and remains In progress.

The checklist provides a **Hide completed** toggle. It filters Done rows from the current view without deleting progress and defaults to showing completed rows so Replay remains discoverable.

The **New** badge appears when a guide first becomes eligible for the account, including after an access change. Newly eligible guides do not auto-open. The badge clears when the user starts/replays that guide or explicitly skips it for now; merely opening the checklist does not clear it.

Primary row actions are:

- Incomplete row: **Start**.
- Completed row: **Replay**.

Selecting a row:

1. Resolves current eligibility from the latest effective access.
2. Navigates to the guide's declared route if needed.
3. Waits for the destination screen and registered anchors to become ready, within a bounded timeout.
4. Launches the contextual guide.
5. Falls back to the guide panel if navigation succeeds but an anchor does not become available.

Completed rows remain visible and replayable. Completion changes the status and action label; it never disables the guide.

The contextual Help action on a supported screen opens the same registry-backed guide for that screen. It must not own separate copy, steps, progress, or completion behavior. Checklist launch, per-screen Help, and automatic first-run introduction all converge on the same guide state/provider.

## Guide catalog and boundaries

Every phase-1 guide has concise explanatory content and at most two coach marks. A guide step describes an outcome, not implementation or permission mechanics.

| Guide | Eligibility | Destination | Coach-mark budget | Fallback content |
|---|---|---|---:|---|
| Profile | Universal | Profile/settings screen | 1 | Explain where personal identity details are edited and why they matter. |
| Top Bar | Universal | Current shell or a stable default screen | 2 | Explain calendar/deadlines and command palette/activity island without requiring every shell control to exist on mobile. |
| Tasks | Tasks destination visible | Tasks screen | 2 | Explain assigned work and stage movement; if no task card exists, explain movement using the empty/current board state. |
| File Hub | File Hub destination visible | File Hub | 2 | Explain shared-file navigation and the primary available file action; do not promise upload when unavailable. |
| Team & People | People/team destination visible | People/team management surface | 2 | Explain finding team members and the primary available assignment/management action. |
| Workflow & Pipelines | Pipeline destination visible | Pipeline administration | 2 | Explain locating a workflow and editing its stages/configuration at a high level. |

Coach marks must target registered controls or regions rather than screen coordinates. A target registration has a stable semantic ID shared by desktop and adaptive variants even when the underlying render trees differ.

## Contextual guide presentation

### Common behavior

The guide panel owns:

- Guide title and concise explanation.
- Current step and total step count.
- Back, Next/Done, and Close actions.
- Skip for now without completion.
- Completion recording when the final step is acknowledged.
- Resume from the account's stored current step for the current guide version.
- A panel-only mode when no usable anchor is available.

Missing anchors, empty data, permission-hidden controls, route timing, and responsive layout changes are expected conditions. They are not fatal errors. The panel remains usable, names the intended area without claiming it is visible, and lets the user continue or finish.

### Desktop web

Desktop may show an anchored callout and spotlight around the registered control. Placement should reuse the established tooltip positioning/viewport-clamping logic rather than introduce independent geometry rules. The guide remains interactive, so it must not be implemented as or folded into the noninteractive `Tooltip` component.

The spotlight and panel must update after scroll, resize, route transitions, and anchor remounts. If measurement becomes stale, temporarily return to panel-only presentation until the anchor is measured again.

### Mobile web and native

Mobile uses an adaptive presentation rather than shrinking the desktop callout:

- The explanation and controls live in a standard sheet/`Popup` presentation.
- The target may receive a lightweight highlight when it is mounted and visible.
- No essential instruction depends on hover, a narrow floating bubble, or the highlighted control remaining visible behind the sheet.

This is UI style-guide **Path B: adaptive/divergent presentation**. Desktop and mobile share guide state, registry, surface eligibility, completion, and navigation behavior while rendering platform-appropriate presentation.

No raw React Native `Modal` is permitted. The phase-1 replacement removes the legacy native raw-modal dependency from `WelcomeTour` rather than carrying it into the new system.

### Motion

Coach-mark emphasis should use the smallest existing animation mechanism that communicates location. A simple CSS/NativeWind pulse is preferred when sufficient. Any value-driven animation uses the repository's existing Reanimated pattern and `useReducedMotion()`.

With reduced motion enabled:

- No pulsing, springing, or animated repositioning.
- Spotlight and panel appear in their final states.
- Navigation, focus, explanation, and completion behavior remain identical.

The design introduces no fifth animation system and does not rely on Reanimated declarative `entering`, `exiting`, or `layout` behavior on web.

## State and persistence

### Guide definitions

The guide registry is static application metadata. Each definition contains:

- Stable `guideId`.
- Positive integer `version`.
- Universal status or a stable product-surface/destination reference.
- Product-level eligibility resolver shared with navigation visibility.
- Destination route.
- One or two ordered steps.
- Semantic anchor IDs and panel fallback copy.

The registry is the single source for checklist rows and launched guide steps; screens must not duplicate guide copy.

### Account-scoped progress record

Phase 1 persists guide progress in Supabase so progress follows the authenticated account across devices. The client may keep hydrated progress in memory for rendering, but AsyncStorage/device-local state is not the source of truth.

The server record is user-owned and keyed by `(user_id, guide_id)`. It stores the current registry version, visible progress state, resumable step, first-eligibility time, New-badge acknowledgement, completion time, and update time. Conceptual shape:

```ts
type GuideCompletionState = {
  guideId: GuideId;
  guideVersion: number;
  status: 'not_started' | 'in_progress' | 'done';
  currentStep: number;
  firstEligibleAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};
```

A guide is complete only when the record's `guideVersion` equals the current registry version and `status` is `done`. Raising a guide's version resets that guide to Not started/current step 0, creates a fresh New state, and does not affect other guides. Replaying a completed guide does not clear Done; progress writes during Replay are resumable for the active run, and finishing is idempotent.

When an eligible guide has no current-version record, the client creates one as Not started with `acknowledgedAt = null`. This discovery write must not open the guide. Starting a guide acknowledges New and writes In progress/current step. Back/Next writes the resumable current step. Skip for now acknowledges New and preserves Not started or In progress. Done is written only after final-step acknowledgement.

Row-level security restricts reads to `auth.uid() = user_id`; clients cannot read another account's guide progress. Lifecycle writes go through a narrow authenticated RPC that derives `user_id` from `auth.uid()`, validates status/step/version transitions, preserves first eligibility for the current version, and sets timestamps server-side. Direct client table writes remain revoked so callers cannot bypass New, Skip, resume, or Done invariants. Surface eligibility changes never delete progress records. Sign-out clears in-memory guide state, and the next authenticated user hydrates only their own server records.

### Legacy onboarding marker

`users.onboarded_at` and `rpc_complete_onboarding` remain intact in phase 1. They control only whether the first-run checklist introduction should auto-open. They do not determine:

- Which checklist rows are visible.
- Whether a guide is complete.
- Whether a guide can be replayed.

The old generic `WelcomeTour` steps and rendering are removed or reduced to a compatibility handoff so only one guidance system is mounted.

## Dataflow

```text
AuthContext session/profile/effective access
                |
                v
 shared surface-visibility resolver
                |
                v
 guide registry + destination eligibility
                |
                v
 versioned account-scoped progress state
                |
                v
       visible To Do checklist
                |
          row selected
                v
 route destination -> await screen readiness -> resolve semantic anchor
                |                                  |
                | found                            | missing/hidden/timeout
                v                                  v
 anchored coach mark + panel                 panel-only guide
                \                                  /
                 ---- final step acknowledged -----
                                  |
                                  v
                    persist guide version complete
```

## Error and edge handling

- **Effective access loading or failed:** show checklist shell/loading state; do not guess eligibility and briefly flash inaccessible rows.
- **Progress hydration failure:** keep guide content readable, disable progress-mutating actions that would falsely imply server persistence, surface a non-blocking generic retry state, and retry hydration. Do not fall back silently to device-local completion or mark the legacy onboarding RPC complete as a substitute.
- **Progress write failure:** keep the guide on the current step, show a retryable generic error, and do not optimistically display Done/New-cleared state until the server write succeeds.
- **Legacy completion RPC failure:** keep the checklist usable and log/surface a retryable generic error; do not silently claim `onboarded_at` persisted.
- **Navigation failure or unknown route:** return to the checklist and show a generic “Guide could not be opened” message.
- **Anchor missing, hidden, off-screen, or timed out:** use panel-only mode; this is a supported fallback, not an error.
- **Permission/access changes during navigation or guide:** cancel the guide safely and recompute visible rows.
- **No data for a task/file/team/workflow anchor:** use the screen-level anchor or panel fallback; never fabricate sample records or require seeded business data.
- **Repeated taps:** launching is idempotent; only one active guide exists globally.
- **Route changes outside the guide:** close or suspend the active guide unless the new route is the declared destination.
- **Sign-out/account switch:** clear active guide state before hydrating another user's completion key.

## Architecture and interfaces

The design uses one root guide host and small screen-level registrations:

- **Guide registry:** static definitions, surface references, routes, steps, versions, and fallbacks.
- **Surface eligibility selector:** applies the same effective-access visibility decisions used by navigation.
- **Guide state/provider:** checklist visibility/filter, active guide/step, route handoff, anchor registrations, account progress hydration and writes.
- **Checklist UI:** renders derived rows and launches/replays guides.
- **Guide presentation:** shared behavior with adaptive desktop/mobile renderers.
- **Screen anchors:** semantic registrations attached to existing controls or stable regions.

Important invariants:

- One active guide globally.
- One registry owns checklist and guide content.
- No guide grants access or bypasses screen authorization.
- No permission key appears in user-facing guide output.
- No coordinate literals identify controls.
- No coach mark is required for guide completion.
- One content registry supplies checklist, per-screen Help, and active-guide copy.
- Done is written only by final-step acknowledgement; Skip for now is never Done.
- Existing onboarding redesign changes remain authoritative and are preserved.

## Work-package boundaries and integration order

Implementation, after separate user approval of this written design, should be delegated to Luna workers with disjoint file ownership:

1. **Server progress contract:** migration/RLS, typed progress adapter, version/reset semantics, and database/client tests.
2. **Pure model and registry:** guide types/content registry, surface eligibility derivation, progress reducer/selectors, and unit tests.
3. **Guide host and adaptive presentation:** provider, checklist popup/sheet, progress states/New/Hide completed, coach-mark presentation, anchor contract, and component tests.
4. **Universal anchors:** Profile and shell/Top Bar variants plus per-screen Help entry points.
5. **Core work-surface anchors:** Tasks and File Hub desktop/adaptive variants plus per-screen Help entry points.
6. **Additional-access surface anchors:** People/team and pipeline configuration variants plus per-screen Help entry points.
7. **Onboarding/root integration:** absorb `WelcomeTour`, preserve `onboarded_at`, and mount the single guide host. This package must explicitly preserve the current user-owned onboarding redesign diff.

Integration order is 1 -> 2 -> 3 -> parallel 4/5/6 -> 7 -> Sol final review. Sol owns any small cross-package integration correction and the final PASS/BLOCK decision.

Return to the user before implementation if a target surface cannot reuse or extract navigation visibility without changing authorization semantics, a target has no stable cross-platform anchor without redesigning that surface, or account-scoped progress cannot be secured and verified with user-owned RLS.

## Automated verification

### Pure behavior tests

- Surface eligibility remains unresolved until effective access is loaded.
- Every authenticated user sees universal rows.
- A surface guide is visible exactly when its corresponding navigation destination is visible/reachable.
- Promotion or another privilege change adds newly unlocked surface rows without removing still-reachable rows.
- Access removal hides only newly unreachable rows and retains their completion history.
- A user with only one additional privileged destination sees only that newly eligible guide.
- Progress is account-scoped, version-aware, idempotent, and synchronized across devices.
- New remains until Start/Replay/Skip for now, not checklist open.
- Not started, In progress, and Done derive correctly from server state.
- Skip for now never writes Done and preserves the resumable step.
- Hide completed filters only the current checklist view.
- Raising one guide version does not reset another guide.
- No user-facing registry copy includes permission-key syntax or granular permission names.

### Integration/component tests

- Checklist row navigation launches the intended guide after destination readiness.
- Missing anchor uses panel fallback and remains completable.
- Access revoked during launch cancels safely and recomputes rows.
- Existing `onboarded_at` suppresses only automatic introduction, not manual checklist access.
- Null `onboarded_at` auto-opens once and calls the existing completion RPC on acknowledgement.
- Legacy RPC errors are observed and do not falsely update the profile state.
- Completed rows expose Replay and remain launchable.
- In-progress rows resume the stored current step after remount and on another device.
- Per-screen Help and checklist rows launch the same registry definition and progress record.
- Only one guide can be active.
- Desktop and adaptive variants register the same semantic anchor IDs.
- Reduced-motion mode removes motion without removing highlighting, navigation, or controls.

### Repository gates

- Run the TrustFlow deterministic agent verification skill/gate.
- Run targeted guide, surface-eligibility, persistence, and touched-screen tests.
- Run Babel checks for every changed TS/TSX file.
- Update the graph with `graphify update .` after implementation.
- Do not claim end-to-end verification unless the flows were driven in a running app.

## Manual walkthrough checklist

Use accounts that demonstrate baseline access, newly unlocked surfaces, and partially restricted access. Record failures and fallback behavior rather than inferring success from the diff.

### Desktop web — approximately 1400 px

- Open the To Do checklist from the authenticated shell; verify the centered presentation and keyboard focus order.
- Confirm Profile and Top Bar always appear after auth is ready.
- Confirm each example surface guide appears only when its corresponding destination is visible.
- Launch every visible row, confirm route handoff, and exercise each available coach mark.
- Complete and replay a guide.
- Start a guide, leave midway, reload/sign in on another device, and confirm it resumes at the stored step.
- Skip a Not started and an In progress guide; confirm neither becomes Done.
- Confirm New clears only on Start/Replay/Skip and newly eligible guides never auto-popup.
- Toggle Hide completed and confirm progress is unchanged.
- Promote or otherwise expand the account's access, refresh effective access, and confirm newly unlocked surface rows are added while existing reachable rows and completion remain.
- Launch Team & People and Workflow & Pipelines when those destinations are visible.
- Remove an anchor or use an empty-data state and confirm panel fallback remains useful and completable.
- Enable reduced motion and repeat one anchored guide.

### Mid-width web — approximately 1000 px

- Repeat checklist opening and all phase-1 example destinations available to the test accounts.
- Confirm coach marks remain viewport-clamped through any header/content column changes.
- Resize while a guide is open; verify stale anchor measurement does not leave a detached callout.
- Confirm no desktop multi-column or shell layout leaks into an unusable narrow arrangement.

### Mobile web — 390 px

- Open the To Do checklist and verify sheet presentation, safe-area spacing, scroll behavior, and 44×44 px minimum targets.
- Run Profile and Top Bar, plus every surface guide available to the current account.
- Change effective access and confirm rows are added or hidden individually without replacing the checklist wholesale.
- Verify controls hidden behind mobile trays or absent from the mobile shell trigger panel fallback or a supported staged reveal, never a stranded spotlight.
- Rotate or resize while a guide is active and confirm the presentation recovers.
- Test reduced motion, close/back behavior, route changes, and replay.

### Native

- Confirm the guide/checklist uses `Popup`/sheet infrastructure and no raw `Modal`.
- Repeat one universal guide and two differently gated surface guides.
- Verify touch targets, safe areas, screen-reader labels, back behavior, and long content scrolling.

## Acceptance criteria

Phase 1 passes when:

- The To Do checklist is the single primary launcher for contextual guidance.
- Its rows derive from current effective access through the same surface visibility used by navigation, without role buckets or exposed granular permissions.
- The six phase-1 example guide definitions exist with no more than two coach marks each and are explicitly non-exhaustive.
- Universal and still-reachable rows survive access changes with completion intact; newly unlocked surfaces add rows and newly unreachable surfaces hide only their own rows.
- Every row routes and launches its guide, with a graceful panel fallback for unavailable anchors.
- Progress is account-scoped and server-synchronized with Not started/In progress/Done, resumable steps, New badges, Skip for now, and Hide completed behavior.
- Per-screen Help and checklist launch paths use the same content registry and guide state.
- `onboarded_at` remains only the legacy first-run introduction marker.
- Desktop, mobile web, and native achieve the same functional outcome using adaptive presentation.
- Reduced motion is respected.
- Required automated gates pass and the manual walkthrough is driven at 1400 px, 1000 px, and 390 px before Sol declares PASS.
