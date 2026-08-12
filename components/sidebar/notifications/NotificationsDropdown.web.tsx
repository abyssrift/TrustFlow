import { AppNotification, useNotifications } from '@/contexts/NotificationsContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getNotificationIcon } from '@/lib/notificationIcons';
import { getNotificationRoute } from '@/lib/notificationRouting';
import { formatRelative } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import DropdownPanel from '../DropdownPanel.web';

/** Enough to fill the panel without turning it into the full inbox — that's
 *  what "Open notifications" is for. */
const MAX_ROWS = 12;

/**
 * Topbar notifications panel — shares its animated card (DropdownPanel) with
 * ThemeButton and PinnedShortcuts' picker so all three topbar popovers open
 * and close the same way. Desktop only by construction: TopBar.web.tsx only
 * renders at >= 768px, so mobile web keeps the full-screen /notifications route.
 */
export default function NotificationsDropdown({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  const rows = notifications.slice(0, MAX_ROWS);

  const openItem = async (item: AppNotification) => {
    if (!item.read_at) await markRead(item.id);
    const route = getNotificationRoute(item);
    onClose();
    if (route) router.push(route as any);
  };

  return (
    <DropdownPanel open={visible} align="right" width={360} contentClassName="p-0 overflow-hidden">
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 py-3">
        <Text className="flex-1 text-xs font-black text-typography-main">Notifications</Text>
        {unreadCount > 0 && (
          <>
            <Text className="text-[10.5px] font-black text-brand-primary">
              {unreadCount > 99 ? '99+' : unreadCount} new
            </Text>
            <Pressable onPress={markAllRead}>
              <Text className="text-[10.5px] font-black text-typography-muted">Mark all read</Text>
            </Pressable>
          </>
        )}
      </View>

      <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
        {rows.length === 0 ? (
          <View className="items-center py-8">
            <Text className="text-xs text-typography-dim">You're all caught up</Text>
          </View>
        ) : (
          rows.map((n) => {
            const { name: iconName, color: iconColor } = getNotificationIcon(n.type, colors);
            const isUnread = !n.read_at;
            return (
              <Pressable
                key={n.id}
                onPress={() => openItem(n)}
                className={`flex-row items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-overlay ${isUnread ? 'bg-brand-primary/5' : ''}`}
              >
                <View className="h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: iconColor + '22' }}>
                  <FontAwesome name={iconName} size={12} color={iconColor} />
                </View>
                <View className="flex-1 min-w-0">
                  <View className="flex-row items-baseline gap-2">
                    <Text
                      className={`flex-1 text-xs ${isUnread ? 'font-black text-typography-main' : 'font-bold text-typography-muted'}`}
                      numberOfLines={1}
                    >
                      {n.title}
                    </Text>
                    <Text className="text-[10px] font-bold text-typography-dim">{formatRelative(n.created_at)}</Text>
                  </View>
                  <Text className="text-[11px] text-typography-dim" numberOfLines={1}>
                    {n.body}
                  </Text>
                </View>
                {isUnread && <View className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-primary" />}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Pressable
        onPress={() => { onClose(); router.push('/notifications' as any); }}
        className="flex-row items-center justify-center gap-2 border-t border-surface-border py-2.5 transition-colors hover:bg-surface-overlay"
      >
        <FontAwesome name="inbox" size={11} color={colors.textMuted} />
        <Text className="text-[11.5px] font-bold text-typography-muted">Open notifications</Text>
      </Pressable>
    </DropdownPanel>
  );
}
