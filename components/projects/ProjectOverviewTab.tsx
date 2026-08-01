import { useProjectDetail } from '@/contexts/ProjectDetailContext';
import type { ProjectLifecycle } from '@/hooks/useProjectLifecycle';
import { useThemeColors } from '@/hooks/useThemeColors';
import { formatCompact } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useMemo } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { SkeletonBlock, SkeletonList } from '@/components/Skeleton';
import UserLink from '@/components/common/UserLink';
import { ageColor, dueColor, fmtDate, fmtDue, initials, ThemeColors } from './ProjectsTable';

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
      <AnswerLine c={c} t={t} lifecycle={lifecycle} />

      <View className={isDesktop ? 'flex-row gap-5 items-start' : 'gap-5'}>
        <View style={isDesktop ? { flex: 1 } : undefined} className="gap-5">
          <Panel title="On Track?" icon="line-chart" c={c}>
            {noTasks ? (
              <EmptyLine label="No tasks yet — nothing to track" c={c} />
            ) : (
              <>
                <View className="flex-row justify-between items-end mb-2">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em]">Weighted Progress</Text>
                  <Text className="text-typography-main text-xs font-black">{t!.completed}/{t!.total} tasks · {Number(t!.completed_weight)}/{Number(t!.total_weight)} pts</Text>
                </View>
                <View className="h-2.5 w-full bg-surface-background rounded-full overflow-hidden border border-surface-border/50 mb-4">
                  <View style={{ width: `${t!.total_weight > 0 ? (Number(t!.completed_weight) / Number(t!.total_weight)) * 100 : 0}%`, height: '100%', backgroundColor: lifecycle?.blocked ? c.danger : c.primary }} />
                </View>

                {(data?.by_stage || []).length > 0 && (
                  <View className="gap-2.5">
                    <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.15em]">Where tasks sit</Text>
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
          </Panel>
        </View>

        <View style={isDesktop ? { flex: 1 } : undefined} className="gap-5">
          <Panel title="What's Stuck?" icon="exclamation-triangle" c={c} accent={isStuck ? c.danger : undefined}>
            {!isStuck ? (
              <EmptyLine label="Nothing stuck — not blocked, no overdue work" c={c} tone="positive" />
            ) : (
              <View className="gap-3">
                {lifecycle?.blocked && (
                  <View className="bg-state-danger/10 border border-state-danger/30 rounded-xl px-3 py-2.5">
                    <Text className="text-state-danger text-xs font-black uppercase tracking-wide mb-0.5">Blocked</Text>
                    <Text className="text-typography-main text-xs font-medium">{lifecycle.blockedReason || 'No reason given.'}</Text>
                  </View>
                )}
                <View className="flex-row items-center justify-between">
                  <Text className="text-typography-muted text-xs font-bold">Overdue tasks</Text>
                  <Text className="text-base font-black" style={{ color: (t?.overdue ?? 0) > 0 ? c.danger : c.textMuted }}>{t?.overdue ?? 0}</Text>
                </View>
                {oldestOverdue && (
                  <View className="bg-surface-background border border-surface-border rounded-xl p-3">
                    <Text numberOfLines={1} className="text-typography-main text-sm font-bold mb-0.5">{oldestOverdue.title}</Text>
                    <Text className="text-[11px] font-black" style={{ color: c.danger }}>
                      {oldestOverdue.stage_name ? `${oldestOverdue.stage_name} · ` : ''}{daysOverdue}d overdue
                    </Text>
                  </View>
                )}
              </View>
            )}
          </Panel>
        </View>
      </View>

      <View className={isDesktop ? 'flex-row gap-5 items-start' : 'gap-5'}>
        <View style={isDesktop ? { flex: 1.3 } : undefined} className="gap-5">
          <Panel title="Who's on It?" icon="users" c={c}>
            {(data?.contributors || []).length === 0 ? (
              <EmptyLine label="No tracked time yet" c={c} />
            ) : (
              <View className="gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-typography-muted text-xs font-bold">Tracked vs. estimated</Text>
                  <Text className="text-typography-main text-xs font-black">
                    {fmtDuration(t?.tracked_seconds ?? 0)} of {t?.est_hours ? `${Number(t.est_hours)}h` : '—'} est.
                  </Text>
                </View>
                <View className="gap-2.5">
                  {data!.contributors.map(cb => (
                    <View key={cb.user_id}>
                      <View className="flex-row items-center mb-1.5">
                        <View className="w-7 h-7 rounded-full items-center justify-center mr-2.5" style={{ backgroundColor: c.primary + '22' }}>
                          <Text className="text-[9px] font-black" style={{ color: c.primary }}>{initials(cb.full_name)}</Text>
                        </View>
                        <UserLink userId={cb.user_id} name={cb.full_name} numberOfLines={1} className="text-typography-label text-sm font-bold flex-1" />
                        <Text className="text-typography-main text-xs font-black ml-2">{fmtDuration(cb.tracked_seconds)}</Text>
                      </View>
                      <View className="h-1 rounded-full overflow-hidden ml-[38px]" style={{ backgroundColor: c.border }}>
                        <View style={{ width: `${Math.max(4, (cb.tracked_seconds / contribMax) * 100)}%`, height: '100%', backgroundColor: c.primary, borderRadius: 999 }} />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </Panel>
        </View>

        {/* "What's the shape" is deliberately the quietest panel on the page --
            reference for browsing, not a signal anyone opens the project to
            check first (issue #183). Smaller type, no card-header icon,
            muted background instead of the card surface the other three use. */}
        <View style={isDesktop ? { flex: 0.9 } : undefined} className="gap-5">
          <View className="bg-surface-background border border-surface-border/60 rounded-2xl p-4">
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em] mb-3">Shape (reference)</Text>
            {(data?.by_category || []).length === 0 && (data?.by_priority || []).length === 0 ? (
              <EmptyLine label="No tasks yet" c={c} />
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
    </View>
  );
}

// One-sentence project state: stage, days in stage, % complete, days
// remaining, blocked-or-not (issue #183's "answer line", replacing six equal
// KPI tiles). Colors reuse ProjectsTable's exact ageColor/dueColor thresholds
// so this reads as the same signal as the table row it was opened from.
// Inline styles for the colored spans, not className, for the same reason
// ProjectHeader's flag chips are inline: the colors are per-value/data-driven,
// which static Tailwind classes can't express (documented exception, see
// Tooltip.tsx / ProjectHeader.tsx).
function AnswerLine({ c, t, lifecycle }: { c: ThemeColors; t: { completion_rate: number; overdue: number } | undefined; lifecycle: ProjectLifecycle | null }) {
  const pct = t ? Math.round(t.completion_rate) : null;
  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl px-5 py-4">
      <Text className="text-typography-main text-sm md:text-base font-bold leading-relaxed">
        {lifecycle?.stageName ? `${lifecycle.stageName} stage` : 'No stage set'}
        {lifecycle?.daysInStage != null && (
          <Text> · <Text style={{ color: ageColor(lifecycle.daysInStage, c), fontWeight: '900' }}>{lifecycle.daysInStage}d in stage</Text></Text>
        )}
        {pct != null && (
          <Text> · <Text style={{ color: c.textMain, fontWeight: '900' }}>{pct}%</Text> complete</Text>
        )}
        {lifecycle?.dueDate && (
          <Text> · <Text style={{ color: dueColor(lifecycle.daysRemaining, c), fontWeight: '900' }}>{fmtDue(lifecycle.daysRemaining, lifecycle.dueDate)}</Text></Text>
        )}
        {' · '}
        {lifecycle?.blocked ? (
          <Text style={{ color: c.danger, fontWeight: '900' }}>Blocked</Text>
        ) : (
          <Text style={{ color: c.success, fontWeight: '900' }}>On track</Text>
        )}
      </Text>
      {!lifecycle?.dueDate && (
        <Text className="text-typography-dim text-[10px] font-medium mt-1">No due date set{lifecycle?.currentStageId ? '' : ' · no stage set'}</Text>
      )}
    </View>
  );
}

function Panel({ title, icon, c, accent, children }: { title: string; icon: string; c: ThemeColors; accent?: string; children: React.ReactNode }) {
  return (
    <View className="bg-surface-card border rounded-2xl p-5" style={{ borderColor: accent ? accent + '55' : c.border }}>
      <View className="flex-row items-center gap-2 mb-4">
        <FontAwesome name={icon as any} size={12} color={accent || c.primary} />
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em]">{title}</Text>
      </View>
      {children}
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
