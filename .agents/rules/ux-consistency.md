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

**Layout gotcha:** `MonthGrid`'s day cells are percentage-widths, which only
resolve correctly if every ancestor up to the floating/popup panel has a *definite*
width — give any wrapper around a `Calendar` `flex-1` (or an explicit width), never
a plain `flex-row` child with no sizing. Getting this wrong is the exact bug that
made the day grid render 3 columns wide instead of 7.

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
