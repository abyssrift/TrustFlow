# Compact Page Headers Across TrustFlow

## Problem

Many screens spend too much of the initial viewport on page-level headings and
their controls. Cold Storage is especially costly: its large Intelligence title
header is followed by separate count, filter, summary, and list-toolbar rows.
On mobile, title, search/actions, scope, count/selection, and view controls are
similarly stacked. The result is that the actual archive collection starts too
far down the screen.

The app already has a scroll-to-condensed mechanism, but that only helps after a
user scrolls and is adopted unevenly. This design makes compact page-level
headers a consistent default while leaving global navigation and context-heavy
detail headers alone unless a later screen-specific review justifies changes.

## Goals

- Make collection content visible sooner on first render, not only after scroll.
- Establish a reusable compact header pattern based on existing TrustFlow
  components and tokens.
- Remove duplicate vertical control rows where controls can be composed into a
  compact toolbar without hiding functionality.
- Treat desktop and mobile as related but potentially adaptive layouts.
- Roll out incrementally, beginning with Cold Storage, then Intelligence
  collections, then Tasks/Projects/People collection screens.

## Non-goals

- Shrink the global desktop top bar or mobile navigation reservation; these are
  separate shell chrome and already have retractable/adaptive behavior.
- Apply a uniform smaller title size or padding to every screen without review.
- Change task/project detail identity, workflow actions, permissions, archive
  scope behavior, or list semantics.
- Replace `MultiViewList`, `FilterPanel`, or existing selection/action
  primitives.

## Existing patterns and design direction

- `IntelligencePageHeader` is the shared desktop Intelligence title header.
  Its expanded state uses 32px top and 24px bottom padding, a `text-4xl` title,
  and a separate controls row; it currently condenses only after scrolling.
- Cold Storage adds count/filter/summary rows before the `MultiViewList`
  toolbar. Mobile has an independently composed stack with still more rows.
- File Hub desktop provides a compact precedent: a horizontal title/actions row
  with a smaller title and tighter vertical spacing.
- `useCollapsibleHeaderScroll` and `CollapsibleHeaderProvider` are already used
  by several surfaces. They remain a progressive scroll behavior, not a
  substitute for a compact resting state.
- Task and project detail headers carry identity and workflow context and
  already collapse on scroll. They are excluded from the first rollout.

Adopt a **compact collection-header contract**, not a new global mega-component:

1. Desktop collection identity and primary actions share one compact row where
   practical; the title uses the established title typography but a smaller
   collection-scale size than the current `text-4xl` Intelligence default.
2. Search, filter, scope, and refresh remain visible and operable. Related
   controls may share a row; count/summary metadata should be merged into an
   existing toolbar or shown only when it adds information.
3. Mobile may use a distinct render arrangement when needed, but the page-level
   stack should stay to at most two compact rows before collection content.
   Touch targets remain at least 44x44px.
4. Preserve existing semantic tokens, `FilterPanel` placement rules,
   `MultiViewList` ownership of collection display modes/empty states, and
   current archive permissions and selection behavior.
5. Keep an explicit exception path for detail/context headers and screens where
   compacting would obscure essential context or make controls unusable.

## Initial rollout: Cold Storage

For Cold Storage desktop, target an approximately 75–90px page identity/actions
region when measured at the expanded/resting state, with the search/view toolbar
remaining immediately adjacent. Eliminate redundant standalone count/summary
rows where their information can be combined. Keep the filters expandable from
the standard icon trigger and retain active-filter indication.

For mobile web/native adaptive rendering, target approximately 110–150px for
the complete page-level control stack before the collection/empty state. Use at
most two compact rows for title/scope/actions and search/filter/refresh; fold
counts into the selection/list context when possible. Do not remove any
functional control to hit the height target.

The exact final spacing must be validated against actual 1400px desktop and
390px mobile-web layouts; the height ranges are design targets, not permission
to clip, shrink touch targets, or force overflow.

## Phased app-wide rollout

1. **Cold Storage:** prove the compact collection pattern on desktop and
   adaptive/mobile renderers.
2. **Intelligence collections:** align the shared desktop header's resting
   density and the duplicated mobile title patterns, preserving per-screen
   controls and special layouts.
3. **Tasks, Projects, and People collections:** adopt the same density contract
   selectively, respecting existing view paradigms and scoped headers.
4. **Review exceptions:** only after those phases, consider spacing alignment
   for detail or administrative screens. No global padding/type sweep is
   implied.

Each phase should be independently testable and may be paused if visual review
finds that a screen's information hierarchy does not fit the collection
pattern.

## Acceptance criteria

- Cold Storage shows the collection or its useful empty state substantially
  sooner on initial load than the current stacked layout.
- All existing archive scope, search, filter, refresh, count, selection,
  inspect, restore, purge, loading, and empty-state behavior remains reachable
  and correct.
- Desktop and mobile have intentional layouts; no horizontal overflow, clipped
  controls, or touch targets below 44x44px.
- The list continues to use `MultiViewList`; filtering continues to use the
  shared filter primitives.
- The existing scroll-to-condensed behavior remains stable and does not cause
  duplicate or jarring transitions with the new resting density.
- Manual walkthroughs cover 1400px desktop and 390px mobile web (plus ~1000px if
  any multi-column behavior changes).
- Broader rollout follows the same contract screen-family by screen-family;
  global shell and detail headers are not changed as collateral.

## Risks and mitigations

- **Controls become cramped:** retain adaptive rows on narrow screens and
  prioritize discoverability over matching the desktop row count.
- **Header collapse and compact resting state conflict:** treat compactness as
  the resting geometry, then use the current collapse behavior only for
  secondary identity details and small incremental tightening.
- **Shared-header change regresses other Intelligence screens:** introduce or
  tune behavior compatibly, inventory all consumers, and validate each
  Intelligence screen before widening the rollout.
- **Dense toolbars reduce usability:** preserve 44px mobile targets, standard
  filter affordances, and existing list controls.

## Verification

- Add or update focused checks for the compact layout contract where the
  existing test/check conventions support structural assertions.
- Run targeted Babel/TypeScript and relevant component checks for changed files.
- Drive the actual UI at 1400px and 390px; include 1000px if wrapping or
  columns are affected. If browser driving is unavailable, report that gap
  rather than claiming visual verification.
- Before each rollout phase expands, inspect all consumers of any shared header
  contract and verify their distinct controls and states.
