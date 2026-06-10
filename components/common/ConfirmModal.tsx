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
  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          bg: 'bg-state-danger',
          text: 'text-state-danger',
          icon: 'warning',
          dim: 'bg-state-danger/10'
        };
      case 'warning':
        return {
          bg: 'bg-state-warning',
          text: 'text-state-warning',
          icon: 'exclamation-triangle',
          dim: 'bg-state-warning/10'
        };
      case 'info':
        return {
          bg: 'bg-state-info',
          text: 'text-state-info',
          icon: 'info-circle',
          dim: 'bg-state-info/10'
        };
      default:
        return {
          bg: 'bg-brand-primary',
          text: 'text-brand-primary',
          icon: 'check-circle',
          dim: 'bg-brand-primary/10'
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 bg-black/70 items-center justify-center p-6">
        <View className="bg-surface-card w-full max-w-lg rounded-[40px] border border-surface-border premium-shadow overflow-hidden">
          <View className="p-10 items-center">
            <View className={`w-20 h-20 rounded-full ${styles.dim} items-center justify-center mb-6`}>
              <FontAwesome name={styles.icon as any} size={32} color={`var(--color-${variant === 'primary' ? 'info' : variant})`} />
            </View>
            
            <Text className="text-typography-main text-3xl font-black tracking-tight mb-4 text-center">{title}</Text>
            <Text className="text-typography-muted text-center font-medium leading-relaxed">
              {description}
            </Text>
          </View>

          <View className="p-10 border-t border-surface-border flex-row flex-wrap gap-4 bg-surface-card/50">
            <TouchableOpacity 
              onPress={onCancel} 
              disabled={loading}
              className="flex-1 min-w-[120px] py-5 rounded-2xl bg-surface-background border border-surface-border items-center"
            >
              <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onConfirm}
              disabled={loading}
              className={`flex-[2] min-w-[120px] py-5 rounded-2xl ${styles.bg} items-center shadow-lg active:scale-[0.98] transition-transform`}
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
