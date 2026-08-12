// `last-worked-on` — "pick up where you left off".
//
// The tasks this user most recently ran a timer on, newest first, with the one
// they are timing RIGHT NOW called out. Tapping a row opens the task, same as
// recent-activity and active-projects.
//
// WHY THIS ONE SELF-FETCHES (registry.tsx's correctness rule):
// DashboardDataContext already reads `task_work_sessions` (:177) but only for
// `status='active'`, only to COUNT distinct user_ids, and it carries no task
// title — none of which answers "what did I work on yesterday". Widening that
// query would make every dashboard, for every user, pay for rows only this
// widget reads. So this fetches its own, and is a `singleton` for exactly the
// reason pending-time-approvals is: one instance, one query, whatever the
// layout looks like. It takes `refreshKey` from the shared context so
// pull-to-refresh still reaches it.
//
// NO REALTIME. A timer you started is already visible to you the moment the
// dashboard next fetches, and TimerContext owns the live channel for the
// running session. A second postgres_changes subscription per dashboard mount
// buys a few seconds of freshness on a "what did I do earlier" list.
//
// TENANT SCOPE / RLS: `task_work_sessions` ships exactly one SELECT policy —
// `auth.uid() = user_id` (20260430_final_bunker_timer.sql:26). The rows are
// therefore the caller's own by construction; the explicit `.eq('user_id', …)`
// below is defence in depth and a planner hint, not the security boundary. The
// embedded task comes back through `tasks`' own policy, so a session on a task
// this user can no longer see arrives with `task: null` and is dropped.
//
// PATH A (ui-style-guide.md §3): one responsive component. The row is a title
// plus a right-hand time column at every width; `size` drops the secondary
// detail rather than squeezing it. Nothing here is hover-only or pointer-only —
// the start-timer control is a real 44x44 button carrying its own accessible
// name, and its Tooltip only repeats what that name already says.
//
// STARTING A TIMER FROM HERE (user request): the row IS "pick up where you left
// off", so the affordance belongs on it. Three things it does NOT do:
//   - It does not call `rpc_start_work`. `useTimer().startWork` is the app's one
//     start path (TimerContext.tsx:271) and already owns optimistic state, the
//     15s commit window, AsyncStorage crash recovery and the failure revert. The
//     kanban card's own start button (TaskCardActions.tsx:302) calls exactly
//     this; a second path would drift from it silently.
//   - It does not ask "you already have a timer running, switch?". The server
//     permits ONE active session per user and `rpc_start_work` closes the other
//     one itself (20260806_task_claiming.sql). Every existing start button in
//     the app switches without a confirm, so this one does too — it says
//     "Switch the timer to X" instead of "Start", which is the honest label for
//     what will happen, and the toast confirms which task the clock moved to.
//   - It does not appear on the row you are already timing. That row has the
//     live dot, and a start button beside a running clock is a lie.

import { ListRow } from '@/components/common/ListRow';
import Tooltip from '@/components/common/Tooltip';
import { QuietLine, WidgetList, WidgetLoadingRows } from '@/components/dashboard/widgets/personalRows';
import type { WidgetBodyProps } from '@/components/dashboard/widgets/registry';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardData } from '@/contexts/DashboardDataContext';
import { useTimer } from '@/contexts/TimerContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { ROWS_BY_SIZE } from '@/lib/dashboardWidgets';
import { isAuthError, supabase, triggerAuthError } from '@/lib/supabase';
import { formatCompact, formatRelative } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

/**
 * Sessions read, NOT tasks shown. The cap is on the query (registry.tsx's
 * "cap large datasets at the QUERY, not the render path"); the widget then
 * collapses them to one row per task, so a day spent stopping and starting on
 * two tasks is two rows, not twenty. 40 is comfortably more than the 10 rows
 * the largest size can render even for a heavy start/stop day.
 */
const SESSION_FETCH_LIMIT = 40;

/** Largest number of rows any size can render — nothing beyond this is kept. */
const MAX_ROWS = ROWS_BY_SIZE.l;

type WorkedTask = {
  taskId: string;
  title: string;
  /** Pipeline name — the board it lives on. Null when the task has no pipeline. */
  board: string | null;
  /**
   * `last_heartbeat_at`: the ordering key AND what "2h ago" reads from.
   *
   * Deliberately not `started_at` (a session begun this morning and stopped at
   * noon is not "9am work") and not `completed_at` (nullable — it was added
   * after the table shipped). `last_heartbeat_at` is NOT NULL from day one and
   * is the last proof of life on the session, which is precisely the question
   * "when did I last work on this" asks. The orphan-cleanup path in
   * 20260715_timer_duration_trigger.sql anchors its durations to the same
   * column for the same reason.
   */
  lastAt: string;
  /** Seconds across the fetched window — see the ponytail note in the grouper. */
  seconds: number;
  running: boolean;
  /**
   * "This task wants a timer and isn't finished" — the gate on the start button.
   *
   * There is no `tasks.requires_timer`; the flag lives on the STAGE the task is
   * currently sitting in (`pipeline_stages.requires_timer`, added by
   * 20260515_per_stage_timer_and_min_seconds.sql), which is the same field
   * TaskCardActions.tsx:146 reads to decide whether the board shows its own
   * start button. "Not done yet" is that stage not being terminal — the app's
   * one definition of finished, the same `is_terminal` the dashboard's stats
   * and every pipeline surface use. Neither costs a round trip: both come back
   * on the embed the session query already makes.
   */
  canTime: boolean;
};

