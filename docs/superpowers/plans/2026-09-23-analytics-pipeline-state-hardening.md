# Analytics Pipeline State Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Analytics Pipeline tab report loading, updating, ready, empty, and error states truthfully on desktop and adaptive layouts without showing results from stale filters.

**Architecture:** Each renderer keeps one accepted Pipeline snapshot keyed by `{pipelineId, from, to, buckets}` and a monotonically increasing request generation. A response commits only when its key is still current and its generation is the latest started generation, which also protects the A-to-B-to-A case. Both renderers use the same copy and state meanings while retaining their existing chart components.

**Tech Stack:** React Native / React Native Web, TypeScript, Expo, existing `useAnalytics`, `DateRangeControls`, and chart components.

## Global Constraints

- Modify only `components/intelligence/_analytics_desktop.tsx` and `components/intelligence/_analytics_adaptive.tsx` Pipeline-tab state and presentation.
- Do not change Performance (`_graphs_*`), Overview, SQL, metrics, charts, plan gates, permissions, or billing behavior.
- A filter change must stop presenting the previous key's data as current immediately.
- A result may commit only when both its captured request key equals the current key and its generation is the latest started generation.
- Empty means a successful current-key stage-dwell response with no rows. A valid numeric zero remains measured zero; unavailable/null remains unavailable.
- Use exact copy: `No stage movement in this range.`, `Try a longer date range or another pipeline.`, `Couldnâ€™t load analytics.`, and `Retry`.
- Retry is a keyboard-accessible button with a minimum 44 by 44 px target and an accessible label.
- Preserve the dirty worktree and all unrelated edits. Do not add or run tests unless the user separately asks.

---

### Task 1: Desktop Pipeline request state

**Files:**
- Modify: `components/intelligence/_analytics_desktop.tsx` (`PipelineTab` only)

**Interfaces:**
- Consumes: existing `getPipelineStageDwell`, `getPipelineThroughputRange`, `getOrganizationalAudit`, selected pipeline/date range, bucket count, billing limits.
- Produces: desktop Pipeline state keyed by `JSON.stringify([selectedPipeline, from, to, buckets])`, guarded by `useRef` request generation and current-key refs.

- [x] Add current-key and request-generation refs. At load start, capture both values, clear the current error, and choose Loading when no accepted snapshot exists for the key or Updating when a same-key snapshot exists.
- [x] Fetch the existing dwell, throughput, and audit requests as one required snapshot. Remove the audit-only catch that converts its failure to `null`.
- [x] Before any success or failure state update, confirm both the captured key and generation are current. Ignore older success and error completions.
- [x] On accepted success, replace all three result collections together and choose Empty only when `dwell.length === 0`; otherwise choose Ready.
- [x] Render initial/filter-change Loading without prior-key charts. Render same-key Updating with the accepted same-key charts and an accessible progress indicator.
- [x] Render the two-line Empty copy after a successful empty dwell response. Render the Error copy and 44 px `Retry` button for a current required-request failure.
- [x] Preserve existing no-pipeline, permission, billing, and plan-gated behavior.
- [x] Inspect the file diff for changes outside `PipelineTab`; remove any accidental scope expansion. Do not run tests.

### Task 2: Adaptive Pipeline request state

**Files:**
- Modify: `components/intelligence/_analytics_adaptive.tsx` (`PipelineTab` only)

**Interfaces:**
- Consumes and produces the same state contract as Task 1, using the adaptive chart renderers.

- [x] Add the same current-key plus monotonically increasing generation guard used by the desktop task.
- [x] Treat dwell, throughput, and audit as one required snapshot and stop converting audit failure into a successful `null` result.
- [x] Commit success/error only for the latest generation of the current key; replace the three result collections atomically on success.
- [x] Derive Empty only from a successful `dwell.length === 0`; keep valid zero-valued throughput visible and null values unavailable.
- [x] Render the same Loading, Updating, Empty, and Error meanings and exact copy. Keep controls reachable, avoid horizontal overflow, and give `Retry` accessible button semantics plus a minimum 44 px target.
- [x] Preserve existing permission, billing, plan gates, and adaptive charts.
- [x] Inspect the file diff for changes outside `PipelineTab`; remove any accidental scope expansion. Do not run tests.

### Task 3: Sol integration review

**Files:**
- Review: both modified files and this plan.

- [x] Compare desktop and adaptive state transitions, copy, retry behavior, empty predicate, and stale-response guards.
- [x] Confirm A-to-B-to-A safety requires both key and generation, not key equality alone.
- [x] Confirm old-key results never render under current controls, permission/billing states remain outside the request state machine, and no Performance or SQL files changed.
- [x] Run source diff checks only. Record runtime/manual verification at approximately 1400 px, 1000 px, and 390 px as pending unless it is separately authorized and actually driven.

## Acceptance walkthrough

- At approximately 1400 px: exercise first load, populated data, successful empty dwell, valid zero measurements, failed request, and Retry.
- At approximately 1000 px: switch pipeline and range quickly; confirm no old-key chart appears and status content does not clip.
- At 390 px: repeat loading, empty, error, and Retry; confirm the target is touch sized and there is no horizontal overflow.
- Force A-to-B-to-A requests to resolve out of order; only the newest generation may render.
- Confirm permission denial and billing loading/unavailable states retain their current copy and priority.
