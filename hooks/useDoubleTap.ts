import { useRef } from 'react';

/** Second press on the same id within this window counts as a double. */
const DOUBLE_MS = 300;

/**
 * Double-click / double-tap detector for list rows.
 *
 * Deliberately NOT the DOM `onDoubleClick` prop or `event.detail`:
 * react-native-web silently drops or normalises away most raw DOM handlers
 * (same class of trap as the dropped `draggable`/`onDrag*` props documented in
 * hooks/useWebDnd.ts), so a web-only prop would look correct and never fire.
 * A timestamp comparison works identically on web and native, where it also
 * gives double-tap for free.
 *
 * Usage — call once per press and branch on the result:
 *   const isDoubleTap = useDoubleTap();
 *   onPress={() => { if (isDoubleTap(file.id)) openFullscreen(); else select(); }}
 *
 * ponytail: one shared 300ms window, not a per-surface setting. Pass windowMs
 * only if a surface actually measures out as needing a different feel.
 */
export function useDoubleTap(windowMs = DOUBLE_MS) {
  const last = useRef<{ id: string; t: number }>({ id: '', t: 0 });

  return (id: string): boolean => {
    const now = Date.now();
    const isDouble = last.current.id === id && now - last.current.t < windowMs;
    // Reset on a match so a triple click is one double + one single, rather
        // than every click after the second reporting as a double.
    last.current = isDouble ? { id: '', t: 0 } : { id, t: now };
    return isDouble;
  };
}

// ponytail: self-check for the only non-trivial part — the reset-after-match
// rule. Pure timing logic, so it runs without React. Call from a scratch script.
export function __selfCheck() {
  let now = 1000;
  const last = { id: '', t: 0 };
  const press = (id: string) => {
    const isDouble = last.id === id && now - last.t < DOUBLE_MS;
    if (isDouble) { last.id = ''; last.t = 0; } else { last.id = id; last.t = now; }
    return isDouble;
  };

  if (press('a') !== false) throw new Error('first press must be single');
  now += 100;
  if (press('a') !== true) throw new Error('second press in window must be double');
  now += 100;
  if (press('a') !== false) throw new Error('third press must reset, not re-fire');
  now += 500;
  if (press('a') !== false) throw new Error('press after window must be single');
  now += 10;
  if (press('b') !== false) throw new Error('different id must never pair');
  return 'useDoubleTap: ok';
}
