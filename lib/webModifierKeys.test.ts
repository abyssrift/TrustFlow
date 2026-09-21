import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

describe('web modifier fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses live Ctrl state when RN Web reports ctrlKey=false on press', async () => {
    const listeners = new Map<string, (event: any) => void>();
    vi.stubGlobal('window', {
      addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener),
    });

    const { getMultiSelectPressAction } = await import('./webModifierKeys');
    listeners.get('pointerdown')?.({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });

    expect(getMultiSelectPressAction({ nativeEvent: { ctrlKey: false, metaKey: false } }, false)).toBe('select');

    listeners.get('keyup')?.({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
    expect(getMultiSelectPressAction({ nativeEvent: { ctrlKey: false, metaKey: false } }, false)).toBe('open');
  });
});
