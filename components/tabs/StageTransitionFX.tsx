import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import type { FlipRect } from '@/components/common/AnimatedTaskCard';
import { supabase } from '@/lib/supabase';

// ─── Comet-trail stage transition FX ──────────────────────────────────────
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
  fromY: number;
  toX: number;
  toY: number;
  actorUserId?: string | null;
};

type ActorInfo = { name: string; avatar: string | null };

// TEMP diagnostics — strip once the board FX are confirmed working.
export const FX_DEBUG = true;

const TRAIL_DURATION = 700;
const CHIP_DURATION = 3200;
// Trail entries drive both the connector pulse (self-completes at
// TRAIL_DURATION) and the actor chip (rides, then lingers at the landing
// spot — CHIP_DURATION total) — one removal timeout covers both rather than
// tracking two lifetimes.
const TRAIL_ENTRY_TTL = CHIP_DURATION + 400;

// Module-level so a resolved name/avatar survives across board remounts —
// keyed by user id, never invalidated (names/avatars change rarely enough
// that a stale chip for a few minutes is a non-issue).
const actorInfoCache = new Map<string, ActorInfo>();

function isWebNode(node: any): boolean {
  return Platform.OS === 'web' && !!node && typeof node.getBoundingClientRect === 'function';
}

// Both pulse components below animate through the Web Animations API on the
// DOM node react-native-web hands back through the ref — NOT reanimated
// worklets, which proved to silently not paint on this project's web build
// (worklets/babel config drift). element.animate() is native to every
// browser, compositor-driven (cheap on low-end machines), and immune to
// bundler configuration. These components only ever render on web
// (StageTrailLayer bails otherwise), so there is no native path to preserve.

