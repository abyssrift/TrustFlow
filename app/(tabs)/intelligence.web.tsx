import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, RefreshControl, Platform, Modal, TextInput } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';

// Premium Desktop Section Toggle
const SectionToggle = ({ active, onSelect }: { active: string, onSelect: (s: string) => void }) => (
  <View className="flex-row bg-surface-card rounded-2xl p-1.5 border border-surface-border mb-10 w-fit">
    {['Radar', 'Targets', 'Archives'].map((s) => (
      <TouchableOpacity
        key={s}
        onPress={() => onSelect(s.toLowerCase())}
        className={`px-8 py-3 rounded-xl items-center flex-row ${active === s.toLowerCase() ? 'bg-brand-primary premium-shadow' : 'hover:bg-surface-background'}`}
      >
        <FontAwesome
          name={s === 'Radar' ? 'crosshairs' : s === 'Targets' ? 'bullseye' : 'archive'}
          size={14}
          color={active === s.toLowerCase() ? 'white' : 'rgb(var(--typography-muted))'}
          className="mr-3"
        />
        <Text className={`font-black text-[10px] uppercase tracking-widest ${active === s.toLowerCase() ? 'text-white' : 'text-typography-muted'}`}>
          {s}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

export default function IntelligenceScreenWeb() {
  const { section } = useLocalSearchParams();
  const [activeSection, setActiveSection] = useState((section as string) || 'radar');
  const [loading, setLoading] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);

  const [data, setData] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [targets, setTargets] = useState<any[]>([]);

  // Base Data for Selectors
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [allStages, setAllStages] = useState<any[]>([]);

  // Current Global State
  const [days, setDays] = useState(30);
  const [pipelineId, setPipelineId] = useState<string | null>(null);

  // Widget Customization State
  const DEFAULT_WIDGETS = ['throughput', 'efficiency', 'flow_ratio', 'first_pass_yield'];
  const [activeWidgets, setActiveWidgets] = useState<string[]>(DEFAULT_WIDGETS);
  const [showWidgetModal, setShowWidgetModal] = useState(false);

  const { hasPermission } = useAuth();

  useEffect(() => {
    AsyncStorage.getItem('@TrustFlow_radar_widgets').then(val => {
      if (val) setActiveWidgets(JSON.parse(val));
    });
    fetchBaseData();
  }, []);

  useEffect(() => {
    if (section && typeof section === 'string') {
      setActiveSection(section);
    }
  }, [section]);

  const handleSaveWidgets = async (widgets: string[]) => {
    setActiveWidgets(widgets);
    setShowWidgetModal(false);
    await AsyncStorage.setItem('@TrustFlow_radar_widgets', JSON.stringify(widgets));
  };

  useEffect(() => {
    let isMounted = true;
    const fetch = async () => {
      if (!isMounted) return;
      if (activeSection === 'radar') await fetchAudit();
      if (activeSection === 'archives') await fetchReports();
      if (activeSection === 'targets') await fetchTargets();
    };
    fetch();
    return () => { isMounted = false; };
  }, [activeSection, pipelineId, days]);

  const fetchBaseData = async () => {
    const { data: p } = await supabase.from('pipelines').select('id, name').is('deleted_at', null);
    const { data: t } = await supabase.from('teams').select('id, name').is('deleted_at', null);
    const { data: u } = await supabase.from('users').select('id, full_name');
    const { data: s } = await supabase.from('pipeline_stages').select('id, name, pipeline_id').order('position', { ascending: true });

    if (p) setPipelines(p);
    if (t) setTeams(t);
    if (u) setUsers(u);
    if (s) setAllStages(s);
  };

  const fetchAudit = async () => {
    try {
      setLoading(true);
      const { data: res, error } = await supabase.rpc('rpc_get_organizational_audit', {
        p_pipeline_id: pipelineId,
        p_days: days
      });
      if (error) throw error;
      setData(res);
    } catch (err) {
      console.error('Audit Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchReports = async () => {
    try {
      setLoading(true);
      const { data: res } = await supabase.from('reporting_jobs').select('*').order('created_at', { ascending: false });
      setReports(res || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const fetchTargets = async () => {
    try {
      setLoading(true);
      const { data: res } = await supabase.from('pipeline_stage_targets').select('*, stage:pipeline_stages(name, pipeline_id)').order('created_at', { ascending: false });

      const enriched = await Promise.all((res || []).map(async (t) => {
        if (t.target_type === 'volume') {
          const { count } = await supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('current_stage_id', t.stage_id);
          return { ...t, current_count: count || 0 };
        }
        return t;
      }));

      setTargets(enriched);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const handleCreateTarget = async (params: any) => {
    try {
      setLoading(true);
      const { error } = await supabase.from('pipeline_stage_targets').insert({
        stage_id: params.stage_id,
        target_type: params.target_type,
        target_active_seconds: params.active,
        target_lifecycle_seconds: params.lifecycle,
        target_quantity: params.quantity,
        target_deadline: params.deadline
      });
      if (error) throw error;
      fetchTargets();
    } catch (err: any) {
      console.error('Target Creation Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTarget = async (id: string, field: string, val: string) => {
    const num = parseInt(val);
    if (isNaN(num)) return;
    const { error } = await supabase.from('pipeline_stage_targets').update({ [field]: num }).eq('id', id);
    if (error) console.error('Update Error:', error);
    else fetchTargets();
  };

  const handleExportPDF = async (params: any) => {
    try {
      setLoading(true);
      const { error } = await supabase.rpc('rpc_request_report', {
        p_report_type: params.type || 'performance_audit',
        p_parameters: {
          days: params.days,
          pipeline_id: params.pipeline_id,
          team_id: params.team_id,
          user_id: params.user_id
        }
      });
      if (error) throw error;
      if (activeSection === 'archives') fetchReports();
    } catch (err: any) {
      console.error('Report Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = async (path: string) => {
    const { data, error } = await supabase.storage.from('reports').createSignedUrl(path, 60);
    if (data?.signedUrl) Linking.openURL(data.signedUrl);
  };

  return (
    <View className="flex-1 bg-surface-background p-10">
      <View className="max-w-[1600px] mx-auto w-full">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-12">
          <View>
            <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[10px] mb-2">Intelligence Dashboard</Text>
            <Text className="text-typography-main text-5xl font-black tracking-tighter">Intelligence Hub</Text>
          </View>

          <View className="flex-row items-center gap-4">
            <TouchableOpacity
              onPress={fetchAudit}
              className="h-14 w-14 items-center justify-center bg-surface-card border border-surface-border rounded-2xl premium-shadow"
            >
              <FontAwesome name="refresh" size={16} className="text-brand-primary" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowReportModal(true)}
              className="bg-brand-primary px-10 py-4 rounded-2xl premium-shadow active:scale-95 transition-transform flex-row items-center"
            >
              <FontAwesome name="file-pdf-o" size={14} color="white" className="mr-3" />
              <Text className="text-white font-black uppercase tracking-widest text-sm">Generate Report</Text>
            </TouchableOpacity>
          </View>
        </View>

        <SectionToggle active={activeSection} onSelect={setActiveSection} />

        {loading ? (
          <View className="py-40 items-center justify-center">
            <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
          </View>
        ) : (
          <View>
            {activeSection === 'radar' && (
              <RadarSectionWeb
                data={data}
                activeWidgets={activeWidgets}
                onEditWidgets={() => setShowWidgetModal(true)}
              />
            )}
            {activeSection === 'targets' && (
              <TargetsSectionWeb
                targets={targets}
                onUpdate={handleUpdateTarget}
                onNew={() => setShowTargetModal(true)}
              />
            )}
            {activeSection === 'archives' && (
              <ArchivesSectionWeb
                reports={reports}
                onDownload={handleDownloadReport}
                onNew={() => setShowReportModal(true)}
              />
            )}
          </View>
        )}
      </View>

      <ReportConfigModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        onConfirm={handleExportPDF}
        pipelines={pipelines}
        teams={teams}
        users={users}
        initialDays={days}
      />

      <TargetCreationModal
        visible={showTargetModal}
        onClose={() => setShowTargetModal(false)}
        onConfirm={handleCreateTarget}
        pipelines={pipelines}
        stages={allStages}
      />

      <WidgetConfigModal
        visible={showWidgetModal}
        onClose={() => setShowWidgetModal(false)}
        onSave={handleSaveWidgets}
        currentWidgets={activeWidgets}
      />
    </View>
  );
}

const RadarSectionWeb = ({ data, activeWidgets, onEditWidgets }: any) => {
  if (!data) return null;
  const curThr = data.current?.throughput || 0;
  const prevThr = data.comparison?.throughput || 0;
  const adv = data.radar_advanced || {};
  const curr = data.current || {};

  const renderWidget = (key: string, idx: number) => {
    switch (key) {
      case 'throughput': return <KPIBoxWeb key={idx} label="Throughput" val={curThr} delta={curThr - prevThr} />;
      case 'efficiency': return <KPIBoxWeb key={idx} label="Efficiency" val={`${Math.round(curr.success_rate || 0)}%`} delta={undefined} />;
      case 'flow_ratio': return <KPIBoxWeb key={idx} label="Flow Ratio" val={adv.flow_ratio || 'N/A'} delta={undefined} />;
      case 'first_pass_yield': return <KPIBoxWeb key={idx} label="First-Pass Integrity" val={`${adv.first_pass_yield || 0}%`} delta={undefined} />;
      case 'automation_offload': return <KPIBoxWeb key={idx} label="Automation Score" val={`${adv.automation_offload_rate || 0}%`} delta={undefined} />;
      default: return null;
    }
  };

  return (
    <View className="flex-row flex-wrap gap-8">
      {/* Metrics Row */}
      <View className="w-full">
        <View className="flex-row justify-between items-center mb-6">
          <Text className="text-typography-main font-black text-2xl tracking-tight">Performance Metrics</Text>
          <TouchableOpacity onPress={onEditWidgets} className="bg-surface-card px-4 py-2 rounded-xl border border-surface-border">
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Configure Dashboard</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-row flex-wrap gap-6">
          {activeWidgets.map((w: string, i: number) => renderWidget(w, i))}
        </View>
      </View>

      {/* SLA & Funnel Row */}
      <View className="w-full flex-row gap-8">
        <View className="flex-1">
          <SLARiskAlertWeb data={data} />
          <StageDurationChartWeb data={data} />
        </View>
        <View className="flex-1">
          <ConversionFunnelChartWeb data={data} />
        </View>
      </View>

      {/* Worker Distribution & Quality Row */}
      <View className="w-full flex-row gap-8">
        <View className="flex-1">
          <WorkDistributionChartWeb data={data} />
        </View>
        <View className="flex-1">
          <QualityLeaderboardWeb data={data} />
        </View>
      </View>

      <View className="w-full">
        <TrendComparisonCardsWeb data={data} />
      </View>
    </View>
  );
};

const KPIBoxWeb = ({ label, val, delta }: any) => (
  <View className="flex-1 min-w-[280px] bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">{label}</Text>
    <View className="flex-row items-baseline">
      <Text className="text-typography-main text-4xl font-black">{val}</Text>
      {delta !== undefined && (
        <View className={`ml-4 px-3 py-1 rounded-full ${delta >= 0 ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
          <Text className={`text-[10px] font-black ${delta >= 0 ? 'text-state-success' : 'text-state-danger'}`}>
            {delta >= 0 ? '+' : ''}{delta} units
          </Text>
        </View>
      )}
    </View>
  </View>
);

const SLARiskAlertWeb = ({ data }: any) => {
  if (!data?.sla_risks || data.sla_risks.length === 0) return null;

  return (
    <View className="mb-8 bg-state-danger/5 border border-state-danger/20 p-8 rounded-[32px]">
      <View className="flex-row items-center mb-6">
        <View className="w-10 h-10 rounded-full bg-state-danger/10 items-center justify-center mr-4">
          <FontAwesome name="warning" size={16} color="rgb(var(--state-danger))" />
        </View>
        <View>
          <Text className="text-state-danger font-black text-lg">SLA Risks</Text>
          <Text className="text-state-danger/70 text-xs font-medium">{data.sla_risks.length} active tasks exceeding tolerance</Text>
        </View>
      </View>
      <View className="space-y-3">
        {data.sla_risks.slice(0, 5).map((r: any, i: number) => (
          <View key={i} className="flex-row justify-between items-center bg-white/50 dark:bg-black/20 p-4 rounded-2xl border border-state-danger/10">
            <View>
              <Text className="text-typography-main font-black text-sm">{r.task_number || `TASK-${r.id.substring(0, 4)}`}</Text>
              <Text className="text-typography-muted text-[10px] uppercase font-bold">{r.stage_name}</Text>
            </View>
            <View className="flex-row items-center gap-4">
              <View className="items-end">
                <Text className="text-state-danger font-black">{r.risk_percent}%</Text>
                <Text className="text-[9px] text-typography-muted uppercase">Risk Probability</Text>
              </View>
              <TouchableOpacity className="w-8 h-8 rounded-lg bg-state-danger items-center justify-center">
                <FontAwesome name="arrow-right" size={10} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const StageDurationChartWeb = ({ data }: any) => {
  if (!data?.stage_duration_analysis) return null;
  const maxDays = Math.max(...data.stage_duration_analysis.map((s: any) => s.avg_duration_days));

  return (
    <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow mb-8">
      <Text className="text-typography-main font-black text-xl mb-8">Stage Duration (Days per Stage)</Text>
      <View className="space-y-6">
        {data.stage_duration_analysis.map((stage: any, idx: number) => {
          const percentage = (stage.avg_duration_days / (maxDays || 1)) * 100;
          const isSlow = stage.avg_duration_days > 2.5;
          return (
            <View key={idx}>
              <View className="flex-row justify-between mb-2">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">{stage.stage_name}</Text>
                <Text className={`text-sm font-black ${isSlow ? 'text-state-danger' : 'text-brand-primary'}`}>{stage.avg_duration_days.toFixed(1)} Days</Text>
              </View>
              <View className="h-2.5 bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
                <View className={`h-full ${isSlow ? 'bg-state-danger' : 'bg-brand-primary'} rounded-full`} style={{ width: `${percentage}%` }} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const ConversionFunnelChartWeb = ({ data }: any) => {
  if (!data?.conversion_by_stage) return null;
  return (
    <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow h-full">
      <Text className="text-typography-main font-black text-xl mb-8">Task Funnel</Text>
      <View className="space-y-2">
        {data.conversion_by_stage.map((stage: any, idx: number) => {
          const rate = (stage.completion_rate || 0) * 100;
          const isGood = rate >= 85;
          return (
            <View key={idx} className="items-center">
              <View className="w-full bg-surface-background p-6 rounded-2xl border border-surface-border/50">
                <View className="flex-row justify-between mb-4">
                  <View>
                    <Text className="text-typography-main font-black text-sm">{stage.stage_name}</Text>
                    <Text className="text-typography-muted text-[10px] font-bold uppercase">{stage.task_count} Active Units</Text>
                  </View>
                  <View className="items-end">
                    <Text className={`text-lg font-black ${isGood ? 'text-state-success' : 'text-state-warning'}`}>{rate.toFixed(0)}%</Text>
                    <Text className="text-[9px] text-typography-muted uppercase">Retention</Text>
                  </View>
                </View>
                <View className="h-3 bg-surface-card rounded-full overflow-hidden border border-surface-border">
                  <View className={`h-full ${isGood ? 'bg-state-success' : 'bg-state-warning'}`} style={{ width: `${Math.min(rate, 100)}%` }} />
                </View>
              </View>
              {idx < data.conversion_by_stage.length - 1 && (
                <View className="py-2 opacity-30">
                  <FontAwesome name="long-arrow-down" size={20} className="text-typography-dim" />
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
};

const WorkDistributionChartWeb = ({ data }: any) => {
  if (!data?.worker_engagement) return null;
  const workers = data.worker_engagement.sort((a: any, b: any) => b.action_count - a.action_count).slice(0, 6);
  const maxCount = Math.max(...workers.map((w: any) => w.action_count));

  return (
    <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
      <Text className="text-typography-main font-black text-xl mb-8">Team Workload</Text>
      <View className="space-y-6">
        {workers.map((worker: any, idx: number) => {
          const percentage = (worker.action_count / (maxCount || 1)) * 100;
          const overloaded = percentage > 85;
          return (
            <View key={idx}>
              <View className="flex-row justify-between mb-3 items-center">
                <View className="flex-row items-center">
                  <View className="w-8 h-8 rounded-full bg-brand-primary/10 items-center justify-center mr-3 border border-brand-primary/20">
                    <Text className="text-brand-primary font-black text-[10px]">{worker.full_name?.charAt(0) || '?'}</Text>
                  </View>
                  <Text className="text-typography-main font-bold text-sm">{worker.full_name || 'Anonymous User'}</Text>
                </View>
                <View className="flex-row items-center gap-4">
                  <Text className={`text-sm font-black ${overloaded ? 'text-state-danger' : 'text-brand-primary'}`}>{worker.action_count} OPS</Text>
                  <View className="w-12 items-end">
                    <Text className="text-typography-muted text-[10px] font-black">{Math.round(percentage)}%</Text>
                  </View>
                </View>
              </View>
              <View className="h-2 bg-surface-background rounded-full overflow-hidden">
                <View className={`h-full ${overloaded ? 'bg-state-danger' : 'bg-brand-primary'} rounded-full`} style={{ width: `${percentage}%` }} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const QualityLeaderboardWeb = ({ data }: any) => {
  if (!data?.quality_by_worker) return null;
  const workers = data.quality_by_worker.sort((a: any, b: any) => a.revision_rate - b.revision_rate).slice(0, 6);

  return (
    <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow h-full">
      <Text className="text-typography-main font-black text-xl mb-8">Quality Integrity Ratings</Text>
      <View className="space-y-4">
        {workers.map((worker: any, idx: number) => {
          const stars = worker.revision_rate <= 5 ? 5 : worker.revision_rate <= 10 ? 4 : worker.revision_rate <= 15 ? 3 : 2;
          return (
            <View key={idx} className="bg-surface-background p-5 rounded-2xl border border-surface-border/50">
              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-typography-main font-black text-sm flex-1">{worker.full_name || 'Anonymous User'}</Text>
                <View className="flex-row gap-1.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <FontAwesome key={s} name={s <= stars ? 'star' : 'star-o'} size={14} color={s <= stars ? 'rgb(var(--state-warning))' : 'rgb(var(--text-muted))'} />
                  ))}
                </View>
              </View>
              <View className="flex-row justify-between items-center">
                <View className="flex-row items-center bg-state-success/10 px-3 py-1 rounded-full">
                  <Text className="text-state-success text-[10px] font-black uppercase">{(worker.revision_rate || 0).toFixed(1)}% REVISION</Text>
                </View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">{worker.total_tasks} Tasks</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const TrendComparisonCardsWeb = ({ data }: any) => {
  if (!data?.current || !data?.comparison) return null;
  const metrics = [
    { label: 'Throughput Delta', val: data.current.throughput, prev: data.comparison.throughput, suffix: ' units', hBetter: true },
    { label: 'Success Variance', val: data.current.success_rate, prev: data.comparison.success_rate, suffix: '%', hBetter: true },
    { label: 'Latency Drift', val: data.current.avg_lead_time_minutes, prev: data.comparison.avg_lead_time_minutes, suffix: 'm', hBetter: false },
    { label: 'Integrity Shift', val: data.current.revision_rate, prev: data.comparison.revision_rate, suffix: '%', hBetter: false },
  ];

  return (
    <View className="mt-8">
      <Text className="text-typography-main font-black text-2xl tracking-tight mb-8">Performance Trends</Text>
      <View className="flex-row gap-6">
        {metrics.map((m, idx) => {
          const change = (m.val || 0) - (m.prev || 0);
          const isPositive = m.hBetter ? change >= 0 : change <= 0;
          return (
            <View key={idx} className="flex-1 bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">{m.label}</Text>
              <View className="flex-row items-baseline justify-between">
                <Text className="text-typography-main text-3xl font-black">{Math.round(m.val || 0)}{m.suffix}</Text>
                <View className={`flex-row items-center px-3 py-1 rounded-full ${isPositive ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
                  <FontAwesome name={change >= 0 ? 'caret-up' : 'caret-down'} size={12} color={isPositive ? 'rgb(var(--state-success))' : 'rgb(var(--state-danger))'} className="mr-2" />
                  <Text className={`text-[10px] font-black ${isPositive ? 'text-state-success' : 'text-state-danger'}`}>
                    {Math.abs(Math.round(change))}{m.suffix}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const TargetsSectionWeb = ({ targets, onUpdate, onNew }: any) => (
  <View>
    <View className="flex-row justify-between items-center mb-10">
      <Text className="text-typography-main font-black text-3xl tracking-tight">Active Objectives</Text>
      <TouchableOpacity
        onPress={onNew}
        className="bg-brand-primary px-8 py-4 rounded-2xl premium-shadow flex-row items-center"
      >
        <FontAwesome name="plus" size={14} color="white" className="mr-3" />
        <Text className="text-white font-black uppercase tracking-widest text-xs">New Benchmark</Text>
      </TouchableOpacity>
    </View>

    <View className="flex-row flex-wrap gap-8">
      {targets.map((t: any, i: number) => (
        <View key={i} className="w-[calc(50%-16px)] bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
          <View className="flex-row justify-between mb-8">
            <View>
              <Text className="text-typography-main font-black text-2xl tracking-tight mb-2">{t.stage?.name}</Text>
              <View className="bg-surface-background px-4 py-1.5 rounded-full border border-surface-border inline-flex">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">
                  {t.target_type === 'volume' ? 'Volume Quota' : 'SLA Target'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => {
                const newVal = window.prompt('Enter new target value:', t.target_type === 'volume' ? t.target_quantity : t.target_active_seconds);
                if (newVal) onUpdate(t.id, t.target_type === 'volume' ? 'target_quantity' : 'target_active_seconds', newVal);
              }}
              className="w-12 h-12 rounded-2xl bg-surface-background border border-surface-border items-center justify-center hover:border-brand-primary transition-colors"
            >
              <FontAwesome name="pencil" size={16} className="text-typography-dim" />
            </TouchableOpacity>
          </View>

          {t.target_type === 'volume' ? (
            <View>
              <View className="flex-row justify-between mb-4 items-end">
                <View>
                  <Text className="text-typography-main text-3xl font-black">{t.current_count || 0} / {t.target_quantity}</Text>
                  <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-1">Units Processed</Text>
                </View>
                <View className="items-end">
                  <Text className="text-typography-main font-black">{Math.round(((t.current_count || 0) / (t.target_quantity || 1)) * 100)}%</Text>
                  <Text className="text-typography-muted text-[10px] font-bold uppercase mt-1">Completion</Text>
                </View>
              </View>
              <View className="h-4 bg-surface-background rounded-full overflow-hidden border border-surface-border">
                <View className="h-full bg-brand-primary rounded-full shadow-lg shadow-brand-primary/50" style={{ width: `${Math.min(((t.current_count || 0) / (t.target_quantity || 1)) * 100, 100)}%` }} />
              </View>
              <View className="mt-6 flex-row items-center bg-surface-background p-4 rounded-2xl border border-surface-border/50">
                <FontAwesome name="clock-o" size={14} className="text-typography-dim mr-3" />
                <Text className="text-typography-muted text-[11px] font-bold uppercase tracking-widest">
                  Objective Expiration: {t.target_deadline ? new Date(t.target_deadline).toLocaleDateString() : 'N/A'}
                </Text>
              </View>
            </View>
          ) : (
            <View className="flex-row gap-12">
              <View className="flex-1 bg-surface-background p-6 rounded-2xl border border-surface-border/50">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Target Active</Text>
                <Text className="text-brand-primary text-3xl font-black">{Math.round((t.target_active_seconds || 0) / 60)}<Text className="text-lg">m</Text></Text>
              </View>
              <View className="flex-1 bg-surface-background p-6 rounded-2xl border border-surface-border/50">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Max Life-Cycle</Text>
                <Text className="text-typography-main text-3xl font-black">{Math.round((t.target_lifecycle_seconds || 0) / 3600)}<Text className="text-lg">h</Text></Text>
              </View>
            </View>
          )}
        </View>
      ))}
    </View>
  </View>
);

const ArchivesSectionWeb = ({ reports, onDownload, onNew }: any) => (
  <View>
    <View className="flex-row justify-between items-center mb-10">
      <Text className="text-typography-main font-black text-3xl tracking-tight">Reports</Text>
      <TouchableOpacity
        onPress={onNew}
        className="bg-brand-primary px-8 py-4 rounded-2xl premium-shadow flex-row items-center"
      >
        <FontAwesome name="plus" size={14} color="white" className="mr-3" />
        <Text className="text-white font-black uppercase tracking-widest text-xs">New Report</Text>
      </TouchableOpacity>
    </View>

    <View className="grid grid-cols-2 gap-8">
      {reports.map((r: any, i: number) => (
        <TouchableOpacity
          key={i}
          onPress={() => r.file_url && onDownload(r.file_url)}
          className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow flex-row items-center group hover:border-brand-primary transition-all"
        >
          <View className={`w-20 h-20 rounded-2xl items-center justify-center mr-8 ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-state-info/10'} group-hover:scale-105 transition-transform`}>
            <FontAwesome name="file-pdf-o" size={32} color={r.status === 'completed' ? 'rgb(var(--state-success))' : 'rgb(var(--brand-primary))'} />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-4 mb-2">
              <Text className="text-typography-main font-black text-xl">Audit Report #{r.id.substring(0, 8).toUpperCase()}</Text>
              <View className={`px-3 py-1 rounded-full ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-state-warning/10'}`}>
                <Text className={`text-[9px] font-black uppercase tracking-widest ${r.status === 'completed' ? 'text-state-success' : 'text-state-warning'}`}>{r.status}</Text>
              </View>
            </View>
            <Text className="text-typography-muted text-sm font-medium">Captured on {new Date(r.created_at).toLocaleString()} • Operational Review</Text>
          </View>
          <View className="w-12 h-12 rounded-full bg-surface-background items-center justify-center border border-surface-border group-hover:bg-brand-primary transition-colors">
            <FontAwesome name="download" size={16} className="text-typography-dim group-hover:text-white" />
          </View>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

const TargetCreationModal = ({ visible, onClose, onConfirm, pipelines, stages }: any) => {
  const [type, setType] = useState('performance');
  const [p, setP] = useState(null);
  const [s, setS] = useState(null);
  const [activeGoal, setActiveGoal] = useState('3600');
  const [lifeGoal, setLifeGoal] = useState('86400');
  const [quantity, setQuantity] = useState('50');
  const [deadline, setDeadline] = useState('7');

  const filteredStages = stages.filter((st: any) => st.pipeline_id === p);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center">
        <View className="bg-surface-card w-full max-w-2xl rounded-[40px] border border-surface-border premium-shadow overflow-hidden">
          <View className="p-10 border-b border-surface-border">
            <Text className="text-typography-main text-3xl font-black tracking-tight mb-2">Define Objective</Text>
            <Text className="text-typography-muted font-medium">Establish benchmarks for team performance tracking</Text>
          </View>

          <ScrollView className="p-10 max-h-[600px]">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Objective Classification</Text>
            <View className="flex-row bg-surface-background p-2 rounded-2xl mb-8 border border-surface-border">
              {['performance', 'volume'].map(t => (
                <TouchableOpacity key={t} onPress={() => setType(t)} className={`flex-1 py-4 rounded-xl items-center ${type === t ? 'bg-brand-primary premium-shadow' : 'hover:bg-surface-card/50'}`}>
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${type === t ? 'text-white' : 'text-typography-muted'}`}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="flex-row gap-8 mb-8">
              <View className="flex-1">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Strategic Pipeline</Text>
                <Picker items={pipelines} selectedId={p} onSelect={(id: string) => { setP(id); setS(null); }} />
              </View>
              <View className="flex-1">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Target Node</Text>
                <Picker items={filteredStages} selectedId={s} onSelect={setS} disabled={!p} />
              </View>
            </View>

            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Boundary Parameters</Text>
            {type === 'performance' ? (
              <View className="flex-row gap-8">
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-3">Target Active Latency (Seconds)</Text>
                  <TextInput value={activeGoal} onChangeText={setActiveGoal} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-5 rounded-2xl font-black text-lg focus:border-brand-primary" />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-3">Max Life-Cycle (Seconds)</Text>
                  <TextInput value={lifeGoal} onChangeText={setLifeGoal} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-5 rounded-2xl font-black text-lg focus:border-brand-primary" />
                </View>
              </View>
            ) : (
              <View className="flex-row gap-8">
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-3">Tasks</Text>
                  <TextInput value={quantity} onChangeText={setQuantity} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-5 rounded-2xl font-black text-lg focus:border-brand-primary" />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-3">Timeframe (Days)</Text>
                  <TextInput value={deadline} onChangeText={setDeadline} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-5 rounded-2xl font-black text-lg focus:border-brand-primary" />
                </View>
              </View>
            )}
          </ScrollView>

          <View className="p-10 border-t border-surface-border flex-row gap-6 bg-surface-card/50">
            <TouchableOpacity onPress={onClose} className="flex-1 py-5 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!s}
              onPress={() => {
                const dDate = new Date();
                dDate.setDate(dDate.getDate() + parseInt(deadline));
                onConfirm({
                  stage_id: s,
                  target_type: type,
                  active: type === 'performance' ? parseInt(activeGoal) : null,
                  lifecycle: type === 'performance' ? parseInt(lifeGoal) : null,
                  quantity: type === 'volume' ? parseInt(quantity) : null,
                  deadline: type === 'volume' ? dDate.toISOString() : null
                });
                onClose();
              }}
              className={`flex-[2] py-5 rounded-2xl items-center shadow-lg transition-all active:scale-[0.98] ${s ? 'bg-brand-primary shadow-brand-primary/30' : 'bg-surface-border opacity-50'}`}
            >
              <Text className="text-white font-black uppercase tracking-widest text-xs">Create Objective</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const ReportConfigModal = ({ visible, onClose, onConfirm, pipelines, teams, users, initialDays }: any) => {
  const [d, setD] = useState(initialDays);
  const [p, setP] = useState(null);
  const [t, setT] = useState(null);
  const [u, setU] = useState(null);
  const [type, setType] = useState('performance_audit');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center">
        <View className="bg-surface-card w-full max-w-2xl rounded-[40px] border border-surface-border premium-shadow overflow-hidden">
          <View className="p-10 border-b border-surface-border">
            <Text className="text-typography-main text-3xl font-black tracking-tight mb-2">Audit Parameters</Text>
            <Text className="text-typography-muted font-medium">Define the telemetry boundaries for automated audit generation</Text>
          </View>

          <ScrollView className="p-10 max-h-[600px]">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Temporal Range</Text>
            <View className="flex-row gap-4 mb-8">
              {[7, 30, 90, 180].map(val => (
                <TouchableOpacity key={val} onPress={() => setD(val)} className={`flex-1 py-4 rounded-xl border transition-all ${d === val ? 'bg-brand-primary border-brand-primary premium-shadow' : 'border-surface-border hover:bg-surface-background'}`}>
                  <Text className={`text-center font-black text-[10px] uppercase tracking-widest ${d === val ? 'text-white' : 'text-typography-muted'}`}>{val} Days</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="space-y-8">
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Pipeline Sector</Text>
                <Picker items={[{ id: null, name: 'Global Organization' }, ...pipelines]} selectedId={p} onSelect={setP} />
              </View>
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Team Scope</Text>
                <Picker items={[{ id: null, name: 'All Tactical Teams' }, ...teams]} selectedId={t} onSelect={setT} />
              </View>
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Individual Personnel</Text>
                <Picker items={[{ id: null, name: 'All Active Agents' }, ...users]} selectedId={u} onSelect={setU} labelKey="full_name" />
              </View>
            </View>
          </ScrollView>

          <View className="p-10 border-t border-surface-border flex-row gap-6 bg-surface-card/50">
            <TouchableOpacity onPress={onClose} className="flex-1 py-5 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { onConfirm({ days: d, pipeline_id: p, team_id: t, user_id: u, type }); onClose(); }}
              className="flex-[2] py-5 rounded-2xl bg-brand-primary items-center shadow-lg shadow-brand-primary/30 active:scale-[0.98] transition-transform"
            >
              <Text className="text-white font-black uppercase tracking-widest text-xs">Execute Audit Request</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const Picker = ({ items, selectedId, onSelect, labelKey = 'name', disabled = false }: any) => (
  <View className={`flex-row flex-wrap gap-2 ${disabled ? 'opacity-30' : ''}`}>
    {items.map((item: any) => (
      <TouchableOpacity
        key={item.id}
        disabled={disabled}
        onPress={() => onSelect(item.id)}
        className={`px-5 py-2.5 rounded-xl border transition-all ${selectedId === item.id ? 'bg-brand-primary/5 border-brand-primary' : 'border-surface-border hover:bg-surface-background'}`}
      >
        <View className="flex-row items-center">
          {selectedId === item.id && <View className="w-1.5 h-1.5 rounded-full bg-brand-primary mr-3" />}
          <Text className={`text-[10px] font-black uppercase tracking-widest ${selectedId === item.id ? 'text-brand-primary' : 'text-typography-muted'}`}>
            {item[labelKey] || 'UNDEFINED'}
          </Text>
        </View>
      </TouchableOpacity>
    ))}
  </View>
);

const WidgetConfigModal = ({ visible, onClose, onSave, currentWidgets }: any) => {
  const [selected, setSelected] = useState<string[]>(currentWidgets || []);

  useEffect(() => {
    if (visible) setSelected(currentWidgets || []);
  }, [visible, currentWidgets]);

  const library = [
    { id: 'throughput', name: 'Operational Throughput', desc: 'Total mission cycles completed in temporal range' },
    { id: 'efficiency', name: 'Deployment Efficiency', desc: 'Overall success and retention variance' },
    { id: 'flow_ratio', name: 'Backlog Flow Ratio', desc: 'Relationship between intake and deployment' },
    { id: 'first_pass_yield', name: 'First-Pass Integrity', desc: '% of missions avoiding revision cycles' },
    { id: 'automation_offload', name: 'Cyborg Synergy Score', desc: 'Ratio of automated to manual operations' }
  ];

  const toggleWidget = (id: string) => {
    if (selected.includes(id)) {
      setSelected(selected.filter(w => w !== id));
    } else {
      if (selected.length >= 6) return;
      setSelected([...selected, id]);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center">
        <View className="bg-surface-card w-full max-w-xl rounded-[40px] border border-surface-border premium-shadow overflow-hidden">
          <View className="p-10 border-b border-surface-border">
            <Text className="text-typography-main text-3xl font-black tracking-tight mb-2">Configure Radar</Text>
            <Text className="text-typography-muted font-medium">Select up to 6 telemetry widgets for your main audit view</Text>
          </View>

          <View className="p-10 space-y-4">
            {library.map((w) => {
              const isActive = selected.includes(w.id);
              return (
                <TouchableOpacity
                  key={w.id}
                  onPress={() => toggleWidget(w.id)}
                  className={`p-6 rounded-2xl border transition-all flex-row items-center ${isActive ? 'bg-brand-primary/5 border-brand-primary' : 'border-surface-border hover:bg-surface-background'}`}
                >
                  <View className={`w-6 h-6 rounded-lg border-2 items-center justify-center mr-6 ${isActive ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                    {isActive && <FontAwesome name="check" size={10} color="white" />}
                  </View>
                  <View className="flex-1">
                    <Text className={`font-black text-sm ${isActive ? 'text-brand-primary' : 'text-typography-main'}`}>{w.name}</Text>
                    <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-1">{w.desc}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View className="p-10 border-t border-surface-border flex-row gap-6 bg-surface-card/50">
            <TouchableOpacity onPress={onClose} className="flex-1 py-5 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Discard</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onSave(selected)}
              className="flex-[2] py-5 rounded-2xl bg-brand-primary items-center shadow-lg shadow-brand-primary/30"
            >
              <Text className="text-white font-black uppercase tracking-widest text-xs">Synchronize Radar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};
