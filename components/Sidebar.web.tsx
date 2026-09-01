import WebMobileNav from '@/components/navigation/WebMobileNav';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useFileHubBadge } from '@/hooks/useFileHubBadge';
import { useNavBarPosition } from '@/hooks/useNavBarPosition';
import { useUnreadNotificationAttention } from '@/hooks/useUnreadNotificationAttention';
import { useIsPlatformAdmin } from '@/components/platform-admin/useControlPlaneData';
import { useAutoCollapseSubNav } from '@/hooks/useAutoCollapseSubNav';
import { usePortfolios } from '@/hooks/usePortfolios';
import { supabase } from '@/lib/supabase';
import { useLocalSearchParams, usePathname } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import NavRail from './sidebar/NavRail.web';
import { SHORTCUTS, shortcutVisible } from './sidebar/constants';
import CommandPalette from './sidebar/search/CommandPalette.web';
import RetractableTopBar from './sidebar/RetractableTopBar.web';
import { useSidebarProfile } from './sidebar/useSidebarProfile';

// Routes whose own sub-sidebar warrants auto-collapsing the main nav rail to
// its icon rail (issue #217). Pathname prefixes/matches, never full hrefs with
// query strings — usePathname() strips the query.
const SUBNAV_ROUTES = ['/intelligence', '/people', '/profile', '/admin/pipelines'];

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const { session, user, hasPermission, profile } = useAuth();
  const { unreadCount } = useNotifications();
  const isPlatformAdmin = useIsPlatformAdmin();
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
  const [autoCollapseSubNav] = useAutoCollapseSubNav();
  // Manual per-page override: the toggle stays live on an auto-collapsed route
  // (see toggleCollapse below) — this is what re-expands the rail there. Cleared
  // on route change so each subnav page starts from the auto-collapsed default.
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  // Same rollup /portfolios itself reads — rpc_portfolios_table already
  // filters through fn_project_accessible, so nothing here needs a second,
  // wider query. `loading` gates PinnedShortcuts's stale-pin check so a pin
  // isn't dropped from view mid-fetch and then flash back in.
  const { rows: portfolios, loading: portfoliosLoading } = usePortfolios();
  const [topSearch, setTopSearch] = useState('');
  const [isTopBarCollapsed, setIsTopBarCollapsed] = useState(() => {
    if (Platform.OS === 'web') {
      try { return localStorage.getItem('topbar_collapsed') === 'true'; } catch { }
    }
    return false;
  });

  // Issue #217: while a subnav page (Intelligence, Corporate, Profile,
  // Pipelines editor) is active, collapse the nav rail to its icon dock by
  // default — the page itself carries a second, content-scoped sidebar, so two
  // full nav columns would read as stacked panels. Hover still docks out the
  // full rail (`isExpanded`/`premium-shadow` keep working); the toggle can
  // manually re-expand for the current visit via `manuallyExpanded`.
  const isSubnavRoute = SUBNAV_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
  const autoCollapseActive = autoCollapseSubNav && isSubnavRoute;
  // On a subnav route the rail is forced to its icon dock unless the user
  // manually re-expands it for this visit (`manuallyExpanded`). Elsewhere the
  // saved `isCollapsed` preference governs as before.
  const effectiveCollapsed = autoCollapseActive ? !manuallyExpanded : isCollapsed;
  const isExpanded = isHovered || !effectiveCollapsed;
  const sidebarRef = useRef<any>(null);

  useEffect(() => {
    setManuallyExpanded(false);
  }, [pathname]);

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
    () => SHORTCUTS.filter((s) => shortcutVisible(s, { hasPermission, isOwner: !!profile?.is_owner, isMobile })),
    [hasPermission, profile?.is_owner, isMobile]
  );

  // Command palette (⌘K / Ctrl+K / Ctrl+F) — web-only additive overlay. Hotkeys
  // live here because the palette can't listen for its own open key while
  // unmounted; it owns arrow/enter/escape nav once open.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const toggle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    // Ctrl+F: capture phase + preventDefault to beat the browser's native find.
    // ⌘F on mac stays native — only Ctrl+F is intercepted.
    const openOnFind = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', toggle);
    window.addEventListener('keydown', openOnFind, true);
    return () => {
      window.removeEventListener('keydown', toggle);
      window.removeEventListener('keydown', openOnFind, true);
    };
  }, []);

  const { profileAvatarUrl, profileLabel } = useSidebarProfile(session);

  useEffect(() => {
    const fetchPipelines = async () => {
      const { data } = await supabase.from('pipelines').select('id, name').is('deleted_at', null).order('name');
      if (data) setPipelines(data);
    };
    fetchPipelines();
  }, []);

  const toggleCollapse = () => {
    if (autoCollapseActive) {
      // On an auto-collapsed subnav route the toggle flips the per-page
      // override instead of the saved preference — leaving the route restores
      // the user's real sidebar state. Persisting to the collapsed pref here
      // would pin a subnav-route default onto every other page.
      setManuallyExpanded((prev) => !prev);
      return;
    }
    const next = !isCollapsed;
    setIsCollapsed(next);
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
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </View>
    );
  }

  return (
    <View className="flex-1 flex-row bg-surface-background w-full h-full overflow-hidden">
      {/* Sidebar width transitions on both pinned and hover-expand, pushing
          the content pane aside. Accepts the reflow cost for correct layout. */}
      <NavRail
        sidebarRef={sidebarRef}
        isCollapsed={effectiveCollapsed}
        isExpanded={isExpanded}
        toggleCollapse={toggleCollapse}
        visibleShortcuts={visibleShortcuts}
        pipelines={pipelines}
        isPlatformAdmin={isPlatformAdmin}
        pathname={pathname}
        params={params}
        inboxUnread={inboxUnread}
      />

      <View className="flex-1 flex-col bg-surface-background">
        <RetractableTopBar
          collapsed={isTopBarCollapsed}
          onToggle={toggleTopBarCollapse}
          topSearch={topSearch}
          setTopSearch={setTopSearch}
          unreadCount={unreadCount}
          profileAvatarUrl={profileAvatarUrl}
          profileLabel={profileLabel}
          visibleShortcuts={visibleShortcuts}
          pipelines={pipelines}
          portfolios={portfolios}
          portfoliosLoading={portfoliosLoading}
        />

        <View className="flex-1 bg-surface-background">
          {children}
        </View>
      </View>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </View>
  );
}
