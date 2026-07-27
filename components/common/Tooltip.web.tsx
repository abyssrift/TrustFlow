import { useThemeColors } from '@/hooks/useThemeColors';
import { positionTooltip, type TooltipSide } from '@/lib/tooltipPosition';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { View, type StyleProp, type ViewStyle } from 'react-native';

// Hover/focus tooltip for desktop + mobile web. The bubble portals to
// document.body with position:fixed so it can never be clipped by an
// overflow container or lose a z-index fight. Placement flips near screen
// edges and clamps inside the viewport (lib/tooltipPosition).
//
// Theme tokens don't reach portaled DOM (same trap as RN Modal on web),
// so the bubble is styled inline from useThemeColors.
//
// Usage: <Tooltip label="Archive task"><IconButton ... /></Tooltip>
// If the child relied on flex classes (flex-1, self-end...), move them to
// the Tooltip's className so the wrapper takes the child's place in layout.
export default function Tooltip({
  label,
  children,
  side = 'top',
  delay = 350,
  disabled = false,
  className,
  style,
}: {
  label: string;
  children: React.ReactNode;
  side?: TooltipSide;
  /** ms of hover before the bubble appears */
  delay?: number;
  disabled?: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  const anchorRef = useRef<View>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  };

  // Two-pass: render the bubble hidden, measure it and the anchor, place it.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = (anchorRef.current as any)?.getBoundingClientRect?.();
    const tip = tipRef.current;
    if (!rect || !tip) return;
    setPos(
      positionTooltip(
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        { width: tip.offsetWidth, height: tip.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        side,
      ),
    );
  }, [open, side, label]);

  // Anything that moves the anchor just hides the bubble; next hover re-measures.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (disabled || !label) return <>{children}</>;

  return (
    <View
      ref={anchorRef}
      className={className}
      style={style}
      // @ts-ignore web-only handlers, forwarded to the DOM node by react-native-web
      onMouseEnter={show}
      // @ts-ignore
      onMouseLeave={hide}
      // @ts-ignore keyboard accessibility: focusing a wrapped control shows the hint
      onFocus={show}
      // @ts-ignore
      onBlur={hide}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            style={{
              position: 'fixed',
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              visibility: pos ? 'visible' : 'hidden',
              maxWidth: 260,
              backgroundColor: colors.card,
              color: colors.textMain,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: '5px 10px',
              fontSize: 12,
              fontWeight: 600,
              lineHeight: '16px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              zIndex: 99999,
              pointerEvents: 'none',
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
              whiteSpace: 'pre-line',
            }}
          >
            {label}
          </div>,
          document.body,
        )}
    </View>
  );
}
