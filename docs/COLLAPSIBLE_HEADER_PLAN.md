# Collapsible Header Rollout Plan

Scroll-linked "large-title → compact strip" behaviour for every screen that has a
**persistent identity header above a scrollable body**. At the top the header is
full size; once the body scrolls past ~64px the header settles into a compact
strip (title shrinks, padding tightens, secondary rows tuck away); scrolling back
near the top restores it. Modelled on iOS's large-title collapse.

## The primitive (shipped)

`hooks/useCollapsibleHeader.tsx`:

| Export | Role |
|---|---|
| `<CollapsibleHeaderProvider>` | Holds one `SharedValue` per screen. `0` = full, `1` = condensed. Slot it **inside** the screen's existing data provider (`ProjectDetailProvider`, `TaskDetailProvider`, …) so both the header and the scroll body are under it. |
| `useCollapsibleHeaderScroll()` | Returns `{ onScroll, scrollEventThrottle }`. Spread onto the screen's `ScrollView` / `FlatList`. |
| `useCollapseProgress()` | Returns the `SharedValue`. The header runs its own `useAnimatedStyle` interpolations off it. |

**Design choices:**

- *Threshold + tween, not per-frame scroll-linking.* A JS `onScroll` writing a
  value every frame is janky on native; reanimated's `useAnimatedScrollHandler`
  worklet path is unverified on this app's web build (`animation-consistency.md`
  §1 case 2 / §2). Crossing `COLLAPSE_AT` (64) tweens to condensed; dropping under
  `EXPAND_AT` (24) tweens back. The gap is hysteresis against scroll jitter.
- *Hook + context, not a `<CollapsingHeaderScreen>` wrapper.* On these screens the
  header, the tab/segment bar and the scroll body are **three siblings** — a
  wrapper can't own that layout. The header only needs to *read* shared progress.
- *Reduce Motion:* handled in the hook (snaps instead of tweening). Headers don't
  need their own guard — they just follow the `SharedValue`.
- Each header decides what "condensed" means for it via its own `useAnimatedStyle`
  (smaller title, tighter padding, dropped description). No shared visual config.

## Reference adopter (shipped)

`app/projects/[id].tsx` + `components/projects/ProjectHeader.tsx`:

- `<CollapsibleHeaderProvider>` nested inside `<ProjectDetailProvider>`.
- `{...headerScroll}` spread on the tab-body `ScrollView`.
- Header animates: vertical padding `12→4`, title-row `scale 1→0.9` (anchored
  left via `transformOrigin`), description height/opacity `→0`. Stage/flags rail
  stays — that's the "necessary things only" that survives the collapse.

Use this pair as the copy-from template for every screen below.

## Inventory & sequencing

The codebase has **no existing `onScroll` / `useAnimatedScrollHandler` /
`ListHeaderComponent`** on any screen-level scroll container, so a `{...headerScroll}`
spread collides with nothing. `refreshControl` is a separate prop and coexists fine.

### Phase 1 — clean fits (header & scroll are siblings, provider already present)

| # | Screen | Files | Wiring | Header collapse target |
|---|---|---|---|---|
| 1 | **Task detail** | `app/task/[id].tsx`, `app/task/[id].web.tsx`; `components/task-detail/TaskHeader.tsx` | `CollapsibleHeaderProvider` inside `TaskDetailProvider`, around `TaskDetailContent` / `TaskDetailContentWeb`. Spread on the native `ScrollView` (`[id].tsx:112`); on web-wide spread on the **left/main** ScrollView only (`[id].web.tsx:104`), narrow on the single one (`:136`). Ignore the right sidebar scroll. | Title `text-2xl → text-lg`, drop the muted category + pipeline row, keep the badge row and the horizontal action rail. Header is ~160–210px today. |
| 2 | **Portfolio detail** | `app/portfolios/[id].tsx` → `components/tabs/_projects_adaptive.tsx` / `_projects_desktop.tsx`; `components/portfolios/PortfolioScopeHeader.tsx` | No portfolio-specific provider — wrap the returned tree in each shell variant with `CollapsibleHeaderProvider`. Spread on whichever body `ScrollView` is mounted (table `_projects_adaptive.tsx:228` / `_projects_desktop.tsx:239`; timeline `:241`/`:250`). Board view has no vertical scroll → never collapses, acceptable. **Caveat:** the same shell also renders the *unscoped* Projects tab — gate the provider to the `scoped` branch so the plain Projects header isn't affected. | Drop the `MetaStat` + `ProgressMeter` wrap row and the low-confidence paragraph; keep back button + glyph + `EntityTag` + name. ~140–200px today. |
| 3 | **Intelligence Overview (desktop)** | `components/intelligence/_index_desktop.tsx` | Header (`:114`) and `ScrollView` (`:152`) are true siblings under the `flex-1` column (`:111`). Add a local `CollapsibleHeaderProvider` around the return. | **Design call needed:** right side of the header is all filter controls (`PipelineSelector`, `DateRangeControls`, refresh). Safe collapse = shrink the eyebrow + `text-4xl` title only, keep controls put. Skip this screen if that's not worth it. |

