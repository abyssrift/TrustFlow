import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
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

const isNative = Platform.OS !== 'web';

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

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isNative && draggable,
      onStartShouldSetPanResponderCapture: () => isNative && draggable,
      onMoveShouldSetPanResponder: (_, g) => isNative && draggable && Math.abs(g.dy) > 3,
      onMoveShouldSetPanResponderCapture: (_, g) => isNative && draggable && Math.abs(g.dy) > 3,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
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
      {/* Title bar */}
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

      {/* Scrollable body or raw children */}
      {scrollable ? (
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        children
      )}

      {/* Footer actions */}
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
              className="py-3.5 rounded-2xl items-center shadow-lg"
              style={{ flex: footer === 'dual-action' ? 2 : 1, backgroundColor: getActionStyles(primaryAction.variant).bg }}
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
          {draggable ? (
            <View {...panResponder.panHandlers} className="items-center justify-center pt-2.5 pb-3" style={{ minHeight: 28 }}>
              <View className="w-12 h-1.5 rounded-full" style={{ backgroundColor: c.border }} />
            </View>
          ) : (
            <View className="items-center justify-center pt-2.5 pb-3" style={{ minHeight: 28 }}>
              <View className="w-12 h-1.5 rounded-full" style={{ backgroundColor: c.border }} />
            </View>
          )}
          {content}
        </Animated.View>
      </View>
    </Modal>
  );
}
