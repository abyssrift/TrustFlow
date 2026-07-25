import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import type { FlipRect } from '@/components/common/AnimatedTaskCard';

// ─── Comet-trail stage transition FX (issue #124) ────────────────────────
//
// Kanban boards traditionally cross-fade or instantly reposition a card when
// it changes stage. This hook drives two effects instead, scoped to the
// desktop board (_tasks_desktop.tsx):
//
//  1. Card FLIP — handled by AnimatedTaskCard itself (see that file). This
//     hook supplies the "before" rect (captured the instant the user
//     interacts with a card, since by the time the resulting stage change
//     lands in state the source DOM node may already be gone) and tracks
//     each task's last-known stage so a genuine move can be told apart from
//     an ordinary re-render.
//  2. Connector trail — a short glowing pulse drawn (react-native-svg +
//     Reanimated) along the gap between the source and destination stage
//     columns, in the direction of travel.
//
// Both are web-only: react-native-web exposes the underlying DOM node via a
// plain ref, which is what makes a synchronous, flicker-free measurement
// (getBoundingClientRect) possible. React Native's own `.measure()` is
// asynchronous on every platform (it round-trips a `setTimeout(0)` even on
// react-native-web — see UIManager.measureLayout) and can't guarantee a
// same-frame read, which a FLIP depends on to avoid a visible snap.
//
// Reduced motion follows Reanimated's own `useReducedMotion()` (mirrors the
// OS "Reduce Motion" setting / `prefers-reduced-motion` on web) — the same
// mechanism already driving every other Reanimated transition on this board,
// rather than introducing a second, bespoke reduced-motion pathway.

type Trail = {
  key: string;
  fromX: number;
  toX: number;
  y: number;
};

const TRAIL_DURATION = 520;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function isWebNode(node: any): boolean {
  return Platform.OS === 'web' && !!node && typeof node.getBoundingClientRect === 'function';
}

