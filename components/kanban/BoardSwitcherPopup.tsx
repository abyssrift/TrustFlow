import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform, useWindowDimensions } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import Popup from '../common/Popup';
import Tooltip from '../common/Tooltip';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { PickerBoard, UseBoardPickerResult } from '../../hooks/useBoardPicker';

/**
 * The board switcher. One responsive component for every width (Path A) —
 * `Popup presentation="auto"` renders a centered card on desktop web and a
 * bottom sheet below 768px / on native, and the RECENT rail collapses from a
 * left column to a stacked section at the same breakpoint.
 *
 * Replaces the two diverged copies that previously lived inline in
 * `_tasks_desktop.tsx` and `_tasks_adaptive.tsx`.
 */

const DESKTOP_BREAKPOINT = 768;
/** Minimum tap target per .agents/rules/ui-style-guide.md §4.3. */
const TAP_TARGET = 44;
/** Above this many boards the RECENT rail earns its space. */
const RECENT_RAIL_THRESHOLD = 6;

type Props<B extends PickerBoard> = {
  visible: boolean;
  onClose: () => void;
  picker: UseBoardPickerResult<B>;
  currentBoardId: string | null | undefined;
  onSelectBoard: (boardId: string) => void;
};

function ActivityDot({ color }: { color: string }) {
  return (
    <View
      className={Platform.OS === 'web' ? 'w-2 h-2 rounded-full pulse-animation' : 'w-2 h-2 rounded-full'}
      style={{ backgroundColor: color }}
    />
  );
}

