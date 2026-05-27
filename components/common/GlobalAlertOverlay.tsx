import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

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
  const handleConfirm = () => {
    options.onConfirm?.();
    onClose();
  };

  const handleCancel = () => {
    options.onCancel?.();
    onClose();
  };

  return (
    <Modal
      transparent
      visible={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View className="w-[90%] max-w-[400px] bg-surface-card border border-surface-border rounded-3xl p-8 premium-shadow glass-card overflow-hidden">
          {/* Header Icon */}
          <View className={`h-16 w-16 items-center justify-center rounded-2xl mb-6 ${options.type === 'confirm' ? 'bg-brand-primary/10' : 'bg-state-info/10'}`}>
            <FontAwesome 
              name={options.type === 'confirm' ? "question-circle" : "info-circle"} 
              size={32} 
              color={options.type === 'confirm' ? "#6366f1" : "#3b82f6"} 
            />
          </View>

          <Text className="text-xl font-black text-typography-main mb-3">
            {options.title}
          </Text>
          <Text className="text-sm font-bold text-typography-muted leading-relaxed mb-8">
            {options.message}
          </Text>

          <View className="flex-row gap-4">
            {options.type === 'confirm' && (
              <TouchableOpacity
                onPress={handleCancel}
                className="flex-1 h-12 items-center justify-center rounded-xl border border-surface-border bg-surface-overlay"
              >
                <Text className="text-xs font-black uppercase tracking-widest text-typography-muted">
                  {options.cancelText || 'Cancel'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={handleConfirm}
              className={`flex-1 h-12 items-center justify-center rounded-xl ${options.confirmStyle === 'destructive' ? 'bg-state-danger' : 'bg-brand-primary'}`}
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
