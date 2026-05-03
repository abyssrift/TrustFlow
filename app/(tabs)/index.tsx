import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity, Modal } from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuth } from '@/contexts/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

export default function DashboardScreen() {
  const [stats, setStats] = useState<DashboardStats>({ totalTasks: 0, activeNow: 0, completed: 0, failed: 0, activeSessions: 0 });
  const [pulse, setPulse] = useState<PersonalPulse | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<DashboardConfig | null>(null);

  const { user, profile } = useAuth();

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

      // Use configured success stages if explicitly set; otherwise auto-detect terminal_type='completed'
      if (!isAllPipelines && currentConfig!.successStageIds.length > 0) {
        successStageIds = currentConfig!.successStageIds;
      } else {
        successStageIds = (terminalStages || [])
          .filter((s: any) => s.terminal_type === 'completed')
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
          created_at,
          task:task_id(title, pipeline_id),
          from_stage:from_stage_id(name),
          to_stage:to_stage_id(name),
          moved_by:users!moved_by_user_id(full_name, display_name)
        `)
        .order('created_at', { ascending: false })
        .limit(15);

      const activityEntries: ActivityEntry[] = (historyData || [])
        .filter((h: any) => targetPipelineIds.includes(h.task?.pipeline_id))
        .slice(0, 8)
        .map((h: any) => ({
          id: h.id,
          taskTitle: h.task?.title || 'Unknown Task',
          fromStage: h.from_stage?.name || '—',
          toStage: h.to_stage?.name || '—',
          movedBy: h.moved_by?.display_name || h.moved_by?.full_name || 'System',
          movedAt: h.created_at,
        }));
      setActivity(activityEntries);
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
  };

  const completionRate = stats.totalTasks > 0 ? Math.round((stats.completed / stats.totalTasks) * 100) : 0;
  const failedRate = stats.totalTasks > 0 ? Math.round((stats.failed / stats.totalTasks) * 100) : 0;

  return (
    <ScrollView
      className="flex-1 bg-surface-background p-5"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="rgb(var(--brand-primary))" />}
    >
      <View className="mb-6 mt-4 flex-row justify-between items-start">
        <View>
          <Text className="text-brand-primary font-bold uppercase tracking-widest text-[10px] mb-1">Command Center</Text>
          <Text className="text-typography-main text-3xl font-black tracking-tight">
            {getGreeting()}, {firstName}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowSettings(true)}
          className="w-10 h-10 bg-surface-card rounded-full items-center justify-center border border-surface-border"
        >
          <FontAwesome name="cog" size={16} color="rgb(var(--brand-primary))" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View className="mt-10 items-center justify-center">
          <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
          <Text className="text-typography-muted mt-3 font-bold uppercase tracking-widest text-[10px]">Loading data...</Text>
        </View>
      ) : (
        <View>
          {pulse && (
            <View className="mb-6 p-4 rounded-2xl border border-surface-border bg-brand-primary/5">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-[10px] text-brand-primary font-black uppercase tracking-widest">Your Pulse</Text>
                {pulse.is_working && (
                  <View className="flex-row items-center bg-state-success/10 px-3 py-1.5 rounded-full border border-state-success/20">
                    <View className="w-2 h-2 rounded-full bg-state-success mr-2" />
                    <Text className="text-state-success text-[9px] font-black uppercase tracking-widest">Active</Text>
                  </View>
                )}
              </View>
              <View className="flex-row justify-between">
                <View>
                  <Text className="text-typography-muted text-[9px] font-bold uppercase mb-0.5">Today</Text>
                  <Text className="text-brand-primary text-xl font-black">{pulse.daily_points}<Text className="text-xs text-brand-primary/60"> pts</Text></Text>
                </View>
                <View>
                  <Text className="text-typography-muted text-[9px] font-bold uppercase mb-0.5">Active</Text>
                  <Text className="text-typography-main text-xl font-black">
                    {Math.floor(pulse.active_seconds_today / 3600)}h <Text className="text-xs text-typography-muted">{Math.floor((pulse.active_seconds_today % 3600) / 60)}m</Text>
                  </Text>
                </View>
                <View>
                  <Text className="text-typography-muted text-[9px] font-bold uppercase mb-0.5">Flap</Text>
                  <Text className={`text-xl font-black ${pulse.flap_rate_score > 1.5 ? 'text-state-danger' : 'text-state-success'}`}>
                    {pulse.flap_rate_score}x
                  </Text>
                </View>
              </View>
            </View>
          )}

          <View className="flex-row flex-wrap justify-between mb-4">
            <View className="w-[48%] bg-surface-card p-5 rounded-2xl border border-surface-border mb-4 premium-shadow">
              <View className="w-10 h-10 rounded-xl bg-brand-primary/10 items-center justify-center mb-3 border border-brand-primary/20">
                <FontAwesome name="tasks" size={16} color="rgb(var(--brand-primary))" />
              </View>
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Total</Text>
              <Text className="text-typography-main text-3xl font-black">{stats.totalTasks}</Text>
              <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest mt-1">Across all stages</Text>
            </View>

            <View className="w-[48%] bg-surface-card p-5 rounded-2xl border border-surface-border mb-4 premium-shadow">
              <View className="w-10 h-10 rounded-xl bg-state-warning/10 items-center justify-center mb-3 border border-state-warning/20">
                <FontAwesome name="hourglass-half" size={14} color="rgb(var(--state-warning))" />
              </View>
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">In Progress</Text>
              <Text className="text-typography-main text-3xl font-black">{stats.activeNow}</Text>
              <Text className="text-state-warning text-[9px] font-black uppercase tracking-widest mt-1">Non-terminal stages</Text>
            </View>

            <View className="w-[48%] bg-surface-card p-5 rounded-2xl border border-surface-border mb-4 premium-shadow">
              <View className="w-10 h-10 rounded-xl bg-state-success/10 items-center justify-center mb-3 border border-state-success/20">
                <FontAwesome name="check-circle" size={16} color="rgb(var(--state-success))" />
              </View>
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Completed</Text>
              <Text className="text-typography-main text-3xl font-black">{stats.completed}</Text>
              <Text className="text-state-success text-[9px] font-black uppercase tracking-widest mt-1">{completionRate}% rate</Text>
            </View>

            {stats.failed > 0 ? (
              <View className="w-[48%] bg-surface-card p-5 rounded-2xl border border-surface-border mb-4 premium-shadow">
                <View className="w-10 h-10 rounded-xl bg-state-danger/10 items-center justify-center mb-3 border border-state-danger/20">
                  <FontAwesome name="times-circle" size={16} color="rgb(var(--state-danger))" />
                </View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Failed</Text>
                <Text className="text-typography-main text-3xl font-black">{stats.failed}</Text>
                <Text className="text-state-danger text-[9px] font-black uppercase tracking-widest mt-1">{failedRate}% of total</Text>
              </View>
            ) : (
              <View className="w-[48%] bg-surface-card p-5 rounded-2xl border border-surface-border mb-4 premium-shadow">
                <View className="w-10 h-10 rounded-xl bg-state-info/10 items-center justify-center mb-3 border border-state-info/20">
                  <FontAwesome name="bolt" size={16} color="rgb(var(--state-info))" />
                </View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Live Sessions</Text>
                <Text className="text-typography-main text-3xl font-black">{stats.activeSessions}</Text>
                <Text className="text-state-info text-[9px] font-black uppercase tracking-widest mt-1">Working now</Text>
              </View>
            )}
          </View>

          <View className="bg-surface-card p-6 rounded-2xl border border-surface-border mb-6 premium-shadow">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-typography-main font-bold text-lg">Pipeline Breakdown</Text>
              <View className="bg-brand-primary/10 px-3 py-1 rounded-full border border-brand-primary/20">
                <Text className="text-brand-primary font-black text-lg">{completionRate}%</Text>
              </View>
            </View>

            <View className="w-full h-3 bg-surface-background rounded-full overflow-hidden border border-surface-border/50 mb-5">
              <View
                className="h-full bg-brand-primary rounded-full"
                style={{ width: `${completionRate}%` }}
              />
            </View>

            <View className="gap-4">
              <View>
                <View className="flex-row justify-between mb-1.5">
                  <Text className="text-typography-main text-xs font-bold">In Progress</Text>
                  <Text className="text-typography-muted text-[10px] font-bold uppercase">{stats.activeNow} / {stats.totalTasks}</Text>
                </View>
                <View className="w-full h-2 bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
                  <View
                    className="h-full bg-state-warning rounded-full"
                    style={{ width: `${stats.totalTasks > 0 ? (stats.activeNow / stats.totalTasks) * 100 : 0}%` }}
                  />
                </View>
              </View>

              <View>
                <View className="flex-row justify-between mb-1.5">
                  <Text className="text-typography-main text-xs font-bold">Completed</Text>
                  <Text className="text-typography-muted text-[10px] font-bold uppercase">{stats.completed} / {stats.totalTasks}</Text>
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
                  <View className="flex-row justify-between mb-1.5">
                    <Text className="text-typography-main text-xs font-bold">Failed / Rejected</Text>
                    <Text className="text-typography-muted text-[10px] font-bold uppercase">{stats.failed} / {stats.totalTasks}</Text>
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

          <View className="mb-12">
            <Text className="text-typography-main text-xl font-black mb-4">Recent Activity</Text>
            {activity.length === 0 ? (
              <View className="bg-surface-card p-8 rounded-2xl items-center justify-center border border-dashed border-surface-border">
                <View className="w-14 h-14 rounded-full bg-brand-primary/5 flex-center mb-4">
                  <FontAwesome name="bolt" size={22} color="rgb(var(--brand-primary))" />
                </View>
                <Text className="text-typography-muted text-center font-medium leading-5 text-sm">
                  Stage transitions will appear here as tasks move through your pipeline.
                </Text>
              </View>
            ) : (
              <View className="gap-3">
                {activity.map((entry) => (
                  <View
                    key={entry.id}
                    className="bg-surface-card p-4 rounded-2xl border border-surface-border"
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-typography-main font-bold text-sm flex-1 mr-2" numberOfLines={1}>
                        {entry.taskTitle}
                      </Text>
                      <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-widest">
                        {timeAgo(entry.movedAt)}
                      </Text>
                    </View>
                    <View className="flex-row items-center flex-wrap">
                      <View className="bg-surface-background px-2 py-1 rounded-lg border border-surface-border">
                        <Text className="text-typography-muted text-[9px] font-black uppercase">{entry.fromStage}</Text>
                      </View>
                      <FontAwesome name="long-arrow-right" size={10} color="rgb(var(--brand-primary))" style={{ marginHorizontal: 6 }} />
                      <View className="bg-brand-primary/10 px-2 py-1 rounded-lg border border-brand-primary/20">
                        <Text className="text-brand-primary text-[9px] font-black uppercase">{entry.toStage}</Text>
                      </View>
                      <Text className="text-typography-dim text-[9px] font-bold ml-auto">{entry.movedBy}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      )}

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
      const stageIds = stages.filter(s => s.pipeline_id === id).map(s => s.id);
      setSelectedSuccessStages(prev => prev.filter(sid => !stageIds.includes(sid)));
    } else {
      setSelectedPipelines(prev => [...prev, id]);
      const completedIds = stages
        .filter(s => s.pipeline_id === id && s.is_terminal && s.terminal_type === 'completed')
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/80">
        <View className="flex-1 mt-20 bg-surface-background rounded-t-[40px] border-t border-surface-border overflow-hidden">
          <View className="p-6 border-b border-surface-border flex-row justify-between items-center bg-surface-card">
            <View>
              <Text className="text-typography-main text-xl font-black">Dashboard Config</Text>
              <Text className="text-typography-muted text-[10px] font-bold uppercase">Pipeline Source Settings</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-10 h-10 rounded-full bg-surface-background items-center justify-center border border-surface-border">
              <FontAwesome name="times" size={14} color="rgb(var(--typography-dim))" />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1 p-5">
            {loading ? (
              <ActivityIndicator size="large" color="rgb(var(--brand-primary))" className="mt-10" />
            ) : (
              <View className="pb-20">
                {/* All Pipelines Toggle */}
                <TouchableOpacity
                  onPress={() => setUseAllPipelines(v => !v)}
                  className={`p-4 rounded-2xl border mb-6 flex-row items-center justify-between ${useAllPipelines ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                >
                  <View className="flex-1 mr-4">
                    <Text className={`font-black text-sm mb-1 ${useAllPipelines ? 'text-brand-primary' : 'text-typography-main'}`}>
                      Monitor All Pipelines
                    </Text>
                    <Text className="text-typography-muted text-[10px] font-medium">
                      Auto-include all pipelines. Success stages detected from terminal stages.
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
                  <View className="bg-surface-card p-4 rounded-2xl border border-surface-border mb-6">
                    <View className="flex-row items-center mb-2">
                      <FontAwesome name="check-circle" size={12} color="rgb(var(--brand-primary))" />
                      <Text className="text-brand-primary font-black text-[10px] ml-2 uppercase tracking-widest">Auto Mode Active</Text>
                    </View>
                    <Text className="text-typography-muted text-xs font-medium leading-relaxed">
                      All {pipelines.length} pipeline{pipelines.length !== 1 ? 's' : ''} monitored. Stages with{' '}
                      <Text className="text-state-success font-bold">terminal_type = completed</Text> count as Completed. Other terminal stages show as Failed/Rejected.
                    </Text>
                  </View>
                )}

                {!useAllPipelines && (
                  <>
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-4">Select Pipelines</Text>
                    <View className="gap-2 mb-8">
                      {pipelines.map(p => (
                        <TouchableOpacity
                          key={p.id}
                          onPress={() => togglePipeline(p.id)}
                          className={`p-4 rounded-xl border flex-row items-center justify-between ${selectedPipelines.includes(p.id) ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                        >
                          <Text className={`font-bold ${selectedPipelines.includes(p.id) ? 'text-white' : 'text-typography-main'}`}>{p.name}</Text>
                          {selectedPipelines.includes(p.id) && <FontAwesome name="check" size={12} color="white" />}
                        </TouchableOpacity>
                      ))}
                    </View>

                    {selectedPipelines.length > 0 && (
                      <>
                        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Success Stages</Text>
                        <Text className="text-typography-muted text-xs mb-4 font-medium">
                          Completed stages are pre-selected. These count toward the "Completed" metric.
                        </Text>
                        {selectedPipelines.map(pid => {
                          const pipeline = pipelines.find(p => p.id === pid);
                          const pipelineStages = stages.filter(s => s.pipeline_id === pid);
                          return (
                            <View key={pid} className="mb-6 bg-surface-card p-4 rounded-2xl border border-surface-border">
                              <Text className="text-typography-main font-black mb-3 text-xs">{pipeline?.name}</Text>
                              <View className="flex-row flex-wrap gap-2">
                                {pipelineStages.map(s => {
                                  const isSelected = selectedSuccessStages.includes(s.id);
                                  const terminalColor =
                                    s.terminal_type === 'completed' ? 'text-state-success' :
                                    s.terminal_type === 'failed' ? 'text-state-danger' :
                                    'text-state-warning';
                                  const terminalBg =
                                    s.terminal_type === 'completed' ? 'bg-state-success/20' :
                                    s.terminal_type === 'failed' ? 'bg-state-danger/20' :
                                    'bg-state-warning/20';
                                  return (
                                    <TouchableOpacity
                                      key={s.id}
                                      onPress={() => toggleStage(s.id)}
                                      className={`px-3 py-2 rounded-lg border flex-row items-center ${isSelected ? 'bg-state-success/10 border-state-success' : 'bg-surface-background border-surface-border'}`}
                                    >
                                      <FontAwesome
                                        name={isSelected ? 'check-square' : 'square-o'}
                                        size={12}
                                        color={isSelected ? 'rgb(var(--state-success))' : 'rgb(var(--typography-dim))'}
                                        style={{ marginRight: 6 }}
                                      />
                                      <Text className={`text-[10px] font-bold mr-1.5 ${isSelected ? 'text-state-success' : 'text-typography-muted'}`}>{s.name}</Text>
                                      {s.is_terminal && (
                                        <View className={`px-1.5 py-0.5 rounded-full ${terminalBg}`}>
                                          <Text className={`text-[7px] font-black uppercase ${terminalColor}`}>
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
                      </>
                    )}
                  </>
                )}
              </View>
            )}
          </ScrollView>

          <View className="p-5 border-t border-surface-border bg-surface-card">
            <TouchableOpacity
              onPress={handleSave}
              className="w-full py-4 rounded-2xl bg-brand-primary items-center"
            >
              <Text className="text-white font-black uppercase tracking-widest text-sm">Save Config</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
