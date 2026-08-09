# Onboarding coachmark tour — design

Date: 2026-08-09
Branch: `feat/onboarding-nav-tour`
Status: draft, approved for implementation

## Context

TrustFlow has a first-run onboarding modal (`components/onboarding/WelcomeTour.tsx`) with
static content steps, mounted globally in `app/_layout.web.tsx`, gated on
`profile.onboarded_at` and completed via `rpc_complete_onboarding()`. It does not point at
real UI — no highlighting, no per-element targeting.

We're building a second, complementary mechanism: an interactive coachmark tour that
highlights actual sidebar nav items with a pulsing halo + a positioned tooltip, navigable
with Back/Next/Skip. Inspiration is a reference implementation from another project
(`onboarding reference/`, untracked, not part of this codebase) — its *behavior* (halo +
step tooltip + click-to-open-modal steps) is worth copying; its code is not (raw CSS,
vanilla DOM, duplicated positioning math three times over).

This is explicitly a **draft**: the current tour content (one step per sidebar item) will
be redone once the app's screens are finished, in favor of one tour per menu item. What
must not be thrown away is the **engine** underneath it — it's built generic and reused for
every future tour.

## Goals

- A reusable tour engine: target registry, step data model, halo, tooltip, provider —
  usable by any future feature-specific tour without engine changes.
- One draft tour (`navTourSteps`) walking the sidebar, built mechanically from
  `components/sidebar/constants.ts`'s `SHORTCUTS` so it can't drift from the real menu.
- Chains after `WelcomeTour` finishes, once, for both desktop web (≥768px, `NavRail.web.tsx`)
  and mobile web (<768px, `WebMobileNav.tsx`).
- Engine itself platform-agnostic (uses `measureInWindow`, not `getBoundingClientRect`) so
  native call-sites are a future addition, not a rewrite. **This pass wires up web only** —
  the auto-trigger is gated `Platform.OS === 'web'`.

## Non-goals

- Not replacing `WelcomeTour` — it stays as-is, unmodified.
- Not building per-page tours (Tasks tour, Projects tour, etc.) — that's explicitly future
  work once those screens are finished.
- Not persisting "seen" state server-side. A local `AsyncStorage` flag is enough for a draft
  that gets redone; no DB migration.
- Not wiring native (iOS/Android) nav targets in this pass.

## Architecture

### 1. Target registry

`lib/tour/TourTargetContext.tsx` — a context holding `Map<string, RefObject<View>>` plus
register/unregister functions, and `useTourTarget(id: string)`:

```ts
function useTourTarget(id: string): RefObject<View> {
  // registers a fresh ref under `id` in the shared map on mount,
  // unregisters on unmount; returns the ref to attach to a View
}
```

Any nav item calls this once: `const ref = useTourTarget('nav-tasks')`. Because lookup is by
string id, not by component identity, the *same* step list resolves correctly whichever nav
component is currently mounted (`NavRail.web.tsx` vs `WebMobileNav.tsx`), and later a native
tab bar can register the same ids with zero engine changes.

### 2. Step data model

`lib/tour/types.ts`:

```ts
type TourStep = {
  targetId: string;
  title?: string;
  body: string;
  placement?: TooltipSide; // reuse from lib/tooltipPosition.ts, default 'bottom'
  before?: () => void | Promise<void>; // e.g. open the mobile drawer before measuring
};
```

Plain data, no JSX — any future tour is just a new `TourStep[]` array, no engine change.

### 3. Engine / provider

`lib/tour/TourProvider.tsx` — holds `{ steps: TourStep[] | null, index: number }`, exposes
via context: `startTour(steps: TourStep[])`, `next()`, `back()`, `skip()`. Mounted once in
`app/_layout.web.tsx` next to `<WelcomeTour />`.

### 4. Rendering

`lib/tour/TourOverlay.tsx` — rendered by the provider whenever a tour is active. For the
current step: resolve the target ref from the registry, `measureInWindow` it, render:

