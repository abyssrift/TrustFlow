import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event?: any) => void;

function createWindowMock() {
  const listeners = new Map<string, Listener[]>();
  const addEventListener = vi.fn((type: string, listener: Listener) => {
    const current = listeners.get(type) ?? [];
    current.push(listener);
    listeners.set(type, current);
  });
  return {
    addEventListener,
    dispatch(type: string, event: any = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

async function importWithPlatform(os: 'web' | 'ios', windowMock?: ReturnType<typeof createWindowMock>) {
  vi.resetModules();
  vi.doMock('react-native', () => ({ Platform: { OS: os } }));

  if (windowMock) Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock });
  else Reflect.deleteProperty(globalThis, 'window');

  return import('./webModifierKeys');
}

afterEach(() => {
  vi.doUnmock('react-native');
  vi.resetModules();
  Reflect.deleteProperty(globalThis, 'window');
});

describe('webModifierKeys platform behavior', () => {
  it('maps plain inactive presses to open, modifiers and active selection to select', async () => {
    const { getMultiSelectPressAction } = await importWithPlatform('web');

    expect(getMultiSelectPressAction({}, false)).toBe('open');
    expect(getMultiSelectPressAction({ ctrlKey: true }, false)).toBe('select');
    expect(getMultiSelectPressAction({ metaKey: true }, false)).toBe('select');
    expect(getMultiSelectPressAction({ shiftKey: true }, false)).toBe('select');
    expect(getMultiSelectPressAction({}, true)).toBe('select');
  });

  it('normalizes synthetic and direct event flags, key, and preventDefault', async () => {
    const { normalizeWebModifierPressEvent } = await importWithPlatform('web');
    const preventDefault = vi.fn();

    expect(normalizeWebModifierPressEvent({ nativeEvent: {
      key: 'Enter', ctrlKey: 1, metaKey: 0, shiftKey: true, altKey: false, preventDefault,
    } })).toEqual({ key: 'Enter', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, preventDefault });
    expect(normalizeWebModifierPressEvent({ key: ' ', ctrlKey: false, metaKey: true, shiftKey: false, altKey: true }))
      .toEqual({ key: ' ', ctrlKey: false, metaKey: true, shiftKey: false, altKey: true, preventDefault: undefined });
    expect(normalizeWebModifierPressEvent()).toEqual({
      key: undefined, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault: undefined,
    });
  });

  it('uses live pointer, mouse, and keyboard modifier state, then clears it on blur', async () => {
    const windowMock = createWindowMock();
    const { getMultiSelectPressAction, isMultiSelectModifierActive, normalizeWebModifierPressEvent, webModifierKeys }
      = await importWithPlatform('web', windowMock);

    expect(windowMock.addEventListener.mock.calls.map(([type]) => type)).toEqual([
      'pointerdown', 'mousedown', 'keydown', 'keyup', 'blur',
    ]);

    windowMock.dispatch('pointerdown', { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(isMultiSelectModifierActive()).toBe(true);
    expect(getMultiSelectPressAction({}, false)).toBe('select');
    expect(normalizeWebModifierPressEvent({ nativeEvent: { ctrlKey: false } }).ctrlKey).toBe(true);
    expect(webModifierKeys).toEqual({ ctrl: true, meta: false, shift: false, alt: false });

    windowMock.dispatch('mousedown', { ctrlKey: false, metaKey: true, shiftKey: true, altKey: false });
    expect(getMultiSelectPressAction({}, false)).toBe('select');
    expect(webModifierKeys).toEqual({ ctrl: false, meta: true, shift: true, alt: false });

    windowMock.dispatch('keydown', { ctrlKey: false, metaKey: false, shiftKey: true, altKey: true });
    expect(isMultiSelectModifierActive()).toBe(false);
    expect(getMultiSelectPressAction({}, false)).toBe('select');
    expect(normalizeWebModifierPressEvent({}).altKey).toBe(true);

    windowMock.dispatch('keyup', { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
    expect(getMultiSelectPressAction({}, false)).toBe('open');
    windowMock.dispatch('keydown', { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    windowMock.dispatch('blur');
    expect(webModifierKeys).toEqual({ ctrl: false, meta: false, shift: false, alt: false });
    expect(getMultiSelectPressAction({}, false)).toBe('open');
  });

  it('keeps native modifiers false and registers no window listeners', async () => {
    const windowMock = createWindowMock();
    const { getMultiSelectPressAction, isMultiSelectModifierActive, normalizeWebModifierPressEvent, webModifierKeys }
      = await importWithPlatform('ios', windowMock);

    expect(windowMock.addEventListener).not.toHaveBeenCalled();
    expect(webModifierKeys).toEqual({ ctrl: false, meta: false, shift: false, alt: false });
    expect(isMultiSelectModifierActive()).toBe(false);
    expect(getMultiSelectPressAction({}, false)).toBe('open');
    expect(normalizeWebModifierPressEvent({ ctrlKey: true, metaKey: true, shiftKey: true, altKey: true }))
      .toMatchObject({ ctrlKey: true, metaKey: true, shiftKey: true, altKey: true });
  });
});
