import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

// ─── SLA "Risk Tempo" — severity as pulse rate ────────────────────────────────
//
// SLA risk already has one visual channel: colour, keyed to the *driver*
// (deadline / over_budget / stalled). That deliberately says nothing about how
// bad it is — a stalled task reads calm-blue even at 85%. Meanwhile the RPC
// hands us a genuine continuous magnitude (`risk_percent`) that the UI throws
// away after using it as a number on the right-hand side of a row.
//
// This adds a second, orthogonal channel: tempo. A sonar ring around the risk
// dot expands and fades on a loop whose period shortens as `risk_percent`
// climbs, so escalating severity is felt before it is read. Colour is
// untouched — the ring simply borrows whatever colour the driver already
// chose, so the two channels never fight.
//
// Deliberately platform-agnostic (Reanimated + plain RN primitives, no
// `recharts`, no web-only DOM/CSS): the desktop `RadarWidgets` grid and the
// native/adaptive SLA lists share this one implementation, and the adaptive
// files' "no charting lib in the native bundle" rule stays intact.
//
// ── Restraint ──
// These render in a list of up to 10 rows at once, so the failure mode is a
// strobing dashboard, not an under-sold one. Five things damp it:
//
//  1. A floor (`SLA_PULSE_FLOOR`). Below it the dot is completely static —
//     no rings mounted, no animation running at all.
//  2. That floor is 80, not the RPC's own 75 inclusion threshold. The audit
//     RPC only emits rows already at >= 75, so a floor of 75 would animate
//     *every* visible card and encode nothing; 80 keeps the bottom of the
//     emitted range quiet and reserves motion for genuine escalation.
//  3. Ring count ramps: one ring until `SLA_PULSE_DUAL_FROM`, two above it.
//  4. Peak opacity ramps with severity too, so a just-over-floor row breathes
//     faintly rather than announcing itself.
//  5. Rows are handed a per-index `stagger`, so a full grid never pulses in
//     unison (a synchronised grid reads as one big flash; an offset one reads
//     as ambient texture).
//
// Reduced motion uses Reanimated's own `useReducedMotion()` — the same
// mechanism the rest of the app's motion work already goes through — and
// falls all the way back to the plain static dot.

/** Below this `risk_percent` the dot never animates. See note 2 above. */
export const SLA_PULSE_FLOOR = 80;
/** `risk_percent` is capped at 99 by the audit RPC. */
export const SLA_PULSE_CEIL = 99;
/** Period at the floor — slow enough to read as breathing, not blinking. */
export const SLA_PULSE_SLOW_MS = 2400;
/** Period at the ceiling. Urgent, but intentionally short of a strobe. */
export const SLA_PULSE_FAST_MS = 900;
/** Second (half-period-offset) ring only joins in above this. */
export const SLA_PULSE_DUAL_FROM = 90;

const PEAK_OPACITY_MIN = 0.26;
const PEAK_OPACITY_MAX = 0.55;
const RING_SCALE_FROM = 0.8;
const RING_SCALE_TO = 2.9;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** 0 at the pulse floor, 1 at the ceiling. Clamped at both ends. */
export const slaSeverityT = (riskPercent?: number | null) =>
  clamp01(((riskPercent ?? 0) - SLA_PULSE_FLOOR) / (SLA_PULSE_CEIL - SLA_PULSE_FLOOR));

/** `risk_percent` -> pulse period in ms. Monotonically faster as risk climbs. */
export const slaPulseDuration = (riskPercent?: number | null) =>
  Math.round(SLA_PULSE_SLOW_MS + (SLA_PULSE_FAST_MS - SLA_PULSE_SLOW_MS) * slaSeverityT(riskPercent));

/** Deterministic per-row offset so a populated grid never pulses in unison. */
export const slaPulseStagger = (index: number) => (index % 4) * 220;

type SLARiskPulseDotProps = {
  /** `risk_percent` straight off `rpc_get_organizational_audit` (75..99). */
  riskPercent?: number | null;
  /** Resolved driver colour — the caller keeps ownership of the colour channel. */
  color: string;
  /** Dot diameter. Rings overflow it; the layout footprint stays this size. */
  size?: number;
  /** Milliseconds to offset this row's loop by. See `slaPulseStagger`. */
  stagger?: number;
};

/**
 * The existing coloured risk dot, plus sonar rings whose tempo encodes
 * `riskPercent`. Renders exactly the old static dot when below the floor or
 * under reduced motion, and occupies the same `size` x `size` footprint in
 * either case so call-site layout is unaffected.
 */
export function SLARiskPulseDot({ riskPercent, color, size = 6, stagger = 0 }: SLARiskPulseDotProps) {
  const reducedMotion = useReducedMotion();
  const risk = typeof riskPercent === 'number' ? riskPercent : 0;

  const active = !reducedMotion && risk >= SLA_PULSE_FLOOR;
  const dual = active && risk >= SLA_PULSE_DUAL_FROM;
  const duration = slaPulseDuration(risk);
  const peak = PEAK_OPACITY_MIN + (PEAK_OPACITY_MAX - PEAK_OPACITY_MIN) * slaSeverityT(risk);

  const p1 = useSharedValue(0);
  const p2 = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(p1);
      cancelAnimation(p2);
      p1.value = 0;
      p2.value = 0;
      return;
    }
    // `reverse: false` restarts each iteration from the starting value (0),
    // which is what makes this an outward ping rather than a yo-yo.
    const ping = () => withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1, false);
    p1.value = 0;
    p1.value = withDelay(stagger, ping());
    p2.value = 0;
    if (dual) p2.value = withDelay(stagger + Math.round(duration / 2), ping());
    return () => {
      cancelAnimation(p1);
      cancelAnimation(p2);
    };
  }, [active, dual, duration, stagger, p1, p2]);

  const ringStyle1 = useAnimatedStyle(() => ({
    opacity: peak * (1 - p1.value),
    transform: [{ scale: RING_SCALE_FROM + (RING_SCALE_TO - RING_SCALE_FROM) * p1.value }],
  }));
  const ringStyle2 = useAnimatedStyle(() => ({
    opacity: peak * (1 - p2.value),
    transform: [{ scale: RING_SCALE_FROM + (RING_SCALE_TO - RING_SCALE_FROM) * p2.value }],
  }));

  const circle = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
  const ringBase = { position: 'absolute' as const, left: 0, top: 0, ...circle };

  return (
    // `overflow: visible` is the default on web but has to be explicit for the
    // rings to escape this box on Android.
    <View pointerEvents="none" style={{ width: size, height: size, overflow: 'visible' }}>
      {active && <Animated.View pointerEvents="none" style={[ringBase, ringStyle1]} />}
      {dual && <Animated.View pointerEvents="none" style={[ringBase, ringStyle2]} />}
      <View style={circle} />
    </View>
  );
}
