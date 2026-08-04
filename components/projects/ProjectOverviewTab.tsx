import { useProjectDetail } from '@/contexts/ProjectDetailContext';
import type { ProjectLifecycle } from '@/hooks/useProjectLifecycle';
import { useThemeColors } from '@/hooks/useThemeColors';
import { formatCompact } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useMemo } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { SkeletonBlock, SkeletonList } from '@/components/Skeleton';
import UserLink from '@/components/common/UserLink';
import {
  EntityGlyph,
  HealthBadge,
  MetaStat,
  ProgressMeter,
  SectionCard,
  StageChip,
  type ThemeColors,
} from '@/components/entities/EntityUI';
import { ageColor, dueColor, fmtDue } from '@/lib/projectPresentation';
import ProjectFieldsCard from './ProjectFieldsCard';

// #183 -- replaces the placeholder body moved here by #184 (twelve regions,
// all equal weight -- see issue #183). Redesigned around the issue's four
// questions ("On track? / What's stuck? / Who's on it? / What's the shape?")
// with one answer-line summary above them, and demoted (shrunk, not
// card-sized) empty states instead of every panel reserving the same space
// regardless of whether it has anything to say.
//
// Stage/days-in-stage/due-date/blocked are NOT in rpc_project_dashboard's
// payload (that RPC is task-rollup only) -- they live on the `projects` row
// itself and come from useProjectLifecycle, lifted into ProjectDetailContext
// (see that file) so this tab and ProjectHeader share one fetch and one
// piece of state instead of drifting when the flags/stage change. ProjectHeader
// still owns the *interactive* stage chip / flag toggles; the answer line
// below only restates them as plain text alongside numbers ProjectHeader
// doesn't show (days in stage, days remaining, % complete), so the two
// don't duplicate each other's UI.

function fmtDuration(seconds: number): string {
  return formatCompact(seconds);
}

