import { PipelineSelector, DateRangeControls } from '@/components/intelligence/DateRangeFilter';
import UserLink from '@/components/common/UserLink';
import {
  PortfolioCapacityRow,
  PortfolioCfdPoint,
  PortfolioThroughputBucket,
  PortfolioWipStage,
} from '@/contexts/AnalyticsContext';
import { usePortfolioFlowData } from '@/hooks/usePortfolioFlowData';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// Portfolio flow analytics (#175) -- Cumulative Flow Diagram, WIP per stage,
// cycle time (Little's Law: WIP / throughput), and capacity (committed vs
// tracked hours per person). Reuses the #139 shared calendar range picker +
// screen-driven granularity (DateRangeFilter.tsx) rather than a per-chart
// date control. Pipeline/date-range state and the four getPortfolio* fetches
// live in hooks/usePortfolioFlowData.ts, shared with the web variant below --
// only chart rendering differs by platform.
//
// This file (PortfolioFlowTab.tsx, no platform suffix) is the NATIVE +
// fallback implementation, using react-native-svg -- the same approach as
// the Pipeline tab's ThroughputChart/DwellChart in _analytics_adaptive.tsx.
// PortfolioFlowTab.web.tsx is the web sibling (any width): recharts, with
// real hover tooltips, matching every other Intelligence chart
// (PipelineOverviewChart.tsx, IntelligenceSections.tsx's AnalyticsSectionWeb)
// -- recharts is web-only and cannot render on native RN, which is why this
// split exists rather than one shared implementation.
//
// All four numbers come from rpc_portfolio_wip_by_stage / rpc_portfolio_cfd /
// rpc_portfolio_throughput / rpc_portfolio_capacity -- SECURITY DEFINER RPCs
// gated by analytics.view + fn_project_accessible per row (see the migration
// header for the exact predicate reuse). A company with no project-kind
// pipeline yet (subject_kind='project') sees an empty state, not an error --
// per plan §13.8 that is the expected state until a pipeline is marked
// project-kind and a project is given a stage.

const STAGE_COLORS = [
  'rgb(56,189,248)',  // sky
  'rgb(129,140,248)', // indigo
  'rgb(244,114,182)', // pink
  'rgb(251,146,60)',  // orange
  'rgb(52,211,153)',  // emerald (terminal, usually last)
];

function fmtBucketLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── WIP per stage — horizontal bars ───────────────────────────────────────

