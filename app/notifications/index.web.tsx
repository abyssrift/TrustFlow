import { AppNotification, useNotifications } from '@/contexts/NotificationsContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getNotificationIcon } from '@/lib/notificationIcons';
import { getNotificationRoute } from '@/lib/notificationRouting';
import { formatRelative } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

/** Rail groups derived straight from the `type` prefix — no extra mapping to keep in sync. */
const GROUPS: { key: string; label: string; icon: React.ComponentProps<typeof FontAwesome>['name'] }[] = [
  { key: 'task',     label: 'Tasks',     icon: 'check-square-o' },
  { key: 'pipeline', label: 'Pipelines', icon: 'sitemap' },
  { key: 'filehub',  label: 'Files',     icon: 'folder-open-o' },
  { key: 'timer',    label: 'Timers',    icon: 'clock-o' },
];

function timeAgo(iso: string): string {
  return formatRelative(iso);
}

function sectionLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function NotificationItem({ item, onPress, compact }: { item: AppNotification; onPress: (item: AppNotification) => void; compact?: boolean; }) {
  const colors = useThemeColors();
  const { name: iconName, color: iconColor } = getNotificationIcon(item.type, colors);
  const isUnread = !item.read_at;

  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      className={`flex-row items-start border-b border-surface-border transition-colors hover:bg-surface-overlay ${
        compact ? 'px-6 py-3' : 'px-8 py-5'
      } ${isUnread ? 'bg-brand-primary/5' : 'bg-transparent'}`}
    >
      <View
        className={`items-center justify-center mr-4 flex-shrink-0 ${compact ? 'w-9 h-9 rounded-xl' : 'w-12 h-12 rounded-2xl'}`}
        style={{ backgroundColor: iconColor + '22' }}
      >
        <FontAwesome name={iconName} size={compact ? 15 : 18} color={iconColor} />
      </View>

      <View className="flex-1 min-w-0 justify-center pt-0.5">
        <View className="flex-row items-center justify-between mb-0.5">
          <Text
            className={`flex-1 mr-4 ${compact ? 'text-sm' : 'text-base'} ${
              isUnread ? 'font-black text-typography-main' : 'font-bold text-typography-muted'
            }`}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text className="text-[11px] text-typography-muted font-bold tracking-wider flex-shrink-0">
            {timeAgo(item.created_at)}
          </Text>
        </View>
        <Text
          className={`text-typography-muted ${compact ? 'text-[13px] leading-5' : 'text-sm leading-6'}`}
          numberOfLines={compact ? 1 : 2}
        >
          {item.body}
        </Text>
      </View>

      {isUnread && (
        <View className={`rounded-full bg-brand-primary flex-shrink-0 ${compact ? 'w-2 h-2 mt-2.5 ml-3' : 'w-2.5 h-2.5 mt-3 ml-4'}`} />
      )}
    </TouchableOpacity>
  );
}

function RailItem({
  label, icon, count, active, onPress,
}: { label: string; icon: React.ComponentProps<typeof FontAwesome>['name']; count: number; active: boolean; onPress: () => void; }) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-row items-center px-3 py-2.5 rounded-xl mb-1 transition-colors ${
        active ? 'bg-brand-primary/10' : 'hover:bg-surface-overlay'
      }`}
    >
      <View className="w-5 items-center">
        <FontAwesome name={icon} size={14} color={active ? colors.primary : colors.textMuted} />
      </View>
      <Text
        className={`flex-1 ml-3 text-sm ${active ? 'font-black text-brand-primary' : 'font-bold text-typography-muted'}`}
        numberOfLines={1}
      >
        {label}
      </Text>
      {count > 0 && (
        <Text className={`text-[11px] font-black ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>
          {count}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function EmptyState({ message }: { message: string }) {
  const colors = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center px-10 py-20">
      <View className="bg-brand-primary/10 p-8 rounded-[32px] mb-8 border border-brand-primary/20">
        <FontAwesome name="bell-o" size={48} color={colors.primary} />
      </View>
      <Text className="text-typography-main font-black text-2xl tracking-tight text-center mb-3">All Clear</Text>
      <Text className="text-typography-muted text-base text-center leading-7 max-w-sm">{message}</Text>
    </View>
  );
}

