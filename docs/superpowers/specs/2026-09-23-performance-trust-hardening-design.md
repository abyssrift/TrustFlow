# Performance Trust Hardening

## Goal

Make Performance renderers show only data belonging to the selected pipeline,
date range, and bucket count. Loading, updating, successful empty data, and
request failure must remain distinct on desktop and adaptive layouts.

## Scope and invariants

Modify only:

- `components/intelligence/_graphs_desktop.tsx`
- `components/intelligence/_graphs_adaptive.tsx`

The request key is `{pipelineId, from, to, buckets}`. Each load captures that
key and receives a monotonically increasing generation. A response may commit
only when both the key and generation are still current. This protects rapid
changes including Aâ†’Bâ†’A.

The required snapshot keeps the renderer's existing reads together:

- `getPipelineStageDwell(pipelineId, from, to)`
- `getPipelineThroughputRange(pipelineId, from, to, buckets)`
- `getPipelinePointsRange(pipelineId, from, to, buckets)`
- the existing `rpc_get_organizational_audit` read for the current pipeline and
  number of days ending today

The points read is required and must not be converted to an empty success with
`.catch(() => [])`. The audit RPC result must check its returned `a.error` and
fail the snapshot when present. All four results commit as one snapshot. A
required read failure commits no partial data. Existing permission, billing,
and plan gates keep their current priority and behavior.

Do not change SQL, Overview, metrics, existing chart designs, or add new
metrics/charts.

## State model

Both renderers use the same meanings:

| State | Meaning | Presentation |
| --- | --- | --- |
| Loading | No accepted snapshot exists for the current key. | Loading indicator; do not show another key's charts. |
| Updating | A current-key snapshot is being refreshed. | Keep that snapshot visible with an accessible updating indicator. |
| Ready | All required reads succeeded for the current key and range data exists. | Render the existing Performance sections. |
| Empty | All three range series succeeded but contain no rows: `dwell.length === 0`, `throughput.length === 0`, and `points.length === 0`. | Render the exact scope note and a plain no-data message appropriate to the existing surface. |
| Error | A required current-key read failed. | Show `Couldnâ€™t load analytics.` and one button labeled `Retry`. |

The Empty predicate is based on absent range rows, never on a numeric value.
An existing row with `0` remains a measured zero. A `null` success rate stays
unavailable and is not displayed as `0%`; it does not make the whole snapshot
empty.

Place this exact scope note near the shared pipeline/date controls on both
renderers:

> Stage, throughput, and points use these dates. Current summaries use the same number of days ending today.

The note explains why audit summary values may not represent the selected end
date. It is informational copy only and does not alter any query.

## State transitions and concurrency

When the key changes, invalidate the prior snapshot for rendering immediately.
The next request starts in Loading unless an accepted snapshot already belongs
to the same key, in which case it starts in Updating. Retry starts a new
generation for the current key.

On success, commit dwell, throughput, points, and audit together, then select
Ready or Empty from the current snapshot. On failure, discard the current
rendered snapshot and select Error only if the captured key and generation are
still current. Late successes and failures from superseded requests do nothing.

Keep the pipeline/date controls available. Existing plan-gated sections remain
gated after Ready; permission denial, billing loading, and billing failure are
not converted into Performance Empty or Error states.

## Accessibility and responsive parity

Desktop and adaptive use the same state meanings, copy, retry behavior, and
stale-response protection while retaining their existing chart renderers.
Loading and Updating expose an accessible status. Retry has button semantics,
an accessible name of `Retry`, keyboard access on web, and a minimum 44 Ã— 44 px
target. State changes do not move focus. The scope note and no-data messages
remain readable without horizontal overflow at mobile width.

## Acceptance criteria

- Every visible Performance result belongs to the current request key.
- Aâ†’Bâ†’A late responses cannot replace the newest generation's state.
- Dwell, throughput, points, and current summaries commit atomically.
- A points failure and any audit `a.error` produce Error; neither becomes empty.
- Loading, Updating, Ready, Empty, and Error are distinguishable on both
  renderers.
- Error shows `Couldnâ€™t load analytics.` and `Retry`; it never appears as zero,
  empty, or stale prior-key data.
- Empty requires all three range series to have no rows.
- Numeric zero remains visible as zero; null success rate remains unavailable.
- The exact scope note appears near controls on desktop and adaptive layouts.
- Permission, billing, plan gates, and existing charts remain unchanged in
  meaning.

## Manual verification

At each viewport, exercise the same cases on desktop and adaptive layouts:

- **~1400 px:** initial load, populated data, all-range-series empty data,
  measured zero values, null success rate, failed read, and Retry.
- **~1000 px:** change pipeline, dates, and granularity quickly; confirm the
  old charts disappear for the new key and Updating content does not clip.
- **390 px:** confirm the scope note, Loading/Empty/Error states, 44 px Retry,
  readable controls, and no horizontal page overflow.
- Force Aâ†’Bâ†’A requests to resolve out of order; only the latest generation may
  render.
- Confirm permission denial and billing loading/unavailable states retain their
  existing copy and priority.

## Self-review

The spec has no placeholders, no database or unrelated-screen work, and names
the exact existing reads and empty predicate. The scope note explicitly
distinguishes range metrics from current summaries. Null and zero behavior is
defined independently from Empty, and desktop/adaptive acceptance is aligned.
