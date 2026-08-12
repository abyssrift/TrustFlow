import React from 'react';
import { View } from 'react-native';

/**
 * Shared animated card for the topbar's small hover/click popovers (theme
 * picker, pinned-shortcuts picker, notifications) — anchored under an h-9
 * icon trigger, opening with a fade + scale + slide.
 *
 * Stays mounted at all times and toggles pointerEvents/visibility instead of
 * conditionally rendering, so both open AND close animate. Uses the bare
 * `transition` utility, not `transition-all`: Tailwind's `transition` omits
 * `visibility` from its property list, so visibility flips instantly, while
 * `transition-all` would visibly delay the hide by the full 300ms (a "ghost
 * panel" hanging around after close). The `visibility: hidden` (not just
 * `pointerEvents="none"`) matters on its own too — RNW compiles a *disabled*
 * child Pressable to `pointer-events: box-none`, which re-enables hit
 * testing on its own children, so a closed panel containing any disabled
 * row would otherwise still swallow hovers/clicks underneath it.
 */
export default function DropdownPanel({
  open,
  align = 'right',
  width,
  contentClassName = 'p-3',
  children,
}: {
  open: boolean;
  align?: 'left' | 'right';
  width: number;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      pointerEvents={open ? 'auto' : 'none'}
      style={{
        visibility: open ? 'visible' : 'hidden',
        opacity: open ? 1 : 0,
        transform: [{ scale: open ? 1 : 0.96 }, { translateY: open ? 0 : -6 }],
        width,
        zIndex: 100,
      } as any}
      className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-9 pt-2 transition duration-300 ease-in-out`}
    >
      <View className={`rounded-2xl border border-surface-border bg-surface-card/95 premium-shadow glass-card ${contentClassName}`}>
        {children}
      </View>
    </View>
  );
}
