import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Text: 'Text', View: 'View' }));

vi.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  interpolate: vi.fn(),
  useAnimatedStyle: () => ({}),
}));

vi.mock('@/hooks/useCollapsibleHeader', () => ({
  useCollapseProgress: () => ({ value: 0 }),
}));

import IntelligencePageHeader from './IntelligencePageHeader';

describe('IntelligencePageHeader', () => {
  it('keeps standard layout and resting padding when density is omitted', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <IntelligencePageHeader eyebrow="Intelligence Hub" title="Collection" right={<Text>Action</Text>} />,
      );
    });

    expect(renderer.root.findByProps({ children: 'Intelligence Hub' })).toBeTruthy();
    const title = renderer.root.findByProps({ children: 'Collection' });
    expect(title.props.className).toContain('text-4xl');

    const fullWidthControls = renderer.root.findAllByType('View').find((node) => (
      node.props.className === 'flex-row flex-wrap items-center gap-3'
    ));
    expect(fullWidthControls?.props.style).toEqual({ width: '100%' });

    const header = renderer.root.findByType('AnimatedView');
    const staticStyle = Array.isArray(header.props.style) ? header.props.style[0] : header.props.style;
    expect(staticStyle).toMatchObject({ paddingTop: 32, paddingBottom: 24 });
  });

  it('renders identity and actions together in the compact resting row', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <IntelligencePageHeader density="compact" title="Collection" right={<Text>Action</Text>} />,
      );
    });

    const title = renderer.root.findByProps({ children: 'Collection' });
    expect(title.props.className).toContain('text-3xl');

    const compactRow = renderer.root.findAllByType('View').find((node) => {
      if (!node.props.className?.includes('flex-row flex-wrap')) return false;
      const text = node.findAllByType('Text').map((item) => item.props.children);
      return text.includes('Collection') && text.includes('Action');
    });
    expect(compactRow).toBeDefined();

    const header = renderer.root.findByType('AnimatedView');
    const staticStyle = Array.isArray(header.props.style) ? header.props.style[0] : header.props.style;
    expect(staticStyle).toMatchObject({ paddingTop: 20, paddingBottom: 12 });
  });
});
