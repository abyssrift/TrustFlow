import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

// ─── Stage odometer ───────────────────────────────────────────────────────
//
// The task count in a desktop stage-column header used to swap silently: a
// batch of tasks landing in a stage (a sync, a filter change, a card advancing)
// read as nothing at all. This renders that same int as a mechanical odometer
// instead — each digit place is its own vertical 0-9 strip that slides to its
// new position, so a change reads as an event.
//
// Purely presentational: it wraps whatever number the header already computed
// and changes nothing about how or when that number is derived.
//
// Notes on the two things that are easy to get wrong here:
//
//  • Carries are free. Every place animates independently from wherever its
//    strip currently sits, so 9→10 is just "ones rolls 9→0, tens rolls 0→1"
//    with no special-cased carry logic — provided the tens place already
//    exists, which is what the zero-padding below guarantees.
//  • Width must not depend on the value. Each slot contains all ten digits, so
//    its intrinsic width is the widest digit in the current font and is
//    identical for every slot regardless of what it displays. Combined with
//    zero-padding to a fixed number of places, the badge holds its width as a
//    count crosses a power of ten instead of reflowing the header.
//
// Reduced motion follows Reanimated's `useReducedMotion()` — the same
// mechanism the rest of this board's transitions use (see StageTransitionFX)
// rather than a second bespoke pathway.

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Height of one digit cell, and therefore the per-place translate step.
 * Tuned to the stage header badge's 10px type so the badge keeps the height it
 * had when this was a plain <Text>. Unlike width, this can't be intrinsic — the
 * translate math needs a number. */
const DIGIT_HEIGHT = 13;

/** Snappy but settled — a mechanical counter, not a bounce. */
const ROLL_SPRING = { damping: 20, stiffness: 190, mass: 0.6 } as const;

function OdometerDigit({ digit }: { digit: number }) {
  const reduceMotion = useReducedMotion();
  // Starts at 0 and rolls to its value on mount. That covers the odd case of a
  // count growing past its padded width (99→100): the new place mounts and
  // rolls in like every other digit instead of snapping into existence.
  const offset = useSharedValue(0);

  useEffect(() => {
    const target = -digit * DIGIT_HEIGHT;
    offset.value = reduceMotion ? target : withSpring(target, ROLL_SPRING);
  }, [digit, reduceMotion, offset]);

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  return (
    <View style={{ height: DIGIT_HEIGHT, overflow: 'hidden' }}>
      <Animated.View style={stripStyle}>
        {DIGITS.map((d) => (
          <Text
            key={d}
            className="text-typography-muted text-[10px] font-black"
            style={{ height: DIGIT_HEIGHT, lineHeight: DIGIT_HEIGHT, textAlign: 'center' }}
          >
            {d}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

function StageCountOdometer({ value, minPlaces = 2 }: {
  value: number;
  /** Places to zero-pad to. Two covers any realistic stage column, so the
   * badge never changes width in practice; a count past that just grows a
   * place rather than being clamped. */
  minPlaces?: number;
}) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const digits = String(safe).padStart(minPlaces, '0').split('');

  return (
    <View className="flex-row">
      {digits.map((d, i) => (
        // Keyed by place counted from the right, so the ones digit stays the
        // same element (and keeps its strip position to animate from) when the
        // count gains or loses a place.
        <OdometerDigit key={digits.length - i} digit={Number(d)} />
      ))}
    </View>
  );
}

// The board re-renders this header often (drag state, filters, timers) while
// the count itself rarely moves — memoing keeps every visible column's digits
// from re-running their animated styles for nothing.
export default React.memo(StageCountOdometer);
