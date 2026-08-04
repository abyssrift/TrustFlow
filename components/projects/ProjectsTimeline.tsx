import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import Tooltip from '@/components/common/Tooltip';
import {
  ClientMark,
  EntityEmptyState,
  EntityGlyph,
  HealthBadge,
} from '@/components/entities/EntityUI';
import { ErrorBanner } from '@/components/projects/ProjectsTable';
import { SkeletonList } from '@/components/Skeleton';
import { useThemeColors } from '@/hooks/useThemeColors';
import { dueColor, fmtDate } from '@/lib/projectPresentation';
import {
  actualSpan,
  axisTicks,
  compareTimelineRows,
  fraction,
  hasProjection,
  isThinProjection,
  msOf,
  overrunDays,
  overrunSpan,
  projectedAt,
  timelineDomain,
  type Domain,
} from '@/lib/projectTimeline';
import { supabase } from '@/lib/supabase';

/**
 * The Timeline tab (Phase 10, #191, plan §16).
 *
 * PATH A (unified responsive), per ui-style-guide.md §3. A Gantt row is a
 * label plus a bar on a shared axis at every width — the thing that has to
 * change between 390px and 1600px is how much room the label gets and how much
 * text fits in it, which is a number, not a different render tree. Splitting
 * into a `.web.tsx` would have duplicated the axis overlay (the one piece with
 * real positioning maths) for no divergence in behaviour. What it does NOT do
 * is become a horizontally-scrolling desktop chart on mobile — the axis always
 * fits the viewport, and the label column shrinks to make room.
 *
 * NO SECOND READER (§16.1). This calls `rpc_projects_table`, the same function
 * the list and the board call, and reads `projected_end` / `projection_confidence`
 * straight off the row. There is no pace maths here and none in
 * lib/projectTimeline.ts — that lives once in `fn_project_projection`. There is
 * no shared fetch hook to reuse: ProjectsTable.tsx and ProjectBoard.tsx each
 * call the RPC inline with different arguments (a paged list vs one call per
 * stage column), so this is the third inline caller of one RPC, not a second
 * definition of anything. Extracting a hook over three dissimilar call shapes
 * was not worth the churn.
 *
 * §16.2, THE RULE THAT MATTERS: a confident wrong date is worse than no date.
 *   'none' -> no projection is drawn at all. The row says "Not enough history".
 *   'low'  -> drawn dashed and translucent, and captioned "rough".
 *   'ok'   -> drawn solid.
 * The gate is `hasProjection()` in lib/projectTimeline.ts, asserted by its
 * check file. Nothing here re-tests the confidence string inline.
 *
 * INLINE STYLES: every bar position is a runtime percentage and every bar
 * colour is per-project or per-state, which static classes cannot express —
 * the same sanctioned exception EntityUI.tsx and Tooltip.tsx document. Every
 * surface, border and text colour still comes from tokens.
 */

// One bounded page, same shape of promise the table makes. The timeline is an
// overview, not a browser — use the List tab to hunt for a specific project.
// ponytail: no search / paging / filters here yet. Add a filter bar if someone
// actually asks to slice the timeline; the honest "first N" note below says
// what is being left out rather than pretending this is everything.
const LIMIT = 60;

const DESKTOP = 768;

type TimelineProjectRow = {
  id: string;
  name: string;
  color: string | null;
  client_name: string | null;
  portfolio_name: string | null;
  stage_name: string | null;
  stage_color: string | null;
  due_date: string | null;
  days_remaining: number | null;
  blocked: boolean;
  blocked_reason: string | null;
  // Phase 10 columns (migration 20260805_projects_table_projection_columns).
  // Optional because an environment that has not run it returns rows without
  // them — the timeline then degrades to due dates only rather than throwing.
  start_date?: string | null;
  projected_end?: string | null;
  projection_confidence?: string | null;
};

