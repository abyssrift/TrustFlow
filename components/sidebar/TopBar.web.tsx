import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import type { Shortcut } from './constants';
import PinnedShortcuts from './PinnedShortcuts.web';
import ProfilePill from './ProfilePill.web';
import SearchDropdown from './search/SearchDropdown.web';

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
  onPickerOpenChange,
  onSearchFocusChange,
}: {
  topSearch: string;
  setTopSearch: (value: string) => void;
  unreadCount: number;
  onToggleThemePopover: () => void;
  profileAvatarUrl: string | null;
  profileLabel: string;
  visibleShortcuts: Shortcut[];
  pipelines: { id: string; name: string }[];
  onPickerOpenChange?: (open: boolean) => void;
  onSearchFocusChange?: (focused: boolean) => void;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const [focused, setFocused] = React.useState(false);
  const blurTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { grouped, results, loading, parsed } = useGlobalSearch(topSearch, { enabled: focused });
  const { recent, push: pushRecent, remove: removeRecent, clear: clearRecent } = useRecentSearches();

  const setFocus = (v: boolean) => { setFocused(v); onSearchFocusChange?.(v); };
  // Delay blur so a click inside the dropdown lands before it unmounts.
  const onBlur = () => { blurTimer.current = setTimeout(() => setFocus(false), 150); };
  const onFocus = () => { if (blurTimer.current) clearTimeout(blurTimer.current); setFocus(true); };
  const closeNow = () => { if (blurTimer.current) clearTimeout(blurTimer.current); setFocus(false); };

  const goToResults = () => {
    const q = topSearch.trim();
    if (!q) return;
    pushRecent(q);
    closeNow();
    router.push(`/search?q=${encodeURIComponent(q)}` as any);
  };

  return (
      <View className="h-16 flex-row items-center gap-3 border-b border-surface-border bg-surface-background px-5">
        <View className="h-9 flex-1 max-w-md flex-row items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3" style={{ position: 'relative' }}>
          <FontAwesome name="search" size={12} color={colors.textDim} />
          <TextInput
            value={topSearch}
            onChangeText={setTopSearch}
            onFocus={onFocus}
            onBlur={onBlur}
            onSubmitEditing={goToResults}
            returnKeyType="search"
            placeholder="Search tasks, files, reports…"
            placeholderTextColor={colors.textDim}
            className="flex-1 text-sm text-typography-main outline-none"
            style={{ paddingVertical: 0 }}
          />
          <SearchDropdown
            visible={focused}
            query={topSearch}
            parsed={parsed}
            grouped={grouped}
            results={results}
            loading={loading}
            recent={recent}
            onPickRecent={(q) => { setTopSearch(q); }}
            onRemoveRecent={removeRecent}
            onClearRecent={clearRecent}
            onSubmit={goToResults}
            onNavigate={() => { pushRecent(topSearch.trim()); closeNow(); }}
          />
        </View>

        <PinnedShortcuts visibleShortcuts={visibleShortcuts} pipelines={pipelines} onOpenChange={onPickerOpenChange} />

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
