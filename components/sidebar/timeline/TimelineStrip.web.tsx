import { entityColor } from '@/components/entities/EntityUI';
import { useThemeColors } from '@/hooks/useThemeColors';
import type { ProjectDeadline, UpcomingTask } from '@/hooks/useUpcomingTasks';
import {
  overdueProjects,
  projectBars,
  ribbonProjects,
  stripDomain,
  taskSegments,
} from '@/lib/deadlineStrata';
import React, { useState } from 'react';

// The attention ribbon: "is anything on fire, and how soon", in eight pixels of
// topbar. Left to right is time, from now to the furthest thing on it.
//
// Phase 10 (#191) — STRATA. One shared axis, three levels, stacked in nesting
// order, because a portfolio contains projects and a project contains tasks:
//
//     ▁▁▁▁▁▁      ▁▁▁▁▁▁▁▁▁▁     portfolio — the extent of its projects
//      ███   ██████    ███        project   — its committed start -> due span
//     ▏  ▏ ▏   ▏  ▏  ▏    ▏       task      — the stretch of quiet before it lands
//
// Weight carries the hierarchy: the portfolio band is the faintest thing here,
// the project bars are the load-bearing level, the task segments keep the
// saturated stage colours they have always had. Nothing is labelled, nothing is
// counted. This is peripheral vision, not a reading surface — the hover
// dropdown and the fullscreen calendar are where detail belongs.
//
// TWO RULES, both of which the previous attempt at this component broke:
//
//   1. EXACTLY ONE element may exceed the track: the today cursor, which is
//      taller than the bar on purpose so it reads as a moment rather than a
//      duration. Everything else lives inside a capsule with `overflow:
//      hidden`, so a geometry mistake gets clipped instead of shipping as
//      floating squares above and below the bar. It did ship that way once.
//   2. NOTHING IS MEASURED. Every position is a fraction from
//      lib/deadlineStrata.ts turned into a `calc()` percentage, so there is no
//      `onLayout`, no `getBoundingClientRect`, and no re-measure on resize.
//
// The task segments were flex-grown before this change and are percentage-
// positioned now. That is not a refactor for its own sake: under flex a task's
// edge sat wherever the gaps and min-widths left it, not on its due date, so a
// project bar drawn above it at its true fraction would have visibly drifted
// away from the task it lands with. Two strata cannot disagree about where a
// date falls.
//
// Web-only (raw DOM tree — .web.tsx — so native `title` tooltips just work).

/** Resting height, and the hover growth that makes the three strata legible. */
const TRACK_REST = 8;
const TRACK_HOVER = 12;
/** How far the today cursor stands proud of the track, top and bottom. */
const CURSOR_OVERHANG = 4;
const OVERDUE_CAP = 10;
/** Clearance between the today cursor and the start of the axis. */
const CURSOR_GUTTER = 4;

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Aug 26 – Sep 30" for a span, "Sep 30" for a single date. */
function fmtRange(bar: { fromMs: number | null; toMs: number }) {
  return bar.fromMs == null ? fmtDate(bar.toMs) : `${fmtDate(bar.fromMs)} – ${fmtDate(bar.toMs)}`;
}

