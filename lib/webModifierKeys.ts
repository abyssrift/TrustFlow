import { Platform } from 'react-native';

// React Native Web's press events (TouchableOpacity / Pressable) build their
// `nativeEvent` with `ctrlKey` and `altKey` hardcoded to `false` — only
// `shiftKey` and `metaKey` survive from the underlying DOM event (see
// react-native-web createResponderEvent). That makes Ctrl+Click impossible to
// detect from an onPress handler on Windows/Linux, where the multi-select
// modifier is Ctrl rather than Cmd/meta.
//
// To recover it we track the live keyboard/pointer modifier state straight from
// the DOM. Read it in a press handler as a fallback when the synthetic event's
// own flags are unreliable. Web-only; a no-op (all false) on native.

const state = { ctrl: false, meta: false, shift: false, alt: false };

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const sync = (e: KeyboardEvent | MouseEvent | PointerEvent) => {
    state.ctrl = e.ctrlKey;
    state.meta = e.metaKey;
    state.shift = e.shiftKey;
    state.alt = e.altKey;
  };
  const reset = () => { state.ctrl = state.meta = state.shift = state.alt = false; };

  // Pointer/mouse down carry the authoritative modifier state at click time and
  // fire just before the synthetic onPress, so this is what a click reads.
  window.addEventListener('pointerdown', sync, true);
  window.addEventListener('mousedown', sync, true);
  // Keyboard listeners keep the state fresh between clicks.
  window.addEventListener('keydown', sync, true);
  window.addEventListener('keyup', sync, true);
  // Losing focus (e.g. tab switch while a key is held) would otherwise leave a
  // modifier stuck "pressed".
  window.addEventListener('blur', reset);
}

/** Live keyboard/pointer modifier state (web). All false on native. */
export const webModifierKeys = state;

/** True when the platform's "add to selection" modifier is held: Ctrl or Cmd/meta. */
export function isMultiSelectModifierActive(): boolean {
  return state.ctrl || state.meta;
}
