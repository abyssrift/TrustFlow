# Contextual Guide Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `WelcomeTour` with an account-synced, access-aware To Do checklist that launches six registry-backed contextual guides with adaptive coach marks and panel fallback.

**Architecture:** A static content registry defines guide routes, versions, steps, and semantic anchors. Existing navigation visibility filters the registry; a root provider coordinates routing, anchors, UI, and one active guide. Supabase stores one row per account/guide through authenticated RPCs so New/status/current-step completion follows the user across devices.

**Tech Stack:** Expo Router, React Native/React Native Web, TypeScript, Supabase/Postgres RLS, Vitest, React Test Renderer, NativeWind, existing `Popup`, `positionTooltip`, and `AuthContext`.

## Global Constraints

- Preserve every pre-existing dirty change; edit only assigned files and patch around user-owned work.
- Do not commit. The user explicitly withheld commit authorization.
- Sol owns architecture, integration order, complete-diff review, verification, and final PASS/BLOCK.
- Luna/medium workers implement bounded packages sequentially with disjoint file ownership and concise reports.
- One content registry supplies checklist rows, per-screen Help, and active-guide copy.
- Eligibility mirrors existing navigation/route visibility; never expose raw permission keys or create role buckets.
- Phase 1 contains six examples: Profile, Top Bar, Tasks, File Hub, Team & People, Workflow & Pipelines.
- Each guide has no more than two coach marks and remains completable through panel fallback.
- Progress is account-scoped and server-synchronized: New, Not started, In progress, Done, resumable current step, and Skip for now (never Done).
- Newly eligible guides show New without auto-opening. `onboarded_at` controls only the legacy first-run checklist introduction.
- `Popup presentation="auto"` is the checklist/guide container; no raw React Native `Modal`.
- Desktop and mobile use Path B adaptive presentation. Every touch target is at least 44×44 px.
- Motion uses only existing systems and respects `useReducedMotion()`.
- Do not claim end-to-end verification unless flows are driven at approximately 1400 px, 1000 px, and 390 px.

## File Structure

**Create**

- `supabase/migrations/20260920110000_user_guide_progress.sql` — table, RLS, grants, sync/read RPC, update RPC.
- `supabase/checks/check_user_guide_progress.sql` — transactional schema, RPC, transition, and isolation checks.
- `lib/contextualGuides.ts` — IDs, definitions, registry, eligibility, and pure progress selectors.
- `lib/contextualGuides.test.ts` — registry/eligibility/state semantics.
- `hooks/useGuideProgress.ts` — Supabase adapter and account progress hydration/writes.
- `hooks/useGuideProgress.test.ts` — adapter tests with injected RPC client.
- `contexts/ContextualGuideContext.tsx` — one active guide, route handoff, anchor registration, checklist state.
- `contexts/ContextualGuideContext.test.tsx` — provider lifecycle tests.
- `components/guides/GuideAnchor.tsx` — semantic target registration wrapper.
- `components/guides/GuideChecklist.tsx` — To Do Popup/sheet and rows.
- `components/guides/GuideCoachMark.tsx` — native/mobile panel and optional target highlight.
- `components/guides/GuideCoachMark.web.tsx` — desktop anchored callout/spotlight with panel fallback.
- `components/guides/GuideHelpButton.tsx` — per-screen launcher using registry IDs.
- `components/guides/GuideHost.tsx` — checklist trigger and active presentation.
- `components/guides/GuideHost.test.tsx` — checklist/QOL/panel-fallback tests.

**Modify**

