import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  FlatList: ({ data, renderItem }: any) => data.map((item: any, index: number) => renderItem({ item, index })),
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
  useWindowDimensions: () => ({ width: 1280, height: 800 }),
}));

vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => true,
  useSharedValue: () => ({ value: 1 }),
  withTiming: (value: number) => value,
}));

vi.mock('@/components/entities/EntityUI', () => ({ FilterChip: 'FilterChip', SegmentedControl: 'SegmentedControl' }));
vi.mock('@/components/Skeleton', () => ({ SkeletonList: 'SkeletonList' }));
vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: (_key: string, fallback: unknown) => [fallback, vi.fn()],
}));
vi.mock('@/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    primary: '#2563eb', textMuted: '#64748b', textDim: '#94a3b8', textMain: '#0f172a',
    warning: '#f59e0b', danger: '#dc2626', border: '#cbd5e1',
  }),
}));
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: 'FontAwesome' }));

import MultiViewList from './MultiViewList';
import { getMultiSelectPressAction, normalizeWebModifierPressEvent } from '@/lib/webModifierKeys';

describe('MultiViewList selection presses', () => {
  it('selects instead of opening for an inactive Ctrl+click', () => {
    expect(getMultiSelectPressAction({ nativeEvent: { ctrlKey: true } }, false)).toBe('select');
  });

  it('selects instead of opening for an inactive Shift+click', () => {
    expect(getMultiSelectPressAction({ nativeEvent: { shiftKey: true } }, false)).toBe('select');
  });

  it('opens on an inactive plain click and selects while active', () => {
    expect(getMultiSelectPressAction({ nativeEvent: {} }, false)).toBe('open');
    expect(getMultiSelectPressAction({ nativeEvent: {} }, true)).toBe('select');
  });

  it('normalizes Ctrl/Cmd/Shift from the press event', () => {
    const preventDefault = vi.fn();
    expect(normalizeWebModifierPressEvent({ nativeEvent: { ctrlKey: true, preventDefault } })).toMatchObject({ ctrlKey: true });
    expect(normalizeWebModifierPressEvent({ nativeEvent: { metaKey: true, shiftKey: true } })).toMatchObject({ metaKey: true, shiftKey: true });
    expect(normalizeWebModifierPressEvent({ nativeEvent: { preventDefault } }).preventDefault).toBe(preventDefault);
  });

  it.each(['large', 'medium', 'list', 'details'] as const)('routes Ctrl+click to selection in %s mode', (mode) => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    const onPress = vi.fn();
    let renderer: any;

    act(() => {
      const props = {
        items: [{ id: 'one' }],
        keyExtractor: (item: { id: string }) => item.id,
        renderCard: () => React.createElement('Text', null, 'Card'),
        renderRow: () => React.createElement('Text', null, 'Row'),
        columns: [{ key: 'name', label: 'Name', render: () => React.createElement('Text', null, 'One') }],
        onItemPress: onOpen,
        storageKey: `test-${mode}`,
        defaultMode: mode,
        modes: [mode],
        emptyState: { title: 'Empty' },
        selection: {
          active: false,
          selectedIds: [],
          onToggle: onSelect,
          onPress: (_item: { id: string }, event: ReturnType<typeof normalizeWebModifierPressEvent>) => onPress(event),
        },
      } as any;
      renderer = TestRenderer.create(
        React.createElement(MultiViewList as any, props),
      );
    });

    const row = renderer!.root.findByProps({ accessibilityRole: 'button' });
    act(() => row.props.onPress({ nativeEvent: { ctrlKey: true } }));

    expect(onPress).toHaveBeenCalledOnce();
    expect(onPress.mock.calls[0][0].ctrlKey).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('forwards the actual press event through project row selection paths', () => {
    const projectsTable = readFileSync(fileURLToPath(String(new URL('../projects/ProjectsTable.tsx', import.meta.url))), 'utf8');
    const projectBoard = readFileSync(fileURLToPath(String(new URL('../projects/ProjectBoard.tsx', import.meta.url))), 'utf8');
    expect(projectsTable).not.toContain('getMultiSelectPressAction(undefined, selection.active)');
    expect(projectBoard).not.toContain('getMultiSelectPressAction(undefined, selection.active)');
  });
});
