import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';
import { useThemeColors } from '@/hooks/useThemeColors';

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.8;

export default function DraggableSheet({
  visible,
  onClose,
  children,
  maxHeight = '85%',
  containerStyle,
  dimBackdrop = false,
  containerClassName = 'rounded-t-[2rem] border-t',
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeight?: number | `${number}%`;
  containerStyle?: StyleProp<ViewStyle>;
  dimBackdrop?: boolean;
  containerClassName?: string;
}) {
  const c = useThemeColors();
  const translateY = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragCurrentY = useRef(0);

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const animateOut = useCallback(() => {
    Animated.timing(translateY, {
      toValue: Dimensions.get('window').height,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [translateY, onClose]);

  const snapBack = useCallback(() => {
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
  }, [translateY]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    dragCurrentY.current = e.clientY;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    dragCurrentY.current = e.clientY;
    const dy = e.clientY - dragStartY.current;
    if (dy > 0) translateY.setValue(dy);
  }, [dragging, translateY]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    const dy = e.clientY - dragStartY.current;
    const vy = (e.clientY - dragCurrentY.current) / 16;
    if (dy > DISMISS_DISTANCE || vy > DISMISS_VELOCITY) {
      animateOut();
    } else {
      snapBack();
    }
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, [dragging, animateOut, snapBack]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className={`flex-1 justify-end ${dimBackdrop ? 'bg-black/50' : ''}`}>
        <Pressable className="flex-1" onPress={onClose} />
        <Animated.View
          style={[
            { maxHeight, transform: [{ translateY }], backgroundColor: c.card, borderColor: c.border },
            containerStyle,
          ]}
          className={containerClassName}
        >
          <View
            className="w-full items-center justify-center py-3"
            style={{ minHeight: 44, touchAction: 'none' as any }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <View className="w-20 h-2 rounded-full" style={{ backgroundColor: c.border }} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