- `components/sidebar/constants.ts` — export stable shortcut lookup/visibility reuse for guide eligibility.
- `app/_layout.tsx`, `app/_layout.web.tsx` — mount the single provider/host.
- `components/onboarding/WelcomeTour.tsx` — remove legacy tour UI or reduce it to the approved first-run checklist handoff.
- `app/(tabs)/profile.tsx`, `components/sidebar/ProfilePill.web.tsx` — Profile guide anchor/Help.
- `components/sidebar/TopBar.web.tsx`, `components/sidebar/TopBarPullTab.web.tsx`, `components/island/DynamicIsland.web.tsx` — Top Bar anchors/Help.
- `components/tabs/_tasks_desktop.tsx`, `components/tabs/_tasks_adaptive.tsx` — Tasks anchors/Help.
- `components/intelligence/_filehub_desktop.tsx`, `components/intelligence/_filehub_adaptive.tsx` — File Hub anchors/Help.
- `app/(tabs)/people.tsx`, `components/admin/TeamAssignmentGrid.tsx` — Team & People anchors/Help.
- `app/admin/pipelines.tsx`, `app/admin/pipelines.web.tsx` — Workflow & Pipelines anchors/Help.

---

### Task 1: Account-scoped progress persistence

**Files:**
- Create: `supabase/migrations/20260920110000_user_guide_progress.sql`
- Create: `supabase/checks/check_user_guide_progress.sql`

**Interfaces:**
- Produces `public.user_guide_progress` keyed by `(user_id, guide_id)`.
- Produces `rpc_sync_user_guide_progress(p_guides jsonb)` returning current user's rows after discovering/resetting eligible guide versions.
- Produces `rpc_update_user_guide_progress(p_guide_id text, p_guide_version integer, p_status text, p_current_step integer, p_acknowledge boolean)` returning the updated row.

- [ ] **Step 1: Write the failing SQL check**

Cover: table/constraints, authenticated-only grants, own-row SELECT RLS, no direct writes, RPC ownership from `auth.uid()`, first discovery, idempotent sync, version reset, New acknowledgement, current-step writes, Done timestamps, invalid status/negative step rejection, and cross-user isolation. Use `BEGIN`/`ROLLBACK` and the same JWT-claim setup as `check_user_onboarding_drafts.sql`.

- [ ] **Step 2: Run the check and confirm it fails because objects do not exist**

Run with the repository's local Docker `psql -v ON_ERROR_STOP=1` pattern for SQL checks.

Expected: failure naming `user_guide_progress` or one of the two RPCs as missing.

- [ ] **Step 3: Implement the migration**

Required table contract:

```sql
create table public.user_guide_progress (
  user_id uuid not null references public.users(id) on delete cascade,
  guide_id text not null check (guide_id = btrim(guide_id) and guide_id <> ''),
  guide_version integer not null check (guide_version > 0),
  status text not null check (status in ('not_started', 'in_progress', 'done')),
  current_step integer not null default 0 check (current_step >= 0),
  first_eligible_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, guide_id),
  check ((status = 'done' and completed_at is not null) or status <> 'done')
);
```

Enable RLS; grant authenticated SELECT only; create own-row SELECT policy using `(select auth.uid()) = user_id`; revoke direct INSERT/UPDATE/DELETE. Both RPCs are `SECURITY DEFINER`, set `search_path = public`, reject null `auth.uid()`, derive the owner server-side, revoke `PUBLIC`/`anon`, and grant only `authenticated`.

`rpc_sync_user_guide_progress` accepts an array of `{guide_id, guide_version}`. Missing rows become Not started/New. A higher requested version resets only that guide to version/current step 0/Not started/fresh eligibility/unacknowledged. Equal versions preserve progress. Lower versions never downgrade.

`rpc_update_user_guide_progress` rejects invalid status/step/version, requires the current stored version, preserves `first_eligible_at`, sets `acknowledged_at` when requested, sets `completed_at` only for Done, and returns the row.

- [ ] **Step 4: Run SQL verification**

Expected: the new SQL check prints its PASS marker and rolls back; `node supabase/checks/migration_drift.js` reports no new drift when the local stack is available.

---

### Task 2: Registry, visibility, and progress adapter

