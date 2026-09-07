import React from 'react';
import { Text, View } from 'react-native';

export type BlockProps = {
  title?: string;
  hint?: string;
  icon?: React.ReactNode;
  eyebrow?: React.ReactNode;
  right?: React.ReactNode;
  accent?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
};

/** Shared surface shell for section-sized content blocks. */
export default function Block({
  title,
  hint,
  icon,
  eyebrow,
  right,
  accent,
  children,
  className,
  bodyClassName,
}: BlockProps) {
  const hasHeader = !!(title || hint || icon || right);
  return (
    <View
      className={`bg-surface-card border border-surface-border rounded-2xl p-4 md:p-5 ${className ?? ''}`}
      style={accent ? { borderColor: `${accent}55` } : undefined}
    >
      {hasHeader && (
        <View className="flex-row items-start justify-between gap-3 mb-4">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            {icon}
            <View className="flex-1 min-w-0">
              {eyebrow}
              {!!title && <Text className="text-typography-main text-sm font-bold">{title}</Text>}
              {!!hint && <Text className="text-typography-muted text-[11px] mt-0.5">{hint}</Text>}
            </View>
          </View>
          {right}
        </View>
      )}
      <View className={bodyClassName}>{children}</View>
    </View>
  );
}
