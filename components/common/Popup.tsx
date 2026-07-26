import { useThemeColors } from '@/hooks/useThemeColors';
import React from 'react';
import { Modal, Platform, Pressable, StyleProp, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import DraggableSheet from './DraggableSheet';

type ActionVariant = 'default' | 'danger' | 'disabled';

interface Action {
  label: string;
  onPress: () => void;
}

interface PrimaryAction extends Action {
  variant?: ActionVariant;
}

export default function Popup({
  visible,
  onClose,
  children,
  presentation = 'sheet',
  title,
  footer = 'none',
  primaryAction,
  secondaryAction,
  scrollable = true,
  draggable = true,
  dismissible = true,
  maxHeight,
  maxWidth = 420,
  sheetMaxWidth,
  desktopBreakpoint = 768,
  dimBackdrop = false,
  containerClassName,
  containerStyle,
  sideMenu,
  backdropBlur = false,
  backdropStyle,
  overlays,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 'auto' picks 'centered' at/above desktopBreakpoint and 'sheet' below it (web only; native always renders as a sheet). */
  presentation?: 'sheet' | 'centered' | 'auto';
  title?: string;
  footer?: 'none' | 'single-action' | 'dual-action';
  primaryAction?: PrimaryAction;
  secondaryAction?: Action;
  scrollable?: boolean;
  draggable?: boolean;
  dismissible?: boolean;
  maxHeight?: number | `${number}%`;
  /** Centered-presentation width cap in px. Immune to OS/browser text-scale, unlike a `max-w-[Npx]` class. */
  maxWidth?: number;
  /** Optional width cap (px) for sheet presentation, for sheets that stay centered/capped on wide viewports. Immune to text-scale, unlike a `max-w-[Npx]` class. */
  sheetMaxWidth?: number;
  /** Viewport width (px) at which 'auto' presentation switches from sheet to centered. */
  desktopBreakpoint?: number;
  dimBackdrop?: boolean;
  containerClassName?: string;
  /** Extra style merged onto the container (sheet or centered card) — for cases a className can't express, e.g. a runtime theme color border. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Centered-presentation only: a fixed-width column rendered to the left of `children`, full card height, divided by a border — for two-pane composers (e.g. a "recent items" rail). Ignored in sheet presentation. */
  sideMenu?: React.ReactNode;
  /** Centered-presentation only: replaces the default solid `rgba(0,0,0,0.7)` backdrop with a frosted blur over the themed background — for composers that want to match a premium blur look instead of a dim overlay. */
  backdropBlur?: boolean;
  /** Centered-presentation only: merged last onto the backdrop itself — for callers that need to drive it during a transition (e.g. fading the dim away while a custom animation hands the card off to another surface). */
  backdropStyle?: StyleProp<ViewStyle>;
  /** Centered-presentation only: rendered as a sibling of the card, inside the same backdrop/Modal layer but outside the card's `overflow: hidden` — for `position: fixed` floating content (dropdowns, date pickers) anchored via viewport coordinates, which would otherwise get clipped by the card's rounded corners. */
  overlays?: React.ReactNode;
}) {
  const c = useThemeColors();
  const { width: screenWidth } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const resolvedPresentation = presentation === 'auto' ? (screenWidth >= desktopBreakpoint ? 'centered' : 'sheet') : presentation;
  const effectivePresentation = isWeb ? resolvedPresentation : 'sheet';
  const centeredWidth = Math.min(screenWidth * 0.9, maxWidth);

  if (effectivePresentation === 'sheet') {
    return (
      <DraggableSheet
        visible={visible}
        onClose={onClose}
        title={title}
        footer={footer}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
        scrollable={scrollable}
        draggable={draggable}
        dismissible={dismissible}
        maxHeight={maxHeight}
        dimBackdrop={dimBackdrop}
        containerClassName={containerClassName}
        containerStyle={[sheetMaxWidth ? { maxWidth: sheetMaxWidth, alignSelf: 'center', width: '95%' } : undefined, containerStyle]}
      >
        {children}
      </DraggableSheet>
    );
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={dismissible ? onClose : undefined}>
      <Pressable
        className="flex-1 items-center justify-center"
        style={[backdropBlur ? ({ backdropFilter: 'blur(12px)', backgroundColor: c.background + 'CC' } as any) : { backgroundColor: 'rgba(0,0,0,0.7)' }, backdropStyle]}
        onPress={dismissible ? onClose : undefined}
      >
          <Pressable
            className={containerClassName ?? 'rounded-3xl overflow-hidden premium-shadow'}
            style={[{ backgroundColor: c.card, borderWidth: 1, borderColor: c.border, width: centeredWidth, flexDirection: sideMenu ? 'row' : 'column' }, maxHeight ? { maxHeight } as any : undefined, containerStyle]}
            onPress={() => {}}
          >
          {sideMenu && (
            <View style={{ borderRightWidth: 1, borderColor: c.border }}>
              {sideMenu}
            </View>
          )}
          <View style={{ flex: 1, flexDirection: 'column', minWidth: 0 }}>
            {title && (
              <View className="flex-row items-center justify-between px-6 pt-5 pb-4" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
                <Text className="text-xl font-black tracking-tight flex-1" style={{ color: c.textMain }}>{title}</Text>
                { (
                  <Pressable onPress={onClose} className="w-9 h-9 items-center justify-center rounded-full" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                    <Text style={{ color: c.textMuted, fontSize: 16, fontWeight: 'bold' }}>x</Text>
                  </Pressable>
                )}
              </View>
            )}
            {children}
            {footer !== 'none' && (
              <View className="px-6 py-4 flex-row gap-3" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
                {footer === 'dual-action' && secondaryAction && (
                  <Pressable
                    onPress={secondaryAction.onPress}
                    className="flex-1 py-3.5 rounded-2xl items-center"
                    style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
                  >
                    <Text className="font-black uppercase tracking-widest text-xs" style={{ color: c.textMuted }}>{secondaryAction.label}</Text>
                  </Pressable>
                )}
                {primaryAction && (
                  <Pressable
                    onPress={primaryAction.onPress}
                    className="flex-[2] py-3.5 rounded-2xl items-center shadow-lg"
                    style={{ backgroundColor: primaryAction.variant === 'danger' ? c.danger : c.primary }}
                  >
                    <Text className="font-black uppercase tracking-widest text-xs" style={{ color: 'white' }}>
                      {primaryAction.label}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </Pressable>
        {overlays}
      </Pressable>
    </Modal>
  );
}
