# Analytics Medium UX Refinement Design

## Outcome

Make the existing Analytics and Targets controls easier to scan and operate without changing metrics, permissions, billing, requests, persistence, or target mutations.

## Design

### Personnel selection

Both Personnel comparison screens reuse `SearchableMultiSelect`. The current user payload has no team or role field, so the picker remains a flat roster rather than inventing groups. It shows search, selected count, removable selected chips, clear selection, avatar rows, and the existing selection state. Desktop keeps its parameters and result layout; adaptive keeps its rate inputs and result cards.

### Adaptive Analytics navigation

The Pipeline, Personnel, and Portfolio switcher is a tab list. Each available tab has a tab role, selected or disabled state, a descriptive label, and a 44px minimum target. Personnel selection uses the same shared picker. Selected controls use `text-brand-on-primary`; input placeholders use theme colors.

### Target dialogs and copy

Desktop and adaptive edit dialogs keep `Popup`, current fields, validation, and mutation handlers. Close, cancel, and save actions have explicit labels, states, and 44px targets. Copy uses plain terms:

- `Volume target` instead of `Volume quota`.
- `Time target` instead of `Performance SLA` where the user is choosing or editing the type.
- `Task goal` instead of `Target quota (units)`.
- `Active work limit` and `Total time limit` instead of internal SLA or lifecycle wording.
- Empty copy says targets set a task goal or time limit for a stage.

Stored field names and target type values remain unchanged.

### Semantic color cleanup

In the four scoped Analytics and Targets screen files, primary button and selected text use `text-brand-on-primary`. Placeholder colors use `useThemeColors()`. Existing semantic status colors remain. This does not change shared theme primitives or unrelated screens.

## Non-goals

- Team grouping without a team field in the existing roster query.
- New target types, formulas, validation, permissions, or mutation behavior.
- Changes to Analytics loading or request state.
- A redesign of result tables, charts, salary inputs, or target history.

## Acceptance

- No dense personnel pill wall remains on desktop or adaptive Analytics.
- Selection, persistence, minimum two-person behavior, rates, and comparison requests are unchanged.
- Adaptive tabs expose tab semantics, selected state, disabled state, and 44px targets.
- Target edit close, cancel, and save controls are named and at least 44px.
- Scoped user-facing target copy avoids quota, SLA, lifecycle, and benchmark jargon.
- Scoped `text-white` and raw placeholder `rgba(...)` usage is removed.
- Focused shared-component checks, Babel parsing, and scoped diff checks pass.
