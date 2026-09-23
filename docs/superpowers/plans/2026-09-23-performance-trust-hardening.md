# Performance Trust Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop and adaptive Performance show only current-scope data with truthful loading, updating, empty, error, null, and range semantics.

**Architecture:** Each renderer owns an accepted snapshot of dwell, throughput, points, and organizational audit keyed by `{pipelineId, from, to, buckets}`. A monotonic generation plus current-key check rejects late A-to-B-to-A completions; all required reads commit together. Existing charts remain unchanged apart from preserving nullable success rates and adding the approved scope note and status surfaces.

**Tech Stack:** React Native / React Native Web, TypeScript, Supabase JS, existing Analytics context and chart components.

## Global constraints

- Modify only `components/intelligence/_graphs_desktop.tsx` and `components/intelligence/_graphs_adaptive.tsx`.
- Do not change SQL, Overview, Analytics, metrics, charts, permissions, billing, or plan gates.
- Required reads are stage dwell, throughput range, points range, and `rpc_get_organizational_audit`; remove the points empty fallback and throw when the audit response has `error`.
- Commit required results atomically only for the newest generation of the current `{pipelineId, from, to, buckets}` key.
- Empty requires successful `dwell.length === 0 && throughput.length === 0 && points.length === 0`.
- Preserve measured zero. Keep nullable success rate unavailable; never coerce it to `0`.
- Add exact copy near controls: `Stage, throughput, and points use these dates. Current summaries use the same number of days ending today.`
- Error copy is `Couldnâ€™t load analytics.` with one 44 px accessible `Retry` button.
- Preserve unrelated dirty work. Do not add or run tests unless separately requested.

---

### Task 1: Desktop Performance state

**File ownership:** `components/intelligence/_graphs_desktop.tsx` only.

- [x] Add pipeline-list resolution state so initial loading and resolved-empty lists are distinct.
- [x] Add request key, current-key ref, monotonic generation, state key, and one atomic snapshot for dwell/throughput/points/audit.
- [x] Remove `getPipelinePointsRange(...).catch(() => [])`; check the audit RPC's `error` and throw it before accepting data.
- [x] On filter changes, stop rendering the old key immediately. Ignore older successes and errors; commit all results together only for the latest current request.
- [x] Render Loading, same-key Updating, Ready, all-series Empty, and current-key Error with exact copy and accessible Retry.
- [x] Change desktop throughput chart data from `success_rate ?? 0` to the nullable value so missing rates produce no false 0% point.
- [x] Add the exact rolling-summary scope note near the controls without adding a card or changing layout ownership.
- [x] Preserve existing charts, refresh control, permissions, billing, and plan gates. Run only scoped diff check; no tests.

### Task 2: Adaptive Performance state

**File ownership:** `components/intelligence/_graphs_adaptive.tsx` only.

- [x] Add pipeline-list resolution state and the same keyed snapshot/generation/state-key contract as desktop.
- [x] Make dwell, throughput, points, and audit required; remove the points fallback and throw audit RPC errors.
- [x] Reject late current-key mismatches and old generations; atomically commit the latest snapshot.
- [x] Render the same Loading, Updating, Ready, Empty, Error, Retry, and exact scope note semantics with mobile-safe wrapping.
- [x] Preserve the existing adaptive null success-rate omission and measured-zero throughput bars.
- [x] Preserve charts, permission/billing/plan behavior. Run only scoped diff check; no tests.

### Task 3: Sol integration review

- [x] Compare request transitions, key/generation guards, audit error handling, empty predicate, scope copy, null/zero behavior, and pipeline-list states across renderers.
- [x] Confirm only the two Performance files changed for implementation and no prior dirty work was reverted.
- [x] Run scoped source diff checks. Record runtime/browser verification at approximately 1400 px, 1000 px, and 390 px as pending unless separately authorized and actually driven.

## Manual acceptance

- At ~1400 px: first load, populated, all three range series empty, null rate, measured zero, required-read failure, and Retry.
- At ~1000 px: rapid pipeline/date/bucket changes and same-key refresh; no stale data or clipped status.
- At 390 px: readable scope note, status copy, controls, and touch-sized Retry without horizontal overflow.
- Force A-to-B-to-A responses out of order; only the newest generation renders.
- Confirm permission and billing states retain their current priority and copy.
