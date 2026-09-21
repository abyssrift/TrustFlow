# Analytics Pipeline State Hardening

## Goal

Make the Pipeline tab show a truthful state for its selected pipeline and date
range on desktop and adaptive layouts. A completed request must never leave
charts from a different filter selection on screen, and loading, empty, and
failure states must remain distinct.

## Scope

Update only the Pipeline tab state and presentation in:

- `components/intelligence/_analytics_desktop.tsx`
- `components/intelligence/_analytics_adaptive.tsx`

The response identity is the tuple `{pipelineId, from, to, buckets}`. Pipeline
selection, either date, or bucket-count changes create a new request identity.
Keep permission and billing gates outside this state machine: their existing
loading, denial, and plan-access states retain priority and meaning.

No metrics, charts, visual redesign, Overview work, database changes, or
permission/billing behavior changes are in scope.

## State model

The Pipeline tab uses the same user-facing states on both layouts:

| State | Meaning | Presentation |
| --- | --- | --- |
| Loading | The first request for the selected filters is in progress. | Loading indicator; no chart or empty copy. |
| Updating | Filters changed, or the current filters are being retried/refreshed. | Updating indicator. Hide any result whose request key differs from the current key. A same-key accepted result may remain visible while it updates. |
| Ready | All data required by the visible Pipeline content resolved for the current key. | Render the existing charts and details using that response only. |
| Empty | Requests succeeded for the current key, but there is no stage movement/history in the range. | Show `No stage movement in this range.` and `Try a longer date range or another pipeline.` |
| Error | A request required by the visible Pipeline content failed for the current key. | Show `Couldn’t load analytics.` and a single-action button labeled `Retry`. |

An empty pipeline list keeps its existing setup/empty treatment. Empty data is
never used to represent a rejected request. Keep existing permission checks,
plan gates, and request dependencies; only requests required by currently
visible content determine whether that content enters the Error state.

## Request and concurrency behavior

Build a stable request key from `{pipelineId, from, to, buckets}` for every
load and assign each load a monotonically increasing request generation.
Commit the dwell, throughput, and audit results as one snapshot tied to that
key and generation. If any request required for the visible content fails, do
not commit a partial snapshot as ready.

When a key changes, immediately stop presenting the previously accepted result
as current. A response may update state only when both its captured key equals
the current key and its generation is the latest started generation. Discard
late responses and errors from older requests, including when filters change
A → B → A. Retry starts a new generation for the current key; its failure
remains an error for that key and does not restore results from a different
selection.

Distinguish missing values from measured zero throughout rendering. `null` or
otherwise unavailable measurements remain unavailable according to the
existing chart conventions; a valid value of `0` remains a measured zero and
must not by itself trigger the Empty state. The Empty state is chosen when the
successful stage-dwell response contains no stage-history rows, not from a
failed call or a single zero-valued field.

## Layout and accessibility

Desktop and adaptive layouts share these state meanings, exact copy, and
retry behavior while preserving their current chart presentations and control
layouts. Loading and updating indicators expose a concise accessible status.
The Retry control has button semantics, an accessible name matching its visible
label, keyboard access on web, and a minimum 44 × 44 px target. State changes
are announced without moving focus. Keep the existing selected pipeline and
date-range controls available when the state permits them.

## Acceptance criteria

- Every visible Pipeline result belongs to the current `{pipelineId, from, to,
  buckets}` key.
- Initial loading, filter updates, successful empty data, successful data with
  measured zero, and request failure are distinguishable.
- A failed required request shows `Couldn’t load analytics.` with `Retry`; it
  never shows plausible zeroes, the no-movement copy, or an old filter's data
  as current.
- A successful empty stage-history response shows the exact no-movement copy
  and the date-range/pipeline suggestion above.
- Late data and late errors from superseded requests do not change the current
  screen.
- Permission denial and billing loading, denial, or unavailability remain
  separate from Pipeline request states.
- Desktop and adaptive behavior meet the same state and accessibility criteria;
  their existing charts and plan-gated content remain intact.

## Manual verification

At each viewport below, repeat these cases in the Pipeline tab:

- **~1400 px:** first load, populated range, genuinely empty range, valid
  zero-valued measurements, and a failed request followed by Retry.
- **~1000 px:** change pipeline and date range in quick succession; confirm no
  prior selection's charts appear as current, and inspect the updating and
  error states for clipping.
- **390 px:** initial load and update, no-movement copy, Retry target and
  keyboard/screen-reader naming where applicable, and no horizontal overflow.
- On desktop and adaptive layouts, force requests to resolve out of order after
  changing filters twice; confirm only the latest key can render.
- Confirm permission denial and billing loading/restricted states remain
  unchanged and are not replaced by Pipeline empty or error copy.
