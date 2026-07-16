import { useThemeColors } from '@/hooks/useThemeColors';
import type { UpcomingTask } from '@/hooks/useUpcomingTasks';
import React, { useState } from 'react';

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDue(dateStr: string) {
  const d = new Date(dateStr);
  return `due ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

// Slim horizontal strip in the topbar showing the 10 nearest upcoming task
// deadlines as stacked, proportionally-spaced segments (colored by stage).
// Overdue tasks collapse into a single red notch pinned at the left.
// Web-only (raw DOM tree — .web.tsx — so native `title` tooltips just work).
export default function TimelineStrip({
  tasks,
  onHoverChange,
  onPress,
}: {
  tasks: UpcomingTask[];
  onHoverChange?: (hovered: boolean) => void;
  onPress?: () => void;
}) {
  const colors = useThemeColors();
  const [hovered, setHovered] = useState(false);

  if (tasks.length === 0) return null;

  const overdue = tasks.filter((t) => t.overdue);
  const upcoming = tasks.filter((t) => !t.overdue);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const furthestMs = tasks.reduce((max, t) => Math.max(max, new Date(t.dueDate).getTime()), todayMs);
  const span = Math.max(furthestMs - todayMs, DAY_MS);

  let prevMs = todayMs;
  const segments = upcoming.map((t) => {
    const dueMs = new Date(t.dueDate).getTime();
    const grow = Math.max(dueMs - prevMs, 0) / span;
    prevMs = dueMs;
    return { task: t, grow: Math.max(grow, 0.02) };
  });

  const setHover = (v: boolean) => { setHovered(v); onHoverChange?.(v); };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onPress?.()}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        height: hovered ? 8 : 6,
        borderRadius: 9999,
        backgroundColor: colors.card,
        cursor: 'pointer',
        opacity: hovered ? 1 : 0.85,
        transition: 'height 150ms ease, opacity 150ms ease',
        gap: 2,
      }}
    >
      {overdue.length > 0 && (
        <div
          title={`${overdue.length} overdue`}
          style={{
            width: 10,
            flexShrink: 0,
            alignSelf: 'stretch',
            borderRadius: 9999,
            backgroundColor: colors.danger,
          }}
        />
      )}
      {/* "Today" cursor: taller than the track so it reads as a marker, not a segment */}
      <div
        title="Today"
        style={{
          width: 2,
          height: 14,
          flexShrink: 0,
          borderRadius: 9999,
          backgroundColor: colors.primary,
        }}
      />
      {segments.map(({ task, grow }) => (
        <div
          key={task.id}
          title={`${task.title} — ${formatDue(task.dueDate)}`}
          style={{
            flexGrow: grow,
            flexBasis: 0,
            minWidth: 3,
            alignSelf: 'stretch',
            borderRadius: 9999,
            backgroundColor: task.stageColor,
          }}
        />
      ))}
    </div>
  );
}
