import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import {
  FlatList,
  LayoutChangeEvent,
  ScrollView,
  StyleProp,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { FilterChip, SegmentedControl } from '@/components/entities/EntityUI';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonList } from '@/components/Skeleton';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  ALL_MULTIVIEW_MODES,
  clampMode,
  computeColumns,
  isMultiViewMode,
  type MultiViewMode,
} from '@/lib/multiViewList';

export type { MultiViewMode } from '@/lib/multiViewList';

/**
 * Issue #249 — one reusable list primitive with a Windows-Explorer-style
 * density switcher (large icons / medium icons / list / details), built once
 * so surfaces that each want the same view-mode treatment (Role/Team
 * registries #219, FileHub Channels #242, Alert Rules) share it instead of
 * hand-rolling their own toggle.
 *
 * This component owns: the toolbar (search box + group chips + mode
 * switcher — visual only), the four density layouts, persisted view-mode
 * preference, empty/status states, and virtualized rendering so it holds up
 * at 100s of items. It does NOT own search/group FILTERING — `items` is
 * assumed to already be the filtered set (same contract as ProjectsTable's
 * `sortedRows`), because whether filtering happens client-side or via a
 * server RPC is a decision only the caller can make.
 *
 * Density -> render prop mapping (Windows Explorer: large icons and medium
 * icons show the same identity, just bigger/smaller — so both grid modes
 * share one `renderCard` render prop and differ only in column count):
 *   large / medium -> renderCard(item, density)  (virtualized grid)
 *   list           -> renderRow(item)            (virtualized single column)
 *   details        -> columns[]                  (desktop: table; mobile:
 *                                                   stacked field list —
 *                                                   ux-consistency.md's
 *                                                   Path B, a dense table is
 *                                                   a bad mobile paradigm)
 *
 * Expects a bounded-height parent (a Popup body, a screen with flex:1), the
 * same contract every other FlatList in this app already relies on
 * (FileHubBin, CommentsSection, notifications) — it does not manage its own
 * viewport height.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type MultiViewColumn<T> = {
  key: string;
  label: string;
  /** Relative width, same convention as ProjectsTable's row (e.g. 2.6 for a name column, 1 for a stat). Default 1. */
  flex?: number;
  align?: 'left' | 'center' | 'right';
  render: (item: T) => React.ReactNode;
};

export type MultiViewGroupOption = {
  id: string;
  label: string;
  color?: string | null;
};

export type MultiViewEmptyState = {
  icon?: string;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
};

export type MultiViewStatusBanner = {
  /** danger = something failed and retrying might help. warning = the caller can't/shouldn't do this right now (permission, unavailable backend) — a different situation than a failure, so it gets the state-warning token, not danger. */
  tone: 'danger' | 'warning';
  icon?: string;
  title: string;
  body?: string;
};

export interface MultiViewListProps<T> {
  items: T[];
  keyExtractor: (item: T) => string;

  /** Grid card for 'large' and 'medium' — same render prop, `density` tells it how much to show. */
  renderCard: (item: T, density: 'large' | 'medium') => React.ReactNode;
  /** Compact single-row content for 'list' mode. The row wrapper (padding, divider, press) is provided — this is just the row's contents. */
  renderRow: (item: T) => React.ReactNode;
  /** Column defs for 'details' mode. */
  columns: MultiViewColumn<T>[];

  onItemPress?: (item: T) => void;

  /** Namespaces the persisted view-mode preference (AsyncStorage key `multiview:<storageKey>`) — must be unique per adopting surface. */
  storageKey: string;
  defaultMode?: MultiViewMode;
  /** Restrict which of the four modes this surface offers. Default: all four. */
  modes?: MultiViewMode[];

  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  groupFilter?: {
    options: MultiViewGroupOption[];
    activeId: string | null;
    onChange: (id: string | null) => void;
    allLabel?: string;
  };

  loading?: boolean;
  /** Renders instead of the item list — a fetch failure or a "you can't see this" state. Takes precedence over `emptyState`. */
  statusBanner?: MultiViewStatusBanner | null;
  /** Shown when `items` is empty and there's no `statusBanner`. Caller computes title/body (e.g. "no results" vs "nothing yet") since only it knows whether a search/filter is active — same split as ProjectsTable's own empty state. */
  emptyState: MultiViewEmptyState;

  /** Min card width (px) used to compute grid columns. Defaults: large 260, medium 160. */
  cardMinWidth?: number;
  mediumCardMinWidth?: number;
  maxLargeColumns?: number;
  maxMediumColumns?: number;
  /** Caps the grid (large/medium) body's total width so cards never span an ultrawide slot; the grid is left-aligned under the cap. Column math uses the capped width so the card count matches what's actually visible. List/details ignore it (a table wants the full width). */
  maxGridWidth?: number;

