import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useThemeColors } from '@/hooks/useThemeColors';

export interface AlertOptions {
  title: string;
  message: string;
  type: 'alert' | 'confirm';
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: 'default' | 'destructive';
}

interface GlobalAlertOverlayProps {
  options: AlertOptions;
  onClose: () => void;
}

export function GlobalAlertOverlay({ options, onClose }: GlobalAlertOverlayProps) {
  const c = useThemeColors();

  const handleConfirm = () => {
    options.onConfirm?.();
    onClose();
  };

  const handleCancel = () => {
    options.onCancel?.();
    onClose();
  };

  const isDestructive = options.confirmStyle === 'destructive';

  return (
    <Modal
      transparent
      visible={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          className="w-[90%] max-w-[400px] rounded-3xl p-8 overflow-hidden premium-shadow"
          style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
        >
          {/* Header Icon */}
          <View
            className="h-16 w-16 items-center justify-center rounded-2xl mb-6"
            style={{ backgroundColor: (options.type === 'confirm' ? c.primary : c.info) + '1A' }}
          >
            <FontAwesome
              name={options.type === 'confirm' ? "question-circle" : "info-circle"}
              size={32}
              color={options.type === 'confirm' ? c.primary : c.info}
            />
          </View>

          <Text className="text-xl font-black mb-3" style={{ color: c.textMain }}>
            {options.title}
          </Text>
          <Text className="text-sm font-bold leading-relaxed mb-8" style={{ color: c.textMuted }}>
            {options.message}
          </Text>

          <View className="flex-row gap-4">
            {options.type === 'confirm' && (
              <TouchableOpacity
                onPress={handleCancel}
                className="flex-1 h-12 items-center justify-center rounded-xl"
                style={{ borderWidth: 1, borderColor: c.border, backgroundColor: c.background }}
              >
                <Text className="text-xs font-black uppercase tracking-widest" style={{ color: c.textMuted }}>
                  {options.cancelText || 'Cancel'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={handleConfirm}
              className="flex-1 h-12 items-center justify-center rounded-xl"
              style={{ backgroundColor: isDestructive ? c.danger : c.primary }}
            >
              <Text className="text-xs font-black uppercase tracking-widest text-white">
                {options.confirmText || (options.type === 'confirm' ? 'Confirm' : 'OK')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
