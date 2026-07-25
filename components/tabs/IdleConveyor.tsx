import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useThemeColors } from '@/hooks/useThemeColors';

// ─── Idle conveyor — empty stage column state ─────────────────────────────
//
// A stage column with nothing in it used to get the usual grey-icon empty
// state. The board's whole metaphor is a pipeline, so an empty stage instead
// reads as an idle stretch of conveyor: belt still running, nothing riding it
// most of the time, with the occasional crate drifting through. "No tasks
// here" then lands as a pause in the same system rather than a dead end.
//
// Deliberately cheap — a wide board can show this in several columns at once:
//  * the belt is a strip of plain skewed Views translated by exactly one
//    stripe pitch on a loop (seamless, and no CSS gradient, which would be a
//    react-native-web-only style anyway),
//  * exactly two shared values / animated styles per instance,
//  * no SVG, no filters, no blur, no per-frame JS.
//
// Reduced motion follows Reanimated's own `useReducedMotion()` (OS "Reduce
// Motion" / `prefers-reduced-motion`) — the same mechanism #124's stage
// transition FX standardized on — and degrades to the identical composition
// rendered statically: belt stripes in place, crate parked mid-belt.

const BELT_WIDTH = 200;
const BELT_HEIGHT = 24;
const STRIPE_PITCH = 14;
const STRIPE_WIDTH = 6;
const CRATE_SIZE = 18;

// One extra pitch of stripes at each end so the strip stays covered across the
// full one-pitch travel of the loop.
const STRIPE_COUNT = Math.ceil(BELT_WIDTH / STRIPE_PITCH) + 2;
const STRIPES = Array.from({ length: STRIPE_COUNT }, (_, i) => i);

const BELT_CYCLE = 1500;
/** Full crate loop, most of which it spends parked off the right edge (clipped
 * out of view) so the belt reads as mostly empty. */
const CRATE_CYCLE = 7200;
const CRATE_TRAVEL_FRACTION = 0.55;

export function IdleConveyor({ accentColor, label = 'No Active Tasks' }: { accentColor?: string; label?: string }) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  const belt = useSharedValue(0);
  const crate = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    belt.value = withRepeat(withTiming(1, { duration: BELT_CYCLE, easing: Easing.linear }), -1, false);
    crate.value = withRepeat(withTiming(1, { duration: CRATE_CYCLE, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(belt);
      cancelAnimation(crate);
    };
  }, [reducedMotion, belt, crate]);

  const beltStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -STRIPE_PITCH * belt.value }],
  }));

  const crateStyle = useAnimatedStyle(() => {
    if (reducedMotion) {
      return { transform: [{ translateX: (BELT_WIDTH - CRATE_SIZE) / 2 }, { translateY: 0 }] };
    }
    const travel = Math.min(crate.value / CRATE_TRAVEL_FRACTION, 1);
    const from = -CRATE_SIZE - 8;
    const to = BELT_WIDTH + 8;
    return {
      transform: [
        { translateX: from + (to - from) * travel },
        // Subtle bob, as if the crate is riding over the belt's rollers.
        { translateY: Math.sin(travel * Math.PI * 7) * 1.2 },
      ],
    };
  });

  // Reuses the stage's own dot colour so the crate belongs to the column it
  // sits in; falls back to the theme's muted text colour.
  const crateColor = accentColor || colors.textMuted;

  return (
    <View className="py-20 items-center justify-center w-full">
      <View style={{ width: BELT_WIDTH }} className="opacity-50">
        {/* Crate lane — clipped, so the crate slides in and out of frame. */}
        <View style={{ height: CRATE_SIZE + 2, overflow: 'hidden' }}>
          <Animated.View
            style={[
              {
                position: 'absolute',
                top: 2,
                width: CRATE_SIZE,
                height: CRATE_SIZE,
                borderWidth: 1,
                borderRadius: 5,
                borderColor: crateColor,
                backgroundColor: crateColor,
                opacity: 0.75,
              },
              crateStyle,
            ]}
          />
        </View>

        {/* Belt */}
        <View
          style={{ height: BELT_HEIGHT, overflow: 'hidden' }}
          className="rounded-full border border-surface-border/60 bg-surface-card/40"
        >
          <Animated.View
            style={[{ position: 'absolute', top: 0, bottom: 0, left: -STRIPE_PITCH, width: BELT_WIDTH + STRIPE_PITCH * 2 }, beltStyle]}
          >
            {STRIPES.map(i => (
              <View
                key={i}
                className="bg-typography-muted/20"
                style={{
                  position: 'absolute',
                  top: -4,
                  bottom: -4,
                  left: i * STRIPE_PITCH,
                  width: STRIPE_WIDTH,
                  transform: [{ skewX: '-20deg' }],
                }}
              />
            ))}
          </Animated.View>
        </View>

        {/* Rollers at either end — static, they just sell the belt. The belt is
            the last child, so `bottom` centres them on it. */}
        <View
          pointerEvents="none"
          className="rounded-full border border-surface-border/70 bg-surface-card/60"
          style={{ position: 'absolute', left: 3, bottom: (BELT_HEIGHT - 10) / 2, width: 10, height: 10 }}
        />
        <View
          pointerEvents="none"
          className="rounded-full border border-surface-border/70 bg-surface-card/60"
          style={{ position: 'absolute', right: 3, bottom: (BELT_HEIGHT - 10) / 2, width: 10, height: 10 }}
        />
      </View>

      <Text className="text-typography-muted text-xs mt-6 font-black uppercase tracking-widest opacity-30">{label}</Text>
    </View>
  );
}

export default IdleConveyor;
