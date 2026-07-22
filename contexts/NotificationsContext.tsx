import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { usePingNotification } from '@/hooks/usePingNotification';
import { useAuth } from './AuthContext';

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, any>;
  read_at: string | null;
  channels_sent: string[];
  created_at: string;
};

type NotificationsContextType = {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextType>({
  notifications: [],
  unreadCount: 0,
  loading: false,
  refresh: async () => {},
  markRead: async () => {},
  markAllRead: async () => {},
});

export const useNotifications = () => useContext(NotificationsContext);

export const NotificationsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  // ponytail: reuses the company ping sound rather than a dedicated "new task"
  // asset — no separate sound infra exists yet. Split out if a distinct sound
  // is ever requested.
  const { playPingSound } = usePingNotification();

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60);
    if (data) setNotifications(data as AppNotification[]);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }

    refresh();

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const notification = payload.new as AppNotification;
          setNotifications((prev) => [notification, ...prev]);

          // Ambient cue for a new task, only when the user isn't looking at
          // the app: a subtle sound on web (tab hidden), haptic on native.
          if (notification.type === 'task.created') {
            if (Platform.OS === 'web') {
              if (typeof document !== 'undefined' && document.hidden) playPingSound();
            } else {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === payload.new.id
                ? { ...n, ...(payload.new as AppNotification) }
                : n
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refresh]);

  const markRead = useCallback(async (id: string) => {
    await supabase.rpc('rpc_mark_notification_read', {
      p_notification_id: id,
    });
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, read_at: new Date().toISOString() } : n
      )
    );
  }, []);

  const markAllRead = useCallback(async () => {
    await supabase.rpc('rpc_mark_all_notifications_read');
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? now }))
    );
  }, []);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <NotificationsContext.Provider
      value={{ notifications, unreadCount, loading, refresh, markRead, markAllRead }}
    >
      {children}
    </NotificationsContext.Provider>
  );
};
