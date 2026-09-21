# Web/Native Parity Issue Ledger

Date: 2026-09-15

Audit mode: static, layered, dirty-worktree-aware

Decision: **PASS for audit synthesis; BLOCK for claiming product parity**

## Scope and architecture brief

TrustFlow should preserve the same user capability, authorization, data semantics, and business invariants across web and native. Presentation is allowed—and often required—to diverge:

- desktop command palette -> native searchable action sheet;
- desktop nav rail/top bar -> native drawer, tab, or direct screen;
- hover menu/tooltip -> explicit popup or long-press hint (never the only carrier of required information);
- keyboard shortcut -> visible touch action;
- drag/drop -> tap/long-press selection plus picker or move sheet;
- dense table -> stacked cards or `MultiViewList` details cards;
- desktop sidebar/modal -> bottom sheet with stacked sections or drill-in pages;
- browser file input/download/clipboard -> native document picker, share sheet, import flow, or explicit unsupported state.

The intended boundary is:

1. canonical contracts and selectors define scope, ordering, permissions, and allowed actions;
2. shared hooks/services own fetching and mutations;
3. thin platform adapters own browser/native APIs;
4. web and native renderers own only presentation and interaction adaptation.

The current codebase follows this boundary in several places (`UploadManagerContext`, `usePortfolioFlowData`, `MultiViewList`, project move RPCs), but the issues below are confirmed static violations or capability gaps.

## Priority summary

No P0 is supported by current evidence. `/deadlines` is not the only attention workflow: notifications, uploads, pending time approvals, FileHub inbox, and dashboard/My Work surfaces remain available. Six P1 clusters block a parity claim:

1. `/deadlines` has no genuine web implementation.
2. The adaptive deadlines product does not yet replace the attention ribbon at sufficient quality.
3. Deadline scope/window/grouping semantics disagree by entity and presentation.
4. Native report generation exposes an adapter that always throws after creating a job.
5. File preview/navigation overlays bypass the required popup/sheet architecture.
6. Native upload composition can make its primary action unreachable.

## Contract and data layer

### WNP-001 — P1 — Deadline scope and look-ahead contract is inconsistent

- Classification: accidental drift.
- Evidence: `hooks/useUpcomingTasks.ts:71-116`, `hooks/useUpcomingTasks.ts:151-164`, `hooks/useUpcomingTasks.ts:334-340`, `lib/deadlineStrata.ts:133-146`.
- Impact: the configured 3-day/1-week/2-week/1-month window is applied to tasks but not projects; tasks are narrowed to “mine,” while projects are broadly accessible. One list therefore mixes different time and ownership semantics.
- Intentional/false-positive note: company-wide project attention may be intentional, but it must be explicit and separately labeled; the current shared window control implies one contract.
- Exact layer recommendation: define an `AttentionScope` and date-window contract in the pure deadline domain model. Apply it consistently to both entity readers, or return separately labeled `myTasks` and `visibleProjects` groups.
- Missing tests: task/project window boundaries, ownership/visibility matrix, projects with start-only/due-only/no dates.

### WNP-002 — P1 — Deadline selection truncates heterogeneous groups incorrectly

- Classification: accidental drift.
- Evidence: `components/tabs/_deadlines_adaptive.tsx:47-70`, `lib/deadlineStrata.ts:149-176`, `components/sidebar/timeline/TimelineDropdown.web.tsx:85-111`.
- Impact: the adaptive surface mixes tasks and projects, sorts them, then caps the combined list at ten. A large overdue task backlog can hide the next upcoming task and all project deadlines; web applies different caps and rendering.
- Intentional/false-positive note: showing all overdue work and limiting mobile density are both valid. A second combined cap that destroys those semantics is not.
- Exact layer recommendation: extract one pure selector returning explicit `overdue`, `today`, `next`, `later`, and `projects` groups with independent caps and total counts. All ribbon, web, native, and widget renderers consume this model.
- Missing tests: overdue backlog plus upcoming items, mixed task/project caps, stable ordering, cross-renderer selector parity.

### WNP-003 — P1 — Onboarding ready-state handoff can be pre-empted by root routing

