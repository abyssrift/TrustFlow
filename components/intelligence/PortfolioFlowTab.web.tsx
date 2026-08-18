import { PipelineSelector, DateRangeControls } from '@/components/intelligence/DateRangeFilter';
import UserLink from '@/components/common/UserLink';
import {
  PortfolioCapacityRow,
  PortfolioCfdPoint,
  PortfolioThroughputBucket,
  PortfolioWipStage,
} from '@/contexts/AnalyticsContext';
import { EntityEmptyState, SectionCard } from '@/components/entities/EntityUI';
import { usePortfolioFlowData } from '@/hooks/usePortfolioFlowData';
import { useThemeColors } from '@/hooks/useThemeColors';
import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartTooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Portfolio flow analytics (#175) -- web variant. Same data (hooks/
// usePortfolioFlowData.ts, shared with the native/.tsx sibling) but charts
// are rebuilt on recharts -- matching every other Intelligence web chart
// (PipelineOverviewChart.tsx, IntelligenceSections.tsx's AnalyticsSectionWeb
// -- BarChart layout="vertical" + Cell for per-bar color, a custom Tooltip
// `content` component for multi-value readouts) instead of hand-drawn
// react-native-svg <Rect> primitives, which have no hover affordance at all.
// See PortfolioFlowTab.tsx for the platform-split rationale (recharts is
// web-only, cannot render on native RN).

function fmtBucketLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STAGE_COLORS = [
  '#38bdf8', // sky
  '#818cf8', // indigo
  '#f472b6', // pink
  '#fb923c', // orange
  '#34d399', // emerald (terminal, usually last)
];

// ─── WIP per stage — horizontal bars ───────────────────────────────────────

// Tooltip surface matches PipelineOverviewChart.tsx's tooltipStyle exactly
// (colors.card / colors.border / colors.textMain via inline styles, not
// NativeWind classes) -- a recharts tooltip renders into a portal outside
// the normal component tree, the same class of place theme-token classes
// have resolved wrong on this web build before (see feedback_nativewind_
// modal_colors). Every Tip component below shares this one function so the
// four charts' tooltips can never drift from each other or from the rest
// of Intelligence.
function tipStyle(colors: ReturnType<typeof useThemeColors>): React.CSSProperties {
  return {
    backgroundColor: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 11,
    color: colors.textMain,
  };
}

function WipTip({ active, payload }: any) {
  const colors = useThemeColors();
  if (!active || !payload?.length) return null;
  const d: PortfolioWipStage = payload[0]?.payload;
  return (
    <div style={tipStyle(colors)}>
      <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 4 }}>{d.stage_name}</div>
      <div style={{ color: colors.textMuted, fontSize: 10 }}>{d.wip_count} project{d.wip_count === 1 ? '' : 's'} parked here</div>
      {d.is_terminal && <div style={{ color: colors.textDim, fontSize: 9, marginTop: 2 }}>Terminal stage</div>}
    </div>
  );
}

