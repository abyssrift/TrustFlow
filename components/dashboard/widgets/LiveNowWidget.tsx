// `live-now` — who is working RIGHT NOW, on what, for how long.
//
// PRESENCE, NOT HISTORY. The sibling `last-worked-on` widget answers "what was
// I on" from my own finished sessions; this one is everyone's currently-open
// sessions, mine included, and every row is a timer still running. If the two
// ever converge on the same list, they have collided and one should go — the
// tell is a row here with no live-ticking clock on it.
//
// It also does not replace the `facts` widget's "working now" fact: that is the
// count and a way into LiveSessionsPopup, this is the standing list. They are
// now literally the same array — DashboardDataContext de-duplicates the
// company's live sessions to one row per person and sets `activeSessions` to
// its length — so the number and the list can never differ.
//
// Idle is `lib/sessionPresence`'s rule (90s without a heartbeat) and the clock
// is `useElapsedTime`, both shared with LiveSessionsPopup, so the widget cannot
// disagree with the popup it links into about who has gone quiet.

import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';

import { ListRow } from '@/components/common/ListRow';
import {
  QuietLine,
  SeeAllRow,
  WidgetList,
  WidgetLoadingRows,
} from '@/components/dashboard/widgets/personalRows';
// The app's one avatar face + presence dot, shared with the task-detail
// "who's working now" stack — so a person looks identical on both surfaces and
// the initials fallback can never diverge. Previously copied here by hand.
import { Avatar } from '@/components/task-detail/activeSessionAvatarsCore';
import type { WidgetBodyProps } from '@/components/dashboard/widgets/registry';
import { useDashboardData, type LiveSession } from '@/contexts/DashboardDataContext';
import { useElapsedTime } from '@/hooks/useElapsedTime';
import { IDLE_MS, idleLabel, idleMsOf } from '@/lib/sessionPresence';
import { ROWS_BY_SIZE, type WidgetSize } from '@/lib/dashboardWidgets';

/** Its own component because the ticking clock is a hook, and hooks can't run in a .map(). */
function LiveNowRow({
  session,
  size,
  isLast,
  onPress,
}: {
  session: LiveSession;
  size: WidgetSize;
  isLast: boolean;
  onPress: () => void;
}) {
  const elapsed = useElapsedTime(session.startedAt);
  const idleMs = idleMsOf(session.lastHeartbeatAt);
  const idle = idleMs > IDLE_MS;

  return (
    <ListRow
      isLast={isLast}
      onPress={onPress}
      accessibilityLabel={`Open ${session.taskTitle}, ${session.name} working for ${elapsed}${idle ? ', idle' : ''}`}
      className="gap-3"
    >
      <View className="relative">
        <Avatar user={session} size={28} />
        {/* Deliberately NOT activeSessionAvatarsCore's `StatusDot`: its live
            variant carries the `pulse-animation` class, and global.css's
            reduced-motion block covers `animate-island-pop` only — an
            unstoppable 2s loop on up to ten rows is exactly what a dashboard
            must not do. A static dot, and the ticking clock beside it is the
            live tell. Reinstate the pulse the day that keyframe is gated. */}
        <View
          className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-card ${
            idle ? 'bg-state-warning' : 'bg-state-success'
          }`}
        />
      </View>

      <View className="flex-1 min-w-0">
        <Text className="text-typography-main text-xs font-semibold" numberOfLines={1}>{session.name}</Text>
        {/* At 230px the task title is the first thing to go — who is here and
            for how long is the whole point of a presence row. */}
        {size !== 's' && (
          <Text className="text-typography-dim text-[10px]" numberOfLines={1}>
            {session.taskTitle}{session.pipelineName ? ` · ${session.pipelineName}` : ''}
          </Text>
        )}
        {/* Idle is a word as well as an amber dot: the dot alone is the kind of
            colour-only state ui rules keep telling us not to ship. */}
        {idle && <Text className="text-state-warning text-[10px] font-medium">{idleLabel(idleMs)}</Text>}
      </View>

      <Text
        className={`text-[11px] ${idle ? 'text-typography-dim' : 'text-state-success'}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {elapsed}
      </Text>
    </ListRow>
  );
}

export default function LiveNowWidget({ instance, size }: WidgetBodyProps) {
  // No fetch of its own: the shared context now selects the live sessions AND
  // derives stats.activeSessions from the same array, so this list and the
  // facts widget's "working now" number are guaranteed to agree. Resizing the
  // card only re-slices — there is no query left to re-run.
  const { sessions, loading, openLiveSessions } = useDashboardData();
  const router = useRouter();

  const rows = sessions.slice(0, ROWS_BY_SIZE[size]);

  if (loading && sessions.length === 0) return <WidgetLoadingRows />;

  // Not reported as empty. "Nobody is working" is the answer to the question
  // this widget asks — the same reasoning the facts widget records for keeping
  // "0 working now" visible when every other fact hides at zero.
  if (rows.length === 0) return <QuietLine text="No one is tracking time right now." />;

  // WidgetList grows so SeeAllRow's `mt-auto` has free space to push against —
  // without a grower the footer floats mid-card in a tier-floored cell.
  return (
    <WidgetList type={instance.type}>
      {rows.map((session, idx) => (
        <LiveNowRow
          key={session.id}
          session={session}
          size={size}
          isLast={idx === rows.length - 1}
          onPress={() => router.push(`/task/${session.taskId}` as any)}
        />
      ))}
      {/* Only when there are more: the popup is the full list, and a link to a
          list you can already see whole is noise. */}
      {sessions.length > rows.length && (
        <SeeAllRow label="Everyone working now" onPress={openLiveSessions} />
      )}
    </WidgetList>
  );
}
