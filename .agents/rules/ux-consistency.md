---
trigger: always_on
---

# TrustFlow Modal & Sheet Standards

## Popup

The universal overlay. Default choice for any popup/modal/sheet unless you have a reason to use something else.

- **`presentation="auto"`** (recommended) — centered card on desktop (>= 768px), bottom sheet on mobile. Native always renders as sheet.
- **`presentation="centered"`** — always centered, even on mobile.
- **`presentation="sheet"`** — always a bottom sheet.
- **`maxWidth`** — centered card width cap in px (default 420). Use `sheetMaxWidth` to cap sheet width on wide viewports while keeping it a sheet.
- **`sideMenu`** — renders a fixed-width column to the left of children for two-pane layouts. Centered-presentation only. Always used with `<SidebarLayout>`.
- **`backdropBlur`** — frosted blur instead of solid dim backdrop. Centered only.
- **`overlays`** — position-fixed content (dropdowns, date pickers) that escape the card's `overflow: hidden`. Centered only.

**When to use:** Everything. Start with `Popup presentation="auto"`.

## DraggableSheet

Bottom sheet only. Always has a drag handle bar at the top. On native it's draggable via PanResponder; on web it's static.

- **Use directly** when you never want a centered variant (always a drawer).
- **Use via Popup** when the UI should adapt between centered and sheet.
- **Props:** `maxHeight` (default '85%'), `scrollable` (default true), `footer`, `title`, `dismissible`, `dimBackdrop`.

**When to use:** Standalone bottom sheets, or when you're building a custom mobile-only layout that doesn't use Popup.

## SidebarLayout

Pre-built scrollable column for the left pane of two-column Popups.

