import { useThemeColors } from '@/hooks/useThemeColors';
import React from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import DraggableSheet from './DraggableSheet';

type ActionVariant = 'default' | 'danger' | 'disabled';

interface Action {
  label: string;
  onPress: () => void;
}

interface PrimaryAction extends Action {
  variant?: ActionVariant;
}

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
  dimBackdrop = false,
  containerClassName,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  presentation?: 'sheet' | 'centered';
  title?: string;
  footer?: 'none' | 'single-action' | 'dual-action';
  primaryAction?: PrimaryAction;
  secondaryAction?: Action;
  scrollable?: boolean;
  draggable?: boolean;
  dismissible?: boolean;
  maxHeight?: number | `${number}%`;
  dimBackdrop?: boolean;
  containerClassName?: string;
}) {
  const c = useThemeColors();
  const isWeb = Platform.OS === 'web';
  const effectivePresentation = isWeb ? presentation : 'sheet';

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
      >
        {children}
      </DraggableSheet>
    );
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={dismissible ? onClose : undefined}>
      <Pressable className="flex-1 items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }} onPress={dismissible ? onClose : undefined}>
          <Pressable
            className={containerClassName ?? 'w-[90%] max-w-[400px] rounded-3xl overflow-hidden premium-shadow'}
            style={[{ backgroundColor: c.card, borderWidth: 1, borderColor: c.border }, maxHeight ? { maxHeight } as any : undefined]}
            onPress={() => {}}
          >
          {title && (
            <View className="flex-row items-center justify-between px-6 pt-5 pb-4" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
              <Text className="text-xl font-black tracking-tight flex-1" style={{ color: c.textMain }}>{title}</Text>
              { (
                <Pressable onPress={onClose} className="w-9 h-9 items-center justify-center rounded-full" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                  <Text style={{ color: c.textMuted, fontSize: 16, fontWeight: 'bold' }}>x</Text>
                </Pressable>
              )}
            </View>
          )}
          {children}
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
                  className="flex-[2] py-3.5 rounded-2xl items-center shadow-lg"
                  style={{ backgroundColor: primaryAction.variant === 'danger' ? c.danger : c.primary }}
                >
                  <Text className="font-black uppercase tracking-widest text-xs" style={{ color: 'white' }}>
                    {primaryAction.label}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