function StageTrailPulse({ gradientId, fromX, fromY, toX, toY, color }: { gradientId: string; fromX: number; fromY: number; toX: number; toY: number; color: string }) {
  const ref = useRef<any>(null);

  useEffect(() => {
    const node: any = ref.current;
    if (FX_DEBUG) console.log('[FXDBG] TrailPulse mount — node:', node?.tagName ?? node?.constructor?.name, 'animate?', typeof node?.animate === 'function', 'travel:', Math.round(toX - fromX), ',', Math.round(toY - fromY), 'px');
    if (!node || typeof node.animate !== 'function') return;
    const anim = node.animate(
      [
        { transform: 'translate(0px, 0px)', opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { opacity: 1, offset: 0.7 },
        { transform: `translate(${toX - fromX}px, ${toY - fromY}px)`, opacity: 0 },
      ],
      { duration: TRAIL_DURATION, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', fill: 'forwards' }
    );
    if (FX_DEBUG && anim) {
      console.log('[FXDBG] TrailPulse anim created, playState:', anim.playState);
      anim.onfinish = () => console.log('[FXDBG] TrailPulse anim finished');
      anim.oncancel = () => console.log('[FXDBG] TrailPulse anim CANCELED');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View ref={ref} style={{ position: 'absolute', left: fromX - 24, top: fromY - 24, width: 48, height: 48, opacity: 0 }}>
      <Svg width={48} height={48}>
        <Defs>
          <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={1} />
            <Stop offset="55%" stopColor={color} stopOpacity={0.55} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={24} cy={24} r={22} fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}

// Small pill riding the connector trail, naming who moved the card. Same
// WAAPI approach as StageTrailPulse; rides to the card's landing spot in the
// first half, then lingers there so the name is actually readable.
function ActorChipPulse({ fromX, fromY, toX, toY, color, info }: { fromX: number; fromY: number; toX: number; toY: number; color: string; info: ActorInfo }) {
  const ref = useRef<any>(null);

  useEffect(() => {
    const node: any = ref.current;
    if (FX_DEBUG) console.log('[FXDBG] ActorChip mount — node:', node?.tagName ?? node?.constructor?.name, 'animate?', typeof node?.animate === 'function', 'name:', info.name);
    if (!node || typeof node.animate !== 'function') return;
    const arrive = `translate(${toX - fromX}px, ${toY - fromY}px)`;
    const anim = node.animate(
      [
        { transform: 'translate(0px, 0px) scale(0.9)', opacity: 0 },
        { opacity: 1, offset: 0.05 },
        // Ride over (~0.9s), pop slightly on arrival, then linger readable.
        { transform: `${arrive} scale(1.12)`, opacity: 1, offset: 0.28 },
        { transform: `${arrive} scale(1)`, opacity: 1, offset: 0.34, easing: 'linear' },
        { transform: `${arrive} scale(1)`, opacity: 1, offset: 0.92 },
        { transform: `${arrive} scale(0.95)`, opacity: 0 },
      ],
      { duration: CHIP_DURATION, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', fill: 'forwards' }
    );
    if (FX_DEBUG && anim) anim.oncancel = () => console.log('[FXDBG] ActorChip anim CANCELED');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      ref={ref}
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: fromY - 34,
        left: fromX,
        opacity: 0,
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(0,0,0,0.85)',
        borderWidth: 1.5,
        borderColor: color,
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      {info.avatar ? (
        <Image source={{ uri: info.avatar }} style={{ width: 22, height: 22, borderRadius: 11 }} />
      ) : (
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{info.name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{info.name}</Text>
    </View>
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
  const osReducedMotion = useReducedMotion();
  // TEMP: while FX_DEBUG is on, ignore the OS reduce-motion flag — the dev
  // machine's Windows "best performance" preset broadcasts it, which would
  // suppress every FX we're trying to verify. Revert to plain
  // useReducedMotion() when stripping FX_DEBUG.
  const reducedMotion = FX_DEBUG ? false : osReducedMotion;
  const stageByTaskRef = useRef<Map<string, string>>(new Map());
  const beforeRectRef = useRef<Map<string, FlipRect>>(new Map());
  const columnNodeRef = useRef<Map<string, any>>(new Map());
  const boardListenerCleanupRef = useRef<(() => void) | null>(null);
  const actorByTaskRef = useRef<Map<string, string | null>>(new Map());
  const [trails, setTrails] = useState<Trail[]>([]);
  const [actorInfo, setActorInfo] = useState<Record<string, ActorInfo>>({});

  // TEMP diagnostics — one-time probe: does this browser/build expose WAAPI at all?
  useEffect(() => {
    if (!FX_DEBUG || Platform.OS !== 'web') return;
    try {
      const el = document.createElement('div');
      const supported = typeof el.animate === 'function';
      let probeState = 'n/a';
      if (supported) {
        const probe = el.animate([{ opacity: 0 }, { opacity: 1 }], 100);
        probeState = probe.playState;
        probe.cancel();
      }
      console.log('[FXDBG] WAAPI probe — element.animate supported:', supported, 'probe playState:', probeState, 'osReducedMotion:', osReducedMotion, '(overridden to', reducedMotion, 'while FX_DEBUG)');
    } catch (e) {
      console.log('[FXDBG] WAAPI probe threw:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Records who triggered a task's next stage change (e.g. from a realtime
   * pipeline_stage_history row) so commitMount can attach it to the trail it
   * fires for that move. */
  const noteActor = useCallback((taskId: string, userId: string | null) => {
    actorByTaskRef.current.set(taskId, userId);
  }, []);

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
      if (FX_DEBUG) console.log('[FXDBG] rect captured', taskId, Math.round(box.left), Math.round(box.top));
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

  const fireTrail = useCallback((fromStageId: string, toStageId: string, actorUserId?: string | null, cardRect?: FlipRect | null, landRect?: FlipRect | null) => {
    const boardNode: any = boardContainerRef.current;
    const fromNode = columnNodeRef.current.get(fromStageId);
    const toNode = columnNodeRef.current.get(toStageId);
    if (FX_DEBUG) console.log('[FXDBG] fireTrail', { board: isWebNode(boardNode), from: !!fromNode, to: !!toNode, actorUserId, cardRect: !!cardRect, landRect: !!landRect });
    if (!isWebNode(boardNode) || (!fromNode && !cardRect) || (!toNode && !landRect)) return;
    const boardBox = boardNode.getBoundingClientRect();
    // Ride the card's actual path: from where the card sat before the move to
    // where it just landed (its freshly-measured mount rect) — a diagonal
    // when the card lands at a different height. Column centers are only the
    // fallback when either rect wasn't captured.
    const fromBox = fromNode?.getBoundingClientRect();
    const toBox = toNode?.getBoundingClientRect();
    const fromX = (cardRect ? cardRect.x + cardRect.width / 2 : (fromBox!.left + fromBox!.right) / 2) - boardBox.left;
    const fromY = (cardRect ? cardRect.y + cardRect.height / 2 : (fromBox!.top + 40)) - boardBox.top;
    const toX = (landRect ? landRect.x + landRect.width / 2 : (toBox!.left + toBox!.right) / 2) - boardBox.left;
    const toY = landRect ? landRect.y + landRect.height / 2 - boardBox.top : fromY;
    const key = `${fromStageId}-${toStageId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (FX_DEBUG) console.log('[FXDBG] fireTrail geometry — from:', Math.round(fromX), ',', Math.round(fromY), 'to:', Math.round(toX), ',', Math.round(toY));
    setTrails(prev => [...prev, { key, fromX, fromY, toX, toY, actorUserId }]);

    if (actorUserId) {
      const cached = actorInfoCache.get(actorUserId);
      if (cached) {
        setActorInfo(prev => (prev[actorUserId] ? prev : { ...prev, [actorUserId]: cached }));
      } else {
        supabase.from('users').select('id, full_name, email, avatar_url').eq('id', actorUserId).single()
          .then(({ data }: any) => {
            if (!data) return;
            const info: ActorInfo = { name: data.full_name || data.email || 'Someone', avatar: data.avatar_url ?? null };
            actorInfoCache.set(actorUserId, info);
            setActorInfo(prev => ({ ...prev, [actorUserId]: info }));
          });
      }
    }

    setTimeout(() => {
      setTrails(prev => prev.filter(t => t.key !== key));
    }, TRAIL_ENTRY_TTL);
  }, [boardContainerRef]);

  /** Pure read — safe to call during render. Tells a card, as it's about to
   * render, whether it just arrived from a different stage and (if so) what
   * rect to FLIP in from. */
  const peekTransition = useCallback((taskId: string, currentStageId: string): PendingTransition | null => {
    if (Platform.OS !== 'web') return null;
    const lastStage = stageByTaskRef.current.get(taskId);
    if (!lastStage || lastStage === currentStageId) return null;
    if (FX_DEBUG) console.log('[FXDBG] peek: move detected', taskId, lastStage, '->', currentStageId, 'rect?', beforeRectRef.current.has(taskId), 'reducedMotion?', reducedMotion);
    if (reducedMotion) return { flipFrom: null, fromStageId: lastStage };
    return { flipFrom: beforeRectRef.current.get(taskId) ?? null, fromStageId: lastStage };
  }, [reducedMotion]);

  /** Called once from the card's own mount effect — records its resting
   * stage and (if this mount is the result of a genuine move) fires the
   * connector trail and invalidates the consumed "before" rect. */
  const commitMount = useCallback((taskId: string, currentStageId: string, fromStageId: string | null, landRect?: FlipRect | null) => {
    stageByTaskRef.current.set(taskId, currentStageId);
    if (fromStageId) {
      const cardRect = beforeRectRef.current.get(taskId) ?? null;
      beforeRectRef.current.delete(taskId);
      const actorUserId = actorByTaskRef.current.get(taskId) ?? null;
      actorByTaskRef.current.delete(taskId);
      if (FX_DEBUG) console.log('[FXDBG] commitMount: genuine move', taskId, fromStageId, '->', currentStageId, 'landRect?', !!landRect);
      // Deferred one frame: this runs from the arriving card's layout effect,
      // mid-commit, when the destination column's ref callback (an inline
      // arrow, so detached/re-attached every render) can be momentarily null —
      // firing synchronously found `to: false` and dropped the trail. By the
      // next frame every column ref is re-attached.
      if (!reducedMotion) requestAnimationFrame(() => fireTrail(fromStageId, currentStageId, actorUserId, cardRect, landRect));
    }
  }, [fireTrail, reducedMotion]);

  return { registerColumn, peekTransition, commitMount, noteActor, trails, actorInfo, glowColor };
}

/**
 * Renders the in-flight connector trails. Deliberately a plain top-level
 * component taking `trails`/`color` as props rather than something handed
 * back from the hook as a closure — a function recreated on every `trails`
 * change (e.g. via useCallback) would have a new identity each time and, used
 * as a JSX component reference, would make React treat it as a different
 * component type and remount the whole layer (and every in-flight
 * `StageTrailPulse`'s animation) whenever a second trail starts while the
 * first is still playing.
 */
export function StageTrailLayer({ trails, color, actorInfo }: { trails: Trail[]; color: string; actorInfo?: Record<string, ActorInfo> }) {
  if (Platform.OS !== 'web' || trails.length === 0) return null;
  if (FX_DEBUG) console.log('[FXDBG] StageTrailLayer rendering', trails.length, 'trail(s)');
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 60 }}>
      {trails.map(({ key, actorUserId, ...rest }) => {
        const info = actorUserId ? actorInfo?.[actorUserId] : undefined;
        return (
          <React.Fragment key={key}>
            <StageTrailPulse gradientId={`stageTrailGlow-${key}`} {...rest} color={color} />
            {info && <ActorChipPulse {...rest} color={color} info={info} />}
          </React.Fragment>
        );
      })}
    </View>
  );
}
