import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

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

import ExplorerCollection from './ExplorerCollection';

type Item = { id: string; name: string };

describe('ExplorerCollection', () => {
  it('renders the broad collection contract and opens an item on press', () => {
    const item = { id: 'one', name: 'One' } satisfies Item;
    const onItemPress = vi.fn();
    const onSearchChange = vi.fn();
    const onGroupChange = vi.fn();
    const onEndReached = vi.fn();
    const onScroll = vi.fn();

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ExplorerCollection<Item>
          items={[item]}
          keyExtractor={(value) => value.id}
          renderCard={(value, density) => <Text>{`${value.name}-${density}`}</Text>}
          renderRow={(value) => <Text>{value.name}</Text>}
          columns={[{ key: 'name', label: 'Name', flex: 1, render: (value) => <Text>{value.name}</Text> }]}
          storageKey="explorer-test"
          defaultMode="list"
          modes={['list', 'details']}
          search={{ value: '', onChange: onSearchChange, placeholder: 'Search files' }}
          groupFilter={{ options: [{ id: 'all', label: 'All' }], activeId: 'all', onChange: onGroupChange }}
          loading={false}
          statusBanner={null}
          emptyState={{ title: 'No files' }}
          onItemPress={onItemPress}
          selection={{ active: false, selectedIds: [], onToggle: vi.fn() }}
          cardMinWidth={240}
          mediumCardMinWidth={150}
          maxLargeColumns={3}
          maxMediumColumns={5}
          maxGridWidth={900}
          onEndReached={onEndReached}
          listFooter={<Text>Footer</Text>}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
          testIDPrefix="explorer"
        />,
      );
    });

    const row = renderer!.root.findByProps({ accessibilityRole: 'button' });
    act(() => row.props.onPress({ nativeEvent: {} }));

    expect(renderer!.root.findAllByType('Text').some((node) => node.props.children === 'One')).toBe(true);
    expect(onItemPress).toHaveBeenCalledWith(item);
  });
});
