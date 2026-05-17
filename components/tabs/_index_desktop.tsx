import PendingTimeApprovalsWidget from '@/components/common/PendingTimeApprovalsWidget';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';

// ── Types ────────────────────────────────────────────────────────────────

type DashboardStats = {
  totalTasks: number;
  activeNow: number;
  completed: number;
  failed: number;
  activeSessions: number;
};

type DashboardConfig = {
  pipelineIds: string[];
  successStageIds: string[];
  useAllPipelines?: boolean;
};

type PersonalPulse = {
  daily_points: number;
  monthly_points: number;
  active_seconds_today: number;
  flap_rate_score: number;
  is_working: boolean;
};

type ActivityEntry = {
  id: string;
  taskTitle: string;
  fromStage: string;
  toStage: string;
  movedBy: string;
  movedAt: string;
};

type ProjectSummary = {
  id: string;
  name: string;
  completionRate: number;
  totalTasks: number;
  completedTasks: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const timeAgo = (dateStr: string): string => {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

// ── Component ────────────────────────────────────────────────────────────

export default function DashboardScreenWeb() {
  const [stats, setStats] = useState<DashboardStats>({ totalTasks: 0, activeNow: 0, completed: 0, failed: 0, activeSessions: 0 });
  const [pulse, setPulse] = useState<PersonalPulse | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [widgetRefreshKey, setWidgetRefreshKey] = useState(0);

  const { user, profile } = useAuth();
  const router = useRouter();

  const displayName = useMemo(() => {
    return profile?.display_name || profile?.full_name || user?.user_metadata?.full_name || 'Operator';
  }, [profile, user]);

  const firstName = useMemo(() => displayName.split(' ')[0], [displayName]);

  // ── Data Fetching ──────────────────────────────────────────────────────

  const loadConfig = async () => {
    try {
      const saved = await AsyncStorage.getItem('@TrustFlow_dashboard_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        setConfig(parsed);
        return parsed;
      }
    } catch (e) {
      console.error('Failed to load dashboard config', e);
    }
    return null;
  };

  const fetchDashboardData = async (activeConfig?: DashboardConfig | null) => {
    try {
      const currentConfig = activeConfig !== undefined ? activeConfig : config;
      let targetPipelineIds: string[] = [];
      let successStageIds: string[] = [];
      let terminalStageIds: string[] = [];

      // Default to all pipelines when no config, or when useAllPipelines is set, or no pipelines selected
      const isAllPipelines =
        !currentConfig ||
        currentConfig.useAllPipelines === true ||
        currentConfig.pipelineIds.length === 0;

      if (isAllPipelines) {
        const { data: allPipelines } = await supabase
          .from('pipelines')
          .select('id')
          .is('deleted_at', null);
        targetPipelineIds = (allPipelines || []).map((p: any) => p.id);
      } else {
        targetPipelineIds = currentConfig!.pipelineIds;
      }

      if (targetPipelineIds.length === 0) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Fetch all terminal stages for the selected pipelines
      const { data: terminalStages } = await supabase
        .from('pipeline_stages')
        .select('id, terminal_type')
        .in('pipeline_id', targetPipelineIds)
        .eq('is_terminal', true);

      terminalStageIds = (terminalStages || []).map((s: any) => s.id);

      // Use configured success stages if explicitly set; otherwise auto-detect terminal_type='success'
      if (!isAllPipelines && currentConfig!.successStageIds.length > 0) {
        successStageIds = currentConfig!.successStageIds;
      } else {
        successStageIds = (terminalStages || [])
          .filter((s: any) => s.terminal_type === 'success')
          .map((s: any) => s.id);
      }

      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, current_stage_id')
        .in('pipeline_id', targetPipelineIds);

      const total = tasks?.length || 0;
      const completed = tasks?.filter((t: any) => successStageIds.includes(t.current_stage_id)).length || 0;
      const activeNow = tasks?.filter((t: any) => !terminalStageIds.includes(t.current_stage_id)).length || 0;
      // Tasks in a terminal stage that isn't a success stage (failed, rejected, cancelled)
      const failed = total - completed - activeNow;

      const { count: sessionCount } = await supabase
        .from('task_work_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      setStats({
        totalTasks: total,
        activeNow,
        completed,
        failed,
        activeSessions: sessionCount || 0,
      });

      const { data: historyData } = await supabase
        .from('pipeline_stage_history')
        .select(`
          id,
          transitioned_at,
          task:task_id(title, pipeline_id),
          from_stage:from_stage_id(name),
          to_stage:to_stage_id(name),
          transitioned_by_user:users!transitioned_by(full_name, display_name)
        `)
        .order('transitioned_at', { ascending: false })
        .limit(4);

      const activityEntries: ActivityEntry[] = (historyData || [])
        .filter((h: any) => targetPipelineIds.includes(h.task?.pipeline_id))
        .slice(0, 10)
        .map((h: any) => ({
          id: h.id,
          taskTitle: h.task?.title || 'Unknown Task',
          fromStage: h.from_stage?.name || '—',
          toStage: h.to_stage?.name || '—',
          movedBy: h.transitioned_by_user?.display_name || h.transitioned_by_user?.full_name || 'System',
          movedAt: h.transitioned_at,
        }));
      setActivity(activityEntries);

      const { data: rawProjects } = await supabase
        .from('projects')
        .select('id, name')
        .eq('status', 'active')
        .order('is_featured', { ascending: false })
        .limit(4);

      if (rawProjects && rawProjects.length > 0) {
        const projectIds = rawProjects.map((p: any) => p.id);
        const { data: projectStats } = await supabase.rpc('rpc_get_project_stats', {
          p_project_ids: projectIds,
        });

        const merged: ProjectSummary[] = rawProjects.map((p: any) => {
          const s = (projectStats || []).find((stat: any) => stat.project_id === p.id) || {
            total_tasks: 0, completed_tasks: 0, completion_rate: 0,
          };
          return {
            id: p.id,
            name: p.name,
            completionRate: s.completion_rate || 0,
            totalTasks: s.total_tasks || 0,
            completedTasks: s.completed_tasks || 0,
          };
        });
        setProjects(merged);
      }
    } catch (err) {
      console.error('[Dashboard] Data fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchPulse = async () => {
    try {
      const { data } = await supabase.rpc('rpc_get_personal_pulse');
      if (data) setPulse(data);
    } catch (err) {
      console.error('[Dashboard] Pulse fetch error:', err);
    }
  };

  useEffect(() => {
    const init = async () => {
      const loadedConfig = await loadConfig();
      fetchDashboardData(loadedConfig);
      fetchPulse();
    };
    init();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData();
    fetchPulse();
    setWidgetRefreshKey(k => k + 1);
  };

  const completionRate = stats.totalTasks > 0 ? Math.round((stats.completed / stats.totalTasks) * 100) : 0;
  const failedRate = stats.totalTasks > 0 ? Math.round((stats.failed / stats.totalTasks) * 100) : 0;

  const KPICard = ({
    icon,
    label,
    value,
    subtitle,
    accentType = 'brand',
  }: {
    icon: React.ComponentProps<typeof FontAwesome>['name'];
    label: string;
    value: number;
    subtitle: string;
    accentType?: 'brand' | 'success' | 'warning' | 'info' | 'danger';
  }) => {
    const iconBgClass =
      accentType === 'success' ? 'bg-state-success/10' :
      accentType === 'warning' ? 'bg-state-warning/10' :
      accentType === 'info' ? 'bg-state-info/10' :
      accentType === 'danger' ? 'bg-state-danger/10' :
      'bg-brand-primary/10';

    const iconBorderClass =
      accentType === 'success' ? 'border-state-success/20' :
      accentType === 'warning' ? 'border-var(--color-warning)/20' :
      accentType === 'info' ? 'border-state-info/20' :
      accentType === 'danger' ? 'border-var(--color-danger)/20' :
      'border-brand-primary/20';

    const iconColorClass =
      accentType === 'success' ? 'text-state-success' :
      accentType === 'warning' ? 'text-state-warning' :
      accentType === 'info' ? 'text-state-info' :
      accentType === 'danger' ? 'text-state-danger' :
      'text-brand-primary';

    const subtitleClass =
      accentType === 'success' ? 'text-state-success' :
      accentType === 'warning' ? 'text-state-warning' :
      accentType === 'info' ? 'text-state-info' :
      accentType === 'danger' ? 'text-state-danger' :
      'text-brand-primary';

    return (
      <View className="flex-1 min-w-[240px] bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
        <View className={`w-14 h-14 rounded-2xl ${iconBgClass} items-center justify-center mb-6 border ${iconBorderClass}`}>
          <FontAwesome name={icon} size={22} className={iconColorClass} />
        </View>
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-2">{label}</Text>
        <Text className="text-typography-main text-5xl font-black tracking-tighter">{value}</Text>
        <View className="mt-3 flex-row items-center">
          <Text className={`${subtitleClass} text-[10px] font-black uppercase tracking-widest`}>{subtitle}</Text>
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-surface-background"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="var(--color-primary)" />}
    >
      <View className="max-w-[1600px] mx-auto w-full p-10">
        <View className="mb-12 flex-row items-center justify-between">
          <View>
            <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[10px] mb-2">Command Center</Text>
            <Text className="text-typography-main text-5xl font-black tracking-tighter">
              {getGreeting()}, {firstName}
            </Text>
            <Text className="text-typography-muted text-lg mt-2 font-medium">
              Here's your operational overview for today.
            </Text>
          </View>

          <View className="flex-row items-center gap-4">
            <TouchableOpacity
              onPress={() => setShowSettings(true)}
              className="flex-row items-center bg-surface-card border border-surface-border px-6 py-4 rounded-2xl premium-shadow active:scale-95 transition-transform hover:border-brand-primary/50"
            >
              <FontAwesome name="cog" size={14} className="text-brand-primary" />
              <Text className="ml-3 font-black uppercase tracking-widest text-xs text-typography-main">Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onRefresh}
              className="flex-row items-center bg-surface-card border border-surface-border px-6 py-4 rounded-2xl premium-shadow active:scale-95 transition-transform hover:border-brand-primary/50"
            >
              <FontAwesome name="refresh" size={14} className="text-brand-primary" />
              <Text className="ml-3 font-black uppercase tracking-widest text-xs text-typography-main">Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View className="h-96 items-center justify-center bg-surface-card rounded-[32px] border border-surface-border">
            <ActivityIndicator size="large" color="var(--color-primary)" />
            <Text className="text-typography-muted mt-4 font-bold uppercase tracking-widest text-[10px]">Loading intelligence...</Text>
          </View>
        ) : (
          <View>
            {pulse && (
              <View className="mb-10 p-6 rounded-[32px] border border-surface-border bg-brand-primary/5 flex-row items-center justify-between premium-shadow">
                <View className="flex-row gap-10">
                  <View>
                    <Text className="text-[10px] text-brand-primary font-black uppercase tracking-widest mb-1">Today's Points</Text>
                    <View className="flex-row items-baseline">
                      <Text className="text-3xl font-black text-brand-primary">{pulse.daily_points}</Text>
                      <Text className="text-xs text-brand-primary/60 ml-1 font-bold">PTS</Text>
                    </View>
                  </View>
                  <View>
                    <Text className="text-[10px] text-typography-muted font-black uppercase tracking-widest mb-1">Active Time</Text>
                    <View className="flex-row items-baseline">
                      <Text className="text-3xl font-black text-typography-main">{Math.floor(pulse.active_seconds_today / 3600)}h</Text>
                      <Text className="text-xs text-typography-muted ml-1 font-bold">{Math.floor((pulse.active_seconds_today % 3600) / 60)}m</Text>
                    </View>
                  </View>
                  <View>
                    <Text className="text-[10px] text-typography-muted font-black uppercase tracking-widest mb-1">Flap Score</Text>
                    <Text className={`text-3xl font-black ${pulse.flap_rate_score > 1.5 ? 'text-state-danger' : 'text-state-success'}`}>
                      {pulse.flap_rate_score}x
                    </Text>
                  </View>
                </View>
                {pulse.is_working && (
                  <View className="flex-row items-center bg-state-success/10 px-5 py-3 rounded-full border border-state-success/20">
                    <View className="w-2.5 h-2.5 rounded-full bg-state-success mr-3 pulse-animation" />
                    <Text className="text-state-success text-[10px] font-black uppercase tracking-widest">Session Active</Text>
                  </View>
                )}
              </View>
            )}

            <View className="flex-row flex-wrap gap-6 mb-10">
              <PendingTimeApprovalsWidget refreshKey={widgetRefreshKey} />
              <KPICard
                icon="tasks"
                label="Total Pipeline"
                value={stats.totalTasks}
                subtitle="Across all stages"
                accentType="brand"
              />
              <KPICard
                icon="hourglass-half"
                label="In Progress"
                value={stats.activeNow}
                subtitle="In non-terminal stages"
                accentType="warning"
              />
              <KPICard
                icon="check-circle"
                label="Completed"
                value={stats.completed}
                subtitle={`${completionRate}% completion rate`}
                accentType="success"
              />
              {stats.failed > 0 ? (
                <KPICard
                  icon="times-circle"
                  label="Failed / Rejected"
                  value={stats.failed}
                  subtitle={`${failedRate}% of total pipeline`}
                  accentType="danger"
                />
              ) : (
                <KPICard
                  icon="bolt"
                  label="Live Sessions"
                  value={stats.activeSessions}
                  subtitle="Users working now"
                  accentType="info"
                />
              )}
            </View>

            {/* Show Live Sessions as a 5th card only when there are also failed tasks */}
            {stats.failed > 0 && stats.activeSessions > 0 && (
              <View className="flex-row mb-10">
                <View className="flex-1 min-w-[240px] bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow max-w-[300px]">
                  <View className="w-14 h-14 rounded-2xl bg-state-info/10 items-center justify-center mb-6 border border-state-info/20">
                    <FontAwesome name="bolt" size={22} className="text-state-info" />
                  </View>
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-2">Live Sessions</Text>
                  <Text className="text-typography-main text-5xl font-black tracking-tighter">{stats.activeSessions}</Text>
                  <Text className="text-state-info text-[10px] font-black uppercase tracking-widest mt-3">Users working now</Text>
                </View>
              </View>
            )}

            <View className="flex-row gap-8 mb-10">
              <View className="flex-[2] bg-surface-card p-10 rounded-[32px] border border-surface-border premium-shadow">
                <View className="flex-row items-center justify-between mb-8">
                  <View>
                    <Text className="text-typography-main text-2xl font-black tracking-tight">Pipeline Completion</Text>
                    <Text className="text-typography-muted text-xs mt-1 font-medium">
                      Task breakdown across all monitored pipelines.
                    </Text>
                  </View>
                  <View className="bg-brand-primary/10 px-5 py-2.5 rounded-full border border-brand-primary/20">
                    <Text className="text-brand-primary font-black text-xl">{completionRate}%</Text>
                  </View>
                </View>

                <View className="w-full h-4 bg-surface-background rounded-full overflow-hidden border border-surface-border mb-10">
                  <View
                    className="h-full bg-brand-primary rounded-full"
                    style={{ width: `${completionRate}%` }}
                  />
                </View>

                <View className="gap-6">
                  <View>
                    <View className="flex-row justify-between mb-2 px-1">
                      <Text className="text-typography-main font-bold text-sm">In Progress</Text>
                      <Text className="text-typography-muted font-bold text-[10px] uppercase tracking-widest">
                        {stats.activeNow} of {stats.totalTasks}
                      </Text>
                    </View>
                    <View className="w-full h-2 bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
                      <View
                        className="h-full bg-state-warning rounded-full"
                        style={{ width: `${stats.totalTasks > 0 ? (stats.activeNow / stats.totalTasks) * 100 : 0}%` }}
                      />
                    </View>
                  </View>

                  <View>
                    <View className="flex-row justify-between mb-2 px-1">
                      <Text className="text-typography-main font-bold text-sm">Completed</Text>
                      <Text className="text-typography-muted font-bold text-[10px] uppercase tracking-widest">
                        {stats.completed} of {stats.totalTasks}
                      </Text>
                    </View>
                    <View className="w-full h-2 bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
                      <View
                        className="h-full bg-state-success rounded-full"
                        style={{ width: `${completionRate}%` }}
                      />
                    </View>
                  </View>

                  {stats.failed > 0 && (
                    <View>
                      <View className="flex-row justify-between mb-2 px-1">
                        <Text className="text-typography-main font-bold text-sm">Failed / Rejected</Text>
                        <Text className="text-typography-muted font-bold text-[10px] uppercase tracking-widest">
                          {stats.failed} of {stats.totalTasks}
                        </Text>
                      </View>
                      <View className="w-full h-2 bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
                        <View
                          className="h-full bg-state-danger rounded-full"
                          style={{ width: `${failedRate}%` }}
                        />
                      </View>
                    </View>
                  )}
                </View>
              </View>

              <View className="flex-1 bg-surface-card p-10 rounded-[32px] border border-surface-border premium-shadow">
                <View className="flex-row items-center justify-between mb-8">
                  <View className="flex-row items-center gap-3">
                    <View className="w-1.5 h-4 bg-brand-primary rounded-full" />
                    <Text className="text-typography-main text-sm font-black uppercase tracking-widest">Recent Activity</Text>
                  </View>
                  <TouchableOpacity onPress={() => router.push('/pipelines')}>
                    <FontAwesome name="chevron-right" size={10} color="var(--color-brand-primary)" />
                  </TouchableOpacity>
                </View>

                {activity.length === 0 ? (
                  <View className="flex-1 items-center justify-center p-8 rounded-[24px] bg-surface-background/50 border border-dashed border-surface-border">
                    <Text className="text-typography-muted text-[10px] uppercase font-black tracking-widest">No Activity Yet</Text>
                  </View>
                ) : (
                  <View className="gap-0">
                    {activity.map((entry, idx) => (
                      <View
                        key={entry.id}
                        className={`flex-row items-center py-3 ${idx !== activity.length - 1 ? 'border-b border-surface-border/30' : ''}`}
                      >
                        <View className="w-8 h-8 rounded-lg bg-surface-background items-center justify-center mr-4 border border-surface-border">
                          <FontAwesome name="exchange" size={12} color="var(--color-brand-primary)" />
                        </View>
                        <View className="flex-1">
                          <Text className="text-typography-main font-bold text-xs" numberOfLines={1}>
                            {entry.taskTitle}
                          </Text>
                          <View className="flex-row items-center gap-1">
                            <Text className="text-typography-muted text-[9px] font-black uppercase tracking-tighter" numberOfLines={1}>{entry.fromStage}</Text>
                            <FontAwesome name="long-arrow-right" size={8} color="var(--color-brand-primary)" />
                            <Text className="text-brand-primary text-[9px] font-black uppercase tracking-tighter" numberOfLines={1}>{entry.toStage}</Text>
                          </View>
                        </View>
                        <View className="items-end">
                          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-tighter">
                            {timeAgo(entry.movedAt)}
                          </Text>
                          <Text className="text-typography-dim text-[9px] italic">{entry.movedBy}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>

            {projects.length > 0 && (
              <View className="mb-20">
                <View className="flex-row items-center justify-between mb-8">
                  <Text className="text-typography-main text-2xl font-black tracking-tight">Active Projects</Text>
                  <TouchableOpacity onPress={() => router.push('/projects')}>
                    <View className="flex-row items-center bg-surface-card border border-surface-border px-5 py-2.5 rounded-xl hover:border-brand-primary/50 transition-colors">
                      <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest mr-2">View All</Text>
                      <FontAwesome name="arrow-right" size={10} className="text-brand-primary" />
                    </View>
                  </TouchableOpacity>
                </View>
                <View className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                  {projects.map((project) => (
                    <TouchableOpacity
                      key={project.id}
                      onPress={() => router.push('/projects')}
                      className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow hover:border-brand-primary/50 transition-all"
                    >
                      <View className="flex-row items-center mb-4">
                        <View className="w-12 h-12 rounded-2xl bg-brand-primary/10 items-center justify-center mr-4 border border-brand-primary/20">
                          <FontAwesome name="folder-open" size={18} className="text-brand-primary" />
                        </View>
                        <View className="flex-1">
                          <Text className="text-typography-main font-black text-lg tracking-tight" numberOfLines={1}>{project.name}</Text>
                          <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">
                            {project.completedTasks} / {project.totalTasks} Tasks
                          </Text>
                        </View>
                      </View>
                      <View className="flex-row justify-between items-end mb-2">
                        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em]">Progress</Text>
                        <Text className="text-typography-main text-sm font-black">{Math.round(project.completionRate)}%</Text>
                      </View>
                      <View className="h-2.5 w-full bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
                        <View
                          style={{ width: `${project.completionRate}%` }}
                          className="h-full bg-brand-primary rounded-full"
                        />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      <DashboardSettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        config={config}
        onSave={async (newConfig) => {
          setConfig(newConfig);
          await AsyncStorage.setItem('@TrustFlow_dashboard_config', JSON.stringify(newConfig));
          fetchDashboardData(newConfig);
          setShowSettings(false);
        }}
      />
    </ScrollView>
  );
}

// ── Settings Modal ───────────────────────────────────────────────────────

function DashboardSettingsModal({ visible, onClose, config, onSave }: {
  visible: boolean;
  onClose: () => void;
  config: DashboardConfig | null;
  onSave: (config: DashboardConfig) => void;
}) {
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [selectedPipelines, setSelectedPipelines] = useState<string[]>([]);
  const [selectedSuccessStages, setSelectedSuccessStages] = useState<string[]>([]);
  const [useAllPipelines, setUseAllPipelines] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      fetchData();
      if (config) {
        setSelectedPipelines(config.pipelineIds || []);
        setSelectedSuccessStages(config.successStageIds || []);
        // Treat as "all pipelines" if explicitly set, or if no pipelines were manually selected
        if (config.useAllPipelines !== undefined) {
          setUseAllPipelines(config.useAllPipelines);
        } else {
          setUseAllPipelines((config.pipelineIds || []).length === 0);
        }
      } else {
        setUseAllPipelines(true);
        setSelectedPipelines([]);
        setSelectedSuccessStages([]);
      }
    }
  }, [visible, config]);

  const fetchData = async () => {
    setLoading(true);
    const { data: p } = await supabase.from('pipelines').select('id, name').is('deleted_at', null);
    const { data: s } = await supabase.from('pipeline_stages').select('id, name, pipeline_id, is_terminal, terminal_type').order('position', { ascending: true });
    setPipelines(p || []);
    setStages(s || []);
    setLoading(false);
  };

  const togglePipeline = (id: string) => {
    const isRemoving = selectedPipelines.includes(id);
    if (isRemoving) {
      setSelectedPipelines(prev => prev.filter(p => p !== id));
      // Remove all stages belonging to this pipeline from success stages
      const stageIds = stages.filter(s => s.pipeline_id === id).map(s => s.id);
      setSelectedSuccessStages(prev => prev.filter(sid => !stageIds.includes(sid)));
    } else {
      setSelectedPipelines(prev => [...prev, id]);
      // Auto-select terminal_type='success' stages for this pipeline
      const completedIds = stages
        .filter(s => s.pipeline_id === id && s.is_terminal && s.terminal_type === 'success')
        .map(s => s.id);
      setSelectedSuccessStages(prev => [...new Set([...prev, ...completedIds])]);
    }
  };

  const toggleStage = (id: string) => {
    setSelectedSuccessStages(prev => {
      if (prev.includes(id)) return prev.filter(s => s !== id);
      return [...prev, id];
    });
  };

  const handleSave = () => {
    if (useAllPipelines) {
      onSave({ pipelineIds: [], successStageIds: [], useAllPipelines: true });
    } else {
      onSave({ pipelineIds: selectedPipelines, successStageIds: selectedSuccessStages, useAllPipelines: false });
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center p-10">
        <View className="bg-surface-card w-full max-w-4xl rounded-[40px] border border-surface-border premium-shadow overflow-hidden max-h-[90vh]">
          <View className="p-10 border-b border-surface-border flex-row justify-between items-center">
            <View>
              <Text className="text-typography-main text-3xl font-black tracking-tight mb-2">Dashboard Configuration</Text>
              <Text className="text-typography-muted font-medium">Select pipelines to monitor and define success stages.</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-12 h-12 rounded-full bg-surface-background items-center justify-center border border-surface-border">
              <FontAwesome name="times" size={16} className="text-typography-dim" />
            </TouchableOpacity>
          </View>

          <ScrollView className="p-10">
            {loading ? (
              <ActivityIndicator size="large" color="var(--color-primary)" />
            ) : (
              <View>
                {/* All Pipelines Toggle */}
                <TouchableOpacity
                  onPress={() => setUseAllPipelines(v => !v)}
                  className={`p-6 rounded-3xl border mb-8 flex-row items-center justify-between ${useAllPipelines ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                >
                  <View className="flex-1 mr-6">
                    <Text className={`font-black text-base mb-1 ${useAllPipelines ? 'text-brand-primary' : 'text-typography-main'}`}>
                      Monitor All Pipelines
                    </Text>
                    <Text className="text-typography-muted text-xs font-medium">
                      Include every pipeline automatically. Success stages are auto-detected from{' '}
                      <Text className="text-state-success font-bold">terminal_type = success</Text> stages.
                    </Text>
                  </View>
                  <View
                    className={`w-14 h-8 rounded-full justify-center px-1 border-2 ${useAllPipelines ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                  >
                    <View
                      className="w-5 h-5 rounded-full bg-white"
                      style={{ alignSelf: useAllPipelines ? 'flex-end' : 'flex-start' }}
                    />
                  </View>
                </TouchableOpacity>

                {useAllPipelines && (
                  <View className="bg-surface-background p-6 rounded-3xl border border-surface-border mb-8">
                    <View className="flex-row items-center mb-3">
                      <FontAwesome name="check-circle" size={14} className="text-brand-primary" />
                      <Text className="text-brand-primary font-black text-xs ml-2 uppercase tracking-widest">Auto Mode Active</Text>
                    </View>
                    <Text className="text-typography-muted text-sm font-medium leading-relaxed">
                      All {pipelines.length} pipeline{pipelines.length !== 1 ? 's' : ''} are being monitored. Stages with{' '}
                      <Text className="text-state-success font-bold">terminal_type = success</Text> count toward the Completed metric.
                      Stages with other terminal types (failed, cancelled) are tracked separately as Failed/Rejected.
                    </Text>
                  </View>
                )}

                {!useAllPipelines && (
                  <>
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-6">Select Pipelines to Monitor</Text>
                    <View className="flex-row flex-wrap gap-4 mb-10">
                      {pipelines.map(p => (
                        <TouchableOpacity
                          key={p.id}
                          onPress={() => togglePipeline(p.id)}
                          className={`px-6 py-4 rounded-2xl border ${selectedPipelines.includes(p.id) ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                        >
                          <Text className={`font-black text-xs ${selectedPipelines.includes(p.id) ? 'text-white' : 'text-typography-main'}`}>{p.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {selectedPipelines.length > 0 && (
                      <>
                        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-3">Define Success Stages</Text>
                        <Text className="text-typography-muted text-xs mb-6 font-medium">
                          Completed terminal stages are pre-selected. Adjust as needed — these are the stages that count toward "Completed".
                        </Text>
                        <View className="gap-8">
                          {selectedPipelines.map(pid => {
                            const pipeline = pipelines.find(p => p.id === pid);
                            const pipelineStages = stages.filter(s => s.pipeline_id === pid);
                            return (
                              <View key={pid} className="bg-surface-background p-6 rounded-3xl border border-surface-border">
                                <Text className="text-typography-main font-black mb-4">{pipeline?.name}</Text>
                                <View className="flex-row flex-wrap gap-3">
                                  {pipelineStages.map(s => {
                                    const isSelected = selectedSuccessStages.includes(s.id);
                                    const terminalColor =
                                      s.terminal_type === 'success' ? 'text-state-success' :
                                      s.terminal_type === 'failure' ? 'text-state-danger' :
                                      'text-state-warning';
                                    const terminalBg =
                                      s.terminal_type === 'success' ? 'bg-state-success/20' :
                                      s.terminal_type === 'failure' ? 'bg-state-danger/20' :
                                      'bg-state-warning/20';
                                    return (
                                      <TouchableOpacity
                                        key={s.id}
                                        onPress={() => toggleStage(s.id)}
                                        className={`px-4 py-2 rounded-xl border flex-row items-center ${isSelected ? 'bg-state-success/20 border-state-success' : 'bg-surface-card border-surface-border'}`}
                                      >
                                        <FontAwesome
                                          name={isSelected ? 'check-square' : 'square-o'}
                                          size={14}
                                          className={isSelected ? 'text-state-success' : 'text-typography-dim'}
                                          style={{ marginRight: 8 }}
                                        />
                                        <Text className={`text-[11px] font-bold mr-2 ${isSelected ? 'text-state-success' : 'text-typography-muted'}`}>{s.name}</Text>
                                        {s.is_terminal && (
                                          <View className={`px-2 py-0.5 rounded-full ${terminalBg}`}>
                                            <Text className={`text-[8px] font-black uppercase ${terminalColor}`}>
                                              {s.terminal_type || 'terminal'}
                                            </Text>
                                          </View>
                                        )}
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      </>
                    )}
                  </>
                )}
              </View>
            )}
          </ScrollView>

          <View className="p-10 border-t border-surface-border flex-row gap-6 bg-surface-card/50">
            <TouchableOpacity onPress={onClose} className="flex-1 py-5 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              className="flex-1 py-5 rounded-2xl bg-brand-primary premium-shadow items-center"
            >
              <Text className="text-white font-black uppercase tracking-widest text-xs">Save Configuration</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