### Phase 2 — needs adaptation (scroll lives in a child component, or header is mostly controls)

| # | Screen | Files | Why it's harder |
|---|---|---|---|
| 4 | **Access Manager / roles** | `app/admin/roles.tsx`, `app/admin/roles.web.tsx` | Header is followed by `<View flex-1>` holding `UserAssignmentGrid` / `TeamAssignmentGrid` / `RoleBuilder`; the real `ScrollView` is *inside* each (e.g. `UserAssignmentGrid.tsx:891`). Each of the 3 children (× 2 platforms) must call `useCollapsibleHeaderScroll()` and spread it. Provider slots into `RoleManagerProvider` (`roles.tsx:127`). Collapse the `text-3xl` title + eyebrow, keep BackButton + the 3-way tab strip. |
| 5 | **People / Corporate tab** | `components/tabs/_people_adaptive.tsx` (+ `_people_desktop.tsx`) | Body scroll is inside `TeamWorkspaceContent` (`:279`). Header holds an interactive join-code card (conditional mount, copy-to-clipboard) + a section-tab strip — animating header height fights the card's conditional mount. `CollapsibleHeaderProvider` must wrap the outer `<View flex-1>` (`:125`), above where `RoleManagerProvider` starts (`:278`). Lower priority. |
| 6 | **Intelligence Overview (adaptive audit sub-view)** | `components/intelligence/_index_adaptive.tsx:858` | Header is rendered *inside* the `ScrollView` as `stickyHeaderIndices={[1]}` — already a poor-man's sticky header, not a sibling. Primitive doesn't apply as-is. A sibling-style header/scroll pair does exist on a different tab at `:630`/`:643` if ever wanted. |

### Skip

Headers that already scroll away with the body (no fixed header to collapse):
Dashboard, Analytics, Deadlines, Search, Menu, Profile tabs; Portfolios list;
Notifications (native & web — small header, dialog not screen).

Architecturally mismatched: Tasks tab / Kanban (horizontal board, no single
vertical body scroll); FileHub (`_filehub_*` — deeply nested panes, each with its
own sub-header + scroll; revisit pane-by-pane later); admin/pipelines (editor
canvases). App-global `RetractableTopBar.web.tsx` already has hover-to-peek
retract — leave it.

## Per-screen checklist

1. Nest `<CollapsibleHeaderProvider>` inside the screen's data provider (or wrap
   the return if there is none), enclosing **both** the header and the scroll body.
2. `const headerScroll = useCollapsibleHeaderScroll();` in the content component;
   `{...headerScroll}` on the body `ScrollView`/`FlatList`. Only one scroll per
   screen drives it — pick the primary vertical body.
3. In the header component: `const collapse = useCollapseProgress();` and add
   `useAnimatedStyle` blocks for padding / title scale / secondary-row height.
   Convert the outer `View` (and any wrappers you animate) to `Animated.View`.
   Keep `className` on them — NativeWind v4's `jsxImportSource` makes `className`
   work on `Animated.View` in this app.
4. Decide what survives the collapse (back button, primary badges, tab strips,
   filter controls always stay; big title / description / stat rows are the
   collapse fuel).

## Verification (every screen, per `animation-consistency.md` §2)

- `npx tsc --noEmit` — no new errors in the touched files (project baseline is
  noisy; diff, don't count).
- Load in a browser at **desktop width and mobile-web width (<768px)** — scroll
  down past the header, confirm it condenses smoothly; scroll back to top, confirm
  it restores; fast-flick at the threshold, confirm no strobing (hysteresis).
- Toggle OS "Reduce Motion" — the header must snap between states, not tween.
- Native: check the `.tsx` path too where a `.tsx`/`.web.tsx` split exists
  (task detail, roles) — the spread and `Animated.View` conversions must be
  mirrored.

## Open questions

- **Intelligence desktop (#3):** collapse title-only while keeping filter
  controls, or skip? Needs a design look running.
- **Portfolio shell (#2):** cleanest scoping of the provider given the shell is
  shared between scoped portfolio view and the unscoped Projects tab.
- Thresholds (`64` / `24`) and durations (`200ms`) are fixed in the hook. If a
  screen wants a taller trigger, add an optional prop to
  `CollapsibleHeaderProvider` rather than forking the hook.