**Files:**
- Create: `lib/contextualGuides.ts`
- Create: `lib/contextualGuides.test.ts`
- Create: `hooks/useGuideProgress.ts`
- Create: `hooks/useGuideProgress.test.ts`
- Modify: `components/sidebar/constants.ts`

**Interfaces:**

```ts
export type GuideId = 'profile' | 'top-bar' | 'tasks' | 'filehub' | 'team-people' | 'workflow-pipelines';
export type GuideStatus = 'not_started' | 'in_progress' | 'done';
export type GuideAnchorId = `${GuideId}:${string}`;
export type GuideStep = { id: string; title: string; body: string; anchorId?: GuideAnchorId };
export type GuideDefinition = {
  id: GuideId;
  version: number;
  title: string;
  summary: string;
  route: string;
  shortcutId?: 'tasks' | 'filehub' | 'team' | 'pipelines-admin';
  steps: readonly [GuideStep] | readonly [GuideStep, GuideStep];
};
export type GuideProgress = {
  guideId: GuideId;
  guideVersion: number;
  status: GuideStatus;
  currentStep: number;
  firstEligibleAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};
```

`GUIDE_REGISTRY` contains the six approved definitions and their single source of copy. Export `eligibleGuides(ctx)`; universal entries always pass after auth readiness, and surface entries call the existing `shortcutVisible` through a stable `getShortcut(id)` export.

`useGuideProgress(eligibleDefinitions)` returns:

```ts
{
  progressById: Partial<Record<GuideId, GuideProgress>>;
  loading: boolean;
  error: string | null;
  retry(): Promise<void>;
  start(id: GuideId): Promise<GuideProgress>;
  saveStep(id: GuideId, step: number): Promise<GuideProgress>;
  skip(id: GuideId): Promise<GuideProgress>;
  complete(id: GuideId): Promise<GuideProgress>;
}
```

- [ ] **Step 1: Write failing pure tests**

Test six IDs/versions, maximum two steps, no raw permission-like copy, universal eligibility, shortcut-driven eligibility, access expansion adding rows, access loss hiding rows without deleting supplied progress, status labels, New derivation, and current-step clamping.

- [ ] **Step 2: Write failing adapter tests**

Inject an RPC client with `rpc(name, args)`. Verify sync payloads, snake_case parsing, account switch reset, Start -> In progress/acknowledged, saveStep resume, Skip preserving status/step, Complete -> Done, and rejected writes preserving prior UI state.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npx vitest run lib/contextualGuides.test.ts hooks/useGuideProgress.test.ts`

Expected: FAIL because modules/exports are absent.

- [ ] **Step 4: Implement the registry/selectors and adapter**

Use the signatures above. Do not place permission keys in `GUIDE_REGISTRY`; only `shortcutId` references are allowed. RPC names and arguments must exactly match Task 1.

- [ ] **Step 5: Re-run focused tests**

Expected: both files PASS.

---

### Task 3: Provider, checklist, anchors, and adaptive guide UI

**Files:**
- Create: `contexts/ContextualGuideContext.tsx`
- Create: `contexts/ContextualGuideContext.test.tsx`
- Create: `components/guides/GuideAnchor.tsx`
- Create: `components/guides/GuideChecklist.tsx`
- Create: `components/guides/GuideCoachMark.tsx`
- Create: `components/guides/GuideCoachMark.web.tsx`
- Create: `components/guides/GuideHelpButton.tsx`
- Create: `components/guides/GuideHost.tsx`
- Create: `components/guides/GuideHost.test.tsx`

**Interfaces:**

```ts
export type GuideAnchorHandle = { measure(): Promise<{ x: number; y: number; width: number; height: number } | null> };
export function useContextualGuide(): {
  checklistVisible: boolean;
  openChecklist(): void;
  closeChecklist(): void;
  launchGuide(id: GuideId): Promise<void>;
  registerAnchor(id: GuideAnchorId, handle: GuideAnchorHandle): () => void;
  activeGuide: GuideDefinition | null;
  activeStep: number;
};
```

- [ ] **Step 1: Write failing provider/host tests**

Test one active guide, row route-and-launch, route readiness timeout -> panel fallback, New badge behavior, Not started/In progress/Done labels, Hide completed, Resume, Skip != Done, Replay, per-screen Help registry parity, access revocation cancellation, and progress-write error state.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run contexts/ContextualGuideContext.test.tsx components/guides/GuideHost.test.tsx`

