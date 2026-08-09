import React, { useEffect, useRef } from 'react';

type Rect = { left: number; top: number; width: number; height: number };

/**
 * Pulsing highlight ring around a measured DOM rect. Portaled outside the RN
 * tree (see TourOverlay.web.tsx), so this drives the pulse with the Web
 * Animations API directly on the node rather than reanimated — see the
 * "Animation refinement" note in the plan's Global Constraints for why this
 * is decision-tree case 4 (animation-consistency.md), not case 2.
 */
export default function Halo({ rect, color }: { rect: Rect; color: string }) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el || typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const anim = el.animate(
      [
        { boxShadow: `0 0 0 3px ${color}88, 0 0 18px 4px ${color}55`, transform: 'scale(1)' },
        { boxShadow: `0 0 0 6px ${color}44, 0 0 32px 10px ${color}99`, transform: 'scale(1.03)' },
        { boxShadow: `0 0 0 3px ${color}88, 0 0 18px 4px ${color}55`, transform: 'scale(1)' },
      ],
      { duration: 1400, iterations: Infinity, easing: 'ease-in-out' },
    );
    return () => anim.cancel();
  }, [color]);

  return (
    <div
      ref={elRef}
      style={{
        position: 'fixed',
        left: rect.left - 4,
        top: rect.top - 4,
        width: rect.width + 8,
        height: rect.height + 8,
        borderRadius: 10,
        border: `3px solid ${color}`,
        pointerEvents: 'none',
        zIndex: 10000,
      }}
    />
  );
}