- **`width`** — sidebar width in px (default 288). Used values: 288 (EditTaskModal), 320 (CreateTaskModal, RoleEditorSheet).
- **`header`** — sticky header above the scroll body with a bottom border. Use when the sidebar has a title/info section that should stay visible (EditTaskModal's "Modify Task" + task title).
- **`style`** — extra styles on the outer View. Use `borderRightWidth` when inside `Popup.sideMenu` (Popup already adds border between sideMenu and children, but standalone usage may need it).
- Children are wrapped in a ScrollView with 32px padding.

**When to use:** Always inside `Popup.sideMenu` for two-pane composers. Not used standalone.

## Calendar

The universal date picker. **Never build a one-off date grid or pull in a calendar
library.** Every date/date-range input goes through `components/common/Calendar.tsx`.
It auto-detects its presentation from the props you pass — you never set a "mode"
prop for this part:

- **Floating** (`floatingStyle` prop provided) — a positioned panel anchored near a
  trigger, viewport-safe, sized/flipped via `useCalendarPosition()` from
  `lib/calendarPicker`. Use for calendar icons inline in a form row (task due dates,
  expiry dates) where the field stays visible while picking.
- **Popup** (`visible`/`onClose` props provided) — renders through `Popup`
  (`presentation="auto"`) so it's centered on desktop, a sheet on mobile, for free.
  Use when the date picker is the primary/only action, not an inline field.
- **Inline** (neither prop given) — a bare grid embedded in a parent (a manual
  `Popup` wrapper, a `ScrollView` body, a form section). Use when the calendar is
  one field among several inside a container you already control.

Other props: `mode="single" | "range"` (range needs `onApplyRange`, `maxDays`,
`onUpgrade` for plan-cap enforcement — see `DateRangeFilter.tsx` for the reference
implementation), `showQuickSelect` (Today/Tomorrow/+3 Days/+1 Week/+2 Weeks/+1 Month
sidebar), `dual_display` (two months side by side — Popup mode only, must be
explicit, never auto-detected from viewport width), `accentColor`/`rangeColor`.

**Range inputs — canonical control is `DateRangePillPicker`** (`DateRangeFilter.tsx`),
not two floating single-date `Calendar`s and not an inline `mode="range"` grid: a
From → To pill row that opens one shared range-mode Calendar popup. Use it for every
start/end date pair (report custom timeframes, task start/deadline — issue #262).
Pass `fromPlaceholder`/`toPlaceholder` to label the unset pills (e.g. "Start" /
"Deadline") and `onClear` to render a trailing clear button; derive any
start-after-end warning in the parent. When only one date is edited at a time (a
single field), the single-date Floating/Inline forms above still apply.

**Layout gotcha:** `MonthGrid`'s day cells are percentage-widths, which only
resolve correctly if every ancestor up to the floating/popup panel has a *definite*
width — give any wrapper around a `Calendar` `flex-1` (or an explicit width), never
a plain `flex-row` child with no sizing. Getting this wrong is the exact bug that
made the day grid render 3 columns wide instead of 7.

## Tooltip

Hint text on hover/focus (web) or long-press (native). **Never build a one-off
absolute-positioned hint `View`** — every tooltip goes through
`components/common/Tooltip.tsx` / `.web.tsx` (issue #135 is the ongoing rollout).

```tsx
<Tooltip label="Archive task"><IconButton ... /></Tooltip>
```

- **Props:** `label` (required — empty label renders the child bare), `side`
  (`'top' | 'bottom' | 'left' | 'right'`, default `'top'`), `disabled`,
  `className`/`style` on the wrapper, and `delay` (web only, default 350ms).
- **Two implementations, one API.** Web portals the bubble to `document.body`
  with `position: fixed`; native renders it in a transparent `Modal`. Both are
  therefore immune to `overflow: hidden` clipping and z-index fights — never
  reach for a manual portal or `zIndex` bump around a Tooltip.
- **Placement is not your job.** Both variants call `positionTooltip()` from
  `lib/tooltipPosition.ts`, which flips to the opposite side when the preferred
  one lacks room and clamps the bubble inside the viewport. `side` is a
  preference, not a guarantee. Change placement math there, not in a component.
- **Layout gotcha:** Tooltip wraps the child in a `View`, so it takes the
  child's place in the layout. If the child relied on `flex-1`, `self-end`,
  `absolute`, etc., move those classes to the Tooltip's `className` or the child
  will collapse or mis-position.
- **Styling is inline from `useThemeColors` on purpose.** Theme token classes go
  black inside a portal / RN `Modal` on web — this is the one sanctioned
  exception to the "no inline styles" rule in `ui-consistency.md`. Don't
  "fix" it back to `className` tokens.
- **Native caveat:** releasing a long-press can still fire the child's
  `onPress`. Known and accepted (`ponytail:` comment in `Tooltip.tsx`).
- **Don't use it for:** anything interactive (links, buttons, inputs inside the
  bubble) — the web bubble is `pointer-events: none`. That's a popover; use
  `Popup`. And don't use a tooltip as the *only* carrier of information a user
  needs to complete a task — mobile discoverability is a long-press away.

## Filter Panels

The standardized filter UI (issue #208), used by **Tasks** and **Reports**. Never build a
one-off filter bar, chip wall, or filter modal — compose these primitives instead:

- **`SlideDownPanel`** (`components/common/SlideDownPanel.tsx`) — a *controlled*
  animated expand/collapse container. Web animates height via reanimated
  `withTiming`, native uses `LayoutAnimation`, both behind `useReducedMotion()`.
  Owns only the animation — no trigger, no open/close callback. Lazy-mounts on
  first open, and `maxHeight` caps the region with an internal ScrollView.
- **`FilterPanel`** (`components/common/FilterPanel.tsx`) — `SlideDownPanel` +
  a trigger button (or a render-prop/custom trigger). Controlled or
  uncontrolled; `footer` renders an optional Apply/Clear row under the body.
- **`FilterSection`** — a labelled group (`.uppercase tracking-widest` caption).
- **`FilterChipGroup`** — a wrapping (`flex-row flex-wrap gap-2`) row of toggle
  chips. Use for *short* categorical dimensions (e.g. Priority, Category).
- **`FilterDropdown`** — label + active-count badge + chevron opening an inline
  option list, multi- or single (`single`) select. Use for *long* dimensions
  (Projects, Managers, Due Date) and for Sort. Running option lists scroll
  internally (capped), so one dropdown never blows out the panel height.

### Agreed conventions

- **Auto-apply, no Apply/Save/Cancel.** Filtering the list is live — there is
  no commit step and no footer of action buttons. The body is fully controlled:
  it reads `filters` and writes via `onChange` on every interaction (no local
  draft copy to resync — a mirrored draft state is a reseed/auto-apply loop
  waiting to happen).
- **One "Clear Filters" button on every surface.** Positioned top-right of the
  panel header, danger-tinted, **always visible but disabled/muted when nothing
  is active**. One tap resets to defaults without confirmation and does **not**
  close the panel.
- **Toolbar trigger is an icon-only button** (`filter` glyph) matching the rest
  of the toolbar's square icon buttons (`h-14 w-14` desktop, `p-2.5` adaptive).
  No text label. The active-count badge is **absolutely positioned** on the
  button's corner and **capped at `9+`**, so the button's width never changes
  as the count grows.
- **Chips for short sets, dropdowns for long sets.** Avoid making 2–4 item
  dimensions (priority, status, type) open a dropdown; a second tap to reach a
  handful of options is friction.
- **Dropdowns sit side by side** in the panel (`flex-row flex-wrap` with
  `flex-1 min-w-[220px]` children). Do **not** rely on `grid-cols-*` classes —
  CSS grid does not render in this app's RN-web build; use flex-wrap.

## When to use what

| You need this | Use this |
|---------------|----------|
| A popup/modal/sheet of any kind | `Popup presentation="auto"` |
| Two-pane layout (form + sidebar) | `Popup sideMenu={<SidebarLayout>}` |
| Always a bottom sheet, never centered | `DraggableSheet` directly |
| Quick confirmation dialog | `useAlert().showConfirm()` |
| Styled confirmation dialog | `ConfirmModal` |
| Saving/loading overlay | `LoadingOverlay` |
| Initial data load placeholder | `SkeletonBlock` / `SkeletonList` |
| Any date or date-range input | `Calendar` (see Calendar section above) |
| An animated filter panel under a toolbar trigger | `FilterPanel` / `SlideDownPanel` (see Filter Panels above) |
| A short categorical filter (~2-6 options) | `FilterChipGroup` inside a filter panel |
| A long or sortable filter dimension | `FilterDropdown` (multi or `single`) |
| Hint text on an icon/control | `Tooltip` (hover on web, long-press on native) |
| Hint content with links/buttons in it | `Popup` — not `Tooltip` |

## Desktop density: use the width, go multi-column

A desktop Popup that shows a lot at once must **not** be a single narrow column of
stacked sections with a long scroll. Desktop has horizontal room — use it.

> **`maxWidth` is a required prop, enforced by the compiler.** Mandatory whenever
> `presentation` can resolve to `centered` — `'centered'`, `'auto'`, or a runtime
> union like `isDesktop ? 'centered' : 'sheet'`. Rejected (`maxWidth?: never`) for a
> sheet-only Popup, which never uses it. Omitting it is a build error, not a silent
> narrow dialog.
>
> **Why enforced rather than merely written down.** `maxWidth` used to default to
> `420`, which made *"I chose a narrow dialog"* and *"I never thought about it"*
> indistinguishable — doing nothing produced a violation and nothing objected.
> #182's batch-config wizard shipped as exactly the tall single-column scroll this
> section forbids. Removing the default turned that invisible layout bug into a
> build error and immediately surfaced **25 more call sites across 16 files** with
> the same omission. Those were annotated `maxWidth={420}` — their existing width,
> preserved deliberately — so the status quo is a recorded decision instead of an
> accident. Several are info-dense and should be widened; that is a design change
> that needs someone looking at it running, not a mechanical pass.
>
> **Do not restore a default to make this easier. The friction is the feature.**
>
> Second lesson, bigger than the first: this section sat **uncommitted in one
> working tree** while the wizard was built. Every agent worktree branches from a
> committed ref, so the rule did not exist for the people breaking it. A rule that
> is not committed cannot be followed — keep this file in git, not in a scratch
> edit.

- **`maxWidth={420}` or narrower is a one-column dialog.** Any info-dense modal
  must raise it (720–1100px is the useful range) or the columns have nowhere to go.
- **2 columns** when the content has two distinct groups (form + preview, fields +
  list, details + activity).
- **3 columns** when there are genuinely three peer groups and `maxWidth >= ~1000`.
  Stop at 3 — a 4th column means the modal should be a screen, not a popup.
- **Nav/context pane → `sideMenu={<SidebarLayout>}`**, not a hand-rolled column.
  Columns beyond that are a plain `flex-row` with `flex-1` children and `gap-6`.
- **Give each column its own scroll**, not one scroll for the whole card, so a long
  list in one column doesn't push the others out of view.
- **Every column needs a definite width** (`flex-1` or explicit) — percentage-based
  children like `Calendar`'s `MonthGrid` render wrong otherwise (see Calendar gotcha).

Columns are desktop-only. Below `768px` they collapse to the stacked/drill-in
patterns below — a `flex-row` that survives to mobile is a bug, not a layout.

### Existing modals to copy from

| Modal | `maxWidth` | Layout |
|---|---|---|
| `CreateTaskModal.web.tsx:1100` | 1200 | `sideMenu` (SidebarLayout 320) + main pane, fixed `height: 800`, `overlays` for the calendars/dropdowns |
| `EditTaskModal.web.tsx:620` | 1100 | `sideMenu` (SidebarLayout 288, sticky `header`) + main pane with paired `flex-row gap-6` field columns |
| `UserAssignmentGrid.tsx:269` | 1150 | No `sideMenu` — header band + multi-column body inside the card |
| `RoleEditorSheet.web.tsx:308` | 1020 | `SidebarLayout` two-pane; below 768 the whole thing becomes a `DraggableSheet` with the identity → permissions drill-in |
| `IntelligenceModals.tsx:27` | 896 | Mid-density single pane — the ceiling before you should be splitting into columns |
| `ConfirmModal.tsx:90` (512), `ShareFile.tsx:124` (400) | 512 / 400 | Correctly single-column — one decision, don't widen these |

## Mobile overflow: what to do when content is too much

If the content that fits in a two-column Popup on desktop does **not** fit comfortably in a single bottom sheet on mobile:

### 1. First try: stack sections in one sheet (simple overflow)
Keep it in one DraggableSheet with sections stacked vertically. Works when the total content is moderate. See native `RoleEditorSheet.tsx` for reference.

### 2. If still too much: drill-in navigation
Split into two screens within the same DraggableSheet using a `mobilePage` state (`'identity' | 'permissions'`):

- **Page 1 — identity:** form fields + a summary row that navigates to page 2
- **Page 2 — picker:** dedicated full-height list/search with a back button

Implemented in `RoleEditorSheet.web.tsx`:
```
const [mobilePage, setMobilePage] = useState<'identity' | 'permissions'>('identity');
```
On page 1, a "Permissions" row shows `{activeCount} selected >` and calls `setMobilePage('permissions')`. Page 2 has a `<` back button at the top and renders the full permissions list with search.

### 3. If the picker itself is huge: dedicated picker sheet
Same drill-in pattern, but the permissions screen gets a pinned search bar, full-height ScrollView, and its own header with back button. This way the search + keyboard has the entire viewport instead of being cramped in a multi-section sheet.

**Rule of thumb:** If you're tempted to add a search bar inside a multi-section bottom sheet, it needs its own dedicated screen.

### Desktop → mobile mapping template

```
function MyModal({ visible, onClose }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  if (!isDesktop) {
    const [page, setPage] = useState<'form' | 'picker'>('form');
    return (
      <DraggableSheet visible={visible} onClose={onClose} dimBackdrop maxHeight="95%">
        {page === 'form' ? (
          <>
            {/* Header + identity fields + summary row to navigate */}
            <ScrollView>...<TouchableOpacity onPress={() => setPage('picker')}>
              <Text>Items selected ></Text>
            </TouchableOpacity></ScrollView>
            {/* Footer: Cancel/Save */}
          </>
        ) : (
          <>
            {/* Header with back button + search */}
            {/* Full-height scrollable list */}
          </>
        )}
      </DraggableSheet>
    );
  }

  return (
    <Popup presentation="centered" sideMenu={<SidebarLayout>}>
      {/* Form content */}
    </Popup>
  );
}
```

## Keeping this doc current

Whenever you add a new modal, sheet, or overlay pattern — or standardize something that was previously ad-hoc — update this doc with the new convention. It should always reflect the actual primitives and rules in use, not an aspirational design system.
