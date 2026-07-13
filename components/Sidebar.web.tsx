import WebMobileNav from '@/components/navigation/WebMobileNav';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useFileHubBadge } from '@/hooks/useFileHubBadge';
import { useNavBarPosition } from '@/hooks/useNavBarPosition';
import { useUnreadNotificationAttention } from '@/hooks/useUnreadNotificationAttention';
import { supabase } from '@/lib/supabase';
import { useLocalSearchParams, usePathname } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import NavRail from './sidebar/NavRail.web';
import { SHORTCUTS } from './sidebar/constants';
import RetractableTopBar from './sidebar/RetractableTopBar.web';
import ThemePopover from './sidebar/ThemePopover';
import { useSidebarProfile } from './sidebar/useSidebarProfile';

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const { session, user, hasPermission, profile } = useAuth();
  const { unreadCount } = useNotifications();
  const isPlatformAdmin = ['adamsamir2005@gmail.com', 'adam.samir@trustedgellc.com', 'adamsamir@hotmail.com'].includes(user?.email || '');
  const { inboxUnread } = useFileHubBadge();
  const { position: navPosition, toggle: toggleNavPosition } = useNavBarPosition();

  useUnreadNotificationAttention(unreadCount);

  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (Platform.OS === 'web') {
      try { return localStorage.getItem('sidebar_collapsed') === 'true'; } catch { }
    }
    return false;
  });
  const [isHovered, setIsHovered] = useState(false);
  const [showThemePopover, setShowThemePopover] = useState(false);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  // ponytail: visual-only stub, wire to a real cross-entity search when needed.
  const [topSearch, setTopSearch] = useState('');
  const [isTopBarCollapsed, setIsTopBarCollapsed] = useState(() => {
    if (Platform.OS === 'web') {
      try { return localStorage.getItem('topbar_collapsed') === 'true'; } catch { }
    }
    return false;
  });

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
    () =>
      SHORTCUTS.filter(
        (s) =>
          s.id === 'dashboard' ||
          s.id === 'tasks' ||
          (profile?.is_owner && (s.id === 'team' || s.id === 'pipelines-admin')) ||
          (s.anyPermissions ? s.anyPermissions.some((p) => hasPermission(p)) : false) ||
          (!!s.permissionKey && hasPermission(s.permissionKey)) ||
          (!!s.fallbackPermissionKey && hasPermission(s.fallbackPermissionKey))
      ),
    [hasPermission, profile?.is_owner]
  );

  const { profileAvatarUrl, profileLabel } = useSidebarProfile(session);

  useEffect(() => {
    const fetchPipelines = async () => {
      const { data } = await supabase.from('pipelines').select('id, name').is('deleted_at', null).order('name');
      if (data) setPipelines(data);
    };
    fetchPipelines();
  }, []);

  const toggleCollapse = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    setShowThemePopover(false);
    if (Platform.OS === 'web') localStorage.setItem('sidebar_collapsed', String(next));
  };

  const toggleTopBarCollapse = () => {
    const next = !isTopBarCollapsed;
    setIsTopBarCollapsed(next);
    if (Platform.OS === 'web') localStorage.setItem('topbar_collapsed', String(next));
  };

  if (isMobile) {
    // Floating nav bar is an absolute overlay, so content needs matching
    // padding on whichever edge the bar is currently snapped to.
    const navClearance = 76;
    return (
      <View style={{ flex: 1, overflow: 'hidden' }} className="bg-surface-background">
        <View
          style={{
            flex: 1,
            overflow: 'hidden',
            paddingTop: navPosition === 'top' ? navClearance : 0,
            paddingBottom: navPosition === 'bottom' ? navClearance : 0,
          }}
          className="bg-surface-background"
        >
          {children}
        </View>
        <WebMobileNav
          visibleShortcuts={visibleShortcuts}
          pipelines={pipelines}
          isPlatformAdmin={isPlatformAdmin}
          fileHubBadge={inboxUnread}
          position={navPosition}
          onLongPressToggle={toggleNavPosition}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 flex-row bg-surface-background w-full h-full overflow-hidden">
      {/* Layout width follows only the pinned state; hover-expand animates the
          absolute overlay below instead. Animating the layout width on hover
          reflowed the whole content pane (kanban board & co.) every frame. */}
      <NavRail
        sidebarRef={sidebarRef}
        isCollapsed={isCollapsed}
        isExpanded={isExpanded}
        toggleCollapse={toggleCollapse}
        visibleShortcuts={visibleShortcuts}
        pipelines={pipelines}
        isPlatformAdmin={isPlatformAdmin}
        pathname={pathname}
        params={params}
        inboxUnread={inboxUnread}
      />

      <ThemePopover
        visible={showThemePopover}
        onClose={() => setShowThemePopover(false)}
      />

      <View className="flex-1 flex-col bg-surface-background">
        <RetractableTopBar
          collapsed={isTopBarCollapsed}
          onToggle={toggleTopBarCollapse}
          topSearch={topSearch}
          setTopSearch={setTopSearch}
          unreadCount={unreadCount}
          onToggleThemePopover={() => setShowThemePopover((prev) => !prev)}
          profileAvatarUrl={profileAvatarUrl}
          profileLabel={profileLabel}
          visibleShortcuts={visibleShortcuts}
          pipelines={pipelines}
        />

        <View className="flex-1 bg-surface-background">
          {children}
        </View>
      </View>
    </View>
  );
}