function WipByStageChart({ data }: { data: PortfolioWipStage[] }) {
  const colors = useThemeColors();
  if (!data.length) return (
    <View className="h-20 items-center justify-center">
      <Text className="text-typography-muted text-sm">No project pipeline stages yet.</Text>
    </View>
  );
  const sorted = [...data].sort((a, b) => a.stage_position - b.stage_position);
  return (
    <View style={{ height: Math.max(120, sorted.length * 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sorted} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.border} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fill: colors.textDim, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="stage_name" width={110} tick={{ fill: colors.textMuted, fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
          <RechartTooltip content={<WipTip />} cursor={{ fill: colors.border, opacity: 0.15 }} />
          <Bar dataKey="wip_count" radius={[0, 6, 6, 0]} maxBarSize={22}>
            {sorted.map((s, i) => <Cell key={s.stage_id} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </View>
  );
}

// ─── Cumulative Flow Diagram — stacked bars, one per bucket ────────────────
// band(stage, bucket) = cumulative_count(stage) - cumulative_count(next stage
// by position); the RPC already guarantees cumulative_count is
// non-increasing as position rises, so every band is >= 0 by construction.

function CfdTip({ active, payload, label }: any) {
  const colors = useThemeColors();
  if (!active || !payload?.length) return null;
  return (
    <div style={tipStyle(colors)}>
      <div style={{ color: colors.textDim, fontSize: 10, marginBottom: 4 }}>{label}</div>
      {[...payload].reverse().map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color, fontSize: 12, fontWeight: 700 }}>{p.name}: {p.value}</div>
      ))}
    </div>
  );
}

function CfdChart({ points }: { points: PortfolioCfdPoint[] }) {
  const colors = useThemeColors();
  if (!points.length) return (
    <View className="h-32 items-center justify-center">
      <Text className="text-typography-muted text-sm">No stage history in this period.</Text>
    </View>
  );

  const stages = Array.from(new Map(points.map(p => [p.stage_id, p])).values())
    .sort((a, b) => a.stage_position - b.stage_position);

  const byBucket = new Map<string, { bucket_end: string; label: string;[k: string]: any }>();
  for (const p of points) {
    if (!byBucket.has(p.bucket_end)) byBucket.set(p.bucket_end, { bucket_end: p.bucket_end, label: fmtBucketLabel(p.bucket_end) });
    byBucket.get(p.bucket_end)!['cum_' + p.stage_id] = p.cumulative_count;
  }
  const chartData = Array.from(byBucket.values()).sort((a, b) => a.bucket_end.localeCompare(b.bucket_end));

  // Bands, computed once per bucket row: band(stage) = cum(stage) -
  // cum(next stage by position) -- the WIP actually sitting in that stage,
  // which is what the stacked bar should show (not the raw cumulative
  // "reached" count, which is non-decreasing across all stages and would
  // stack to a meaningless total).
  for (const row of chartData) {
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      const next = stages[i + 1];
      const cum = row['cum_' + s.stage_id] ?? 0;
      const nextCum = next ? (row['cum_' + next.stage_id] ?? 0) : 0;
      row['band_' + s.stage_id] = Math.max(0, cum - nextCum);
    }
  }

  return (
    <View style={{ height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: colors.textDim, fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: colors.textDim, fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
          <RechartTooltip content={<CfdTip />} cursor={{ fill: colors.border, opacity: 0.1 }} />
          <Legend wrapperStyle={{ fontSize: 10, color: colors.textDim }} />
          {/* Terminal-most stage anchors the bottom of the stack; earliest stage sits on top -- completed work reads as the stable base. */}
          {[...stages].reverse().map((s, ri) => {
            const i = stages.length - 1 - ri;
            return (
              <Bar
                key={s.stage_id}
                dataKey={'band_' + s.stage_id}
                name={s.stage_name}
                stackId="cfd"
                fill={STAGE_COLORS[i % STAGE_COLORS.length]}
                maxBarSize={40}
              />
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    </View>
  );
}

// ─── Arrivals vs completions + cycle time ──────────────────────────────────

function ThroughputTip({ active, payload, label }: any) {
  const colors = useThemeColors();
  if (!active || !payload?.length) return null;
  const d: PortfolioThroughputBucket = payload[0]?.payload;
  return (
    <div style={tipStyle(colors)}>
      <div style={{ color: colors.textDim, fontSize: 10, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color, fontSize: 12, fontWeight: 700 }}>{p.name}: {p.value}</div>
      ))}
      <div style={{ color: colors.textDim, fontSize: 10, marginTop: 4 }}>WIP at end: {d.wip_end}</div>
      {d.cycle_time_days != null && (
        <div style={{ color: colors.textDim, fontSize: 10 }}>Cycle time: {d.cycle_time_days.toFixed(1)}d</div>
      )}
    </div>
  );
}

function ThroughputAndCycleChart({ buckets }: { buckets: PortfolioThroughputBucket[] }) {
  const colors = useThemeColors();
  if (!buckets.length) return (
    <View className="h-24 items-center justify-center">
      <Text className="text-typography-muted text-sm">No arrivals or completions in this period.</Text>
    </View>
  );

  const chartData = buckets.map(b => ({ ...b, label: fmtBucketLabel(b.bucket_end) }));
  const latestCycle = [...buckets].reverse().find(b => b.cycle_time_days !== null);

  return (
    <View>
      <View style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: colors.textDim, fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: colors.textDim, fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
            <RechartTooltip content={<ThroughputTip />} cursor={{ fill: colors.border, opacity: 0.1 }} />
            <Legend wrapperStyle={{ fontSize: 10, color: colors.textDim }} />
            <Bar dataKey="arrivals" name="Arrivals" fill="#38bdf8" radius={[4, 4, 0, 0]} maxBarSize={20} />
            <Bar dataKey="completions" name="Completions" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
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

function CapacityTip({ active, payload, label }: any) {
  const colors = useThemeColors();
  if (!active || !payload?.length) return null;
  return (
    <div style={tipStyle(colors)}>
      <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color, fontSize: 12, fontWeight: 700 }}>{p.name}: {Number(p.value).toFixed(1)}h</div>
      ))}
    </div>
  );
}

