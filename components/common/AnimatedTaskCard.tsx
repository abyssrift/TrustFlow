import React, { useLayoutEffect, useRef } from 'react';
import type { ViewStyle } from 'react-native';
import { Platform } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';

/** Plain viewport rect (getBoundingClientRect-shaped) used to FLIP a card
 * between stage columns — see StageTransitionFX for how it's captured. */
export type FlipRect = { x: number; y: number; width: number; height: number };

const FLIP_DURATION = 480;
const EXIT_DURATION = 320;
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Same DOM-node resolution the FLIP effect uses — react-native-web's
 * Animated.View ref can hand back a few different shapes depending on
 * version/wrapper. */
function resolveDomNode(node: any): any {
  if (Platform.OS !== 'web' || !node) return null;
  if (typeof node.animate === 'function') return node;
  if (node._nativeTag && typeof node._nativeTag.animate === 'function') return node._nativeTag;
  if (typeof node.getNode === 'function') return node.getNode();
  return null;
}

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
  exiting,
  onExited,
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
   * the caller record this card's resting stage / clear the consumed rect.
   * On web it receives the card's freshly-measured landing rect (null when
   * unmeasurable / non-web) so FX can follow the card's true path. */
  onFlipMount?: (landRect?: FlipRect | null) => void;
  /** Set true to play a shrink+fade WAAPI exit (same technique/easing as the
   * FLIP) and THEN unmount — the caller must keep this card in its list
   * until `onExited` fires, since reanimated's own declarative `exiting`
   * (below) proved to silently not paint on this project's web build, same
   * as the FLIP. Removing the card from state immediately is why it used to
   * just vanish with no animation. */
  exiting?: boolean;
  /** Fired once the exit animation finishes (or immediately, on native /
   * when WAAPI isn't available) — the caller should now actually remove the
   * card from its list. */
  onExited?: () => void;
}) {
  const ref = useRef<any>(null);
  const exitFiredRef = useRef(false);

  // Plays once, the instant `exiting` flips true. Mirrors the FLIP effect
  // below: WAAPI directly on the DOM node, not reanimated's `exiting` prop,
  // which doesn't paint here (see FLIP_DURATION comment).
  useLayoutEffect(() => {
    if (!exiting || exitFiredRef.current) return;
    exitFiredRef.current = true;
    const domNode: any = resolveDomNode(ref.current);
    if (!domNode || typeof domNode.animate !== 'function') {
      onExited?.();
      return;
    }
    const anim = domNode.animate(
      [
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(0.92)', opacity: 0 },
      ],
      { duration: EXIT_DURATION, easing: FLIP_EASING, fill: 'forwards' }
    );
    const finish = () => onExited?.();
    if (!anim) { finish(); return; }
    anim.onfinish = finish;
    anim.oncancel = finish;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  // Mount-only: a stage move always remounts this component fresh (the task
  // moves from one stage column's list to a different one's), so this never
  // needs to re-run for an instance that's already settled.
  //
  // The FLIP itself runs through the Web Animations API on the DOM node
  // directly, not a reanimated shared value: worklet-driven styles proved to
  // silently not paint on this project's web build (babel/worklets config
  // drift), whereas element.animate() is native to every browser and runs on
  // the compositor — cheaper on low-end machines too. Web-only by definition,
  // which is the only place flipFrom is ever supplied.
  useLayoutEffect(() => {
    // Resolve the DOM node first — the ref sits on reanimated's Animated.View,
    // which may hand back a wrapper instance rather than the element.
    const domNode: any = resolveDomNode(ref.current);
    const after = domNode && typeof domNode.getBoundingClientRect === 'function'
      ? domNode.getBoundingClientRect()
      : null;
    onFlipMount?.(after ? { x: after.left, y: after.top, width: after.width, height: after.height } : null);
    if (Platform.OS !== 'web' || !flipFrom) return;
    // TEMP diagnostics — see FX_DEBUG in StageTransitionFX.
    if (!after || typeof domNode.animate !== 'function') {
      console.log('[FXDBG] FLIP skip: no usable DOM node from ref');
      return;
    }
    const dx = flipFrom.x - after.left;
    const dy = flipFrom.y - after.top;
    console.log('[FXDBG] FLIP playing, dx/dy', Math.round(dx), Math.round(dy), 'after rect', Math.round(after.left), Math.round(after.top), Math.round(after.width), 'x', Math.round(after.height));
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { console.log('[FXDBG] FLIP skip: delta < 1px'); return; }
    const anim = domNode.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        // Arrive by ~80%, overshoot into a slight pop, then settle — reads as
        // the card physically landing rather than gliding to a dead stop.
        { transform: 'translate(0, 0) scale(1.035)', offset: 0.8 },
        { transform: 'translate(0, 0) scale(1)' },
      ],
      { duration: FLIP_DURATION, easing: FLIP_EASING }
    );
    console.log('[FXDBG] FLIP anim created, playState:', anim?.playState);
    if (anim) {
      anim.onfinish = () => console.log('[FXDBG] FLIP anim finished');
      anim.oncancel = () => console.log('[FXDBG] FLIP anim CANCELED');
    }
    requestAnimationFrame(() => {
      try {
        const cs = window.getComputedStyle(domNode);
        console.log('[FXDBG] FLIP mid-flight check — playState:', anim?.playState, 'computed transform:', cs.transform, 'opacity:', cs.opacity, 'visibility:', cs.visibility);
      } catch {}
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      ref={ref}
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(140)}
      layout={disableLayoutAnimation ? undefined : LinearTransition.springify().damping(20).stiffness(170).mass(0.6)}
      style={style}
      pointerEvents={exiting ? 'none' : undefined}
    >
      {children}
    </Animated.View>
  );
}
