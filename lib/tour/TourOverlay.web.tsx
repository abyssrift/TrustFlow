import { useThemeColors } from '@/hooks/useThemeColors';
import { positionTooltip } from '@/lib/tooltipPosition';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Halo from './Halo';
import TourTooltip from './TourTooltip';
import { useTour } from './TourContext';

type Rect = { left: number; top: number; width: number; height: number };

/**
 * Renders the active tour step as a halo + tooltip portaled to document.body.
 * Web only — mounted from app/_layout.web.tsx. Resolves the step's target via
 * the registry (Task 2), so it works identically whichever nav component
 * (desktop rail vs mobile drawer) currently has it registered.
 */
export default function TourOverlay() {
  const { active, current, index, total, next, back, end, getTarget, runAction } = useTour();
  const colors = useThemeColors();
  const tipRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    setRect(null);
    setPos(null);
    if (!active || !current) return;
    if (current.beforeActionId) runAction(current.beforeActionId);

    let cancelled = false;
    // Guards against re-firing next() on every resize/scroll-triggered
    // measure() retry within this single effect instance. Local, not a ref,
    // so it resets naturally on every step change (forward or backward) —
    // a target missing on visit N must still be skippable on visit N+1.
    let skipped = false;
    const measure = () => {
      if (cancelled) return;
      const node = getTarget(current.targetId)?.current as any;
      if (!node?.getBoundingClientRect) {
        if (!skipped) {
          skipped = true;
          next();
        }
        return;
      }
      node.scrollIntoView?.({ block: 'nearest' });
      const r = node.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };

    // A beforeActionId (e.g. opening the mobile drawer) needs its animation
    // to settle before the target has real layout to measure.
    const t = setTimeout(measure, current.beforeActionId ? 260 : 0);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelled = true;
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, current, getTarget, runAction, next]);

  // Second pass: once the tooltip card has real DOM size, place it relative
  // to rect via the shared flip/clamp math (same as Tooltip.web.tsx).
  useLayoutEffect(() => {
    if (!rect || !current) return;
    const tip = tipRef.current;
    if (!tip) return;
    setPos(
      positionTooltip(
        { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        { width: tip.offsetWidth, height: tip.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        current.placement ?? 'bottom',
      ),
    );
  }, [rect, current]);

  if (!active || !current || !rect) return null;

  const isLast = index === total - 1;

  return createPortal(
    <>
      <Halo rect={rect} color={colors.primary} />
      <div
        ref={tipRef}
        style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden', zIndex: 10001 }}
      >
        <TourTooltip
          title={current.title}
          body={current.body}
          index={index}
          total={total}
          isFirst={index === 0}
          isLast={isLast}
          onBack={back}
          onNext={isLast ? end : next}
          onSkip={end}
          colors={colors}
        />
      </div>
    </>,
    document.body,
  );
}
