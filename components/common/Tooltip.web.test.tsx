import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('react-dom', () => ({ createPortal: (children: React.ReactNode) => children }));
vi.mock('@/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ card: '#fff', textMain: '#111', border: '#ddd' }),
}));

import Tooltip from './Tooltip.web';

describe('Tooltip.web', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { body: {} });
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function renderTooltip(props: Partial<React.ComponentProps<typeof Tooltip>> = {}) {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <Tooltip label="Archive task" delay={350} {...props}>
          <button>Archive</button>
        </Tooltip>,
        {
          createNodeMock: (element: { type: unknown }) => element.type === 'View'
            ? { getBoundingClientRect: () => ({ x: 12, y: 20, width: 40, height: 24 }) }
            : element.type === 'div' ? { offsetWidth: 100, offsetHeight: 30 } : {},
        },
      );
    });
    return renderer;
  }

  it('opens after the delayed mouse hover and exposes a labelled tooltip portal', () => {
    const renderer = renderTooltip();
    const anchor = renderer.root.findByType('View');

    act(() => anchor.props.onMouseEnter());
    expect(renderer.root.findAllByProps({ role: 'tooltip' })).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(349); });
    expect(renderer.root.findAllByProps({ role: 'tooltip' })).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });

    const tip = renderer.root.findByProps({ role: 'tooltip' });
    expect(tip.children).toEqual(['Archive task']);
    expect(tip.props.style.position).toBe('fixed');
    act(() => { renderer.unmount(); });
  });

  it('opens on focus and hides on blur', () => {
    const renderer = renderTooltip();
    const anchor = renderer.root.findByType('View');

    act(() => anchor.props.onFocus());
    act(() => { vi.advanceTimersByTime(350); });
    expect(renderer.root.findByProps({ role: 'tooltip' })).toBeTruthy();
    act(() => anchor.props.onBlur());
    expect(renderer.root.findAllByProps({ role: 'tooltip' })).toHaveLength(0);
    act(() => { renderer.unmount(); });
  });

  it('cancels a pending hover when the pointer leaves', () => {
    const renderer = renderTooltip();
    const anchor = renderer.root.findByType('View');

    act(() => anchor.props.onMouseEnter());
    act(() => { vi.advanceTimersByTime(200); });
    act(() => anchor.props.onMouseLeave());
    act(() => { vi.advanceTimersByTime(500); });
    expect(renderer.root.findAllByProps({ role: 'tooltip' })).toHaveLength(0);
    act(() => { renderer.unmount(); });
  });

  it.each([
    ['disabled', { disabled: true, label: 'Archive task' }],
    ['empty label', { label: '' }],
  ])('renders the child bare with a %s', (_case, props) => {
    const renderer = renderTooltip(props);
    expect(renderer.root.findAllByType('View')).toHaveLength(0);
    expect(renderer.root.findByType('button').children).toEqual(['Archive']);
    act(() => { renderer.unmount(); });
  });
});
