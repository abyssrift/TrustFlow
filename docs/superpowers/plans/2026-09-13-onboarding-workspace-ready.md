# Onboarding workspace-ready Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show fresh-company catalog defaults and expose recommended starter templates before onboarding enters the dashboard.

**Architecture:** Keep `rpc_create_company_and_link` and catalog materialization unchanged. Add a small cross-platform ready-step presentation component; both onboarding route variants hold the ready state and mount the existing `StarterTemplatePickerSheet` only after company creation succeeds.

**Tech Stack:** Expo Router, React Native primitives, TypeScript, Vitest, Babel, Expo web export.

## Global Constraints

- Do not rewrite existing company data.
- Keep starter materialization in `rpc_create_catalog_starter_template` / `rpc_create_starter_template`.
- Keep web and native onboarding behavior aligned while retaining their existing layout shells.
- The join-existing-company path remains unchanged.

---

### Task 1: Ready-step presentation contract

**Files:**
- Create: `components/onboarding/WorkspaceReadyStep.tsx`
- Test: `components/onboarding/WorkspaceReadyStep.test.tsx`

**Interfaces:**
- Consumes: `onBrowseStarters`, `onContinue`, and optional `starterTemplateName` callbacks/state.
- Produces: accessible copy and buttons for the fresh-company onboarding ready state.

- [ ] **Step 1: Write the failing test**

Assert that the component exposes `Workspace ready`, `Owner access`, `Main Workflow`, a starter action, and a continue action; invoke both callbacks through the rendered buttons.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run components/onboarding/WorkspaceReadyStep.test.tsx`

Expected: FAIL because `WorkspaceReadyStep` does not exist yet.

- [ ] **Step 3: Implement the minimal component**

Render the required copy with React Native primitives and two accessible `TouchableOpacity` actions. If `starterTemplateName` exists, show it as the selected company-owned starter.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx vitest run components/onboarding/WorkspaceReadyStep.test.tsx`

Expected: PASS.

### Task 2: Wire fresh-company onboarding

**Files:**
- Modify: `app/onboarding.tsx`
- Modify: `app/onboarding.web.tsx`

**Interfaces:**
- Consumes: `WorkspaceReadyStep`, `StarterTemplatePickerSheet`, existing `refreshProfile`, and existing router.
- Produces: a `ready` state after create, optional starter selection, and explicit workspace continuation.

- [ ] **Step 1: Write the failing integration assertion**

Extend onboarding behavior coverage so a successful create leaves the route in ready state and the ready state mounts the starter picker only after the user presses Browse. Keep join success routing unchanged.

- [ ] **Step 2: Run the focused onboarding test and verify it fails**

Run: `npx vitest run app/onboarding.test.tsx`

Expected: FAIL because create currently routes directly to `/(tabs)` and no ready state exists.

- [ ] **Step 3: Implement the state transition**

Add `ready` state, starter-picker visibility, and selected template name. After create calls `await refreshProfile()`, set ready instead of routing. Continue routes to `/(tabs)`; picker `onCreated` records the materialized template name.

- [ ] **Step 4: Run focused onboarding tests and syntax checks**

Run: `npx vitest run app/onboarding.test.tsx components/onboarding/WorkspaceReadyStep.test.tsx`

Expected: PASS.

Run: `node scripts/babelcheck.mjs app/onboarding.tsx app/onboarding.web.tsx components/onboarding/WorkspaceReadyStep.tsx components/onboarding/WorkspaceReadyStep.test.tsx`

Expected: four `OK` lines.

### Task 3: Regression verification

**Files:**
- No additional source files.

- [ ] **Step 1: Run the checkout-only Vitest suite**

Run: `npx vitest run --reporter=dot --exclude '.claude/**' --exclude '.worktrees/**'`

Expected: all checkout tests pass; detached worktree tests are excluded.

- [ ] **Step 2: Run the production web export**

Run: `npm run build:web`

Expected: `Exported: dist` with exit code 0.

- [ ] **Step 3: Check the diff**

Run: `git diff --check`

Expected: no whitespace errors.
