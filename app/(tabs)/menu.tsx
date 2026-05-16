import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, useLocalSearchParams, usePathname } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';

type IconName = React.ComponentProps<typeof FontAwesome>['name'];

type Shortcut = {
  id: string;
  permissionKey: string;
  fallbackPermissionKey?: string;
  icon: IconName;
  label: string;
  href: string;
};

const SHORTCUTS: Shortcut[] = [
  { id: 'radar', permissionKey: 'report.view', icon: 'bullseye', label: 'Intelligence', href: '/intelligence' },
  { id: 'targets', permissionKey: 'target.view', icon: 'crosshairs', label: 'Targets', href: '/intelligence/targets' },
  { id: 'archives', permissionKey: 'archive.view', icon: 'archive', label: 'Archives', href: '/intelligence/archives' },
  { id: 'analytics', permissionKey: 'report.view', icon: 'bar-chart', label: 'Analytics', href: '/analytics' },
  { id: 'team', permissionKey: 'user.view_all', fallbackPermissionKey: 'role.manage', icon: 'users', label: 'Corporate', href: '/people?section=teams' },
];

const displayNameFromSession = (session: any) => {
  return session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name || session?.user?.email || 'Profile';
};

const initials = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
};

export default function MenuScreen() {
  const { theme, setTheme } = useTheme();
  const colors = useThemeColors();
  const { session, user, hasPermission } = useAuth();
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const isPlatformAdmin = ['adamsamir2005@gmail.com', 'adam.samir@trustedgellc.com', 'adamsamir@hotmail.com'].includes(user?.email || '');

  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('Profile');

  const visibleShortcuts = useMemo(
    () =>
      SHORTCUTS.filter(
        (s) => hasPermission(s.permissionKey) || (!!s.fallbackPermissionKey && hasPermission(s.fallbackPermissionKey))
      ),
    [hasPermission]
  );

  const profileLabel = useMemo(() => profileName || displayNameFromSession(session), [profileName, session]);

  useEffect(() => {
    const fetchPipelines = async () => {
      const { data } = await supabase.from('pipelines').select('id, name').is('deleted_at', null).order('name');
      if (data) setPipelines(data);
    };
    fetchPipelines();
  }, []);

  useEffect(() => {
    const fetchProfile = async () => {
      const fallbackName = displayNameFromSession(session);
      setProfileName(fallbackName);
      setProfileAvatarUrl(session?.user?.user_metadata?.avatar_url || null);

      if (!session?.user?.id) return;

      const { data, error } = await supabase
        .from('users')
        .select('avatar_url, full_name, display_name')
        .eq('id', session.user.id)
        .maybeSingle();
      if (error) return;

      setProfileAvatarUrl(data?.avatar_url || session?.user?.user_metadata?.avatar_url || null);
      setProfileName(data?.display_name || data?.full_name || fallbackName);
    };

    fetchProfile();
  }, [session]);

  const matchesHref = (href: string) => {
    if (href.includes('?')) {
      const [basePath, queryString] = href.split('?');
      const queryPairs = queryString.split('&').map((pair) => pair.split('='));
      return pathname === basePath && queryPairs.every(([k, v]) => String(params[k]) === String(v));
    }
    return pathname.startsWith(href);
  };

  return (
    <View className="flex-1 bg-surface-background">
      <ScrollView className="flex-1 px-4 pt-4">
        
        {/* Profile Card */}
        <Link href="/profile" asChild>
          <Pressable className="flex-row items-center p-4 rounded-2xl border bg-surface-card border-surface-border mb-6">
            <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-brand-primary/20 bg-brand-primary/5">
              {profileAvatarUrl ? (
                <Image source={{ uri: profileAvatarUrl }} className="h-full w-full" />
              ) : (
                <Text className="text-lg font-black text-brand-primary">{initials(profileLabel)}</Text>
              )}
            </View>
            <View className="ml-3 flex-1">
              <Text className="font-bold text-lg text-typography-main" numberOfLines={1}>{profileLabel}</Text>
              <Text className="text-xs font-bold uppercase tracking-widest text-brand-primary/60">View Profile</Text>
            </View>
            <FontAwesome name="chevron-right" size={14} color={colors.textDim} />
          </Pressable>
        </Link>

        {/* Navigation Section */}
        <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest text-typography-muted">Navigation</Text>
        <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden mb-6">
          {visibleShortcuts.map((s, idx) => {
            const isActive = matchesHref(s.href);
            return (
              <Link key={s.id} href={s.href as any} asChild>
                <Pressable className={`flex-row items-center p-4 ${idx !== visibleShortcuts.length - 1 ? 'border-b border-surface-border/50' : ''} ${isActive ? 'bg-brand-primary/10' : ''}`}>
                  <View className="w-8 items-center">
                    <FontAwesome name={s.icon} size={18} color={isActive ? colors.primary : colors.textMain} />
                  </View>
                  <Text className={`font-bold ml-2 ${isActive ? 'text-brand-primary' : 'text-typography-main'}`}>{s.label}</Text>
                </Pressable>
              </Link>
            );
          })}
        </View>

        {/* System Section */}
        {isPlatformAdmin && (
          <>
            <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest text-brand-primary/50">System</Text>
            <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden mb-6">
              <Link href="/platform-admin" asChild>
                <Pressable className={`flex-row items-center p-4 ${pathname.startsWith('/platform-admin') ? 'bg-brand-primary-dim' : ''}`}>
                  <View className="w-8 items-center">
                    <FontAwesome name="shield" size={18} color={pathname.startsWith('/platform-admin') ? colors.primary : colors.primary} />
                  </View>
                  <Text className={`font-bold ml-2 ${pathname.startsWith('/platform-admin') ? 'text-brand-primary' : 'text-typography-main'}`}>Control Plane</Text>
                </Pressable>
              </Link>
              <Link href="/admin/pipelines" asChild>
                <Pressable className={`flex-row items-center p-4 border-t border-surface-border/50 ${pathname.startsWith('/admin/pipelines') ? 'bg-brand-primary-dim' : ''}`}>
                  <View className="w-8 items-center">
                    <FontAwesome name="gear" size={18} color={pathname.startsWith('/admin/pipelines') ? colors.primary : colors.primary} />
                  </View>
                  <Text className={`font-bold ml-2 ${pathname.startsWith('/admin/pipelines') ? 'text-brand-primary' : 'text-typography-main'}`}>Pipelines Admin</Text>
                </Pressable>
              </Link>
            </View>
          </>
        )}

        {/* Pipelines Section */}
        {pipelines.length > 0 && (
          <>
            <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest text-typography-muted">Pipelines</Text>
            <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden mb-6">
              {pipelines.map((p, i) => {
                const icons = ['bolt', 'sitemap', 'random', 'sliders', 'exchange', 'cogs'];
                const icon = icons[i % icons.length] as IconName;
                const isActive = pathname === '/tasks' && String(params.pipelineId || '') === p.id;
                return (
                  <Link key={p.id} href={`/tasks?pipelineId=${p.id}`} asChild>
                    <Pressable className={`flex-row items-center p-4 ${i !== pipelines.length - 1 ? 'border-b border-surface-border/50' : ''} ${isActive ? 'bg-brand-primary/10' : ''}`}>
                      <View className="w-8 items-center">
                        <FontAwesome name={icon} size={18} color={isActive ? colors.primary : colors.textMain} />
                      </View>
                      <Text className={`font-bold ml-2 ${isActive ? 'text-brand-primary' : 'text-typography-main'}`}>{p.name}</Text>
                    </Pressable>
                  </Link>
                );
              })}
            </View>
          </>
        )}

        {/* Preferences Section */}
        <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest text-typography-muted">Preferences</Text>
        <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden mb-10">
          <Pressable 
            onPress={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex-row items-center p-4 border-b border-surface-border/50"
          >
            <View className="w-8 items-center">
              <FontAwesome name={theme === 'dark' ? 'sun-o' : 'moon-o'} size={18} color={colors.textMain} />
            </View>
            <Text className="font-bold ml-2 text-typography-main">Toggle Theme ({theme === 'dark' ? 'Dark' : 'Light'})</Text>
          </Pressable>

          <Link href="/modal" asChild>
            <Pressable className="flex-row items-center p-4">
              <View className="w-8 items-center">
                <FontAwesome name="bell" size={18} color={colors.textMain} />
              </View>
              <Text className="font-bold ml-2 text-typography-main">Notifications</Text>
            </Pressable>
          </Link>
        </View>

      </ScrollView>
    </View>
  );
}
