import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

// Scroll-linked header collapse. One SharedValue per screen: 0 = header at full
// height, 1 = condensed. The scrollable body reports its offset via
// `useCollapsibleHeaderScroll()`; the header reads `progress` and runs its own
// `useAnimatedStyle` interpolations, so each header decides what "condensed"
// means for it (smaller title, tighter padding, dropped description, ...).
//
// Threshold + tween, NOT continuous scroll-linked interpolation:
//  - a plain JS `onScroll` writing a value every frame is janky on native, and
//  - reanimated's `useAnimatedScrollHandler` worklet path is unverified on this
//    app's web build (animation-consistency.md §1 case 2 / §2).
// So: crossing COLLAPSE_AT tweens to condensed, dropping back under EXPAND_AT
// tweens back. The gap between the two thresholds is hysteresis — a few px of
// scroll jitter at the boundary can't strobe the header. Reads like iOS's
// large-title → inline-title settle, which is the effect being asked for.
//
// ponytail: fixed thresholds. If a screen ever needs a taller trigger, add an
// optional prop to the provider rather than a second hook.

const COLLAPSE_AT = 64;
const EXPAND_AT = 24;
const DURATION = 200;

type Ctx = { progress: SharedValue<number> };
const CollapsibleHeaderContext = createContext<Ctx | null>(null);

export function CollapsibleHeaderProvider({ children }: { children: React.ReactNode }) {
  const progress = useSharedValue(0);
  // Kick the value once on mount. On this app's web build a `useAnimatedStyle`
  // whose SharedValue has never been *written* doesn't paint its initial frame —
  // so a header that sources its resting fontSize / padding from the animated
  // style renders unstyled (14px text, no header padding) until the first
  // scroll. With Reduce Motion on (Windows "best performance") that scroll write
  // is a duration-0 snap, but it still never happens at rest. A zero-duration
  // write here registers the mapper with no visible motion. Headers should also
  // carry a static floor for their resting look, but this covers the rest.
  useEffect(() => {
    progress.value = withTiming(0, { duration: 0 });
  }, []);
  return (
    <CollapsibleHeaderContext.Provider value={{ progress }}>
      {children}
    </CollapsibleHeaderContext.Provider>
  );
}

/** SharedValue 0 (full) → 1 (condensed). Feed it to the header's `useAnimatedStyle`. */
export function useCollapseProgress(): SharedValue<number> {
  const ctx = useContext(CollapsibleHeaderContext);
  if (!ctx) throw new Error('useCollapseProgress must be used inside <CollapsibleHeaderProvider>');
  return ctx.progress;
}

/**
 * Like `useCollapseProgress` but returns a frozen `0` SharedValue when there is
 * no provider, instead of throwing. For headers that live in components which
 * also render outside a collapsible screen — the admin listing grids
 * (`RoleBuilder` / `TeamAssignmentGrid` / `UserAssignmentGrid`) render both
 * under the People tab and under `app/admin/roles`.
 */
export function useCollapseProgressOptional(): SharedValue<number> {
  const ctx = useContext(CollapsibleHeaderContext);
  const fallback = useSharedValue(0);
  return ctx ? ctx.progress : fallback;
}

/**
 * Spread the return value onto the screen's scrollable (`ScrollView` / `FlatList`).
 *
 * Null-safe by design: outside a `<CollapsibleHeaderProvider>` it returns an
 * inert handler and does nothing. Body-side scroll containers are often shared
 * components (`MultiViewList`, `TeamWorkspaceContent`, ...) that also render on
 * screens with no collapsing header — those must not crash. The header-side
 * `useCollapseProgress()` still throws, because a header always has a provider.
 */
export function useCollapsibleHeaderScroll() {
  const ctx = useContext(CollapsibleHeaderContext);
  const reduceMotion = useReducedMotion();
  const condensed = useRef(false);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!ctx) return;
      const y = e.nativeEvent.contentOffset.y;
      // Always drive through withTiming, even for Reduce Motion (duration 0 =
      // instant snap, no visible motion). A bare `progress.value = n` assignment
      // from this non-worklet JS handler does NOT reliably re-run dependent
      // `useAnimatedStyle` on this app's web build — the header just wouldn't
      // move. withTiming registers a real animation whose mapper repaints the
      // style on every platform. (Windows' "best performance" power preset
      // broadcasts prefers-reduced-motion, so this path is the common one.)
      const duration = reduceMotion ? 0 : DURATION;
      if (!condensed.current && y > COLLAPSE_AT) {
        condensed.current = true;
        ctx.progress.value = withTiming(1, { duration });
      } else if (condensed.current && y < EXPAND_AT) {
        condensed.current = false;
        ctx.progress.value = withTiming(0, { duration });
      }
    },
    [ctx, reduceMotion],
  );

  return { onScroll, scrollEventThrottle: 16 };
}
