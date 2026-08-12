// `my-work` — every open task assigned to me, dated or not.
//
// The hole this fills: a member with no permissions currently gets `facts`,
// `pipeline-completion` and `recent-activity`, all three of which are company
// aggregates. Nothing on the dashboard was about their own work.
//
// HOW IT DIFFERS FROM `my-deadlines`, which shares this row markup: that widget
// is the URGENT SUBSET — dated work only, ordered by how late it is. This one
// is the whole plate, and the part only it can show is the undated work at the
// bottom, which by definition never appears on a deadline surface. If the two
// ever end up seeded together and read as one list, this is the one to keep and
// that one is the one to drop, because the deadline half is already on the
// topbar strip (web) and the Deadlines tab (native).

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
import { useDashboardData } from '@/contexts/DashboardDataContext';
import { useMyTasks } from '@/hooks/useMyTasks';
import { formatRelativeDue } from '@/hooks/useUpcomingTasks';
import { ROWS_BY_SIZE } from '@/lib/dashboardWidgets';

export default function MyWorkWidget({ instance, size }: WidgetBodyProps) {
  const { refreshKey } = useDashboardData();
  const { tasks, loading } = useMyTasks(refreshKey);
  const router = useRouter();

  // 3 / 6 / 10, the house pattern. The cap is what makes an 's' instance
  // shorter than an 'l' one; the dataset size never reaches the render path.
  const rows = tasks.slice(0, ROWS_BY_SIZE[size]);

  if (loading && tasks.length === 0) return <WidgetLoadingRows />;

  // Deliberately NOT reported as empty (registry's useReportWidgetEmpty), which
  // would hide the card: "nothing is assigned to you" is an answer worth
  // seeing, and the footer below is where you go to change it.
  if (rows.length === 0) {
    return (
      <WidgetList type={instance.type}>
        <QuietLine text="Nothing is assigned to you right now." />
        <SeeAllRow label="Browse the boards" onPress={() => router.push('/tasks' as any)} />
      </WidgetList>
    );
  }

  // WidgetList, both branches: it is the growing parent `mt-auto` on the footer
  // measures against — without one the free space in a tier-floored card sits
  // below the link instead of above it (personalRows.tsx's SeeAllRow note) —
  // and it carries the card's one category hairline.
  return (
    <WidgetList type={instance.type}>
      {rows.map((task, idx) => (
        <PersonalTaskRow
          key={task.id}
          title={task.title}
          stageColor={task.stageColor}
          // Where it is, not when it's due — the due state already has the
          // right-hand column, and "which board is this on" is the question a
          // whole-plate list leaves you with.
          secondary={[task.stageName, task.pipelineName].filter(Boolean).join(' · ')}
          due={task.dueDate
            ? { label: formatRelativeDue(task.dueDate, task.overdue), overdue: task.overdue, soon: dueSoon(task.dueDate) }
            : undefined}
          size={size}
          isLast={idx === rows.length - 1}
          onPress={() => router.push(`/task/${task.id}` as any)}
          accessibilityLabel={`Open ${task.title}${task.overdue ? ', overdue' : ''}`}
        />
      ))}
      <SeeAllRow
        label={tasks.length > rows.length ? `All ${tasks.length} of my tasks` : 'Open my tasks'}
        onPress={() => router.push('/tasks' as any)}
      />
    </WidgetList>
  );
}
