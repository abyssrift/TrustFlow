import React from 'react';
import { Animated, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useDropPulse } from '@/hooks/useWebDnd';

type FileDropOverlayProps = {
  /** An OS file drag is happening somewhere in the window — show the dim idle hint. */
  active: boolean;
  /** The cursor is over THIS zone — escalate to the full FileHub look. */
  over: boolean;
  /** Centered call-to-action copy. */
  label?: string;
  /** Optional positioning override for a non-full-screen parent. */
  style?: StyleProp<ViewStyle>;
};

// Extracted from _filehub_desktop.tsx's screen-level drop overlay so every drop
// zone (Tasks screen, task composer, FileHub) shows the same affordance. Two
// intensities: `over` = the original full-strength look; `active && !over` = a
// dimmed idle hint shown on every mounted zone the instant a drag enters the
// window. Web-only in practice — `active` never goes true on native (no OS
// drag). pointerEvents="none" throughout; inline style is the sanctioned
// overlay exception (ui-consistency.md).
export function FileDropOverlay({ active, over, label = 'Drop files here', style }: FileDropOverlayProps) {
  const colors = useThemeColors();
  // One shared loop drives both states (only 1–2 zones ever mounted at once).
  // useDropPulse gates on useReducedMotion internally → static in both states
  // when the OS asks for it. Idle breathes at half the hover amplitude
  // (1.15 → 1.075) so every eligible zone still *animates* the moment a drag
  // starts, just gently.
  const { iconScale } = useDropPulse(active || over);
  const scale = over
    ? iconScale
    : iconScale.interpolate({ inputRange: [1, 1.15], outputRange: [1, 1.075] });

  if (!active && !over) return null;

  return (
    <View
      pointerEvents="none"
      className="absolute inset-0 z-50 items-center justify-center border-2 border-dashed rounded-3xl m-3"
      style={[
        {
          borderColor: over ? colors.primary : colors.primary + '55',
          backgroundColor: over ? colors.primary + '14' : colors.primary + '08',
          opacity: over ? 1 : 0.7,
        },
        style,
      ]}
    >
      <View
        className="items-center gap-3 px-8 py-6 rounded-3xl"
        style={{ backgroundColor: colors.card, opacity: over ? 1 : 0.9 }}
      >
        <Animated.View style={{ transform: [{ scale: over ? iconScale : 1 }] }}>
          <FontAwesome
            name="cloud-upload"
            size={over ? 28 : 22}
            color={over ? colors.primary : colors.primary + 'AA'}
          />
        </Animated.View>
        <Text className="font-black" style={{ color: colors.textMain, fontSize: over ? 16 : 13 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}
