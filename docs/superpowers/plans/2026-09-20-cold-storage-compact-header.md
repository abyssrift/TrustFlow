# Cold Storage Compact Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the initial Cold Storage page-level header/control footprint on desktop and mobile while preserving all archive behavior.

**Architecture:** Add a backward-compatible `density="compact"` option to the shared desktop `IntelligencePageHeader`; default callers remain unchanged. Cold Storage desktop and adaptive renderers separately compose their scope, search, filters, counts, selection, and list controls to remove redundant vertical rows while preserving the existing `MultiViewList`, archive state, permission checks, and domain handlers.

**Tech Stack:** React Native / React Native Web, NativeWind semantic tokens, React Testing Library/Vitest where already configured, repository `.check.ts` scripts, Metro Babel check, existing MultiViewList and FilterPanel primitives.

## Global Constraints

- Preserve existing archive permission checks, RPC usage, search/filter semantics, selection behavior, and destructive-action confirmations.
- Keep all existing `IntelligencePageHeader` callers visually unchanged unless they explicitly request compact density.
- Continue using `FilterPanel` and `MultiViewList`; do not duplicate their responsibilities.
- Use semantic design tokens; mobile interactive targets remain at least 44x44px.
- Implement and verify both desktop and adaptive/mobile paths; do not change global navigation or detail headers.
- Preserve unrelated dirty worktree changes. Stage only files owned by this task.

---

## File map

- Modify `components/intelligence/IntelligencePageHeader.tsx`: optional density contract; standard remains default.
- Create `components/intelligence/IntelligencePageHeader.test.tsx`: behavior/layout contract checks for standard and compact modes.
- Modify `components/intelligence/_archives_desktop.tsx`: opt into compact header and consolidate duplicate toolbar metadata.
- Create `components/intelligence/ArchiveDesktopCompactHeader.check.ts`: structural invariant check for desktop composition.
- Modify `components/intelligence/_archives_adaptive.tsx`: two-row compact mobile page header while retaining safe-area handling and touch targets.
- Create `components/intelligence/ArchiveAdaptiveCompactHeader.check.ts`: structural invariant check for adaptive composition.
- No backend, permission, database, global shell, or other screen changes are in this phase.

## Task 1: Add the backward-compatible compact header contract

**Files:**

- Modify: `components/intelligence/IntelligencePageHeader.tsx`
- Create: `components/intelligence/IntelligencePageHeader.test.tsx`

**Interface:**

```tsx
type IntelligencePageHeaderDensity = 'standard' | 'compact';

type IntelligencePageHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  density?: IntelligencePageHeaderDensity;
};
```

`density` defaults to `'standard'`. The standard branch must retain existing dimensions and layout. Compact mode places identity and right-side actions in one wrapping row, uses the existing title token at collection scale (`text-3xl`), and uses 20px top / 12px bottom resting padding. Keep the existing collapse provider and motion implementation; do not add another animation system.

- [ ] **Step 1: Add the standard-mode regression test first.** Render the header with no `density`, `eyebrow`, `title`, and `right`; assert it includes `text-4xl`, the full-width controls container, and the 32px/24px static padding floor (or test the extracted pure layout description if the current test environment cannot inspect native styles reliably).
- [ ] **Step 2: Run the new test and confirm the standard compatibility assertion passes against current behavior.** This is a characterization test; it should pass before implementation because standard is current behavior.
- [ ] **Step 3: Add the compact-mode expectation and verify it fails before implementation.** Assert `text-3xl`, compact resting padding, and a single row container that owns both identity and actions.

```powershell
npx vitest run components/intelligence/IntelligencePageHeader.test.tsx
```

- [ ] **Step 4: Implement the optional density prop.** Keep the existing standard markup/styles unchanged in the default branch. In compact mode, use a horizontal wrapping row, compact title class, and compact static/animated padding values. Preserve the safe static style floor and existing animated collapse styles.
- [ ] **Step 5: Rerun the test and confirm both standard and compact assertions pass.** Also run the existing Intelligence screen checks/tests discovered in the repository before moving to Task 2.

## Task 2: Compact the desktop Cold Storage composition

**Files:**

- Modify: `components/intelligence/_archives_desktop.tsx`
- Create: `components/intelligence/ArchiveDesktopCompactHeader.check.ts`

**Interfaces:** Consume `IntelligencePageHeader density="compact"` from Task 1. Continue consuming the same archive state and handlers already present in the renderer.

- [ ] **Step 1: Add the failing structural check.** Follow the existing `.check.ts` conventions and assert that the header opts into compact density; the page has one consolidated collection-toolbar region; the duplicate standalone count and category-summary rows are absent; and filter, search, loading, scope, selection, and purge controls remain connected.
- [ ] **Step 2: Run the check to establish RED.**

