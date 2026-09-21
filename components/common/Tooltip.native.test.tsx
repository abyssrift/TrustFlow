import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
vi.mock('@/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ card: '#fff', textMain: '#111', border: '#ddd' }),
}));

import Tooltip from './Tooltip';

describe('Tooltip.native', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  function renderTooltip(props: Partial<React.ComponentProps<typeof Tooltip>> = {}) {
    const measure = vi.fn((callback: (x: number, y: number, width: number, height: number) => void) => {
      callback(12, 20, 40, 24);
    });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <Tooltip label="Archive task" {...props}>
          {React.createElement('Text', null, 'Archive')}
        </Tooltip>,
        { createNodeMock: (element: { type: unknown }) => element.type === 'View' ? { measureInWindow: measure } : {} },
      );
    });
    return { renderer, measure };
  }

  it('waits 450 ms, measures the anchor, then opens the modal', () => {
    const { renderer, measure } = renderTooltip();
    const anchor = renderer.root.findAllByType('View')[0];
    const modal = () => renderer.root.findByType('Modal');

    expect(modal().props.visible).toBe(false);
    act(() => anchor.props.onTouchStart());
    act(() => { vi.advanceTimersByTime(449); });
    expect(measure).not.toHaveBeenCalled();
    expect(modal().props.visible).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });

    expect(measure).toHaveBeenCalledOnce();
    expect(modal().props.visible).toBe(true);
    act(() => { renderer.unmount(); });
  });

  it.each(['onTouchEnd', 'onTouchCancel'] as const)('cancels a pending long press on %s', (eventName) => {
    const { renderer, measure } = renderTooltip();
    const anchor = renderer.root.findAllByType('View')[0];

    act(() => anchor.props.onTouchStart());
    act(() => { vi.advanceTimersByTime(300); });
    act(() => anchor.props[eventName]());
    act(() => { vi.advanceTimersByTime(500); });
    expect(measure).not.toHaveBeenCalled();
    expect(renderer.root.findByType('Modal').props.visible).toBe(false);
    act(() => { renderer.unmount(); });
  });

  it('closes when the outside pressable is pressed', () => {
    const { renderer } = renderTooltip();
    const anchor = renderer.root.findAllByType('View')[0];
    act(() => anchor.props.onTouchStart());
    act(() => { vi.advanceTimersByTime(450); });
    expect(renderer.root.findByType('Modal').props.visible).toBe(true);

    act(() => renderer.root.findByType('Pressable').props.onPress());
    expect(renderer.root.findByType('Modal').props.visible).toBe(false);
    act(() => { renderer.unmount(); });
  });

  it('self-dismisses after 2500 ms', () => {
    const { renderer } = renderTooltip();
    const anchor = renderer.root.findAllByType('View')[0];
    act(() => anchor.props.onTouchStart());
    act(() => { vi.advanceTimersByTime(450); });
    expect(renderer.root.findByType('Modal').props.visible).toBe(true);
    act(() => { vi.advanceTimersByTime(2499); });
    expect(renderer.root.findByType('Modal').props.visible).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(renderer.root.findByType('Modal').props.visible).toBe(false);
    act(() => { renderer.unmount(); });
  });

  it.each([
    ['disabled', { disabled: true, label: 'Archive task' }],
    ['empty label', { label: '' }],
  ])('renders the child bare with a %s', (_case, props) => {
    const { renderer } = renderTooltip(props);
    expect(renderer.root.findAllByType('View')).toHaveLength(0);
    expect(renderer.root.findByType('Text').children).toEqual(['Archive']);
    act(() => { renderer.unmount(); });
  });
});
