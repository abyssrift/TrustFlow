import { useProjectDetail } from '@/contexts/ProjectDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { formatCompact } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { SkeletonBlock, SkeletonList } from '@/components/Skeleton';
import UserLink from '@/components/common/UserLink';

// #184 -- PLACEHOLDER TAB CONTENT. Issue #184 is the route/tab shell only;
// this tab's real layout is #183's job ("Overview | §13.10's dashboard
// cleanup (#183) — state, read-mostly" per plan §13.11). What's below is the
// KPI/panel body that used to live in ProjectDashboard.tsx (the Popup this
// issue retired) moved here as-is, reading from the same
// rpc_project_dashboard data the route's ProjectDetailContext already
// fetches once for all three tabs. #183 owns restructuring this; do not
// treat this file's layout as a design decision.

function fmtDuration(seconds: number): string {
  return formatCompact(seconds);
}
function initials(name: string | null): string {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}
function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProjectOverviewTab() {
  const colors = useThemeColors();
  const { data, loading } = useProjectDetail();

  const t = data?.totals;
  const stageMax = useMemo(() => Math.max(1, ...(data?.by_stage || []).map(s => s.count)), [data]);
  const catMax = useMemo(() => Math.max(1, ...(data?.by_category || []).map(c => c.count)), [data]);
  const contribMax = useMemo(() => Math.max(1, ...(data?.contributors || []).map(c => c.tracked_seconds)), [data]);

  const priorityColor = (p: string) =>
    p === 'urgent' ? colors.danger : p === 'high' ? colors.warning : p === 'low' ? colors.muted : colors.primary;

  const kpis = t ? [
    { label: 'Completion', value: `${Math.round(t.completion_rate)}%`, icon: 'check-circle', color: colors.success },
    { label: 'Total Tasks', value: String(t.total), icon: 'tasks', color: colors.primary },
    { label: 'Active', value: String(t.active), icon: 'bolt', color: colors.accent },
    { label: 'Overdue', value: String(t.overdue), icon: 'exclamation-triangle', color: colors.danger },
    { label: 'Time Tracked', value: fmtDuration(t.tracked_seconds), icon: 'clock-o', color: colors.info },
    { label: 'Est. Hours', value: `${Number(t.est_hours || 0)}h`, icon: 'hourglass-half', color: colors.warning },
  ] : [];

  if (loading) {
    return (
      <View className="p-4 md:p-8 gap-4">
        <View className="flex-row flex-wrap gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} height={90} borderRadius={16} style={{ flexGrow: 1, flexBasis: 160 }} />
          ))}
        </View>
        <SkeletonList count={3} itemHeight={120} />
      </View>
    );
  }

  return (
    <View className="p-4 md:p-8">
      {/* KPI cards */}
      <View className="flex-row flex-wrap gap-4">
        {kpis.map(k => (
          <View key={k.label} className="bg-surface-card border border-surface-border rounded-2xl p-5" style={{ flexGrow: 1, flexBasis: 160 }}>
            <View className="flex-row items-center gap-2 mb-2">
              <FontAwesome name={k.icon as any} size={12} color={k.color} />
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">{k.label}</Text>
            </View>
            <Text className="text-typography-main text-3xl font-black tracking-tight">{k.value}</Text>
          </View>
        ))}
      </View>

      {/* Progress bar (weighted) */}
      {t && (
        <View className="bg-surface-card border border-surface-border rounded-2xl p-5 mt-4">
          <View className="flex-row justify-between items-end mb-2">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em]">Weighted Progress</Text>
            <Text className="text-typography-main text-sm font-black">{t.completed} / {t.total} tasks · {Number(t.completed_weight)}/{Number(t.total_weight)} pts</Text>
          </View>
          <View className="h-3 w-full bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
            <View style={{ width: `${t.total_weight > 0 ? (Number(t.completed_weight) / Number(t.total_weight)) * 100 : 0}%`, height: '100%', backgroundColor: colors.primary }} />
          </View>
        </View>
      )}

      {/* Multi-column body -- flexBasis 360 wraps to a single column below
          ~720px, which is the mobile answer for this placeholder layout;
          #183 should re-evaluate once it owns the real one. */}
      <View className="flex-row flex-wrap gap-5 mt-5">
        <View style={{ flexGrow: 1, flexBasis: 360 }} className="gap-5">
          <Panel title="Pipeline Distribution" icon="sitemap" colors={colors}>
            {(data?.by_stage || []).length === 0 ? <Empty label="No tasks in pipeline" colors={colors} /> : (
              <View className="gap-3">
                {data!.by_stage.map(s => (
                  <View key={s.stage_id}>
                    <View className="flex-row items-center justify-between mb-1.5">
                      <View className="flex-row items-center gap-2 flex-1 pr-2">
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color || colors.primary }} />
                        <Text numberOfLines={1} className="text-typography-label text-sm font-bold flex-1">{s.name}</Text>
                      </View>
                      <Text className="text-typography-main text-xs font-black">{s.count}</Text>
                    </View>
                    <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
                      <View style={{ width: `${Math.max(4, (s.count / stageMax) * 100)}%`, height: '100%', backgroundColor: s.color || colors.primary, borderRadius: 999 }} />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Panel>

          <Panel title="Priority Breakdown" icon="flag" colors={colors}>
            {(data?.by_priority || []).length === 0 ? <Empty label="No tasks" colors={colors} /> : (
              <View className="gap-2.5">
                {data!.by_priority.map(p => (
                  <View key={p.priority} className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: priorityColor(p.priority) }} />
                      <Text className="text-typography-label text-sm font-bold capitalize">{p.priority}</Text>
                    </View>
                    <Text className="text-typography-main text-sm font-black">{p.count}</Text>
                  </View>
                ))}
              </View>
            )}
          </Panel>
        </View>

        <View style={{ flexGrow: 1, flexBasis: 360 }} className="gap-5">
          <Panel title="By Category" icon="tags" colors={colors}>
            {(data?.by_category || []).length === 0 ? <Empty label="No categories" colors={colors} /> : (
              <View className="gap-3">
                {data!.by_category.map(ct => (
                  <View key={ct.category}>
                    <View className="flex-row items-center justify-between mb-1.5">
                      <Text numberOfLines={1} className="text-typography-label text-sm font-bold flex-1 pr-2">{ct.category}</Text>
                      <Text className="text-typography-main text-xs font-black">{ct.count}</Text>
                    </View>
                    <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
                      <View style={{ width: `${Math.max(4, (ct.count / catMax) * 100)}%`, height: '100%', backgroundColor: colors.accent, borderRadius: 999 }} />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Panel>

          <Panel title="Upcoming Deadlines" icon="calendar" colors={colors}>
            {(data?.due_soon || []).length === 0 ? <Empty label="No upcoming deadlines" colors={colors} /> : (
              <View className="gap-2">
                {data!.due_soon.map(d => (
                  <View key={d.id} className="flex-row items-center justify-between bg-surface-background border border-surface-border rounded-xl p-3">
                    <View className="flex-1 pr-3">
                      <Text numberOfLines={1} className="text-typography-main text-sm font-bold">{d.title}</Text>
                      <Text className="text-typography-muted text-[10px] font-medium mt-0.5">{d.stage_name || '—'}</Text>
                    </View>
                    <Text className={`text-[11px] font-black ${d.overdue ? 'text-state-danger' : 'text-typography-muted'}`}>{fmtDate(d.due_date)}</Text>
                  </View>
                ))}
              </View>
            )}
          </Panel>
        </View>

        <View style={{ flexGrow: 1, flexBasis: 360 }} className="gap-5">
          <Panel title="Top Contributors" icon="users" colors={colors}>
            {(data?.contributors || []).length === 0 ? <Empty label="No tracked time yet" colors={colors} /> : (
              <View className="gap-2.5">
                {data!.contributors.map(cb => (
                  <View key={cb.user_id}>
                    <View className="flex-row items-center mb-1.5">
                      <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: colors.primary + '22' }}>
                        <Text className="text-[10px] font-black" style={{ color: colors.primary }}>{initials(cb.full_name)}</Text>
                      </View>
                      <UserLink userId={cb.user_id} name={cb.full_name} numberOfLines={1} className="text-typography-label text-sm font-bold flex-1" />
                      <Text className="text-typography-main text-xs font-black ml-2">{fmtDuration(cb.tracked_seconds)}</Text>
                    </View>
                    <View className="h-1.5 rounded-full overflow-hidden ml-11" style={{ backgroundColor: colors.border }}>
                      <View style={{ width: `${Math.max(4, (cb.tracked_seconds / contribMax) * 100)}%`, height: '100%', backgroundColor: colors.primary, borderRadius: 999 }} />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Panel>

          <Panel title="Recent Tasks" icon="history" colors={colors}>
            {(data?.recent_tasks || []).length === 0 ? <Empty label="No tasks yet" colors={colors} /> : (
              <View className="gap-2">
                {data!.recent_tasks.map(r => (
                  <View key={r.id} className="flex-row items-center bg-surface-background border border-surface-border rounded-xl p-3">
                    <View style={{ width: 8, height: 8, borderRadius: 4, marginRight: 10, backgroundColor: r.is_complete ? colors.success : (r.stage_color || colors.muted) }} />
                    <Text numberOfLines={1} className="text-typography-main text-sm font-bold flex-1">{r.title}</Text>
                    <Text className="text-typography-muted text-[10px] font-bold uppercase ml-2">{r.stage_name || '—'}</Text>
                  </View>
                ))}
              </View>
            )}
          </Panel>
        </View>
      </View>
    </View>
  );
}

function Panel({ title, icon, colors, children }: { title: string; icon: string; colors: ReturnType<typeof useThemeColors>; children: React.ReactNode }) {
  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
      <View className="flex-row items-center gap-2 mb-4">
        <FontAwesome name={icon as any} size={12} color={colors.primary} />
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em]">{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Empty({ label, colors }: { label: string; colors: ReturnType<typeof useThemeColors> }) {
  return <View className="py-6 items-center"><Text className="text-typography-dim text-xs font-medium">{label}</Text></View>;
}