```powershell
npx tsx components/intelligence/ArchiveDesktopCompactHeader.check.ts
```

Expected: fail only on missing compact-density/consolidated-toolbar invariants.

- [ ] **Step 3: Opt into compact density and consolidate the desktop controls.** Keep company-scope, standard filter trigger, and refresh in the shared header's action slot. Collapse shown/total, category counts, and loading into one compact metadata row immediately above the collection; remove redundant standalone count/summary wrappers rather than removing their information. Leave the `MultiViewList` search/view-mode toolbar unchanged because it intentionally owns that toolbar and exposes no caller-owned leading/actions slot. Keep the purge-selection bar conditional and separate.
- [ ] **Step 4: Run the check to establish GREEN.**

```powershell
npx tsx components/intelligence/ArchiveDesktopCompactHeader.check.ts
```

- [ ] **Step 5: Verify archive/list regression checks.**

```powershell
npx vitest run lib/archivePresentation.test.ts hooks/useCollectionSelection.test.ts components/common/MultiViewList.test.tsx
```

## Task 3: Compact the adaptive/mobile Cold Storage composition

**Files:**

- Modify: `components/intelligence/_archives_adaptive.tsx`
- Create: `components/intelligence/ArchiveAdaptiveCompactHeader.check.ts`

**Layout contract:** Row 1 contains back action, compact title identity, and permission-gated scope. Row 2 contains search, filter, and refresh. Preserve safe-area clearance. Shown/total and select-all remain collection context below those rows. When selection is active, avoid stacking redundant informational metadata where it can be merged into the selection context. Every interactive target remains at least 44x44px.

- [ ] **Step 1: Add the failing adaptive structural check.** Assert a two-row compact page-header structure, preserved safe-area spacing, minimum 44px targets for all header controls, permission-gated scope, and continued search/filter/refresh/selection/action handler wiring.
- [ ] **Step 2: Run the check to establish RED.**

```powershell
npx tsx components/intelligence/ArchiveAdaptiveCompactHeader.check.ts
```

- [ ] **Step 3: Recompose only the adaptive header rows.** Do not alter `MultiViewList` data, mode, selection, or empty-state props. Preserve the two scope choices and current authorization gate. Keep filter details inside the existing FilterPanel.
- [ ] **Step 4: Run the check to establish GREEN.**

```powershell
npx tsx components/intelligence/ArchiveAdaptiveCompactHeader.check.ts
```

- [ ] **Step 5: Run focused source and build checks.**

```powershell
node scripts/babelcheck.mjs components/intelligence/IntelligencePageHeader.tsx components/intelligence/_archives_desktop.tsx components/intelligence/_archives_adaptive.tsx
npm run verify:agent
```

Classify any full-gate failures against the existing baseline because the worktree contains unrelated modifications; do not claim unrelated failures as caused or fixed by this change.

## Task 4: Integrated desktop/mobile walkthrough and review

**Files:** all files owned by Tasks 1–3; no unrelated files.

- [ ] **Step 1: At 1400px desktop,** confirm page identity/actions use one compact row and target roughly 75–90px; verify filter, counts, search, view modes, selection, purge, empty state, and list scroll are reachable.
- [ ] **Step 2: At 1000px,** confirm the toolbar wraps without clipping, filter panel remains usable, and the collection retains bounded height.
- [ ] **Step 3: At 390px mobile web,** confirm no horizontal overflow; at most two page-header rows precede the collection; scope remains understandable; all controls meet the 44px target; and empty/loaded collection appears substantially sooner.
- [ ] **Step 4: Exercise behavior at the relevant viewports:** related/company scope (when authorized), refresh/loading, search and clear, each type/status filter and clear, empty-state action, inspect, select-all/clear selection, restore, and purge confirmation.
- [ ] **Step 5: Inspect the complete task diff and confirm no archive semantics, unrelated dirty hunks, or non-Cold-Storage screens were changed.** Run `git diff --check` on owned files and report any visual validation that could not be performed.

## Integration/review gate

Sol owns integration and final review: inspect the complete owned diff, compare shared-header callers to confirm default compatibility, verify all acceptance criteria, classify baseline verification failures, and provide PASS/BLOCK. Do not expand the rollout to other Intelligence screens until this first slice is reviewed and accepted.

## Plan self-review

- **Spec coverage:** desktop + adaptive layouts, preserved behavior/primitives, shared-header compatibility, semantic/touch constraints, viewport testing, and staged rollout are covered by Tasks 1–4.
- **Placeholder scan:** no unfinished placeholders or unspecified future implementation tasks remain.
- **Type/interface consistency:** `density` is optional and defaults to standard; only the desktop archive renderer opts into compact density in this slice.
- **Scope:** implementation is isolated to the three Cold Storage/shared-header files plus focused tests/checks; global shell, detail screens, and later rollout phases are explicitly excluded.