- Classification: accidental orchestration drift; current dirty-worktree risk.
- Evidence: `app/_layout.tsx:143-160`, `app/_layout.web.tsx:126-128`, `app/onboarding.tsx:173-175`, `app/onboarding.web.tsx:173-175`.
- Impact: refreshing the profile after workspace creation can make the root layout redirect away from `/onboarding` before `WorkspaceReadyStep`, checklist loading, starter-template browsing, or the explicit Continue action is completed.
- Intentional/false-positive note: redirecting an already-onboarded user is correct; redirecting during the completion handoff is not. Isolated onboarding tests mock the refresh and do not mount the root layout.
- Exact layer recommendation: introduce a shared onboarding completion/handoff state consumed by both root layouts. Defer the redirect until the ready screen’s explicit Continue action.
- Missing tests: integrated root-layout + onboarding test on web and native with profile transition and persisted/reloaded completion state.

## Shared logic layer

### WNP-004 — P2 — Deadline presentation layers re-derive business semantics

- Classification: accidental duplication.
- Evidence: `components/tabs/_deadlines_adaptive.tsx:47-70`, `components/sidebar/timeline/TimelineDropdown.web.tsx:33-42`, `components/sidebar/timeline/TimelineDropdown.web.tsx:85-111`, `hooks/useUpcomingTasks.ts:305-383`.
- Impact: subtitles, caps, project handling, grouping, and actions can drift even though transport/realtime logic is shared.
- Exact layer recommendation: put the canonical attention item/group/next-action model in a pure `lib/deadlines` module; retain Supabase, polling, and realtime orchestration in `useUpcomingTasks`; renderers only map model fields to UI.
- Missing tests: pure model tests for ordering, labels, group counts, action eligibility, and presentation-neutral output.

### WNP-005 — P2 — Desktop pipeline creation duplicates the shared/native workflow

- Classification: accidental logic drift; current dirty-worktree risk.
- Evidence: `app/admin/pipelines.web.tsx:52-56`, `app/admin/pipelines.web.tsx:351-413`, `components/pipeline-editor/PipelineList.tsx:14-65`, `components/pipeline-editor/PipelineList.tsx:117-129`.
- Impact: desktop creation can bypass plan limits and omit visibility, task-visibility, subject-kind, catalog-RPC, refresh, and error semantics owned by the shared flow.
- Intentional/false-positive note: a distinct desktop list/editor layout is appropriate; a second creation controller is not.
- Exact layer recommendation: extract/reuse one creation controller and form model while keeping divergent desktop/native render trees.
- Missing tests: plan-limit, catalog failure, custom settings, successful selection/refresh parity.

### WNP-006 — P2 — Native menu duplicates shortcut permission policy

- Classification: accidental authorization/chrome drift.
- Evidence: `components/sidebar/constants.ts:319-337`, `app/(tabs)/menu.tsx:55-67`.
- Impact: native unconditionally exposes FileHub and can diverge on owner-only or permission-gated destinations. Backend authorization may still reject access, but the navigation contract is inconsistent.
- Intentional/false-positive note: Search and Deadlines being native-visible is a valid replacement for desktop top-bar affordances.
- Exact layer recommendation: reuse or extend the canonical `shortcutVisible` predicate with explicit platform context; do not maintain a second permission expression.
- Missing tests: native menu matrix for ordinary user, owner, FileHub, role, pipeline, and analytics permissions.

### WNP-007 — P2 — Quick-create capabilities lack one shared action registry

- Classification: accidental registry drift.
- Evidence: `components/navigation/QuickCreateButton.tsx:80-96`, `components/sidebar/search/CommandPalette.web.tsx:377-389`, `components/navigation/WebMobileNav.tsx:231-338`.
- Impact: native exposes Task/Report/Upload/Search/Deadlines, desktop web exposes a different create set, and mobile web has no visible quick-create entry point.
- Intentional/false-positive note: palette versus FAB/sheet is the correct adaptation; independently defined capabilities are not.
- Exact layer recommendation: create a shared, permissioned action registry and dispatcher. Render it as desktop palette tiles, a native searchable action sheet/FAB, and a mobile-web sheet/button.
- Missing tests: registry completeness, permission filtering, dispatch targets, and 390px touch reachability.

### WNP-008 — P2 — Analytics audit/funnel data is not shared across presentations

- Classification: accidental extraction gap.
- Evidence: `components/intelligence/_analytics_desktop.tsx:161-192`, `components/intelligence/_analytics_desktop.tsx:273-274`, `components/intelligence/_analytics_adaptive.tsx:192-230`.
- Impact: entitled native/narrow-web users lose conversion-funnel analytics, despite an adaptive/native rendering pattern existing elsewhere.
- Exact layer recommendation: move audit/funnel loading into shared analytics logic and render via web Recharts versus native SVG/cards.
- Missing tests: plan-entitled data parity and adaptive loading/empty/error/data states.