export default function ProjectsTimeline({
  onOpenProject,
  refreshKey = 0,
  onCreateProject,
  onBrowseStarters,
}: {
  onOpenProject: (id: string) => void;
  refreshKey?: number;
  onCreateProject?: () => void;
  onBrowseStarters?: () => void;
}) {
  const c = useThemeColors();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP;
  const labelWidth = isDesktop ? 260 : 132;

  const [rows, setRows] = useState<TimelineProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rpcMissing, setRpcMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase.rpc('rpc_projects_table', {
        p_search: null,
        p_stage_id: null,
        p_blocked: null,
        p_limit: LIMIT,
        p_offset: 0,
      });
      if (cancelled) return;
      if (err) {
        setRpcMissing(err.code === 'PGRST202' || /could not find the function|does not exist/i.test(err.message || ''));
        setError(err.message);
        setRows([]);
      } else {
        setRpcMissing(false);
        setRows((data as TimelineProjectRow[]) || []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // `now` is pinned per render pass rather than read inside the row loop, so
  // every bar and the today line agree on when "now" is.
  const nowMs = useMemo(() => Date.now(), [rows]);
  const ordered = useMemo(() => [...rows].sort(compareTimelineRows), [rows]);
  const domain = useMemo(() => timelineDomain(ordered, nowMs), [ordered, nowMs]);
  const ticks = useMemo(() => axisTicks(domain, isDesktop ? 6 : 3), [domain, isDesktop]);
  const todayAt = fraction(nowMs, domain);

  // Load failed and "you have no projects" must not look the same (§14.4.4) —
  // one is a system fault with a cause, the other is a state with a next step.
  if (loading) {
    return (
      <View className="bg-surface-card rounded-2xl border border-surface-border p-5">
        <SkeletonList count={isDesktop ? 7 : 5} itemHeight={40} />
      </View>
    );
  }
  if (error) {
    return (
      <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden">
        <ErrorBanner rpcMissing={rpcMissing} error={error} />
      </View>
    );
  }
  if (ordered.length === 0) {
    return (
      <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden">
        <EntityEmptyState
          kind="project"
          body="A timeline draws one bar per project between its start and its deadline, so you can see what overlaps and what is about to run late. Create a project and it appears here."
          actionLabel={onCreateProject ? 'Create a project' : undefined}
          onAction={onCreateProject}
          secondaryLabel={onBrowseStarters ? 'Start from a template' : undefined}
          onSecondary={onBrowseStarters}
        />
      </View>
    );
  }

  return (
    <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden">
      {/* Axis header — the same [label][track] geometry every row uses, so a
          tick label sits exactly above the date it names. */}
      <View className="flex-row items-end px-4 pt-3 pb-2 border-b border-surface-border">
        <View style={{ width: labelWidth }} className="pr-3">
          <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em]">Project</Text>
        </View>
        <View className="flex-1" style={{ height: 16 }}>
          {ticks.map((t, i) => (
            <Text
              key={t.at}
              className="text-typography-dim text-[9px] font-bold"
              style={{
                position: 'absolute',
                bottom: 0,
                ...(i === 0
                  ? { left: 0 }
                  : i === ticks.length - 1
                    ? { right: 0 }
                    : { left: `${t.at * 100}%`, transform: [{ translateX: -18 }] }),
              }}
            >
              {t.label}
            </Text>
          ))}
        </View>
      </View>

      {/* Rows, with the today line and the tick gridlines drawn once across all
          of them rather than per row — a today line broken between every row
          reads as decoration instead of as "here". */}
      <View style={{ position: 'relative' }}>
        {ordered.map((row, i) => (
          <TimelineRowView
            key={row.id}
            row={row}
            domain={domain}
            labelWidth={labelWidth}
            isDesktop={isDesktop}
            last={i === ordered.length - 1}
            onPress={() => onOpenProject(row.id)}
          />
        ))}

        {/* LAST child, not first: both RN and RNW paint siblings in order, so
            an overlay declared before the rows would sit under a row's hover
            fill and the today line would blink out under the cursor.
            pointerEvents="none" keeps every row clickable through it. */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', paddingHorizontal: 16 }}
        >
          <View style={{ width: labelWidth }} />
          <View className="flex-1" style={{ position: 'relative' }}>
            {ticks.slice(1, -1).map(t => (
              <View
                key={t.at}
                style={{ position: 'absolute', top: 0, bottom: 0, left: `${t.at * 100}%`, width: 1, backgroundColor: c.border + '40' }}
              />
            ))}
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayAt * 100}%`, width: 1.5, backgroundColor: c.primary + 'AA' }} />
          </View>
        </View>
      </View>

      <Legend isDesktop={isDesktop} truncated={rows.length === LIMIT} />
    </View>
  );
}

function TimelineRowView({
  row,
  domain,
  labelWidth,
  isDesktop,
  last,
  onPress,
}: {
  row: TimelineProjectRow;
  domain: Domain;
  labelWidth: number;
  isDesktop: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const c = useThemeColors();
  const blocked = !!row.blocked;
  // A blocked project reads blocked before anything else about it is read:
  // its bar goes danger-toned rather than wearing its own project colour, and
  // it carries the same HealthBadge the list and the board use.
  const hue = blocked ? c.danger : (row.color || c.primary);

  const span = actualSpan(row, domain);
  const dueAt = msOf(row.due_date) != null ? fraction(msOf(row.due_date)!, domain) : null;
  const projAt = projectedAt(row, domain);
  const over = overrunSpan(row, domain);
  const late = overrunDays(row);
  const thin = isThinProjection(row);
  const forecast = hasProjection(row);

  // The one sentence under the name. It is the row's whole story, so it is
  // never blank and never a raw date on its own. Order is by what a human can
  // act on: an overrun first, then a missing deadline (the fixable one), then
  // the forecast, then the honest admission that there isn't one.
  //
  // "Not enough history" is used ONLY when the server actually said 'none'.
  // When the column is absent entirely — an environment without migration
  // 20260805 — the row says "No forecast", because claiming to know why would
  // be inventing a reason.
  const caption =
    late != null && late > 0
      ? `${late}d past its deadline`
      : row.due_date == null
        ? 'No deadline set'
        : forecast
          ? `Forecast ${fmtDate(row.projected_end!)}`
          : row.projection_confidence === 'none'
            ? 'Not enough history'
            : 'No forecast';

  const captionColor = late != null && late > 0 ? c.danger : forecast ? c.textMuted : c.textDim;

  const overrunLabel = late != null && late > 0 ? `${late}d late` : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${row.name}. ${caption}`}
      className={`flex-row items-center px-4 ${last ? '' : 'border-b border-surface-border/50'} hover:bg-surface-overlay/40 transition-colors`}
      style={{ minHeight: 56, paddingVertical: 8 }}
    >
      <View style={{ width: labelWidth }} className="pr-3">
        <View className="flex-row items-center gap-2 min-w-0">
          <EntityGlyph kind="project" size={isDesktop ? 24 : 20} color={row.color} />
          <Text numberOfLines={1} className="text-typography-main font-bold text-xs flex-1">{row.name}</Text>
        </View>
        {isDesktop && (
          <View className="mt-0.5 ml-8">
            <ClientMark name={row.client_name} portfolioName={row.portfolio_name} size={14} />
          </View>
        )}
        {/* Indented under the name on desktop; at 132px the label column has no
            32px to spare, so the caption starts at the edge instead. */}
        <View className={`flex-row items-center gap-1.5 mt-0.5 ${isDesktop ? 'ml-8' : ''}`}>
          {blocked && (
            <HealthBadge blocked blockedReason={row.blocked_reason} daysRemaining={row.days_remaining} size="sm" />
          )}
          <Text numberOfLines={1} className="text-[10px] font-semibold flex-shrink" style={{ color: captionColor }}>
            {caption}
          </Text>
        </View>
      </View>

      <View className="flex-1" style={{ height: 24, justifyContent: 'center' }}>
        {/* Rail */}
        <View style={{ height: 4, borderRadius: 999, backgroundColor: c.border + '55' }} />

        {/* Committed span: start -> due. A fact, so it is the only solid fill. */}
        {span && (
          // Positioning lives on the Tooltip, not the bar: Tooltip wraps its
          // child in a View that takes the child's place in layout, so an
          // `absolute` child would be positioned against the wrapper instead
          // of the track (ux-consistency.md's Tooltip layout gotcha).
          <Tooltip
            label={`${fmtDate(row.start_date!)} → ${fmtDate(row.due_date!)}`}
            style={{
              position: 'absolute',
              left: `${span.left * 100}%`,
              width: `${span.width * 100}%`,
              minWidth: 6,
            }}
          >
            <View
              style={{
                height: 12,
                borderRadius: 6,
                backgroundColor: hue + '3D',
                borderWidth: 1,
                borderColor: hue + 'AA',
              }}
            />
          </Tooltip>
        )}

        {/* Overrun: due -> projected. The single most useful thing on the
            screen, so it is the only place danger fill is used for a span.
            'low' draws it hollow + dashed so a thin forecast can never be
            mistaken for the committed bar next to it (§16.2). */}
        {over && (
          <View
            style={{
              position: 'absolute',
              left: `${over.left * 100}%`,
              width: `${over.width * 100}%`,
              minWidth: 6,
              height: 12,
              borderRadius: 6,
              backgroundColor: thin ? 'transparent' : c.danger + '4D',
              borderWidth: 1,
              borderStyle: thin ? 'dashed' : 'solid',
              borderColor: c.danger + (thin ? '99' : 'CC'),
            }}
          />
        )}

        {/* The committed deadline, always drawn when known — it is the fact the
            forecast is being judged against. */}
        {dueAt != null && (
          <View
            style={{
              position: 'absolute',
              left: `${dueAt * 100}%`,
              marginLeft: -1,
              top: 2,
              bottom: 2,
              width: 2,
              borderRadius: 1,
              backgroundColor: dueColor(row.days_remaining, c),
            }}
          />
        )}

        {/* The forecast landing point. Nothing at all when the server said
            'none' — projectedAt() returns null there. */}
        {projAt != null && (
          <View
            style={{
              position: 'absolute',
              left: `${projAt * 100}%`,
              marginLeft: -3,
              top: 4,
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: thin ? 'transparent' : (late != null && late > 0 ? c.danger : c.success),
              borderWidth: 1,
              borderColor: (late != null && late > 0 ? c.danger : c.success) + (thin ? '99' : 'FF'),
            }}
          />
        )}

        {/* At a glance, in words, not just in pixels. */}
        {overrunLabel && isDesktop && (
          <Text
            className="text-[9px] font-black uppercase tracking-wider"
            style={{
              position: 'absolute',
              left: `${Math.min(over!.left + over!.width, 0.92) * 100}%`,
              marginLeft: 6,
              color: c.danger,
              opacity: thin ? 0.75 : 1,
            }}
          >
            {overrunLabel}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function Legend({ isDesktop, truncated }: { isDesktop: boolean; truncated: boolean }) {
  const c = useThemeColors();
  return (
    <View className="px-4 py-3 border-t border-surface-border gap-2">
      <View className="flex-row items-center flex-wrap gap-x-4 gap-y-2">
        <Key swatch={<View style={{ width: 18, height: 8, borderRadius: 4, backgroundColor: c.primary + '3D', borderWidth: 1, borderColor: c.primary + 'AA' }} />} label="Start to deadline" />
        <Key swatch={<View style={{ width: 18, height: 8, borderRadius: 4, backgroundColor: c.danger + '4D', borderWidth: 1, borderColor: c.danger + 'CC' }} />} label="Forecast overrun" />
        <Key swatch={<View style={{ width: 18, height: 8, borderRadius: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: c.danger + '99' }} />} label="Rough forecast" />
        <Key swatch={<View style={{ width: 2, height: 12, backgroundColor: c.primary + 'AA' }} />} label="Today" />
      </View>
      <Text className="text-typography-dim text-[10px] leading-4">
        {isDesktop
          ? 'A dashed forecast rests on thin history — treat it as a direction, not a date. Projects with too little completed work show no forecast at all.'
          : 'Dashed = rough forecast. No forecast means too little completed work to project from.'}
        {truncated ? ` Showing the first ${LIMIT} projects by deadline — use the List tab to find a specific one.` : ''}
      </Text>
    </View>
  );
}

function Key({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      {swatch}
      <Text className="text-typography-muted text-[10px] font-semibold">{label}</Text>
    </View>
  );
}
