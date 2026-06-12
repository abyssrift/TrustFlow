import { AppNotification, useNotifications } from '@/contexts/NotificationsContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getNotificationRoute } from '@/lib/notificationRouting';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from 'react-native';

type IconSpec = { name: React.ComponentProps<typeof FontAwesome>['name']; color: string };

function getIconSpec(type: string): IconSpec {
  const colors = useThemeColors();
  switch (type) {
    case 'task.assigned':       return { name: 'user-plus',         color: colors.primary };
    case 'task.mentioned':      return { name: 'at',                color: colors.warning };
    case 'task.commented':      return { name: 'comment',           color: colors.textMuted };
    case 'task.created':        return { name: 'plus-square',       color: colors.success };
    case 'task.completed':      return { name: 'check-circle',      color: colors.success };
    case 'task.stage_transition': return { name: 'exchange',        color: colors.primary };
    case 'task.status_changed': return { name: 'refresh',           color: colors.primary };
    case 'task.due_soon':       return { name: 'clock-o',           color: colors.warning };
    case 'task.overdue':        return { name: 'exclamation-circle',color: colors.danger };
    case 'task.pinged':         return { name: 'bullhorn',          color: colors.warning };
    case 'task.manual_time_flagged':  return { name: 'flag',        color: colors.warning };
    case 'task.manual_time_approved': return { name: 'thumbs-up',   color: colors.success };
    case 'task.manual_time_rejected': return { name: 'thumbs-down', color: colors.danger };
    case 'pipeline.member_added': return { name: 'users',           color: colors.primary };
    case 'pipeline.archived':   return { name: 'archive',           color: colors.textMuted };
    case 'filehub.file_received':    return { name: 'file-text-o',  color: colors.primary };
    case 'filehub.broadcast_posted': return { name: 'rss',          color: colors.warning };
    case 'filehub.group_file_shared': return { name: 'share-alt',   color: colors.primary };
    case 'timer.auto_stopped':  return { name: 'hourglass-end',     color: colors.danger };
    default:                    return { name: 'bell',              color: colors.primary };
  }
}

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

function sectionLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function NotificationItem({ item, onPress }: { item: AppNotification; onPress: (item: AppNotification) => void; }) {
  const colors = useThemeColors();
  const { name: iconName, color: iconColor } = getIconSpec(item.type);
  const isUnread = !item.read_at;

  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      className={`flex-row items-start px-8 py-5 border-b border-surface-border transition-colors hover:bg-surface-overlay ${
        isUnread ? 'bg-brand-primary/5' : 'bg-transparent'
      }`}
    >
      <View
        className="w-12 h-12 rounded-2xl items-center justify-center mr-4 flex-shrink-0"
        style={{ backgroundColor: iconColor + '22' }}
      >
        <FontAwesome name={iconName} size={18} color={iconColor} />
      </View>

      <View className="flex-1 min-w-0 justify-center pt-1">
        <View className="flex-row items-center justify-between mb-1">
          <Text
            className={`text-base flex-1 mr-4 ${
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
        <Text className="text-sm text-typography-muted leading-6" numberOfLines={2}>
          {item.body}
        </Text>
      </View>

      {isUnread && (
        <View className="w-2.5 h-2.5 rounded-full bg-brand-primary mt-3 ml-4 flex-shrink-0" />
      )}
    </TouchableOpacity>
  );
}

export default function ModalScreenWeb() {
  const colors = useThemeColors();
  const router = useRouter();
  const { notifications, unreadCount, loading, markRead, markAllRead } = useNotifications();

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

  return (
    <View className="flex-1 bg-surface-background/80 items-center justify-center p-6">
      <Stack.Screen options={{ headerShown: false }} />
      
      <View className="w-full max-w-2xl bg-surface-card rounded-[40px] border border-surface-border overflow-hidden premium-shadow glass-card max-h-[85vh] flex-col">
        {/* Header */}
        <View className="px-10 py-8 border-b border-surface-border flex-row items-center justify-between bg-surface-card z-10">
          <View className="flex-row items-center">
            <View className="h-14 w-14 rounded-2xl bg-brand-primary/10 items-center justify-center mr-6">
              <FontAwesome name="bell" size={24} className="text-brand-primary" />
            </View>
            <View>
              <Text className="text-3xl font-black text-typography-main tracking-tight mb-1">Notifications</Text>
              <View className="flex-row items-center">
                <Text className="text-xs font-bold text-typography-muted uppercase tracking-[0.2em]">Signal Feed</Text>
                {unreadCount > 0 && (
                  <View className="bg-brand-primary/20 px-2 py-0.5 rounded-md ml-3">
                    <Text className="text-brand-primary text-[10px] font-black">{unreadCount} New</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
          
          <View className="flex-row items-center gap-3">
            {unreadCount > 0 && (
              <TouchableOpacity
                onPress={markAllRead}
                className="bg-brand-primary/10 px-4 py-2.5 rounded-xl border border-brand-primary/20 hover:bg-brand-primary/20 transition-colors"
              >
                <Text className="text-brand-primary text-[11px] font-black uppercase tracking-widest">
                  Mark All Read
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity 
              onPress={() => { router.dismiss(); router.push('/notifications/preferences' as any); }}
              className="h-10 w-10 items-center justify-center rounded-full bg-surface-background border border-surface-border hover:bg-surface-overlay active:scale-90 transition-all"
            >
              <FontAwesome name="sliders" size={14} className="text-typography-muted" />
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => router.back()}
              className="h-10 w-10 items-center justify-center rounded-full bg-surface-background border border-surface-border hover:bg-surface-overlay active:scale-90 transition-all ml-1"
            >
              <FontAwesome name="close" size={14} className="text-typography-muted" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Content */}
        <View className="flex-1 min-h-[400px]">
          {loading && notifications.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : notifications.length === 0 ? (
            <View className="flex-1 items-center justify-center px-10 py-20">
              <View className="bg-brand-primary/10 p-8 rounded-[32px] mb-8 border border-brand-primary/20">
                <FontAwesome name="bell-o" size={48} color={colors.primary} />
              </View>
              <Text className="text-typography-main font-black text-2xl tracking-tight text-center mb-3">
                All Clear
              </Text>
              <Text className="text-typography-muted text-base text-center leading-7 max-w-sm">
                No notifications yet. When something important happens, you'll hear about it here.
              </Text>
            </View>
          ) : (
            <FlatList
              data={listData}
              keyExtractor={(item) => item.key}
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                if (item.kind === 'header') {
                  return (
                    <View className="px-10 pt-8 pb-3 bg-surface-card">
                      <Text className="text-[11px] font-black uppercase tracking-[0.2em] text-typography-muted">
                        {item.label}
                      </Text>
                    </View>
                  );
                }
                return <NotificationItem item={item.notification} onPress={handleItemPress} />;
              }}
            />
          )}
        </View>
      </View>
    </View>
  );
}