## Platform adapter layer

### WNP-009 — P1 — Native report generation creates a job then calls an always-throwing adapter

- Classification: accidental exposed capability.
- Evidence: `components/intelligence/_ReportGenerator_adaptive.tsx:261-305`, `components/intelligence/_ReportGenerator_adaptive.tsx:486-499`, `components/intelligence/reports/generate.native.ts:3-11`.
- Impact: native “Execute Generation” can create a report job and then fail deterministically, leaving a pending/orphaned job.
- Intentional/false-positive note: client-side native PDF generation may intentionally be unsupported; exposing the action and creating the job is not acceptable adaptation.
- Exact layer recommendation: prefer server-side generation behind a shared job API and native share/open adapter. Until available, gate the capability before `rpc_request_report` and show an explicit unsupported state.
- Missing tests: unsupported native path creates no job; supported path shares/opens the generated artifact.

### WNP-010 — P1 — File preview and mobile-web navigation bypass Popup/DraggableSheet

- Classification: intentional presentations implemented with unsuitable primitives.
- Evidence: `components/common/FilePreview.tsx:5`, `components/common/FilePreview.tsx:474-479`, `components/intelligence/_filehub_adaptive.tsx:750-763`, `components/navigation/WebMobileNav.tsx:12`, `components/navigation/WebMobileNav.tsx:215-340`.
- Impact: raw RN `Modal` bypasses the repository’s required overlay contract, risking inconsistent dismissal, back behavior, sizing, scroll, and mobile-web behavior.
- Intentional/false-positive note: full-screen drawer and immersive preview are valid native/mobile adaptations; only the shell is wrong.
- Exact layer recommendation: route overlays through `Popup`/`DraggableSheet`; keep platform-specific preview and drawer content inside the shared shell.
- Missing tests: native back/dismiss, 390px mobile web, route-change cleanup, preview rotation/scroll.

### WNP-011 — P2 — Web DraggableSheet velocity calculation cannot detect a flick

- Classification: accidental adapter defect.
- Evidence: `components/common/DraggableSheet.web.tsx:67`, `components/common/DraggableSheet.web.tsx:88-110`.
- Impact: `dragCurrentY` is updated on pointer move and compared to the same final coordinate on pointer up, making computed velocity effectively zero. Short fast downward flicks cannot trigger velocity dismissal.
- Intentional/false-positive note: pointer dragging itself is an undocumented intentional web enhancement; distance dismissal still works.
- Exact layer recommendation: keep velocity tracking in the web gesture adapter using previous position/time samples; share only dismissal thresholds.
- Missing tests: fast-short flick, slow-long drag, snap-back, nested scrolling, pointer cancel.

### WNP-012 — P2 — Async signed-URL opening risks browser popup blocking

- Classification: accidental web API sequencing risk; runtime confirmation pending.
- Evidence: `lib/storage.ts:39`, `lib/storage.ts:153-169`.
- Impact: `window.open()` occurs after awaiting signed URL creation, outside the direct user gesture in browsers that enforce popup blocking.
- Exact layer recommendation: synchronously open a placeholder window from the click adapter and assign the signed URL after resolution, or prefetch signed URLs. Preserve native Linking/share behavior.
- Missing tests: Chrome/Safari private-file open, blocked-popup fallback, legacy public URL.

### WNP-013 — P2 — Web push permission is requested without an explicit user gesture

- Classification: unsuitable intentional automation.
- Evidence: `hooks/usePushAutoSubscribe.web.ts:17-35`.
- Impact: browsers may suppress or reject notification permission prompts during login/mount, making push subscription unreliable.
- Exact layer recommendation: auto-reconcile only when permission is already granted; request permission from an explicit banner/settings action.
- Missing tests: mount never prompts; explicit action prompts and persists subscription.

## Native adaptation layer

### WNP-014 — P1 — Adaptive deadlines is not a product-quality ribbon replacement