function WipByStageChart({ data }: { data: PortfolioWipStage[] }) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const sorted = [...data].sort((a, b) => a.stage_position - b.stage_position);
  const maxCount = Math.max(1, ...sorted.map(s => s.wip_count));
  const labelW = 110;
  const countW = 30;
  const barAreaW = Math.max(4, width - labelW - countW - 8);

  if (!sorted.length) return (
    <View className="h-20 items-center justify-center">
      <Text className="text-typography-muted text-sm">No project pipeline stages yet.</Text>
    </View>
  );

  // Two fixes, both matching CfdChart's already-working structure:
  // 1. Explicit height (row count * row height) on the measured node --
  //    a 0-height box that only gets content once width>0 is a chicken/egg
  //    deadlock on web.
  // 2. onLayout and onStartShouldSetResponder must be on SEPARATE Views --
  //    combined on one node, react-native-web's ResizeObserver-backed
  //    onLayout never fires at all (confirmed by instrumenting: `wip` had
  //    5 real rows, the DOM node measured 782px wide / 0px tall, and no
  //    layout event ever arrived while both props shared one View).
  const rowH = 26;
  return (
    <View onStartShouldSetResponder={() => true}>
      <View style={{ height: sorted.length * rowH }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && sorted.map((s, i) => {
          const barW = Math.max(2, (s.wip_count / maxCount) * barAreaW);
          const color = STAGE_COLORS[i % STAGE_COLORS.length];
          return (
            <View key={s.stage_id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ width: labelW, fontSize: 10, fontWeight: '700', color: colors.textMuted }} numberOfLines={1}>
                {s.stage_name}
              </Text>
              <Svg height={18} width={barAreaW}>
                <Rect x={0} y={2} width={barW} height={14} fill={color} rx={4} />
              </Svg>
              <Text style={{ width: countW, fontSize: 11, fontWeight: '900', textAlign: 'right', color: colors.textMain }}>
                {s.wip_count}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Cumulative Flow Diagram — stacked bars, one per bucket ────────────────
// band(stage, bucket) = cumulative_count(stage) - cumulative_count(next stage
// by position); the RPC already guarantees cumulative_count is
// non-increasing as position rises, so every band is >= 0 by construction.

function CfdChart({ points }: { points: PortfolioCfdPoint[] }) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const chartH = 200;

  if (!points.length) return (
    <View className="h-32 items-center justify-center">
      <Text className="text-typography-muted text-sm">No stage history in this period.</Text>
    </View>
  );

  const buckets = Array.from(new Set(points.map(p => p.bucket_end))).sort();
  const stages = Array.from(new Map(points.map(p => [p.stage_id, p])).values())
    .sort((a, b) => a.stage_position - b.stage_position);

  const byBucket = new Map<string, Map<string, number>>();
  for (const p of points) {
    if (!byBucket.has(p.bucket_end)) byBucket.set(p.bucket_end, new Map());
    byBucket.get(p.bucket_end)!.set(p.stage_id, p.cumulative_count);
  }

  const maxTotal = Math.max(1, ...buckets.map(b => {
    const m = byBucket.get(b)!;
    return Math.max(0, ...stages.map(s => m.get(s.stage_id) ?? 0));
  }));

  const colW = width > 0 ? width / buckets.length : 0;
  const barW = colW * 0.6;

  return (
    <View onStartShouldSetResponder={() => true}>
      <View style={{ height: chartH }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg height={chartH} width={width}>
            <Defs>
              {stages.map((s, i) => (
                <LinearGradient key={s.stage_id} id={`cfd${i}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={STAGE_COLORS[i % STAGE_COLORS.length]} stopOpacity="1" />
                  <Stop offset="1" stopColor={STAGE_COLORS[i % STAGE_COLORS.length]} stopOpacity="0.55" />
                </LinearGradient>
              ))}
            </Defs>
            {buckets.map((b, bi) => {
              const cx = bi * colW + colW / 2;
              const counts = byBucket.get(b)!;
              // Bands stacked bottom-up: highest-position (terminal/latest)
              // stage first, so completed work anchors the bottom and the
              // newest-arrived band sits on top.
              let yCursor = chartH - 16;
              return (
                <React.Fragment key={b}>
                  {[...stages].reverse().map((s, si) => {
                    const idx = stages.length - 1 - si;
                    const next = stages[idx + 1];
                    const cum = counts.get(s.stage_id) ?? 0;
                    const nextCum = next ? (counts.get(next.stage_id) ?? 0) : 0;
                    const band = Math.max(0, cum - nextCum);
                    const h = (band / maxTotal) * (chartH - 20);
                    if (h <= 0) return null;
                    const y = yCursor - h;
                    yCursor = y;
                    return (
                      <Rect
                        key={s.stage_id}
                        x={cx - barW / 2}
                        y={y}
                        width={barW}
                        height={h}
                        fill={`url(#cfd${idx})`}
                      />
                    );
                  })}
                </React.Fragment>
              );
            })}
          </Svg>
        )}
      </View>
      <View className="flex-row" style={{ width }}>
        {buckets.map((b, i) => (
          <View key={b} style={{ width: colW }} className="items-center">
            <Text className="text-typography-dim text-[8px] font-bold" numberOfLines={1}>{fmtBucketLabel(b)}</Text>
          </View>
        ))}
      </View>
      <View className="flex-row gap-3 flex-wrap mt-3">
        {stages.map((s, i) => (
          <View key={s.stage_id} className="flex-row items-center gap-1.5">
            <View className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STAGE_COLORS[i % STAGE_COLORS.length] }} />
            <Text className="text-typography-dim text-[9px] font-bold uppercase">{s.stage_name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Arrivals vs completions + cycle time ──────────────────────────────────

function ThroughputAndCycleChart({ buckets }: { buckets: PortfolioThroughputBucket[] }) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const chartH = 160;

  if (!buckets.length) return (
    <View className="h-24 items-center justify-center">
      <Text className="text-typography-muted text-sm">No arrivals or completions in this period.</Text>
    </View>
  );

  const maxVal = Math.max(1, ...buckets.map(b => Math.max(b.arrivals, b.completions)));
  const colW = width > 0 ? width / buckets.length : 0;
  const barW = colW * 0.3;

  // Latest bucket with a computable cycle time, walking back from "now".
  const latestCycle = [...buckets].reverse().find(b => b.cycle_time_days !== null);

  return (
    <View>
      <View onStartShouldSetResponder={() => true}>
        <View style={{ height: chartH }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 && (
            <Svg height={chartH} width={width}>
              <Defs>
                <LinearGradient id="arrGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="rgb(56,189,248)" stopOpacity="1" />
                  <Stop offset="1" stopColor="rgb(56,189,248)" stopOpacity="0.5" />
                </LinearGradient>
                <LinearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="rgb(52,211,153)" stopOpacity="1" />
                  <Stop offset="1" stopColor="rgb(52,211,153)" stopOpacity="0.5" />
                </LinearGradient>
              </Defs>
              {buckets.map((b, i) => {
                const cx = i * colW + colW / 2;
                const aH = Math.max(b.arrivals > 0 ? 2 : 0, (b.arrivals / maxVal) * (chartH - 20));
                const cH = Math.max(b.completions > 0 ? 2 : 0, (b.completions / maxVal) * (chartH - 20));
                return (
                  <React.Fragment key={i}>
                    {b.arrivals > 0 && <Rect x={cx - barW - 1} y={chartH - 20 - aH} width={barW} height={aH} fill="url(#arrGrad)" rx={2} />}
                    {b.completions > 0 && <Rect x={cx + 1} y={chartH - 20 - cH} width={barW} height={cH} fill="url(#compGrad)" rx={2} />}
                  </React.Fragment>
                );
              })}
            </Svg>
          )}
        </View>
        <View className="flex-row" style={{ width }}>
          {buckets.map((b, i) => (
            <View key={i} style={{ width: colW }} className="items-center">
              <Text className="text-typography-dim text-[8px] font-bold" numberOfLines={1}>{fmtBucketLabel(b.bucket_end)}</Text>
            </View>
          ))}
        </View>
        <View className="flex-row gap-4 mt-2">
          <View className="flex-row items-center gap-1.5">
            <View className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'rgb(56,189,248)' }} />
            <Text className="text-typography-dim text-[9px] font-bold uppercase">Arrivals</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'rgb(52,211,153)' }} />
            <Text className="text-typography-dim text-[9px] font-bold uppercase">Completions</Text>
          </View>
        </View>
      </View>

      <View className="flex-row gap-3 mt-4">
        <View className="flex-1 bg-surface-background border border-surface-border rounded-xl p-3 items-center">
          <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest mb-1">Cycle Time</Text>
          <Text className="text-typography-main text-xl font-black">
            {latestCycle?.cycle_time_days != null ? `${latestCycle.cycle_time_days.toFixed(1)}d` : '—'}
          </Text>
          <Text className="text-typography-dim text-[8px] mt-0.5">WIP ÷ throughput rate</Text>
        </View>
        <View className="flex-1 bg-surface-background border border-surface-border rounded-xl p-3 items-center">
          <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest mb-1">Live WIP</Text>
          <Text className="text-typography-main text-xl font-black">{buckets[buckets.length - 1]?.wip_end ?? 0}</Text>
          <Text className="text-typography-dim text-[8px] mt-0.5">arrived, not yet complete</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Capacity: committed vs available hours per person ─────────────────────

