import { useNotifications } from '@/contexts/NotificationsContext';
import { useDropdownTrigger } from '@/hooks/useDropdownTrigger';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useUpcomingTasks } from '@/hooks/useUpcomingTasks';
import FontAwesome from '@expo/vector-icons/FontAwesome';
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
  onRequestPalette,
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
  onRequestPalette?: (seed: string) => void;
}) {
  const colors = useThemeColors();
  const { notifications } = useNotifications();
  const searchInputRef = React.useRef<TextInput>(null);
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

  // Search field is now a pure trigger for the command palette (#341) — focusing
  // or clicking it opens the palette carrying whatever's typed, and the palette
  // owns the actual query. No hover dropdown here anymore.
  const openPalette = () => {
    onRequestPalette?.(topSearch);
    searchInputRef.current?.blur();
  };

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

  return (
      <View className="h-16 flex-row items-center gap-3 border-b border-surface-border bg-surface-background px-5">
        <Pressable
          onPress={openPalette}
          className="h-9 flex-1 max-w-md flex-row items-center gap-2 rounded-xl bg-surface-card px-3"
        >
          <FontAwesome name="search" size={12} color={colors.textDim} />
          <TextInput
            ref={searchInputRef}
            value={topSearch}
            onChangeText={(t) => { setTopSearch(t); onRequestPalette?.(t); }}
            onFocus={openPalette}
            returnKeyType="search"
            placeholder="Search projects, tasks, files…"
            placeholderTextColor={colors.textDim}
            className="flex-1 text-sm text-typography-main"
            style={{ paddingVertical: 0 }}
          />
        </Pressable>

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
