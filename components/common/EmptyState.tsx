import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { useThemeColors } from '@/hooks/useThemeColors';
import { EMPTY_STATE_DEFAULTS, type EmptyStateVariant } from '@/lib/emptyState';

export type EmptyStateProps = {
  variant?: EmptyStateVariant;
  icon?: string;
  visual?: React.ReactNode;
  title?: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
  compact?: boolean;
  className?: string;
};

/** The shared no-data, access-denied, and feature-unavailable surface. */
export function EmptyState({
  variant = 'empty',
  icon,
  visual,
  title,
  body,
  actionLabel,
  onAction,
  actionIcon = 'plus',
  secondaryLabel,
  onSecondary,
  compact = false,
  className = '',
}: EmptyStateProps) {
  const colors = useThemeColors();
  const defaults = EMPTY_STATE_DEFAULTS[variant];
  const glyphSize = compact ? 40 : 54;

  return (
    <View className={`items-center ${compact ? 'py-8 px-4' : 'py-14 px-6'} ${className}`}>
      {visual ?? (
        <View className={`${compact ? 'w-10 h-10 rounded-xl' : 'w-[54px] h-[54px] rounded-2xl'} bg-surface-overlay border border-surface-border items-center justify-center`}>
          <FontAwesome name={(icon ?? defaults.icon) as any} size={Math.round(glyphSize * 0.42)} color={colors.textMuted} />
        </View>
      )}
      <Text className="text-typography-main text-base font-bold mt-4 text-center">{title ?? defaults.title}</Text>
      {!!(body ?? defaults.body) && (
        <Text className="text-typography-muted text-xs text-center mt-2 leading-5 w-full max-w-sm">
          {body ?? defaults.body}
        </Text>
      )}
      {(!!onAction || !!onSecondary) && (
        <View className="flex-row items-center flex-wrap justify-center gap-2 mt-5">
          {!!onAction && !!actionLabel && (
            <TouchableOpacity onPress={onAction} className="min-h-11 px-5 rounded-xl bg-brand-primary hover:bg-brand-primary-hover flex-row items-center justify-center gap-2">
              <FontAwesome name={actionIcon as any} size={12} color="white" />
              <Text className="text-white text-xs font-bold">{actionLabel}</Text>
            </TouchableOpacity>
          )}
          {!!onSecondary && !!secondaryLabel && (
            <TouchableOpacity onPress={onSecondary} className="min-h-11 px-5 rounded-xl border border-surface-border hover:bg-surface-overlay flex-row items-center justify-center">
              <Text className="text-typography-main text-xs font-bold">{secondaryLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