export default function NotificationsScreenWeb() {
  const colors = useThemeColors();
  const router = useRouter();
  const { notifications, unreadCount, loading, markRead, markAllRead } = useNotifications();
  const { width: winWidth } = useWindowDimensions();
  const isNarrow = winWidth < 768;
  const isWide = winWidth >= 1024;
  const [filter, setFilter] = useState<string>('all');

  const handleItemPress = useCallback(
    async (item: AppNotification) => {
      if (!item.read_at) await markRead(item.id);
      const route = getNotificationRoute(item);
      if (route) {
        router.dismiss();
        router.push(route as any);
      }
    },
    [markRead, router]
  );

  const groupCounts: Record<string, number> = {};
  for (const n of notifications) {
    const g = n.type.split('.')[0];
    groupCounts[g] = (groupCounts[g] ?? 0) + 1;
  }

  const visible = isWide
    ? notifications.filter((n) =>
        filter === 'all' ? true : filter === 'unread' ? !n.read_at : n.type.split('.')[0] === filter
      )
    : notifications;

  const activeLabel =
    filter === 'all' ? 'All' : filter === 'unread' ? 'Unread' : GROUPS.find((g) => g.key === filter)?.label ?? 'All';

  type ListItem =
    | { kind: 'header'; label: string; key: string }
    | { kind: 'item'; notification: AppNotification; key: string };

  const listData: ListItem[] = [];
  let lastLabel = '';
  for (const n of visible) {
    const label = sectionLabel(n.created_at);
    if (label !== lastLabel) {
      listData.push({ kind: 'header', label, key: `header-${label}` });
      lastLabel = label;
    }
    listData.push({ kind: 'item', notification: n, key: n.id });
  }

  const iconBtn = 'h-10 w-10 items-center justify-center rounded-full bg-surface-background border border-surface-border hover:bg-surface-overlay active:scale-90 transition-all';

  const list =
    loading && notifications.length === 0 ? (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    ) : visible.length === 0 ? (
      <EmptyState
        message={
          notifications.length === 0
            ? "No notifications yet. When something important happens, you'll hear about it here."
            : `Nothing in ${activeLabel.toLowerCase()} right now.`
        }
      />
    ) : (
      <FlatList
        data={listData}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <View className={`bg-surface-card ${isWide ? 'px-6 pt-6 pb-2' : 'px-10 pt-8 pb-3'}`}>
                <Text className="text-[11px] font-black uppercase tracking-[0.2em] text-typography-muted">
                  {item.label}
                </Text>
              </View>
            );
          }
          return <NotificationItem item={item.notification} onPress={handleItemPress} compact={isWide} />;
        }}
      />
    );

  // Desktop (>= 1024): inbox layout — filter rail on the left, wide compact list on the right.
  if (isWide) {
    return (
      <View className="flex-1 bg-surface-background/80 items-center justify-center p-6">
        <Stack.Screen options={{ headerShown: false }} />
        <View className="w-full max-w-[1080px] h-[85vh] bg-surface-card rounded-2xl border border-surface-border overflow-hidden premium-shadow glass-card flex-row">
          {/* Filter rail */}
          <View className="w-60 border-r border-surface-border p-4 flex-col">
            <View className="flex-row items-center px-3 pt-2 pb-5">
              <View className="h-10 w-10 rounded-2xl bg-brand-primary/10 items-center justify-center mr-3">
                <FontAwesome name="bell-o" size={17} color={colors.primary} />
              </View>
              <View className="flex-1 min-w-0">
                <Text className="text-base font-black text-typography-main tracking-tight" numberOfLines={1}>
                  Notifications
                </Text>
                <Text className="text-[10px] font-bold text-typography-muted uppercase tracking-[0.2em]">
                  Signal Feed
                </Text>
              </View>
            </View>

            <RailItem label="All" icon="inbox" count={notifications.length} active={filter === 'all'} onPress={() => setFilter('all')} />
            <RailItem label="Unread" icon="circle-o" count={unreadCount} active={filter === 'unread'} onPress={() => setFilter('unread')} />

            <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted px-3 pt-5 pb-2">
              Categories
            </Text>
            {GROUPS.filter((g) => groupCounts[g.key] || filter === g.key).map((g) => (
              <RailItem
                key={g.key}
                label={g.label}
                icon={g.icon}
                count={groupCounts[g.key] ?? 0}
                active={filter === g.key}
                onPress={() => setFilter(g.key)}
              />
            ))}

            <View className="flex-1" />
            <TouchableOpacity
              onPress={() => { router.dismiss(); router.push('/notifications/preferences' as any); }}
              className="flex-row items-center px-3 py-2.5 rounded-xl hover:bg-surface-overlay transition-colors"
            >
              <View className="w-5 items-center">
                <FontAwesome name="sliders" size={14} color={colors.textMuted} />
              </View>
              <Text className="ml-3 text-sm font-bold text-typography-muted">Preferences</Text>
            </TouchableOpacity>
          </View>

          {/* List pane */}
          <View className="flex-1 min-w-0 flex-col">
            <View className="px-6 py-4 border-b border-surface-border flex-row items-center justify-between bg-surface-card z-10">
              <View className="flex-row items-center flex-1 min-w-0 mr-3">
                <Text className="text-lg font-black text-typography-main tracking-tight" numberOfLines={1}>
                  {activeLabel}
                </Text>
                <Text className="text-xs font-bold text-typography-muted ml-3">{visible.length}</Text>
              </View>
              <View className="flex-row items-center gap-3 flex-shrink-0">
                {unreadCount > 0 && (
                  <TouchableOpacity
                    onPress={markAllRead}
                    className="bg-brand-primary/10 px-4 py-2.5 rounded-xl border border-brand-primary/20 hover:bg-brand-primary-hover/20 active:bg-brand-primary-active/25 transition-colors"
                  >
                    <Text className="text-brand-primary text-[11px] font-black uppercase tracking-widest">Mark All Read</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => router.back()} className={iconBtn}>
                  <FontAwesome name="times" size={14} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
            <View className="flex-1 min-h-0">{list}</View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className={isNarrow ? 'flex-1 bg-surface-background/80' : 'flex-1 bg-surface-background/80 items-center justify-center p-6'}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className={isNarrow
        ? 'flex-1 w-full bg-surface-card border border-surface-border overflow-hidden flex-col'
        : 'w-full max-w-2xl bg-surface-card rounded-2xl border border-surface-border overflow-hidden premium-shadow glass-card max-h-[85vh] flex-col'
      }>
        {/* Header */}
        <View className={isNarrow
          ? 'px-5 py-5 border-b border-surface-border flex-row items-center justify-between bg-surface-card z-10'
          : 'px-8 py-6 border-b border-surface-border flex-row items-center justify-between bg-surface-card z-10'
        }>
          <View className="flex-row items-center flex-1 min-w-0 mr-3">
            {!isNarrow && (
              <View className="h-12 w-12 rounded-2xl bg-brand-primary/10 items-center justify-center mr-4">
                <FontAwesome name="bell-o" size={20} color={colors.primary} />
              </View>
            )}
            <View className="flex-1 min-w-0">
              <Text
                className={isNarrow ? 'text-lg font-black text-typography-main tracking-tight' : 'text-2xl font-black text-typography-main tracking-tight mb-0.5'}
                numberOfLines={1}
              >
                Notifications
              </Text>
              {!isNarrow && (
                <View className="flex-row items-center">
                  <Text className="text-xs font-bold text-typography-muted uppercase tracking-[0.2em]">Signal Feed</Text>
                  {unreadCount > 0 && (
                    <View className="bg-brand-primary/20 px-2 py-0.5 rounded-md ml-3">
                      <Text className="text-brand-primary text-[10px] font-black">{unreadCount} New</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>

          <View className="flex-row items-center gap-3 flex-shrink-0">
            {unreadCount > 0 && !isNarrow && (
              <TouchableOpacity
                onPress={markAllRead}
                className="bg-brand-primary/10 px-4 py-2.5 rounded-xl border border-brand-primary/20 hover:bg-brand-primary-hover/20 active:bg-brand-primary-active/25 transition-colors"
              >
                <Text className="text-brand-primary text-[11px] font-black uppercase tracking-widest">
                  Mark All Read
                </Text>
              </TouchableOpacity>
            )}
            {unreadCount > 0 && isNarrow && (
              <TouchableOpacity
                onPress={markAllRead}
                className="h-11 w-11 items-center justify-center rounded-full bg-brand-primary/10 border border-brand-primary/20"
              >
                <FontAwesome name="check" size={14} color={colors.primary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => { router.dismiss(); router.push('/notifications/preferences' as any); }}
              className={isNarrow
                ? 'h-11 w-11 items-center justify-center rounded-full bg-surface-background border border-surface-border'
                : iconBtn
              }
            >
              <FontAwesome name="sliders" size={14} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.back()}
              className={isNarrow
                ? 'h-11 w-11 items-center justify-center rounded-full bg-surface-background border border-surface-border ml-1'
                : `${iconBtn} ml-1`
              }
            >
              <FontAwesome name="times" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Content */}
        <View className="flex-1 min-h-[400px]">{list}</View>
      </View>
    </View>
  );
}