function StageTrailPulse({ gradientId, fromX, toX, y, color }: { gradientId: string; fromX: number; toX: number; y: number; color: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: TRAIL_DURATION, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const left = Math.min(fromX, toX) - 18;
  const width = Math.abs(toX - fromX) + 36;
  const localFrom = fromX - left;
  const localTo = toX - left;

  const animatedProps = useAnimatedProps(() => {
    const p = progress.value;
    const fade = p < 0.12 ? p / 0.12 : p > 0.7 ? Math.max(0, (1 - p) / 0.3) : 1;
    return {
      cx: localFrom + (localTo - localFrom) * p,
      opacity: fade,
    } as any;
  });

  return (
    <Svg style={{ position: 'absolute', left, top: y - 18, width, height: 36 }} width={width} height={36}>
      <Defs>
        <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={color} stopOpacity={0.95} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <AnimatedCircle animatedProps={animatedProps} cy={18} r={12} fill={`url(#${gradientId})`} />
    </Svg>
  );
}

export type PendingTransition = {
  /** (Web) Last known rect of this card back when it lived in the source
   * stage column — null when unavailable (e.g. the move wasn't triggered by
   * a click we captured), in which case the card just fades in as before. */
  flipFrom: FlipRect | null;
  fromStageId: string;
};

export function useStageTransitionFX(boardContainerRef: React.RefObject<View | null>, glowColor: string) {
  const reducedMotion = useReducedMotion();
  const stageByTaskRef = useRef<Map<string, string>>(new Map());
  const beforeRectRef = useRef<Map<string, FlipRect>>(new Map());
  const columnNodeRef = useRef<Map<string, any>>(new Map());
  const boardListenerCleanupRef = useRef<(() => void) | null>(null);
  const [trails, setTrails] = useState<Trail[]>([]);

  // Capture a "before" rect the instant the user interacts with a card —
  // this is the only reliable moment to measure it; by the time the RPC
  // resolves and the resulting stage change lands in `tasks`, the source
  // card's DOM node is often already unmounted.
  //
  // Attached lazily (from `registerColumn`, see below) rather than from a
  // plain `useEffect([boardContainerRef])`: the ref object's identity never
  // changes, so an effect keyed on it only ever runs once and would silently
  // no-op forever if `boardContainerRef.current` wasn't populated yet on that
  // first pass (e.g. the board was still in its loading state).
  const ensureBoardListener = useCallback(() => {
    if (boardListenerCleanupRef.current) return;
    const boardNode: any = boardContainerRef.current;
    if (!isWebNode(boardNode)) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement | null;
      const cardEl = target?.closest?.('[data-stage-card-id]') as HTMLElement | null;
      if (!cardEl) return;
      const taskId = cardEl.getAttribute('data-stage-card-id');
      if (!taskId) return;
      const box = cardEl.getBoundingClientRect();
      beforeRectRef.current.set(taskId, { x: box.left, y: box.top, width: box.width, height: box.height });
    };
    boardNode.addEventListener('pointerdown', handler, true);
    boardListenerCleanupRef.current = () => boardNode.removeEventListener('pointerdown', handler, true);
  }, [boardContainerRef]);

  useEffect(() => () => {
    boardListenerCleanupRef.current?.();
    boardListenerCleanupRef.current = null;
  }, []);

  const registerColumn = useCallback((stageId: string, node: any) => {
    if (isWebNode(node)) {
      columnNodeRef.current.set(stageId, node);
      ensureBoardListener();
    } else {
      columnNodeRef.current.delete(stageId);
    }
  }, [ensureBoardListener]);

  const fireTrail = useCallback((fromStageId: string, toStageId: string) => {
    const boardNode: any = boardContainerRef.current;
    const fromNode = columnNodeRef.current.get(fromStageId);
    const toNode = columnNodeRef.current.get(toStageId);
    if (!isWebNode(boardNode) || !fromNode || !toNode) return;
    const boardBox = boardNode.getBoundingClientRect();
    const fromBox = fromNode.getBoundingClientRect();
    const toBox = toNode.getBoundingClientRect();
    const forward = toBox.left >= fromBox.left;
    const fromX = (forward ? fromBox.right : fromBox.left) - boardBox.left;
    const toX = (forward ? toBox.left : toBox.right) - boardBox.left;
    const y = Math.min(fromBox.top, toBox.top) - boardBox.top + 22;
    const key = `${fromStageId}-${toStageId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setTrails(prev => [...prev, { key, fromX, toX, y }]);
    setTimeout(() => {
      setTrails(prev => prev.filter(t => t.key !== key));
    }, TRAIL_DURATION + 150);
  }, [boardContainerRef]);

  /** Pure read — safe to call during render. Tells a card, as it's about to
   * render, whether it just arrived from a different stage and (if so) what
   * rect to FLIP in from. */
  const peekTransition = useCallback((taskId: string, currentStageId: string): PendingTransition | null => {
    if (Platform.OS !== 'web') return null;
    const lastStage = stageByTaskRef.current.get(taskId);
    if (!lastStage || lastStage === currentStageId) return null;
    if (reducedMotion) return { flipFrom: null, fromStageId: lastStage };
    return { flipFrom: beforeRectRef.current.get(taskId) ?? null, fromStageId: lastStage };
  }, [reducedMotion]);

  /** Called once from the card's own mount effect — records its resting
   * stage and (if this mount is the result of a genuine move) fires the
   * connector trail and invalidates the consumed "before" rect. */
  const commitMount = useCallback((taskId: string, currentStageId: string, fromStageId: string | null) => {
    stageByTaskRef.current.set(taskId, currentStageId);
    if (fromStageId) {
      beforeRectRef.current.delete(taskId);
      if (!reducedMotion) fireTrail(fromStageId, currentStageId);
    }
  }, [fireTrail, reducedMotion]);

  const TrailLayer = useCallback(() => {
    if (Platform.OS !== 'web' || trails.length === 0) return null;
    return (
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 60 }}>
        {trails.map(({ key, ...rest }) => (
          <StageTrailPulse key={key} gradientId={`stageTrailGlow-${key}`} {...rest} color={glowColor} />
        ))}
      </View>
    );
  }, [trails, glowColor]);

  return { registerColumn, peekTransition, commitMount, TrailLayer };
}
