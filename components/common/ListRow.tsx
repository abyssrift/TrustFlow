import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';

import Tooltip from '@/components/common/Tooltip';
import { useThemeColors } from '@/hooks/useThemeColors';

/**
 * Shared list primitives (issue #246). Lifted out of `ProjectsTable.tsx`'s
 * desktop table — the app's agreed reference "new list style" — so the row
 * padding/spacing/hover/selected/divider treatment and the pagination footer
 * live in one place instead of being re-derived per screen. `ProjectsTable`
 * is now the reference *consumer* of these, not a special case.
 *
 * Deliberately NOT included: virtualization. `ProjectsTable` itself doesn't
 * virtualize — it pages server-side (`rpc_projects_table`, LIMIT=25) and
 * renders one bounded page with a plain `.map()`. There is no existing
 * windowing behavior to lift, and adding one here would be new, unrequested
 * complexity. Add a windowing wrapper when a screen needs an unbounded
 * client-side list.
 */

/** The bordered card shell a desktop list sits inside (filter bar + header + rows + footer). */
export function ListCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={`bg-surface-card rounded-2xl border border-surface-border overflow-hidden ${className ?? ''}`}>
      {children}
    </View>
  );
}

/** One interactive list row: padding, divider, hover, optional selected/disabled treatment. */
export function ListRow({
  onPress,
  isLast,
  selected,
  disabled,
  children,
  className,
  style,
  accessibilityLabel,
}: {
  onPress?: () => void;
  /** Suppresses the bottom divider — pass true for the last row in the list. */
  isLast?: boolean;
  /** Tinted background + left accent bar. Off by default — Projects has no row selection today; here for the next screen that needs it. */
  selected?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const c = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityLabel={accessibilityLabel}
      className={`flex-row items-center px-5 py-3 ${isLast ? '' : 'border-b border-surface-border/50'} hover:bg-surface-overlay/40 transition-colors ${disabled ? 'opacity-50' : ''} ${className ?? ''}`}
      style={[
        selected ? { backgroundColor: c.primary + '0F', borderLeftWidth: 2, borderLeftColor: c.primary } : null,
        style,
      ]}
    >
      {children}
    </TouchableOpacity>
  );
}

/** "Showing X–Y" + prev/next chevrons. Same footer shape for any paginated list. */
export function ListPagination({
  page,
  count,
  limit,
  hasMore,
  onPrev,
  onNext,
  isDesktop = true,
  emptyLabel = 'Nothing to show',
  itemNoun,
}: {
  page: number;
  /** Rows on the current page (after any client-side sort/filter). */
  count: number;
  limit: number;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Desktop uses tighter padding than mobile — matches ProjectsTable's density split. */
  isDesktop?: boolean;
  emptyLabel?: string;
  /** e.g. "projects" — used only in the prev/next tooltip copy. Defaults to generic wording. */
  itemNoun?: string;
}) {
  const c = useThemeColors();
  const noun = itemNoun ? ` ${itemNoun}` : '';
  return (
    <View className={`flex-row items-center justify-between border-t border-surface-border ${isDesktop ? 'px-5 py-2.5' : 'px-4 py-3'}`}>
      <Text className="text-typography-muted text-[11px] font-medium">
        {count === 0
          ? emptyLabel
          : `Showing ${page * limit + 1}–${page * limit + count}${hasMore ? '' : ' — that’s all of them'}`}
      </Text>
      <View className="flex-row items-center gap-2">
        <Tooltip label={page === 0 ? 'You’re on the first page' : 'Previous page'}>
          <TouchableOpacity
            disabled={page === 0}
            onPress={onPrev}
            accessibilityLabel="Previous page"
            className={`w-8 h-8 items-center justify-center rounded-lg border border-surface-border ${page === 0 ? 'opacity-30' : 'hover:bg-surface-overlay'}`}
          >
            <FontAwesome name="chevron-left" size={11} color={c.textMuted} />
          </TouchableOpacity>
        </Tooltip>
        <Tooltip label={!hasMore ? `No more${noun} after this page` : 'Next page'}>
          <TouchableOpacity
            disabled={!hasMore}
            onPress={onNext}
            accessibilityLabel="Next page"
            className={`w-8 h-8 items-center justify-center rounded-lg border border-surface-border ${!hasMore ? 'opacity-30' : 'hover:bg-surface-overlay'}`}
          >
            <FontAwesome name="chevron-right" size={11} color={c.textMuted} />
          </TouchableOpacity>
        </Tooltip>
      </View>
    </View>
  );
}