Expected: FAIL because provider/components are absent.

- [ ] **Step 3: Implement provider and checklist**

Use `Popup presentation="auto" maxWidth={640}`. Rows use semantic tokens, 44 px minimum targets, Start/Resume/Replay actions, New badge, status, Hide completed toggle, and a retry state. Merely opening the checklist must not acknowledge New.

- [ ] **Step 4: Implement anchors and adaptive presentation**

`GuideAnchor` registers semantic IDs and measures through `measureInWindow`. Web uses `positionTooltip` for anchored placement and viewport clamping. Native/mobile keeps actions in the Popup sheet and treats highlighting as optional. Missing measurement immediately uses panel-only content. Any pulse uses existing utility animation and is removed when reduced motion is enabled.

- [ ] **Step 5: Run focused tests and Babel checks**

Run the two Vitest files, then `node scripts/babelcheck.mjs` for all Task 3 TSX files.

Expected: PASS.

---

### Task 4: Universal guide launchers and anchors

**Files:**
- Modify: `app/(tabs)/profile.tsx`
- Modify: `components/sidebar/ProfilePill.web.tsx`
- Modify: `components/sidebar/TopBar.web.tsx`
- Modify: `components/sidebar/TopBarPullTab.web.tsx`
- Modify: `components/island/DynamicIsland.web.tsx`
- Add focused tests/checks beside these files when no existing test seam covers the anchor contract.

**Interfaces:**
- Profile anchors: `profile:identity`.
- Top Bar anchors: `top-bar:navigation` and `top-bar:activity`.
- Per-screen Help calls `launchGuide('profile')` or `launchGuide('top-bar')`.

- [ ] **Step 1: Write failing anchor/Help checks**

Assert the semantic IDs and guide IDs are present in the intended surfaces and Help uses `GuideHelpButton`.

- [ ] **Step 2: Add minimal wrappers/buttons**

Wrap stable regions without changing their behavior or layout. Use panel fallback where a platform lacks a matching top-bar control.

- [ ] **Step 3: Run focused tests/checks and Babel parsing**

Expected: PASS with no layout or existing behavior changes.

---

### Task 5: Tasks and File Hub guide launchers and anchors

**Files:**
- Modify: `components/tabs/_tasks_desktop.tsx`
- Modify: `components/tabs/_tasks_adaptive.tsx`
- Modify: `components/intelligence/_filehub_desktop.tsx`
- Modify: `components/intelligence/_filehub_adaptive.tsx`

**Interfaces:**
- Tasks anchors: `tasks:board` and `tasks:move`.
- File Hub anchors: `filehub:navigation` and `filehub:primary-action`.
- Help IDs: `tasks`, `filehub`.

- [ ] **Step 1: Capture the current dirty diff for these four files**

Save `git diff -- <files>` to the task report before edits so the worker can prove existing changes were preserved.

- [ ] **Step 2: Write failing anchor parity checks**

Require desktop/adaptive variants to register the same IDs and expose the same guide ID.

- [ ] **Step 3: Add anchors and Help without restructuring screens**

Tasks movement anchors may be absent in empty boards; File Hub primary action may be access-hidden. Both conditions must fall back to panel content.

- [ ] **Step 4: Run targeted tests/checks and Babel parsing**

Expected: PASS; post-edit diff still contains all pre-existing hunks.

---

### Task 6: People and Pipelines guide launchers and anchors