function CapacityList({ rows }: { rows: PortfolioCapacityRow[] }) {
  const colors = useThemeColors();
  if (!rows.length) return (
    <View className="h-20 items-center justify-center">
      <Text className="text-typography-muted text-sm">No committed or tracked hours in this window.</Text>
    </View>
  );

  const chartData = rows.map(r => ({ ...r, label: r.full_name }));

  return (
    <View className="gap-4">
      <View style={{ height: Math.max(120, rows.length * 46) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} horizontal={false} />
            <XAxis type="number" tick={{ fill: colors.textDim, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}h`} />
            <YAxis type="category" dataKey="label" width={130} tick={{ fill: colors.textMuted, fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
            <RechartTooltip content={<CapacityTip />} cursor={{ fill: colors.border, opacity: 0.15 }} />
            <Legend wrapperStyle={{ fontSize: 10, color: colors.textDim }} />
            <Bar dataKey="committed_hours" name="Committed" fill="#818cf8" radius={[0, 4, 4, 0]} maxBarSize={16} />
            <Bar dataKey="available_hours" name="Available (tracked)" fill="#34d399" radius={[0, 4, 4, 0]} maxBarSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </View>
      <View className="gap-1">
        {rows.map(r => (
          <View key={r.user_id} className="flex-row items-center">
            <UserLink userId={r.user_id} name={r.full_name} className="text-typography-dim text-[10px] font-bold" numberOfLines={1} />
          </View>
        ))}
      </View>
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
      <View className="w-full bg-surface-card border border-surface-border rounded-2xl">
        <EntityEmptyState
          kind="board"
          title="No project board yet"
          body="These charts count projects moving across a board. Mark a pipeline as “Projects” in the pipeline editor and move a project onto it, and the flow shows up here."
        />
        {capacity.length > 0 && (
          <View className="w-full px-5 pb-5">
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
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Time frame</Text>
        <DateRangeControls from={from} to={to} setFrom={setFrom} setTo={setTo} granularity={granularity} />
      </View>

      {pipelines.length > 1 && (
        <View className="gap-2">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Project board</Text>
          <PipelineSelector pipelines={pipelines} selectedId={selectedPipeline} onSelect={setSelectedPipeline} />
        </View>
      )}

      {loading && !loaded ? (
        <View className="py-16 items-center"><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <>
          {/* Phase 8 (#187): chrome only. The entity tag on the first three
              says out loud that every number here counts PROJECTS, not tasks
              — the exact confusion plan §17 names. Charts, data and tooltips
              are untouched. */}
          <SectionCard kind="project" title="WIP per stage" hint="Projects parked in each stage right now">
            <WipByStageChart data={wip} />
          </SectionCard>

          <SectionCard kind="project" title="Cumulative flow" hint="How fast projects arrive versus how fast they finish">
            <CfdChart points={cfd} />
          </SectionCard>

          <SectionCard kind="project" title="Throughput and cycle time" hint="Little's Law: cycle time = WIP ÷ throughput">
            <ThroughputAndCycleChart buckets={throughput} />
          </SectionCard>

          <SectionCard icon="clock-o" title="Capacity" hint="Committed estimated hours versus tracked hours, per person">
            <CapacityList rows={capacity} />
          </SectionCard>
        </>
      )}
    </View>
  );
}
