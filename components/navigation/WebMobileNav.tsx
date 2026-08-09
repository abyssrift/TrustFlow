import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { NavPosition } from '@/hooks/useNavBarPosition';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useUnreadNotificationAttention } from '@/hooks/useUnreadNotificationAttention';
import { addAlpha } from '@/lib/layout';
import { useTourAction } from '@/lib/tour/TourContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, LayoutAnimation, Modal, Platform, Pressable, ScrollView, Text, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Tooltip from '../common/Tooltip';
import WebMobileNavItem from './WebMobileNavItem';

type IconName = React.ComponentProps<typeof FontAwesome>['name'];

const MAIN_TABS = [
  { id: 'dashboard', icon: 'th-large', label: 'Dashboard', href: '/' },
  { id: 'tasks', icon: 'check-square-o', label: 'Tasks', href: '/tasks' },
  { id: 'filehub', icon: 'folder-open', label: 'File Hub', href: '/filehub' },
] as const;

const matchesHref = (pathname: string, href: string) => {
  if (href.includes('?')) {
    const [basePath] = href.split('?');
    return pathname === basePath;
  }
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
};

export default function WebMobileNav({
  visibleShortcuts,
  pipelines,
  isPlatformAdmin,
  fileHubBadge = 0,
  position,
  onLongPressToggle,
}: {
  visibleShortcuts: any[];
  pipelines: any[];
  isPlatformAdmin: boolean;
  fileHubBadge?: number;
  position: NavPosition;
  onLongPressToggle: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const { theme, setTheme } = useTheme();
  const colors = useThemeColors();
  const { session } = useAuth();
  const { unreadCount } = useNotifications();
  const router = useRouter();

  const insets = useSafeAreaInsets();
  const handleClose = () => setDrawerOpen(false);
  useTourAction('open-mobile-nav', () => setDrawerOpen(true));

  // ponytail: closes the drawer on any route change (including browser/hardware
  // back) so it can't get stuck open over a page it no longer belongs to.
  // Doesn't intercept the first back press to *just* close the drawer before
  // leaving the page — that needs history.pushState bookkeeping, which risks
  // fighting expo-router's own web history handling. Add if the extra back
  // press to fully exit becomes a real complaint.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useUnreadNotificationAttention(unreadCount);

  // Long-press anywhere on the bar snaps it top<->bottom (jiggle-mode style),
  // without navigating. A ref guard swallows the onPress that Pressable still
  // fires on release after a long-press.
  const didLongPress = useRef(false);
  const handleLongPress = () => {
    didLongPress.current = true;
    Vibration.vibrate(10);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onLongPressToggle();
  };
  const guardedPress = (fn: () => void) => () => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    fn();
  };

  const isWeb = Platform.OS === 'web';
  const edgeInset = isWeb ? ('env(safe-area-inset-bottom, 0px)' as any) : insets.bottom;
  const topEdgeInset = isWeb ? ('env(safe-area-inset-top, 0px)' as any) : insets.top;

  const floatingStyle = {
    position: 'absolute' as const,
    left: 16,
    right: 16,
    ...(position === 'bottom'
      ? { bottom: isWeb ? (`calc(12px + ${edgeInset})` as any) : 12 + edgeInset }
      : { top: isWeb ? (`calc(12px + ${topEdgeInset})` as any) : 12 + topEdgeInset }),
    borderRadius: 28,
    borderWidth: 1,
    borderColor: addAlpha(colors.border, 0.6),
    // Lighter top edge reads as a glass rim even where there's nothing
    // underneath to visibly blur (e.g. empty space at the bottom of a screen).
    borderTopColor: isWeb ? 'rgba(255,255,255,0.16)' : addAlpha(colors.border, 0.6),
    backgroundColor: addAlpha(colors.card, isWeb ? 0.55 : 0.92),
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: position === 'bottom' ? 6 : -6 },
    elevation: 8,
  } as any;

  // Liquid glass on web: react-native-css-interop's style pipeline doesn't
  // reliably forward non-RN CSS properties (backdropFilter) passed via the
  // `style` prop, so it's set directly on the DOM node instead — same escape
  // hatch Sidebar.web.tsx uses for hover listeners.
  const navRef = useRef<any>(null);
  useEffect(() => {
    if (!isWeb) return;
    const el = navRef.current;
    const domNode = el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
    if (!domNode) return;
    domNode.style.backdropFilter = 'blur(24px) saturate(2.1)';
    domNode.style.WebkitBackdropFilter = 'blur(24px) saturate(2.1)';
  });

  // Sliding selection pill: all 4 slots are flex-1, so the indicator just
  // springs to activeIndex * slotWidth. Fades out on routes not in the bar.
  const ITEM_COUNT = MAIN_TABS.length + 1;
  const H_PAD = 8; // matches px-2 on the bar
  const [barWidth, setBarWidth] = useState(0);
  const slotWidth = barWidth > 0 ? (barWidth - H_PAD * 2) / ITEM_COUNT : 0;
  const activeIndex = MAIN_TABS.findIndex((t) => matchesHref(pathname, t.href));
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorOpacity = useRef(new Animated.Value(0)).current;

  const hasPositioned = useRef(false);
  useEffect(() => {
    if (slotWidth === 0) return;
    if (activeIndex >= 0) {
      if (!hasPositioned.current) {
        // First layout: place instantly so the pill doesn't slide in from x=0.
        hasPositioned.current = true;
        indicatorX.setValue(activeIndex * slotWidth);
      } else {
        Animated.spring(indicatorX, { toValue: activeIndex * slotWidth, useNativeDriver: false, friction: 9, tension: 90 }).start();
      }
      Animated.timing(indicatorOpacity, { toValue: 1, duration: 150, useNativeDriver: false }).start();
    } else {
      Animated.timing(indicatorOpacity, { toValue: 0, duration: 150, useNativeDriver: false }).start();
    }
  }, [activeIndex, slotWidth, indicatorX, indicatorOpacity]);

  return (
    <>
      <View
        ref={navRef}
        style={floatingStyle}
        className="flex-row items-center justify-around px-2 py-2"
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      >
        {isWeb && (
          // Sheen: a faint top-to-bottom lightening, same cue real glass gives
          // regardless of whether there's visible content behind it to blur.
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '55%', borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: 'rgba(255,255,255,0.05)' }}
          />
        )}
        {slotWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: H_PAD,
              top: 8,
              bottom: 8,
              width: slotWidth,
              borderRadius: 20,
              backgroundColor: addAlpha(colors.primary, 0.14),
              opacity: indicatorOpacity,
              transform: [{ translateX: indicatorX }],
            }}
          />
        )}
        {MAIN_TABS.map((tab) => {
          const isActive = matchesHref(pathname, tab.href);
          return (
            <Pressable
              key={tab.id}
              onPress={guardedPress(() => router.push(tab.href as any))}
              onLongPress={handleLongPress}
              delayLongPress={500}
              className="flex-1 items-center justify-center py-2"
            >
              <FontAwesome name={tab.icon} size={22} color={isActive ? colors.primary : colors.textDim} style={{ marginBottom: 4 }} />
              <Text className={`text-[10px] font-bold ${isActive ? 'text-brand-primary' : 'text-typography-muted'}`}>{tab.label}</Text>
            </Pressable>
          );
        })}

        <Pressable
          onPress={guardedPress(() => setDrawerOpen(true))}
          onLongPress={handleLongPress}
          delayLongPress={500}
          className="flex-1 items-center justify-center py-2"
        >
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
        <View className="flex-1 w-full" style={{ backgroundColor: colors.background }}>
          <View className="h-16 flex-row items-center justify-between px-6" style={{ borderBottomWidth: 1, borderColor: colors.border }}>
            <Text className="text-xl font-black" style={{ color: colors.textMain }}>Menu</Text>
            <Tooltip label="Close">
              <Pressable onPress={handleClose} className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                <FontAwesome name="times" size={16} color={colors.textMain} />
              </Pressable>
            </Tooltip>
          </View>

          <ScrollView className="flex-1 px-4 py-4">
            <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Navigation</Text>
            {visibleShortcuts.map((s) => (
              <WebMobileNavItem
                key={s.id}
                shortcut={s}
                isActive={matchesHref(pathname, s.href)}
                badge={s.id === 'filehub' ? fileHubBadge : 0}
                colors={colors}
                onPress={handleClose}
              />
            ))}

            {isPlatformAdmin && (
              <View className="mt-4">
                <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest" style={{ color: addAlpha(colors.primary, 0.5) }}>System</Text>
                <Link href="/platform-admin" asChild onPress={handleClose}>
                  <Pressable
                    className="flex-row items-center p-4 rounded-xl mb-2 border"
                    style={{
                      backgroundColor: pathname.startsWith('/platform-admin') ? addAlpha(colors.primary, 0.1) : addAlpha(colors.primary, 0.05),
                      borderColor: pathname.startsWith('/platform-admin') ? addAlpha(colors.primary, 0.3) : addAlpha(colors.primary, 0.1),
                    }}
                  >
                    <FontAwesome name="shield" size={18} color={pathname.startsWith('/platform-admin') ? colors.primary : colors.textDim} className="w-8" />
                    <Text className="font-bold ml-2" style={{ color: pathname.startsWith('/platform-admin') ? colors.primary : addAlpha(colors.primary, 0.7) }}>Control Plane</Text>
                  </Pressable>
                </Link>
              </View>
            )}

            {pipelines.length > 0 && (
              <View className="mt-4">
                <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Pipelines</Text>
                {pipelines.map((p, i) => {
                  const icons = ['bolt', 'sitemap', 'random', 'sliders', 'exchange', 'cogs'];
                  const icon = icons[i % icons.length] as IconName;
                  const isActive = pathname === '/tasks' && String(params.pipelineId || '') === p.id;
                  return (
                    <Link key={p.id} href={`/tasks?pipelineId=${p.id}`} asChild onPress={handleClose}>
                      <Pressable
                        className="flex-row items-center p-4 rounded-xl mb-2 border"
                        style={{ backgroundColor: isActive ? addAlpha(colors.primary, 0.1) : colors.card, borderColor: isActive ? addAlpha(colors.primary, 0.3) : colors.border }}
                      >
                        <FontAwesome name={icon} size={18} color={isActive ? colors.primary : colors.textMain} className="w-8" />
                        <Text className="font-bold ml-2" style={{ color: isActive ? colors.primary : colors.textMain }}>{p.name}</Text>
                      </Pressable>
                    </Link>
                  );
                })}
              </View>
            )}

            <View className="mt-4 mb-10">
              <Text className="mb-2 ml-2 text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Preferences</Text>
              <Pressable
                onPress={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="flex-row items-center p-4 rounded-xl mb-2 border"
                style={{ backgroundColor: colors.card, borderColor: colors.border }}
              >
                <FontAwesome name={theme === 'dark' ? 'sun-o' : 'moon-o'} size={18} color={colors.textMain} className="w-8" />
                <Text className="font-bold ml-2" style={{ color: colors.textMain }}>Toggle Theme</Text>
              </Pressable>

              <Link href="/notifications" asChild onPress={handleClose}>
                <Pressable className="flex-row items-center p-4 rounded-xl mb-2 border" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                  <FontAwesome name="bell" size={18} color={colors.textMain} className="w-8" />
                  <Text className="font-bold ml-2" style={{ color: colors.textMain }}>Notifications</Text>
                  {unreadCount > 0 && (
                    <View className="ml-auto min-w-5 h-5 rounded-full items-center justify-center px-1" style={{ backgroundColor: colors.danger }}>
                      <Text className="text-[10px] font-black text-white leading-none">
                        +{unreadCount > 99 ? '99' : unreadCount}
                      </Text>
                    </View>
                  )}
                </Pressable>
              </Link>

              <Link href="/profile" asChild onPress={handleClose}>
                <Pressable className="flex-row items-center p-4 rounded-xl border" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                  <FontAwesome name="user" size={18} color={colors.textMain} className="w-8" />
                  <Text className="font-bold ml-2" style={{ color: colors.textMain }}>Profile</Text>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
