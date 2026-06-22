import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';

const isNative = Platform.OS !== 'web';

// Drag thresholds: dismiss if dragged past this distance OR flicked downward fast.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.8;

/**
 * A bottom-sheet Modal with a grab handle. On native, dragging the handle (or
 * the header strip around it) slides the sheet down — release past a threshold
 * (or a fast flick) dismisses it; otherwise it springs back. On web the handle
 * is purely decorative (no drag) and the backdrop tap still closes it.
 *
 * Drop-in replacement for the hand-rolled `Modal` + `justify-end` + handle that
 * the app's sheets repeat. Render your sheet body as `children`.
 */
export default function DraggableSheet({
  visible,
  onClose,
  children,
  maxHeight = '85%',
  containerStyle,
  dimBackdrop = false,
  containerClassName = 'bg-surface-card rounded-t-[2rem] border-t border-surface-border',
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Cap on sheet height (number = px, string = percentage). Default '85%'. */
  maxHeight?: number | `${number}%`;
  containerStyle?: StyleProp<ViewStyle>;
  /** Tint the backdrop (e.g. for sheets that previously used bg-black/50). */
  dimBackdrop?: boolean;
  /** Override the sheet container styling to match an existing sheet's look. */
  containerClassName?: string;
}) {
  const translateY = useRef(new Animated.Value(0)).current;

  // Reset position every time the sheet opens (it may have been left mid-dismiss).
  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      // The handle strip has nothing tappable, so claim the touch immediately on
      // native — far more reliable than waiting for a move to cross a threshold.
      onStartShouldSetPanResponder: () => isNative,
      onStartShouldSetPanResponderCapture: () => isNative,
      onMoveShouldSetPanResponder: (_, g) => isNative && Math.abs(g.dy) > 3,
      onMoveShouldSetPanResponderCapture: (_, g) => isNative && Math.abs(g.dy) > 3,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy); // clamp upward so it stays docked
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) {
          Animated.timing(translateY, {
            toValue: Dimensions.get('window').height,
            duration: 200,
            useNativeDriver: true,
          }).start(() => onClose());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className={`flex-1 justify-end ${dimBackdrop ? 'bg-black/50' : ''}`}>
        <Pressable className="flex-1" onPress={onClose} />
        <Animated.View
          style={[{ maxHeight, transform: [{ translateY }] }, containerStyle]}
          className={containerClassName}
        >
          {/* Grab handle — a tall, transparent drag zone so it's easy to catch */}
          <View {...panResponder.panHandlers} className="items-center justify-center pt-2.5 pb-3" style={{ minHeight: 28 }}>
            <View className="w-12 h-1.5 bg-surface-border rounded-full" />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
