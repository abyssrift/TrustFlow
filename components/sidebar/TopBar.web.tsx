import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import type { Shortcut } from './constants';
import PinnedShortcuts from './PinnedShortcuts.web';
import ProfilePill from './ProfilePill.web';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

export default function TopBar({
  topSearch,
  setTopSearch,
  unreadCount,
  onToggleThemePopover,
  profileAvatarUrl,
  profileLabel,
  visibleShortcuts,
  pipelines,
}: {
  topSearch: string;
  setTopSearch: (value: string) => void;
  unreadCount: number;
  onToggleThemePopover: () => void;
  profileAvatarUrl: string | null;
  profileLabel: string;
  visibleShortcuts: Shortcut[];
  pipelines: { id: string; name: string }[];
}) {
  const colors = useThemeColors();

  return (
      <View className="h-16 flex-row items-center gap-3 border-b border-surface-border bg-surface-background px-5">
        <View className="h-9 flex-1 max-w-md flex-row items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3">
          <FontAwesome name="search" size={12} color={colors.textDim} />
          <TextInput
            value={topSearch}
            onChangeText={setTopSearch}
            placeholder="Search..."
            placeholderTextColor={colors.textDim}
            className="flex-1 text-sm text-typography-main outline-none"
            style={{ paddingVertical: 0 }}
          />
        </View>

        <PinnedShortcuts visibleShortcuts={visibleShortcuts} pipelines={pipelines} />

        <View className="flex-1" />

        <Pressable
          onPress={onToggleThemePopover}
          className="h-9 w-9 items-center justify-center rounded-xl border border-surface-border bg-surface-card hover:bg-surface-overlay"
          accessibilityLabel="Theme settings"
        >
          <FontAwesome name="paint-brush" size={14} color={colors.textDim} />
        </Pressable>

        <Link href="/modal" asChild>
          <Pressable className="h-9 w-9 items-center justify-center rounded-xl border border-surface-border bg-surface-card hover:bg-surface-overlay">
            <View>
              <FontAwesome name="bell" size={14} color={colors.primary} />
              {unreadCount > 0 && (
                <View className="absolute -top-1.5 -right-1.5 min-w-4 h-4 rounded-full bg-state-danger items-center justify-center px-0.5">
                  <Text className="text-[9px] font-black text-white leading-none">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        </Link>

        <ProfilePill profileAvatarUrl={profileAvatarUrl} profileLabel={profileLabel} />
      </View>
  );
}
