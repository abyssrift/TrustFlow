import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

// ── Types mirror rpc_project_dashboard ────────────────────────────────────────
type Totals = {
  total: number; completed: number; overdue: number; active: number;
  completion_rate: number; total_weight: number; completed_weight: number;
  est_hours: number; tracked_seconds: number;
};
type StageRow = { stage_id: string; name: string; color: string | null; position: number; is_terminal: boolean; terminal_type: string | null; count: number };
type PriorityRow = { priority: string; count: number };
type CategoryRow = { category: string; count: number };
type ContributorRow = { user_id: string; full_name: string | null; avatar_url: string | null; tracked_seconds: number; tasks: number };
type RecentRow = { id: string; title: string; priority: string; stage_name: string | null; stage_color: string | null; due_date: string | null; created_at: string; is_complete: boolean };
type DueRow = { id: string; title: string; due_date: string; stage_name: string | null; overdue: boolean };
type Dashboard = {
  project: { id: string; name: string; description: string | null; status: string; expiry_date: string | null; is_featured: boolean; created_at: string };
  totals: Totals;
  by_priority: PriorityRow[];
  by_stage: StageRow[];
  by_category: CategoryRow[];
  contributors: ContributorRow[];
  recent_tasks: RecentRow[];
  due_soon: DueRow[];
};

function fmtDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0h';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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

export default function ProjectDashboard({
  visible, projectId, onClose, onEdit,
}: {
  visible: boolean;
  projectId: string | null;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const colors = useThemeColors();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);

  useEffect(() => {
    if (!visible || !projectId) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      const { data: res, error: err } = await supabase.rpc('rpc_project_dashboard', { p_project_id: projectId });
      if (cancelled) return;
      if (err) { setError(err.message); setData(null); }
      else setData(res as Dashboard);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [visible, projectId]);

  const t = data?.totals;
  const stageMax = useMemo(() => Math.max(1, ...(data?.by_stage || []).map(s => s.count)), [data]);
  const catMax = useMemo(() => Math.max(1, ...(data?.by_category || []).map(c => c.count)), [data]);
  const contribMax = useMemo(() => Math.max(1, ...(data?.contributors || []).map(c => c.tracked_seconds)), [data]);

  if (!visible) return null;

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

  return (
    <View className="absolute inset-0 z-[999] items-center justify-center p-6" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <View className="bg-surface-card w-full rounded-[2rem] border border-surface-border overflow-hidden premium-shadow-lg flex-col" style={{ maxWidth: 1400, maxHeight: '92%' }}>

        {/* Header */}
        <View className="px-8 py-6 border-b border-surface-border flex-row items-start justify-between">
          <View className="flex-1 pr-6">
            <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Project Intelligence</Text>
            <View className="flex-row items-center gap-3">
              {data?.project?.is_featured && <FontAwesome name="star" size={18} color={colors.warning} />}
              <Text className="text-typography-main text-3xl font-black tracking-tight" numberOfLines={1}>
                {data?.project?.name || 'Project'}
              </Text>
              {data?.project?.status && (
                <View className={`px-3 py-1 rounded-full border ${data.project.status === 'active' ? 'border-state-success/40' : 'border-surface-border'}`}>
                  <Text className={`text-[9px] font-black uppercase tracking-widest ${data.project.status === 'active' ? 'text-state-success' : 'text-typography-muted'}`}>{data.project.status}</Text>
                </View>
              )}
            </View>
            {!!data?.project?.description && (
              <Text className="text-typography-muted text-sm mt-2 max-w-3xl" numberOfLines={2}>{data.project.description}</Text>
            )}
          </View>
          <View className="flex-row items-center gap-3">
            {onEdit && (
              <TouchableOpacity onPress={onEdit} className="flex-row items-center gap-2 px-4 h-10 bg-surface-background border border-surface-border rounded-xl hover:bg-surface-overlay">
                <FontAwesome name="pencil" size={12} color={colors.textMuted} />
                <Text className="text-typography-muted font-black text-xs uppercase tracking-wider">Edit</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} className="w-10 h-10 items-center justify-center bg-surface-background border border-surface-border rounded-full hover:bg-surface-overlay">
              <FontAwesome name="times" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View className="items-center justify-center py-32"><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : error ? (
          <View className="items-center justify-center py-32 px-8">
            <FontAwesome name="exclamation-triangle" size={24} color={colors.warning} />
            <Text className="text-typography-muted font-bold mt-3 text-center">{error}</Text>
          </View>
        ) : (
          <ScrollView className="px-8 py-6" contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>

            {/* KPI cards */}
            <View className="flex-row flex-wrap gap-4">
              {kpis.map(k => (
                <View key={k.label} className="bg-surface-background border border-surface-border rounded-2xl p-5" style={{ flexGrow: 1, flexBasis: 160 }}>
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
              <View className="bg-surface-background border border-surface-border rounded-2xl p-5 mt-4">
                <View className="flex-row justify-between items-end mb-2">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em]">Weighted Progress</Text>
                  <Text className="text-typography-main text-sm font-black">{t.completed} / {t.total} tasks · {Number(t.completed_weight)}/{Number(t.total_weight)} pts</Text>
                </View>
                <View className="h-3 w-full bg-surface-card rounded-full overflow-hidden border border-surface-border/50">
                  <View style={{ width: `${t.total_weight > 0 ? (Number(t.completed_weight) / Number(t.total_weight)) * 100 : 0}%`, height: '100%', backgroundColor: colors.primary }} />
                </View>
              </View>
            )}

            {/* Multi-column body */}
            <View className="flex-row flex-wrap gap-5 mt-5">

              {/* Column 1 — Pipeline + Priority */}
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

              {/* Column 2 — Category + Deadlines */}
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

              {/* Column 3 — Contributors + Recent */}
              <View style={{ flexGrow: 1, flexBasis: 360 }} className="gap-5">
                <Panel title="Top Contributors" icon="users" colors={colors}>
                  {(data?.contributors || []).length === 0 ? <Empty label="No tracked time yet" colors={colors} /> : (
                    <View className="gap-2.5">
                      {data!.contributors.map((cb, i) => (
                        <View key={cb.user_id}>
                          <View className="flex-row items-center mb-1.5">
                            <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: colors.primary + '22' }}>
                              <Text className="text-[10px] font-black" style={{ color: colors.primary }}>{initials(cb.full_name)}</Text>
                            </View>
                            <Text numberOfLines={1} className="text-typography-label text-sm font-bold flex-1">{cb.full_name || 'Unknown'}</Text>
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
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function Panel({ title, icon, colors, children }: { title: string; icon: string; colors: ReturnType<typeof useThemeColors>; children: React.ReactNode }) {
  return (
    <View className="bg-surface-background border border-surface-border rounded-2xl p-5">
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
