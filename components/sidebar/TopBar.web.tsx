import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useDropdownTrigger } from '@/hooks/useDropdownTrigger';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useUpcomingTasks } from '@/hooks/useUpcomingTasks';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import CalendarOverlay from '../calendar/CalendarOverlay.web';
import Tooltip from '../common/Tooltip';
import type { Shortcut } from './constants';
import NotificationsDropdown from './notifications/NotificationsDropdown.web';
import PinnedShortcuts from './PinnedShortcuts.web';
import ProfilePill from './ProfilePill.web';
import ThemeButton from './ThemeButton.web';
import SearchDropdown from './search/SearchDropdown.web';
import TimelineDropdown from './timeline/TimelineDropdown.web';
import TimelineStrip from './timeline/TimelineStrip.web';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

/** How long a freshly-arrived notification stays auto-expanded before collapsing. */
const NOTIF_PEEK_MS = 3000;

export default function TopBar({
  topSearch,
  setTopSearch,
  unreadCount,
  profileAvatarUrl,
  profileLabel,
  visibleShortcuts,
  pipelines,
  portfolios,
  portfoliosLoading,
  onPickerOpenChange,
  onSearchFocusChange,
}: {
  topSearch: string;
  setTopSearch: (value: string) => void;
  unreadCount: number;
  profileAvatarUrl: string | null;
  profileLabel: string;
  visibleShortcuts: Shortcut[];
  pipelines: { id: string; name: string }[];
  portfolios: { id: string; name: string }[];
  portfoliosLoading: boolean;
  onPickerOpenChange?: (open: boolean) => void;
  onSearchFocusChange?: (focused: boolean) => void;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { notifications } = useNotifications();
  const canViewArchives = hasPermission('archive.view');
  const [focused, setFocused] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const searchWrapRef = React.useRef<any>(null);
  const blurTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Open the dropdown on hover too (matching the + / theme buttons), not just focus.
  const searchOpen = focused || hovered;
  const { grouped, results, archives, loading, parsed, searchError } = useGlobalSearch(topSearch, {
    enabled: searchOpen,
    includeArchived: includeArchived && canViewArchives,
  });
  const { recent, push: pushRecent, remove: removeRecent, clear: clearRecent } = useRecentSearches();
  const { saved, isSaved, toggle: toggleSaved } = useSavedSearches();
  // The ribbon draws three levels, so it asks for the project half too. The
  // mobile Deadlines screen calls the same hook without it and spends no query.
  const { tasks: upcomingTasks, projects: upcomingProjects } = useUpcomingTasks({ withProjects: true });
  const [timelineOpen, setTimelineOpen] = React.useState(false);
  const timelineCloseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineDropdownRef = React.useRef<HTMLDivElement>(null);
  const timelineStripWrapRef = React.useRef<HTMLDivElement>(null);
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const [calendarOriginRect, setCalendarOriginRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const { open: notifOpen, setClickedOpen: setNotifOpen, toggle: toggleNotif, wrapperRef: notifWrapRef, closeNow: closeNotifRaw } = useDropdownTrigger(150);
  const notifPeekTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const setFocus = (v: boolean) => { setFocused(v); onSearchFocusChange?.(v); };
  // Delay blur so a click inside the dropdown lands before it unmounts.
  const onBlur = () => { blurTimer.current = setTimeout(() => setFocus(false), 150); };
  const onFocus = () => { if (blurTimer.current) clearTimeout(blurTimer.current); setFocus(true); };
  const closeNow = () => { if (blurTimer.current) clearTimeout(blurTimer.current); setFocus(false); };

  // Same hover-open pattern as the search bar above, but simpler: the strip
  // and its dropdown are both raw DOM, so a single plain <div> wrapper with
  // native onMouseEnter/onMouseLeave covers both (no ref + DOM-listener dance
  // needed — see TopBar's search wrapper for that heavier variant).
  const openTimeline = () => { if (timelineCloseTimer.current) clearTimeout(timelineCloseTimer.current); setTimelineOpen(true); };
  const scheduleCloseTimeline = () => { timelineCloseTimer.current = setTimeout(() => setTimelineOpen(false), 150); };
  const closeTimelineNow = () => { if (timelineCloseTimer.current) clearTimeout(timelineCloseTimer.current); setTimelineOpen(false); };
  React.useEffect(() => () => { if (timelineCloseTimer.current) clearTimeout(timelineCloseTimer.current); }, []);

  // Hover-open / click-toggle / outside-click-close all come from
  // useDropdownTrigger (shared with PinnedShortcuts) — this just layers the
  // realtime auto-peek on top via the hook's clickedOpen setter.
  const cancelNotifPeek = () => {
    if (notifPeekTimer.current) { clearTimeout(notifPeekTimer.current); notifPeekTimer.current = null; }
  };
  // Explicit user actions (toggle, footer click, item click) win over a
  // pending peek collapse — cancel it so a stale timer can't force-close a
  // panel the user just reopened themselves.
  const toggleNotifications = () => { cancelNotifPeek(); toggleNotif(); };
  const closeNotifications = () => { cancelNotifPeek(); closeNotifRaw(); };

  // Auto-peek: a realtime INSERT lands at the head of the context list, so a
  // change in the top id is the arrival signal — no extra context state needed.
  // The first fill (undefined -> id) is the initial fetch, not an arrival.
  // Hovering the peeked panel keeps it open for free: `open` is
  // `hovered || clickedOpen`, so this timer flipping clickedOpen back to
  // false while the cursor is still over it doesn't close anything.
  // ponytail: id-diff instead of an event bus; swap if a second consumer needs it.
  const lastTopId = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    const topId = notifications[0]?.id;
    const previous = lastTopId.current;
    lastTopId.current = topId;
    if (!topId || previous === undefined || topId === previous) return;
    if (notifications[0].read_at) return;

    cancelNotifPeek();
    setNotifOpen(true);
    notifPeekTimer.current = setTimeout(() => { notifPeekTimer.current = null; setNotifOpen(false); }, NOTIF_PEEK_MS);
  }, [notifications]);

  React.useEffect(() => cancelNotifPeek, []);

  // Read the dropdown's current on-screen rect so CalendarOverlay's FLIP
  // morph can start from exactly where the click happened.
  const expandCalendar = () => {
    const rect = timelineDropdownRef.current?.getBoundingClientRect();
    if (rect) setCalendarOriginRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    closeTimelineNow();
    setCalendarOpen(true);
  };

  // Clicking the strip itself morphs from the thin bar, not the dropdown —
  // the dropdown may still be mid-fade-in at click time, and the bar is
  // always there to measure.
  const expandCalendarFromStrip = () => {
    const rect = timelineStripWrapRef.current?.getBoundingClientRect();
    if (rect) setCalendarOriginRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    closeTimelineNow();
    setCalendarOpen(true);
  };

  // Hover-open, covering the input row, the 8px gap (bridged below), and the
  // dropdown itself so moving between them doesn't flicker-close it.
  React.useEffect(() => {
    const el = searchWrapRef.current;
    const domNode = el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
    if (!domNode) return;
    const onEnter = () => setHovered(true);
    const onLeave = () => setHovered(false);
    domNode.addEventListener('mouseenter', onEnter);
    domNode.addEventListener('mouseleave', onLeave);
    return () => {
      domNode.removeEventListener('mouseenter', onEnter);
      domNode.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const goToResults = () => {
    const q = topSearch.trim();
    if (!q) return;
    pushRecent(q);
    closeNow();
    router.push(`/search?q=${encodeURIComponent(q)}` as any);
  };

  return (
      <View className="h-16 flex-row items-center gap-3 border-b border-surface-border bg-surface-background px-5">
        <View ref={searchWrapRef} className="h-9 flex-1 max-w-md flex-row items-center gap-2 rounded-xl bg-surface-card px-3" style={{ position: 'relative' }}>
          {/* Transparent bridge over the 8px gap to the dropdown (top: 44) so a
              hover trip between input and dropdown never fires mouseleave. */}
          {searchOpen && <View style={{ position: 'absolute', top: 36, left: 0, right: 0, height: 10 }} />}
          <FontAwesome name="search" size={12} color={colors.textDim} />
          <TextInput
            value={topSearch}
            onChangeText={setTopSearch}
            onFocus={onFocus}
            onBlur={onBlur}
            onSubmitEditing={goToResults}
            returnKeyType="search"
            placeholder="Search projects, tasks, files…"
            placeholderTextColor={colors.textDim}
            className="flex-1 text-sm text-typography-main"
            style={{ paddingVertical: 0 }}
          />
          <SearchDropdown
            visible={searchOpen}
            query={topSearch}
            parsed={parsed}
            grouped={grouped}
            results={results}
            archives={archives}
            loading={loading}
            searchError={searchError}
            recent={recent}
            saved={saved}
            querySaved={isSaved(topSearch)}
            onToggleSave={() => toggleSaved(topSearch)}
            canViewArchives={canViewArchives}
            includeArchived={includeArchived}
            onToggleArchived={() => setIncludeArchived((v) => !v)}
            onPickRecent={(q) => { setTopSearch(q); }}
            onRemoveRecent={removeRecent}
            onClearRecent={clearRecent}
            onSubmit={goToResults}
            onNavigate={() => { pushRecent(topSearch.trim()); closeNow(); }}
          />
        </View>

        <PinnedShortcuts
          visibleShortcuts={visibleShortcuts}
          pipelines={pipelines}
          portfolios={portfolios}
          portfoliosLoading={portfoliosLoading}
          onOpenChange={onPickerOpenChange}
        />

        <View className="flex-1 px-6">
          <div
            ref={timelineStripWrapRef}
            style={{ position: 'relative', width: '100%' }}
            onMouseEnter={openTimeline}
            onMouseLeave={scheduleCloseTimeline}
          >
            <TimelineStrip tasks={upcomingTasks} projects={upcomingProjects} onPress={expandCalendarFromStrip} />
            {/* Transparent bridge over the 12px gap to the dropdown, same trick as
                the search bar's bridge above, so the hover trip never flicker-closes it. */}
            {timelineOpen && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, height: 16 }} />
            )}
            <TimelineDropdown
              visible={timelineOpen}
              tasks={upcomingTasks}
              projects={upcomingProjects}
              onNavigate={closeTimelineNow}
              onExpand={expandCalendar}
              containerRef={timelineDropdownRef}
            />
            <CalendarOverlay
              open={calendarOpen}
              originRect={calendarOriginRect}
              onClose={() => setCalendarOpen(false)}
            />
          </div>
        </View>

        <ThemeButton />

        {/* Hover opens it, click latches it open, same trigger + animated
            card as ThemeButton and PinnedShortcuts' picker. */}
        <View ref={notifWrapRef} style={{ position: 'relative', zIndex: notifOpen ? 100 : undefined }}>
          <Tooltip label="Notifications">
            <Pressable
              onPress={toggleNotifications}
              className="h-9 w-9 items-center justify-center rounded-xl border border-surface-border bg-surface-card hover:bg-surface-overlay"
            >
              <View>
                <FontAwesome name="bell-o" size={14} color={colors.primary} />
                {unreadCount > 0 && (
                  <View className="absolute -top-1.5 -right-1.5 min-w-4 h-4 rounded-full bg-state-danger items-center justify-center px-0.5">
                    <Text className="text-[9px] font-black text-white leading-none">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>
          </Tooltip>
          <NotificationsDropdown visible={notifOpen} onClose={closeNotifications} />
        </View>

        <ProfilePill profileAvatarUrl={profileAvatarUrl} profileLabel={profileLabel} />
      </View>
  );
}