export default function LastWorkedOnWidget({ instance, size }: WidgetBodyProps) {
  const { refreshKey } = useDashboardData();
  const { user } = useAuth();
  const { activeSession, startWork } = useTimer();
  const { successToast, errorToast } = useToast();
  const c = useThemeColors();
  const router = useRouter();

  /** The task whose start button is mid-flight — disables just that one row. */
  const [starting, setStarting] = useState<string | null>(null);

  // null = the first fetch has not landed. Rendering the invitation copy in
  // that window would tell a user with plenty of history that they have none.
  const [tasks, setTasks] = useState<WorkedTask[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      // ONE query with joins — no per-row task or pipeline lookup.
      const { data, error } = await supabase
        .from('task_work_sessions')
        // The stage embed is two extra columns on the join this query already
        // makes — not a second call. `pipeline_stages` is readable through its
        // own policy, so a stage the caller cannot see arrives null and simply
        // yields no start button, which is the safe default.
        .select('task_id, status, last_heartbeat_at, total_seconds_spent, task:tasks(title, deleted_at, pipelines(name), stage:current_stage_id(requires_timer, is_terminal))')
        .eq('user_id', user.id)
        .order('last_heartbeat_at', { ascending: false })
        .limit(SESSION_FETCH_LIMIT);

      if (cancelled) return;
      if (isAuthError(error)) {
        triggerAuthError();
        return;
      }
      if (error) {
        console.error('[Dashboard] Last worked on fetch error:', error);
        setTasks([]);
        return;
      }

      // Rows arrive newest-first, so the first sighting of a task_id is its most
      // recent session and Map insertion order is already the display order.
      const byTask = new Map<string, WorkedTask>();
      for (const s of (data || []) as any[]) {
        const t = s.task;
        // Dropped rather than shown as "Unknown task": null means the task is
        // gone or no longer visible to this user, and a row you cannot open is
        // not a place to pick work back up. Filtered here rather than with a
        // `!inner` embed so one soft-deleted task cannot change the join shape.
        if (!t || t.deleted_at) continue;

        const seen = byTask.get(s.task_id);
        if (seen) {
          seen.seconds += s.total_seconds_spent ?? 0;
          continue;
        }
        if (byTask.size >= MAX_ROWS) continue;

        byTask.set(s.task_id, {
          taskId: s.task_id,
          title: t.title || 'Untitled task',
          board: t.pipelines?.name ?? null,
          lastAt: s.last_heartbeat_at,
          seconds: s.total_seconds_spent ?? 0,
          running: s.status === 'active',
          canTime: t.stage?.requires_timer === true && t.stage?.is_terminal !== true,
        });
      }
      setTasks([...byTask.values()]);
    })();

    return () => { cancelled = true; };
    // Keyed on the user's ID, not the `user` object — a new session object with
    // the same id must not refetch. Same exemption DashboardDataContext takes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refreshKey]);

  // Skeleton rows, not `null`: at 'm' this card has a 360px floor, so returning
  // nothing paints a header over an empty tier-2 rectangle until the fetch
  // lands. It must not flash the "you have never used the timer" line at
  // someone who has, which is why this is a third state and not an empty list.
  if (tasks === null) return <WidgetLoadingRows />;

  const rows = tasks.slice(0, ROWS_BY_SIZE[size]);

  // A quiet line, not a dashed box — the same shape recent-activity's and
  // active-projects' empty states use, and an invitation rather than a shrug.
  if (rows.length === 0) {
    return <QuietLine text="Start a timer on a task and it will wait for you here." />;
  }

  // The board name is the first thing to go in a 230px cell — the title and
  // when you left off are the whole row there.
  const wide = size !== 's';

  // The denominator for the time bars: the heaviest task ON SCREEN, not a fixed
  // "working day", because there is no such constant here and inventing one
  // would be drawing a scale the data does not have. So the bars answer the one
  // question this list can honestly answer — "which of these ate the most?" —
  // and the figure beside them stays the absolute number.
  const heaviest = Math.max(...rows.map(r => r.seconds), 0);

  const handleStart = async (r: WorkedTask) => {
    const switching = !!activeSession && activeSession.task_id !== r.taskId;
    setStarting(r.taskId);
    try {
      await startWork(r.taskId, r.title);
      successToast(switching ? `The timer moved to “${r.title}”.` : `Timer started on “${r.title}”.`);
    } catch (err: any) {
      // useToast, never Alert.alert — a multi-button Alert is a silent no-op on
      // web. startWork's own deferred commit failure toasts through lib/toast.
      errorToast(err?.message || 'Could not start the timer.');
    } finally {
      setStarting(null);
    }
  };

  return (
    <WidgetList type={instance.type}>
      {rows.map((r, idx) => {
        // TimerContext is authoritative AND optimistic: it holds this user's
        // single active session and flips the moment startWork is called, so
        // the row re-renders into its running state with no refetch and the
        // previously-running row stops claiming the clock in the same frame.
        // `r.running` (from the fetch) only covers the window before that
        // context state has loaded.
        const running = activeSession ? activeSession.task_id === r.taskId : r.running;
        const busy = starting === r.taskId;
        const canStart = r.canTime && !running;
        return (
        <ListRow
          key={r.taskId}
          isLast={idx === rows.length - 1}
          onPress={() => router.push(`/task/${r.taskId}` as any)}
          accessibilityLabel={
            running
              ? `Open ${r.title}, timer running now`
              : `Open ${r.title}, last worked on ${formatRelative(r.lastAt)}`
          }
          // ui-style-guide.md:38 — a one-line row at 's' is shorter than 44px
          // without this, and this is the whole tap target.
          style={{ minHeight: 44 }}
        >
          <View className="flex-1 pr-3">
            <Text className="text-typography-main font-semibold text-xs" numberOfLines={1}>
              {r.title}
            </Text>
            {wide && !!r.board && (
              <Text className="text-typography-dim text-[10px]" numberOfLines={1}>
                {r.board}
              </Text>
            )}
          </View>

          <View className="items-end">
            {running ? (
              // The running/finished split, in the app's existing live-dot
              // vocabulary (DashboardFacts.tsx:55-60) rather than a new badge
              // component — a 6px success dot is the whole treatment there too.
              <View className="flex-row items-center gap-1.5">
                <View className="rounded-full" style={{ width: 6, height: 6, backgroundColor: c.success }} />
                <Text className="text-[10px] font-bold" style={{ color: c.success }}>
                  {wide ? 'Working now' : 'now'}
                </Text>
              </View>
            ) : (
              <Text className="text-typography-dim text-[10px]">{formatRelative(r.lastAt)}</Text>
            )}
            {/* ponytail: this sums only the sessions inside SESSION_FETCH_LIMIT,
                so on a very heavy day it can under-report a task's lifetime
                total. It is labelled "logged", not "total", and the honest
                lifetime figure already exists on the task detail screen
                (rpc_get_task_details' total_time_spent_seconds) — swap to that
                if the number ever needs to be authoritative here. */}
            {wide && r.seconds > 0 && (
              <>
                <Text className="text-typography-dim text-[10px]">{formatCompact(r.seconds)} logged</Text>
                {/* The comparison the figures alone don't make: how this task's
                    time stacks up against the heaviest one on screen. One hue,
                    2px, right-aligned under its own number — a length, not a
                    second colour. Hidden from screen readers because the text
                    directly above it already says the amount. */}
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  className="rounded-full overflow-hidden mt-1"
                  style={{ width: 44, height: 2, backgroundColor: c.border }}
                >
                  <View
                    style={{
                      width: `${heaviest > 0 ? Math.max(6, (r.seconds / heaviest) * 100) : 0}%`,
                      height: '100%',
                      backgroundColor: running ? c.success : c.primary,
                    }}
                  />
                </View>
              </>
            )}
          </View>

          {/* The resume affordance. Icon-only at every size: a 44x44 target with
              a real accessible name costs the row nothing, where a "Start timer"
              label would not survive a 230px cell — and one control that looks
              the same everywhere beats two variants of it. */}
          {canStart && (
            <Tooltip
              label={activeSession ? `Switch the timer to “${r.title}”` : `Start the timer on “${r.title}”`}
              className="ml-2"
            >
              <TouchableOpacity
                // stopPropagation, or the click also runs ListRow's own onPress
                // and navigates away from the dashboard the instant you start a
                // timer. Same guard TaskFileResults.tsx:71 uses for the same
                // reason (a control nested inside a pressable row).
                onPress={(e: any) => { e?.stopPropagation?.(); void handleStart(r); }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy, busy }}
                accessibilityLabel={
                  activeSession ? `Switch the timer to ${r.title}` : `Start the timer on ${r.title}`
                }
                className={`items-center justify-center rounded-xl border border-surface-border hover:bg-surface-overlay transition-colors ${busy ? 'opacity-40' : ''}`}
                style={{ width: 44, height: 44 }}
              >
                <FontAwesome name="play" size={11} color={c.success} />
              </TouchableOpacity>
            </Tooltip>
          )}
        </ListRow>
        );
      })}
    </WidgetList>
  );
}
