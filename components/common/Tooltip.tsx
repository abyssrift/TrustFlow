import { useThemeColors } from '@/hooks/useThemeColors';
import { positionTooltip, type Rect, type TooltipSide } from '@/lib/tooltipPosition';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

// Native tooltip: long-press any wrapped control to see its hint. Touch events
// on the wrapper fire alongside the child's own gesture handling, so this works
// even when the child is a Touchable. Bubble renders in a transparent Modal
// (immune to clipping) placed via the shared flip/clamp math, styled inline
// from useThemeColors (token classes go black inside RN Modal on web).
//
// Usage: <Tooltip label="Archive task"><IconButton ... /></Tooltip>
// If the child relied on flex classes (flex-1, self-end...), move them to
// the Tooltip's className so the wrapper takes the child's place in layout.
//
// ponytail: releasing after the long-press can still fire the child's onPress;
// swallowing it needs a responder-capture layer — add if it annoys anyone.
export default function Tooltip({
  label,
  children,
  side = 'top',
  disabled = false,
  className,
  style,
}: {
  label: string;
  children: React.ReactNode;
  side?: TooltipSide;
  disabled?: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  const { width: vw, height: vh } = useWindowDimensions();
  const anchorRef = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const open = anchor != null;

  const onTouchStart = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      anchorRef.current?.measureInWindow((x, y, width, height) =>
        setAnchor({ x, y, width, height }),
      );
    }, 450);
  };
  const cancelPress = () => clearTimeout(timer.current);
  const close = () => {
    setAnchor(null);
    setSize(null);
  };

  // Self-dismiss like the platform tooltips do.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(close, 2500);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const pos = anchor && size ? positionTooltip(anchor, size, { width: vw, height: vh }, side) : null;

  if (disabled || !label) return <>{children}</>;

  return (
    <View
      ref={anchorRef}
      className={className}
      style={style}
      collapsable={false}
      onTouchStart={onTouchStart}
      onTouchEnd={cancelPress}
      onTouchCancel={cancelPress}
    >
      {children}
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={{ flex: 1 }} onPress={close}>
          <View
            // Two-pass: first layout reports the bubble size, then it's placed.
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              if (!size) setSize({ width, height });
            }}
            style={{
              position: 'absolute',
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              opacity: pos ? 1 : 0,
              maxWidth: 260,
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 5,
            }}
          >
            <Text style={{ color: colors.textMain, fontSize: 12, fontWeight: '600', lineHeight: 16 }}>
              {label}
            </Text>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
