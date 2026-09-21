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
    const renderCard = vi.fn((value: Item, density: 'large' | 'medium') => <Text>{`${value.name}-${density}`}</Text>);
    const renderRow = vi.fn((value: Item) => <Text>{value.name}</Text>);
    const renderColumn = vi.fn((value: Item) => <Text>{value.name}</Text>);
    const onSearchChange = vi.fn();
    const onGroupChange = vi.fn();
    const onEndReached = vi.fn();
    const onScroll = vi.fn();

    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(
        <ExplorerCollection<Item>
          items={[item]}
          keyExtractor={(value) => value.id}
          renderCard={renderCard}
          renderRow={renderRow}
          columns={[{ key: 'name', label: 'Name', flex: 1, render: renderColumn }]}
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

    expect(renderer!.root.findAllByType('Text').some((node: any) => node.props.children === 'One')).toBe(true);
    expect(renderRow).toHaveBeenCalledWith(item);
    expect(onItemPress).toHaveBeenCalledWith(item);

    let cardRenderer: any;
    act(() => {
      cardRenderer = TestRenderer.create(
        <ExplorerCollection<Item>
          items={[item]}
          keyExtractor={(value) => value.id}
          renderCard={renderCard}
          renderRow={renderRow}
          columns={[{ key: 'name', label: 'Name', flex: 1, render: renderColumn }]}
          storageKey="explorer-card-test"
          defaultMode="medium"
          modes={['medium']}
          emptyState={{ title: 'No files' }}
        />,
      );
    });

    expect(cardRenderer!.root.findAllByType('Text').some((node: any) => node.props.children === 'One-medium')).toBe(true);
    expect(renderCard).toHaveBeenCalledWith(item, 'medium');

    let detailsRenderer: any;
    act(() => {
      detailsRenderer = TestRenderer.create(
        <ExplorerCollection<Item>
          items={[item]}
          keyExtractor={(value) => value.id}
          renderCard={renderCard}
          renderRow={renderRow}
          columns={[{ key: 'name', label: 'Name', flex: 1, render: renderColumn }]}
          storageKey="explorer-details-test"
          defaultMode="details"
          modes={['details']}
          emptyState={{ title: 'No files' }}
        />,
      );
    });

    expect(detailsRenderer!.root.findAllByType('Text').some((node: any) => node.props.children === 'One')).toBe(true);
    expect(renderColumn).toHaveBeenCalledWith(item);

    const onActiveSelection = vi.fn();
    const onActiveOpen = vi.fn();
    let selectionRenderer: any;
    act(() => {
      selectionRenderer = TestRenderer.create(
        <ExplorerCollection<Item>
          items={[item]}
          keyExtractor={(value) => value.id}
          renderCard={renderCard}
          renderRow={renderRow}
          columns={[{ key: 'name', label: 'Name', flex: 1, render: renderColumn }]}
          storageKey="explorer-selection-test"
          defaultMode="list"
          modes={['list']}
          emptyState={{ title: 'No files' }}
          onItemPress={onActiveOpen}
          selection={{ active: true, selectedIds: [], onToggle: onActiveSelection }}
        />,
      );
    });

    const selectionRow = selectionRenderer!.root.findByProps({ accessibilityRole: 'button' });
    act(() => selectionRow.props.onPress({ nativeEvent: {} }));

    expect(onActiveSelection).toHaveBeenCalledWith(item);
    expect(onActiveOpen).not.toHaveBeenCalled();
  });
});
