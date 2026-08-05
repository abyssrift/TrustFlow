// Phase 10 (#191, plan §16.2) — the dashboard's projection graph.
//
// WHAT IT IS: one slim lane per project that the SERVER has actually forecast,
// on a shared time axis, showing the one thing a dashboard should say about a
// forecast — does it land before or after the deadline we committed to.
//
// WHAT IT IS NOT: a second forecast. There is no pace maths in this file and
// none may be added. `projected_end` / `projection_confidence` arrive on the
// `rpc_projects_table` row from `fn_project_projection`, the single server-side
// definition (§16.1), and every position on the axis is computed by
// `lib/projectTimeline.ts` — the same pure module the Timeline tab uses, so the
// two surfaces cannot disagree about where a date sits or what "late" means.
// That module has its own check file; nothing new to assert was invented here.
//
// WHY NOT REUSE ProjectionChart: that chart plots ONE project's cumulative
// completions over time and needs a per-task history series. A dashboard is
// company-wide, so it would have to pick an arbitrary project and fetch its
// tasks. A shared-axis lane strip answers the company-wide question in ~44px
// per project instead of ~260px for one of them.
//
// THE RULE THAT SHAPES IT (the user's own words: "if there's no data, don't
// display shit"): when no project has a forecast, this component renders
// NOTHING — no card, no heading, no empty state. It returns null. On a young
// dataset every project sits at confidence 'none', so absent is the state you
// should expect to see, and it is the honest one.
//
// PATH A (unified responsive), per ui-style-guide.md §3: a lane is a label plus
// a rail at every width. What changes between 390px and 1600px is how much room
// the label gets — a number, not a different render tree.

import { EntityGlyph } from '@/components/entities/EntityUI';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fmtDate } from '@/lib/projectPresentation';
import {
  axisTicks,
  fraction,
  hasProjection,
  isThinProjection,
  msOf,
  overrunDays,
  projectedAt,
  timelineDomain,
  type Domain,
} from '@/lib/projectTimeline';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

export type ProjectionStripRow = {
  id: string;
  name: string;
  color?: string | null;
  due_date?: string | null;
  days_remaining?: number | null;
  start_date?: string | null;
  projected_end?: string | null;
  projection_confidence?: string | null;
};

// Five is the point where a strip stops being a strip. The overflow line names
// what is being left out rather than silently truncating.
const MAX_LANES = 5;