- Classification: intentional replacement strategy, insufficient execution.
- Evidence: `components/sidebar/timeline/TimelineStrip.web.tsx:13-27`, `components/sidebar/timeline/TimelineStrip.web.tsx:124-140`, `components/sidebar/timeline/TimelineDropdown.web.tsx:240-323`, `components/tabs/_deadlines_adaptive.tsx:47-70`.
- Impact: the ribbon is an ambient indicator, while the adaptive screen is a capped calendar/list without robust priority groups, context, status, ownership, or one-step next actions. Removing the ribbon in favor of this surface would regress attention handling.
- Exact layer recommendation: keep the native presentation touch-first: grouped Overdue/Today/Next/Later sections, project/task identity and context, owner/state, and one permitted next action per item. Use stacked cards and day-detail sheets, not a dense desktop table.
- Missing tests: grouping, permission-aware actions, empty/loading/error, large overdue backlog, accessibility, native device walkthrough.

### WNP-015 — P2 — Native deadline month grid omits projects

- Classification: accidental capability drift.
- Evidence: `components/tabs/_deadlines_adaptive.tsx:75-109`, `components/tabs/_deadlines_adaptive.tsx:154-187`, `components/calendar/CalendarOverlay.web.tsx:213-227`, `components/calendar/CalendarOverlay.web.tsx:542-548`.
- Impact: a native month can appear clear even when project deadlines exist; projects appear only in the capped upcoming list.
- Exact layer recommendation: load month-bounded projects through shared deadline logic and render distinct project chips that route to `/projects/[id]`.
- Missing tests: project appears on date, routes correctly, and remains visually distinct from tasks.

### WNP-016 — P2 — Native `+N more` deadline overflow is not actionable

- Classification: adaptation gap.
- Evidence: `components/tabs/_deadlines_adaptive.tsx:154-187`.
- Impact: density is reduced appropriately, but hidden items cannot be inspected from the day cell and may also be absent from the globally capped upcoming list.
- Exact layer recommendation: make `+N more` open a day-detail bottom sheet listing all task/project deadlines. A tooltip alone is insufficient for required information.
- Missing tests: accessible overflow action, complete item list, correct routes.

### WNP-017 — P1 — Native upload composer can make the primary action unreachable

- Classification: accidental layout defect; current dirty-worktree risk.
- Evidence: `components/filehub/UploadComposerModal.tsx:4`, `components/filehub/UploadComposerModal.tsx:293-373`.
- Impact: `Popup` is non-scrollable, the body is unbounded, and staged files render one row each. Short viewports, keyboards, or many files can push metadata and Start Upload outside the sheet.
- Exact layer recommendation: retain `UploadManagerContext` and `Popup`, but use a bounded scrolling body and pinned footer; native intake remains document picker/share/import rather than browser drag/drop.
- Missing tests: many files, keyboard open, short device, 390px mobile web.

### WNP-018 — P2 — Long-press project selection can be undone by release press

- Classification: accidental gesture defect; current dirty-worktree risk.
- Evidence: `components/projects/ProjectsTable.tsx:555-556`, `components/projects/ProjectsTable.tsx:658-659`, `components/projects/ProjectBoard.tsx:169-181`, `components/common/MultiViewList.tsx:130-136`, `components/common/MultiViewList.tsx:543-544`.
- Impact: long-press enters selection, then the following press can toggle the same item off.
- Exact layer recommendation: consume/suppress the press following a recognized long-press in the touch adapter; retain modifier-click on web.
- Missing tests: long-press and release leaves exactly one selected item in table, card, and board modes.

### WNP-019 — P2 — Personnel analytics lacks native sort and export/share replacements

- Classification: intentional table-to-card adaptation with missing capabilities.
- Evidence: `components/intelligence/_analytics_desktop.tsx:313-346`, `components/intelligence/_analytics_desktop.tsx:368-428`, `components/intelligence/_analytics_desktop.tsx:730`, `components/intelligence/_analytics_adaptive.tsx:297-318`, `components/intelligence/_analytics_adaptive.tsx:386-456`.
- Impact: cards appropriately replace a dense table, but native loses result sorting, selected-person persistence, and export.
- Exact layer recommendation: keep stacked cards; add a compact sort picker and export through a shared serializer plus native share sheet.
- Missing tests: sort order, persistence, CSV/content parity, share cancellation/error.

### WNP-020 — P2 — Mobile-web Tooltip has no touch discovery path

- Classification: accidental platform gap.
- Evidence: `components/common/Tooltip.web.tsx:84-96`.
- Impact: hover/focus works on desktop, but 390px touch users cannot reliably discover tooltip-only hints.
- Exact layer recommendation: add a mobile-web long-press adapter for optional hints; use explicit popup/sheet content whenever information is required to complete a task.
- Missing tests: desktop hover/focus and 390px touch-hold/dismiss.