  onEndReached?: () => void;
  listFooter?: React.ReactElement | null;

  style?: StyleProp<ViewStyle>;
  testIDPrefix?: string;
}

// ── Toolbar meta ─────────────────────────────────────────────────────────

const MODE_META: Record<MultiViewMode, { label: string; icon: string }> = {
  large: { label: 'Large', icon: 'th-large' },
  medium: { label: 'Medium', icon: 'th-large' },
  list: { label: 'List', icon: 'list-ul' },
  details: { label: 'Details', icon: 'table' },
};

// ── Component ────────────────────────────────────────────────────────────

export default function MultiViewList<T>({
  items,
  keyExtractor,
  renderCard,
  renderRow,
  columns,
  onItemPress,
  storageKey,
  defaultMode,
  modes = ALL_MULTIVIEW_MODES as MultiViewMode[],
  search,
  groupFilter,
  loading = false,
  statusBanner = null,
  emptyState,
  cardMinWidth = 260,
  mediumCardMinWidth = 160,
  maxLargeColumns = 4,
  maxMediumColumns = 6,
  maxGridWidth,
  onEndReached,
  listFooter,
  style,
  testIDPrefix,
}: MultiViewListProps<T>) {
  const c = useThemeColors();
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = windowWidth >= 768;

  const [rawMode, setRawMode] = usePersistedState<MultiViewMode>(
    `multiview:${storageKey}`,
    defaultMode ?? modes[0] ?? 'list',
    isMultiViewMode,
  );
  const mode = clampMode(rawMode, modes);

  // Measured slot width, not window width — this primitive can sit in a
  // narrower sidebar column on a wide desktop screen (SidebarLayout, a
  // Popup's non-sideMenu pane), and the grid should respond to that.
  const [slotWidth, setSlotWidth] = useState(windowWidth);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - slotWidth) > 1) setSlotWidth(w);
  };

  const gridSlot = maxGridWidth != null ? Math.min(slotWidth, maxGridWidth) : slotWidth;
  const largeColumns = computeColumns(gridSlot, cardMinWidth, maxLargeColumns);
  const mediumColumns = computeColumns(gridSlot, mediumCardMinWidth, maxMediumColumns);

  // Value-driven cross-fade on mode change (animation-consistency.md case 2 —
  // manual reanimated, not the declarative entering/exiting props, which
  // don't paint on this app's web build). Gated by useReducedMotion like
  // every other animation in the app.
  const reduceMotion = useReducedMotion();
  const fade = useSharedValue(1);
  useEffect(() => {
    fade.value = reduceMotion ? 1 : 0;
    fade.value = withTiming(1, { duration: reduceMotion ? 0 : 180 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const showToolbar = !!search || !!groupFilter || modes.length > 1;

  const searchBox = search && (
    <View
      className={`flex-row items-center bg-surface-background border border-surface-border rounded-xl px-3 gap-2 ${isDesktop ? 'w-[240px] py-2' : 'w-full py-2.5'}`}
    >
      <FontAwesome name="search" size={12} color={c.textMuted} />
      <TextInput
        value={search.value}
        onChangeText={search.onChange}
        placeholder={search.placeholder ?? 'Search'}
        placeholderTextColor={c.textDim}
        accessibilityLabel={search.placeholder ?? 'Search'}
        className="flex-1 text-typography-main text-sm bg-transparent"
      />
      {search.value.length > 0 && (
        <TouchableOpacity onPress={() => search.onChange('')} hitSlop={8} accessibilityLabel="Clear search">
          <FontAwesome name="times-circle" size={12} color={c.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );

  const groupChips = groupFilter && (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={isDesktop ? undefined : { flexGrow: 0 }}
      className={isDesktop ? 'flex-1' : ''}
      contentContainerStyle={{ gap: 8, alignItems: 'center' }}
    >
      <FilterChip
        label={groupFilter.allLabel ?? 'All'}
        active={!groupFilter.activeId}
        onPress={() => groupFilter.onChange(null)}
        touchTarget={!isDesktop}
      />
      {groupFilter.options.map(opt => (
        <FilterChip
          key={opt.id}
          label={opt.label}
          dotColor={opt.color ?? c.primary}
          active={groupFilter.activeId === opt.id}
          onPress={() => groupFilter.onChange(groupFilter.activeId === opt.id ? null : opt.id)}
          touchTarget={!isDesktop}
        />
      ))}
    </ScrollView>
  );

  const modeSwitcher = modes.length > 1 && (
    <SegmentedControl
      size="sm"
      value={mode}
      onChange={setRawMode}
      options={modes.map(m => ({ value: m, label: MODE_META[m].label, icon: MODE_META[m].icon }))}
    />
  );

  const toolbar = showToolbar && (
    <View
      className={isDesktop ? 'flex-row items-center gap-3 px-1 pb-3' : 'pb-3'}
      style={{ gap: isDesktop ? undefined : 10 }}
    >
      {searchBox}
      {groupChips}
      {isDesktop ? (
        modeSwitcher
      ) : (
        modes.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
            {modeSwitcher}
          </ScrollView>
        )
      )}
    </View>
  );

  const body = loading ? (
    <View className="px-1 py-2">
      <SkeletonList count={isDesktop ? 6 : 4} itemHeight={mode === 'details' && isDesktop ? 44 : mode === 'list' ? 56 : 140} />
    </View>
  ) : statusBanner ? (
    <StatusBanner {...statusBanner} />
  ) : items.length === 0 ? (
    <EmptyState {...emptyState} />
  ) : mode === 'large' || mode === 'medium' ? (
    <View
      style={
        maxGridWidth != null
          ? { width: '100%', maxWidth: maxGridWidth, alignSelf: 'flex-start' }
          : undefined
      }
    >
      <GridBody
        items={items}
        keyExtractor={keyExtractor}
        density={mode}
        numColumns={mode === 'large' ? largeColumns : mediumColumns}
        renderCard={renderCard}
        onItemPress={onItemPress}
        onEndReached={onEndReached}
        listFooter={listFooter}
      />
    </View>
  ) : mode === 'list' ? (
    <ListBody
      items={items}
      keyExtractor={keyExtractor}
      renderRow={renderRow}
      onItemPress={onItemPress}
      onEndReached={onEndReached}
      listFooter={listFooter}
    />
  ) : isDesktop ? (
    <DetailsTable
      items={items}
      keyExtractor={keyExtractor}
      columns={columns}
      onItemPress={onItemPress}
      onEndReached={onEndReached}
      listFooter={listFooter}
    />
  ) : (
    <DetailsStacked
      items={items}
      keyExtractor={keyExtractor}
      columns={columns}
      onItemPress={onItemPress}
      onEndReached={onEndReached}
      listFooter={listFooter}
    />
  );

  return (
    <View onLayout={onLayout} style={[{ flex: 1 }, style]} testID={testIDPrefix ? `${testIDPrefix}-multiview` : undefined}>
      {toolbar}
      <Animated.View style={[{ flex: 1 }, fadeStyle]}>{body}</Animated.View>
    </View>
  );
}

// ── Status / empty ───────────────────────────────────────────────────────

function StatusBanner({ tone, icon, title, body }: MultiViewStatusBanner) {
  const c = useThemeColors();
  const tint = tone === 'danger' ? c.danger : c.warning;
  return (
    <View
      className={`mx-1 my-4 px-4 py-3 rounded-xl border flex-row items-start gap-3 ${
        tone === 'danger' ? 'bg-state-danger/10 border-state-danger/30' : 'bg-state-warning/10 border-state-warning/30'
      }`}
    >
      <FontAwesome name={(icon ?? (tone === 'danger' ? 'exclamation-triangle' : 'lock')) as any} size={14} color={tint} style={{ marginTop: 2 }} />
      <View className="flex-1">
        <Text className={`text-xs font-bold ${tone === 'danger' ? 'text-state-danger' : 'text-state-warning'}`}>{title}</Text>
        {!!body && <Text className="text-typography-muted text-[11px] mt-1 leading-4">{body}</Text>}
      </View>
    </View>
  );
}

// ── Grid (large / medium) ────────────────────────────────────────────────

function GridBody<T>({
  items,
  keyExtractor,
  density,
  numColumns,
  renderCard,
  onItemPress,
  onEndReached,
  listFooter,
}: {
  items: T[];
  keyExtractor: (item: T) => string;
  density: 'large' | 'medium';
  numColumns: number;
  renderCard: (item: T, density: 'large' | 'medium') => React.ReactNode;
  onItemPress?: (item: T) => void;
  onEndReached?: () => void;
  listFooter?: React.ReactElement | null;
}) {
  return (
    <FlatList
      // RN throws if numColumns changes on a live FlatList — key it so a
      // resize (window or slot) or a mode swap remounts cleanly instead.
      key={`grid-${density}-${numColumns}`}
      style={{ flex: 1 }}
      data={items}
      keyExtractor={keyExtractor}
      numColumns={numColumns}
      columnWrapperStyle={numColumns > 1 ? { gap: 12 } : undefined}
      contentContainerStyle={{ gap: 12, padding: 12 }}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={{ flex: 1 }}
          disabled={!onItemPress}
          onPress={onItemPress ? () => onItemPress(item) : undefined}
          accessibilityRole={onItemPress ? 'button' : undefined}
        >
          {renderCard(item, density)}
        </TouchableOpacity>
      )}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      ListFooterComponent={listFooter ?? undefined}
      showsVerticalScrollIndicator={false}
    />
  );
}

// ── List ─────────────────────────────────────────────────────────────────

function ListBody<T>({
  items,
  keyExtractor,
  renderRow,
  onItemPress,
  onEndReached,
  listFooter,
}: {
  items: T[];
  keyExtractor: (item: T) => string;
  renderRow: (item: T) => React.ReactNode;
  onItemPress?: (item: T) => void;
  onEndReached?: () => void;
  listFooter?: React.ReactElement | null;
}) {
  return (
    <FlatList
      style={{ flex: 1 }}
      data={items}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => (
        <TouchableOpacity
          disabled={!onItemPress}
          onPress={onItemPress ? () => onItemPress(item) : undefined}
          accessibilityRole={onItemPress ? 'button' : undefined}
          className={`px-4 ${index === items.length - 1 ? '' : 'border-b border-surface-border/50'} ${onItemPress ? 'hover:bg-surface-overlay/40 transition-colors' : ''}`}
          style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 10 }}
        >
          {renderRow(item)}
        </TouchableOpacity>
      )}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      ListFooterComponent={listFooter ?? undefined}
      showsVerticalScrollIndicator={false}
    />
  );
}