export default function ProjectOverviewTab() {
  const c = useThemeColors();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  const { data, loading: dashLoading, lifecycle, lifecycleLoading } = useProjectDetail();

  const t = data?.totals;
  const stageMax = useMemo(() => Math.max(1, ...(data?.by_stage || []).map(s => s.count)), [data]);
  const catMax = useMemo(() => Math.max(1, ...(data?.by_category || []).map(ct => ct.count)), [data]);
  const contribMax = useMemo(() => Math.max(1, ...(data?.contributors || []).map(cb => cb.tracked_seconds)), [data]);

  const priorityColor = (p: string) =>
    p === 'urgent' ? c.danger : p === 'high' ? c.warning : p === 'low' ? c.muted : c.primary;

  // due_soon is ascending by due_date, incomplete tasks only -- the first
  // overdue entry is the earliest (most) overdue one, the closest proxy to
  // "oldest untouched task" the current data supports (see file header on
  // rpc_project_dashboard's shape; no per-task last-activity timestamp
  // exists to do better without a new column).
  const oldestOverdue = (data?.due_soon || []).find(d => d.overdue) ?? null;
  const daysOverdue = oldestOverdue ? Math.floor((Date.now() - new Date(oldestOverdue.due_date).getTime()) / 86400000) : null;

  const loading = dashLoading || lifecycleLoading;

  if (loading) {
    return (
      <View className="p-4 md:p-8 gap-5">
        <SkeletonBlock height={64} borderRadius={16} />
        <View className={isDesktop ? 'flex-row gap-5' : 'gap-5'}>
          <SkeletonBlock height={220} borderRadius={16} style={{ flex: 1 }} />
          <SkeletonBlock height={220} borderRadius={16} style={{ flex: 1 }} />
        </View>
        <SkeletonList count={2} itemHeight={140} />
      </View>
    );
  }

  const noTasks = !t || t.total === 0;
  const isStuck = !!lifecycle?.blocked || (t?.overdue ?? 0) > 0 || !!oldestOverdue;

  return (
    <View className="p-4 md:p-8 gap-5">
      <StateStrip c={c} t={t} lifecycle={lifecycle} />

      <View className={isDesktop ? 'flex-row gap-5 items-start' : 'gap-5'}>
        <View style={isDesktop ? { flex: 1 } : undefined} className="gap-5">
          <SectionCard title="On track?" hint="How much of the work is actually done" icon="line-chart">
            {noTasks ? (
              <EmptyLine label="No tasks yet — nothing to track" c={c} />
            ) : (
              <>
                <View className="mb-4">
                  <ProgressMeter
                    done={t!.completed}
                    total={t!.total}
                    percent={t!.total_weight > 0 ? (Number(t!.completed_weight) / Number(t!.total_weight)) * 100 : 0}
                    tone={lifecycle?.blocked ? c.danger : undefined}
                    height={9}
                  />
                  <Text className="text-typography-dim text-[10px] mt-1.5">
                    {Number(t!.completed_weight)} of {Number(t!.total_weight)} points — bigger tasks count for more
                  </Text>
                </View>

                {(data?.by_stage || []).length > 0 && (
                  <View className="gap-2.5">
                    <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em]">Where its tasks sit</Text>
                    {data!.by_stage.map(s => (
                      <View key={s.stage_id}>
                        <View className="flex-row items-center justify-between mb-1">
                          <View className="flex-row items-center gap-2 flex-1 pr-2">
                            <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: s.color || c.primary }} />
                            <Text numberOfLines={1} className="text-typography-label text-xs font-bold flex-1">{s.name}</Text>
                          </View>
                          <Text className="text-typography-main text-[11px] font-black">{s.count}</Text>
                        </View>
                        <View className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: c.border }}>
                          <View style={{ width: `${Math.max(4, (s.count / stageMax) * 100)}%`, height: '100%', backgroundColor: s.color || c.primary, borderRadius: 999 }} />
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </SectionCard>
        </View>

        <View style={isDesktop ? { flex: 1 } : undefined} className="gap-5">
          <SectionCard
            title="What's stuck?"
            hint={isStuck ? 'Deal with these before anything else' : 'Nothing needs a decision right now'}
            icon="exclamation-triangle"
            accent={isStuck ? c.danger : undefined}
          >
            {!isStuck ? (
              <EmptyLine label="Nothing stuck — not blocked, no overdue work" c={c} tone="positive" />
            ) : (
              <View className="gap-3">
                {lifecycle?.blocked && (
                  <View className="bg-state-danger/10 border border-state-danger/30 rounded-xl px-3 py-2.5 flex-row items-start gap-2.5">
                    <FontAwesome name="ban" size={12} color={c.danger} style={{ marginTop: 2 }} />
                    <View className="flex-1">
                      <Text className="text-state-danger text-xs font-bold mb-0.5">Blocked</Text>
                      <Text className="text-typography-main text-xs">
                        {lifecycle.blockedReason || 'Nobody wrote down why. Ask whoever flagged it, then clear the flag in the header.'}
                      </Text>
                    </View>
                  </View>
                )}
                <View className="flex-row items-center justify-between">
                  <Text className="text-typography-muted text-xs font-semibold">Overdue tasks</Text>
                  <Text className="text-base font-bold" style={{ color: (t?.overdue ?? 0) > 0 ? c.danger : c.textMuted }}>{t?.overdue ?? 0}</Text>
                </View>
                {oldestOverdue && (
                  <View className="bg-surface-background border border-surface-border rounded-xl p-3 flex-row items-start gap-2.5">
                    <EntityGlyph kind="task" size={22} />
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-typography-main text-sm font-bold mb-0.5">{oldestOverdue.title}</Text>
                      <Text className="text-[11px] font-bold" style={{ color: c.danger }}>
                        {oldestOverdue.stage_name ? `${oldestOverdue.stage_name} · ` : ''}{daysOverdue}d overdue — the oldest one
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            )}
          </SectionCard>
        </View>
      </View>

      <View className={isDesktop ? 'flex-row gap-5 items-start' : 'gap-5'}>
        <View style={isDesktop ? { flex: 1.3 } : undefined} className="gap-5">
          <SectionCard title="Who's on it?" hint="Time tracked against this project, per person" icon="users">
            {(data?.contributors || []).length === 0 ? (
              <EmptyLine label="Nobody has tracked time on this project yet" c={c} />
            ) : (
              <View className="gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-typography-muted text-xs font-semibold">Tracked vs. estimated</Text>
                  <Text className="text-typography-main text-xs font-bold">
                    {fmtDuration(t?.tracked_seconds ?? 0)} of {t?.est_hours ? `${Number(t.est_hours)}h` : 'no'} estimate
                  </Text>
                </View>
                <View className="gap-2.5">
                  {data!.contributors.map(cb => (
                    <View key={cb.user_id}>
                      <View className="flex-row items-center mb-1.5">
                        <View className="mr-2.5">
                          <EntityGlyph kind="client" size={28} name={cb.full_name} />
                        </View>
                        <UserLink userId={cb.user_id} name={cb.full_name} numberOfLines={1} className="text-typography-label text-sm font-bold flex-1" />
                        <Text className="text-typography-main text-xs font-bold ml-2">{fmtDuration(cb.tracked_seconds)}</Text>
                      </View>
                      <View className="h-1 rounded-full overflow-hidden ml-[38px]" style={{ backgroundColor: c.border }}>
                        <View style={{ width: `${Math.max(4, (cb.tracked_seconds / contribMax) * 100)}%`, height: '100%', backgroundColor: c.primary, borderRadius: 999 }} />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </SectionCard>
        </View>

        {/* "What's the shape" is deliberately the quietest panel on the page --
            reference for browsing, not a signal anyone opens the project to
            check first (issue #183). Smaller type, no card-header icon,
            muted background instead of the card surface the other three use. */}
        <View style={isDesktop ? { flex: 0.9 } : undefined} className="gap-5">
          <View className="bg-surface-background border border-surface-border/60 rounded-2xl p-4">
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em] mb-3">Shape — reference only</Text>
            {(data?.by_category || []).length === 0 && (data?.by_priority || []).length === 0 ? (
              <EmptyLine label="No tasks yet, so there is no shape to show" c={c} />
            ) : (
              <View className="gap-4">
                {(data?.by_category || []).length > 0 && (
                  <View className="gap-2">
                    {data!.by_category.slice(0, 5).map(ct => (
                      <View key={ct.category}>
                        <View className="flex-row items-center justify-between mb-1">
                          <Text numberOfLines={1} className="text-typography-muted text-[11px] font-bold flex-1 pr-2">{ct.category}</Text>
                          <Text className="text-typography-muted text-[10px] font-black">{ct.count}</Text>
                        </View>
                        <View className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: c.border }}>
                          <View style={{ width: `${Math.max(4, (ct.count / catMax) * 100)}%`, height: '100%', backgroundColor: c.accent, borderRadius: 999 }} />
                        </View>
                      </View>
                    ))}
                  </View>
                )}
                {(data?.by_priority || []).length > 0 && (
                  <View className="gap-1.5 pt-1 border-t border-surface-border/50">
                    {data!.by_priority.map(p => (
                      <View key={p.priority} className="flex-row items-center justify-between">
                        <View className="flex-row items-center gap-1.5">
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: priorityColor(p.priority) }} />
                          <Text className="text-typography-muted text-[11px] font-bold capitalize">{p.priority}</Text>
                        </View>
                        <Text className="text-typography-muted text-[11px] font-black">{p.count}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </View>

      {/* #197 — the spreadsheet columns this product has no concept for. Last,
          full width, and absent entirely when the company has none: it is
          reference data about the engagement, not an answer to one of the
          four questions above. */}
      <ProjectFieldsCard />
    </View>
  );
}

/**
 * Project state at a glance. #183 replaced six equal KPI tiles with one
 * dot-separated sentence; Phase 8 (#187) turns that sentence back into
 * discrete, scannable facts — but four of them, not six, and each labelled,
 * so the eye lands on the number rather than parsing prose. The health badge
 * on the right is the same badge the table row and the board card show, so
 * the project reads identically wherever you meet it.
 *
 * Colours reuse ageColor/dueColor from lib/projectPresentation.ts. Inline
 * styles because the colours are per-value (documented exception — see
 * EntityUI.tsx's header).
 */
function StateStrip({ c, t, lifecycle }: { c: ThemeColors; t: { completion_rate: number; overdue: number } | undefined; lifecycle: ProjectLifecycle | null }) {
  const pct = t ? Math.round(t.completion_rate) : null;
  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl px-4 md:px-5 py-4">
      <View className="flex-row items-center justify-between gap-3 mb-4">
        <StageChip name={lifecycle?.stageName} color={lifecycle?.stageColor} />
        <HealthBadge
          blocked={lifecycle?.blocked}
          blockedReason={lifecycle?.blockedReason}
          flags={lifecycle?.flags}
          daysRemaining={lifecycle?.daysRemaining}
        />
      </View>
      <View className="flex-row flex-wrap" style={{ gap: 20 }}>
        <MetaStat
          label="In stage"
          value={lifecycle?.daysInStage == null ? 'Not staged' : `${lifecycle.daysInStage} days`}
          color={ageColor(lifecycle?.daysInStage ?? null, c)}
          hint="How long this project has sat in its current stage. Amber past a week, red past two."
        />
        <MetaStat
          label="Due"
          value={fmtDue(lifecycle?.daysRemaining ?? null, lifecycle?.dueDate ?? null)}
          color={dueColor(lifecycle?.daysRemaining ?? null, c)}
          hint={lifecycle?.dueDate ? 'The project’s own deadline, not its tasks’.' : 'Set a due date from Edit project in the header.'}
        />
        <MetaStat label="Complete" value={pct == null ? 'No tasks' : `${pct}%`} hint="Weighted by task points, not a plain task count." />
        <MetaStat
          label="Overdue tasks"
          value={String(t?.overdue ?? 0)}
          color={(t?.overdue ?? 0) > 0 ? c.danger : undefined}
          hint="Incomplete tasks whose due date has passed."
        />
      </View>
    </View>
  );
}

// Demoted empty state -- a single slim row, not a card. "No tasks in
// pipeline" etc. no longer reserves the same height as a populated panel
// (issue #183's "demote empty panels").
function EmptyLine({ label, c, tone = 'muted' }: { label: string; c: ThemeColors; tone?: 'muted' | 'positive' }) {
  return (
    <View className="flex-row items-center gap-2 py-1">
      <FontAwesome name={tone === 'positive' ? 'check-circle' : 'circle-o'} size={11} color={tone === 'positive' ? c.success : c.textDim} />
      <Text className="text-xs font-medium" style={{ color: tone === 'positive' ? c.success : c.textDim }}>{label}</Text>
    </View>
  );
}
