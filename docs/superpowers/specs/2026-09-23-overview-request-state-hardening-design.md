# Overview Audit Request State Hardening

## Goal

Make the Overview audit request truthful on desktop and adaptive layouts. A
visible audit result must belong to the current scope and date inputs, and a
request must settle visibly as Loading, Updating, Ready, Empty, or Error.

## Scope

Modify only:

- `components/intelligence/_index_desktop.tsx`
- `components/intelligence/_index_adaptive.tsx`

This work covers the organizational audit request and its status surface. Keep
`AtAGlance`, `TargetWatch`, and `ProjectLens` data and refresh coordination as
they are. Do not change layout, metric definitions, SQL, billing behavior,
permission policy, or the navigation/archives/report flows.

## Request keys and concurrency

Each renderer owns an audit request generation and accepts a response only when
its captured key and generation are still current. This rejects late A→B→A
responses and prevents a prior scope from appearing after a filter change.

- Desktop key: `JSON.stringify([pipelineId, from, to, days])`. `days` is the
  value passed to `getOrganizationalAudit`; `from` and `to` remain in the key
  because they are the user's actual date inputs.
- Adaptive key: `JSON.stringify(['radar', pipelineId, days])`. Audit requests
  run only for the radar section, and `days` is its actual date input. Changes
  to section, pipeline, or days supersede the prior request.

Capture the key and increment the monotonic generation before each initial
load, filter load, or explicit refresh. A completion whose key or generation is
old does nothing: it must not change data, state, or the refreshing indicator.
When the key changes, the renderer must stop presenting the prior key's audit
snapshot immediately.

## State model

Use the same meanings and copy in both renderers:

| State | Meaning | Required presentation |
| --- | --- | --- |
| Loading | No accepted audit snapshot exists for the current key. | Loading status while the first current-key request is pending. |
| Updating | A current-key snapshot exists and that same key is being refreshed. | Keep current audit content visible and expose an updating status. |
| Ready | The current-key audit request succeeded with a usable payload. | Render existing audit consumers. |
| Empty | The current-key request succeeded with the contract's `null` or empty payload. | Render the existing empty treatment, with no stale audit values. |
| Error | The current-key request failed or throws. | Show `Couldn’t load overview.` and one accessible `Retry` button. |

Empty is selected only after a successful response explicitly returns the
contract's null/empty value. A thrown error, rejected request, or failed audit
read is Error and never Empty. Preserve measured zero values inside a successful
audit payload.

Retry starts a new generation for the current key. A retry failure settles in
Error; it must not leave the adaptive screen spinning forever after its first
failure.

## Renderer behavior

### Desktop

Keep permission loading, `analytics.view` denial, billing loading, billing
failure, and plan-unavailable branches ahead of audit states. Once those gates
permit the audit request, render current-key Loading, Updating, Ready, Empty,
or Error. The refresh control calls the keyed audit loader and shows its spinner
only during Updating. Existing `AtAGlance`, `TargetWatch`, and `ProjectLens`
layout and data contracts remain unchanged.

### Adaptive

Keep the existing section and permission behavior, including the archives path.
Audit state applies while the radar section is active; archive/report loading
continues to use its existing flow. Bind `RefreshControl.refreshing` to the
current audit Updating state instead of a constant `false`, and route its
`onRefresh` through the keyed audit loader. A first audit failure must render
Error and release the refresh/loading state so the screen cannot spin forever.

Both layouts use accessible status semantics for Loading/Updating, keep Retry
as a real button with accessible name `Retry`, provide a minimum 44 × 44 px
touch target, and do not move focus when the state changes.

## Non-goals

- No TargetWatch or ProjectLens refresh coordination.
- No new metrics, charts, cards, or visual redesign.
- No SQL or analytics query changes.
- No changes to permission, billing, plan, archive, or report policy.
- No changes to `AtAGlance` metric calculations or audit payload shape.

## Acceptance criteria

- Desktop and adaptive use the renderer-specific keys above and a monotonic
  generation guard.
- No visible audit result belongs to a superseded pipeline, date, section, or
  day count; A→B→A late responses are discarded.
- Loading, Updating, Ready, Empty, and Error are distinguishable in both
  renderers.
- Error shows exactly `Couldn’t load overview.` and one 44px accessible `Retry`
  action.
- Empty appears only for a successful null/empty audit payload; failures show
  Error and never stale prior data.
- Adaptive first failure settles and `RefreshControl` reports real updating.
- Permission and billing states retain their existing priority and copy.
- TargetWatch, ProjectLens, layout, metrics, SQL, and unrelated flows remain
  unchanged.

## Manual verification

At approximately these widths, exercise both renderers:

- **~1400 px:** permission/billing gates, first load, populated audit, empty
  success, failed request, Retry, and same-key refresh with Updating visible.
- **~1000 px:** change pipeline and dates quickly; resolve requests out of
  order and confirm only the latest key remains visible without layout shift.
- **390 px:** confirm wrapped Error copy, a 44px Retry target, readable status,
  and adaptive pull-to-refresh showing the real Updating state.
- Force A→B→A responses and confirm stale success and failure callbacks do not
  overwrite the newest audit state.
- Confirm TargetWatch and ProjectLens remain independent and permission/billing
  branches retain their current behavior.

## Self-review

The spec names both actual request scopes, the exact two files, state
transitions, stale-response handling, empty/error distinction, adaptive
refresh behavior, accessibility, and manual widths. It contains no SQL,
metric, layout, or unrelated refresh work and has no placeholders.
