import React, { useEffect, useMemo, useRef, useState } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, useLocalSearchParams, usePathname } from 'expo-router';
import { Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { cssInterop } from 'react-native-css-interop';

import { useAuth } from '@/contexts/AuthContext';
import { DensityType, RoundnessType, ThemeType, useTheme } from '@/contexts/ThemeContext';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
});

type IconName = React.ComponentProps<typeof FontAwesome>['name'];

type Shortcut = {
  id: string;
  permissionKey: string;
  icon: IconName;
  label: string;
  href: string;
};

const THEME_OPTIONS: { id: ThemeType; label: string; icon: IconName }[] = [
  { id: 'indigo', label: 'Indigo Night', icon: 'moon-o' },
  { id: 'emerald', label: 'Emerald Matrix', icon: 'leaf' },
  { id: 'amber', label: 'Amber Signal', icon: 'sun-o' },
  { id: 'amethyst', label: 'Amethyst Grid', icon: 'diamond' },
];

const PIPELINE_ICONS: IconName[] = ['bolt', 'sitemap', 'random', 'sliders', 'exchange', 'cogs'];

const SHORTCUTS: Shortcut[] = [
  { id: 'dashboard', permissionKey: 'dashboard', icon: 'th-large', label: 'Dashboard', href: '/' },
  { id: 'tasks', permissionKey: 'task.view_all', icon: 'check-square-o', label: 'Tasks', href: '/tasks' },
  { id: 'projects', permissionKey: 'project.edit', icon: 'folder-o', label: 'Projects', href: '/projects' },
  { id: 'radar', permissionKey: 'report.view', icon: 'bullseye', label: 'Radar', href: '/intelligence?section=radar' },
  { id: 'targets', permissionKey: 'target.view', icon: 'crosshairs', label: 'Targets', href: '/intelligence?section=targets' },
  { id: 'reports', permissionKey: 'report.view', icon: 'file-text-o', label: 'Reports', href: '/intelligence?section=archives' },
  { id: 'members', permissionKey: 'user.view_all', icon: 'users', label: 'Members', href: '/people' },
  { id: 'teams', permissionKey: 'role.manage', icon: 'group', label: 'Teams', href: '/admin/roles?tab=teams' },
  { id: 'pipelines-admin', permissionKey: 'pipeline.edit', icon: 'gear', label: 'Pipelines', href: '/admin/pipelines' },
  { id: 'benchmark', permissionKey: 'role.manage', icon: 'balance-scale', label: 'Benchmark', href: '/admin/comparison' },
  { id: 'analytics', permissionKey: 'report.view', icon: 'line-chart', label: 'Analytics', href: '/admin/ReportGenerator' },
];

const matchesHref = (pathname: string, params: Record<string, any>, href: string) => {
  if (href.includes('?')) {
    const [basePath, queryString] = href.split('?');
    const queryPairs = queryString.split('&').map((pair) => pair.split('='));
    return pathname === basePath && queryPairs.every(([k, v]) => String(params[k]) === String(v));
  }
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
};

const displayNameFromSession = (session: any) => {
  return session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name || session?.user?.email || 'Profile';
};

const initials = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
};

