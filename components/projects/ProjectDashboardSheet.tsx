import UserLink from '@/components/common/UserLink';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ProjectDashboardSheet({
  visible, projectId, onClose, onEdit,
}: {
  visible: boolean;
  projectId: string | null;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
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
  const catMax = useMemo(() => Math.max(1, ...(data?.by_category || []).map(x => x.count)), [data]);
  const contribMax = useMemo(() => Math.max(1, ...(data?.contributors || []).map(x => x.tracked_seconds)), [data]);

  const priorityColor = (p: string) =>
    p === 'urgent' ? c.danger : p === 'high' ? c.warning : p === 'low' ? c.muted : c.primary;

  const kpis = t ? [
    { label: 'Completion', value: `${Math.round(t.completion_rate)}%`, icon: 'check-circle', color: c.success },
    { label: 'Total', value: String(t.total), icon: 'tasks', color: c.primary },
    { label: 'Active', value: String(t.active), icon: 'bolt', color: c.accent },
    { label: 'Overdue', value: String(t.overdue), icon: 'exclamation-triangle', color: c.danger },
    { label: 'Tracked', value: fmtDuration(t.tracked_seconds), icon: 'clock-o', color: c.info },
    { label: 'Est. Hrs', value: `${Number(t.est_hours || 0)}h`, icon: 'hourglass-half', color: c.warning },
  ] : [];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
        {/* Header */}
        <View className="px-5 py-4 flex-row items-center justify-between border-b" style={{ borderColor: c.border }}>
          <TouchableOpacity onPress={onClose} className="w-10 h-10 items-center justify-center rounded-full" style={{ backgroundColor: c.card }}>
            <FontAwesome name="chevron-left" size={16} color={c.textMuted} />
          </TouchableOpacity>
          <View className="flex-1 items-center px-3">
            <Text className="text-[8px] font-black uppercase tracking-[0.3em]" style={{ color: c.primary }}>Project Intelligence</Text>
            <Text numberOfLines={1} className="text-base font-black tracking-tight" style={{ color: c.textMain }}>{data?.project?.name || 'Project'}</Text>
          </View>
          {onEdit ? (
            <TouchableOpacity onPress={onEdit} className="w-10 h-10 items-center justify-center rounded-full" style={{ backgroundColor: c.card }}>
              <FontAwesome name="pencil" size={14} color={c.textMuted} />
            </TouchableOpacity>
          ) : <View className="w-10" />}
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color={c.primary} /></View>
        ) : error ? (
          <View className="flex-1 items-center justify-center px-8">
            <FontAwesome name="exclamation-triangle" size={22} color={c.warning} />
            <Text className="text-sm font-bold mt-3 text-center" style={{ color: c.textMuted }}>{error}</Text>
          </View>
        ) : (
          <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>

            {/* Status + description */}
            <View className="flex-row items-center gap-2 mb-4">
              {data?.project?.is_featured && <FontAwesome name="star" size={14} color={c.warning} />}
              {data?.project?.status && (
                <View className="px-3 py-1 rounded-full border" style={{ borderColor: data.project.status === 'active' ? c.success + '66' : c.border }}>
                  <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: data.project.status === 'active' ? c.success : c.textMuted }}>{data.project.status}</Text>
                </View>
              )}
              {!!data?.project?.expiry_date && (
                <Text className="text-[10px] font-bold" style={{ color: c.textMuted }}>Due {fmtDate(data.project.expiry_date)}</Text>
              )}
            </View>
            {!!data?.project?.description && (
              <Text className="text-sm mb-5" style={{ color: c.textMuted }}>{data.project.description}</Text>
            )}

            {/* KPI grid — 2 per row */}
            <View className="flex-row flex-wrap" style={{ gap: 10 }}>
              {kpis.map(k => (
                <View key={k.label} className="rounded-2xl border p-4" style={{ width: '47.8%', flexGrow: 1, backgroundColor: c.card, borderColor: c.border }}>
                  <View className="flex-row items-center gap-2 mb-1.5">
                    <FontAwesome name={k.icon as any} size={11} color={k.color} />
                    <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: c.textMuted }}>{k.label}</Text>
                  </View>
                  <Text className="text-2xl font-black tracking-tight" style={{ color: c.textMain }}>{k.value}</Text>
                </View>
              ))}
            </View>

            {/* Weighted progress */}
            {t && (
              <View className="rounded-2xl border p-4 mt-3" style={{ backgroundColor: c.card, borderColor: c.border }}>
                <View className="flex-row justify-between items-end mb-2">
                  <Text className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: c.textMuted }}>Weighted Progress</Text>
                  <Text className="text-xs font-black" style={{ color: c.textMain }}>{Number(t.completed_weight)}/{Number(t.total_weight)} pts</Text>
                </View>
                <View className="h-2.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: c.border }}>
                  <View style={{ width: `${t.total_weight > 0 ? (Number(t.completed_weight) / Number(t.total_weight)) * 100 : 0}%`, height: '100%', backgroundColor: c.primary }} />
                </View>
              </View>
            )}

            {/* Pipeline distribution */}
            <Panel title="Pipeline Distribution" icon="sitemap" colors={c}>
              {(data?.by_stage || []).length === 0 ? <Empty label="No tasks in pipeline" colors={c} /> : (
                <View className="gap-3">
                  {data!.by_stage.map(s => (
                    <View key={s.stage_id}>
                      <View className="flex-row items-center justify-between mb-1.5">
                        <View className="flex-row items-center gap-2 flex-1 pr-2">
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color || c.primary }} />
                          <Text numberOfLines={1} className="text-sm font-bold flex-1" style={{ color: c.textMain }}>{s.name}</Text>
                        </View>
                        <Text className="text-xs font-black" style={{ color: c.textMain }}>{s.count}</Text>
                      </View>
                      <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: c.border }}>
                        <View style={{ width: `${Math.max(4, (s.count / stageMax) * 100)}%`, height: '100%', backgroundColor: s.color || c.primary, borderRadius: 999 }} />
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Panel>

            {/* Priority */}
            <Panel title="Priority Breakdown" icon="flag" colors={c}>
              {(data?.by_priority || []).length === 0 ? <Empty label="No tasks" colors={c} /> : (
                <View className="gap-2.5">
                  {data!.by_priority.map(p => (
                    <View key={p.priority} className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-2">
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: priorityColor(p.priority) }} />
                        <Text className="text-sm font-bold capitalize" style={{ color: c.textMain }}>{p.priority}</Text>
                      </View>
                      <Text className="text-sm font-black" style={{ color: c.textMain }}>{p.count}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Panel>

            {/* Category */}
            <Panel title="By Category" icon="tags" colors={c}>
              {(data?.by_category || []).length === 0 ? <Empty label="No categories" colors={c} /> : (
                <View className="gap-3">
                  {data!.by_category.map(ct => (
                    <View key={ct.category}>
                      <View className="flex-row items-center justify-between mb-1.5">
                        <Text numberOfLines={1} className="text-sm font-bold flex-1 pr-2" style={{ color: c.textMain }}>{ct.category}</Text>
                        <Text className="text-xs font-black" style={{ color: c.textMain }}>{ct.count}</Text>
                      </View>
                      <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: c.border }}>
                        <View style={{ width: `${Math.max(4, (ct.count / catMax) * 100)}%`, height: '100%', backgroundColor: c.accent, borderRadius: 999 }} />
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Panel>

            {/* Upcoming deadlines */}
            <Panel title="Upcoming Deadlines" icon="calendar" colors={c}>
              {(data?.due_soon || []).length === 0 ? <Empty label="No upcoming deadlines" colors={c} /> : (
                <View className="gap-2">
                  {data!.due_soon.map(d => (
                    <View key={d.id} className="flex-row items-center justify-between rounded-xl border p-3" style={{ backgroundColor: c.background, borderColor: c.border }}>
                      <View className="flex-1 pr-3">
                        <Text numberOfLines={1} className="text-sm font-bold" style={{ color: c.textMain }}>{d.title}</Text>
                        <Text className="text-[10px] font-medium mt-0.5" style={{ color: c.textMuted }}>{d.stage_name || '—'}</Text>
                      </View>
                      <Text className="text-[11px] font-black" style={{ color: d.overdue ? c.danger : c.textMuted }}>{fmtDate(d.due_date)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Panel>

            {/* Top contributors */}
            <Panel title="Top Contributors" icon="users" colors={c}>
              {(data?.contributors || []).length === 0 ? <Empty label="No tracked time yet" colors={c} /> : (
                <View className="gap-2.5">
                  {data!.contributors.map(cb => (
                    <View key={cb.user_id}>
                      <View className="flex-row items-center mb-1.5">
                        <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: c.primary + '22' }}>
                          <Text className="text-[10px] font-black" style={{ color: c.primary }}>{initials(cb.full_name)}</Text>
                        </View>
                        <UserLink userId={cb.user_id} name={cb.full_name} numberOfLines={1} className="text-sm font-bold flex-1" style={{ color: c.textMain }} />
                        <Text className="text-xs font-black ml-2" style={{ color: c.textMain }}>{fmtDuration(cb.tracked_seconds)}</Text>
                      </View>
                      <View className="h-1.5 rounded-full overflow-hidden ml-11" style={{ backgroundColor: c.border }}>
                        <View style={{ width: `${Math.max(4, (cb.tracked_seconds / contribMax) * 100)}%`, height: '100%', backgroundColor: c.primary, borderRadius: 999 }} />
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Panel>

            {/* Recent tasks */}
            <Panel title="Recent Tasks" icon="history" colors={c}>
              {(data?.recent_tasks || []).length === 0 ? <Empty label="No tasks yet" colors={c} /> : (
                <View className="gap-2">
                  {data!.recent_tasks.map(r => (
                    <View key={r.id} className="flex-row items-center rounded-xl border p-3" style={{ backgroundColor: c.background, borderColor: c.border }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, marginRight: 10, backgroundColor: r.is_complete ? c.success : (r.stage_color || c.muted) }} />
                      <Text numberOfLines={1} className="text-sm font-bold flex-1" style={{ color: c.textMain }}>{r.title}</Text>
                      <Text className="text-[10px] font-bold uppercase ml-2" style={{ color: c.textMuted }}>{r.stage_name || '—'}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Panel>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function Panel({ title, icon, colors, children }: { title: string; icon: string; colors: ReturnType<typeof useThemeColors>; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl border p-4 mt-3" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
      <View className="flex-row items-center gap-2 mb-3.5">
        <FontAwesome name={icon as any} size={12} color={colors.primary} />
        <Text className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: colors.textMuted }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Empty({ label, colors }: { label: string; colors: ReturnType<typeof useThemeColors> }) {
  return <View className="py-5 items-center"><Text className="text-xs font-medium" style={{ color: colors.textDim }}>{label}</Text></View>;
}
