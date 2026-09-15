# Portable File Explorer

This guide documents the Explorer-style collection and inspector implementation
that is in the repository today. It is a developer guide, not a replacement
for domain-owned data, permissions, RPCs, or mutation flows.

## Start here

- `MultiViewList<T>` is the collection primitive at
  `components/common/MultiViewList.tsx`. It provides large, medium, list, and
  details modes, controlled search/group filters, persisted mode preference,
  loading/empty/status states, selection event routing, and the virtualized
  list/grid body.
- `ExplorerCollection<T>` is the transparent adapter at
  `components/filehub/explorer/ExplorerCollection.tsx`. Its props are exactly
  `MultiViewListProps<T>` from `MultiViewList.tsx`; it adds no domain behavior.
- `ExplorerInspectorShell` is the presentation-only layout at
  `components/filehub/explorer/ExplorerInspectorShell.tsx`. It accepts
  `navigation`, `header`, `collection`, and an optional `inspector` slot. On
  desktop it places collection and inspector in bounded panes; on mobile it
  shows one controlled pane at a time and supplies the inspector back action.

Minimal composition:

```tsx
import ExplorerCollection from '@/components/filehub/explorer/ExplorerCollection';
import ExplorerInspectorShell from '@/components/filehub/explorer/ExplorerInspectorShell';

<ExplorerInspectorShell
  header={header}
  navigation={navigation}
  collection={
    <ExplorerCollection
      items={visibleItems}
      keyExtractor={(item) => item.id}
      storageKey="my-surface-files"
      defaultMode="list"
      modes={['large', 'medium', 'list', 'details']}
      renderCard={renderCard}
      renderRow={renderRow}
      columns={columns}
      search={{ value: query, onChange: setQuery }}
      emptyState={{ title: 'No files found' }}
      onItemPress={openItem}
    />
  }
  inspector={selectedItem ? <MyDomainInspector item={selectedItem} /> : undefined}
  mobilePane={selectedItem ? 'inspector' : 'collection'}
  onRequestCollection={() => setSelectedItem(null)}
/>
```

`MultiViewList` requires a bounded-height parent (`flex: 1`). Its `items` are
already filtered by the caller. `storageKey` must be unique per adopting
surface because the selected view mode is persisted as
`multiview:<storageKey>`.

## Which picker belongs where?

Explorer collection selection and form/entity picking are different contracts.
Use `selection` on `MultiViewList`/`ExplorerCollection` when selecting visible
collection items for an item action. The caller owns identities, bulk actions,
the selection bar, and domain side effects.

Use `SearchableMultiSelect` from
`components/common/SearchableMultiSelect.tsx` for searchable, grouped
multi-select inside a popup/sheet, such as people, teams, roles, or agents. It
uses `SearchableMultiSelectItem` rows, supports categories and locked items,
and does not own a scroll container.

Use `FilterPanel`, `FilterChipGroup`, and `FilterDropdown` from
`components/common/FilterPanel.tsx` to narrow a collection. Filters apply live;
the caller computes the resulting `items`. Do not use a form picker as a
substitute for collection selection, and do not put filtering logic inside the
generic explorer shell.

## Selection, filtering, and pagination

Selection is identity-based and scoped to the caller's loaded/visible
collection. Filtering hides rows; it must not silently clear selected IDs that
are merely hidden. When the caller deliberately reconciles selection, use the
pure helpers in `lib/multiSelection.ts` or `useCollectionSelection` from
`hooks/useCollectionSelection.ts`:

- `selectAllVisible` changes only supplied visible IDs.
- `selectRange` selects the inclusive range in caller-supplied visible order.
- `pruneSelection` is explicit; use it only when identities are established
  as no longer valid.
- During refresh or pagination, keep existing selection until the async result
  is known. A paginated “select all” means loaded/visible items unless the
  domain explicitly implements a server-wide operation.

Do not couple inspector focus to bulk selection. Opening an inspector changes
the focused item; going back only closes that inspector. It must not clear bulk
selection or reset pagination.

## Interaction contract

The shared list routes ordinary presses to `onItemPress`, and routes a press to
selection when selection is active or a Ctrl/Cmd/Shift modifier is present.
`lib/webModifierKeys.ts` normalizes React Native Web's synthetic event with live
DOM modifier state, so Windows Ctrl-click and macOS Cmd-click both work.

Adopting surfaces must preserve these behaviors where their domain supports
them:

- Ctrl-click/Cmd-click toggles an item without opening it. Shift-click selects
  the inclusive range using the current visible ordering and anchor.
- Keyboard interaction goes through the selection `onKeyDown` callback. Keep
  focus-visible keyboard access and do not remove global focus treatment.
- `onLongPress` enters or toggles selection on touch/native surfaces. Use 44px
  minimum touch targets for the resulting controls.