function BoardRow<B extends PickerBoard>({
  board,
  compact = false,
  picker,
  currentBoardId,
  onSelectBoard,
}: {
  board: B;
  compact?: boolean;
  picker: UseBoardPickerResult<B>;
  currentBoardId: string | null | undefined;
  onSelectBoard: (boardId: string) => void;
}) {
  const colors = useThemeColors();
  const isCurrent = currentBoardId === board.id;
  const isFavorite = picker.favoriteBoardIds.has(board.id);
  const isMyDefault = picker.myDefaultPipelineId === board.id;
  const taskCount = picker.taskCounts[board.id] || 0;
  const newCount = picker.newTaskCounts[board.id] || 0;
  const hasActivity = taskCount > 0;

  return (
    <View
      className={`flex-row items-center mb-2 rounded-2xl border overflow-hidden ${
        isCurrent
          ? 'bg-brand-primary/10 border-brand-primary'
          : 'bg-surface-background border-surface-border hover:border-brand-primary/50'
      }`}
    >
      <TouchableOpacity
        className={compact ? 'flex-1 px-3 py-2.5' : 'flex-1 px-4 py-3'}
        style={{ minHeight: TAP_TARGET }}
        onPress={() => onSelectBoard(board.id)}
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${board.name}`}
      >
        <View className="flex-row items-center gap-2">
          {hasActivity && !isCurrent && <ActivityDot color={colors.warning} />}
          <Text
            className={`flex-1 font-bold ${compact ? 'text-xs' : 'text-base'} ${
              isCurrent ? 'text-brand-primary' : 'text-typography-main'
            }`}
            numberOfLines={1}
          >
            {board.name}
          </Text>
        </View>

        {!compact && (isCurrent || board.is_default || isMyDefault) && (
          <View className="flex-row flex-wrap gap-2 mt-1.5">
            {isCurrent && (
              <View className="bg-brand-primary/15 px-2 py-0.5 rounded-full border border-brand-primary/30">
                <Text className="text-brand-primary text-[10px] font-bold uppercase">Current</Text>
              </View>
            )}
            {board.is_default && (
              <View className="bg-surface-overlay px-2 py-0.5 rounded-full border border-surface-border">
                <Text className="text-typography-muted text-[10px] font-bold uppercase">Workspace Default</Text>
              </View>
            )}
            {isMyDefault && (
              <View className="bg-state-success/10 px-2 py-0.5 rounded-full border border-state-success/20">
                <Text className="text-state-success text-[10px] font-bold uppercase">My Default</Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>

      {/* Right cluster: count, favourite, my-default. */}
      <View className="flex-row items-center pr-1">
        {!isCurrent && taskCount > 0 && (
          <Tooltip label={newCount > 0 ? `${taskCount} tasks · ${newCount} new` : `${taskCount} tasks`}>
            <View
              className={`mr-1 px-2.5 py-1 rounded-full border ${
                newCount > 0 ? 'bg-state-danger border-state-danger' : 'bg-state-warning border-state-warning'
              }`}
            >
              <Text className={`text-xs font-bold ${newCount > 0 ? 'text-white' : 'text-black'}`}>
                {taskCount}
              </Text>
            </View>
          </Tooltip>
        )}

        {!compact && (
          <>
            <Tooltip label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
              <TouchableOpacity
                onPress={() => picker.toggleFavorite(board.id)}
                style={{ width: TAP_TARGET, height: TAP_TARGET }}
                className="items-center justify-center rounded-xl hover:bg-surface-overlay"
                accessibilityRole="button"
                accessibilityLabel={isFavorite ? `Remove ${board.name} from favorites` : `Add ${board.name} to favorites`}
              >
                <FontAwesome
                  name={isFavorite ? 'heart' : 'heart-o'}
                  size={14}
                  color={isFavorite ? colors.danger : colors.textMuted}
                />
              </TouchableOpacity>
            </Tooltip>

            <Tooltip label={isMyDefault ? 'Unset as my default board' : 'Set as my default board'}>
              <TouchableOpacity
                onPress={() => picker.setMyDefault(board.id)}
                style={{ width: TAP_TARGET, height: TAP_TARGET }}
                className="items-center justify-center rounded-xl hover:bg-surface-overlay"
                accessibilityRole="button"
                accessibilityLabel={isMyDefault ? `Unset ${board.name} as my default` : `Set ${board.name} as my default`}
              >
                <FontAwesome
                  name="thumb-tack"
                  size={14}
                  color={isMyDefault ? colors.success : colors.textDim}
                />
              </TouchableOpacity>
            </Tooltip>
          </>
        )}
      </View>
    </View>
  );
}

export default function BoardSwitcherPopup<B extends PickerBoard>({
  visible,
  onClose,
  picker,
  currentBoardId,
  onSelectBoard,
}: Props<B>) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;

  const { filteredBoards, recentBoards, searchQuery, setSearchQuery, orderedBoards } = picker;
  const showRecentRail = recentBoards.length > 0 && orderedBoards.length > RECENT_RAIL_THRESHOLD && !searchQuery;

  const handleSelect = (boardId: string) => {
    onSelectBoard(boardId);
    setSearchQuery('');
  };

  const handleClose = () => {
    setSearchQuery('');
    onClose();
  };

  const boardList = (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {filteredBoards.length === 0 ? (
        <Text className="text-typography-muted text-sm font-medium text-center mt-6">
          No boards match “{searchQuery}”
        </Text>
      ) : (
        filteredBoards.map(b => (
          <BoardRow
            key={b.id}
            board={b}
            picker={picker}
            currentBoardId={currentBoardId}
            onSelectBoard={handleSelect}
          />
        ))
      )}
    </ScrollView>
  );

  return (
    <Popup
      visible={visible}
      onClose={handleClose}
      presentation="auto"
      scrollable={false}
      maxWidth={showRecentRail ? 720 : 520}
      maxHeight="85%"
      containerClassName="rounded-2xl overflow-hidden premium-shadow"
    >
      <View className="p-6 flex-1">
        <View className="flex-row items-start justify-between mb-4">
          <View className="flex-1 pr-2">
            <Text className="text-typography-main font-black text-2xl tracking-tighter">Switch Board</Text>
            {isDesktop && (
              <Text className="text-typography-muted text-xs font-medium mt-1">
                Ctrl+] / Ctrl+[ or scroll on the board name to switch
              </Text>
            )}
          </View>
          <Tooltip label="Close" side="left">
            <TouchableOpacity
              onPress={handleClose}
              style={{ width: TAP_TARGET, height: TAP_TARGET }}
              className="items-center justify-center rounded-xl hover:bg-surface-overlay"
              accessibilityRole="button"
              accessibilityLabel="Close board switcher"
            >
              <FontAwesome name="times" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </Tooltip>
        </View>

        {/* Search */}
        <View className="mb-4 px-4 flex-row items-center bg-surface-background border border-surface-border rounded-lg" style={{ height: TAP_TARGET }}>
          <FontAwesome name="search" size={12} color={colors.textMuted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search boards..."
            placeholderTextColor={colors.textDim}
            className="flex-1 ml-3 text-typography-main text-sm font-bold"
          />
          {searchQuery.length > 0 && (
            <Tooltip label="Clear search">
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={12}>
                <FontAwesome name="times" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          )}
        </View>

        {showRecentRail ? (
          <View className={isDesktop ? 'flex-1 flex-row gap-6' : 'flex-1'}>
            {/* RECENT — left rail on desktop, stacked section on mobile. */}
            <View
              className={
                isDesktop
                  ? 'w-56 border-r border-surface-border pr-6'
                  : 'mb-4 pb-4 border-b border-surface-border'
              }
            >
              <Text className="text-typography-label font-bold text-xs uppercase tracking-widest mb-2">Recent</Text>
              {isDesktop ? (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {recentBoards.map(b => (
                    <BoardRow
                      key={b.id}
                      board={b}
                      compact
                      picker={picker}
                      currentBoardId={currentBoardId}
                      onSelectBoard={handleSelect}
                    />
                  ))}
                </ScrollView>
              ) : (
                recentBoards.slice(0, 3).map(b => (
                  <BoardRow
                    key={b.id}
                    board={b}
                    compact
                    picker={picker}
                    currentBoardId={currentBoardId}
                    onSelectBoard={handleSelect}
                  />
                ))
              )}
            </View>

            <View className="flex-1">
              <Text className="text-typography-label font-bold text-xs uppercase tracking-widest mb-2">All Boards</Text>
              {boardList}
            </View>
          </View>
        ) : (
          <View className="flex-1">{boardList}</View>
        )}
      </View>
    </Popup>
  );
}
