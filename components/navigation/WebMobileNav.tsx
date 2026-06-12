import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useUnreadNotificationAttention } from '@/hooks/useUnreadNotificationAttention';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, useLocalSearchParams, usePathname } from 'expo-router';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IconName = React.ComponentProps<typeof FontAwesome>['name'];

const MAIN_TABS = [
  { id: 'dashboard', icon: 'th-large', label: 'Dashboard', href: '/' },
  { id: 'tasks', icon: 'check-square-o', label: 'Tasks', href: '/tasks' },
  { id: 'projects', icon: 'folder-o', label: 'Projects', href: '/projects' },
] as const;

const matchesHref = (pathname: string, params: Record<string, any>, href: string) => {
  if (href.includes('?')) {
    const [basePath, queryString] = href.split('?');
    const queryPairs = queryString.split('&').map((pair) => pair.split('='));
    return pathname === basePath && queryPairs.every(([k, v]) => String(params[k]) === String(v));
  }
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
};

export default function WebMobileNav({
  visibleShortcuts,
  pipelines,
  isPlatformAdmin,
  fileHubBadge = 0,
}: {
  visibleShortcuts: any[];
  pipelines: any[];
  isPlatformAdmin: boolean;
  fileHubBadge?: number;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const { theme, setTheme } = useTheme();
  const colors = useThemeColors();
  const { session } = useAuth();
  const { unreadCount } = useNotifications();

  const { bottom } = useSafeAreaInsets();
  const handleClose = () => setDrawerOpen(false);

  useUnreadNotificationAttention(unreadCount);

  // On web: use CSS env(safe-area-inset-bottom) so the iPhone home bar is respected
  // even before react-native-safe-area-context picks it up from the DOM.
  // minHeight lets the bar grow beyond 56px to fit the safe area without squishing icons.
  // On native: fixed height = 56px + useSafeAreaInsets().bottom.
  const isWeb = Platform.OS === 'web';
  const navStyle = isWeb
    ? { minHeight: 56, paddingBottom: 'env(safe-area-inset-bottom, 0px)' as any }
    : { height: 56 + bottom, paddingBottom: bottom };

  return (
    <>
      <View
        style={navStyle}
        className="w-full border-t border-surface-border bg-surface-background flex-row items-center justify-around px-2"
      >
        {MAIN_TABS.map((tab) => {
          const isActive = matchesHref(pathname, params, tab.href);
          return (
            <Link key={tab.id} href={tab.href as any} asChild>
              <Pressable className="flex-1 items-center justify-center py-2 h-full">
                <FontAwesome name={tab.icon} size={22} color={isActive ? colors.primary : colors.textDim} style={{ marginBottom: 4 }} />
                <Text className={`text-[10px] font-bold ${isActive ? 'text-brand-primary' : 'text-typography-muted'}`}>{tab.label}</Text>
              </Pressable>
            </Link>
          );
        })}
        
        <Pressable onPress={() => setDrawerOpen(true)} className="flex-1 items-center justify-center py-2 h-full">
          <FontAwesome name="navicon" size={22} color={colors.textDim} style={{ marginBottom: 4 }} />
          <Text className="text-[10px] font-bold text-typography-muted">Menu</Text>
        </Pressable>
      </View>

      <Modal
        visible={drawerOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={handleClose}
      >
        <View className="flex-1 bg-surface-background w-full">
          <View className="h-16 flex-row items-center justify-between px-6 border-b border-surface-border">
            <Text className="text-xl font-black text-typography-main">Menu</Text>
            <Pressable onPress={handleClose} className="h-10 w-10 items-center justify-center rounded-full bg-surface-card border border-surface-border">
              <FontAwesome name="times" size={16} color={colors.textMain} />
            </Pressable>
          </View>
          
          <ScrollView className="flex-1 px-4 py-4">
            <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest text-typography-muted">Navigation</Text>
            {visibleShortcuts.map((s) => {
              const isActive = matchesHref(pathname, params, s.href);
              const badge = s.id === 'filehub' ? fileHubBadge : 0;
              return (
                <Link key={s.id} href={s.href as any} asChild onPress={handleClose}>
                  <Pressable className={`flex-row items-center p-4 rounded-xl mb-2 border ${isActive ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-card border-surface-border'}`}>
                    <FontAwesome name={s.icon} size={18} color={isActive ? colors.primary : colors.textMain} className="w-8" />
                    <Text className={`font-bold ml-2 flex-1 ${isActive ? 'text-brand-primary' : 'text-typography-main'}`}>{s.label}</Text>
                    {badge > 0 && (
                      <View className="min-w-5 h-5 rounded-full bg-red-500 items-center justify-center px-1">
                        <Text className="text-[10px] font-black text-white leading-none">{badge > 99 ? '99+' : badge}</Text>
                      </View>
                    )}
                  </Pressable>
                </Link>
              );
            })}

            {isPlatformAdmin && (
              <View className="mt-4">
                <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest text-brand-primary/50">System</Text>
                <Link href="/platform-admin" asChild onPress={handleClose}>
                  <Pressable className={`flex-row items-center p-4 rounded-xl mb-2 border ${pathname.startsWith('/platform-admin') ? 'bg-brand-primary-dim border-brand-primary/30' : 'bg-brand-primary/5 border-brand-primary/10'}`}>
                    <FontAwesome name="shield" size={18} color={pathname.startsWith('/platform-admin') ? colors.primary : colors.textDim} className="w-8" />
                    <Text className={`font-bold ml-2 ${pathname.startsWith('/platform-admin') ? 'text-brand-primary' : 'text-brand-primary/70'}`}>Control Plane</Text>
                  </Pressable>
                </Link>
              </View>
            )}

            {pipelines.length > 0 && (
              <View className="mt-4">
                <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest text-typography-muted">Pipelines</Text>
                {pipelines.map((p, i) => {
                  const icons = ['bolt', 'sitemap', 'random', 'sliders', 'exchange', 'cogs'];
                  const icon = icons[i % icons.length] as IconName;
                  const isActive = pathname === '/tasks' && String(params.pipelineId || '') === p.id;
                  return (
                    <Link key={p.id} href={`/tasks?pipelineId=${p.id}`} asChild onPress={handleClose}>
                      <Pressable className={`flex-row items-center p-4 rounded-xl mb-2 border ${isActive ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-card border-surface-border'}`}>
                        <FontAwesome name={icon} size={18} color={isActive ? colors.primary : colors.textMain} className="w-8" />
                        <Text className={`font-bold ml-2 ${isActive ? 'text-brand-primary' : 'text-typography-main'}`}>{p.name}</Text>
                      </Pressable>
                    </Link>
                  );
                })}
              </View>
            )}

            <View className="mt-4 mb-10">
              <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest text-typography-muted">Preferences</Text>
              <Pressable 
                onPress={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="flex-row items-center p-4 rounded-xl mb-2 border bg-surface-card border-surface-border"
              >
                <FontAwesome name={theme === 'dark' ? 'sun-o' : 'moon-o'} size={18} color={colors.textMain} className="w-8" />
                <Text className="font-bold ml-2 text-typography-main">Toggle Theme</Text>
              </Pressable>

              <Link href="/modal" asChild onPress={handleClose}>
                <Pressable className="flex-row items-center p-4 rounded-xl mb-2 border bg-surface-card border-surface-border">
                  <FontAwesome name="bell" size={18} color={colors.textMain} className="w-8" />
                  <Text className="font-bold ml-2 text-typography-main">Notifications</Text>
                  {unreadCount > 0 && (
                    <View className="ml-auto min-w-5 h-5 rounded-full bg-state-danger items-center justify-center px-1">
                      <Text className="text-[10px] font-black text-white leading-none">
                        +{unreadCount > 99 ? '99' : unreadCount}
                      </Text>
                    </View>
                  )}
                </Pressable>
              </Link>
              
              <Link href="/profile" asChild onPress={handleClose}>
                <Pressable className="flex-row items-center p-4 rounded-xl border bg-surface-card border-surface-border">
                  <FontAwesome name="user" size={18} color={colors.textMain} className="w-8" />
                  <Text className="font-bold ml-2 text-typography-main">Profile</Text>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
