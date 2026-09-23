# Analytics UI Hardening Design

## Scope

Refine the completed Overview, Analytics, Performance, and Targets UI without changing metric formulas, target semantics, permissions, billing behavior, routes, or SQL.

## Design principles

- Keep useful results visible when one reader fails.
- Describe unavailable data directly; do not turn errors or empty samples into zero.
- Prefer plain words and short helper copy.
- Use one clear state per series: loading, ready, empty, or error.
- Keep controls reachable with a 44px minimum target and explicit accessibility labels/state.
- Use theme semantic colors so light/dark themes and status meaning remain consistent.
- Use rings only for actual progress with a valid numerator and denominator.

## Data-state model

Analytics and Performance requests still share a request key and generation guard. Each reader settles independently into an atomic snapshot containing its data plus an error flag. A stale snapshot never commits.

- A successful series renders even when another series fails.
- A failed series renders a compact inline error with Retry rather than an empty chart.
- Audit failure omits only audit-backed summaries and shows one local explanation.
- The whole-screen error appears only when every requested series failed.
- The whole-screen empty state appears only when every successful series has no measured activity and no series failed.
- A throughput bucket counts as activity only when completed or failed count is positive; a returned empty bucket grid is not evidence of activity.
- Existing null versus measured-zero formatting remains unchanged.

## Copy and accessibility

- Replace corrupted punctuation with ASCII or correctly encoded plain text.
- Replace the Performance scope note with: “Charts use the dates above. Summary cards cover the same length of time through today.”
- Use “Completed tasks” in headings where “Throughput” is unnecessary jargon; keep RPC/type names internal.
- Pipeline selectors expose button role, pipeline name, and selected state.
- Refresh, create, edit, complete, expire, and retry controls expose names and a minimum 44px target.

## Targets presentation

- Valid volume targets retain the progress ring.
- Performance targets and volume targets with unavailable progress use a compact information card without an empty ring.
- Compact cards show stage, target type, stored SLA budgets or “Progress unavailable,” optional due date, and actions outside the data visualization.
- Target Watch retains its bounded list and gets a 44px “View targets” control.

## Responsive density and color

- Adaptive Performance uses shorter headings/helper copy and removes redundant vertical gaps where controls already group the content.
- Existing semantic theme tokens (`success`, `danger`, `warning`, `primary`, muted text) replace raw status hex/rgb values in the scoped adaptive charts.
- No new chart type, palette, navigation, or dashboard widget is introduced.

## Non-goals

- New analytics metrics or metric-definition changes.
- Target calculation/status changes.
- Report generator redesign.
- SQL, billing, permission, navigation, or route changes.
- Full visual redesign of Personnel analytics.

## Acceptance

- Partial reader failure leaves every successful series visible on desktop and adaptive layouts.
- Failed series are never labeled as empty and valid non-zero throughput is never hidden by missing dwell data.
- No scoped user-facing mojibake remains.
- Scoped interactive controls meet the 44px minimum and have accessible names/state.
- No target ring appears without valid volume progress.
- Scoped raw status colors are replaced with theme tokens.
