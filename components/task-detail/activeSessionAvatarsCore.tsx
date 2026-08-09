import { IDLE_MS, idleMsOf } from '@/lib/sessionPresence';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect } from 'react';
import { Image, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { ActiveSessionUser } from './TaskCardActions';

// Shared, non-portaled pieces of the "who's working now" avatar stack — the
// part of ActiveSessionAvatars that stays inside the normal page tree on both
// platforms, so NativeWind theme-token classes render correctly here (unlike
// the hover popover on web, which portals out to document.body and loses
// them — see ActiveSessionAvatars.web.tsx).

export function Avatar({ user, size = 28 }: { user: ActiveSessionUser; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="overflow-hidden bg-surface-overlay items-center justify-center border-2 border-surface-card"
    >
      {user.avatar ? (
        <Image source={{ uri: user.avatar }} style={{ width: '100%', height: '100%' }} />
      ) : (
        <Text className="text-brand-primary font-black" style={{ fontSize: Math.round(size * 0.42) }}>
          {user.name.charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

export const StatusDot = React.memo(function StatusDot({ idle }: { idle: boolean }) {
  return (
    <View
      className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-card ${
        idle ? 'bg-state-warning' : 'bg-state-success pulse-animation'
      }`}
    />
  );
});

const PULSE_DOT_SIZE = 4;
const PULSE_CYCLE_MS = 700;
const PULSE_STAGGER_MS = 140;

function PulseDot({ delay, bounceHeight, color }: { delay: number; bounceHeight: number; color: string }) {
  const reducedMotion = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    t.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: PULSE_CYCLE_MS / 2, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: PULSE_CYCLE_MS / 2, easing: Easing.in(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(t);
  }, [reducedMotion, t, delay]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -t.value * bounceHeight }],
    opacity: 0.55 + t.value * 0.45,
  }));

  return (
    <Animated.View
      style={[
        { width: PULSE_DOT_SIZE, height: PULSE_DOT_SIZE, borderRadius: PULSE_DOT_SIZE / 2, backgroundColor: color, marginHorizontal: 1 },
        style,
      ]}
    />
  );
}

const TAP_ROTATE_DEG = 8;
const TAP_CYCLE_MS = 380;

/** Count === 1: a lone laptop, tapping away — small quick rotate tremor. */
function TappingLaptop({ color }: { color: string }) {
  const reducedMotion = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    t.value = withRepeat(
      withSequence(
        withTiming(1, { duration: TAP_CYCLE_MS / 2, easing: Easing.inOut(Easing.quad) }),
        withTiming(-1, { duration: TAP_CYCLE_MS, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: TAP_CYCLE_MS / 2, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(t);
  }, [reducedMotion, t]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${t.value * TAP_ROTATE_DEG}deg` }],
  }));

  return (
    <Animated.View style={style}>
      <FontAwesome name="laptop" size={11} color={color} />
    </Animated.View>
  );
}

/**
 * "Someone's actually working" tell next to the avatar stack — caller caps
 * `count` at 3 on purpose: past that a scene stops reading as personality and
 * starts reading as noise, so busier tasks just keep the plain avatar stack.
 *  1 → a laptop tapping away solo (rotate tremor).
 *  2 → two dots trading off, like a back-and-forth chat.
 *  3 → three dots bouncing in sync, like a little group jumping together.
 */
export function WorkingPulse({ count, color }: { count: 1 | 2 | 3; color: string }) {
  if (count === 1) {
    return (
      <View className="ml-1.5 items-center justify-center" style={{ width: 14, height: 14 }}>
        <TappingLaptop color={color} />
      </View>
    );
  }

  const sync = count === 3;
  const bounceHeight = count === 3 ? 6 : 4;

  return (
    <View className="flex-row items-end ml-1.5" style={{ height: PULSE_DOT_SIZE + bounceHeight }}>
      {Array.from({ length: count }, (_, i) => (
        <PulseDot key={i} delay={sync ? 0 : i * PULSE_STAGGER_MS} bounceHeight={bounceHeight} color={color} />
      ))}
    </View>
  );
}

export function groupSessions(sessions: ActiveSessionUser[]) {
  const shown = sessions.slice(0, 5);
  const extra = sessions.length - shown.length;
  const allIdle = sessions.every(s => idleMsOf(s.lastHeartbeatAt) > IDLE_MS);
  return { shown, extra, allIdle };
}

export const formatSessionStart = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
