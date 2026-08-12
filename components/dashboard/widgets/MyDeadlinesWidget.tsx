// `my-deadlines` — what of mine is late, and what lands next.
//
// The data is `useUpcomingTasks()` (hooks/useUpcomingTasks.ts:312) unchanged:
// the same engine behind the desktop topbar's attention ribbon and the native
// Deadlines tab, so all three surfaces agree about what is mine, what is late,
// and how a date is worded. Only the rows below are new.
//
// MUST STAY `singleton: true`. That hook opens a three-table realtime channel
// (tasks + task_assignments + projects), a 60s poll and a focus/AppState
// listener PER MOUNT (:294, :348-373). Two instances would be two channels and
// two polls for one list. `withProjects` is left off — the ribbon draws project
// bars, a task list has no use for them, and it is a whole extra RPC.

import { useRouter } from 'expo-router';
import React from 'react';

import {
  PersonalTaskRow,
  QuietLine,
  SeeAllRow,
  WidgetList,
  WidgetLoadingRows,
  dueSoon,
} from '@/components/dashboard/widgets/personalRows';
import type { WidgetBodyProps } from '@/components/dashboard/widgets/registry';
import { formatRelativeDue, useUpcomingTasks } from '@/hooks/useUpcomingTasks';
import { ROWS_BY_SIZE } from '@/lib/dashboardWidgets';

export default function MyDeadlinesWidget({ instance, size }: WidgetBodyProps) {
  const { tasks, loading } = useUpcomingTasks();
  const router = useRouter();

  // Already ordered late-first by `ribbonTasks` (lib/deadlineStrata.ts:172) —
  // every overdue task, then the nearest ten upcoming. Do not re-sort: that
  // function's docstring explains why taking the nearest N of the combined list
  // looks correct and empties the surface on any real backlog.
  const rows = tasks.slice(0, ROWS_BY_SIZE[size]);
  const lateCount = tasks.filter(t => t.overdue).length;

  if (loading && tasks.length === 0) return <WidgetLoadingRows />;

  if (rows.length === 0) {
    return (
      <WidgetList type={instance.type}>
        <QuietLine text="Nothing of yours has a due date coming up." />
        <SeeAllRow label="Open the calendar" onPress={() => router.push('/deadlines' as any)} />
      </WidgetList>
    );
  }

  // WidgetList, both branches — the footer pin needs a growing parent between
  // it and WidgetShell's body, and it carries the card's category hairline.
  return (
    <WidgetList type={instance.type}>
      {rows.map((task, idx) => (
        <PersonalTaskRow
          key={task.id}
          title={task.title}
          stageColor={task.stageColor}
          // The board it's on, not the stage: on a deadline list "where does
          // this live" is the disambiguator between two similarly-named tasks,
          // and the pill on the right is already carrying the state.
          secondary={[task.pipelineName, task.stageName].filter(Boolean).join(' · ')}
          due={{ label: formatRelativeDue(task.dueDate, task.overdue), overdue: task.overdue, soon: dueSoon(task.dueDate) }}
          size={size}
          isLast={idx === rows.length - 1}
          onPress={() => router.push(`/task/${task.id}` as any)}
          accessibilityLabel={`Open ${task.title}, ${formatRelativeDue(task.dueDate, task.overdue)}`}
        />
      ))}
      {/* The count is the reason to look, so it goes in the link rather than
          being a second badge somewhere in the header. */}
      <SeeAllRow
        label={lateCount > 0 ? `${lateCount} late — open the calendar` : 'Open the calendar'}
        onPress={() => router.push('/deadlines' as any)}
      />
    </WidgetList>
  );
}
