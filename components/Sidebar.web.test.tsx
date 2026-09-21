import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  width: 1280,
  paletteOpen: false,
  listeners: [] as Array<{ type: string; listener: EventListener; capture: boolean }>,
  add: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  View: 'View',
  useWindowDimensions: () => ({ width: testState.width, height: 800 }),
}));
vi.mock('@/components/navigation/WebMobileNav', () => ({ default: 'WebMobileNav' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ session: null, user: null, hasPermission: () => true, profile: null }) }));
vi.mock('@/contexts/NotificationsContext', () => ({ useNotifications: () => ({ unreadCount: 0 }) }));
vi.mock('@/hooks/useFileHubBadge', () => ({ useFileHubBadge: () => ({ inboxUnread: 0 }) }));
vi.mock('@/hooks/useNavBarPosition', () => ({ useNavBarPosition: () => ({ position: 'top', toggle: vi.fn() }) }));
vi.mock('@/hooks/useUnreadNotificationAttention', () => ({ useUnreadNotificationAttention: vi.fn() }));
vi.mock('@/components/platform-admin/useControlPlaneData', () => ({ useIsPlatformAdmin: () => false }));
vi.mock('@/hooks/useAutoCollapseSubNav', () => ({ useAutoCollapseSubNav: () => [false] }));
vi.mock('@/hooks/usePortfolios', () => ({ usePortfolios: () => ({ rows: [], loading: false }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ is: () => ({ order: async () => ({ data: [] }) }) }) }) } }));
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), usePathname: () => '/' }));
vi.mock('./sidebar/NavRail.web', () => ({ default: () => null }));
vi.mock('./sidebar/search/CommandPalette.web', () => ({ default: (props: { open: boolean }) => { testState.paletteOpen = props.open; return null; } }));
vi.mock('./sidebar/RetractableTopBar.web', () => ({ default: () => null }));
vi.mock('./sidebar/useSidebarProfile', () => ({ useSidebarProfile: () => ({ profileAvatarUrl: null, profileLabel: 'User' }) }));

import Sidebar from './Sidebar.web';

function mountedSidebar(width = 1280) {
  testState.width = width;
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Sidebar, null, React.createElement('Content')));
  });
  return renderer;
}

function keyboardEvent(key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
  return { key, ctrlKey: false, metaKey: false, preventDefault: vi.fn(), ...modifiers } as unknown as KeyboardEvent;
}

function invokeKeydown(event: KeyboardEvent, capture: boolean) {
  const listener = testState.listeners.find((item) => item.type === 'keydown' && item.capture === capture)?.listener;
  expect(listener).toBeDefined();
  act(() => listener!(event as unknown as Event));
}

describe('Sidebar web command palette hotkeys', () => {
  beforeEach(() => {
    testState.paletteOpen = false;
    testState.listeners = [];
    testState.add.mockReset().mockImplementation((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
      testState.listeners.push({ type, listener, capture: options === true || (typeof options === 'object' && options.capture === true) });
    });
    testState.remove.mockReset().mockImplementation((type: string, listener: EventListener, options?: boolean | EventListenerOptions) => {
      const capture = options === true || (typeof options === 'object' && options.capture === true);
      testState.listeners = testState.listeners.filter((item) => !(item.type === type && item.listener === listener && item.capture === capture));
    });
    vi.stubGlobal('window', { addEventListener: testState.add, removeEventListener: testState.remove });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['Ctrl+K', { ctrlKey: true }],
    ['Cmd+K', { metaKey: true }],
  ])('%s toggles the palette and prevents the browser default', (_label, modifiers) => {
    const renderer = mountedSidebar();
    const open = keyboardEvent('k', modifiers);
    invokeKeydown(open, false);
    expect(testState.paletteOpen).toBe(true);
    expect(open.preventDefault).toHaveBeenCalledOnce();

    const close = keyboardEvent('K', modifiers);
    invokeKeydown(close, false);
    expect(testState.paletteOpen).toBe(false);
    expect(close.preventDefault).toHaveBeenCalledOnce();
    act(() => renderer.unmount());
  });

  it('Ctrl+F opens the palette in capture phase and prevents native find', () => {
    const renderer = mountedSidebar();
    const event = keyboardEvent('f', { ctrlKey: true });
    invokeKeydown(event, true);
    expect(testState.paletteOpen).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    act(() => renderer.unmount());
  });

  it('leaves Cmd+F native', () => {
    const renderer = mountedSidebar();
    const event = keyboardEvent('f', { metaKey: true });
    invokeKeydown(event, true);
    expect(testState.paletteOpen).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it.each([390, 1280])('registers and cleans up listeners on the %i px mount path', (width) => {
    const renderer = mountedSidebar(width);
    expect(testState.listeners).toHaveLength(2);
    act(() => renderer.unmount());
    expect(testState.listeners).toHaveLength(0);
    expect(testState.remove).toHaveBeenCalledTimes(2);
    expect(testState.remove.mock.calls.map((call) => call[2])).toContain(true);
  });
});