export default function TimelineStrip({
  tasks,
  projects = [],
  onHoverChange,
  onPress,
}: {
  tasks: UpcomingTask[];
  projects?: ProjectDeadline[];
  onHoverChange?: (hovered: boolean) => void;
  onPress?: () => void;
}) {
  const colors = useThemeColors();
  const [hovered, setHovered] = useState(false);

  if (tasks.length === 0 && projects.length === 0) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const upcomingTasks = tasks.filter((t) => !t.overdue);
  const lateTasks = tasks.filter((t) => t.overdue);
  const liveProjects = ribbonProjects(projects, todayMs);
  const lateProjects = overdueProjects(projects, todayMs);

  const domain = stripDomain(upcomingTasks, liveProjects, todayMs);
  const bars = projectBars(liveProjects, domain);
  const segments = taskSegments(upcomingTasks, domain);

  const trackH = hovered ? TRACK_HOVER : TRACK_REST;
  const hasCap = lateTasks.length > 0 || lateProjects.length > 0;
  // Where fraction 0 sits, in px from the left: past the overdue cap and the
  // today cursor. Mixed px/% is the whole trick — the axis keeps its exact
  // proportions at any container width without anyone measuring the container.
  const axisStart = (hasCap ? OVERDUE_CAP : 0) + CURSOR_GUTTER;
  const axisX = (f: number) => `calc(${axisStart}px + ${f} * (100% - ${axisStart}px))`;
  const axisW = (w: number) => `calc(${w} * (100% - ${axisStart}px))`;

  const setHover = (v: boolean) => { setHovered(v); onHoverChange?.(v); };

  const lateSummary = [
    lateTasks.length > 0 ? `${lateTasks.length} task${lateTasks.length === 1 ? '' : 's'} overdue` : null,
    lateProjects.length > 0 ? `${lateProjects.length} project${lateProjects.length === 1 ? '' : 's'} overdue` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      data-tf-strip
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onPress?.()}
      style={{
        position: 'relative',
        width: '100%',
        height: trackH,
        cursor: 'pointer',
        transition: 'height 150ms ease',
      }}
    >
      {/* The capsule. `overflow: hidden` is load-bearing, not tidiness: it is
          what guarantees a stratum can never paint outside the bar. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 9999,
          overflow: 'hidden',
          // `border`, not `card`: in the light theme card is #ffffff on a
          // #f8fafc topbar, so a card-coloured bed is invisible and the strata
          // read as three hairlines floating in space rather than three bands
          // of one object. The bed is the empty time between deadlines and it
          // has to be visible for the strip to read as a track at all.
          backgroundColor: colors.border,
          opacity: hovered ? 1 : 0.85,
          transition: 'opacity 150ms ease',
        }}
      >
        {/* Everything behind is already late — one notch, whatever level it came
            from. The ribbon says "something is on fire", the dropdown says what. */}
        {hasCap && (
          <div
            title={lateSummary}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: OVERDUE_CAP,
              borderRadius: 9999,
              backgroundColor: colors.danger,
            }}
          />
        )}

        {/* Tasks are the strip. One segment per deadline, full height, exactly
            as before projects existed. */}
        {segments.map((bar) => (
          <div
            key={bar.key}
            title={`${bar.label} — due ${fmtDate(bar.toMs)}`}
            style={{
              position: 'absolute',
              left: axisX(bar.span.left),
              width: axisW(bar.span.width),
              top: 0,
              bottom: 0,
              borderRadius: 9999,
              backgroundColor: bar.color || colors.muted,
            }}
          />
        ))}

        {/* A project is a task-sized event with one distinguishing shape: a
            circle sitting on its due date. Not a bar, not a lane, not a wash.
            The strip answers "is anything landing soon"; which batch it belongs
            to is a question for the dropdown, which already lists it. */}
        {bars.map((bar) => {
          const d = Math.max(trackH - 2, 4);
          return (
            <div
              key={bar.key}
              title={`Project · ${bar.label} — due ${fmtDate(bar.toMs)}`}
              style={{
                position: 'absolute',
                left: `calc(${axisX(bar.span.left + bar.span.width)} - ${d / 2}px)`,
                top: '50%',
                width: d,
                height: d,
                marginTop: -d / 2,
                borderRadius: '50%',
                backgroundColor: entityColor('project', colors, bar.color),
                // Reads as a bead ON the track rather than a hole punched in it,
                // which is what it looked like sitting flush against a segment.
                boxShadow: `0 0 0 1.5px ${colors.card}`,
              }}
            />
          );
        })}
      </div>

      {/* The one permitted escape. Deliberately taller than the track so it
          reads as a moment, not a duration — and deliberately OUTSIDE the
          capsule, because that is the only way anything can exceed it. */}
      <div
        title="Today"
        style={{
          position: 'absolute',
          left: hasCap ? OVERDUE_CAP + 1 : 0,
          top: -CURSOR_OVERHANG,
          width: 2,
          height: trackH + CURSOR_OVERHANG * 2,
          borderRadius: 9999,
          backgroundColor: colors.primary,
          transition: 'height 150ms ease',
        }}
      />
    </div>
  );
}
