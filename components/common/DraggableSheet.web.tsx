import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useThemeColors } from '@/hooks/useThemeColors';

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.8;

type ActionVariant = 'default' | 'danger' | 'disabled';

interface Action {
  label: string;
  onPress: () => void;
}

interface PrimaryAction extends Action {
  variant?: ActionVariant;
}

export default function DraggableSheet({
  visible,
  onClose,
  children,
  maxHeight = '85%',
  containerStyle,
  dimBackdrop = false,
  containerClassName = 'rounded-t-[2rem] border-t',
  title,
  footer = 'none',
  primaryAction,
  secondaryAction,
  scrollable = true,
  draggable = true,
  dismissible = true,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeight?: number | `${number}%`;
  containerStyle?: StyleProp<ViewStyle>;
  dimBackdrop?: boolean;
  containerClassName?: string;
  title?: string;
  footer?: 'none' | 'single-action' | 'dual-action';
  primaryAction?: PrimaryAction;
  secondaryAction?: Action;
  scrollable?: boolean;
  draggable?: boolean;
  dismissible?: boolean;
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
    if (!draggable) return;
    dragStartY.current = e.clientY;
    dragCurrentY.current = e.clientY;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [draggable]);

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

  const getActionStyles = (variant?: ActionVariant) => {
    switch (variant) {
      case 'danger':
        return { bg: c.danger, text: 'white' };
      case 'disabled':
        return { bg: c.border, text: c.textMuted };
      default:
        return { bg: c.primary, text: 'white' };
    }
  };

  const content = (
    <>
      {title && (
        <View className="flex-row items-center justify-between px-6 pt-5 pb-4" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
          <Text className="text-xl font-black tracking-tight flex-1" style={{ color: c.textMain }}>{title}</Text>
          {dismissible && (
            <TouchableOpacity onPress={onClose} className="w-9 h-9 items-center justify-center rounded-full" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
              <FontAwesome name="times" size={14} color={c.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {scrollable ? (
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        children
      )}

      {footer !== 'none' && (
        <View className="px-6 py-4 flex-row gap-3" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
          {footer === 'dual-action' && secondaryAction && (
            <TouchableOpacity
              onPress={secondaryAction.onPress}
              className="flex-1 py-3.5 rounded-2xl items-center"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            >
              <Text className="font-black uppercase tracking-widest text-xs" style={{ color: c.textMuted }}>{secondaryAction.label}</Text>
            </TouchableOpacity>
          )}
          {primaryAction && (
            <TouchableOpacity
              onPress={primaryAction.onPress}
              disabled={primaryAction.variant === 'disabled'}
              className="flex-[2] py-3.5 rounded-2xl items-center shadow-lg"
              style={{ backgroundColor: getActionStyles(primaryAction.variant).bg }}
            >
              <Text className="font-black uppercase tracking-widest text-xs" style={{ color: getActionStyles(primaryAction.variant).text }}>
                {primaryAction.label}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismissible ? onClose : undefined}>
      <View className={`flex-1 justify-end ${dimBackdrop ? 'bg-black/50' : ''}`}>
        <Pressable className="flex-1" onPress={dismissible ? onClose : undefined} />
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
          {content}
        </Animated.View>
      </View>
    </Modal>
  );
}
