import React from 'react';
import type { ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

/**
 * Wraps a task/kanban card so it animates fluidly instead of snapping:
 *  • `entering` — fades/slides in when a card is created or enters a column
 *  • `exiting`  — fades out when it leaves a column (e.g. moved/advanced)
 *  • `layout`   — springs to its new position when surrounding cards reorder
 *
 * Place the list `key` on this wrapper (not the inner card) so reanimated can
 * track identity across reorders and stage changes.
 */
export default function AnimatedTaskCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.springify().damping(20).stiffness(170).mass(0.6)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}