export default function ProjectionStrip({ rows, loading }: { rows: ProjectionStripRow[]; loading?: boolean }) {
  const c = useThemeColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  const labelWidth = isDesktop ? 168 : 104;

  // Only projects the server was willing to forecast. `hasProjection` is the
  // single gate — the confidence string is never re-tested inline here.
  const forecast = useMemo(() => rows.filter(hasProjection), [rows]);

  // Worst news first: furthest past its deadline, then the earliest landing.
  // A strip ordered by name is a list with extra steps.
  const ordered = useMemo(
    () =>
      [...forecast].sort((a, b) => {
        const la = overrunDays(a) ?? Number.NEGATIVE_INFINITY;
        const lb = overrunDays(b) ?? Number.NEGATIVE_INFINITY;
        if (la !== lb) return lb - la;
        return (msOf(a.projected_end) ?? 0) - (msOf(b.projected_end) ?? 0);
      }),
    [forecast]
  );

  const lanes = ordered.slice(0, MAX_LANES);

  // The axis spans only the projects actually drawn, so five lanes are never
  // squashed into a corner by a sixth one landing two years out.
  // ponytail: no useMemo — Date.now() changes every render, so memoising on it
  // never hits. It's one pass over at most five rows.
  const nowMs = Date.now();
  const domain = timelineDomain(lanes, nowMs);

  // THE GATE. Nothing to forecast -> nothing on the screen at all.
  if (loading || lanes.length === 0) return null;

  const todayAt = fraction(nowMs, domain);
  const ticks = axisTicks(domain, isDesktop ? 4 : 3);
  const anyThin = lanes.some(isThinProjection);

  return (
    <View className="mb-8">
      {/* One eyebrow, no count beside it: the lanes are countable, and the
          overflow line below already names anything left out. (Removed on the
          design pass — three pieces of chrome around five rows read as a
          dashboard-of-a-dashboard.) */}
      <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-[0.12em] mb-2.5">
        Landing
      </Text>

      <View className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
        {/* Axis. Same [label][rail] geometry as every lane, so a tick label sits
            exactly above the date it names. */}
        <View className="flex-row items-end px-4 pt-3 pb-1.5">
          <View style={{ width: labelWidth }} />
          <View className="flex-1" style={{ height: 12 }}>
            {ticks.map((t, i) => (
              <Text
                key={t.at}
                className="text-typography-dim text-[9px] font-medium"
                style={{
                  position: 'absolute',
                  bottom: 0,
                  ...(i === 0
                    ? { left: 0 }
                    : i === ticks.length - 1
                      ? { right: 0 }
                      : { left: `${t.at * 100}%`, transform: [{ translateX: -16 }] }),
                }}
              >
                {t.label}
              </Text>
            ))}
          </View>
          <View style={{ width: 54 }} />
        </View>

        <View style={{ position: 'relative' }}>
          {lanes.map((row, i) => (
            <Lane
              key={row.id}
              row={row}
              domain={domain}
              labelWidth={labelWidth}
              last={i === lanes.length - 1}
              onPress={() => router.push(`/projects/${row.id}` as any)}
            />
          ))}

          {/* The today line, drawn ONCE across every lane rather than per lane —
              broken between rows it reads as decoration instead of as "here".
              Declared last so it paints above the lanes' hover fill, and
              pointerEvents="none" keeps every lane clickable through it. */}
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', paddingHorizontal: 16 }}
          >
            <View style={{ width: labelWidth }} />
            <View className="flex-1" style={{ position: 'relative' }}>
              <View
                style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayAt * 100}%`, width: 1, backgroundColor: c.primary + '99' }}
              />
            </View>
            <View style={{ width: 54 }} />
          </View>
        </View>

        {(anyThin || ordered.length > lanes.length) && (
          <Text className="text-typography-dim text-[10px] leading-4 px-4 pb-3 pt-1">
            {anyThin ? 'Hollow markers rest on thin history — a direction, not a date. ' : ''}
            {ordered.length > lanes.length
              ? `${ordered.length - lanes.length} more forecast in Projects.`
              : ''}
          </Text>
        )}
      </View>
    </View>
  );
}

function Lane({
  row,
  domain,
  labelWidth,
  last,
  onPress,
}: {
  row: ProjectionStripRow;
  domain: Domain;
  labelWidth: number;
  last: boolean;
  onPress: () => void;
}) {
  const c = useThemeColors();

  const late = overrunDays(row);
  const thin = isThinProjection(row);
  const projAt = projectedAt(row, domain)!;
  const dueMs = msOf(row.due_date);
  const dueAt = dueMs != null ? fraction(dueMs, domain) : null;

  // Late is the only thing on this screen that gets a saturated colour. Early
  // and on-plan are quiet on purpose — the strip exists to surface the one
  // project that will miss, not to congratulate the four that won't.
  const tone = late != null && late > 0 ? c.danger : late != null ? c.success : c.textMuted;

  // The span between the deadline and the forecast: red when it lands after,
  // green when it lands before. Absent when there is no deadline to judge it
  // against — the strip never invents a commitment to compare a forecast to.
  const gap =
    dueAt != null
      ? { left: Math.min(dueAt, projAt), width: Math.abs(projAt - dueAt) }
      : null;

  const delta =
    late == null ? fmtDate(row.projected_end ?? null) : late > 0 ? `+${late}d` : late < 0 ? `${late}d` : 'on time';

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${row.name}. Forecast ${fmtDate(row.projected_end ?? null)}${
        late != null && late > 0 ? `, ${late} days past its deadline` : ''
      }`}
      className={`flex-row items-center px-4 ${last ? '' : 'border-b border-surface-border/50'} hover:bg-surface-overlay/40 transition-colors`}
      style={{ minHeight: 44 }}
    >
      <View style={{ width: labelWidth }} className="pr-3 flex-row items-center gap-2">
        <EntityGlyph kind="project" size={18} color={row.color} />
        <Text numberOfLines={1} className="text-typography-main text-xs font-semibold flex-1">
          {row.name}
        </Text>
      </View>

      <View className="flex-1" style={{ height: 18, justifyContent: 'center' }}>
        {/* Rail */}
        <View style={{ height: 2, borderRadius: 999, backgroundColor: c.border + '66' }} />

        {/* Deadline -> forecast. Hollow + dashed when the forecast is thin, so a
            rough estimate can never be mistaken for a fact (§16.2). */}
        {gap && gap.width > 0.001 && (
          <View
            style={{
              position: 'absolute',
              left: `${gap.left * 100}%`,
              width: `${gap.width * 100}%`,
              minWidth: 4,
              height: 8,
              borderRadius: 4,
              backgroundColor: thin ? 'transparent' : tone + '40',
              borderWidth: thin ? 1 : 0,
              borderStyle: thin ? 'dashed' : 'solid',
              borderColor: tone + '99',
            }}
          />
        )}

        {/* The committed deadline — the fact the forecast is judged against. */}
        {dueAt != null && (
          <View
            style={{
              position: 'absolute',
              left: `${dueAt * 100}%`,
              marginLeft: -1,
              top: 3,
              bottom: 3,
              width: 2,
              borderRadius: 1,
              backgroundColor: c.textDim,
            }}
          />
        )}

        {/* Where it lands. Hollow when the history behind it is thin. */}
        <View
          style={{
            position: 'absolute',
            left: `${projAt * 100}%`,
            marginLeft: -3.5,
            top: 5.5,
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: thin ? c.card : tone,
            borderWidth: thin ? 1.5 : 0,
            borderColor: tone,
          }}
        />
      </View>

      <View style={{ width: 54 }} className="pl-2 items-end">
        <Text numberOfLines={1} className="text-[10px] font-bold" style={{ color: tone, opacity: thin ? 0.8 : 1 }}>
          {delta}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
