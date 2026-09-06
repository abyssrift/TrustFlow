import { useThemeColors } from '@/hooks/useThemeColors';
import Tooltip from '@/components/common/Tooltip';
import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import DraggableSheet from './DraggableSheet';

type ActionVariant = 'default' | 'danger' | 'disabled';

interface Action {
  label: string;
  onPress: () => void;
}

interface PrimaryAction extends Action {
  variant?: ActionVariant;
}

type PopupCommonProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  footer?: 'none' | 'single-action' | 'dual-action';
  primaryAction?: PrimaryAction;
  secondaryAction?: Action;
  scrollable?: boolean;
  draggable?: boolean;
  dismissible?: boolean;
  maxHeight?: number | `${number}%`;
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
  /** Renders the resolved 'centered'/'auto' presentation on native too (via RN's `Modal`, same as web), instead of always downgrading native to a sheet. The centered branch is built entirely from cross-platform RN primitives, so this is safe to opt into. Off by default — a bottom sheet is native's usual idiom; use this only for content that specifically needs a centered dialog everywhere (e.g. a blocking confirmation that shouldn't read as a draggable/dismissible sheet). Ignored when `presentation` is `'sheet'`. */
  forceCenteredOnNative?: boolean;
};

/**
 * `maxWidth` is the centered card's width cap in px. Immune to OS/browser
 * text-scale, unlike a `max-w-[Npx]` class.
 *
 * **It is REQUIRED whenever the popup can render centered** (`presentation`
 * of `'centered'` or `'auto'`), and irrelevant for a sheet-only popup, which
 * never uses it.
 *
 * It used to be optional with a silent `= 420` default, which made "I chose a
 * narrow dialog" and "I never thought about it" indistinguishable — so an
 * info-dense modal written without it shipped as exactly the tall
 * single-column scroll `.agents/rules/ux-consistency.md` §"Desktop density"
 * forbids. That happened (#182's batch-config wizard, caught only by a human
 * looking at it running) and the compiler found 29 call sites across 18 files
 * with the same omission. Requiring it turns an invisible layout bug into a
 * build error.
 *
 * Choosing a value — see that rule for the full version:
 * - **400–512** for a single decision (confirm, share). The rule says do NOT
 *   widen these.
 * - **720–1100** for anything info-dense — and that then owes you real
 *   columns: 2 for two distinct groups, 3 only at >= ~1000, each with its own
 *   scroll. A 4th column means it should be a screen, not a popup.
 */
type PopupProps = PopupCommonProps &
  (
    | {
        /** Sheet-only: never renders centered, so `maxWidth` does not apply — use `sheetMaxWidth` to cap a wide-viewport sheet. */
        presentation?: 'sheet';
        maxWidth?: never;
      }
    | {
        /**
         * 'auto' picks 'centered' at/above desktopBreakpoint and 'sheet' below it
         * (web only; native always renders as a sheet).
         *
         * `'sheet'` is included here so a caller computing the value at runtime —
         * `presentation={isDesktop ? 'centered' : 'sheet'}` — still type-checks.
         * That union can render centered, so it owes a `maxWidth` like any other.
         */
        presentation: 'centered' | 'auto' | 'sheet';
        maxWidth: number;
      }
  );

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
  maxWidth,
  sheetMaxWidth,
  desktopBreakpoint = 768,
  dimBackdrop = false,
  containerClassName,
  containerStyle,
  sideMenu,
  backdropBlur = false,
  backdropStyle,
  overlays,
  forceCenteredOnNative = false,
}: PopupProps) {
  const c = useThemeColors();
  const { width: screenWidth } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const resolvedPresentation = presentation === 'auto' ? (screenWidth >= desktopBreakpoint ? 'centered' : 'sheet') : presentation;
  const effectivePresentation = isWeb || (forceCenteredOnNative && resolvedPresentation !== 'sheet') ? resolvedPresentation : 'sheet';
  // `?? 420` is unreachable for a centered card: PopupProps requires maxWidth
  // whenever presentation is 'centered' or 'auto', and those are the only ways
  // effectivePresentation becomes 'centered'. It exists to satisfy the
  // narrowing, not to reinstate the old silent default.
  const centeredWidth = Math.min(screenWidth * 0.9, maxWidth ?? 420);

  // A centered card had NO height ceiling unless the caller thought to set one.
  // The backdrop centres it, so tall content grew off the top AND bottom of the
  // viewport and took the footer — the Cancel/Confirm buttons — with it. There
  // was no scroll either: `scrollable` is forwarded to DraggableSheet in the
  // sheet branch and was simply ignored here. So a dialog that outgrew the
  // window became one you could neither finish nor cancel, only Escape out of.
  //
  // Both defaults now live HERE rather than in each caller, because ~40 call
  // sites cannot each be trusted to remember, and the ones that forgot were
  // indistinguishable from the ones that chose (the same lesson `maxWidth`
  // taught in ux-consistency.md).
  //
  // A caller that sets its own height is opted out of both: it has a definite
  // height and its children almost certainly use `flex: 1` with their own
  // ScrollView, and wrapping THAT in another ScrollView collapses the layout.
  const callerSetsHeight =
    maxHeight !== undefined ||
    (StyleSheet.flatten(containerStyle) as ViewStyle | undefined)?.height !== undefined;
  const effectiveMaxHeight = callerSetsHeight ? maxHeight : ('92%' as const);
  const scrollBody = scrollable && !callerSetsHeight;

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
            style={[{ backgroundColor: c.card, borderWidth: 1, borderColor: c.border, width: centeredWidth, flexDirection: sideMenu ? 'row' : 'column' }, effectiveMaxHeight ? { maxHeight: effectiveMaxHeight } as any : undefined, containerStyle]}
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
                <Tooltip label="Close">
                  <Pressable onPress={onClose} className="w-9 h-9 items-center justify-center rounded-full" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                    <Text style={{ color: c.textMuted, fontSize: 16, fontWeight: 'bold' }}>x</Text>
                  </Pressable>
                </Tooltip>
              </View>
            )}
            {/* The body scrolls; the header above and the footer below stay
                put, so the actions are reachable at any window height. */}
            {scrollBody ? (
              <ScrollView
                style={{ flexShrink: 1 }}
                contentContainerStyle={{ flexGrow: 0 }}
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            ) : (
              children
            )}
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
                    disabled={primaryAction.variant === 'disabled'}
                    className="flex-[2] py-3.5 rounded-2xl items-center shadow-lg"
                    style={{
                      backgroundColor: primaryAction.variant === 'danger' ? c.danger : primaryAction.variant === 'disabled' ? c.border : c.primary,
                    }}
                  >
                    <Text className="font-black uppercase tracking-widest text-xs" style={{ color: primaryAction.variant === 'disabled' ? c.textMuted : 'white' }}>
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
