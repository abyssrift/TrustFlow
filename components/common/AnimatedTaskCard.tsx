import React, { useLayoutEffect, useRef } from 'react';
import type { ViewStyle } from 'react-native';
import { Platform } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/** Plain viewport rect (getBoundingClientRect-shaped) used to FLIP a card
 * between stage columns — see StageTransitionFX for how it's captured. */
export type FlipRect = { x: number; y: number; width: number; height: number };

const FLIP_DURATION = 480;

/**
 * Wraps a task/kanban card so it animates fluidly instead of snapping:
 *  • `entering` — fades/slides in when a card is created or enters a column
 *  • `exiting`  — fades out when it leaves a column (e.g. moved/advanced)
 *  • `layout`   — springs to its new position when surrounding cards reorder
 *  • `flipFrom` — (web) when a card reappears in a *different* stage column
 *                 (a real stage change, not a reorder), it FLIPs in from its
 *                 last known on-screen position instead of just fading in
 *                 place, so the move reads as the card physically traveling
 *                 there. See StageTransitionFX, which supplies this rect.
 */
export default function AnimatedTaskCard({
  children,
  style,
  disableLayoutAnimation,
  flipFrom,
  onFlipMount,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Skip the `layout` spring — for moments when something else already
   * animates or bulk-replaces card positions (e.g. board switches), where
   * stacking a second transition per card just burns frames. */
  disableLayoutAnimation?: boolean;
  /** (Web) This card's on-screen rect just before it moved here from another
   * stage column. Null/undefined means "just fade in as usual" — either
   * there's no move to FLIP from, or the source rect wasn't captured. */
  flipFrom?: FlipRect | null;
  /** Fired exactly once, on mount, regardless of whether a FLIP played — lets
   * the caller record this card's resting stage / clear the consumed rect. */
  onFlipMount?: () => void;
}) {
  const ref = useRef<any>(null);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Mount-only: a stage move always remounts this component fresh (the task
  // moves from one stage column's list to a different one's), so this never
  // needs to re-run for an instance that's already settled.
  useLayoutEffect(() => {
    onFlipMount?.();
    if (!flipFrom || Platform.OS !== 'web') return;
    const node: any = ref.current;
    if (!node || typeof node.getBoundingClientRect !== 'function') return;
    const after = node.getBoundingClientRect();
    const dx = flipFrom.x - after.left;
    const dy = flipFrom.y - after.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    translateX.value = dx;
    translateY.value = dy;
    translateX.value = withTiming(0, { duration: FLIP_DURATION, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: FLIP_DURATION, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flipStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  return (
    <Animated.View
      ref={ref}
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(140)}
      layout={disableLayoutAnimation ? undefined : LinearTransition.springify().damping(20).stiffness(170).mass(0.6)}
      style={[style, flipStyle]}
    >
      {children}
    </Animated.View>
  );
}
