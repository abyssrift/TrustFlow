import PipelineOverviewChart, { DEFAULT_OVERVIEW_METRICS, OverviewMetricKey } from '@/components/intelligence/PipelineOverviewChart';
import BlockedExceptionsPanel from '@/components/dashboard/BlockedExceptionsPanel';
import DashboardFacts, { type Fact } from '@/components/dashboard/DashboardFacts';
import ProjectionStrip from '@/components/dashboard/ProjectionStrip';
import LiveSessionsPopup from '@/components/tabs/LiveSessionsPopup';
import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import { EntityGlyph, ProgressMeter } from '@/components/entities/EntityUI';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardProjects } from '@/hooks/useDashboardProjects';
import { useThemeColors } from '@/hooks/useThemeColors';
import { isAuthError, supabase, triggerAuthError } from '@/lib/supabase';
import { formatCompact, formatRelative } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';

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
  // Overview graph customization (analytics.view holders only). Local per-device.
  overviewMetrics?: OverviewMetricKey[];
  overviewPeriod?: 'week' | 'month';
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
  taskId: string;
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
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const timeAgo = (dateStr: string): string => formatRelative(dateStr);

// ── Component ────────────────────────────────────────────────────────────

export default function DashboardScreenWeb() {
  const colors = useThemeColors();
  const [stats, setStats] = useState<DashboardStats>({ totalTasks: 0, activeNow: 0, completed: 0, failed: 0, activeSessions: 0 });
  const [showLiveSessions, setShowLiveSessions] = useState(false);
  const [pulse, setPulse] = useState<PersonalPulse | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [trackedPipelineIds, setTrackedPipelineIds] = useState<string[]>([]);
  const [widgetRefreshKey, setWidgetRefreshKey] = useState(0);

  const { user, profile, hasPermission } = useAuth();
  const router = useRouter();
  const canViewIntelligence = hasPermission('report.view');
  const canViewOverview = hasPermission('analytics.view');

  // ONE rpc_projects_table read, shared by the projection strip and the
  // exceptions panel below it (they used to fire the same 500-row call twice).
  // Named `dashProjects` because `projects` above is the four-card summary from
  // a different query — two things called `projects` in one scope was exactly
  // the redeclaration that broke the previous attempt at this screen.
  const dashProjects = useDashboardProjects(widgetRefreshKey);

  const overviewMetrics = config?.overviewMetrics ?? DEFAULT_OVERVIEW_METRICS;
  const overviewPeriod = config?.overviewPeriod ?? 'week';

  const persistConfig = async (next: DashboardConfig) => {
    setConfig(next);
    try {
      await AsyncStorage.setItem('@TrustFlow_dashboard_config', JSON.stringify(next));
    } catch (e) {
      console.error('Failed to persist dashboard config', e);
    }
  };

  // Overview toggles only affect the self-fetching chart — no full dashboard reload.
  const toggleOverviewMetric = (key: OverviewMetricKey) => {
    const base = config ?? { pipelineIds: [], successStageIds: [], useAllPipelines: true };
    const cur = base.overviewMetrics ?? DEFAULT_OVERVIEW_METRICS;
    const nextMetrics = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    persistConfig({ ...base, overviewMetrics: nextMetrics });
  };

  const setOverviewPeriod = (p: 'week' | 'month') => {
    const base = config ?? { pipelineIds: [], successStageIds: [], useAllPipelines: true };
    persistConfig({ ...base, overviewPeriod: p });
  };

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
        const { data: allPipelines, error: pipelineError } = await supabase
          .from('pipelines')
          .select('id')
          .is('deleted_at', null);
        if (isAuthError(pipelineError)) {
          triggerAuthError();
          return;
        }
        targetPipelineIds = (allPipelines || []).map((p: any) => p.id);
      } else {
        targetPipelineIds = currentConfig!.pipelineIds;
      }

      // Expose the resolved tracked set to the overview graph.
      setTrackedPipelineIds(targetPipelineIds);

      if (targetPipelineIds.length === 0) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Fetch all terminal stages for the selected pipelines
      const { data: terminalStages, error: stageError } = await supabase
        .from('pipeline_stages')
        .select('id, terminal_type')
        .in('pipeline_id', targetPipelineIds)
        .eq('is_terminal', true);
      if (isAuthError(stageError)) {
        triggerAuthError();
        return;
      }

      terminalStageIds = (terminalStages || []).map((s: any) => s.id);

      // Use configured success stages if explicitly set; otherwise auto-detect terminal_type='success'
      if (!isAllPipelines && currentConfig!.successStageIds.length > 0) {
        successStageIds = currentConfig!.successStageIds;
      } else {
        successStageIds = (terminalStages || [])
          .filter((s: any) => s.terminal_type === 'success')
          .map((s: any) => s.id);
      }

      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('id, current_stage_id')
        .in('pipeline_id', targetPipelineIds);
      if (isAuthError(tasksError)) {
        triggerAuthError();
        return;
      }

      const total = tasks?.length || 0;
      const completed = tasks?.filter((t: any) => successStageIds.includes(t.current_stage_id)).length || 0;
      const activeNow = tasks?.filter((t: any) => !terminalStageIds.includes(t.current_stage_id)).length || 0;
      // Tasks in a terminal stage that isn't a success stage (failed, rejected, cancelled)
      const failed = total - completed - activeNow;

      const { data: sessionRows, error: sessionError } = await supabase
        .from('task_work_sessions')
        .select('user_id, started_at, last_heartbeat_at, user:user_id(full_name, avatar_url)')
        .eq('status', 'active');
      if (isAuthError(sessionError)) {
        triggerAuthError();
        return;
      }
      // One session per person, even if they somehow hold several. The avatar
      // row this used to build lived inside a KPI card that no longer exists;
      // LiveSessionsPopup fetches its own people when you open it.
      const sessionCount = new Set((sessionRows || []).map((s: any) => s.user_id)).size;

      setStats({
        totalTasks: total,
        activeNow,
        completed,
        failed,
        activeSessions: sessionCount || 0,
      });

      const { data: historyData, error: historyError } = await supabase
        .from('pipeline_stage_history')
        .select(`
          id,
          transitioned_at,
          task_id,
          task:task_id(title, pipeline_id),
          from_stage:from_stage_id(name),
          to_stage:to_stage_id(name),
          transitioned_by_user:users!transitioned_by(full_name, display_name)
        `)
        .order('transitioned_at', { ascending: false })
        .limit(20);
      if (isAuthError(historyError)) {
        triggerAuthError();
        return;
      }

      const activityEntries: ActivityEntry[] = (historyData || [])
        .filter((h: any) => targetPipelineIds.includes(h.task?.pipeline_id))
        .slice(0, 20)
        .map((h: any) => ({
          id: h.id,
          taskId: h.task_id,
          taskTitle: h.task?.title || 'Unknown Task',
          fromStage: h.from_stage?.name || '-',
          toStage: h.from_stage ? (h.to_stage?.name || '—') : 'created',
          movedBy: h.transitioned_by_user?.display_name || h.transitioned_by_user?.full_name || 'System',
          movedAt: h.transitioned_at,
        }));
      setActivity(activityEntries);

      const { data: rawProjects, error: projectsError } = await supabase
        .from('projects')
        .select('id, name')
        .eq('status', 'active')
        .order('is_featured', { ascending: false })
        .limit(4);
      if (isAuthError(projectsError)) {
        triggerAuthError();
        return;
      }

      if (rawProjects && rawProjects.length > 0) {
        const projectIds = rawProjects.map((p: any) => p.id);
        const { data: projectStats, error: statsError } = await supabase.rpc('rpc_get_project_stats', {
          p_project_ids: projectIds,
        });
        if (isAuthError(statsError)) {
          triggerAuthError();
          return;
        }

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
      const { data, error } = await supabase.rpc('rpc_get_personal_pulse');
      if (isAuthError(error)) {
        triggerAuthError();
        return;
      }
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

  // ONE row of facts, in place of a three-stat pulse band and four 240px cards.
  // Anything that is zero is passed as null and never rendered at all — see
  // DashboardFacts. On a young workspace this row is two items long, and on a
  // brand-new one it is empty and disappears.
  const facts: Fact[] = [
    { value: stats.totalTasks > 0 ? String(stats.totalTasks) : null, label: 'in pipeline', onPress: () => router.push('/tasks' as any) },
    { value: stats.activeNow > 0 ? String(stats.activeNow) : null, label: 'in progress', onPress: () => router.push('/tasks' as any) },
    { value: stats.completed > 0 ? String(stats.completed) : null, label: `done · ${completionRate}%`, tone: colors.success, onPress: () => router.push('/intelligence/archives' as any) },
    { value: stats.failed > 0 ? String(stats.failed) : null, label: `failed · ${failedRate}%`, tone: colors.danger, onPress: () => router.push('/intelligence/archives' as any) },
    // Presence, not a tally — so it does NOT follow the hide-when-zero rule the
    // other facts do. "0 working now" answers the question you asked; a missing
    // row leaves you wondering whether nobody is working or the dot is broken.
    { value: String(stats.activeSessions), label: 'working now', live: true, onPress: () => setShowLiveSessions(true) },
    { value: pulse && pulse.daily_points > 0 ? String(pulse.daily_points) : null, label: 'pts today' },
    { value: pulse && pulse.active_seconds_today > 0 ? formatCompact(pulse.active_seconds_today) : null, label: 'active' },
    // A good flap score is not news. It appears only when it is a problem —
    // the same threshold the old band coloured it red at.
    { value: pulse && pulse.flap_rate_score > 1.5 ? `${pulse.flap_rate_score}x` : null, label: 'task switching', tone: colors.danger },
  ];

  return (
    <ScrollView
      className="flex-1 bg-surface-background"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View className="max-w-[1280px] mx-auto w-full px-8 py-8">
        <View className="mb-7 flex-row items-start justify-between gap-6">
          <View className="flex-1 min-w-0">
            <Text className="text-typography-main text-2xl font-black tracking-tight">
              {getGreeting()}, {firstName}
            </Text>
            {/* The strapline said "Here's your operational overview for today"
                and carried no information. The facts line says what the day
                actually looks like, in the same space. */}
            <View className="mt-1.5">
              <DashboardFacts facts={facts} />
            </View>
          </View>

          {/* Two icon buttons, not two labelled pills. They are the least
              important controls on the page and used to be the loudest. */}
          <View className="flex-row items-center gap-2 pt-1">
            <Tooltip label="Choose which pipelines this dashboard tracks">
              <TouchableOpacity
                onPress={() => setShowSettings(true)}
                accessibilityRole="button"
                accessibilityLabel="Dashboard settings"
                className="rounded-xl border border-surface-border hover:bg-surface-overlay items-center justify-center transition-colors"
                style={{ width: 44, height: 44 }}
              >
                <FontAwesome name="sliders" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </Tooltip>
            <Tooltip label="Refresh">
              <TouchableOpacity
                onPress={onRefresh}
                accessibilityRole="button"
                accessibilityLabel="Refresh dashboard"
                className="rounded-xl border border-surface-border hover:bg-surface-overlay items-center justify-center transition-colors"
                style={{ width: 44, height: 44 }}
              >
                <FontAwesome name="refresh" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          </View>
        </View>

        {loading ? (
          <View className="py-24 items-center justify-center">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View>
            <LiveSessionsPopup visible={showLiveSessions} onClose={() => setShowLiveSessions(false)} />

            {/* The one place this screen spends any boldness. Renders nothing
                at all — no card, no heading, no empty state — when the server
                has forecast nothing. */}
            <ProjectionStrip rows={dashProjects.rows} loading={dashProjects.state === 'loading'} />

            <BlockedExceptionsPanel
              rows={dashProjects.rows}
              state={dashProjects.state}
              reload={dashProjects.reload}
              canView={dashProjects.canView}
            />

            {/* items-start, not the default stretch: the activity card used to
                be grown to the chart's height and then have its row count
                measured to fill it, which on a quiet day meant one entry
                floating in ~400px of empty card. It is now as tall as what it
                has to say. */}
            <View className="flex-row gap-6 mb-8 items-start">
              {canViewOverview ? (
                <PipelineOverviewChart
                  className="flex-[2]"
                  pipelineIds={trackedPipelineIds}
                  metrics={overviewMetrics}
                  period={overviewPeriod}
                  onToggleMetric={toggleOverviewMetric}
                  onSetPeriod={setOverviewPeriod}
                  onCustomize={() => setShowSettings(true)}
                  refreshKey={widgetRefreshKey}
                />
              ) : (
              <View className="flex-[2] bg-surface-card p-6 rounded-2xl border border-surface-border">
                <View className="flex-row items-center justify-between mb-4">
                  <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-[0.12em]">Pipeline completion</Text>
                  <Text className="text-typography-main text-base font-bold">{completionRate}%</Text>
                </View>

                <View className="w-full h-2 bg-surface-background rounded-full overflow-hidden border border-surface-border mb-5">
                  <View
                    className="h-full bg-brand-primary rounded-full"
                    style={{ width: `${completionRate}%` }}
                  />
                </View>

                <View className="gap-4">
                  <View>
                    <View className="flex-row justify-between mb-1.5">
                      <Text className="text-typography-main text-xs font-semibold">In progress</Text>
                      <Text className="text-typography-muted text-xs">{stats.activeNow} of {stats.totalTasks}</Text>
                    </View>
                    <View className="w-full h-1.5 bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
                      <View
                        className="h-full bg-state-warning rounded-full"
                        style={{ width: `${stats.totalTasks > 0 ? (stats.activeNow / stats.totalTasks) * 100 : 0}%` }}
                      />
                    </View>
                  </View>

                  <View>
                    <View className="flex-row justify-between mb-1.5">
                      <Text className="text-typography-main text-xs font-semibold">Completed</Text>
                      <Text className="text-typography-muted text-xs">{stats.completed} of {stats.totalTasks}</Text>
                    </View>
                    <View className="w-full h-1.5 bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
                      <View
                        className="h-full bg-state-success rounded-full"
                        style={{ width: `${completionRate}%` }}
                      />
                    </View>
                  </View>

                  {stats.failed > 0 && (
                    <View>
                      <View className="flex-row justify-between mb-1.5">
                        <Text className="text-typography-main text-xs font-semibold">Failed / rejected</Text>
                        <Text className="text-typography-muted text-xs">{stats.failed} of {stats.totalTasks}</Text>
                      </View>
                      <View className="w-full h-1.5 bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
                        <View
                          className="h-full bg-state-danger rounded-full"
                          style={{ width: `${failedRate}%` }}
                        />
                      </View>
                    </View>
                  )}
                </View>
              </View>
              )}

              <View className="flex-1 bg-surface-card p-6 rounded-2xl border border-surface-border">
                <View className="flex-row items-center justify-between mb-4">
                  <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-[0.12em]">Recent activity</Text>
                  {canViewIntelligence && (
                    <TouchableOpacity
                      onPress={() => router.push('/intelligence' as any)}
                      accessibilityRole="button"
                      accessibilityLabel="Open Intelligence"
                      className="items-center justify-center"
                      style={{ width: 24, height: 24 }}
                    >
                      <FontAwesome name="chevron-right" size={10} color={colors.textDim} />
                    </TouchableOpacity>
                  )}
                </View>

                {activity.length === 0 ? (
                  // A quiet line, not a dashed box that stretches to match the
                  // chart beside it. Nothing happened; that needs one sentence.
                  <Text className="text-typography-dim text-xs">Nothing has moved yet.</Text>
                ) : (
                  <View className="gap-0">
                    {/* A flat 5. The card no longer stretches, so there is no
                        height to measure and fill — the onLayout/row-count
                        arithmetic that used to live here went with it. */}
                    {activity
                      .slice(0, 5)
                      .map((entry, idx, visible) => (
                      <TouchableOpacity
                        key={entry.id}
                        activeOpacity={0.6}
                        disabled={!entry.taskId}
                        onPress={() => entry.taskId && router.push(`/task/${entry.taskId}` as any)}
                        className={`flex-row items-center py-2.5 ${idx !== visible.length - 1 ? 'border-b border-surface-border/30' : ''}`}
                      >
                        {/* The 32px bordered medallion that used to sit here
                            carried no information — every row had the same
                            icon. The stage pair below already says "moved". */}
                        <View className="flex-1 pr-3">
                          <Text className="text-typography-main font-semibold text-xs" numberOfLines={1}>
                            {entry.taskTitle}
                          </Text>
                          <View className="flex-row items-center gap-1">
                            <Text className="text-typography-dim text-[10px]" numberOfLines={1}>{entry.fromStage}</Text>
                            <FontAwesome name="long-arrow-right" size={8} color={colors.textDim} />
                            <Text className="text-typography-muted text-[10px]" numberOfLines={1}>{entry.toStage}</Text>
                          </View>
                        </View>
                        <View className="items-end">
                          <Text className="text-typography-dim text-[10px]">{timeAgo(entry.movedAt)}</Text>
                          <Text className="text-typography-dim text-[10px]" numberOfLines={1}>{entry.movedBy}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </View>

            {/* Four 200px cards holding a name and one percentage became four
                44px rows in a single card: the same information at roughly a
                quarter of the height. ProgressMeter is EntityUI's, so this
                reads identically to the meter on every project surface. */}
            {projects.length > 0 && (
              <View className="mb-12">
                <View className="flex-row items-center justify-between mb-2.5">
                  <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-[0.12em]">Active projects</Text>
                  <TouchableOpacity
                    onPress={() => router.push('/projects')}
                    accessibilityRole="button"
                    accessibilityLabel="Open Projects"
                    className="flex-row items-center gap-1.5 justify-center"
                    style={{ minHeight: 44, paddingHorizontal: 4 }}
                  >
                    <Text className="text-brand-primary text-xs font-bold">All projects</Text>
                    <FontAwesome name="arrow-right" size={9} color={colors.primary} />
                  </TouchableOpacity>
                </View>
                <View className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
                  {projects.map((project, idx) => (
                    <TouchableOpacity
                      key={project.id}
                      onPress={() => router.push(`/projects/${project.id}` as any)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${project.name}, ${Math.round(project.completionRate)} percent complete`}
                      className={`flex-row items-center gap-4 px-4 hover:bg-surface-overlay/40 transition-colors ${idx !== projects.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                      style={{ minHeight: 44 }}
                    >
                      <EntityGlyph kind="project" size={18} />
                      <Text className="text-typography-main text-xs font-semibold flex-1" numberOfLines={1}>{project.name}</Text>
                      <Text className="text-typography-dim text-[10px]">{project.completedTasks}/{project.totalTasks}</Text>
                      <View style={{ width: 120 }}>
                        <ProgressMeter percent={project.completionRate} showCaption={false} height={4} />
                      </View>
                      <Text className="text-typography-muted text-[10px] font-semibold" style={{ width: 32, textAlign: 'right' }}>
                        {Math.round(project.completionRate)}%
                      </Text>
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
          // Preserve overview-graph customization, which the pipeline-selection modal doesn't touch.
          const merged: DashboardConfig = {
            ...newConfig,
            overviewMetrics: config?.overviewMetrics,
            overviewPeriod: config?.overviewPeriod,
          };
          setConfig(merged);
          await AsyncStorage.setItem('@TrustFlow_dashboard_config', JSON.stringify(merged));
          fetchDashboardData(merged);
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
  const colors = useThemeColors();

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
    const { data: p, error: pipelineError } = await supabase.from('pipelines').select('id, name').is('deleted_at', null);
    if (isAuthError(pipelineError)) {
      triggerAuthError();
      setLoading(false);
      return;
    }
    const { data: s, error: stageError } = await supabase.from('pipeline_stages').select('id, name, pipeline_id, is_terminal, terminal_type').order('position', { ascending: true });
    if (isAuthError(stageError)) {
      triggerAuthError();
      setLoading(false);
      return;
    }
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

  // Was a raw RN `Modal`, which the repo's popup rule forbids outright. Now a
  // Popup sized for what it actually holds — one toggle plus optional
  // pipeline/stage pickers — so it reads proportionally instead of dominating
  // the dashboard view. Kept above the 420 one-column floor: two-column stage
  // chips need the room, but the 720 center band is enough for that, not 896.
  return (
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={720} maxHeight="90%">
        <View className="flex-1">
          <View className="p-5 border-b border-surface-border flex-row justify-between items-center">
            <View className="flex-1 pr-4">
              <Text className="text-typography-main text-lg font-black tracking-tight">Dashboard configuration</Text>
              <Text className="text-typography-muted text-xs mt-0.5">Choose which pipelines to monitor and which stages count as done.</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              className="rounded-full bg-surface-background items-center justify-center border border-surface-border"
              style={{ width: 40, height: 40 }}
            >
              <FontAwesome name="times" size={14} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          <ScrollView className="p-5">
            {loading ? (
              <ActivityIndicator size="large" color={colors.primary} />
            ) : (
              <View>
                {/* All Pipelines Toggle */}
                <TouchableOpacity
                  onPress={() => setUseAllPipelines(v => !v)}
                  className={`p-4 rounded-2xl border mb-5 flex-row items-center justify-between ${useAllPipelines ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                >
                  <View className="flex-1 mr-5">
                    <Text className={`font-black text-sm mb-1 ${useAllPipelines ? 'text-brand-primary' : 'text-typography-main'}`}>
                      Monitor All Pipelines
                    </Text>
                    <Text className="text-typography-muted text-xs font-medium">
                      Include every pipeline automatically. Success stages are auto-detected from{' '}
                      <Text className="text-state-success font-bold">terminal_type = success</Text> stages.
                    </Text>
                  </View>
                  <View
                    className={`w-12 h-7 rounded-full justify-center px-1 border-2 ${useAllPipelines ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                  >
                    <View
                      className="w-4 h-4 rounded-full bg-white"
                      style={{ alignSelf: useAllPipelines ? 'flex-end' : 'flex-start' }}
                    />
                  </View>
                </TouchableOpacity>

                {useAllPipelines && (
                  <View className="bg-surface-background p-4 rounded-2xl border border-surface-border mb-5">
                    <View className="flex-row items-center mb-2">
                      <FontAwesome name="check-circle" size={13} className="text-brand-primary" />
                      <Text className="text-brand-primary font-black text-[11px] ml-2 uppercase tracking-widest">Auto Mode Active</Text>
                    </View>
                    <Text className="text-typography-muted text-xs font-medium leading-relaxed">
                      All {pipelines.length} pipeline{pipelines.length !== 1 ? 's' : ''} are being monitored. Stages with{' '}
                      <Text className="text-state-success font-bold">terminal_type = success</Text> count toward the Completed metric.
                      Stages with other terminal types (failed, cancelled) are tracked separately as Failed/Rejected.
                    </Text>
                  </View>
                )}

                {!useAllPipelines && (
                  <>
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Select Pipelines to Monitor</Text>
                    <View className="flex-row flex-wrap gap-3 mb-7">
                      {pipelines.map(p => (
                        <TouchableOpacity
                          key={p.id}
                          onPress={() => togglePipeline(p.id)}
                          className={`px-5 py-2.5 rounded-xl border ${selectedPipelines.includes(p.id) ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                        >
                          <Text className={`font-black text-xs ${selectedPipelines.includes(p.id) ? 'text-white' : 'text-typography-main'}`}>{p.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {selectedPipelines.length > 0 && (
                      <>
                        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-3">Define Success Stages</Text>
                        <Text className="text-typography-muted text-xs mb-5 font-medium">
                          Completed terminal stages are pre-selected. Adjust as needed — these are the stages that count toward "Completed".
                        </Text>
                        <View className="gap-5">
                          {selectedPipelines.map(pid => {
                            const pipeline = pipelines.find(p => p.id === pid);
                            const pipelineStages = stages.filter(s => s.pipeline_id === pid);
                            return (
                              <View key={pid} className="bg-surface-background p-4 rounded-2xl border border-surface-border">
                                <Text className="text-typography-main font-black mb-3">{pipeline?.name}</Text>
                                <View className="flex-row flex-wrap gap-2">
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
                                        className={`px-3 py-1.5 rounded-lg border flex-row items-center ${isSelected ? 'bg-state-success/20 border-state-success' : 'bg-surface-card border-surface-border'}`}
                                      >
                                        <FontAwesome
                                          name={isSelected ? 'check-square' : 'square-o'}
                                          size={13}
                                          className={isSelected ? 'text-state-success' : 'text-typography-dim'}
                                          style={{ marginRight: 7 }}
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

          <View className="p-4 border-t border-surface-border flex-row gap-3">
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              className="flex-1 rounded-xl bg-surface-background border border-surface-border items-center justify-center"
              style={{ minHeight: 40 }}
            >
              <Text className="text-typography-muted text-xs font-bold">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              accessibilityRole="button"
              className="flex-[2] rounded-xl bg-brand-primary hover:bg-brand-primary-hover items-center justify-center transition-colors"
              style={{ minHeight: 40 }}
            >
              <Text className="text-white text-xs font-bold">Save configuration</Text>
            </TouchableOpacity>
          </View>
        </View>
    </Popup>
  );
}
