import React from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useThemeColors } from '@/hooks/useThemeColors';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning' | 'info' | 'primary';
  loading?: boolean;
}

export default function ConfirmModal({
  visible,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'primary',
  loading = false
}: ConfirmModalProps) {
  const c = useThemeColors();

  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return { bg: c.danger, icon: 'warning', dim: c.danger + '1A' };
      case 'warning':
        return { bg: c.warning, icon: 'exclamation-triangle', dim: c.warning + '1A' };
      case 'info':
        return { bg: c.info, icon: 'info-circle', dim: c.info + '1A' };
      default:
        return { bg: c.primary, icon: 'check-circle', dim: c.primary + '1A' };
    }
  };

  const styles = getVariantStyles();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View
          className="w-full max-w-lg rounded-[40px] overflow-hidden premium-shadow"
          style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
        >
          <View className="p-10 items-center">
            <View className="w-20 h-20 rounded-full items-center justify-center mb-6" style={{ backgroundColor: styles.dim }}>
              <FontAwesome name={styles.icon as any} size={32} color={styles.bg} />
            </View>

            <Text style={{ color: c.textMain }} className="text-3xl font-black tracking-tight mb-4 text-center">{title}</Text>
            <Text style={{ color: c.textMuted }} className="text-center font-medium leading-relaxed">
              {description}
            </Text>
          </View>

          <View className="p-10 flex-row flex-wrap gap-4" style={{ borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card }}>
            <TouchableOpacity
              onPress={onCancel}
              disabled={loading}
              className="flex-1 min-w-[120px] py-5 rounded-2xl items-center"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            >
              <Text style={{ color: c.textMuted }} className="font-black uppercase tracking-widest text-xs">{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onConfirm}
              disabled={loading}
              className="flex-[2] min-w-[120px] py-5 rounded-2xl items-center shadow-lg active:scale-[0.98] transition-transform"
              style={{ backgroundColor: styles.bg }}
            >
              <Text className="text-white font-black uppercase tracking-widest text-xs">
                {loading ? 'Processing...' : confirmLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
