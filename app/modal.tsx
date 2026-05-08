import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useNotifications, AppNotification } from '@/contexts/NotificationsContext';

// ── Notification type → icon + color ────────────────────────────────────────
type IconSpec = { name: React.ComponentProps<typeof FontAwesome>['name']; color: string };

function getIconSpec(type: string): { name: React.ComponentProps<typeof FontAwesome>['name']; iconClass: string; bgClass: string } {
  switch (type) {
    case 'task.assigned':       return { name: 'user-plus',         iconClass: 'text-brand-primary', bgClass: 'bg-brand-primary/10' };
    case 'task.mentioned':      return { name: 'at',                iconClass: 'text-state-warning', bgClass: 'bg-state-warning/10' };
    case 'task.commented':      return { name: 'comment',           iconClass: 'text-typography-muted', bgClass: 'bg-surface-overlay' };
    case 'task.created':        return { name: 'plus-square',       iconClass: 'text-state-success', bgClass: 'bg-state-success/10' };
    case 'task.completed':      return { name: 'check-circle',      iconClass: 'text-state-success', bgClass: 'bg-state-success/10' };
    case 'task.stage_transition': return { name: 'exchange',        iconClass: 'text-brand-primary', bgClass: 'bg-brand-primary/10' };
    case 'task.status_changed': return { name: 'refresh',           iconClass: 'text-brand-primary', bgClass: 'bg-brand-primary/10' };
    case 'task.due_soon':       return { name: 'clock-o',           iconClass: 'text-state-warning', bgClass: 'bg-state-warning/10' };
    case 'task.overdue':        return { name: 'exclamation-circle',iconClass: 'text-state-danger', bgClass: 'bg-state-danger/10' };
    default:                    return { name: 'bell',              iconClass: 'text-brand-primary', bgClass: 'bg-brand-primary/10' };
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
}: {
  item: AppNotification;
  onPress: (item: AppNotification) => void;
}) {
  const { name: iconName, iconClass, bgClass } = getIconSpec(item.type);
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
        <FontAwesome name={iconName} size={16} className={iconClass} />
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
  return (
    <View className="flex-1 items-center justify-center px-8 py-24">
      <View className="bg-brand-primary/10 p-6 rounded-full mb-6 border border-brand-primary/20">
        <FontAwesome name="bell-o" size={40} className="text-brand-primary" />
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
  const { notifications, unreadCount, loading, refresh, markRead, markAllRead } =
    useNotifications();

  const handleItemPress = useCallback(
    async (item: AppNotification) => {
      if (!item.read_at) await markRead(item.id);
      const taskId = item.data?.task_id;
      if (taskId) {
        router.dismiss();
        router.push(`/task/${taskId}` as any);
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
      <NotificationItem item={item.notification} onPress={handleItemPress} />
    );
  };

  return (
    <View className="flex-1 bg-surface-background">
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />

      {/* Header */}
      <View className="bg-surface-card px-4 pt-4 pb-4 border-b border-surface-border">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-0.5">
              Signal Feed
            </Text>
            <Text className="text-2xl font-black tracking-tight text-typography-main">
              Notifications
            </Text>
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
              className="bg-surface-background p-2.5 rounded-xl border border-surface-border"
            >
              <FontAwesome
                name="sliders"
                size={15}
                className="text-typography-muted"
              />
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
          <ActivityIndicator size="large" color="var(--color-primary)" />
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
              tintColor="var(--color-primary)"
            />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
