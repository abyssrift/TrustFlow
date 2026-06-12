import { AppNotification, useNotifications } from '@/contexts/NotificationsContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getNotificationRoute } from '@/lib/notificationRouting';
import { FontAwesome } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ── Notification type → icon + color ────────────────────────────────────────
type ThemeColors = ReturnType<typeof useThemeColors>;

function getIconSpec(type: string, colors: ThemeColors): { name: React.ComponentProps<typeof FontAwesome>['name']; color: string; bgClass: string } {
  switch (type) {
    case 'task.assigned':       return { name: 'user-plus', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'task.mentioned':      return { name: 'at', color: colors.warning, bgClass: 'bg-state-warning/10' };
    case 'task.commented':      return { name: 'comment', color: colors.textMuted, bgClass: 'bg-surface-overlay' };
    case 'task.created':        return { name: 'plus-square', color: colors.success, bgClass: 'bg-state-success/10' };
    case 'task.completed':      return { name: 'check-circle', color: colors.success, bgClass: 'bg-state-success/10' };
    case 'task.stage_transition': return { name: 'exchange', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'task.status_changed': return { name: 'refresh', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'task.due_soon':       return { name: 'clock-o', color: colors.warning, bgClass: 'bg-state-warning/10' };
    case 'task.overdue':        return { name: 'exclamation-circle', color: colors.danger, bgClass: 'bg-state-danger/10' };
    case 'task.pinged':         return { name: 'bullhorn', color: colors.warning, bgClass: 'bg-state-warning/10' };
    case 'task.manual_time_flagged':  return { name: 'flag', color: colors.warning, bgClass: 'bg-state-warning/10' };
    case 'task.manual_time_approved': return { name: 'thumbs-up', color: colors.success, bgClass: 'bg-state-success/10' };
    case 'task.manual_time_rejected': return { name: 'thumbs-down', color: colors.danger, bgClass: 'bg-state-danger/10' };
    case 'pipeline.member_added': return { name: 'users', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'pipeline.archived':   return { name: 'archive', color: colors.textMuted, bgClass: 'bg-surface-overlay' };
    case 'filehub.file_received':    return { name: 'file-text-o', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'filehub.broadcast_posted': return { name: 'rss', color: colors.warning, bgClass: 'bg-state-warning/10' };
    case 'filehub.group_file_shared': return { name: 'share-alt', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'timer.auto_stopped':  return { name: 'hourglass-end', color: colors.danger, bgClass: 'bg-state-danger/10' };
    default:                    return { name: 'bell', color: colors.primary, bgClass: 'bg-brand-primary/10' };
  }
}

// ── Time-ago helper ──────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Section header (date grouping) ───────────────────────────────────────────
function sectionLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// ── Single notification row ──────────────────────────────────────────────────
function NotificationItem({
  item,
  onPress,
  colors,
}: {
  item: AppNotification;
  onPress: (item: AppNotification) => void;
  colors: ThemeColors;
}) {
  const { name: iconName, color: iconColor, bgClass } = getIconSpec(item.type, colors);
  const isUnread = !item.read_at;

  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      activeOpacity={0.75}
      className={`flex-row items-start px-4 py-4 border-b border-surface-border ${
        isUnread ? 'bg-brand-primary/5' : 'bg-surface-background'
      }`}
    >
      {/* Icon bubble */}
      <View
        className={`w-10 h-10 rounded-full items-center justify-center mr-3 mt-0.5 flex-shrink-0 ${bgClass}`}
      >
        <FontAwesome name={iconName} size={16} color={iconColor} />
      </View>

      {/* Content */}
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center justify-between mb-0.5">
          <Text
            className={`text-sm flex-1 mr-2 ${
              isUnread ? 'font-black text-typography-main' : 'font-semibold text-typography-muted'
            }`}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text className="text-[10px] text-typography-muted font-medium flex-shrink-0">
            {timeAgo(item.created_at)}
          </Text>
        </View>
        <Text className="text-xs text-typography-muted leading-5" numberOfLines={2}>
          {item.body}
        </Text>
      </View>

      {/* Unread dot */}
      {isUnread && (
        <View className="w-2 h-2 rounded-full bg-brand-primary mt-2 ml-2 flex-shrink-0" />
      )}
    </TouchableOpacity>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────
function EmptyState() {

  const colors = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center px-8 py-24">
      <View className="bg-brand-primary/10 p-6 rounded-full mb-6 border border-brand-primary/20">
        <FontAwesome name="bell-o" size={40} color={colors.primary} />
      </View>
      <Text className="text-typography-main font-black text-2xl tracking-tight text-center mb-2">
        All Clear
      </Text>
      <Text className="text-typography-muted text-sm text-center leading-6">
        No notifications yet. When something important happens, you'll hear about it here.
      </Text>
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────
export default function NotificationsModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notifications, unreadCount, loading, refresh, markRead, markAllRead } =
    useNotifications();
  const colors = useThemeColors();

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

  // Build grouped list with section header items
  type ListItem =
    | { kind: 'header'; label: string; key: string }
    | { kind: 'item'; notification: AppNotification; key: string };

  const listData: ListItem[] = [];
  let lastLabel = '';
  for (const n of notifications) {
    const label = sectionLabel(n.created_at);
    if (label !== lastLabel) {
      listData.push({ kind: 'header', label, key: `header-${label}` });
      lastLabel = label;
    }
    listData.push({ kind: 'item', notification: n, key: n.id });
  }

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.kind === 'header') {
      return (
        <View className="px-4 pt-5 pb-2">
          <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted">
            {item.label}
          </Text>
        </View>
      );
    }
    return (
      <NotificationItem item={item.notification} onPress={handleItemPress} colors={colors} />
    );
  };

  return (
    <View className="flex-1 bg-surface-background">
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />

      {/* Header */}
      <View
        className="bg-surface-card px-4 pb-4 border-b border-surface-border"
        style={{ paddingTop: insets.top + 16 }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <TouchableOpacity
              onPress={() => router.dismiss()}
              className="w-9 h-9 bg-surface-overlay rounded-xl border border-surface-border items-center justify-center"
            >
              <FontAwesome name="chevron-down" size={14} className="text-typography-muted" />
            </TouchableOpacity>
            <View>
              <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-0.5">
                Signal Feed
              </Text>
              <Text className="text-2xl font-black tracking-tight text-typography-main">
                Notifications
              </Text>
            </View>
          </View>

          <View className="flex-row items-center gap-2">
            {unreadCount > 0 && (
              <TouchableOpacity
                onPress={markAllRead}
                className="bg-brand-primary/10 px-3 py-2 rounded-xl border border-brand-primary/20"
              >
                <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">
                  Mark All Read
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => router.push('/notifications/preferences' as any)}
              className="w-9 h-9 bg-surface-overlay rounded-xl border border-surface-border items-center justify-center"
            >
              <FontAwesome name="sliders" size={14} className="text-typography-muted" />
            </TouchableOpacity>
          </View>
        </View>

        {unreadCount > 0 && (
          <View className="mt-3 flex-row items-center">
            <View className="bg-brand-primary/10 px-2.5 py-1 rounded-full border border-brand-primary/20">
              <Text className="text-brand-primary text-[10px] font-black">
                {unreadCount} unread
              </Text>
            </View>
          </View>
        )}
      </View>

      {loading && notifications.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : notifications.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refresh}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
