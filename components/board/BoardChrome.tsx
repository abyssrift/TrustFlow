import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useThemeColors } from '@/hooks/useThemeColors';

/**
 * Phase 8 (#187) — the board's VISUAL shell, in one place.
 *
 * `ProjectBoard.tsx` was written to deliberately duplicate the task board's
 * chrome (column header treatment, stage-body radius/fill/border, card
 * shadow+radius) rather than generalise `_tasks_desktop.tsx`'s 1,740 lines —
 * see that file's header for why the *data* paths stay separate, which has
 * not changed. What was wrong is that duplicating it left TWO definitions of
 * what a board column looks like, free to drift. This file is the one
 * definition. Data, drag/drop, pagination and move semantics stay entirely
 * with each board.
 *
 * The values here are `_tasks_desktop.tsx`'s existing ones on purpose, so
 * adopting this there is a no-op visually. That adoption is a separate change
 * — the task board is out of scope for this phase.
 */

export const BOARD_COLUMN_WIDTH = 320;
export const BOARD_COLUMN_GAP = 24;

export function BoardColumnHeader({
  name,
  color,
  count,
  hasMore,
  right,
}: {
  name: string;
  color?: string | null;
  /** Omit to hide the count pill entirely. */
  count?: number;
  /** Renders the count as "N+" when the column is paginated and more remain. */
  hasMore?: boolean;
  right?: React.ReactNode;
}) {
  const c = useThemeColors();
  return (
    <View className="flex-row items-center justify-between mb-4 px-1">
      <View className="flex-row items-center flex-1 min-w-0">
        <View style={{ backgroundColor: color ?? c.primary }} className="w-2.5 h-2.5 rounded-full mr-2.5" />
        <Text numberOfLines={1} className="text-typography-main font-black text-xs uppercase tracking-[0.2em] flex-shrink">
          {name}
        </Text>
        {count != null && (
          <View className="ml-2 bg-surface-card border border-surface-border px-2 py-0.5 rounded-lg">
            <Text className="text-typography-muted text-[10px] font-bold">{count}{hasMore ? '+' : ''}</Text>
          </View>
        )}
      </View>
      {right}
    </View>
  );
}

/**
 * The column: fixed-width wrapper + header + the rounded stage body that
 * holds the cards. `isOver` is the drop-target highlight.
 */
export function BoardColumn({
  name,
  color,
  count,
  hasMore,
  headerRight,
  isOver,
  dropRef,
  width = BOARD_COLUMN_WIDTH,
  gap = BOARD_COLUMN_GAP,
  style,
  children,
}: {
  name: string;
  color?: string | null;
  count?: number;
  hasMore?: boolean;
  headerRight?: React.ReactNode;
  isOver?: boolean;
  dropRef?: React.Ref<any>;
  width?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const c = useThemeColors();
  return (
    <View className="h-full" style={[{ width, marginRight: gap }, style]}>
      <BoardColumnHeader name={name} color={color} count={count} hasMore={hasMore} right={headerRight} />
      <View
        ref={dropRef as any}
        className="flex-1 rounded-[2rem] p-3 border"
        style={{
          backgroundColor: isOver ? c.primary + '14' : c.card + '4D',
          borderColor: isOver ? c.primary : c.border + '80',
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** "Nothing is parked here" — quiet, and it never stands in for loading. */
export function BoardColumnEmpty({ label, icon = 'inbox' }: { label: string; icon?: string }) {
  const c = useThemeColors();
  return (
    <View className="items-center py-10 px-2">
      <FontAwesome name={icon as any} size={18} color={c.textDim} />
      <Text className="text-typography-dim text-[11px] mt-2 text-center">{label}</Text>
    </View>
  );
}