- `Halo` (`lib/tour/Halo.tsx`) — new component, a `View` positioned over the measured rect.
  Pulse animation via `useSharedValue` + `withTiming` (loop), gated by `useReducedMotion()`,
  per `animation-consistency.md` case 2. Not a CSS `@keyframes` port from the reference.
- `TourTooltip` (`lib/tour/TourTooltip.tsx`) — new component (existing `Tooltip.tsx` is
  hover/long-press single-label only, doesn't support step nav). Positioned via the
  **existing** `positionTooltip()` from `lib/tooltipPosition.ts` (same flip/clamp math
  `Tooltip.web.tsx`/`Tooltip.tsx` already use — not reimplemented). Styled inline from
  `useThemeColors`, matching `Tooltip`'s established exception to the "no inline styles"
  rule (portaled content doesn't inherit theme token classes). Shows title/body, a step
  counter, Back/Next/Skip buttons.
- Portaled: web renders via `createPortal(..., document.body)` (matching
  `Tooltip.web.tsx`); this pass only needs the web portal since native isn't wired up yet,
  but the component boundary (`TourOverlay.web.tsx` vs `TourOverlay.tsx`) is split now so
  a native renderer can be added later without touching the engine.

### 5. Draft tour content

`lib/tour/navTour.ts` — exports `navTourSteps`, generated from `SHORTCUTS`
(`components/sidebar/constants.ts`) mapping each permission-visible entry to a `TourStep`
with `targetId: 'nav-' + shortcut.key` (or equivalent stable key already on `SHORTCUTS`) and
placeholder body text ("This is your {label}.").

Nav components register targets:
- `NavRail.web.tsx` — each rendered `SHORTCUTS` item calls `useTourTarget('nav-' + key)` on
  its wrapping `View`.
- `WebMobileNav.tsx` — same ids, on its own item rendering. Steps whose target lives behind
  the closed drawer get `before: () => openDrawer()` so the step opens it first (mirrors the
  reference's "open modal before highlighting inside it" steps).

### 6. Trigger & persistence

- `AsyncStorage` key `nav_tour_seen_v1` (same pattern as `ThemeContext`'s `STORAGE_KEYS`),
  read once on mount.
- When `WelcomeTour` completes (its existing completion callback / RPC resolution), and
  `Platform.OS === 'web'` and the flag isn't set: `startTour(navTourSteps)`.
- Skip or reaching the last step both write the flag and call `endTour()`.

## Error handling

- If a step's `targetId` isn't currently registered (e.g. permission hides that nav item, or
  timing race before mount), `TourOverlay` skips straight to the next step rather than
  rendering a halo over nothing — mirrors the reference's `if (!target) return resolve('skip')`.
- If `navTourSteps` ends up empty (all targets missing — shouldn't happen, but degenerate
  case), the tour never starts; no broken empty overlay state.

## Testing / manual verification

Per `.agents/rules/walkthroughs.md`, at least two widths:

1. **Desktop (~1400px)**: log in as a fresh user (or manually clear `onboarded_at` /
   `nav_tour_seen_v1`), complete `WelcomeTour`, confirm the nav tour auto-starts, halos land
   correctly on each `NavRail` item in order, Back/Next/Skip all work, tour doesn't re-fire
   on reload after completion.
2. **Mobile web (~390px)**: same flow; confirm steps targeting items behind the closed
   `WebMobileNav` drawer open it automatically before highlighting, and the halo/tooltip
   don't get clipped or mispositioned in the drawer's layout.
3. **Reduced motion**: with OS/browser "reduce motion" on, confirm the halo shows statically
   (no pulse) rather than animating.
4. Confirm native (iOS/Android) is entirely unaffected — no crash, no tour, since no native
   call-sites register targets and the trigger is `Platform.OS === 'web'`-gated.