### WNP-021 — P2 — Shared sheet/calendar controls miss native touch and accessibility requirements

- Classification: accidental ergonomics gap.
- Evidence: `components/common/DraggableSheet.tsx:114-116`, `components/common/DraggableSheet.web.tsx:130-132`, `components/common/Calendar.tsx:69-84`, `components/common/Calendar.tsx:229-247`.
- Impact: close and calendar controls can fall below the 44px touch target; month navigation lacks meaningful accessibility labels.
- Exact layer recommendation: enlarge hit slop/targets while preserving icon size; label previous/next month and quick actions.
- Missing tests: native accessibility tree and minimum hit-target assertions.

### WNP-022 — P2 — Several animations ignore reduced-motion preference

- Classification: accidental accessibility drift.
- Evidence: `components/task-detail/StageActions.tsx:77-92`, `components/pipeline-editor/graph/ConnectionLines.tsx:45-53`, `components/tabs/_tasks_adaptive.tsx:168-179`, `components/pipeline-editor/graph/GraphCanvas.tsx:188-189`.
- Impact: decorative loops and springs continue with OS Reduce Motion enabled.
- Exact layer recommendation: keep existing animation systems; gate one-shot animations to final values and render loops as static states through `useReducedMotion()`.
- Missing tests: reduced-motion behavior and a source check for new loops/springs.

## Web UI layer

### WNP-023 — P1 — `/deadlines` has no genuine web screen

- Classification: accidental implementation parity gap.
- Evidence: `app/(tabs)/deadlines.tsx:1`, `app/_layout.web.tsx:133-165`.
- Impact: web resolves to the RN-oriented adaptive screen, which may render but does not provide a desktop-quality attention workspace.
- Intentional/false-positive note: shared RN Web compatibility is not equivalent to product parity.
- Exact layer recommendation: add a web route/component backed by the canonical deadline model. Desktop should use a split calendar/worklist or grouped dense list with keyboard navigation; mobile web must collapse to sheets/cards at <768px.
- Missing tests: platform-resolution, keyboard/focus, desktop ~1400px, columns ~1000px, mobile web 390px.

### WNP-024 — P1 — The attention ribbon is an entry point, not a canonical workflow

- Classification: intentional web affordance incorrectly carrying product responsibility.
- Evidence: `components/sidebar/timeline/TimelineStrip.web.tsx:13-27`, `components/sidebar/timeline/TimelineStrip.web.tsx:124-140`, `components/sidebar/timeline/TimelineDropdown.web.tsx:240-323`.
- Impact: the eight-pixel strip and dropdown communicate urgency but do not expose sufficient context, grouping, state, ownership, or next action to serve as the full deadlines workflow.
- Exact layer recommendation: retain the ribbon as a peripheral launcher until the web deadlines workspace proves replacement quality; do not delete it solely because `/deadlines` exists.
- Missing tests: ribbon-to-workspace navigation, semantic equivalence of counts/groups, and migration/retirement acceptance criteria.

### WNP-025 — P2 — Mobile web lacks a visible quick-create/action entry point

- Classification: accidental capability omission.
- Evidence: `components/navigation/WebMobileNav.tsx:231-338`, compared with `components/navigation/QuickCreateButton.tsx:80-96` and `components/sidebar/search/CommandPalette.web.tsx:377-389`.
- Impact: keyboard palette is a desktop paradigm; mobile-web touch users receive navigation but no equivalent action launcher.
- Exact layer recommendation: render the shared action registry in a searchable bottom sheet launched from mobile web chrome.
- Missing tests: 390px discoverability, action permission filtering, sheet drill-in, keyboard avoidance.

### WNP-028 — P3 — New project selection controls bypass semantic interaction tokens

- Classification: accidental presentation drift; current dirty-worktree risk.
- Evidence: `components/projects/ProjectsTable.tsx:127`, `components/projects/ProjectsTable.tsx:370-372`, `components/projects/ProjectBoard.tsx:125`, `components/projects/ProjectBoard.tsx:458-459`.
- Impact: `text-white` and opacity-based state feedback can diverge across themes and platforms, contrary to the semantic-token interaction contract.
- Intentional/false-positive note: white-on-danger may be visually intended; the issue is encoding it as a raw color/opacity choice rather than the existing semantic on-color and disabled-state tokens.
- Exact layer recommendation: keep the controls local and replace raw color/opacity states with existing semantic interaction tokens; do not create a new component abstraction.
- Missing tests: theme token/source check for selection and bulk-action states.