const ThemePopover = ({
  visible,
  onClose,
  sidebarExpanded,
}: {
  visible: boolean;
  onClose: () => void;
  sidebarExpanded: boolean;
}) => {
  const { theme, setTheme, density, setDensity, roundness, setRoundness } = useTheme();

  if (!visible) return null;

  return (
    <>
      <Pressable onPress={onClose} className="absolute inset-0 z-40 bg-surface-background/60" />
      <View
        className="absolute bottom-6 z-50 w-80 rounded-2xl border border-surface-border bg-surface-card/95 p-5 premium-shadow glass-card transition-all duration-300"
        style={{
          left: sidebarExpanded ? 270 : 94,
        }}
      >
        <View className="mb-5 flex-row items-center justify-between border-b border-surface-border pb-4">
          <View>
            <Text className="text-[10px] font-black uppercase tracking-[0.3em] text-typography-dim">Workspace Controls</Text>
            <Text className="mt-1 text-sm font-black uppercase tracking-widest text-typography-main">Display & Theme</Text>
          </View>
          <Pressable
            onPress={onClose}
            className="h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-background hover:bg-surface-overlay active:scale-95 transition-transform"
          >
            <FontAwesome name="times" size={14} className="text-brand-accent/50" />
          </Pressable>
        </View>

        <View className="gap-2">
          {THEME_OPTIONS.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => setTheme(option.id)}
              className={`h-12 flex-row items-center rounded-xl border px-4 transition-all ${theme === option.id
                ? 'border-brand-primary bg-brand-primary/10'
                : 'border-surface-border bg-surface-background/50 hover:bg-surface-overlay'
                }`}
            >
              <View className={`h-8 w-8 items-center justify-center rounded-lg ${theme === option.id ? 'bg-brand-primary/20' : 'bg-surface-overlay'}`}>
                <FontAwesome name={option.icon} size={14} className={theme === option.id ? 'text-brand-accent' : 'text-brand-accent/50'} />
              </View>
              <Text className={`ml-3 text-xs font-bold ${theme === option.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{option.label}</Text>
              {theme === option.id && (
                <View className="ml-auto">
                  <FontAwesome name="check-circle" size={14} className="text-brand-accent" />
                </View>
              )}
            </Pressable>
          ))}
        </View>

        <View className="mt-5 gap-5">
          <View>
            <Text className="mb-3 text-[10px] font-black uppercase tracking-widest text-typography-dim">Interface Density</Text>
            <View className="flex-row gap-1 rounded-xl border border-surface-border bg-surface-background/50 p-1">
              {(['compact', 'normal', 'comfort'] as DensityType[]).map((d) => (
                <Pressable
                  key={d}
                  onPress={() => setDensity(d)}
                  className={`h-10 flex-1 items-center justify-center rounded-lg transition-all ${density === d ? 'bg-brand-primary shadow-sm' : 'hover:bg-surface-overlay'
                    }`}
                >
                  <Text className={`text-[10px] font-bold capitalize ${density === d ? 'text-typography-main' : 'text-typography-muted'}`}>{d}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View>
            <Text className="mb-3 text-[10px] font-black uppercase tracking-widest text-typography-dim">Corner Style</Text>
            <View className="flex-row gap-1 rounded-xl border border-surface-border bg-surface-background/50 p-1">
              {(['sharp', 'normal', 'soft'] as RoundnessType[]).map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRoundness(r)}
                  className={`h-10 flex-1 items-center justify-center rounded-lg transition-all ${roundness === r ? 'bg-brand-primary shadow-sm' : 'hover:bg-surface-overlay'
                    }`}
                >
                  <Text className={`text-[10px] font-bold capitalize ${roundness === r ? 'text-typography-main' : 'text-typography-muted'}`}>{r}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </View>
    </>
  );
};

const SidebarItem = ({
  icon,
  label,
  href,
  isActive,
  collapsed,
}: {
  icon: IconName;
  label: string;
  href: string;
  isActive: boolean;
  collapsed: boolean;
}) => (
  <Link href={href as any} asChild>
    <Pressable
      className={`group relative mb-2 min-h-11 flex-row items-center overflow-hidden rounded-xl border p-3 ${isActive ? 'border-brand-primary/30 bg-brand-primary-dim' : 'border-transparent hover:bg-surface-card'
        }`}
      accessibilityLabel={label}
    >
      <View className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${isActive ? 'bg-brand-primary' : 'bg-transparent group-hover:bg-surface-border'}`} />
      <View className={`${collapsed ? 'w-full' : 'w-8'} items-center`}>
        <FontAwesome name={icon} size={18} className={isActive ? 'text-brand-accent' : 'text-brand-accent/40'} />
      </View>
      {!collapsed && (
        <Text
          className={`ml-2 font-bold ${isActive ? 'text-brand-primary' : 'text-typography-muted'} whitespace-nowrap`}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
      {isActive && !collapsed && <View className="ml-auto h-2 w-2 rounded-full bg-brand-primary" />}
    </Pressable>
  </Link>
);

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const { session, hasPermission } = useAuth();

  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (Platform.OS === 'web') {
      try { return localStorage.getItem('sidebar_collapsed') === 'true'; } catch { }
    }
    return false;
  });
  const [isHovered, setIsHovered] = useState(false);
  const [showThemePopover, setShowThemePopover] = useState(false);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('Profile');

  const isExpanded = isHovered || !isCollapsed;
  const sidebarRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = sidebarRef.current;
    if (!el) return;
    const domNode = el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
    if (!domNode) return;
    const onEnter = () => setIsHovered(true);
    const onLeave = () => setIsHovered(false);
    domNode.addEventListener('mouseenter', onEnter);
    domNode.addEventListener('mouseleave', onLeave);
    return () => {
      domNode.removeEventListener('mouseenter', onEnter);
      domNode.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const visibleShortcuts = useMemo(
    () => SHORTCUTS.filter((s) => s.id === 'dashboard' || hasPermission(s.permissionKey)),
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

  const toggleCollapse = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    setShowThemePopover(false);
    if (Platform.OS === 'web') localStorage.setItem('sidebar_collapsed', String(next));
  };

  return (
    <View className="flex-1 flex-row bg-surface-background w-full h-full overflow-hidden">
      <View
        ref={sidebarRef}
        className={`${isExpanded ? 'w-64' : 'w-20'} relative h-full z-30 transition-[width] duration-300 ease-in-out`}
      >
        <View className="absolute inset-0 z-40">
          <View
            className={`h-full border-r border-surface-border bg-surface-background w-full overflow-hidden z-20 ${isCollapsed && isExpanded ? 'absolute left-0 top-0' : ''
              }`}
          >
            <View className="flex-1 p-4">
              <View className="mb-6 mt-2 flex-row items-center justify-between px-1">
                {isExpanded && (
                  <View className="flex-row items-center">
                    <View className="mr-3 h-10 w-1.5 rounded-full bg-brand-primary" />
                    <View>
                      <Text className="text-typography-main text-2xl font-black tracking-tighter whitespace-nowrap">TrustFlow</Text>
                      <Text className="text-brand-primary text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">Workspace</Text>
                    </View>
                  </View>
                )}
                <Pressable
                  onPress={toggleCollapse}
                  className={`h-11 items-center justify-center rounded-xl border border-surface-border bg-surface-card hover:bg-surface-overlay ${isExpanded ? 'w-11' : 'w-full'
                    }`}
                >
                  <FontAwesome
                    name={isCollapsed ? 'indent' : 'outdent'}
                    size={16}
                    className="text-brand-accent"
                  />
                </Pressable>
              </View>

              <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                <View className="pb-6">
                  <View className="mb-6">
                    {isExpanded && (
                      <Text className="mb-3 ml-2 text-[10px] font-black uppercase tracking-widest text-typography-muted whitespace-nowrap">
                        Navigation
                      </Text>
                    )}
                    {visibleShortcuts.map((s) => (
                      <SidebarItem
                        key={s.id}
                        icon={s.icon}
                        label={s.label}
                        href={s.href}
                        isActive={matchesHref(pathname, params, s.href)}
                        collapsed={!isExpanded}
                      />
                    ))}
                  </View>

                  {pipelines.length > 0 && (
                    <View className="mt-2">
                      {isExpanded && (
                        <Text className="mb-3 ml-2 text-[10px] font-black uppercase tracking-widest text-typography-muted whitespace-nowrap">
                          Pipelines
                        </Text>
                      )}
                      {pipelines.map((p, index) => (
                        <SidebarItem
                          key={p.id}
                          icon={PIPELINE_ICONS[index % PIPELINE_ICONS.length]}
                          label={p.name}
                          href={`/tasks?pipelineId=${p.id}`}
                          isActive={pathname === '/tasks' && String(params.pipelineId || '') === p.id}
                          collapsed={!isExpanded}
                        />
                      ))}
                    </View>
                  )}
                </View>
              </ScrollView>

              <View className="mt-auto rounded-2xl border border-surface-border bg-surface-overlay/20 p-2">
                <Pressable
                  onPress={() => setShowThemePopover((prev) => !prev)}
                  className={`mb-2 min-h-11 flex-row items-center rounded-xl border border-transparent p-3 hover:bg-surface-card ${isExpanded ? '' : 'justify-center'
                    }`}
                  accessibilityLabel="Theme settings"
                >
                  <View className={`${isExpanded ? 'w-8' : ''} items-center`}>
                    <FontAwesome name="paint-brush" size={18} className="text-brand-accent/60" />
                  </View>
                  {isExpanded && <Text className="ml-2 font-bold text-typography-main">Theme</Text>}
                </Pressable>

                <Link href="/modal" asChild>
                  <Pressable
                    className={`mb-2 min-h-11 flex-row items-center rounded-xl border border-transparent p-3 hover:bg-surface-card ${isExpanded ? '' : 'justify-center'
                      }`}
                  >
                    <View className={`${isExpanded ? 'w-8' : ''} items-center`}>
                      <FontAwesome name="bell" size={18} className="text-brand-accent/80" />
                    </View>
                    {isExpanded && <Text className="ml-2 font-bold text-typography-main">Notifications</Text>}
                  </Pressable>
                </Link>

                <Link href="/profile" asChild>
                  <Pressable
                    className={`min-h-11 flex-row items-center rounded-xl border border-transparent p-3 hover:bg-surface-card ${isExpanded ? '' : 'justify-center'
                      }`}
                  >
                    <View className={`${isExpanded ? 'w-8' : ''} items-center`}>
                      <View className="h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-brand-primary/20 bg-brand-primary/5">
                        {profileAvatarUrl ? (
                          <Image source={{ uri: profileAvatarUrl }} className="h-full w-full" />
                        ) : (
                          <Text className="text-xs font-black text-brand-primary">{initials(profileLabel)}</Text>
                        )}
                      </View>
                    </View>
                    {isExpanded && (
                      <View className="ml-2 flex-1">
                        <Text className="font-bold text-typography-main whitespace-nowrap" numberOfLines={1}>{profileLabel}</Text>
                        <Text className="text-[10px] font-bold uppercase tracking-widest text-brand-primary/60 whitespace-nowrap">Signed in</Text>
                      </View>
                    )}
                  </Pressable>
                </Link>
              </View>
            </View>
          </View>
        </View>
      </View>

      <ThemePopover
        visible={showThemePopover}
        onClose={() => setShowThemePopover(false)}
        sidebarExpanded={isExpanded}
      />

      <View className="flex-1 bg-surface-background">
        {children}
      </View>
    </View>
  );
}