function CapacityList({ rows }: { rows: PortfolioCapacityRow[] }) {
  const colors = useThemeColors();
  if (!rows.length) return (
    <View className="h-20 items-center justify-center">
      <Text className="text-typography-muted text-sm">No committed or tracked hours in this window.</Text>
    </View>
  );

  const maxHours = Math.max(1, ...rows.map(r => Math.max(r.committed_hours, r.available_hours)));

  return (
    <View className="gap-4">
      {rows.map(r => (
        <View key={r.user_id}>
          <UserLink userId={r.user_id} name={r.full_name} className="text-typography-main text-xs font-bold mb-1.5" numberOfLines={1} />
          {[
            { label: 'Committed', value: r.committed_hours, color: 'rgb(129,140,248)' },
            { label: 'Available (tracked)', value: r.available_hours, color: 'rgb(52,211,153)' },
          ].map(row => (
            <View key={row.label} className="flex-row items-center gap-2 mb-1">
              <Text style={{ width: 110 }} className="text-typography-dim text-[9px] font-bold uppercase">{row.label}</Text>
              <View className="flex-1 h-2.5 bg-surface-background rounded-full overflow-hidden">
                <View
                  style={{ width: `${Math.min(100, (row.value / maxHours) * 100)}%`, backgroundColor: row.color }}
                  className="h-full rounded-full"
                />
              </View>
              <Text className="text-typography-main text-[10px] font-black w-10 text-right">{row.value.toFixed(1)}h</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ─── Root tab ───────────────────────────────────────────────────────────────

export default function PortfolioFlowTab() {
  const colors = useThemeColors();
  const {
    pipelines, selectedPipeline, setSelectedPipeline,
    granularity, from, to, setFrom, setTo,
    wip, cfd, throughput, capacity,
    loading, loaded,
  } = usePortfolioFlowData();

  if (pipelines.length === 0 && loaded) {
    return (
      <View className="bg-surface-card border border-surface-border rounded-2xl p-10 items-center gap-3">
        <FontAwesome name="random" size={28} color={colors.primary} />
        <Text className="text-typography-main font-black text-center">No project pipeline yet</Text>
        <Text className="text-typography-muted text-sm text-center">
          Mark a pipeline as project-kind and move a project into it to see flow analytics here.
        </Text>
        {capacity.length > 0 && (
          <View className="w-full mt-4">
            <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-3">Capacity (still available)</Text>
            <CapacityList rows={capacity} />
          </View>
        )}
      </View>
    );
  }

  return (
    <View className="gap-6">
      <View className="gap-2">
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Time Frame</Text>
        <DateRangeControls from={from} to={to} setFrom={setFrom} setTo={setTo} granularity={granularity} />
      </View>

      {pipelines.length > 1 && (
        <View className="gap-2">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Project Pipeline</Text>
          <PipelineSelector pipelines={pipelines} selectedId={selectedPipeline} onSelect={setSelectedPipeline} />
        </View>
      )}

      {loading && !loaded ? (
        <View className="py-16 items-center"><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <>
          <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <Text className="text-typography-main font-black text-base mb-1">WIP per Stage</Text>
            <Text className="text-typography-muted text-[10px] mb-5">Projects currently parked in each stage</Text>
            <WipByStageChart data={wip} />
          </View>

          <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <Text className="text-typography-main font-black text-base mb-1">Cumulative Flow</Text>
            <Text className="text-typography-muted text-[10px] mb-5">Arrival rate vs completion rate over project stages</Text>
            <CfdChart points={cfd} />
          </View>

          <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <Text className="text-typography-main font-black text-base mb-1">Throughput &amp; Cycle Time</Text>
            <Text className="text-typography-muted text-[10px] mb-5">Little's Law: cycle time = WIP ÷ throughput</Text>
            <ThroughputAndCycleChart buckets={throughput} />
          </View>

          <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <Text className="text-typography-main font-black text-base mb-1">Capacity</Text>
            <Text className="text-typography-muted text-[10px] mb-5">Committed estimated hours vs tracked hours per person</Text>
            <CapacityList rows={capacity} />
          </View>
        </>
      )}
    </View>
  );
}
