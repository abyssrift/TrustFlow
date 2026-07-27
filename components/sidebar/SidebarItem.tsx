import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import Tooltip from '@/components/common/Tooltip';
import type { IconName } from './constants';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

export default function SidebarItem({
  icon,
  label,
  href,
  isActive,
  collapsed,
  badge,
}: {
  icon: IconName;
  label: string;
  href: string;
  isActive: boolean;
  collapsed: boolean;
  badge?: number;
}) {
  const colors = useThemeColors();
  const pressable = (
    <Pressable
      className={`group relative mb-2 min-h-11 flex-row items-center overflow-hidden rounded-xl border p-3 ${isActive ? 'border-brand-primary/30 bg-brand-primary/10' : 'border-transparent hover:bg-surface-card'
        }`}
      accessibilityLabel={label}
    >
        <View className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${isActive ? 'bg-brand-primary' : 'bg-transparent group-hover:bg-surface-border'}`} />
        <View className={`${collapsed ? 'w-full' : 'w-8'} items-center`} style={{ position: 'relative' }}>
          <FontAwesome
            name={icon}
            size={18}
            color={isActive ? colors.primary : colors.textDim}
          />
          {collapsed && !!badge && badge > 0 && (
            <View
              className="absolute -top-1.5 -right-1.5 min-w-4 h-4 rounded-full bg-red-500 items-center justify-center px-0.5"
            >
              <Text className="text-[9px] font-black text-white leading-none">
                {badge > 99 ? '99+' : badge}
              </Text>
            </View>
          )}
        </View>
        {!collapsed && (
          <Text
            className={`ml-2 font-bold ${isActive ? 'text-brand-primary' : 'text-typography-muted'} whitespace-nowrap`}
            numberOfLines={1}
          >
            {label}
          </Text>
        )}
        {!collapsed && !!badge && badge > 0 && (
          <View className="ml-auto min-w-5 h-5 rounded-full bg-red-500 items-center justify-center px-1">
            <Text className="text-[10px] font-black text-white leading-none">
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        )}
        {isActive && !collapsed && (!badge || badge === 0) && <View className="ml-auto h-2 w-2 rounded-full bg-brand-primary" />}
      </Pressable>
  );

  return (
    <Tooltip label={label} side="right" disabled={!collapsed}>
      <Link href={href as any} asChild>
        {pressable}
      </Link>
    </Tooltip>
  );
}