// ── Details — desktop table ─────────────────────────────────────────────

function ColumnCell<T>({ col, item }: { col: MultiViewColumn<T>; item: T }) {
  return (
    <View
      style={{ flex: col.flex ?? 1 }}
      className={`pr-3 ${col.align === 'right' ? 'items-end' : col.align === 'center' ? 'items-center' : ''}`}
    >
      {col.render(item)}
    </View>
  );
}

function DetailsTable<T>({
  items,
  keyExtractor,
  columns,
  onItemPress,
  onEndReached,
  listFooter,
}: {
  items: T[];
  keyExtractor: (item: T) => string;
  columns: MultiViewColumn<T>[];
  onItemPress?: (item: T) => void;
  onEndReached?: () => void;
  listFooter?: React.ReactElement | null;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View className="flex-row items-center px-5 py-2 border-b border-surface-border bg-surface-background/50">
        {columns.map(col => (
          <View key={col.key} style={{ flex: col.flex ?? 1 }} className={`pr-3 ${col.align === 'right' ? 'items-end' : col.align === 'center' ? 'items-center' : ''}`}>
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em]">{col.label}</Text>
          </View>
        ))}
      </View>
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={keyExtractor}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            disabled={!onItemPress}
            onPress={onItemPress ? () => onItemPress(item) : undefined}
            accessibilityRole={onItemPress ? 'button' : undefined}
            className={`flex-row items-center px-5 py-3 ${index === items.length - 1 ? '' : 'border-b border-surface-border/50'} ${onItemPress ? 'hover:bg-surface-overlay/40 transition-colors' : ''}`}
          >
            {columns.map(col => (
              <ColumnCell key={col.key} col={col} item={item} />
            ))}
          </TouchableOpacity>
        )}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={listFooter ?? undefined}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

