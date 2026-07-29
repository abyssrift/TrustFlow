import { useState, useCallback, useMemo, useRef } from 'react';

type Position = { top: number; left: number; maxHeight: number };

type UseCalendarPositionOptions = {
  calendarWidth?: number;
  calendarHeight?: number;
  offset?: number;
  margin?: number;
};

const DEFAULT_WIDTH = 332;
const DEFAULT_HEIGHT = 360;
const DEFAULT_OFFSET = 6;
const DEFAULT_MARGIN = 20;

export function useCalendarPosition(opts: UseCalendarPositionOptions = {}) {
  const { calendarWidth = DEFAULT_WIDTH, calendarHeight = DEFAULT_HEIGHT, offset = DEFAULT_OFFSET, margin = DEFAULT_MARGIN } = opts;
  const triggerRef = useRef<any>(null);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0, maxHeight: calendarHeight });

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;
    const left = rect.left + rect.width / 2 - calendarWidth / 2;
    const clampedLeft = Math.max(margin, Math.min(left, viewWidth - calendarWidth - margin));
    const spaceBelow = viewHeight - rect.bottom;
    const spaceAbove = rect.top;
    let top: number;
    let maxHeight: number;
    if (spaceBelow >= calendarHeight + offset) {
      top = rect.bottom + offset;
      maxHeight = Math.min(calendarHeight, spaceBelow - offset - margin);
    } else if (spaceAbove >= calendarHeight + offset) {
      top = rect.top - offset - calendarHeight;
      maxHeight = Math.min(calendarHeight, spaceAbove - offset - margin);
    } else {
      // Neither side fits the full panel — pin to the top margin and let
      // the panel scroll internally rather than spilling past the viewport.
      top = margin;
      maxHeight = viewHeight - margin * 2;
    }
    setPosition({ top, left: clampedLeft, maxHeight });
  }, [offset, margin, calendarWidth, calendarHeight]);

  const style = useMemo(() => ({
    position: 'fixed' as const,
    top: position.top,
    left: position.left,
    width: calendarWidth,
    maxHeight: position.maxHeight,
    overflow: 'auto' as const,
    zIndex: 999,
  }), [position.top, position.left, position.maxHeight, calendarWidth]);

  return { triggerRef, measure, style };
}