- Copy/paste is domain-owned. FileHub's web drag/drop and clipboard behavior is
  implemented in `hooks/useWebDnd.ts` (`useSmartPaste`, `useMarqueeSelect`, and
  drag/drop helpers). Text paste into an editable control remains normal;
  file/image paste is claimed by the upload surface.
- Marquee/rubber-band selection is web-only and starts on empty collection
  space, not on a selectable row. Rows opt into hit testing with
  `data-marquee-id`; the hook returns a container ref and marquee rectangle.

`MultiViewList` forwards `onEndReached` and `listFooter` to its body. Details
mode is a desktop table and a stacked labeled-field presentation below 768px;
do not replace that mobile behavior with a cramped horizontal table.

## FileHub Browse integration

The current Browse integration is `components/intelligence/FileHubBrowse.tsx`:

1. Browse owns `rpc_filehub_browse` calls, debounced query/filter state,
   composite cursor pagination, stale-request rejection, facets, and canonical
   alias grouping (`groupBrowseItems`).
2. It passes grouped file rows to `ExplorerCollection` with the stable
   `filehub-global-browse` storage key and supplies all four render modes.
3. `FileHubDetailPane` remains the domain inspector, supplied to
   `ExplorerInspectorShell` only when a detail row is focused.
4. `Load more` appends the next cursor page. It does not turn selection into a
   server-wide selection.

Browse rows are file records, including canonical alias presentation; they are
not a reason to move FileHub RPCs or selection state into the generic shell.

The full FileHub explorer has a mixed file/folder rule: keep `fileIds` and
`folderIds` as separate identity sets even when the UI displays one combined
selection count. Use the domain's file and folder handlers for each kind. The
helpers in `lib/filehubSelection.ts` preserve this split and remove only
confirmed successes; failed or unreported IDs stay selected so partial failure
is visible and retryable.

## Inspector and capability boundaries

`ExplorerInspectorShell` and `ExplorerCollection` must remain presentation and
collection adapters. They must not import Supabase, `FileHubContext`, router,
storage, upload manager, permissions, project normalization, viewer code, or
domain record types.

The domain owner keeps capabilities and fail-closed action visibility, RPC and
storage calls, data loading, pagination, URL/deep-link authority, viewer
lifecycle, preview/download, versions, activity, confirmations, destructive
semantics, partial-failure reporting, and selection reconciliation.

Use `useAlert().showConfirm` for destructive actions and restore confirmations.
Do not introduce direct deletion when the domain's existing semantics are
archive/bin/restore. Check capability both before rendering an action and again
in its async handler.

Project Files follows three explicit boundaries:

- Working workspace files may expose the capabilities returned by the project
  workspace contract (create, rename, move, delete, upload, replace, version,
  restore, as applicable).
- Client standing files are reference material and remain read-only in Project
  Files.
- Sealed deliverables and their history are immutable; do not expose workspace
  mutation or restore actions for them.

`ProjectFileInspector` at `components/projects/ProjectFileInspector.tsx` owns
project preview/download, versions, activity, and permitted restore behavior.
`FileHubDetailPane` owns the corresponding FileHub detail behavior. Both are
injected into the shell; the shell does not reinterpret their capabilities.

## Responsive targets

Verify every adopting surface at all three widths:

- Around **1400px**: collection and inspector are independent bounded panes;
  modes, toolbar, and inspector actions are not clipped.
- Around **1000px**: intermediate pane widths remain usable; filters, headers,
  pagination, and inspector controls do not overflow or collapse.
- Around **390px**: collection and inspector become a drill-in flow; back
  returns to the collection, selection survives, details stack into labeled
  fields, and controls retain 44px touch targets.

## Adoption checklist

1. Identify item identity and whether files/folders require separate identity
   sets.
2. Keep fetching, filtering, pagination, URL state, capabilities, and
   mutations in the domain component.
3. Compute filtered/loaded `items`; do not add filtering to the shell.
4. Choose a unique `storageKey`, provide card/row/details render contracts,
   and put the collection under a bounded-height parent.
5. Wire controlled `selection` for collection actions; use
   `SearchableMultiSelect` only for popup/sheet entity fields.
6. Preserve Ctrl/Cmd-click, Shift range, keyboard, long-press, copy/paste, and
   marquee behavior where applicable. Stop propagation for nested row actions.
7. Inject the domain inspector and keep mobile back separate from bulk
   selection.
8. Apply fail-closed capabilities, `showConfirm` for destructive/restore
   operations, and explicit partial-failure reconciliation.
9. Keep client/sealed records outside mutable working-file actions.
10. Run focused checks, `git diff --check`, and manually inspect 1400px,
    1000px, and 390px layouts.