// ── Details — mobile stacked (ux-consistency.md Path B: a dense table is a
// bad mobile paradigm, so below 768px each item becomes a labelled-field
// card instead of a horizontally-cramped row) ──────────────────────────────

function DetailsStacked<T>({
  items,
  keyExtractor,
  columns,
  onItemPress,
  onEndReached,
  listFooter,
}: {
  items: T[];
  keyExtractor: (item: T) => string;
  columns: MultiViewColumn<T>[];
  onItemPress?: (item: T) => void;
  onEndReached?: () => void;
  listFooter?: React.ReactElement | null;
}) {
  return (
    <FlatList
      style={{ flex: 1 }}
      data={items}
      keyExtractor={keyExtractor}
      contentContainerStyle={{ gap: 10, padding: 12 }}
      renderItem={({ item }) => (
        <TouchableOpacity
          disabled={!onItemPress}
          onPress={onItemPress ? () => onItemPress(item) : undefined}
          accessibilityRole={onItemPress ? 'button' : undefined}
          className="bg-surface-card rounded-2xl border border-surface-border p-4"
          style={{ gap: 8 }}
        >
          {columns.map(col => (
            <View key={col.key} className="flex-row items-center justify-between gap-3">
              <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em]">{col.label}</Text>
              <View className="flex-shrink items-end">{col.render(item)}</View>
            </View>
          ))}
        </TouchableOpacity>
      )}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      ListFooterComponent={listFooter ?? undefined}
      showsVerticalScrollIndicator={false}
    />
  );
}