**Files:**
- Modify: `app/(tabs)/people.tsx`
- Modify: `components/admin/TeamAssignmentGrid.tsx`
- Modify: `app/admin/pipelines.tsx`
- Modify: `app/admin/pipelines.web.tsx`

**Interfaces:**
- People anchors: `team-people:list` and `team-people:primary-action`.
- Pipeline anchors: `workflow-pipelines:list` and `workflow-pipelines:configuration`.
- Help IDs: `team-people`, `workflow-pipelines`.

- [ ] **Step 1: Capture the current dirty diff for overlapping files**

Preserve `TeamAssignmentGrid.tsx` and `pipelines.web.tsx` user changes exactly outside minimal guide insertions.

- [ ] **Step 2: Write failing anchor parity/visibility checks**

Require native/web variants to share semantic IDs. Verify Help is rendered only within already-authorized surfaces; it adds no new access test.

- [ ] **Step 3: Add anchors and Help**

Use stable screen/list regions and existing primary actions. Missing actions use panel fallback.

- [ ] **Step 4: Run focused tests/checks and Babel parsing**

Expected: PASS with pre-existing dirty hunks preserved.

---

### Task 7: Root integration, WelcomeTour absorption, and final verification

**Files:**
- Modify: `app/_layout.tsx`
- Modify: `app/_layout.web.tsx`
- Modify: `components/onboarding/WelcomeTour.tsx`
- Update: `docs/superpowers/specs/2026-09-20-contextual-guide-checklist-design.md` only if implementation revealed a factual interface correction.

**Interfaces:**
- Both roots mount one `ContextualGuideProvider` and one `GuideHost` for authenticated sessions.
- Null `profile.onboarded_at` opens only the checklist introduction; acknowledging/dismissing calls existing `rpc_complete_onboarding` with observed error handling.
- Newly eligible individual guides never auto-open.

- [ ] **Step 1: Write/adjust failing root lifecycle tests**

Cover null/populated `onboarded_at`, no display on auth/onboarding/share routes, RPC failure, manual checklist availability after onboarding, and no legacy generic step sequence.

- [ ] **Step 2: Replace duplicate root mounts with the single host contract**

Preserve all current onboarding redesign changes. Remove raw `Modal` usage from the legacy tour path.

- [ ] **Step 3: Run focused and repository verification**

Run:

```powershell
npx vitest run lib/contextualGuides.test.ts hooks/useGuideProgress.test.ts contexts/ContextualGuideContext.test.tsx components/guides/GuideHost.test.tsx tests/onboarding.test.tsx
node scripts/babelcheck.mjs <all changed TS/TSX files>
npm run verify:agent
graphify update .
```

Expected: focused tests PASS; agent verification PASS against the checked-in baseline; graph update completes without shrink/corruption warnings.

- [ ] **Step 4: Sol complete-diff review**

Sol inspects every changed file and surrounding code, checks all acceptance criteria, confirms user-owned dirty hunks remain, reviews SQL security and RPC grants, and resolves all Critical/Important findings through a narrowly scoped Luna correction.

- [ ] **Step 5: Drive the manual walkthrough**

At 1400 px, 1000 px, and 390 px verify checklist states, route-and-launch, panel fallback, New without popup, Skip != Done, resume after reload/account sync, Hide completed, per-screen Help parity, access expansion/revocation, reduced motion, and keyboard/touch behavior. Exercise native when available. If any environment cannot be run, report that gap and do not claim end-to-end verification.

---

## Implementation Assignment Order

Run Tasks 1–3 sequentially because their interfaces depend on one another. Then run Tasks 4, 5, and 6 as separate sequential Luna packages despite disjoint ownership, following the subagent-development review gate. Run Task 7 last. Each worker reads its extracted task brief, repository rules, and orchestration skill; each returns changed files, tests, failures, and risks. Sol reviews each task before releasing the next.

