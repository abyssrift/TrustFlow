import React from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '@/hooks/useThemeColors';

/**
 * Web-safe centered modal. Use this instead of a raw <Modal> for any dialog
 * that isn't a bottom sheet (for sheets use DraggableSheet).
 *
 * Why it exists: NativeWind background/color classes go BLACK inside a raw RN
 * Modal on web — the Modal renders in a portal our CSS-var scope doesn't reach.
 * This bakes in the fix from GlobalAlertOverlay: the dimmed backdrop is a plain
 * StyleSheet, and the card colors come from useThemeColors as inline styles, so
 * the portal problem can never turn the dialog black. Backdrop tap closes it.
 *
 * ponytail: layout/spacing still comes via containerClassName (NativeWind is fine
 * for those on web) — only *colors* must be inline, and this handles the card's.
 */
export default function AppModal({
  visible,
  onClose,
  children,
  dismissOnBackdrop = true,
  containerClassName = 'w-[90%] max-w-[400px] rounded-3xl p-6 overflow-hidden premium-shadow',
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Tap outside the card to close. Default true. */
  dismissOnBackdrop?: boolean;
  /** Layout/spacing for the card (NOT colors — those are themed inline). */
  containerClassName?: string;
}) {
  const c = useThemeColors();

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={dismissOnBackdrop ? onClose : undefined}>
        {/* Inner Pressable claims the touch so taps on the card don't close it. */}
        <Pressable
          className={containerClassName}
          style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
          onPress={() => {}}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
