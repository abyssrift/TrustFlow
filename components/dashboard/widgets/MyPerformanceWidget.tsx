// `my-performance` — your own throughput over a chosen window.
//
// The data comes from AnalyticsContext's getUserPerformanceSummary
// (AnalyticsContext.tsx:298), NOT from a supabase.rpc call of its own. That
// wrapper dedup-caches on `summary:<user>:<from>:<to>` for five minutes, so two
// instances on the same period are one round trip and a second instance on a
// different period is the legitimate second call — the arrangement
// pipeline-overview already relies on. Never reach past it to the RPC.
//
// PERSONAL ONLY, deliberately. There is no "pick a person" config: that would
// need `user.view_all` and would turn a personal widget into a surveillance one.
// `requiredPermission` is null because this is the viewer's own row.
//
// OVERLAP WITH `facts`: the At-a-glance row shows `pts today` and `active` from
// rpc_get_personal_pulse. This is the RANGED version of the same question. If
// both are on a dashboard, `facts` stays the today-only glance.
//
// WHAT THE RPC ACTUALLY RETURNS: weight_points, active_seconds, completed_tasks,
// failed_tasks, on_time_tasks, estimated_seconds, revision_count. The
// PerformanceSummary interface also declares `on_time_rate` and
// `timer_efficiency`, but no shipped version of the function builds those keys
// (20260506_analytics_engine.sql:107, 20260512_fix_failed_at_column.sql:139) —
// they arrive undefined. The on-time percentage below is therefore derived from
// on_time_tasks / completed_tasks. Do not "restore" it from the type.
//
// NO SPARKLINE, and this is a decision rather than an omission. Every key the
// summary returns is ONE number for the WHOLE window — there is no per-day
// series anywhere in the payload, so a trend line here would have to invent its
// own points or fire a second, bucketed query per instance. The honest visual
// for what this widget actually holds is a share bar on the one figure that has
// a denominator (see `meter` below). Give the RPC a bucketed sibling first if a
// trend is genuinely wanted; do not fake one from a single total.

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import StatTile from '@/components/dashboard/StatTile';
import {
  QuietLine,
  WidgetLoadingRows,
} from '@/components/dashboard/widgets/personalRows';
import type { WidgetBodyProps } from '@/components/dashboard/widgets/registry';
import { useAnalytics } from '@/contexts/AnalyticsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardData } from '@/contexts/DashboardDataContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import type { WidgetSize } from '@/lib/dashboardWidgets';
import { formatCompact } from '@/lib/time';

/**
 * Instance config values are always strings, so the window is one too. The
 * option LABELS live in this type's `configFields` in lib/dashboardWidgets.ts
 * (which may not import react-native) and are surfaced by its `subtitle`; only
 * the value→days mapping is needed here, so there is no second copy of them.
 */
const PERIOD_DAYS: Record<string, number> = { '7': 7, '30': 30, '90': 90 };
const DEFAULT_PERIOD = '30';

/** How many stats each size shows. Fewer stats, not smaller ones. */
const STATS_BY_SIZE: Record<WidgetSize, number> = { s: 1, m: 3, l: 4 };

const isoDay = (d: Date) => d.toISOString().split('T')[0];

export default function MyPerformanceWidget({ instance, size }: WidgetBodyProps) {
  const { user } = useAuth();
  const { getUserPerformanceSummary } = useAnalytics();
  const { refreshKey } = useDashboardData();
  const c = useThemeColors();

  const days = PERIOD_DAYS[instance.config.period] ?? PERIOD_DAYS[DEFAULT_PERIOD];
  const to = isoDay(new Date());
  const from = isoDay(new Date(Date.now() - days * 86400000));

  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setLoading(true);
    // refreshKey is in the deps for the same reason usePipelineOverviewData:117
    // has it: pull-to-refresh re-runs the fetch. It does NOT bust the five-minute
    // dedup cache, deliberately — a refresh that invalidated every analytics key
    // would make one widget re-cost every other one on the screen.
    getUserPerformanceSummary(user.id, from, to)
      .then(data => { if (!cancelled) setSummary((data as unknown as Record<string, number>) ?? null); })
      .catch(err => { if (!cancelled) { console.error('[MyPerformanceWidget]', err); setSummary(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, from, to, refreshKey]);

  if (loading && !summary) return <WidgetLoadingRows rows={1} />;

  const points = Number(summary?.weight_points ?? 0);
  const done = Number(summary?.completed_tasks ?? 0);
  const seconds = Number(summary?.active_seconds ?? 0);
  const onTime = Number(summary?.on_time_tasks ?? 0);

  // A window in which you finished nothing, tracked nothing and scored nothing
  // is not four zeros — it is one sentence. Not reported as empty (which would
  // hide the card): you chose this window, so the answer for it is the point.
  if (points === 0 && done === 0 && seconds === 0) {
    // The window is named in the card's subtitle, so the sentence does not
    // repeat it — one place that knows the labels, and it is the meta.
    return <QuietLine text="Nothing tracked or finished in this window yet." />;
  }

  const onTimePct = done > 0 ? Math.round((onTime / done) * 100) : null;

  // Semantic colour on the ONE stat that carries state rather than magnitude —
  // StatTile's own rule (:36). Points, completions and hours are counts; being
  // late is a condition.
  const onTimeTone =
    onTimePct == null ? undefined : onTimePct >= 90 ? c.success : onTimePct >= 70 ? c.warning : c.danger;

  const tiles = [
    // `hero` on the first one only — StatTile allows at most one per card, and
    // at size 's' this single tile is the whole widget.
    <StatTile key="points" hero label="Points" value={String(points)} />,
    <StatTile key="done" label="Completed" value={String(done)} />,
    <StatTile key="tracked" label="Tracked" value={formatCompact(seconds)} />,
    <StatTile
      key="ontime"
      label="On time"
      value={onTimePct == null ? '—' : `${onTimePct}%`}
      tone={onTimeTone}
      detail={done > 0 ? `${onTime} of ${done} by their due date` : undefined}
      detailTone={onTimeTone}
      // The ONE tile here with a denominator, so the only one that gets a bar:
      // on-time is a share of the tasks you finished. Points, completions and
      // hours are counts with nothing to be a share OF, and a meter under any
      // of them would be a scale this widget made up.
      meter={onTimePct == null ? undefined : { percent: onTimePct, tone: onTimeTone }}
    />,
  ];

  // A wrapping row, not columns: the same flex-wrap the facts row uses, so a
  // 230px cell stacks the tiles and a full-width one lines them up, with no
  // breakpoint anywhere. `grid-cols-*` does not render in this RN-web build.
  return (
    <View className="flex-row flex-wrap gap-x-8 gap-y-4">
      {tiles.slice(0, STATS_BY_SIZE[size])}
    </View>
  );
}