## Verification layer

### WNP-026 — P2 — Platform routing and interaction adapters lack integration coverage

- Classification: accidental verification gap.
- Evidence: `components/Sidebar.web.tsx:122-140`, `components/common/Tooltip.tsx:41-79`, `components/common/Tooltip.web.tsx:74-100`, `components/common/MultiViewList.tsx:34-36`, `lib/webModifierKeys.ts:16-35`; current tests mostly cover pure parsing/placement or mocked RN primitives.
- Impact: route resolution, real DOM keyboard events, modifier selection, touch long-press, portals, and native adapters can drift while source-level checks pass.
- Exact layer recommendation: add thin real-browser and native-renderer adapter suites around shared APIs; retain pure selector tests for business semantics.
- Missing tests: Ctrl/Cmd+K and Ctrl+F registration/cleanup, tooltip hover/focus/long-press, Ctrl/Cmd/Shift selection, native long-press, route platform resolution.

### WNP-027 — P2 — Cross-platform UI acceptance is not behaviorally verified

- Classification: known verification gap, not a runtime defect.
- Evidence: this audit was static. Reviewer attempts at selected Vitest/source checks encountered `EPERM` temporary-directory and `ENOMEM` failures; no browser or native device flow was driven.
- Impact: confirmed source defects remain valid, but visual ergonomics and runtime interactions are unproven.
- Exact layer recommendation: after fixes, run deterministic agent verification, targeted unit/integration tests, then manual flows at ~1400px, ~1000px, 390px mobile web, and at least one native phone/emulator with reduced motion and screen reader spot checks.
- Missing tests: all behavior noted above; do not close parity issues on diff review alone.

## Confirmed intentional adaptations that should remain

- Project/task board drag/drop is web-only; native tap-to-move through stage picker is correct.
- Dense project tables become stacked cards or one-stage-at-a-time boards on native.
- Portfolio analytics correctly shares `usePortfolioFlowData` while using web Recharts and native SVG renderers.
- Browser file drop, folder drop, smart paste, and Blob download should not be copied to native; use document picker, share/import, and explicit unsupported states.
- Desktop command palette and keyboard shortcuts should remain web-specific once every command has a visible touch equivalent.
- Desktop two-pane task/project/template layouts may diverge into stacked sheets or drill-in pages while sharing state and mutations.
- `UploadManagerContext` remains the sole upload path; no second native uploader should be introduced.

## Dirty-worktree note

The worktree was already substantially dirty. Current changes appear to include a parity pass around upload dispatch, FileHub selection/inspectors, project/task bulk selection, onboarding, and quick-create. Findings WNP-003, WNP-005, WNP-007, WNP-017, and WNP-018 intersect dirty files and must be reconciled with that in-progress work rather than “fixed” by reverting it. This audit did not attribute unrelated dirty changes to the audit and did not alter existing files.

## Recommended next audit wave

1. **Deadlines contract workshop and selector proof:** decide personal versus company scope, explicit groups, caps, and next-action policy; lock with pure tests before UI work.
2. **Deadlines dual-surface review:** prototype the desktop workspace and touch-native grouped screen against the same fixture; verify at 1400/1000/390px and native.
3. **Destructive side-effect adapters:** report generation job lifecycle, browser signed-URL opening, push permission prompting, and native share/export.
4. **Overlay and gesture migration:** raw Modal inventory, sheet scrolling/dismissal, long-press suppression, touch targets, and reduced motion.
5. **Auth/onboarding/admin follow-up:** the dedicated Luna lane hit model-capacity limits; perform a fresh bounded audit of notifications/admin/platform-admin beyond the route and onboarding findings already captured.
6. **Dirty-diff parity review:** repeat after the current parity work stabilizes; run tests without updating snapshots and compare Git status to the pre-audit baseline.

## Final review decision

- **PASS:** the requested layered audit and issue ledger are sufficiently evidenced for planning.
- **BLOCK:** TrustFlow cannot claim web/native parity, cannot retire the topbar attention ribbon, and cannot call `/deadlines` its replacement until WNP-001, WNP-002, WNP-014, WNP-023, and WNP-024 are resolved and behaviorally verified.
- **BLOCK:** native report generation should not remain exposed in its current form (WNP-009).
- **Verification caveat:** no browser or native execution was performed; static evidence and line-level inspection only.
