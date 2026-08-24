import React from 'react';
import { View, Text, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useThemeColors } from '@/hooks/useThemeColors';

export interface EmptyStateProps {
  icon?: keyof typeof FontAwesome.glyphMap;
  iconSize?: number;
  iconColor?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: 'default' | 'dashed' | 'minimal';
  iconContainerStyle?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  showAction?: boolean;
}

export default function EmptyState({
  icon = 'inbox',
  iconSize = 32,
  iconColor,
  title,
  description,
  actionLabel,
  onAction,
  variant = 'default',
  iconContainerStyle,
  containerStyle,
  showAction = true,
}: EmptyStateProps) {
  const colors = useThemeColors();

  const resolvedIconColor = iconColor ?? colors.textMuted;

  const getContainerClasses = () => {
    const base = 'items-center justify-center';
    switch (variant) {
      case 'dashed':
        return `${base} p-8 bg-surface-card/30 rounded-2xl border border-dashed border-surface-border`;
      case 'minimal':
        return `${base} py-6`;
      default:
        return `${base} p-8 bg-surface-card/30 rounded-2xl border border-surface-border`;
    }
  };

  const getIconContainerClasses = () => {
    switch (variant) {
      case 'dashed':
        return 'w-16 h-16 rounded-full bg-surface-background items-center justify-center mb-4 border border-surface-border';
      case 'minimal':
        return 'w-12 h-12 rounded-full bg-surface-background items-center justify-center mb-3 border border-surface-border';
      default:
        return 'w-16 h-16 rounded-full bg-surface-background items-center justify-center mb-4 border border-surface-border';
    }
  };

  const getTitleClasses = () => {
    switch (variant) {
      case 'minimal':
        return 'text-typography-main font-black text-base mb-1';
      case 'dashed':
        return 'text-typography-main font-black text-xl mb-2';
      default:
        return 'text-typography-main font-black text-xl mb-2';
    }
  };

  const getDescriptionClasses = () => {
    switch (variant) {
      case 'minimal':
        return 'text-typography-muted text-xs text-center';
      default:
        return 'text-typography-muted text-sm text-center leading-relaxed';
    }
  };

  return (
    <View style={containerStyle} className={getContainerClasses()}>
      <View style={iconContainerStyle} className={getIconContainerClasses()}>
        <FontAwesome name={icon} size={iconSize} color={resolvedIconColor} />
      </View>
      <Text className={getTitleClasses()}>{title}</Text>
      {description && <Text className={getDescriptionClasses()}>{description}</Text>}
      {showAction && actionLabel && onAction && (
        <TouchableOpacity
          onPress={onAction}
          className="mt-4 bg-brand-primary px-6 py-2.5 rounded-xl items-center"
        >
          <Text className="text-white font-black uppercase tracking-widest text-xs">{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}