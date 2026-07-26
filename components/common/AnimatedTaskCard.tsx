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
   * the caller record this card's resting stage / clear the consumed rect.
   * On web it receives the card's freshly-measured landing rect (null when
   * unmeasurable / non-web) so FX can follow the card's true path. */
  onFlipMount?: (landRect?: FlipRect | null) => void;
}) {
  const ref = useRef<any>(null);

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
    const node: any = ref.current;
    const domNode: any = Platform.OS !== 'web' ? null
      : node && typeof node.animate === 'function' ? node
      : node?._nativeTag && typeof node._nativeTag.animate === 'function' ? node._nativeTag
      : typeof node?.getNode === 'function' ? node.getNode()
      : null;
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
      { duration: FLIP_DURATION, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
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
    >
      {children}
    </Animated.View>
  );
}
